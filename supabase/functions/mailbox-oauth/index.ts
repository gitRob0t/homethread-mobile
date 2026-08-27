import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import {
  openCalendarSecret,
  pkceChallenge,
  randomUrlToken,
  sealCalendarSecret,
  sha256Hex,
} from '../_shared/calendarCrypto.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Provider = 'google' | 'outlook';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function safe(value: unknown, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function isAllowedReturnUri(value: string) {
  const allowlist = (Deno.env.get('MAILBOX_RETURN_URI_ALLOWLIST') || '')
    .split(',')
    .map((uri) => uri.trim())
    .filter(Boolean);
  return allowlist.includes(value);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const directMailboxEnabled = Deno.env.get('ENABLE_DIRECT_MAILBOX') === 'true';
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const encryptionKey = Deno.env.get('MAILBOX_TOKEN_ENCRYPTION_KEY');

  if (request.method === 'GET') {
    if (!directMailboxEnabled) {
      return json({ error: 'Direct mailbox connections are not enabled.' }, 503);
    }
    if (!supabaseUrl || !serviceKey || !encryptionKey) {
      return json({ error: 'Direct mailbox connections are not configured.' }, 503);
    }
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    return finishOAuth(request, admin, supabaseUrl, serviceKey, encryptionKey);
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (!supabaseUrl || !anonKey) {
    return json({ error: 'Mailbox authentication is not configured.' }, 503);
  }

  const authorization = request.headers.get('Authorization');
  if (!authorization) return json({ error: 'Authentication required.' }, 401);
  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError || !authData.user) return json({ error: 'Invalid session.' }, 401);

  const body = await request.json().catch(() => ({}));
  const action = safe(body?.action, 40) || 'start';
  if (action === 'capabilities') {
    return json({
      enabled: directMailboxEnabled,
      providers: {
        google: directMailboxEnabled && Boolean(
          Deno.env.get('GOOGLE_MAIL_CLIENT_ID')
          && Deno.env.get('GOOGLE_MAIL_CLIENT_SECRET'),
        ),
        outlook: directMailboxEnabled && Boolean(
          Deno.env.get('MICROSOFT_MAIL_CLIENT_ID')
          && Deno.env.get('MICROSOFT_MAIL_CLIENT_SECRET'),
        ),
      },
    });
  }
  if (!directMailboxEnabled) {
    return json({ error: 'Direct mailbox connections are not enabled.' }, 503);
  }
  if (!serviceKey || !encryptionKey) {
    return json({ error: 'Direct mailbox connections are not configured.' }, 503);
  }
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  try {
    if (action === 'start') {
      const provider = providerValue(body?.provider);
      const householdId = safe(body?.householdId, 80);
      const returnUri = safe(body?.returnUri, 500) || `coho://mail-connected/${provider}`;
      if (!householdId || !isAllowedReturnUri(returnUri)) {
        return json({ error: 'A valid household and app return link are required.' }, 400);
      }

      const { data: membership } = await client.from('household_members').select('role')
        .eq('household_id', householdId)
        .eq('user_id', authData.user.id)
        .maybeSingle();
      if (!membership || !['owner', 'admin'].includes(String(membership.role))) {
        return json({ error: 'A household owner or admin must connect a mailbox.' }, 403);
      }
      const { data: inbox } = await client.from('household_inboxes').select('id')
        .eq('household_id', householdId)
        .maybeSingle();
      if (!inbox) {
        return json({ error: 'Create the Family Inbox before connecting a mailbox.' }, 409);
      }

      const config = providerConfig(provider);
      const state = randomUrlToken(32);
      const verifier = randomUrlToken(64);
      const redirectUri = `${supabaseUrl}/functions/v1/mailbox-oauth`;
      const { error } = await admin.from('mailbox_oauth_states').insert({
        state_hash: await sha256Hex(state),
        household_id: householdId,
        user_id: authData.user.id,
        provider,
        requested_scopes: config.scopes,
        code_verifier_ciphertext: await sealCalendarSecret(verifier, encryptionKey),
        redirect_uri: redirectUri,
        return_uri: returnUri,
      });
      if (error) throw error;

      const query = new URLSearchParams({
        client_id: config.clientId,
        response_type: 'code',
        redirect_uri: redirectUri,
        response_mode: 'query',
        scope: config.scopes.join(' '),
        state,
        code_challenge: await pkceChallenge(verifier),
        code_challenge_method: 'S256',
        prompt: provider === 'google' ? 'consent' : 'select_account',
      });
      if (provider === 'google') {
        query.set('access_type', 'offline');
        query.set('include_granted_scopes', 'true');
      }
      return json({ authorizationUrl: `${config.authorizationEndpoint}?${query}` });
    }

    const connectionId = safe(body?.connectionId, 80);
    const { data: connection } = await admin.from('mailbox_connections').select('*')
      .eq('id', connectionId)
      .eq('user_id', authData.user.id)
      .maybeSingle();
    if (!connection) return json({ error: 'Mailbox connection not found.' }, 404);

    const { data: currentMembership, error: currentMembershipError } = await admin
      .from('household_members')
      .select('role')
      .eq('household_id', connection.household_id)
      .eq('user_id', authData.user.id)
      .maybeSingle();
    if (currentMembershipError) throw currentMembershipError;
    const canManageMailbox = Boolean(
      currentMembership
      && ['owner', 'admin'].includes(String(currentMembership.role)),
    );

    if (action === 'settings') {
      if (!canManageMailbox) {
        return json({ error: 'A current household owner or admin must change mailbox settings.' }, 403);
      }
      const allowedModes = new Set(['inbox', 'selected_folders']);
      const mode = safe(body?.mode, 40) || 'inbox';
      if (!allowedModes.has(mode)) return json({ error: 'Unsupported mailbox sync mode.' }, 400);
      const requestedLookback = Number(
        body?.lookbackDays ?? connection.sync_policy?.lookbackDays ?? 0,
      );
      const lookbackDays = Number.isFinite(requestedLookback)
        ? Math.min(30, Math.max(0, Math.trunc(requestedLookback)))
        : 0;
      const rawSelectedFolderIds = Array.isArray(body?.selectedFolderIds)
        ? body.selectedFolderIds
        : [];
      if (rawSelectedFolderIds.length > 20) {
        return json({ error: 'Select no more than 20 mailbox folders.' }, 400);
      }
      const selectedFolderIds = [
        ...new Set(rawSelectedFolderIds.map((value: unknown) => safe(value, 500)).filter(Boolean)),
      ];
      if (selectedFolderIds.length > 20) {
        return json({ error: 'Select no more than 20 mailbox folders.' }, 400);
      }
      const folders = Array.isArray(connection.selected_folders)
        ? connection.selected_folders.map((folder: Record<string, unknown>) => ({
          ...folder,
          selected: mode === 'inbox'
            ? String(folder.kind || '').toLowerCase() === 'inbox'
            : selectedFolderIds.includes(String(folder.id)),
        }))
        : [];
      if (!folders.some((folder: Record<string, unknown>) => folder.selected === true)) {
        return json({ error: 'Select at least one mailbox folder before enabling sync.' }, 400);
      }
      const previousLookback = finiteLookback(connection.sync_policy?.lookbackDays);
      const syncEnabled = body?.syncEnabled !== false;
      const nextStatus = syncEnabled
        ? ['reauthorize', 'disconnected'].includes(String(connection.status))
          ? connection.status
          : 'active'
        : 'paused';
      const { error } = await admin.from('mailbox_connections').update({
        selected_folders: folders,
        sync_policy: {
          mode,
          lookbackDays,
          // Automatic writes remain disabled until authenticated-sender,
          // timezone, and calendar-conflict controls are production verified.
          autoAction: 'review',
          includeAttachments: body?.includeAttachments
            ?? connection.sync_policy?.includeAttachments
            ?? true,
        },
        sync_enabled: syncEnabled,
        status: nextStatus,
        last_error: syncEnabled && nextStatus === 'active' ? null : connection.last_error,
        updated_at: new Date().toISOString(),
      }).eq('id', connection.id);
      if (error) throw error;
      if (lookbackDays > previousLookback) {
        const { error: cursorResetError } = await admin.from('mailbox_sync_cursors').update({
          cursor: null,
          last_full_sync_at: null,
          last_incremental_sync_at: null,
          last_error: null,
          updated_at: new Date().toISOString(),
        }).eq('connection_id', connection.id);
        if (cursorResetError) throw cursorResetError;
      }
      if (!syncEnabled || nextStatus !== 'active') return json({ updated: true });
      const syncResult = await triggerSync(supabaseUrl, serviceKey, connection.id, 'manual');
      if (!syncResult.ok) {
        return json({
          error: syncResult.error || 'Mailbox settings were saved, but synchronization failed.',
          updated: true,
        }, 502);
      }
      return json({ updated: true });
    }

    if (action === 'disconnect') {
      const provider = providerValue(connection.provider);
      const accessToken = await openCalendarSecret(connection.access_token_ciphertext, encryptionKey);
      const refreshToken = connection.refresh_token_ciphertext
        ? await openCalendarSecret(connection.refresh_token_ciphertext, encryptionKey)
        : null;
      if (provider === 'outlook') {
        await deleteOutlookSubscriptions(admin, connection.id, accessToken).catch((error) =>
          console.error('Outlook subscription cleanup failed', connection.id, error));
      }
      await revokeToken(provider, refreshToken || accessToken).catch(() => undefined);
      const { error } = await admin.from('mailbox_connections').update({
        status: 'disconnected',
        sync_enabled: false,
        access_token_ciphertext: await sealCalendarSecret('', encryptionKey),
        refresh_token_ciphertext: null,
        updated_at: new Date().toISOString(),
      }).eq('id', connection.id);
      if (error) throw error;
      await admin.from('mailbox_sync_cursors').update({
        subscription_id: null,
        subscription_resource: null,
        subscription_client_state_ciphertext: null,
        subscription_expires_at: null,
        updated_at: new Date().toISOString(),
      }).eq('connection_id', connection.id);
      if (connection.source_id) {
        await admin.from('household_email_sources').update({
          status: 'setup_required',
          connection_method: 'forwarding',
          updated_at: new Date().toISOString(),
        }).eq('id', connection.source_id);
      }
      return json({ disconnected: true });
    }

    if (action === 'sync') {
      if (!canManageMailbox) {
        return json({ error: 'A current household owner or admin must sync this mailbox.' }, 403);
      }
      const result = await triggerSync(supabaseUrl, serviceKey, connection.id, 'manual');
      return result.ok
        ? json({ queued: true })
        : json({ error: result.error || 'Mailbox sync did not complete.' }, 502);
    }
    return json({ error: 'Unsupported mailbox action.' }, 400);
  } catch (error) {
    console.error('Mailbox OAuth action failed', error);
    return json({ error: error instanceof Error ? error.message : 'Mailbox action failed.' }, 400);
  }
});

