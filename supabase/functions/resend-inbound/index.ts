import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const jsonHeaders = { 'Content-Type': 'application/json' };
const MAX_CLOCK_SKEW_SECONDS = 300;
const MAX_BODY_CHARS = 35_000;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const allowedAttachmentTypes = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/plain',
  'text/calendar',
  'audio/m4a',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/x-m4a',
]);

type ResendReceivedEvent = {
  type: string;
  data?: {
    email_id?: string;
    from?: string;
    to?: string[];
    received_for?: string[];
    subject?: string;
    message_id?: string;
  };
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const payload = await request.text();
  const webhookSecret = Deno.env.get('RESEND_WEBHOOK_SECRET');
  if (!webhookSecret) return json({ error: 'Inbound email is not configured.' }, 503);
  const verified = await verifyWebhook(payload, request.headers, webhookSecret);
  if (!verified) return json({ error: 'Invalid webhook signature.' }, 401);

  let event: ResendReceivedEvent;
  try {
    event = JSON.parse(payload) as ResendReceivedEvent;
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }
  if (event.type !== 'email.received') return json({ received: true });

  const emailId = String(event.data?.email_id ?? '');
  const providerEventId = request.headers.get('svix-id') ?? '';
  if (!emailId || !providerEventId) return json({ error: 'Missing email metadata.' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!supabaseUrl || !serviceKey || !resendKey) {
    return json({ error: 'Inbound email service is not configured.' }, 503);
  }
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const { data: duplicate } = await supabase
    .from('inbound_items')
    .select('id')
    .or(`provider_event_id.eq.${providerEventId},provider_email_id.eq.${emailId}`)
    .limit(1)
    .maybeSingle();
  if (duplicate) return json({ received: true, duplicate: true });

  const emailResponse = await fetch(
    `https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`,
    {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${resendKey}`,
      },
    },
  );
  const email = await emailResponse.json().catch(() => ({}));
  if (!emailResponse.ok) {
    console.error('Resend received email lookup failed', emailResponse.status, email);
    return json({ error: 'Email content could not be retrieved.' }, 502);
  }

  const recipients = uniqueAddresses([
    ...(Array.isArray(email?.to) ? email.to : []),
    ...(Array.isArray(email?.received_for) ? email.received_for : []),
    ...(event.data?.to ?? []),
    ...(event.data?.received_for ?? []),
  ]);
  const aliases = recipients.map((recipient) => recipient.split('@')[0]).filter(Boolean);
  if (!aliases.length) return json({ received: true, routed: false });

  const { data: inboxes, error: inboxError } = await supabase
    .from('household_inboxes')
    .select('id, household_id, alias, domain, status')
    .in('alias', aliases)
    .in('status', ['reserved', 'active']);
  if (inboxError) return json({ error: 'Family inbox routing failed.' }, 500);

  const inbox = inboxes?.find((candidate) =>
    recipients.includes(`${candidate.alias}@${candidate.domain}`.toLowerCase()),
  );
  if (!inbox) return json({ received: true, routed: false });

  const sender = normalizeAddress(String(email?.from ?? event.data?.from ?? ''));
  const { data: senderRule } = sender
    ? await supabase
      .from('household_inbox_sender_rules')
      .select('trusted')
      .eq('inbox_id', inbox.id)
      .eq('sender_address', sender)
      .maybeSingle()
    : { data: null };

  const rawText = typeof email?.text === 'string' && email.text.trim()
    ? email.text
    : stripHtml(typeof email?.html === 'string' ? email.html : '');
  const bodyText = rawText.replace(/\u0000/g, '').trim().slice(0, MAX_BODY_CHARS);
  const subject = String(email?.subject ?? event.data?.subject ?? '(No subject)').slice(0, 500);
  const attachments = (Array.isArray(email?.attachments) ? email.attachments : [])
    .slice(0, 30)
    .map((attachment: Record<string, unknown>) => ({
      id: String(attachment.id ?? ''),
      filename: String(attachment.filename ?? 'Attachment').slice(0, 300),
      content_type: String(attachment.content_type ?? 'application/octet-stream').slice(0, 160),
      size: Number(attachment.size ?? 0),
    }));

  const { data: inserted, error: insertError } = await supabase
    .from('inbound_items')
    .insert({
      household_id: inbox.household_id,
      inbox_id: inbox.id,
      source: 'email',
      sender: sender || null,
      subject,
      body_preview: bodyText.slice(0, 1_000),
      body_text: bodyText || null,
      body_html_present: Boolean(email?.html),
      attachments,
      provider_event_id: providerEventId,
      provider_email_id: emailId,
      message_id: String(email?.message_id ?? event.data?.message_id ?? '') || null,
      recipient: recipients.find((recipient) =>
        recipient === `${inbox.alias}@${inbox.domain}`.toLowerCase(),
      ) ?? null,
      extracted_data: {
        provider: 'resend',
        sender_trusted: senderRule?.trusted === true,
        requires_human_review: true,
      },
      status: 'needs_review',
      extraction_status: 'queued',
      content_fingerprint: await sha256Text([
        inbox.household_id,
        String(email?.message_id ?? event.data?.message_id ?? ''),
        sender,
        subject,
        bodyText,
      ].join('|')),
    })
    .select('id')
    .single();
  if (insertError) {
    if (insertError.code === '23505') return json({ received: true, duplicate: true });
    console.error('Inbound email insert failed', insertError);
    return json({ error: 'Email could not be added to the review queue.' }, 500);
  }

  await supabase
    .from('household_inboxes')
    .update({ status: 'active', updated_at: new Date().toISOString() })
    .eq('id', inbox.id);

  const backgroundWork = processInboundItem({
    supabase,
    supabaseUrl,
    serviceKey,
    resendKey,
    emailId,
    householdId: inbox.household_id,
    itemId: inserted.id,
    subject,
    sender,
  });
  const edgeRuntime = (globalThis as any).EdgeRuntime;
  if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(backgroundWork);
  else await backgroundWork;
  return json({ received: true, routed: true, itemId: inserted.id });
});

async function verifyWebhook(payload: string, headers: Headers, secret: string) {
  try {
    const messageId = headers.get('svix-id') ?? '';
    const timestamp = headers.get('svix-timestamp') ?? '';
    const signatures = headers.get('svix-signature') ?? '';
    if (!messageId || !timestamp || !signatures) return false;

    const seconds = Number(timestamp);
    if (!Number.isFinite(seconds)) return false;
    if (Math.abs(Math.floor(Date.now() / 1000) - seconds) > MAX_CLOCK_SKEW_SECONDS) {
      return false;
    }

    const secretValue = secret.startsWith('whsec_') ? secret.slice(6) : secret;
    const key = await crypto.subtle.importKey(
      'raw',
      base64Bytes(secretValue),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const signed = new TextEncoder().encode(`${messageId}.${timestamp}.${payload}`);
    for (const signature of signatures.split(/\s+/)) {
      const [version, encoded] = signature.split(',');
      if (version !== 'v1' || !encoded) continue;
      if (await crypto.subtle.verify('HMAC', key, base64Bytes(encoded), signed)) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

function base64Bytes(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function normalizeAddress(value: string) {
  const match = value.toLowerCase().match(/<?([a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,})>?/i);
  return match?.[1] ?? '';
}

function uniqueAddresses(values: string[]) {
  return [...new Set(values.map(normalizeAddress).filter(Boolean))];
}

function stripHtml(html: string) {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ');
}

async function processInboundItem(input: {
  supabase: ReturnType<typeof createClient>;
  supabaseUrl: string;
  serviceKey: string;
  resendKey: string;
  emailId: string;
  householdId: string;
  itemId: string;
  subject: string;
  sender: string;
}) {
  try {
    const response = await fetch(
      `https://api.resend.com/emails/receiving/${encodeURIComponent(input.emailId)}/attachments`,
      {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${input.resendKey}`,
        },
      },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`Resend attachment list failed (${response.status}).`);
    }

    const attachments = Array.isArray(payload?.data) ? payload.data.slice(0, 30) : [];
    let totalBytes = 0;
    for (const attachment of attachments) {
      const id = String(attachment?.id ?? '');
      const filename = safeFilename(String(attachment?.filename ?? 'Attachment'));
      const contentType = String(attachment?.content_type ?? 'application/octet-stream')
        .toLowerCase()
        .slice(0, 160);
      const byteSize = Math.max(0, Number(attachment?.size ?? 0));
      const accepted = Boolean(id)
        && allowedAttachmentTypes.has(contentType)
        && byteSize <= MAX_ATTACHMENT_BYTES
        && totalBytes + byteSize <= MAX_TOTAL_ATTACHMENT_BYTES;

      if (!accepted) {
        await input.supabase.from('inbound_attachments').upsert({
          inbound_item_id: input.itemId,
          household_id: input.householdId,
          provider_attachment_id: id || null,
          filename,
          content_type: contentType,
          byte_size: byteSize,
          status: 'rejected',
          processing_error: allowedAttachmentTypes.has(contentType)
            ? 'Attachment exceeds the Family Inbox size limit.'
            : 'Attachment type is not supported by Family Inbox.',
          processed_at: new Date().toISOString(),
        }, { onConflict: 'inbound_item_id,provider_attachment_id' });
        continue;
      }

      try {
        const downloadUrl = String(attachment?.download_url ?? '');
        if (!downloadUrl.startsWith('https://')) throw new Error('Missing secure download URL.');
        const fileResponse = await fetch(downloadUrl);
        if (!fileResponse.ok) throw new Error(`Attachment download failed (${fileResponse.status}).`);
        const bytes = new Uint8Array(await fileResponse.arrayBuffer());
        if (bytes.byteLength > MAX_ATTACHMENT_BYTES || totalBytes + bytes.byteLength > MAX_TOTAL_ATTACHMENT_BYTES) {
          throw new Error('Downloaded attachment exceeds the Family Inbox size limit.');
        }
        totalBytes += bytes.byteLength;
        const digest = await sha256Bytes(bytes);
        const storagePath = `${input.householdId}/${input.itemId}/${id}-${filename}`;
        const { error: uploadError } = await input.supabase.storage
          .from('family-inbox')
          .upload(storagePath, bytes, {
            contentType,
            upsert: false,
          });
        if (uploadError && !String(uploadError.message).toLowerCase().includes('already exists')) {
          throw uploadError;
        }
        await input.supabase.from('inbound_attachments').upsert({
          inbound_item_id: input.itemId,
          household_id: input.householdId,
          provider_attachment_id: id,
          filename,
          content_type: contentType,
          byte_size: bytes.byteLength,
          sha256: digest,
          storage_path: storagePath,
          status: 'stored',
          processing_error: null,
        }, { onConflict: 'inbound_item_id,provider_attachment_id' });
      } catch (error) {
        await input.supabase.from('inbound_attachments').upsert({
          inbound_item_id: input.itemId,
          household_id: input.householdId,
          provider_attachment_id: id,
          filename,
          content_type: contentType,
          byte_size: byteSize,
          status: 'failed',
          processing_error: error instanceof Error ? error.message.slice(0, 1_000) : 'Attachment processing failed.',
          processed_at: new Date().toISOString(),
        }, { onConflict: 'inbound_item_id,provider_attachment_id' });
      }
    }

    const [{ data: recipients }, { data: inboxRules }] = await Promise.all([
      input.supabase
        .from('household_members')
        .select('user_id, role')
        .eq('household_id', input.householdId)
        .neq('role', 'child'),
      input.supabase
        .from('automation_rules')
        .select('id')
        .eq('household_id', input.householdId)
        .eq('trigger_type', 'inbox_received')
        .eq('enabled', true)
        .limit(1),
    ]);
    if (!inboxRules?.length && recipients?.length) {
      await input.supabase.from('notification_outbox').upsert(recipients.map((recipient) => ({
        household_id: input.householdId,
        recipient_user_id: recipient.user_id,
        inbound_item_id: input.itemId,
        category: 'family_inbox',
        title: 'New family email received',
        body: `${input.subject}${input.sender ? ` · ${input.sender}` : ''}`.slice(0, 180),
        deep_link: `coho://inbox/${input.itemId}`,
        payload: {
          screen: 'Family Inbox',
          inboxItemId: input.itemId,
          deepLink: `coho://inbox/${input.itemId}`,
        },
        dedupe_key: `inbox:${input.itemId}:received:${recipient.user_id}`,
      })), { onConflict: 'dedupe_key', ignoreDuplicates: true });
    }

    const extractionResponse = await fetch(`${input.supabaseUrl}/functions/v1/coh-extract`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ inboundItemId: input.itemId }),
    });
    if (!extractionResponse.ok) {
      const error = await extractionResponse.text();
      throw new Error(`Coh extraction request failed (${extractionResponse.status}): ${error.slice(0, 300)}`);
    }
    if (inboxRules?.length) {
      const automationResponse = await fetch(`${input.supabaseUrl}/functions/v1/run-automations`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${input.serviceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          householdId: input.householdId,
          triggerType: 'inbox_received',
          context: {
            inboxItemId: input.itemId,
            subject: input.subject,
            sender: input.sender,
          },
        }),
      });
      if (!automationResponse.ok) {
        console.error('Inbox automation trigger failed', automationResponse.status);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Inbound processing failed.';
    console.error('Family Inbox background processing failed', input.itemId, message);
    await input.supabase.from('inbound_items').update({
      status: 'failed',
      extraction_status: 'failed',
      processing_error: message.slice(0, 1_000),
    }).eq('id', input.itemId);
  }
}

function safeFilename(value: string) {
  return value
    .replace(/[/\\\u0000-\u001f\u007f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240) || 'Attachment';
}

async function sha256Text(value: string) {
  return sha256Bytes(new TextEncoder().encode(value));
}

async function sha256Bytes(value: Uint8Array) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', value));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
