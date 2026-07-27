import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import {
  openCalendarSecret,
  sealCalendarSecret,
  sha256Hex,
} from '../_shared/calendarCrypto.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-coho-scheduler-secret',
};
const MAX_BODY_CHARS = 35_000;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;
// Extraction can take seconds per message. Keep provider pages deliberately
// small and persist the next page token/link so no invocation claims work it
// did not finish.
const MAX_MESSAGES_PER_PROVIDER_PAGE = 10;
const GMAIL_HISTORY_RECOVERY_MIN_DAYS = 7;
const GMAIL_HISTORY_RECOVERY_MAX_DAYS = 30;
const STALE_SYNC_MINUTES = 30;
const STALE_EXTRACTION_MINUTES = 15;
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

type Provider = 'google' | 'outlook';
type Admin = ReturnType<typeof createClient>;
type Connection = {
  id: string;
  household_id: string;
  user_id: string;
  source_id: string | null;
  provider: Provider;
  provider_email: string;
  scopes: string[];
  status: string;
  access_token_ciphertext: string;
  refresh_token_ciphertext: string | null;
  token_expires_at: string | null;
  selected_folders: Array<{ id: string; name?: string; kind?: string; selected?: boolean }>;
  sync_policy: {
    mode?: string;
    lookbackDays?: number;
    autoAction?: string;
    includeAttachments?: boolean;
  } | null;
  sync_enabled: boolean;
  updated_at: string;
};
type NormalizedAttachment = {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  inlineData?: Uint8Array;
  download?: () => Promise<Uint8Array>;
};
type NormalizedMessage = {
  providerId: string;
  providerEtag: string | null;
  senderAuthenticated: boolean;
  senderAuthentication: string | null;
  internetMessageId: string | null;
  threadId: string | null;
  sender: string | null;
  subject: string;
  bodyText: string;
  bodyHtmlPresent: boolean;
  receivedAt: string;
  attachments: NormalizedAttachment[];
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function safe(value: unknown, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  if (Deno.env.get('ENABLE_DIRECT_MAILBOX') !== 'true') {
    return json({ error: 'Direct mailbox synchronization is not enabled.' }, 503);
  }
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const encryptionKey = Deno.env.get('MAILBOX_TOKEN_ENCRYPTION_KEY');
  if (!supabaseUrl || !anonKey || !serviceKey || !encryptionKey) {
    return json({ error: 'Mailbox sync is not configured.' }, 503);
  }
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const authorization = request.headers.get('Authorization') ?? '';
  const bearer = authorization.replace(/^Bearer\s+/i, '');
  const schedulerSecret = Deno.env.get('MAILBOX_SYNC_SECRET') || '';
  const internal = bearer === serviceKey
    || Boolean(schedulerSecret && request.headers.get('x-coho-scheduler-secret') === schedulerSecret);
  let callerId: string | null = null;
  if (!internal) {
    if (!authorization) return json({ error: 'Authentication required.' }, 401);
    const client = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return json({ error: 'Invalid session.' }, 401);
    callerId = data.user.id;
  }

  try {
    const body = await request.json().catch(() => ({}));
    const connectionId = safe(body?.connectionId, 80);
    const requestedRunType = safe(body?.runType, 40);
    const allowedRunTypes = new Set(['initial', 'incremental', 'webhook', 'reconcile', 'manual']);
    const runType = allowedRunTypes.has(requestedRunType)
      ? requestedRunType
      : callerId
        ? 'manual'
        : 'reconcile';
    let staleQuery = admin.from('mailbox_connections').update({
      status: 'error',
      last_error: 'The previous mailbox sync did not finish. Coh is retrying safely.',
      updated_at: new Date().toISOString(),
    })
      .eq('status', 'syncing')
      .lt(
        'updated_at',
        new Date(Date.now() - STALE_SYNC_MINUTES * 60_000).toISOString(),
      );
    if (connectionId) staleQuery = staleQuery.eq('id', connectionId);
    if (callerId) staleQuery = staleQuery.eq('user_id', callerId);
    const { error: staleError } = await staleQuery;
    if (staleError) throw staleError;

    let query = admin.from('mailbox_connections').select('*')
      .eq('sync_enabled', true)
      .in('status', ['active', 'error']);
    if (connectionId) query = query.eq('id', connectionId);
    else query = query.limit(100);
    if (callerId) query = query.eq('user_id', callerId);
    const { data: rows, error } = await query;
    if (error) throw error;
    const connections = (rows ?? []) as Connection[];
    if (connectionId && !connections.length) {
      return json({ error: 'Mailbox connection not found.' }, 404);
    }

    const results = [];
    for (const connection of connections) {
      results.push(await syncConnection({
        admin,
        supabaseUrl,
        serviceKey,
        encryptionKey,
        connection,
        runType,
      }));
    }
    const ok = results.every((result) => result.ok);
    return json({ ok, results }, ok ? 200 : 207);
  } catch (error) {
    console.error('Mailbox sync request failed', error);
    return json({ error: error instanceof Error ? error.message : 'Mailbox sync failed.' }, 400);
  }
});