async function finishOAuth(
  request: Request,
  admin: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceKey: string,
  encryptionKey: string,
) {
  const url = new URL(request.url);
  const state = safe(url.searchParams.get('state'), 200);
  const code = safe(url.searchParams.get('code'), 4_000);
  const providerError = safe(
    url.searchParams.get('error_description') || url.searchParams.get('error'),
    500,
  );
  if (!state) return oauthPage('Mailbox connection failed', 'The secure state was missing.', null, 400);

  const { data: savedState } = await admin.from('mailbox_oauth_states').select('*')
    .eq('state_hash', await sha256Hex(state))
    .is('consumed_at', null)
    .maybeSingle();
  if (!savedState || new Date(savedState.expires_at) <= new Date()) {
    return oauthPage('Mailbox connection expired', 'Return to Coho and start again.', null, 410);
  }
  if (providerError || !code) {
    await admin.from('mailbox_oauth_states').update({ consumed_at: new Date().toISOString() })
      .eq('state_hash', savedState.state_hash)
      .is('consumed_at', null);
    return oauthPage(
      'Mailbox permission was not granted',
      providerError || 'No authorization code was returned.',
      savedState.return_uri,
      400,
    );
  }

  try {
    const { data: consumedState, error: consumeError } = await admin
      .from('mailbox_oauth_states')
      .update({ consumed_at: new Date().toISOString() })
      .eq('state_hash', savedState.state_hash)
      .is('consumed_at', null)
      .select('state_hash')
      .maybeSingle();
    if (consumeError) throw consumeError;
    if (!consumedState) {
      return oauthPage(
        'Mailbox connection already used',
        'Return to Coho and start a new secure connection.',
        savedState.return_uri,
        409,
      );
    }

    const { data: membership, error: membershipError } = await admin
      .from('household_members')
      .select('role')
      .eq('household_id', savedState.household_id)
      .eq('user_id', savedState.user_id)
      .maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership || !['owner', 'admin'].includes(String(membership.role))) {
      return oauthPage(
        'Mailbox connection permission changed',
        'Only a current household owner or admin can finish connecting a mailbox. Return to Coho and start again.',
        savedState.return_uri,
        403,
      );
    }

    const provider = providerValue(savedState.provider);
    const config = providerConfig(provider);
    const verifier = await openCalendarSecret(savedState.code_verifier_ciphertext, encryptionKey);
    const tokenResponse = await fetch(config.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: savedState.redirect_uri,
        code_verifier: verifier,
        scope: config.scopes.join(' '),
      }),
    });
    const token = await tokenResponse.json();
    if (!tokenResponse.ok || !token.access_token) {
      throw new Error(
        safe(token.error_description || token.error, 500)
          || 'The provider rejected the authorization code.',
      );
    }

    const [account, providerFolders] = await Promise.all([
      providerAccount(provider, token.access_token),
      providerFolderList(provider, token.access_token),
    ]);
    if (!account.email) throw new Error('The provider did not return an email address.');

    const { data: existing } = await admin.from('mailbox_connections').select('*')
      .eq('user_id', savedState.user_id)
      .eq('provider', provider)
      .eq('provider_account_id', account.id)
      .maybeSingle();
    if (existing && existing.household_id !== savedState.household_id) {
      throw new Error(
        'This mailbox is already connected to another household. Disconnect it there before moving it.',
      );
    }
    const previousSelection = new Map(
      (Array.isArray(existing?.selected_folders) ? existing.selected_folders : [])
        .map((folder: Record<string, unknown>) => [String(folder.id), Boolean(folder.selected)]),
    );
    const folders = providerFolders.map((folder) => ({
      ...folder,
      selected: previousSelection.has(folder.id)
        ? previousSelection.get(folder.id)
        : folder.kind === 'inbox',
    }));
    const refreshCiphertext = token.refresh_token
      ? await sealCalendarSecret(token.refresh_token, encryptionKey)
      : existing?.refresh_token_ciphertext ?? null;
    if (!refreshCiphertext) {
      throw new Error('Offline mailbox access was not granted. Reconnect and approve background access.');
    }
    if (existing && provider === 'outlook') {
      await deleteOutlookSubscriptions(admin, existing.id, token.access_token).catch((error) =>
        console.error('Old Outlook subscription cleanup failed', existing.id, error));
      await admin.from('mailbox_sync_cursors').update({
        subscription_id: null,
        subscription_resource: null,
        subscription_client_state_ciphertext: null,
        subscription_expires_at: null,
        updated_at: new Date().toISOString(),
      }).eq('connection_id', existing.id);
    }

    const { data: source, error: sourceError } = await admin
      .from('household_email_sources')
      .upsert({
        household_id: savedState.household_id,
        created_by: savedState.user_id,
        email_address: account.email.toLowerCase(),
        provider: provider === 'outlook' ? 'microsoft' : 'google',
        connection_method: 'oauth',
        status: 'active',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'household_id,email_address' })
      .select('id')
      .single();
    if (sourceError) throw sourceError;

    const row = {
      household_id: savedState.household_id,
      user_id: savedState.user_id,
      source_id: source.id,
      provider,
      provider_account_id: account.id,
      provider_email: account.email.toLowerCase(),
      display_name: account.name || account.email,
      scopes: parseScopes(token.scope, existing?.scopes, config.scopes),
      status: 'active',
      access_token_ciphertext: await sealCalendarSecret(token.access_token, encryptionKey),
      refresh_token_ciphertext: refreshCiphertext,
      token_expires_at: new Date(Date.now() + Number(token.expires_in || 3600) * 1_000).toISOString(),
      selected_folders: folders,
      sync_policy: {
        mode: existing?.sync_policy?.mode === 'selected_folders'
          ? 'selected_folders'
          : 'inbox',
        lookbackDays: finiteLookback(existing?.sync_policy?.lookbackDays),
        autoAction: 'review',
        includeAttachments: existing?.sync_policy?.includeAttachments !== false,
      },
      sync_enabled: true,
      last_error: null,
      updated_at: new Date().toISOString(),
    };
    const { data: connection, error } = await admin.from('mailbox_connections')
      .upsert(row, { onConflict: 'user_id,provider,provider_account_id' })
      .select('id')
      .single();
    if (error) throw error;

    await admin.from('app_events').insert({
      household_id: savedState.household_id,
      user_id: savedState.user_id,
      event_name: 'mailbox_connected',
      properties: { provider, connectionId: connection.id },
    });

    const firstSync = await triggerSync(supabaseUrl, serviceKey, connection.id, 'initial');
    const syncOk = firstSync.ok;
    if (!syncOk) {
      await admin.from('mailbox_connections').update({
        status: 'error',
        last_error: firstSync.error,
        updated_at: new Date().toISOString(),
      }).eq('id', connection.id);
    }
    const returnUri = `${savedState.return_uri}${savedState.return_uri.includes('?') ? '&' : '?'}connectionId=${connection.id}`;
    return oauthPage(
      syncOk
        ? `${provider === 'google' ? 'Gmail' : 'Outlook'} connected`
        : `${provider === 'google' ? 'Gmail' : 'Outlook'} connected—sync needs attention`,
      syncOk
        ? 'Coh is reading only the mailbox scope you approved and placing extracted suggestions in Family Inbox review.'
        : 'The account grant succeeded, but the first sync did not. Return to Coho to retry safely.',
      returnUri,
      syncOk ? 200 : 202,
    );
  } catch (error) {
    console.error('Mailbox OAuth callback failed', error);
    return oauthPage(
      'Mailbox connection failed',
      error instanceof Error ? error.message : 'Try connecting again from Coho.',
      savedState.return_uri,
      400,
    );
  }
}

