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

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const encryptionKey = Deno.env.get('CALENDAR_TOKEN_ENCRYPTION_KEY');
  if (!supabaseUrl || !anonKey || !serviceKey || !encryptionKey) {
    return json({ error: 'Calendar connections are not configured.' }, 503);
  }
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  if (request.method === 'GET') {
    return finishOAuth(request, admin, supabaseUrl, serviceKey, encryptionKey);
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const authorization = request.headers.get('Authorization');
  if (!authorization) return json({ error: 'Authentication required.' }, 401);
  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError || !authData.user) return json({ error: 'Invalid session.' }, 401);

  try {
    const body = await request.json();
    const action = safe(body?.action, 40) || 'start';
    if (action === 'start') {
      const provider = providerValue(body?.provider);
      const householdId = safe(body?.householdId, 80);
      const returnUri = safe(body?.returnUri, 500) || `coho://calendar-connected/${provider}`;
      if (!householdId || !/^(?:coho|homethread):\/\//i.test(returnUri)) {
        return json({ error: 'A valid household and app return link are required.' }, 400);
      }
      const { data: membership } = await client.from('household_members').select('role')
        .eq('household_id', householdId).eq('user_id', authData.user.id).maybeSingle();
      if (!membership) return json({ error: 'Household access denied.' }, 403);

      const config = providerConfig(provider);
      const state = randomUrlToken(32);
      const verifier = randomUrlToken(64);
      const redirectUri = `${supabaseUrl}/functions/v1/calendar-oauth`;
      const { error } = await admin.from('calendar_oauth_states').insert({
        state_hash: await sha256Hex(state),
        household_id: householdId,
        user_id: authData.user.id,
        provider,
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
    const { data: connection } = await admin.from('calendar_connections').select('*')
      .eq('id', connectionId).eq('user_id', authData.user.id).maybeSingle();
    if (!connection) return json({ error: 'Calendar connection not found.' }, 404);
    if (action === 'settings') {
      const selected = new Set(
        Array.isArray(body?.selectedCalendarIds)
          ? body.selectedCalendarIds.map((id: unknown) => safe(id, 500)).filter(Boolean)
          : [],
      );
      const calendars = Array.isArray(connection.selected_calendars)
        ? connection.selected_calendars.map((calendar: any) => ({
          ...calendar,
          selected: selected.has(String(calendar.id)),
        }))
        : [];
      const defaultWriteCalendarId = safe(body?.defaultWriteCalendarId, 500) || null;
      if (defaultWriteCalendarId && !calendars.some((calendar: any) =>
        String(calendar.id) === defaultWriteCalendarId && calendar.canWrite !== false)) {
        return json({ error: 'Choose a writable calendar from this connected account.' }, 400);
      }
      const { error } = await admin.from('calendar_connections').update({
        selected_calendars: calendars,
        default_write_calendar_id: defaultWriteCalendarId,
        sync_enabled: body?.syncEnabled !== false,
        updated_at: new Date().toISOString(),
      }).eq('id', connection.id);
      if (error) throw error;
      await triggerSync(supabaseUrl, serviceKey, connection.id);
      return json({ updated: true });
    }
    if (action === 'disconnect') {
      const token = await openCalendarSecret(connection.access_token_ciphertext, encryptionKey);
      await revokeToken(connection.provider, token).catch(() => undefined);
      const { error } = await admin.from('calendar_connections').update({
        status: 'disconnected',
        sync_enabled: false,
        access_token_ciphertext: await sealCalendarSecret('', encryptionKey),
        refresh_token_ciphertext: null,
        updated_at: new Date().toISOString(),
      }).eq('id', connection.id);
      if (error) throw error;
      return json({ disconnected: true });
    }
    if (action === 'sync') {
      await triggerSync(supabaseUrl, serviceKey, connection.id);
      return json({ queued: true });
    }
    return json({ error: 'Unsupported calendar action.' }, 400);
  } catch (error) {
    console.error('Calendar OAuth action failed', error);
    return json({ error: error instanceof Error ? error.message : 'Calendar action failed.' }, 400);
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
  const providerError = safe(url.searchParams.get('error_description') || url.searchParams.get('error'), 500);
  if (!state) return oauthPage('Calendar connection failed', 'The secure state was missing.', null, 400);
  const { data: savedState } = await admin.from('calendar_oauth_states').select('*')
    .eq('state_hash', await sha256Hex(state)).is('consumed_at', null).maybeSingle();
  if (!savedState || new Date(savedState.expires_at) <= new Date()) {
    return oauthPage('Calendar connection expired', 'Return to Coho and start again.', null, 410);
  }
  if (providerError || !code) {
    return oauthPage('Calendar permission was not granted', providerError || 'No authorization code was returned.', savedState.return_uri, 400);
  }
  try {
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
      throw new Error(safe(token.error_description || token.error, 500) || 'The provider rejected the authorization code.');
    }
    const [account, providerCalendars] = await Promise.all([
      providerAccount(provider, token.access_token),
      providerCalendarList(provider, token.access_token),
    ]);
    const { data: existing } = await admin.from('calendar_connections').select('*')
      .eq('user_id', savedState.user_id)
      .eq('provider', provider)
      .eq('provider_account_id', account.id)
      .maybeSingle();
    const previousSelection = new Map(
      (Array.isArray(existing?.selected_calendars) ? existing.selected_calendars : [])
        .map((calendar: any) => [String(calendar.id), Boolean(calendar.selected)]),
    );
    const calendars = providerCalendars.map((calendar: any) => ({
      ...calendar,
      selected: previousSelection.has(String(calendar.id))
        ? previousSelection.get(String(calendar.id))
        : Boolean(calendar.primary),
    }));
    const refreshCiphertext = token.refresh_token
      ? await sealCalendarSecret(token.refresh_token, encryptionKey)
      : existing?.refresh_token_ciphertext ?? null;
    const row = {
      household_id: savedState.household_id,
      user_id: savedState.user_id,
      provider,
      provider_account_id: account.id,
      provider_email: account.email,
      display_name: account.name || account.email,
      scopes: String(token.scope || '').split(/\s+/).filter(Boolean),
      status: 'active',
      access_token_ciphertext: await sealCalendarSecret(token.access_token, encryptionKey),
      refresh_token_ciphertext: refreshCiphertext,
      token_expires_at: new Date(Date.now() + Number(token.expires_in || 3600) * 1_000).toISOString(),
      selected_calendars: calendars,
      default_write_calendar_id: existing?.default_write_calendar_id
        || calendars.find((calendar: any) => calendar.primary && calendar.canWrite)?.id
        || null,
      sync_enabled: true,
      last_error: null,
      updated_at: new Date().toISOString(),
    };
    const { data: connection, error } = await admin.from('calendar_connections')
      .upsert(row, { onConflict: 'user_id,provider,provider_account_id' })
      .select('id')
      .single();
    if (error) throw error;
    await Promise.all([
      admin.from('calendar_oauth_states').update({ consumed_at: new Date().toISOString() })
        .eq('state_hash', savedState.state_hash),
      admin.from('member_onboarding_state').upsert({
        household_id: savedState.household_id,
        user_id: savedState.user_id,
        calendar_completed: true,
        last_active_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'household_id,user_id' }),
      admin.from('app_events').insert({
        household_id: savedState.household_id,
        user_id: savedState.user_id,
        event_name: 'calendar_connected',
        properties: { provider, connectionId: connection.id },
      }),
    ]);
    await triggerSync(supabaseUrl, serviceKey, connection.id);
    const returnUri = `${savedState.return_uri}${savedState.return_uri.includes('?') ? '&' : '?'}connectionId=${connection.id}`;
    return oauthPage(
      `${provider === 'google' ? 'Google' : 'Outlook'} Calendar connected`,
      'Coho is syncing the calendars you approved. You can close this window.',
      returnUri,
    );
  } catch (error) {
    console.error('Calendar OAuth callback failed', error);
    return oauthPage(
      'Calendar connection failed',
      error instanceof Error ? error.message : 'Try connecting again from Coho.',
      savedState.return_uri,
      400,
    );
  }
}

function providerValue(value: unknown): Provider {
  if (value === 'google' || value === 'outlook') return value;
  throw new Error('Unsupported calendar provider.');
}

function providerConfig(provider: Provider) {
  if (provider === 'google') {
    const clientId = Deno.env.get('GOOGLE_CALENDAR_CLIENT_ID');
    const clientSecret = Deno.env.get('GOOGLE_CALENDAR_CLIENT_SECRET');
    if (!clientId || !clientSecret) throw new Error('Google Calendar credentials are not configured.');
    return {
      clientId,
      clientSecret,
      authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenEndpoint: 'https://oauth2.googleapis.com/token',
      scopes: [
        'openid',
        'email',
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
      ],
    };
  }
  const clientId = Deno.env.get('MICROSOFT_CALENDAR_CLIENT_ID');
  const clientSecret = Deno.env.get('MICROSOFT_CALENDAR_CLIENT_SECRET');
  if (!clientId || !clientSecret) throw new Error('Outlook Calendar credentials are not configured.');
  return {
    clientId,
    clientSecret,
    authorizationEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: ['openid', 'email', 'profile', 'offline_access', 'User.Read', 'Calendars.ReadWrite'],
  };
}

async function providerAccount(provider: Provider, token: string) {
  const endpoint = provider === 'google'
    ? 'https://openidconnect.googleapis.com/v1/userinfo'
    : 'https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName';
  const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } });
  const payload = await response.json();
  if (!response.ok) throw new Error('The connected account profile could not be read.');
  return provider === 'google'
    ? { id: String(payload.sub), email: safe(payload.email, 320), name: safe(payload.name, 200) }
    : {
      id: String(payload.id),
      email: safe(payload.mail || payload.userPrincipalName, 320),
      name: safe(payload.displayName, 200),
    };
}