async function syncConnection(input: {
  admin: Admin;
  supabaseUrl: string;
  serviceKey: string;
  encryptionKey: string;
  connection: Connection;
  runType: string;
}) {
  const { admin } = input;
  const startedAt = new Date().toISOString();
  const { data: membership, error: membershipError } = await admin
    .from('household_members')
    .select('role')
    .eq('household_id', input.connection.household_id)
    .eq('user_id', input.connection.user_id)
    .maybeSingle();
  if (membershipError) throw membershipError;
  if (!membership || !['owner', 'admin'].includes(String(membership.role))) {
    const message = 'Mailbox sync paused because its owner is no longer a household owner or admin.';
    const { error: pauseError } = await admin.from('mailbox_connections').update({
      status: 'paused',
      sync_enabled: false,
      last_error: message,
      updated_at: startedAt,
    }).eq('id', input.connection.id);
    if (pauseError) throw pauseError;
    return { connectionId: input.connection.id, ok: false, error: message };
  }
  const { data: claimed, error: claimError } = await admin.from('mailbox_connections')
    .update({
      status: 'syncing',
      last_error: null,
      updated_at: startedAt,
    })
    .eq('id', input.connection.id)
    .eq('sync_enabled', true)
    .in('status', ['active', 'error'])
    .select('*')
    .maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) {
    return {
      connectionId: input.connection.id,
      ok: true,
      skipped: true,
      reason: 'sync_already_running_or_connection_unavailable',
    };
  }
  const connection = claimed as Connection;
  let syncRunId: string | null = null;
  try {
    syncRunId = await createSyncRun(admin, {
      connectionId: connection.id,
      runType: input.runType,
      startedAt,
    });
    const { data: inbox, error: inboxError } = await admin
      .from('household_inboxes').select('id')
      .eq('household_id', connection.household_id)
      .maybeSingle();
    if (inboxError) throw inboxError;
    if (!inbox) throw new Error('Create the Family Inbox before syncing this mailbox.');

    const token = await validAccessToken(admin, connection, input.encryptionKey);
    const selected = (Array.isArray(connection.selected_folders) ? connection.selected_folders : [])
      .filter((folder) => folder.selected === true && safe(folder.id, 1_000));
    if (!selected.length) {
      throw new Error('No mailbox folders are selected. Reconnect and choose at least one folder.');
    }
    if (selected.length > 20) {
      throw new Error('Mailbox sync supports at most 20 selected folders. Update mailbox settings.');
    }
    const folders = selected;
    let imported = 0;
    let duplicates = 0;
    let failed = 0;
    let hasMore = false;

    for (const folder of folders) {
      const result = connection.provider === 'google'
        ? await syncGoogleFolder({
          ...input,
          connection,
          token,
          inboxId: inbox.id,
          folderId: folder.id,
          syncRunId,
        })
        : await syncOutlookFolder({
          ...input,
          connection,
          token,
          inboxId: inbox.id,
          folderId: folder.id,
          syncRunId,
        });
      imported += result.imported;
      duplicates += result.duplicates;
      failed += result.failed;
      hasMore = hasMore || result.hasMore;
    }

    const completedAt = new Date().toISOString();
    const partialError = failed
      ? `${failed} mailbox message(s) need a safe retry.`
      : null;
    const { error: healthError } = await admin.from('mailbox_connections').update({
      status: failed ? 'error' : 'active',
      last_synced_at: completedAt,
      last_error: partialError,
      updated_at: completedAt,
    }).eq('id', connection.id);
    if (healthError) throw healthError;
    if (connection.source_id) {
      const sourceUpdate: Record<string, unknown> = {
        status: 'active',
        updated_at: completedAt,
      };
      if (imported > 0) sourceUpdate.last_received_at = completedAt;
      const { error: sourceError } = await admin.from('household_email_sources').update(sourceUpdate)
        .eq('id', connection.source_id);
      if (sourceError) throw sourceError;
    }
    if (syncRunId) {
      await finishSyncRun(admin, {
        syncRunId,
        status: failed ? 'partial' : 'succeeded',
        imported,
        duplicates,
        failed,
        error: partialError,
      });
    }
    if (hasMore && failed === 0) {
      queueContinuation(input.supabaseUrl, input.serviceKey, connection.id);
    }
    return { connectionId: connection.id, ok: failed === 0, imported, duplicates, failed };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Mailbox sync failed.';
    const reconnect = shouldReauthorize(message);
    const { error: failureStateError } = await admin.from('mailbox_connections').update({
      status: reconnect ? 'reauthorize' : 'error',
      last_error: message.slice(0, 1_000),
      updated_at: new Date().toISOString(),
    }).eq('id', connection.id);
    if (failureStateError) {
      console.error('Mailbox connection failure state could not be persisted', connection.id, failureStateError);
    }
    if (syncRunId) {
      await finishSyncRun(admin, {
        syncRunId,
        status: 'failed',
        imported: 0,
        duplicates: 0,
        failed: 1,
        error: message,
      });
    }
    console.error('Mailbox connection sync failed', connection.id, message);
    return { connectionId: connection.id, ok: false, imported: 0, duplicates: 0, failed: 1, error: message };
  }
}

async function validAccessToken(admin: Admin, connection: Connection, encryptionKey: string) {
  const expiresAt = connection.token_expires_at ? new Date(connection.token_expires_at).getTime() : 0;
  if (expiresAt > Date.now() + 120_000) {
    return openCalendarSecret(connection.access_token_ciphertext, encryptionKey);
  }
  if (!connection.refresh_token_ciphertext) throw new Error('Mailbox authorization expired; reconnect the account.');
  const refreshToken = await openCalendarSecret(connection.refresh_token_ciphertext, encryptionKey);
  const config = refreshConfig(connection.provider);
  const response = await fetch(config.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: config.scopes.join(' '),
    }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.access_token) {
    const code = safe(payload.error, 160) || `http_${response.status}`;
    const detail = safe(payload.error_description, 500) || 'Mailbox token refresh failed.';
    throw new Error(`${code}: ${detail} (${response.status})`);
  }
  const replacementRefresh = payload.refresh_token
    ? await sealCalendarSecret(payload.refresh_token, encryptionKey)
    : connection.refresh_token_ciphertext;
  const { error: tokenStateError } = await admin.from('mailbox_connections').update({
    access_token_ciphertext: await sealCalendarSecret(payload.access_token, encryptionKey),
    refresh_token_ciphertext: replacementRefresh,
    token_expires_at: new Date(Date.now() + Number(payload.expires_in || 3600) * 1_000).toISOString(),
    scopes: parseScopes(payload.scope, connection.scopes),
    updated_at: new Date().toISOString(),
  }).eq('id', connection.id);
  if (tokenStateError) throw tokenStateError;
  return String(payload.access_token);
}

function refreshConfig(provider: Provider) {
  if (provider === 'google') {
    const clientId = Deno.env.get('GOOGLE_MAIL_CLIENT_ID');
    const clientSecret = Deno.env.get('GOOGLE_MAIL_CLIENT_SECRET');
    if (!clientId || !clientSecret) throw new Error('Gmail OAuth credentials are not configured.');
    return {
      clientId,
      clientSecret,
      tokenEndpoint: 'https://oauth2.googleapis.com/token',
      scopes: ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/gmail.readonly'],
    };
  }
  const clientId = Deno.env.get('MICROSOFT_MAIL_CLIENT_ID');
  const clientSecret = Deno.env.get('MICROSOFT_MAIL_CLIENT_SECRET');
  if (!clientId || !clientSecret) throw new Error('Outlook Mail OAuth credentials are not configured.');
  return {
    clientId,
    clientSecret,
    tokenEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: ['openid', 'email', 'profile', 'offline_access', 'User.Read', 'Mail.Read'],
  };
}