function providerValue(value: unknown): Provider {
  if (value === 'google' || value === 'outlook') return value;
  throw new Error('Unsupported mailbox provider.');
}

function finiteLookback(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed)
    ? Math.min(30, Math.max(0, Math.trunc(parsed)))
    : 0;
}

function providerConfig(provider: Provider) {
  if (provider === 'google') {
    const clientId = Deno.env.get('GOOGLE_MAIL_CLIENT_ID');
    const clientSecret = Deno.env.get('GOOGLE_MAIL_CLIENT_SECRET');
    if (!clientId || !clientSecret) throw new Error('Gmail OAuth credentials are not configured.');
    return {
      clientId,
      clientSecret,
      authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenEndpoint: 'https://oauth2.googleapis.com/token',
      scopes: [
        'openid',
        'email',
        'profile',
        'https://www.googleapis.com/auth/gmail.readonly',
      ],
    };
  }
  const clientId = Deno.env.get('MICROSOFT_MAIL_CLIENT_ID');
  const clientSecret = Deno.env.get('MICROSOFT_MAIL_CLIENT_SECRET');
  if (!clientId || !clientSecret) throw new Error('Outlook Mail OAuth credentials are not configured.');
  return {
    clientId,
    clientSecret,
    authorizationEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: ['openid', 'email', 'profile', 'offline_access', 'User.Read', 'Mail.Read'],
  };
}