async function providerCalendarList(provider: Provider, token: string) {
  const endpoint = provider === 'google'
    ? 'https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader&maxResults=250'
    : 'https://graph.microsoft.com/v1.0/me/calendars?$top=200&$select=id,name,color,canEdit,isDefaultCalendar';
  const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } });
  const payload = await response.json();
  if (!response.ok) throw new Error('The provider calendar list could not be read.');
  const values = Array.isArray(payload.items) ? payload.items : Array.isArray(payload.value) ? payload.value : [];
  return values.map((calendar: any) => provider === 'google'
    ? {
      id: String(calendar.id),
      name: safe(calendar.summary, 300) || 'Calendar',
      color: calendar.backgroundColor || '#2257F4',
      primary: Boolean(calendar.primary),
      canWrite: ['writer', 'owner'].includes(calendar.accessRole),
    }
    : {
      id: String(calendar.id),
      name: safe(calendar.name, 300) || 'Calendar',
      color: calendar.color || '#2257F4',
      primary: Boolean(calendar.isDefaultCalendar),
      canWrite: calendar.canEdit !== false,
    });
}

async function triggerSync(supabaseUrl: string, serviceKey: string, connectionId: string) {
  const promise = fetch(`${supabaseUrl}/functions/v1/calendar-sync`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ connectionId }),
  }).catch((error) => console.error('Calendar sync trigger failed', error));
  const edgeRuntime = (globalThis as any).EdgeRuntime;
  if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(promise);
  else await promise;
}