async function syncGoogleFolder(input: {
  admin: Admin;
  supabaseUrl: string;
  serviceKey: string;
  connection: Connection;
  token: string;
  inboxId: string;
  folderId: string;
  syncRunId: string;
}) {
  const { data: cursorRow, error: cursorReadError } = await input.admin
    .from('mailbox_sync_cursors').select('*')
    .eq('connection_id', input.connection.id)
    .eq('provider_folder_id', input.folderId)
    .maybeSingle();
  if (cursorReadError) throw cursorReadError;
  const cursorBefore = safe(cursorRow?.cursor, 20_000) || null;
  const cursorState = parseGoogleCursor(cursorBefore);
  if (cursorBefore?.startsWith('{') && !cursorState) {
    throw new Error(
      'Gmail sync state is invalid. Coho stopped without advancing the mailbox cursor; reconnect the account to run a supervised rescan.',
    );
  }
  let ids: string[] = [];
  let nextCursor: string | null = cursorBefore;
  let recoveringExpiredHistory = false;
  let recoveryLookbackDays: number | null = null;

  if (cursorState) {
    try {
      if (typeof cursorState === 'string') {
        const history = await googleHistoryPage(
          input.token,
          cursorState,
          input.folderId,
          null,
        );
        ids = history.messageIds;
        nextCursor = history.nextPageToken
          ? encodeGoogleCursor({
            phase: 'history',
            startHistoryId: cursorState,
            pageToken: history.nextPageToken,
            latestHistoryId: history.historyId || cursorState,
          })
          : history.historyId || cursorState;
      } else if (cursorState.phase === 'history') {
        const history = await googleHistoryPage(
          input.token,
          cursorState.startHistoryId,
          input.folderId,
          cursorState.pageToken,
        );
        ids = history.messageIds;
        const latestHistoryId = history.historyId || cursorState.latestHistoryId;
        nextCursor = history.nextPageToken
          ? encodeGoogleCursor({
            ...cursorState,
            pageToken: history.nextPageToken,
            latestHistoryId,
          })
          : latestHistoryId;
      } else {
        const page = await googleInitialMessagePage(
          input.token,
          input.folderId,
          Math.min(30, Math.max(0, Number(input.connection.sync_policy?.lookbackDays ?? 0))),
          cursorState.pageToken,
        );
        ids = page.messageIds;
        nextCursor = page.nextPageToken
          ? encodeGoogleCursor({ ...cursorState, pageToken: page.nextPageToken })
          : cursorState.historyId;
      }
    } catch (error) {
      if (!/history.*(?:expired|invalid)|\b404\b/i.test(String(error))) throw error;
      recoveringExpiredHistory = true;
      const lastCheckpoint = safeTimestamp(
        cursorRow?.last_incremental_sync_at ?? cursorRow?.last_full_sync_at,
      );
      if (!lastCheckpoint) {
        throw new Error(
          'Gmail history expired and no reliable sync checkpoint exists. Coho stopped without skipping mail; reconnect the account to run a supervised rescan.',
        );
      }
      const elapsedDays = Math.max(
        1,
        Math.ceil((Date.now() - new Date(lastCheckpoint).getTime()) / 86_400_000) + 1,
      );
      if (elapsedDays > GMAIL_HISTORY_RECOVERY_MAX_DAYS) {
        throw new Error(
          `Gmail history expired after a ${elapsedDays}-day gap. Coho stopped instead of silently skipping older mail; reconnect the account to approve a full rescan.`,
        );
      }
      recoveryLookbackDays = Math.max(GMAIL_HISTORY_RECOVERY_MIN_DAYS, elapsedDays);
      nextCursor = null;
    }
  }
  if (!nextCursor) {
    const configuredLookback = Math.min(
      30,
      Math.max(0, Number(input.connection.sync_policy?.lookbackDays ?? 0)),
    );
    // "New mail only" is correct at initial consent. It is not safe after a
    // provider history cursor expires because re-seeding at zero would drop
    // the messages since the last good cursor. Reconcile an independent,
    // bounded window before advancing to Gmail's new history ID.
    const lookback = recoveringExpiredHistory
      ? Math.max(configuredLookback, recoveryLookbackDays ?? GMAIL_HISTORY_RECOVERY_MIN_DAYS)
      : configuredLookback;
    const profileResponse = await providerFetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/profile',
      input.token,
    );
    const historyId = safe(profileResponse.historyId, 2_000);
    if (!historyId) throw new Error('Gmail did not return a synchronization history ID.');
    if (lookback === 0) {
      // "New mail only" seeds the provider cursor without importing any
      // message that existed before consent completed.
      ids = [];
      nextCursor = historyId;
    } else {
      const page = await googleInitialMessagePage(
        input.token,
        input.folderId,
        lookback,
        null,
      );
      ids = page.messageIds;
      nextCursor = page.nextPageToken
        ? encodeGoogleCursor({
          phase: 'backfill',
          historyId,
          pageToken: page.nextPageToken,
        })
        : historyId;
    }
  }

  let imported = 0;
  let duplicates = 0;
  let failed = 0;
  for (const id of [...new Set(ids)]) {
    try {
      const message = await googleMessage(input.token, id);
      const outcome = await ingestMessage({ ...input, message, syncRunId: input.syncRunId });
      if (outcome === 'imported') imported += 1;
      else duplicates += 1;
    } catch (error) {
      failed += 1;
      console.error('Gmail message ingestion failed', input.connection.id, id, error);
    }
  }

  const finishingBackfill = !failed
    && !isGoogleWorkCursor(nextCursor)
    && (!cursorRow || (typeof cursorState !== 'string' && cursorState?.phase === 'backfill'));
  const { error: cursorWriteError } = await input.admin.from('mailbox_sync_cursors').upsert({
    connection_id: input.connection.id,
    provider_folder_id: input.folderId,
    cursor: failed ? cursorBefore : nextCursor,
    last_full_sync_at: finishingBackfill
      ? new Date().toISOString()
      : cursorRow?.last_full_sync_at ?? null,
    last_incremental_sync_at: cursorRow && !failed && !isGoogleWorkCursor(nextCursor)
      ? new Date().toISOString()
      : cursorRow?.last_incremental_sync_at ?? null,
    last_error: failed ? `${failed} message(s) could not be processed.` : null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'connection_id,provider_folder_id' });
  if (cursorWriteError) throw cursorWriteError;
  await ensureGoogleWatch(input, cursorRow);
  return { imported, duplicates, failed, hasMore: !failed && isGoogleWorkCursor(nextCursor) };
}

async function googleInitialMessagePage(
  token: string,
  labelId: string,
  lookbackDays: number,
  pageToken: string | null,
) {
  const query = new URLSearchParams({
    labelIds: labelId,
    maxResults: String(MAX_MESSAGES_PER_PROVIDER_PAGE),
  });
  if (lookbackDays > 0) query.set('q', `newer_than:${lookbackDays}d`);
  if (pageToken) query.set('pageToken', pageToken);
  const payload = await providerFetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?${query}`,
    token,
  );
  return {
    messageIds: (Array.isArray(payload.messages) ? payload.messages : [])
    .map((message: Record<string, unknown>) => safe(message.id, 500))
      .filter(Boolean),
    nextPageToken: safe(payload.nextPageToken, 2_000) || null,
  };
}

async function googleHistoryPage(
  token: string,
  historyId: string,
  labelId: string,
  pageToken: string | null,
) {
  const query = new URLSearchParams({
    startHistoryId: historyId,
    historyTypes: 'messageAdded',
    labelId,
    maxResults: String(MAX_MESSAGES_PER_PROVIDER_PAGE),
  });
  if (pageToken) query.set('pageToken', pageToken);
  const payload = await providerFetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/history?${query}`,
    token,
  );
  const ids: string[] = [];
  for (const history of Array.isArray(payload.history) ? payload.history : []) {
    for (const added of Array.isArray(history.messagesAdded) ? history.messagesAdded : []) {
      const id = safe(added?.message?.id, 500);
      if (id) ids.push(id);
    }
  }
  return {
    messageIds: ids,
    historyId: safe(payload.historyId, 2_000) || historyId,
    nextPageToken: safe(payload.nextPageToken, 2_000) || null,
  };
}

