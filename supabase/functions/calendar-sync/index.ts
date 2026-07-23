import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import {
  openCalendarSecret,
  sealCalendarSecret,
} from '../_shared/calendarCrypto.ts';

type Provider = 'google' | 'outlook';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};
type NormalizedEvent = {
  id: string;
  title: string;
  details: string | null;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  location: string | null;
  recurrenceRule: string | null;
  recurrence: Record<string, unknown> | null;
  etag: string | null;
  updatedAt: string | null;
  deleted: boolean;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const encryptionKey = Deno.env.get('CALENDAR_TOKEN_ENCRYPTION_KEY');
  if (!supabaseUrl || !anonKey || !serviceKey || !encryptionKey) {
    return json({ error: 'Calendar sync is not configured.' }, 503);
  }
  const authorization = request.headers.get('Authorization');
  const cronSecret = Deno.env.get('CRON_SECRET');
  const isService = authorization === `Bearer ${serviceKey}`
    || Boolean(cronSecret && request.headers.get('x-cron-secret') === cronSecret);
  let callerId: string | null = null;
  if (!isService) {
    if (!authorization) return json({ error: 'Authentication required.' }, 401);
    const client = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return json({ error: 'Invalid session.' }, 401);
    callerId = data.user.id;
  }
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  try {
    const body = await request.json().catch(() => ({}));
    if (body?.action === 'resolve_conflict') {
      if (!callerId) return json({ error: 'A household member must resolve calendar conflicts.' }, 401);
      const resolution = String(body?.resolution || '');
      if (!['keep_local', 'keep_provider'].includes(resolution)) {
        return json({ error: 'Choose either the Coho version or the connected calendar version.' }, 400);
      }
      const result = await resolveConflict(
        admin,
        String(body?.conflictId || ''),
        resolution as 'keep_local' | 'keep_provider',
        callerId,
        encryptionKey,
      );
      return json(result);
    }
    let query = admin.from('calendar_connections').select('*')
      .eq('status', 'active').eq('sync_enabled', true);
    if (body?.connectionId) query = query.eq('id', String(body.connectionId));
    if (callerId) query = query.eq('user_id', callerId);
    const { data: connections, error } = await query.limit(body?.connectionId ? 1 : 25);
    if (error) throw error;
    const results = [];
    for (const connection of connections ?? []) {
      try {
        const result = await syncConnection(admin, connection, encryptionKey);
        results.push({ connectionId: connection.id, ok: true, ...result });
      } catch (connectionError) {
        const message = connectionError instanceof Error ? connectionError.message : 'Calendar sync failed.';
        console.error('Calendar connection sync failed', connection.id, message);
        await admin.from('calendar_connections').update({
          status: /reauthorize|refresh token|invalid_grant/i.test(message) ? 'reauthorize' : 'error',
          last_error: message.slice(0, 1_000),
          updated_at: new Date().toISOString(),
        }).eq('id', connection.id);
        results.push({ connectionId: connection.id, ok: false, error: message });
      }
    }
    return json({ results });
  } catch (error) {
    console.error('Calendar sync job failed', error);
    return json({ error: error instanceof Error ? error.message : 'Calendar sync failed.' }, 500);
  }
});

async function syncConnection(
  admin: ReturnType<typeof createClient>,
  connection: any,
  encryptionKey: string,
) {
  const provider = connection.provider as Provider;
  const token = await validAccessToken(admin, connection, encryptionKey);
  const selected = (Array.isArray(connection.selected_calendars) ? connection.selected_calendars : [])
    .filter((calendar: any) => calendar.selected);
  let imported = 0;
  let deleted = 0;
  let conflicts = 0;
  for (const calendar of selected) {
    const result = provider === 'google'
      ? await syncGoogleCalendar(admin, connection, token, calendar)
      : await syncOutlookCalendar(admin, connection, token, calendar);
    imported += result.imported;
    deleted += result.deleted;
    conflicts += result.conflicts;
  }
  const exported = await syncCohoEventsOut(admin, connection, token);
  await admin.from('calendar_connections').update({
    status: 'active',
    last_synced_at: new Date().toISOString(),
    last_error: null,
    updated_at: new Date().toISOString(),
  }).eq('id', connection.id);
  return { imported, exported, deleted, conflicts };
}