async function providerAccount(provider: Provider, token: string) {
  const endpoint = provider === 'google'
    ? 'https://openidconnect.googleapis.com/v1/userinfo'
    : 'https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName';
  const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } });
  const payload = await response.json();
  if (!response.ok) throw new Error('The connected mailbox profile could not be read.');
  return provider === 'google'
    ? { id: String(payload.sub), email: safe(payload.email, 320), name: safe(payload.name, 200) }
    : {
      id: String(payload.id),
      email: safe(payload.mail || payload.userPrincipalName, 320),
      name: safe(payload.displayName, 200),
    };
}

async function providerFolderList(provider: Provider, token: string) {
  if (provider === 'google') {
    const response = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/labels',
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const payload = await response.json();
    if (!response.ok) throw new Error('Gmail labels could not be read.');
    return (Array.isArray(payload.labels) ? payload.labels : [])
      .filter((label: Record<string, unknown>) =>
        label.labelListVisibility !== 'labelHide' || label.id === 'INBOX')
      .slice(0, 100)
      .map((label: Record<string, unknown>) => ({
        id: String(label.id),
        name: safe(label.name, 300) || 'Label',
        kind: label.id === 'INBOX' ? 'inbox' : 'label',
      }));
  }
  const [folderResponse, inboxResponse] = await Promise.all([
    fetch(
      'https://graph.microsoft.com/v1.0/me/mailFolders?$top=100&includeHiddenFolders=false&$select=id,displayName,parentFolderId',
      { headers: { Authorization: `Bearer ${token}` } },
    ),
    fetch(
      'https://graph.microsoft.com/v1.0/me/mailFolders/inbox?$select=id,displayName,parentFolderId',
      { headers: { Authorization: `Bearer ${token}` } },
    ),
  ]);
  const [payload, inbox] = await Promise.all([
    folderResponse.json(),
    inboxResponse.json(),
  ]);
  if (!folderResponse.ok || !inboxResponse.ok) {
    throw new Error('Outlook folders could not be read.');
  }
  const inboxId = safe(inbox?.id, 1_000);
  return (Array.isArray(payload.value) ? payload.value : []).map(
    (folder: Record<string, unknown>) => ({
      id: String(folder.id),
      name: safe(folder.displayName, 300) || 'Folder',
      kind: String(folder.id) === inboxId ? 'inbox' : 'folder',
    }),
  );
}