async function revokeToken(provider: Provider, token: string) {
  if (!token) return;
  if (provider === 'google') {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  }
  // Microsoft does not expose a generic OAuth token-revocation endpoint for
  // consumer Graph connections. Disconnect still deletes the encrypted local
  // grant; users can separately revoke Coho from their Microsoft account.
}

function oauthPage(title: string, detail: string, returnUri: string | null, status = 200) {
  const esc = (value: string) => value.replace(/[&<>"']/g, (character) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character]!,
  );
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0e1728;color:#fff;font:16px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif}main{max-width:520px;margin:22px;padding:34px;border-radius:28px;border:1px solid #34415b;background:#172238;text-align:center}.icon{width:72px;height:72px;border-radius:24px;background:linear-gradient(135deg,#2257f4,#7047ee);display:grid;place-items:center;margin:auto;font-size:34px}h1{font-size:29px}.muted{color:#b8c1d3;line-height:1.55}a{display:block;margin-top:24px;padding:15px;border-radius:15px;background:#fff;color:#182033;text-decoration:none;font-weight:800}</style></head>
<body><main><div class="icon">✓</div><h1>${esc(title)}</h1><p class="muted">${esc(detail)}</p>${returnUri ? `<a href="${esc(returnUri)}">Return to Coho</a>` : ''}</main>
${returnUri ? `<script>setTimeout(()=>location.href=${JSON.stringify(returnUri)},500)</script>` : ''}</body></html>`, {
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