async function validAccessToken(
  admin: ReturnType<typeof createClient>,
  connection: any,
  encryptionKey: string,
) {
  if (connection.token_expires_at
    && new Date(connection.token_expires_at).getTime() > Date.now() + 5 * 60_000) {
    return openCalendarSecret(connection.access_token_ciphertext, encryptionKey);
  }
  if (!connection.refresh_token_ciphertext) throw new Error('Calendar connection requires reauthorization.');
  const refreshToken = await openCalendarSecret(connection.refresh_token_ciphertext, encryptionKey);
  const provider = connection.provider as Provider;
  const config = providerConfig(provider);
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  if (provider === 'outlook') body.set('scope', config.scopes.join(' '));
  const response = await fetch(config.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const payload = await response.json();
  if (!response.ok || !payload.access_token) {
    throw new Error(`Calendar refresh token was rejected: ${payload.error_description || payload.error || response.status}`);
  }
  const nextRefresh = payload.refresh_token || refreshToken;
  await admin.from('calendar_connections').update({
    access_token_ciphertext: await sealCalendarSecret(payload.access_token, encryptionKey),
    refresh_token_ciphertext: await sealCalendarSecret(nextRefresh, encryptionKey),
    token_expires_at: new Date(Date.now() + Number(payload.expires_in || 3600) * 1_000).toISOString(),
    status: 'active',
    updated_at: new Date().toISOString(),
  }).eq('id', connection.id);
  connection.access_token_ciphertext = await sealCalendarSecret(payload.access_token, encryptionKey);
  connection.refresh_token_ciphertext = await sealCalendarSecret(nextRefresh, encryptionKey);
  connection.token_expires_at = new Date(Date.now() + Number(payload.expires_in || 3600) * 1_000).toISOString();
  return payload.access_token as string;
}

async function syncGoogleCalendar(
  admin: ReturnType<typeof createClient>,
  connection: any,
  token: string,
  calendar: any,
  retryFullSync = true,
) {
  const calendarId = String(calendar.id);
  const { data: savedCursor } = await admin.from('calendar_sync_cursors').select('*')
    .eq('connection_id', connection.id).eq('provider_calendar_id', calendarId).maybeSingle();
  const window = syncWindow();
  let nextUrl: string;
  if (savedCursor?.cursor) {
    const query = new URLSearchParams({
      syncToken: savedCursor.cursor,
      singleEvents: 'true',
      showDeleted: 'true',
      maxResults: '2500',
    });
    nextUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${query}`;
  } else {
    const query = new URLSearchParams({
      timeMin: window.start,
      timeMax: window.end,
      singleEvents: 'true',
      showDeleted: 'true',
      maxResults: '2500',
    });
    nextUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${query}`;
  }
  let imported = 0;
  let deleted = 0;
  let conflicts = 0;
  let nextSyncToken: string | null = null;
  for (let page = 0; nextUrl && page < 50; page += 1) {
    const response = await fetch(nextUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (response.status === 410 && retryFullSync) {
      await admin.from('calendar_sync_cursors').delete()
        .eq('connection_id', connection.id).eq('provider_calendar_id', calendarId);
      return syncGoogleCalendar(admin, connection, token, calendar, false);
    }
    const payload = await response.json();
    if (!response.ok) throw new Error(`Google Calendar sync failed: ${payload.error?.message || response.status}`);
    for (const item of payload.items ?? []) {
      const result = await applyProviderEvent(
        admin,
        connection,
        calendarId,
        normalizeGoogleEvent(item),
      );
      if (result === 'deleted') deleted += 1;
      else if (result === 'conflict') conflicts += 1;
      else if (result === 'imported') imported += 1;
    }
    nextSyncToken = payload.nextSyncToken || nextSyncToken;
    nextUrl = payload.nextPageToken
      ? `${nextUrl.split('&pageToken=')[0]}&pageToken=${encodeURIComponent(payload.nextPageToken)}`
      : '';
  }
  if (nextSyncToken) {
    await admin.from('calendar_sync_cursors').upsert({
      connection_id: connection.id,
      provider_calendar_id: calendarId,
      cursor: nextSyncToken,
      window_start: window.start,
      window_end: window.end,
      last_full_sync_at: savedCursor?.cursor ? savedCursor.last_full_sync_at : new Date().toISOString(),
      last_incremental_sync_at: savedCursor?.cursor ? new Date().toISOString() : null,
      last_error: null,
      updated_at: new Date().toISOString(),
    });
  }
  return { imported, deleted, conflicts };
}

async function syncOutlookCalendar(
  admin: ReturnType<typeof createClient>,
  connection: any,
  token: string,
  calendar: any,
) {
  const calendarId = String(calendar.id);
  const { data: savedCursor } = await admin.from('calendar_sync_cursors').select('*')
    .eq('connection_id', connection.id).eq('provider_calendar_id', calendarId).maybeSingle();
  const window = syncWindow();
  let nextUrl = savedCursor?.cursor || (
    `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(calendarId)}/calendarView/delta?`
    + new URLSearchParams({
      startDateTime: window.start,
      endDateTime: window.end,
      '$select': 'id,subject,bodyPreview,start,end,isAllDay,location,recurrence,lastModifiedDateTime,changeKey',
      '$top': '500',
    })
  );
  let imported = 0;
  let deleted = 0;
  let conflicts = 0;
  let deltaLink: string | null = null;
  for (let page = 0; nextUrl && page < 50; page += 1) {
    const response = await fetch(nextUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Prefer: 'outlook.timezone="UTC"',
      },
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(`Outlook Calendar sync failed: ${payload.error?.message || response.status}`);
    for (const item of payload.value ?? []) {
      const result = await applyProviderEvent(
        admin,
        connection,
        calendarId,
        normalizeOutlookEvent(item),
      );
      if (result === 'deleted') deleted += 1;
      else if (result === 'conflict') conflicts += 1;
      else if (result === 'imported') imported += 1;
    }
    deltaLink = payload['@odata.deltaLink'] || deltaLink;
    nextUrl = payload['@odata.nextLink'] || '';
  }
  if (deltaLink) {
    await admin.from('calendar_sync_cursors').upsert({
      connection_id: connection.id,
      provider_calendar_id: calendarId,
      cursor: deltaLink,
      window_start: window.start,
      window_end: window.end,
      last_full_sync_at: savedCursor?.cursor ? savedCursor.last_full_sync_at : new Date().toISOString(),
      last_incremental_sync_at: savedCursor?.cursor ? new Date().toISOString() : null,
      last_error: null,
      updated_at: new Date().toISOString(),
    });
  }
  return { imported, deleted, conflicts };
}

async function applyProviderEvent(
  admin: ReturnType<typeof createClient>,
  connection: any,
  calendarId: string,
  remote: NormalizedEvent,
): Promise<'imported' | 'deleted' | 'conflict' | 'local_pending'> {
  const { data: link } = await admin.from('calendar_event_links').select('*')
    .eq('connection_id', connection.id)
    .eq('provider_calendar_id', calendarId)
    .eq('provider_event_id', remote.id)
    .maybeSingle();
  if (remote.deleted) {
    if (link?.event_id) {
      const { data: local } = await admin.from('events').select('*').eq('id', link.event_id).maybeSingle();
      const lastSync = new Date(link.last_synced_at).getTime();
      const localChanged = Boolean(local)
        && new Date(local.updated_at).getTime() > lastSync + 1_000;
      if (localChanged) {
        await preserveConflict(admin, connection, link.event_id, remote, local);
        return 'conflict';
      }
      await admin.from('events').update({
        status: 'canceled',
        provider_updated_at: remote.updatedAt,
        updated_at: new Date().toISOString(),
      }).eq('id', link.event_id);
      await admin.from('calendar_event_links').update({
        provider_etag: remote.etag,
        provider_updated_at: remote.updatedAt,
        last_synced_at: new Date().toISOString(),
      }).eq('id', link.id);
    }
    return 'deleted';
  }

  let eventId = link?.event_id ?? null;
  if (eventId) {
    const { data: local } = await admin.from('events').select('*').eq('id', eventId).maybeSingle();
    const lastSync = new Date(link.last_synced_at).getTime();
    const localChanged = local && new Date(local.updated_at).getTime() > lastSync + 1_000;
    const providerChanged = remote.updatedAt
      ? new Date(remote.updatedAt).getTime() > lastSync + 1_000
      : remote.etag !== link.provider_etag;
    if (localChanged && providerChanged && materiallyDifferent(local, remote)) {
      await preserveConflict(admin, connection, eventId, remote, local);
      return 'conflict';
    }
    if (localChanged && !providerChanged) {
      return 'local_pending';
    }
    if (localChanged && providerChanged && !materiallyDifferent(local, remote)) {
      await admin.from('calendar_event_links').update({
        provider_etag: remote.etag,
        provider_updated_at: remote.updatedAt,
        last_synced_at: new Date().toISOString(),
      }).eq('id', link.id);
      return 'imported';
    }
    const { error } = await admin.from('events').update({
      title: remote.title,
      details: remote.details,
      starts_at: remote.startsAt,
      ends_at: remote.endsAt,
      all_day: remote.allDay,
      location: remote.location,
      recurrence_rule: remote.recurrenceRule,
      recurrence: remote.recurrence,
      status: 'confirmed',
      source_calendar_id: calendarId,
      provider_etag: remote.etag,
      provider_updated_at: remote.updatedAt,
      revision: Number(local?.revision ?? 0) + 1,
      updated_at: new Date().toISOString(),
    }).eq('id', eventId);
    if (error) throw error;
  } else {
    const { data: event, error } = await admin.from('events').upsert({
      household_id: connection.household_id,
      title: remote.title,
      details: remote.details,
      starts_at: remote.startsAt,
      ends_at: remote.endsAt,
      all_day: remote.allDay,
      location: remote.location,
      created_by: connection.user_id,
      provider: connection.provider,
      provider_event_id: remote.id,
      recurrence_rule: remote.recurrenceRule,
      recurrence: remote.recurrence,
      status: 'confirmed',
      source_calendar_id: calendarId,
      provider_etag: remote.etag,
      provider_updated_at: remote.updatedAt,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'household_id,provider,provider_event_id' }).select('id').single();
    if (error) throw error;
    eventId = event.id;
  }
  await admin.from('calendar_event_links').upsert({
    household_id: connection.household_id,
    connection_id: connection.id,
    event_id: eventId,
    provider_calendar_id: calendarId,
    provider_event_id: remote.id,
    provider_etag: remote.etag,
    provider_updated_at: remote.updatedAt,
    sync_direction: 'two_way',
    last_synced_at: new Date().toISOString(),
  }, { onConflict: 'connection_id,provider_calendar_id,provider_event_id' });
  return 'imported';
}

async function preserveConflict(
  admin: ReturnType<typeof createClient>,
  connection: any,
  eventId: string,
  remote: NormalizedEvent,
  local: any,
) {
  const { data: existing } = await admin.from('calendar_sync_conflicts').select('id')
    .eq('connection_id', connection.id)
    .eq('event_id', eventId)
    .eq('provider_event_id', remote.id)
    .eq('status', 'open')
    .maybeSingle();
  const payload = {
    household_id: connection.household_id,
    connection_id: connection.id,
    event_id: eventId,
    provider_event_id: remote.id,
    local_payload: local,
    provider_payload: remote,
  };
  const { error } = existing
    ? await admin.from('calendar_sync_conflicts').update(payload).eq('id', existing.id)
    : await admin.from('calendar_sync_conflicts').insert(payload);
  if (error) throw error;
}

async function resolveConflict(
  admin: ReturnType<typeof createClient>,
  conflictId: string,
  resolution: 'keep_local' | 'keep_provider',
  callerId: string,
  encryptionKey: string,
) {
  if (!conflictId) throw new Error('A calendar conflict is required.');
  const { data: conflict, error: conflictError } = await admin
    .from('calendar_sync_conflicts')
    .select('*')
    .eq('id', conflictId)
    .eq('status', 'open')
    .maybeSingle();
  if (conflictError) throw conflictError;
  if (!conflict) throw new Error('This calendar conflict was already resolved or no longer exists.');

  const { data: membership, error: membershipError } = await admin
    .from('household_members')
    .select('role')
    .eq('household_id', conflict.household_id)
    .eq('user_id', callerId)
    .maybeSingle();
  if (membershipError) throw membershipError;
  if (!membership) throw new Error('You are not a member of this household.');

  const [{ data: connection, error: connectionError }, { data: event, error: eventError }] =
    await Promise.all([
      admin.from('calendar_connections').select('*').eq('id', conflict.connection_id).single(),
      conflict.event_id
        ? admin.from('events').select('*').eq('id', conflict.event_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
  if (connectionError) throw connectionError;
  if (eventError) throw eventError;
  if (!event) throw new Error('The Coho event for this conflict no longer exists.');
  const { data: link, error: linkError } = await admin
    .from('calendar_event_links')
    .select('*')
    .eq('connection_id', conflict.connection_id)
    .eq('event_id', event.id)
    .maybeSingle();
  if (linkError) throw linkError;

  const providerPayload = conflict.provider_payload as NormalizedEvent;
  const resolvedAt = new Date().toISOString();
  if (resolution === 'keep_provider') {
    const update = providerPayload.deleted
      ? {
        status: 'canceled',
        provider_etag: providerPayload.etag,
        provider_updated_at: providerPayload.updatedAt,
        revision: Number(event.revision ?? 0) + 1,
        updated_at: resolvedAt,
      }
      : {
        title: providerPayload.title,
        details: providerPayload.details,
        starts_at: providerPayload.startsAt,
        ends_at: providerPayload.endsAt,
        all_day: providerPayload.allDay,
        location: providerPayload.location,
        recurrence_rule: providerPayload.recurrenceRule,
        recurrence: providerPayload.recurrence,
        status: 'confirmed',
        source_calendar_id: link?.provider_calendar_id || event.source_calendar_id,
        provider_etag: providerPayload.etag,
        provider_updated_at: providerPayload.updatedAt,
        revision: Number(event.revision ?? 0) + 1,
        updated_at: resolvedAt,
      };
    const { error } = await admin.from('events').update(update).eq('id', event.id);
    if (error) throw error;
    if (link) {
      const { error: nextLinkError } = await admin.from('calendar_event_links').update({
        provider_etag: providerPayload.etag,
        provider_updated_at: providerPayload.updatedAt,
        last_synced_at: resolvedAt,
      }).eq('id', link.id);
      if (nextLinkError) throw nextLinkError;
    }
  } else {
    const providerCalendarId = link?.provider_calendar_id || connection.default_write_calendar_id;
    if (!providerCalendarId) throw new Error('Choose a writable connected calendar before keeping the Coho version.');
    const providerCalendar = (connection.selected_calendars ?? [])
      .find((calendar: any) => String(calendar.id) === String(providerCalendarId));
    if (providerCalendar?.canWrite === false) {
      throw new Error('That connected calendar is read only. Keep the provider version or choose a writable calendar.');
    }
    const token = await validAccessToken(admin, connection, encryptionKey);
    let remote: { id: string; etag: string | null; updatedAt: string | null };
    if (event.status === 'canceled') {
      if (link) {
        await deleteProviderEvent(connection.provider, token, providerCalendarId, link.provider_event_id);
      }
      remote = {
        id: link?.provider_event_id || conflict.provider_event_id,
        etag: null,
        updatedAt: resolvedAt,
      };
    } else {
      const writeLink = providerPayload.deleted ? null : link;
      remote = connection.provider === 'google'
        ? await writeGoogleEvent(token, providerCalendarId, event, writeLink)
        : await writeOutlookEvent(token, providerCalendarId, event, writeLink);
    }
    await persistEventLink(admin, link, {
      household_id: conflict.household_id,
      connection_id: connection.id,
      event_id: event.id,
      provider_calendar_id: providerCalendarId,
      provider_event_id: remote.id,
      provider_etag: remote.etag,
      provider_updated_at: remote.updatedAt,
      sync_direction: 'two_way',
      last_synced_at: resolvedAt,
    });
    const { error } = await admin.from('events').update({
      provider_etag: remote.etag,
      provider_updated_at: remote.updatedAt,
    }).eq('id', event.id);
    if (error) throw error;
  }

  const resolvedStatus = resolution === 'keep_local' ? 'kept_local' : 'kept_provider';
  const { error: resolutionError } = await admin.from('calendar_sync_conflicts').update({
    status: resolvedStatus,
    resolved_by: callerId,
    resolved_at: resolvedAt,
  })
    .eq('connection_id', conflict.connection_id)
    .eq('event_id', event.id)
    .eq('status', 'open');
  if (resolutionError) throw resolutionError;
  await admin.from('app_events').insert({
    household_id: conflict.household_id,
    user_id: callerId,
    event_name: 'calendar_conflict_resolved',
    properties: {
      conflictId,
      connectionId: connection.id,
      eventId: event.id,
      resolution,
      provider: connection.provider,
    },
  });
  return {
    ok: true,
    eventId: event.id,
    status: resolvedStatus,
  };
}

async function syncCohoEventsOut(
  admin: ReturnType<typeof createClient>,
  connection: any,
  token: string,
) {
  const { data: events, error } = await admin.from('events').select('*')
    .eq('household_id', connection.household_id)
    .gte('starts_at', new Date(Date.now() - 90 * 86_400_000).toISOString())
    .order('starts_at', { ascending: true })
    .limit(1_000);
  if (error) throw error;
  const { data: links } = await admin.from('calendar_event_links').select('*')
    .eq('connection_id', connection.id);
  const linksByEvent = new Map((links ?? []).map((link: any) => [link.event_id, link]));
  const { data: openConflicts } = await admin.from('calendar_sync_conflicts').select('event_id')
    .eq('connection_id', connection.id)
    .eq('status', 'open');
  const conflictedEvents = new Set((openConflicts ?? []).map((conflict: any) => conflict.event_id));
  let exported = 0;
  for (const event of (events ?? []).filter((item: any) => {
    const linkedToThisConnection = linksByEvent.has(item.id);
    return linkedToThisConnection || !item.provider || item.provider === 'coho';
  })) {
    const link = linksByEvent.get(event.id);
    if (conflictedEvents.has(event.id)) continue;
    if (link && new Date(event.updated_at).getTime() <= new Date(link.last_synced_at).getTime() + 1_000) {
      continue;
    }
    const providerCalendarId = link?.provider_calendar_id || connection.default_write_calendar_id;
    if (!providerCalendarId) continue;
    const providerCalendar = (connection.selected_calendars ?? [])
      .find((calendar: any) => String(calendar.id) === String(providerCalendarId));
    if (providerCalendar?.canWrite === false) continue;
    if (event.status === 'canceled') {
      if (!link) continue;
      await deleteProviderEvent(
        connection.provider,
        token,
        providerCalendarId,
        link.provider_event_id,
      );
      await admin.from('calendar_event_links').update({
        provider_etag: null,
        provider_updated_at: new Date().toISOString(),
        last_synced_at: new Date().toISOString(),
      }).eq('id', link.id);
      exported += 1;
      continue;
    }
    const remote = connection.provider === 'google'
      ? await writeGoogleEvent(token, providerCalendarId, event, link)
      : await writeOutlookEvent(token, providerCalendarId, event, link);
    await persistEventLink(admin, link, {
      household_id: connection.household_id,
      connection_id: connection.id,
      event_id: event.id,
      provider_calendar_id: providerCalendarId,
      provider_event_id: remote.id,
      provider_etag: remote.etag,
      provider_updated_at: remote.updatedAt,
      sync_direction: 'two_way',
      last_synced_at: new Date().toISOString(),
    });
    await admin.from('events').update({
      provider_etag: remote.etag,
      provider_updated_at: remote.updatedAt,
    }).eq('id', event.id);
    exported += 1;
  }
  return exported;
}

async function persistEventLink(
  admin: ReturnType<typeof createClient>,
  link: any,
  payload: Record<string, unknown>,
) {
  const { error } = link?.id
    ? await admin.from('calendar_event_links').update(payload).eq('id', link.id)
    : await admin.from('calendar_event_links').insert(payload);
  if (error) throw error;
}

async function deleteProviderEvent(
  provider: Provider,
  token: string,
  calendarId: string,
  providerEventId: string,
) {
  const url = provider === 'google'
    ? `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(providerEventId)}?sendUpdates=none`
    : `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(providerEventId)}`;
  const response = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok && ![404, 410].includes(response.status)) {
    const payload = await response.json().catch(() => ({}));
    const message = provider === 'google'
      ? payload.error?.message
      : payload.error?.message;
    throw new Error(`${provider === 'google' ? 'Google' : 'Outlook'} event delete failed: ${message || response.status}`);
  }
}

async function writeGoogleEvent(token: string, calendarId: string, event: any, link: any) {
  const body: Record<string, unknown> = {
    id: link ? undefined : `coho${String(event.id).replaceAll('-', '')}`,
    summary: event.title,
    description: event.details || undefined,
    location: event.location || undefined,
    start: event.all_day
      ? { date: String(event.starts_at).slice(0, 10) }
      : { dateTime: event.starts_at },
    end: event.all_day
      ? { date: String(event.ends_at || event.starts_at).slice(0, 10) }
      : { dateTime: event.ends_at || new Date(new Date(event.starts_at).getTime() + 60 * 60_000).toISOString() },
    recurrence: event.recurrence_rule ? [`RRULE:${event.recurrence_rule}`] : undefined,
    extendedProperties: { private: { cohoEventId: event.id } },
  };
  Object.keys(body).forEach((key) => body[key] === undefined && delete body[key]);
  const endpoint = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  const url = link ? `${endpoint}/${encodeURIComponent(link.provider_event_id)}?sendUpdates=none` : `${endpoint}?sendUpdates=none`;
  let response = await fetch(url, {
    method: link ? 'PATCH' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!link && response.status === 409) {
    response = await fetch(`${endpoint}/${encodeURIComponent(String(body.id))}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }
  const payload = await response.json();
  if (!response.ok) throw new Error(`Google event write failed: ${payload.error?.message || response.status}`);
  return { id: payload.id, etag: payload.etag || null, updatedAt: payload.updated || null };
}

async function writeOutlookEvent(token: string, calendarId: string, event: any, link: any) {
  const body: Record<string, unknown> = {
    subject: event.title,
    body: { contentType: 'text', content: event.details || '' },
    start: outlookDate(event.starts_at),
    end: outlookDate(event.ends_at || new Date(new Date(event.starts_at).getTime() + 60 * 60_000).toISOString()),
    isAllDay: Boolean(event.all_day),
    location: event.location ? { displayName: event.location } : undefined,
    transactionId: link ? undefined : event.id,
    recurrence: event.recurrence_rule ? rruleToOutlook(event.recurrence_rule, event.starts_at) : undefined,
    singleValueExtendedProperties: [{
      id: 'String {66f5a359-4659-4830-9070-00040ec6ac6e} Name CohoEventId',
      value: event.id,
    }],
  };
  Object.keys(body).forEach((key) => body[key] === undefined && delete body[key]);
  const endpoint = `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(calendarId)}/events`;
  const response = await fetch(link ? `${endpoint}/${encodeURIComponent(link.provider_event_id)}` : endpoint, {
    method: link ? 'PATCH' : 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'outlook.timezone="UTC"',
    },
    body: JSON.stringify(body),
  });
  const payload = response.status === 204 ? {} : await response.json();
  if (!response.ok) throw new Error(`Outlook event write failed: ${payload.error?.message || response.status}`);
  return {
    id: payload.id || link.provider_event_id,
    etag: payload.changeKey || link?.provider_etag || null,
    updatedAt: payload.lastModifiedDateTime || new Date().toISOString(),
  };
}

function normalizeGoogleEvent(item: any): NormalizedEvent {
  const deleted = item.status === 'cancelled';
  const allDay = Boolean(item.start?.date);
  const startsAt = allDay
    ? `${item.start?.date || new Date().toISOString().slice(0, 10)}T00:00:00.000Z`
    : new Date(item.start?.dateTime || Date.now()).toISOString();
  const endsAt = item.end?.date
    ? `${item.end.date}T00:00:00.000Z`
    : item.end?.dateTime ? new Date(item.end.dateTime).toISOString() : null;
  const recurrenceRule = (item.recurrence ?? [])
    .find((value: string) => value.startsWith('RRULE:'))?.slice(6) ?? null;
  return {
    id: String(item.id),
    title: String(item.summary || 'Untitled event').slice(0, 200),
    details: item.description ? String(item.description).slice(0, 20_000) : null,
    startsAt,
    endsAt,
    allDay,
    location: item.location ? String(item.location).slice(0, 500) : null,
    recurrenceRule,
    recurrence: item.recurrence ? { raw: item.recurrence } : null,
    etag: item.etag || null,
    updatedAt: item.updated || null,
    deleted,
  };
}

function normalizeOutlookEvent(item: any): NormalizedEvent {
  const deleted = Boolean(item['@removed']);
  const startsAt = graphDate(item.start);
  const endsAt = item.end ? graphDate(item.end) : null;
  return {
    id: String(item.id),
    title: String(item.subject || 'Untitled event').slice(0, 200),
    details: item.bodyPreview ? String(item.bodyPreview).slice(0, 20_000) : null,
    startsAt,
    endsAt,
    allDay: Boolean(item.isAllDay),
    location: item.location?.displayName ? String(item.location.displayName).slice(0, 500) : null,
    recurrenceRule: null,
    recurrence: item.recurrence ?? null,
    etag: item.changeKey || null,
    updatedAt: item.lastModifiedDateTime || null,
    deleted,
  };
}

function graphDate(value: any) {
  const raw = String(value?.dateTime || new Date().toISOString());
  if (/z$|[+-]\d\d:\d\d$/i.test(raw)) return new Date(raw).toISOString();
  return new Date(`${raw}Z`).toISOString();
}

function outlookDate(value: string) {
  return { dateTime: new Date(value).toISOString().replace(/Z$/, ''), timeZone: 'UTC' };
}

function materiallyDifferent(local: any, remote: NormalizedEvent) {
  return local.title !== remote.title
    || local.location !== remote.location
    || new Date(local.starts_at).getTime() !== new Date(remote.startsAt).getTime()
    || (local.ends_at || null) !== (remote.endsAt || null);
}

function syncWindow() {
  return {
    start: new Date(Date.now() - 90 * 86_400_000).toISOString(),
    end: new Date(Date.now() + 540 * 86_400_000).toISOString(),
  };
}

function providerConfig(provider: Provider) {
  if (provider === 'google') {
    const clientId = Deno.env.get('GOOGLE_CALENDAR_CLIENT_ID');
    const clientSecret = Deno.env.get('GOOGLE_CALENDAR_CLIENT_SECRET');
    if (!clientId || !clientSecret) throw new Error('Google Calendar credentials are not configured.');
    return {
      clientId,
      clientSecret,
      tokenEndpoint: 'https://oauth2.googleapis.com/token',
      scopes: [] as string[],
    };
  }
  const clientId = Deno.env.get('MICROSOFT_CALENDAR_CLIENT_ID');
  const clientSecret = Deno.env.get('MICROSOFT_CALENDAR_CLIENT_SECRET');
  if (!clientId || !clientSecret) throw new Error('Outlook Calendar credentials are not configured.');
  return {
    clientId,
    clientSecret,
    tokenEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: ['openid', 'email', 'profile', 'offline_access', 'User.Read', 'Calendars.ReadWrite'],
  };
}

function rruleToOutlook(rule: string, start: string) {
  const parts = Object.fromEntries(rule.split(';').map((part) => {
    const [key, value] = part.split('=');
    return [key?.toUpperCase(), value];
  }));
  const frequency = parts.FREQ?.toLowerCase();
  if (!['daily', 'weekly', 'monthly'].includes(frequency)) return undefined;
  const dayMap: Record<string, string> = {
    SU: 'sunday', MO: 'monday', TU: 'tuesday', WE: 'wednesday',
    TH: 'thursday', FR: 'friday', SA: 'saturday',
  };
  const startDate = new Date(start).toISOString().slice(0, 10);
  const recurrence: any = {
    pattern: {
      type: frequency === 'monthly' ? 'absoluteMonthly' : frequency,
      interval: Math.max(1, Number(parts.INTERVAL || 1)),
    },
    range: { type: 'noEnd', startDate },
  };
  if (frequency === 'weekly') {
    recurrence.pattern.daysOfWeek = (parts.BYDAY || '').split(',').map((day) => dayMap[day]).filter(Boolean);
    if (!recurrence.pattern.daysOfWeek.length) {
      recurrence.pattern.daysOfWeek = [Object.values(dayMap)[new Date(start).getUTCDay()]];
    }
  }
  if (frequency === 'monthly') recurrence.pattern.dayOfMonth = new Date(start).getUTCDate();
  if (parts.COUNT) recurrence.range = { type: 'numbered', startDate, numberOfOccurrences: Number(parts.COUNT) };
  else if (parts.UNTIL) {
    const until = parts.UNTIL.match(/^(\d{4})(\d{2})(\d{2})/)?.slice(1);
    if (until) recurrence.range = { type: 'endDate', startDate, endDate: until.join('-') };
  }
  return recurrence;
}