async function triggerSync(
  supabaseUrl: string,
  serviceKey: string,
  connectionId: string,
  runType: 'initial' | 'manual',
) {
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/mailbox-sync`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectionId, runType }),
    });
    const payload = await response.json().catch(() => ({}));
    const results = Array.isArray(payload?.results) ? payload.results : [];
    const payloadSucceeded = payload?.ok === true
      && results.length > 0
      && results.every((result: Record<string, unknown>) => result?.ok === true);
    const firstResultError = results
      .map((result: Record<string, unknown>) => safe(result?.error, 500))
      .find(Boolean);
    const ok = response.ok && payloadSucceeded;
    return {
      ok,
      error: ok
        ? null
        : safe(payload?.error, 500)
          || firstResultError
          || `Mailbox sync did not complete (${response.status}).`,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Mailbox sync failed.' };
  }
}

async function revokeToken(provider: Provider, token: string) {
  if (!token || provider !== 'google') return;
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
}

function parseScopes(value: unknown, existing: unknown, fallback: string[]) {
  const tokenScopes = typeof value === 'string'
    ? value.split(/\s+/).map((scope) => scope.trim()).filter(Boolean)
    : [];
  if (tokenScopes.length) return tokenScopes;
  if (Array.isArray(existing)) {
    const existingScopes = existing.map((scope) => safe(scope, 500)).filter(Boolean);
    if (existingScopes.length) return existingScopes;
  }
  return fallback;
}

async function deleteOutlookSubscriptions(
  admin: ReturnType<typeof createClient>,
  connectionId: string,
  accessToken: string,
) {
  const { data: cursors } = await admin.from('mailbox_sync_cursors')
    .select('subscription_id')
    .eq('connection_id', connectionId)
    .not('subscription_id', 'is', null);
  for (const cursor of cursors ?? []) {
    const subscriptionId = safe(cursor.subscription_id, 1_000);
    if (!subscriptionId) continue;
    const response = await fetch(
      `https://graph.microsoft.com/v1.0/subscriptions/${encodeURIComponent(subscriptionId)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    if (!response.ok && response.status !== 404 && response.status !== 410) {
      console.error('Outlook subscription deletion failed', subscriptionId, response.status);
    }
  }
}

function oauthPage(title: string, detail: string, returnUri: string | null, status = 200) {
  const esc = (value: string) => value.replace(/[&<>"']/g, (character) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character]!,
  );
  const scriptReturnUri = returnUri
    ? JSON.stringify(returnUri)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029')
    : null;
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0e1728;color:#fff;font:16px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif}main{max-width:540px;margin:22px;padding:34px;border-radius:28px;border:1px solid #34415b;background:#172238;text-align:center}.icon{width:72px;height:72px;border-radius:24px;background:linear-gradient(135deg,#2257f4,#7047ee);display:grid;place-items:center;margin:auto;font-size:34px}h1{font-size:29px}.muted{color:#b8c1d3;line-height:1.55}a{display:block;margin-top:24px;padding:15px;border-radius:15px;background:#fff;color:#182033;text-decoration:none;font-weight:800}</style></head>
<body><main><div class="icon">✓</div><h1>${esc(title)}</h1><p class="muted">${esc(detail)}</p>${returnUri ? `<a href="${esc(returnUri)}">Return to Coho</a>` : ''}</main>
${scriptReturnUri ? `<script>setTimeout(()=>location.href=${scriptReturnUri},700)</script>` : ''}</body></html>`, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
    },
  });
}