async function googleMessage(token: string, id: string): Promise<NormalizedMessage> {
  const payload = await providerFetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`,
    token,
  );
  const rawHeaders = Array.isArray(payload?.payload?.headers) ? payload.payload.headers : [];
  const headers = new Map(
    rawHeaders
      .map((header: Record<string, unknown>) => [
        safe(header.name, 100).toLowerCase(),
        safe(header.value, 4_000),
      ]),
  );
  const senderAuthentication = providerSenderAuthentication('google', rawHeaders);
  const parts = flattenGmailParts(payload?.payload);
  const plain = parts.find((part) => part.mimeType === 'text/plain' && part.body?.data);
  const html = parts.find((part) => part.mimeType === 'text/html' && part.body?.data);
  const bodyText = plain?.body?.data
    ? decodeBase64UrlText(plain.body.data)
    : html?.body?.data
      ? stripHtml(decodeBase64UrlText(html.body.data))
      : '';
  const attachments: NormalizedAttachment[] = parts
    .filter((part) => part.filename && (part.body?.attachmentId || part.body?.data))
    .map((part) => {
      const contentType = safe(part.mimeType, 160).toLowerCase()
        || 'application/octet-stream';
      const size = Number(part.body?.size || 0);
      const mayRead = attachmentMetadataAllowed(contentType, size);
      return {
        id: safe(part.body?.attachmentId || part.partId, 500),
        filename: safe(part.filename, 300) || 'Attachment',
        contentType,
        size,
        inlineData: mayRead && part.body?.data
          ? decodeBase64UrlBytesBounded(String(part.body.data), MAX_ATTACHMENT_BYTES)
          : undefined,
        download: mayRead && part.body?.attachmentId
          ? async () => {
            const attachment = await providerFetch(
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}/attachments/${encodeURIComponent(part.body.attachmentId)}`,
              token,
            );
            return decodeBase64UrlBytesBounded(
              String(attachment.data || ''),
              MAX_ATTACHMENT_BYTES,
            );
          }
          : undefined,
      };
    });
  return {
    providerId: id,
    providerEtag: null,
    senderAuthenticated: Boolean(senderAuthentication),
    senderAuthentication,
    internetMessageId: headers.get('message-id') || null,
    threadId: safe(payload.threadId, 500) || null,
    sender: normalizeAddress(headers.get('from') || ''),
    subject: headers.get('subject') || '(No subject)',
    bodyText: bodyText.replace(/\u0000/g, '').trim().slice(0, MAX_BODY_CHARS),
    bodyHtmlPresent: Boolean(html),
    receivedAt: new Date(Number(payload.internalDate || Date.now())).toISOString(),
    attachments,
  };
}

function flattenGmailParts(root: any) {
  const result: any[] = [];
  const visit = (part: any) => {
    if (!part) return;
    result.push(part);
    for (const child of Array.isArray(part.parts) ? part.parts : []) visit(child);
  };
  visit(root);
  return result;
}

async function ensureGoogleWatch(input: {
  admin: Admin;
  connection: Connection;
  token: string;
  folderId: string;
}, cursor: Record<string, unknown> | null) {
  const topicName = Deno.env.get('GMAIL_PUBSUB_TOPIC');
  if (!topicName || input.folderId !== 'INBOX') return;
  const expiresAt = safeTimestamp(cursor?.subscription_expires_at);
  if (expiresAt && new Date(expiresAt).getTime() > Date.now() + 24 * 3_600_000) return;
  const response = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/watch',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        topicName,
        labelIds: ['INBOX'],
        labelFilterBehavior: 'include',
      }),
    },
  );
  const payload = await response.json();
  if (!response.ok) throw new Error(`Gmail watch failed (${response.status}).`);
  const { error } = await input.admin.from('mailbox_sync_cursors').update({
    subscription_resource: topicName,
    subscription_expires_at: payload.expiration
      ? new Date(Number(payload.expiration)).toISOString()
      : null,
    updated_at: new Date().toISOString(),
  }).eq('connection_id', input.connection.id).eq('provider_folder_id', input.folderId);
  if (error) throw error;
}

async function syncOutlookFolder(input: {
  admin: Admin;
  supabaseUrl: string;
  serviceKey: string;
  connection: Connection;
  token: string;
  inboxId: string;
  folderId: string;
  syncRunId: string;
  encryptionKey: string;
}) {
  const { data: cursorRow, error: cursorReadError } = await input.admin
    .from('mailbox_sync_cursors').select('*')
    .eq('connection_id', input.connection.id)
    .eq('provider_folder_id', input.folderId)
    .maybeSingle();
  if (cursorReadError) throw cursorReadError;
  const lookback = Math.min(30, Math.max(0, Number(input.connection.sync_policy?.lookbackDays ?? 0)));
  const cursorBefore = safe(cursorRow?.cursor, 20_000) || null;
  const select = 'id,internetMessageId,conversationId,changeKey,subject,from,receivedDateTime,body,bodyPreview,hasAttachments,internetMessageHeaders';
  let url: string | null = safe(cursorRow?.cursor, 20_000) || null;
  if (!url) {
    const query = new URLSearchParams({
      '$select': select,
      '$top': String(MAX_MESSAGES_PER_PROVIDER_PAGE),
      changeType: 'created',
    });
    query.set(
      '$filter',
      `receivedDateTime ge ${new Date(Date.now() - lookback * 86_400_000).toISOString()}`,
    );
    url = `https://graph.microsoft.com/v1.0/me/mailFolders/${encodeURIComponent(input.folderId)}/messages/delta?${query}`;
  }

  let imported = 0;
  let duplicates = 0;
  let failed = 0;
  let deltaLink: string | null = null;
  for (let page = 0; url && page < 1; page += 1) {
    const payload = await providerFetch(url, input.token, {
      Prefer: `odata.maxpagesize=${MAX_MESSAGES_PER_PROVIDER_PAGE}`,
    });
    for (const raw of Array.isArray(payload.value) ? payload.value : []) {
      if (raw['@removed']) continue;
      try {
        const message = await outlookMessage(input.token, raw);
        const outcome = await ingestMessage({ ...input, message, syncRunId: input.syncRunId });
        if (outcome === 'imported') imported += 1;
        else duplicates += 1;
      } catch (error) {
        failed += 1;
        console.error('Outlook message ingestion failed', input.connection.id, raw?.id, error);
      }
    }
    url = safe(payload['@odata.nextLink'], 20_000) || null;
    deltaLink = safe(payload['@odata.deltaLink'], 20_000) || deltaLink;
  }
  const { error: cursorWriteError } = await input.admin.from('mailbox_sync_cursors').upsert({
    connection_id: input.connection.id,
    provider_folder_id: input.folderId,
    cursor: failed ? cursorBefore : deltaLink || url || cursorBefore,
    last_full_sync_at: !cursorRow && !failed && Boolean(deltaLink)
      ? new Date().toISOString()
      : cursorRow?.last_full_sync_at ?? null,
    last_incremental_sync_at: cursorRow && !failed && Boolean(deltaLink)
      ? new Date().toISOString()
      : cursorRow?.last_incremental_sync_at ?? null,
    last_error: failed ? `${failed} message(s) could not be processed.` : null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'connection_id,provider_folder_id' });
  if (cursorWriteError) throw cursorWriteError;
  await ensureOutlookSubscription(input);
  return { imported, duplicates, failed, hasMore: !failed && Boolean(url) };
}

