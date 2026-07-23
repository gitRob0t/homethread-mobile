import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const jsonHeaders = { 'Content-Type': 'application/json' };
const MAX_CLOCK_SKEW_SECONDS = 300;
const MAX_BODY_CHARS = 16_000;

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
  await notifyHousehold(
    supabase,
    inbox.household_id,
    subject,
    sender,
    inserted.id,
  );
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

async function notifyHousehold(
  supabase: ReturnType<typeof createClient>,
  householdId: string,
  subject: string,
  sender: string,
  itemId: string,
) {
  const { data: tokens } = await supabase
    .from('device_push_tokens')
    .select('expo_push_token')
    .eq('household_id', householdId)
    .eq('enabled', true);
  if (!tokens?.length) return;

  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(tokens.map((token) => ({
      to: token.expo_push_token,
      title: 'New family email to review',
      body: `${subject}${sender ? ` · ${sender}` : ''}`.slice(0, 180),
      sound: 'default',
      data: { screen: 'Family Inbox', itemId },
    }))),
  }).catch((error) => console.error('Inbound email notification failed', error));
}
