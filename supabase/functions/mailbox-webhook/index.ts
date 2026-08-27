import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  createRemoteJWKSet,
  jwtVerify,
} from 'https://esm.sh/jose@5.9.6';

import {
  openCalendarSecret,
  sha256Hex,
} from '../_shared/calendarCrypto.ts';

const googleJwks = createRemoteJWKSet(
  new URL('https://www.googleapis.com/oauth2/v3/certs'),
);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function safe(value: unknown, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

Deno.serve(async (request) => {
  if (Deno.env.get('ENABLE_DIRECT_MAILBOX') !== 'true') {
    return json({ error: 'Direct mailbox webhooks are not enabled.' }, 503);
  }
  const url = new URL(request.url);
  const provider = safe(url.searchParams.get('provider'), 40);
  const validationToken = url.searchParams.get('validationToken');
  if (validationToken) {
    if (request.method !== 'POST' || provider !== 'outlook' || validationToken.length > 2_000) {
      return json({ error: 'Invalid Outlook validation request.' }, 400);
    }
    return new Response(validationToken, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const webhookSecret = Deno.env.get('MAILBOX_WEBHOOK_SECRET');
  const encryptionKey = Deno.env.get('MAILBOX_TOKEN_ENCRYPTION_KEY');
  if (!supabaseUrl || !serviceKey || !webhookSecret || !encryptionKey) {
    return json({ error: 'Mailbox webhooks are not configured.' }, 503);
  }
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  if (provider === 'google') {
    return handleGoogle(request, url, admin, supabaseUrl, serviceKey, webhookSecret);
  }
  if (provider !== 'outlook') {
    return json({ error: 'Unsupported mailbox webhook provider.' }, 400);
  }
  return handleOutlook(
    request,
    admin,
    supabaseUrl,
    serviceKey,
    webhookSecret,
    encryptionKey,
  );
});

async function handleGoogle(
  request: Request,
  url: URL,
  admin: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceKey: string,
  webhookSecret: string,
) {
  if (url.searchParams.get('token') !== webhookSecret) {
    return json({ error: 'Invalid webhook token.' }, 401);
  }
  const expectedServiceAccount = safe(
    Deno.env.get('GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT'),
    320,
  ).toLowerCase();
  const expectedAudience = safe(Deno.env.get('GMAIL_PUBSUB_PUSH_AUDIENCE'), 2_000);
  if (!expectedServiceAccount || !expectedAudience) {
    return json({ error: 'Gmail Pub/Sub OIDC verification is not configured.' }, 503);
  }
  const authorization = request.headers.get('Authorization') || '';
  const idToken = authorization.replace(/^Bearer\s+/i, '');
  try {
    const { payload: identity } = await jwtVerify(idToken, googleJwks, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: expectedAudience,
    });
    if (
      safe(identity.email, 320).toLowerCase() !== expectedServiceAccount
      || identity.email_verified !== true
    ) {
      return json({ error: 'Gmail Pub/Sub identity is not authorized.' }, 401);
    }
  } catch (error) {
    console.error('Gmail Pub/Sub OIDC verification failed', error);
    return json({ error: 'Invalid Gmail Pub/Sub identity token.' }, 401);
  }
  const payload = await request.json().catch(() => ({}));
  const expectedSubscription = safe(Deno.env.get('GMAIL_PUBSUB_SUBSCRIPTION'), 1_000);
  if (expectedSubscription && safe(payload?.subscription, 1_000) !== expectedSubscription) {
    return json({ error: 'Unexpected Gmail Pub/Sub subscription.' }, 401);
  }
  const encoded = safe(payload?.message?.data, 20_000);
  if (!encoded) return json({ received: true });
  let notification: Record<string, unknown>;
  try {
    notification = JSON.parse(decodeBase64Url(encoded));
  } catch {
    return json({ error: 'Invalid Gmail notification.' }, 400);
  }
  const emailAddress = safe(notification.emailAddress, 320).toLowerCase();
  if (!emailAddress) return json({ received: true });
  const { data: connections, error: connectionError } = await admin
    .from('mailbox_connections').select('id')
    .eq('provider', 'google')
    .eq('provider_email', emailAddress)
    .eq('sync_enabled', true)
    .eq('status', 'active');
  if (connectionError) throw connectionError;
  const connectionIds = (connections ?? []).map((item) => item.id);
  if (connectionIds.length) {
    const { error } = await admin.from('mailbox_sync_cursors').update({
      last_webhook_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).in('connection_id', connectionIds).eq('provider_folder_id', 'INBOX');
    if (error) throw error;
  }
  await queueSyncs(supabaseUrl, serviceKey, connectionIds);
  return json({ received: true });
}

async function handleOutlook(
  request: Request,
  admin: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceKey: string,
  webhookSecret: string,
  encryptionKey: string,
) {
  const payload = await request.json().catch(() => ({}));
  const notifications = Array.isArray(payload?.value) ? payload.value : [];
  const connectionIds = new Set<string>();
  for (const notification of notifications.slice(0, 100)) {
    const subscriptionId = safe(notification?.subscriptionId, 1_000);
    if (!subscriptionId) continue;
    const { data: cursor, error: cursorReadError } = await admin
      .from('mailbox_sync_cursors')
      .select('connection_id, provider_folder_id, subscription_client_state_ciphertext')
      .eq('subscription_id', subscriptionId)
      .maybeSingle();
    if (cursorReadError) {
      console.error('Outlook mailbox subscription lookup failed', subscriptionId, cursorReadError);
      continue;
    }
    if (!cursor) continue;
    let expectedState: string;
    try {
      expectedState = cursor.subscription_client_state_ciphertext
        ? await openCalendarSecret(
          cursor.subscription_client_state_ciphertext,
          encryptionKey,
        )
        : (await sha256Hex(
          `${webhookSecret}|${cursor.connection_id}|${cursor.provider_folder_id}`,
        )).slice(0, 128);
    } catch (error) {
      console.error('Outlook mailbox notification clientState could not be opened', subscriptionId, error);
      continue;
    }
    if (safe(notification?.clientState, 256) !== expectedState) {
      console.error('Outlook mailbox notification clientState mismatch', subscriptionId);
      continue;
    }
    const lifecycleEvent = safe(notification?.lifecycleEvent, 100);
    const cursorUpdate: Record<string, unknown> = {
      last_webhook_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (['subscriptionRemoved', 'reauthorizationRequired'].includes(lifecycleEvent)) {
      cursorUpdate.subscription_id = null;
      cursorUpdate.subscription_resource = null;
      cursorUpdate.subscription_client_state_ciphertext = null;
      cursorUpdate.subscription_expires_at = null;
    }
    const { error: cursorWriteError } = await admin.from('mailbox_sync_cursors')
      .update(cursorUpdate)
      .eq('connection_id', cursor.connection_id)
      .eq('provider_folder_id', cursor.provider_folder_id);
    if (cursorWriteError) {
      console.error('Outlook mailbox notification state could not be persisted', subscriptionId, cursorWriteError);
      continue;
    }
    connectionIds.add(cursor.connection_id);
  }
  await queueSyncs(supabaseUrl, serviceKey, [...connectionIds]);
  return json({ received: true }, connectionIds.size ? 202 : 200);
}

async function queueSyncs(supabaseUrl: string, serviceKey: string, connectionIds: string[]) {
  const work = Promise.all(connectionIds.slice(0, 100).map(async (connectionId) => {
    const response = await fetch(`${supabaseUrl}/functions/v1/mailbox-sync`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ connectionId, runType: 'webhook' }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok !== true) {
      console.error('Mailbox webhook sync trigger failed', connectionId, response.status);
    }
  }));
  const edgeRuntime = (globalThis as any).EdgeRuntime;
  if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(work);
  else await work;
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), '=');
  const binary = atob(padded);
  return new TextDecoder().decode(
    Uint8Array.from(binary, (character) => character.charCodeAt(0)),
  );
}