async function outlookMessage(token: string, raw: any): Promise<NormalizedMessage> {
  let attachments: NormalizedAttachment[] = [];
  if (raw.hasAttachments) {
    // Listing fileAttachment objects without an explicit projection can return
    // contentBytes inline. Fetch metadata only, validate it, then stream each
    // allowed attachment through the bounded $value downloader below.
    const attachmentQuery = new URLSearchParams({
      '$top': '30',
      '$select': 'id,name,contentType,size,isInline',
    });
    const payload = await providerFetch(
      `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(raw.id)}/attachments?${attachmentQuery}`,
      token,
    );
    attachments = (Array.isArray(payload.value) ? payload.value : [])
      .filter((attachment: any) => !attachment.isInline)
      .map((attachment: any) => {
        const contentType = safe(attachment.contentType, 160).toLowerCase()
          || 'application/octet-stream';
        const size = Number(attachment.size || 0);
        const mayRead = attachmentMetadataAllowed(contentType, size);
        return {
          id: safe(attachment.id, 500),
          filename: safe(attachment.name, 300) || 'Attachment',
          contentType,
          size,
          download: mayRead
            ? async () => {
              const response = await fetch(
                `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(raw.id)}/attachments/${encodeURIComponent(attachment.id)}/$value`,
                { headers: { Authorization: `Bearer ${token}` } },
              );
              if (!response.ok) {
                throw new Error(`Outlook attachment download failed (${response.status}).`);
              }
              return readResponseBytesBounded(response, MAX_ATTACHMENT_BYTES);
            }
            : undefined,
        };
      });
  }
  const bodyContent = safe(raw?.body?.content, MAX_BODY_CHARS * 2);
  const html = String(raw?.body?.contentType || '').toLowerCase() === 'html';
  const senderAuthentication = providerSenderAuthentication(
    'outlook',
    Array.isArray(raw?.internetMessageHeaders) ? raw.internetMessageHeaders : [],
  );
  return {
    providerId: safe(raw.id, 1_000),
    providerEtag: safe(raw['@odata.etag'] || raw.changeKey, 1_000) || null,
    senderAuthenticated: Boolean(senderAuthentication),
    senderAuthentication,
    internetMessageId: safe(raw.internetMessageId, 1_000) || null,
    threadId: safe(raw.conversationId, 1_000) || null,
    sender: normalizeAddress(raw?.from?.emailAddress?.address || ''),
    subject: safe(raw.subject, 500) || '(No subject)',
    bodyText: (html ? stripHtml(bodyContent) : bodyContent).slice(0, MAX_BODY_CHARS),
    bodyHtmlPresent: html,
    receivedAt: safeTimestamp(raw.receivedDateTime) || new Date().toISOString(),
    attachments,
  };
}

async function ensureOutlookSubscription(input: {
  admin: Admin;
  connection: Connection;
  token: string;
  folderId: string;
  encryptionKey: string;
}) {
  const notificationUrl = Deno.env.get('MAILBOX_WEBHOOK_URL');
  const webhookSecret = Deno.env.get('MAILBOX_WEBHOOK_SECRET');
  if (!notificationUrl || !webhookSecret) return;
  const { data: cursor, error: cursorReadError } = await input.admin
    .from('mailbox_sync_cursors').select('*')
    .eq('connection_id', input.connection.id)
    .eq('provider_folder_id', input.folderId)
    .maybeSingle();
  if (cursorReadError) throw cursorReadError;
  if (
    cursor?.subscription_id
    && cursor?.subscription_expires_at
    && new Date(cursor.subscription_expires_at).getTime() > Date.now() + 24 * 3_600_000
  ) return;
  const clientState = (await sha256Hex(
    `${webhookSecret}|${input.connection.id}|${input.folderId}`,
  )).slice(0, 128);
  const encryptedClientState = await sealCalendarSecret(
    clientState,
    input.encryptionKey,
  );
  const expiresAt = new Date(Date.now() + 6.5 * 86_400_000).toISOString();
  if (cursor?.subscription_id) {
    const renewal = await fetch(
      `https://graph.microsoft.com/v1.0/subscriptions/${encodeURIComponent(cursor.subscription_id)}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${input.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ expirationDateTime: expiresAt }),
      },
    );
    if (renewal.ok) {
      const renewed = await renewal.json();
      const { error } = await input.admin.from('mailbox_sync_cursors').update({
        subscription_client_state_ciphertext: cursor.subscription_client_state_ciphertext
          || encryptedClientState,
        subscription_expires_at: safeTimestamp(renewed.expirationDateTime) || expiresAt,
        updated_at: new Date().toISOString(),
      }).eq('connection_id', input.connection.id).eq('provider_folder_id', input.folderId);
      if (error) throw error;
      return;
    }
    if (renewal.status !== 404 && renewal.status !== 410) {
      throw new Error(`Outlook subscription renewal failed (${renewal.status}).`);
    }
  }
  const response = await fetch('https://graph.microsoft.com/v1.0/subscriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      changeType: 'created',
      notificationUrl,
      lifecycleNotificationUrl: notificationUrl,
      resource: `me/mailFolders('${input.folderId.replace(/'/g, "''")}')/messages`,
      expirationDateTime: expiresAt,
      clientState,
    }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`Outlook subscription failed (${response.status}).`);
  const { error } = await input.admin.from('mailbox_sync_cursors').update({
    subscription_id: safe(payload.id, 1_000),
    subscription_resource: safe(payload.resource, 2_000)
      || `me/mailFolders('${input.folderId.replace(/'/g, "''")}')/messages`,
    subscription_client_state_ciphertext: encryptedClientState,
    subscription_expires_at: safeTimestamp(payload.expirationDateTime),
    updated_at: new Date().toISOString(),
  }).eq('connection_id', input.connection.id).eq('provider_folder_id', input.folderId);
  if (error) throw error;
}

async function ingestMessage(input: {
  admin: Admin;
  supabaseUrl: string;
  serviceKey: string;
  connection: Connection;
  inboxId: string;
  folderId: string;
  syncRunId: string;
  message: NormalizedMessage;
}) {
  const { message, connection, admin } = input;
  if (!message.providerId) throw new Error('Provider message ID is missing.');
  const providerEmailId = `${connection.provider}:${connection.id}:${message.providerId}`;
  const { data: duplicate, error: duplicateError } = await admin.from('inbound_items')
    .select('id, extraction_status')
    .eq('mailbox_connection_id', connection.id)
    .eq('provider_message_id', message.providerId)
    .maybeSingle();
  if (duplicateError) throw duplicateError;
  if (duplicate) {
    return reconcileExistingInboundItem(input, duplicate.id, duplicate.extraction_status);
  }

  const includedAttachments = connection.sync_policy?.includeAttachments === false
    ? []
    : message.attachments;
  const attachmentMetadata = includedAttachments.slice(0, 30).map((attachment) => ({
    id: attachment.id,
    filename: attachment.filename,
    content_type: attachment.contentType,
    size: attachment.size,
  }));
  const fingerprint = await sha256Hex([
    connection.household_id,
    message.internetMessageId || providerEmailId,
    message.sender || '',
    message.subject,
    message.bodyText,
  ].join('|'));
  const { data: item, error } = await admin.from('inbound_items').insert({
    household_id: connection.household_id,
    inbox_id: input.inboxId,
    mailbox_connection_id: connection.id,
    mailbox_sync_run_id: input.syncRunId,
    provider_folder_id: input.folderId,
    provider_thread_id: message.threadId,
    provider_message_id: message.providerId,
    provider_message_etag: message.providerEtag,
    provider_received_at: message.receivedAt,
    provider_sender_authenticated: message.senderAuthenticated,
    provider_sender_authentication: message.senderAuthentication,
    source: 'email',
    sender: message.sender,
    subject: message.subject,
    body_preview: message.bodyText.slice(0, 1_000),
    body_text: message.bodyText || null,
    body_html_present: message.bodyHtmlPresent,
    attachments: attachmentMetadata,
    provider_email_id: providerEmailId,
    message_id: message.internetMessageId,
    recipient: connection.provider_email,
    received_at: message.receivedAt,
    extracted_data: {
      provider: connection.provider,
      provider_thread_id: message.threadId,
      mailbox_connection_id: connection.id,
      requires_human_review: true,
    },
    status: 'needs_review',
    extraction_status: 'queued',
    content_fingerprint: fingerprint,
  }).select('id').single();
  if (error) {
    if (error.code === '23505') {
      const { data: providerDuplicate, error: providerDuplicateError } = await admin
        .from('inbound_items')
        .select('id, extraction_status')
        .eq('mailbox_connection_id', connection.id)
        .eq('provider_message_id', message.providerId)
        .maybeSingle();
      if (providerDuplicateError) throw providerDuplicateError;
      if (providerDuplicate) {
        return reconcileExistingInboundItem(
          input,
          providerDuplicate.id,
          providerDuplicate.extraction_status,
        );
      }
      const { data: contentDuplicate, error: contentDuplicateError } = await admin
        .from('inbound_items')
        .select('id')
        .eq('household_id', connection.household_id)
        .eq('content_fingerprint', fingerprint)
        .maybeSingle();
      if (contentDuplicateError) throw contentDuplicateError;
      if (contentDuplicate) return 'duplicate' as const;
    }
    throw error;
  }

  const attachmentResult = await storeAttachments(
    admin,
    connection,
    item.id,
    includedAttachments,
  );
  await notifyHouseholdAdults(admin, connection.household_id, item.id, message);
  await extractAndMaybeAutoExecute(input, item.id);
  if (attachmentResult.failed > 0) {
    throw new Error(`${attachmentResult.failed} attachment(s) could not be stored safely.`);
  }
  return 'imported' as const;
}

async function reconcileExistingInboundItem(
  input: {
    admin: Admin;
    supabaseUrl: string;
    serviceKey: string;
    connection: Connection;
    message: NormalizedMessage;
  },
  inboundItemId: string,
  currentExtractionStatus: unknown,
) {
  const attachments = input.connection.sync_policy?.includeAttachments === false
    ? []
    : input.message.attachments;
  const attachmentRetry = await retryIncompleteAttachments(
    input.admin,
    input.connection,
    inboundItemId,
    attachments,
  );
  let extractionStatus = String(currentExtractionStatus || 'queued');
  if (extractionStatus === 'processing') {
    extractionStatus = await resetStaleExtraction(input.admin, inboundItemId);
    if (extractionStatus === 'processing') {
      throw new Error(
        'Coh extraction is still processing. The mailbox cursor was preserved for a safe retry.',
      );
    }
  }
  if (extractionStatus === 'failed' || extractionStatus === 'queued') {
    await notifyHouseholdAdults(
      input.admin,
      input.connection.household_id,
      inboundItemId,
      input.message,
    );
    await extractAndMaybeAutoExecute(input, inboundItemId);
  }
  if (attachmentRetry.failed > 0) {
    throw new Error(`${attachmentRetry.failed} attachment(s) could not be stored safely.`);
  }
  return 'duplicate' as const;
}

async function resetStaleExtraction(
  admin: Admin,
  inboundItemId: string,
) {
  const { data: processing, error: processingError } = await admin
    .from('inbox_extractions')
    .select('id, created_at')
    .eq('inbound_item_id', inboundItemId)
    .eq('status', 'processing')
    .order('extraction_version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (processingError) throw processingError;
  const startedAt = processing?.created_at
    ? new Date(processing.created_at).getTime()
    : 0;
  if (startedAt > Date.now() - STALE_EXTRACTION_MINUTES * 60_000) {
    return 'processing';
  }
  if (processing?.id) {
    const { error } = await admin.from('inbox_extractions').update({
      status: 'failed',
      error_code: 'stale_processing_lease',
      error_message: 'The previous extraction did not finish and was safely re-queued.',
      completed_at: new Date().toISOString(),
    }).eq('id', processing.id).eq('status', 'processing');
    if (error) throw error;
  }
  const { error: itemError } = await admin.from('inbound_items').update({
    status: 'needs_review',
    extraction_status: 'queued',
    processing_error: 'The previous extraction timed out and was re-queued.',
  }).eq('id', inboundItemId).eq('extraction_status', 'processing');
  if (itemError) throw itemError;
  return 'queued';
}

async function retryIncompleteAttachments(
  admin: Admin,
  connection: Connection,
  itemId: string,
  attachments: NormalizedAttachment[],
) {
  if (!attachments.length) return { failed: 0 };
  const { data: attachmentRows, error } = await admin.from('inbound_attachments')
    .select('provider_attachment_id, status')
    .eq('inbound_item_id', itemId);
  if (error) throw error;
  const completeIds = new Set(
    (attachmentRows ?? [])
      .filter((row) => ['stored', 'rejected'].includes(String(row.status)))
      .map((row) => safe(row.provider_attachment_id, 500))
      .filter(Boolean),
  );
  const incomplete = attachments.filter((attachment) => !completeIds.has(attachment.id));
  if (!incomplete.length) return { failed: 0 };
  return storeAttachments(
    admin,
    connection,
    itemId,
    incomplete,
  );
}

async function extractAndMaybeAutoExecute(
  input: {
    admin: Admin;
    supabaseUrl: string;
    serviceKey: string;
    connection: Connection;
  },
  inboundItemId: string,
) {
  const extractionResponse = await fetch(`${input.supabaseUrl}/functions/v1/coh-extract`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ inboundItemId }),
  });
  if (!extractionResponse.ok) {
    const detail = await extractionResponse.text();
    throw new Error(`Coh extraction failed (${extractionResponse.status}): ${detail.slice(0, 300)}`);
  }
  if (extractionResponse.status === 202) {
    throw new Error(
      'Coh extraction is still processing. The mailbox cursor was preserved for a safe retry.',
    );
  }
  // Direct-mail suggestions always remain in Family Inbox review in this
  // release. Automatic calendar writes stay disabled until timezone,
  // authenticated-sender, and conflict controls complete security testing.
}

async function storeAttachments(
  admin: Admin,
  connection: Connection,
  itemId: string,
  attachments: NormalizedAttachment[],
) {
  let totalBytes = 0;
  let failed = 0;
  for (const attachment of attachments.slice(0, 30)) {
    const allowed = attachmentMetadataAllowed(attachment.contentType, attachment.size)
      && totalBytes + attachment.size <= MAX_TOTAL_ATTACHMENT_BYTES;
    if (!allowed) {
      const { error } = await admin.from('inbound_attachments').upsert({
        inbound_item_id: itemId,
        household_id: connection.household_id,
        provider_attachment_id: attachment.id || null,
        filename: safeFilename(attachment.filename),
        content_type: attachment.contentType,
        byte_size: Math.max(0, attachment.size),
        status: 'rejected',
        processing_error: allowedAttachmentTypes.has(attachment.contentType)
          ? 'Attachment exceeds the Family Inbox size limit.'
          : 'Attachment type is not supported by Family Inbox.',
        processed_at: new Date().toISOString(),
      }, { onConflict: 'inbound_item_id,provider_attachment_id' });
      if (error) throw error;
      continue;
    }
    try {
      const bytes = attachment.inlineData || await attachment.download?.();
      if (!bytes) throw new Error('Attachment content was unavailable.');
      if (bytes.byteLength > MAX_ATTACHMENT_BYTES || totalBytes + bytes.byteLength > MAX_TOTAL_ATTACHMENT_BYTES) {
        throw new Error('Downloaded attachment exceeds the Family Inbox size limit.');
      }
      totalBytes += bytes.byteLength;
      const safeAttachmentId = (await sha256Hex(
        attachment.id || `${attachment.filename}:${attachment.size}`,
      )).slice(0, 32);
      const storagePath = `${connection.household_id}/${itemId}/${safeAttachmentId}-${safeFilename(attachment.filename)}`;
      const { error: uploadError } = await admin.storage.from('family-inbox').upload(
        storagePath,
        bytes,
        { contentType: attachment.contentType, upsert: false },
      );
      if (uploadError && !String(uploadError.message).toLowerCase().includes('already exists')) {
        throw uploadError;
      }
      const { error } = await admin.from('inbound_attachments').upsert({
        inbound_item_id: itemId,
        household_id: connection.household_id,
        provider_attachment_id: attachment.id,
        filename: safeFilename(attachment.filename),
        content_type: attachment.contentType,
        byte_size: bytes.byteLength,
        sha256: await sha256Bytes(bytes),
        storage_path: storagePath,
        status: 'stored',
        processing_error: null,
      }, { onConflict: 'inbound_item_id,provider_attachment_id' });
      if (error) throw error;
    } catch (error) {
      failed += 1;
      const { error: stateError } = await admin.from('inbound_attachments').upsert({
        inbound_item_id: itemId,
        household_id: connection.household_id,
        provider_attachment_id: attachment.id || null,
        filename: safeFilename(attachment.filename),
        content_type: attachment.contentType,
        byte_size: Math.max(0, attachment.size),
        status: 'failed',
        processing_error: error instanceof Error ? error.message.slice(0, 1_000) : 'Attachment processing failed.',
        processed_at: new Date().toISOString(),
      }, { onConflict: 'inbound_item_id,provider_attachment_id' });
      if (stateError) throw stateError;
    }
  }
  return { failed };
}

async function notifyHouseholdAdults(
  admin: Admin,
  householdId: string,
  itemId: string,
  message: NormalizedMessage,
) {
  const { data: recipients, error: recipientError } = await admin
    .from('household_members').select('user_id, role')
    .eq('household_id', householdId)
    .in('role', ['owner', 'admin']);
  if (recipientError) throw recipientError;
  if (!recipients?.length) return;
  const { error } = await admin.from('notification_outbox').upsert(recipients.map((recipient) => ({
    household_id: householdId,
    recipient_user_id: recipient.user_id,
    inbound_item_id: itemId,
    category: 'family_inbox',
    title: 'Coh found a new family email',
    body: `${message.subject}${message.sender ? ` · ${message.sender}` : ''}`.slice(0, 180),
    deep_link: `coho://inbox/${itemId}`,
    payload: {
      screen: 'Family Inbox',
      inboxItemId: itemId,
      deepLink: `coho://inbox/${itemId}`,
    },
    dedupe_key: `inbox:${itemId}:received:${recipient.user_id}`,
  })), { onConflict: 'dedupe_key', ignoreDuplicates: true });
  if (error) throw error;
}

async function providerFetch(url: string, token: string, extraHeaders: Record<string, string> = {}) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, ...extraHeaders },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = safe(payload?.error?.code || payload?.error, 160)
      || `http_${response.status}`;
    const detail = safe(payload?.error?.message || payload?.error_description || payload?.error, 500);
    throw new Error(`${code}: ${detail || 'Provider mailbox request failed'} (${response.status})`);
  }
  return payload;
}

async function createSyncRun(admin: Admin, input: {
  connectionId: string;
  runType: string;
  startedAt: string;
}) {
  const { data, error } = await admin.from('mailbox_sync_runs').insert({
    connection_id: input.connectionId,
    run_type: input.runType,
    status: 'running',
    correlation_id: crypto.randomUUID(),
    started_at: input.startedAt,
  }).select('id').single();
  if (error) throw error;
  return String(data.id);
}

async function finishSyncRun(admin: Admin, input: {
  syncRunId: string;
  status: string;
  imported: number;
  duplicates: number;
  failed: number;
  error: string | null;
}) {
  try {
    await admin.from('mailbox_sync_runs').update({
      status: input.status,
      messages_scanned: input.imported + input.duplicates + input.failed,
      messages_imported: input.imported,
      messages_skipped: input.duplicates,
      error_code: input.failed ? 'message_processing_failed' : null,
      error_message: input.error?.slice(0, 1_000) || null,
      completed_at: new Date().toISOString(),
    }).eq('id', input.syncRunId);
  } catch {
    // Connection health remains authoritative even if operational telemetry fails.
  }
}

function providerSenderAuthentication(
  provider: Provider,
  headers: Array<Record<string, unknown>>,
) {
  const authenticationResults = headers
    .filter((header) => safe(header.name, 100).toLowerCase() === 'authentication-results')
    .map((header) => safe(header.value, 8_000).toLowerCase())
    .join('\n');
  if (!authenticationResults || !/\bdmarc=pass\b/.test(authenticationResults)) return null;
  if (
    provider === 'google'
    && /(?:^|[\s;])mx\.google\.com(?:[\s;]|$)/.test(authenticationResults)
  ) {
    return 'google_dmarc_pass';
  }
  if (provider === 'outlook' && /\bcompauth=pass\b/.test(authenticationResults)) {
    return 'microsoft_dmarc_compauth_pass';
  }
  return null;
}

function parseScopes(value: unknown, fallback: unknown) {
  const providerScopes = typeof value === 'string'
    ? value.split(/\s+/).map((scope) => scope.trim()).filter(Boolean)
    : [];
  if (providerScopes.length) return providerScopes;
  return Array.isArray(fallback)
    ? fallback.map((scope) => safe(scope, 500)).filter(Boolean)
    : [];
}

function shouldReauthorize(message: string) {
  return /\b(?:invalid_grant|invalid_token|interaction_required|consent_required)\b|reauthor|authorization expired|\(401\)/i
    .test(message);
}

type GoogleWorkCursor =
  | {
    phase: 'backfill';
    historyId: string;
    pageToken: string;
  }
  | {
    phase: 'history';
    startHistoryId: string;
    pageToken: string;
    latestHistoryId: string;
  };

function parseGoogleCursor(cursor: string | null): string | GoogleWorkCursor | null {
  if (!cursor) return null;
  if (!cursor.startsWith('{')) return cursor;
  try {
    const value = JSON.parse(cursor);
    if (
      value?.phase === 'backfill'
      && safe(value.historyId, 2_000)
      && safe(value.pageToken, 2_000)
    ) {
      return {
        phase: 'backfill',
        historyId: safe(value.historyId, 2_000),
        pageToken: safe(value.pageToken, 2_000),
      };
    }
    if (
      value?.phase === 'history'
      && safe(value.startHistoryId, 2_000)
      && safe(value.pageToken, 2_000)
      && safe(value.latestHistoryId, 2_000)
    ) {
      return {
        phase: 'history',
        startHistoryId: safe(value.startHistoryId, 2_000),
        pageToken: safe(value.pageToken, 2_000),
        latestHistoryId: safe(value.latestHistoryId, 2_000),
      };
    }
  } catch {
    return null;
  }
  return null;
}

function encodeGoogleCursor(cursor: GoogleWorkCursor) {
  return JSON.stringify(cursor);
}

function isGoogleWorkCursor(cursor: string | null) {
  return Boolean(cursor?.startsWith('{'));
}

function queueContinuation(supabaseUrl: string, serviceKey: string, connectionId: string) {
  const work = fetch(`${supabaseUrl}/functions/v1/mailbox-sync`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ connectionId, runType: 'incremental' }),
  }).then((response) => {
    if (!response.ok) {
      console.error('Mailbox continuation sync failed to queue', connectionId, response.status);
    }
  }).catch((error) =>
    console.error('Mailbox continuation sync could not be queued', connectionId, error));
  const edgeRuntime = (globalThis as any).EdgeRuntime;
  if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(work);
}

function normalizeAddress(value: string) {
  const match = value.toLowerCase().match(/<?([a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,})>?/i);
  return match?.[1] ?? null;
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
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function decodeBase64UrlText(value: string) {
  return new TextDecoder().decode(decodeBase64UrlBytes(value));
}

function decodeBase64UrlBytes(value: string) {
  return decodeBase64Bytes(value.replace(/-/g, '+').replace(/_/g, '/'));
}

function decodeBase64UrlBytesBounded(value: string, maxBytes: number) {
  return decodeBase64BytesBounded(
    value.replace(/-/g, '+').replace(/_/g, '/'),
    maxBytes,
  );
}

function decodeBase64BytesBounded(value: string, maxBytes: number) {
  const maximumEncodedLength = Math.ceil(maxBytes / 3) * 4 + 4;
  if (value.length > maximumEncodedLength) {
    throw new Error('Attachment content exceeds the Family Inbox size limit.');
  }
  const bytes = decodeBase64Bytes(value);
  if (bytes.byteLength > maxBytes) {
    throw new Error('Attachment content exceeds the Family Inbox size limit.');
  }
  return bytes;
}

function decodeBase64Bytes(value: string) {
  const padded = value.padEnd(value.length + ((4 - value.length % 4) % 4), '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function attachmentMetadataAllowed(contentType: string, size: number) {
  return allowedAttachmentTypes.has(contentType)
    && Number.isFinite(size)
    && size >= 0
    && size <= MAX_ATTACHMENT_BYTES;
}

async function readResponseBytesBounded(response: Response, maxBytes: number) {
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error('Attachment content exceeds the Family Inbox size limit.');
  }
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) {
      throw new Error('Attachment content exceeds the Family Inbox size limit.');
    }
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel('attachment_too_large');
        throw new Error('Attachment content exceeds the Family Inbox size limit.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function safeTimestamp(value: unknown) {
  if (typeof value !== 'string' || !value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function safeFilename(value: string) {
  return value
    .replace(/[/\\\u0000-\u001f\u007f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240) || 'Attachment';
}

async function sha256Bytes(value: Uint8Array) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', value));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
