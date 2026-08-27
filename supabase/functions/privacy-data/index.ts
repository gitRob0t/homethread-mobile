import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { openCalendarSecret } from '../_shared/calendarCrypto.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function safe(value: unknown, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: 'Privacy services are not configured.' }, 503);
  const authorization = request.headers.get('Authorization');
  if (!authorization) return json({ error: 'Authentication required.' }, 401);
  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError || !authData.user) return json({ error: 'Invalid session.' }, 401);

  try {
    const body = await request.json();
    const action = safe(body?.action, 80);
    if (action === 'export') {
      const householdId = safe(body?.householdId, 80);
      if (!householdId) return json({ error: 'Choose a household to export.' }, 400);
      const { data: membership } = await client.from('household_members').select('role')
        .eq('household_id', householdId).eq('user_id', authData.user.id).maybeSingle();
      if (!membership) return json({ error: 'Household access denied.' }, 403);
      return exportData(client, admin, authData.user, householdId);
    }
    if (action === 'delete_account') {
      const confirmation = safe(body?.confirmation, 100);
      const confirmationEmail = safe(body?.email, 320).toLowerCase();
      if (confirmation !== 'DELETE MY COHO ACCOUNT'
        || confirmationEmail !== String(authData.user.email || '').toLowerCase()) {
        return json({ error: 'The confirmation phrase and signed-in email must match exactly.' }, 400);
      }
      return deleteAccount(admin, authData.user);
    }
    return json({ error: 'Unsupported privacy action.' }, 400);
  } catch (error) {
    console.error('Privacy data operation failed', error);
    return json({ error: error instanceof Error ? error.message : 'Privacy operation failed.' }, 500);
  }
});

async function exportData(
  client: ReturnType<typeof createClient>,
  admin: ReturnType<typeof createClient>,
  user: any,
  householdId: string,
) {
  const { data: requestRow, error: requestError } = await admin.from('data_subject_requests').insert({
    user_id: user.id,
    household_id: householdId,
    request_type: 'export',
    status: 'processing',
  }).select('id').single();
  if (requestError) throw requestError;

  try {
    const householdTables = [
      'households',
      'household_members',
      'household_people',
      'events',
      'chores',
      'notes',
      'messages',
      'event_follow_ups',
      'grocery_items',
      'meal_plans',
      'household_inboxes',
      'household_inbox_sender_rules',
      'inbound_items',
      'inbound_attachments',
      'inbox_extractions',
      'household_actions',
      'household_action_events',
      'automation_rules',
      'automation_runs',
      'family_places',
      'place_activity',
      'calendar_event_links',
      'calendar_sync_conflicts',
    ];
    const tableResults = await Promise.all(householdTables.map(async (table) => {
      const filterColumn = table === 'households' ? 'id' : 'household_id';
      const { data, error } = await client.from(table).select('*')
        .eq(filterColumn, householdId).limit(5_000);
      return [table, error ? { error: error.message } : data ?? []] as const;
    }));
    const [
      profile,
      preferences,
      devices,
      briefings,
      notificationHistory,
      locationSettings,
      locations,
      onboarding,
      appEvents,
      calendarConnections,
      conversations,
      travelMemberships,
    ] = await Promise.all([
      client.from('profiles').select('*').eq('id', user.id).maybeSingle(),
      client.from('notification_preferences').select('*').eq('user_id', user.id).maybeSingle(),
      client.from('device_push_tokens').select('id, household_id, platform, enabled, timezone, locale, created_at, last_seen_at, last_opened_at').eq('user_id', user.id),
      client.from('briefing_snapshots').select('*').eq('user_id', user.id).eq('household_id', householdId).limit(1_000),
      client.from('notification_outbox').select('*').eq('recipient_user_id', user.id).eq('household_id', householdId).limit(5_000),
      client.from('member_location_settings').select('*').eq('user_id', user.id),
      client.from('member_locations').select('*').eq('user_id', user.id),
      client.from('member_onboarding_state').select('*').eq('user_id', user.id),
      client.from('app_events').select('*').eq('user_id', user.id).limit(5_000),
      client.rpc('list_calendar_connections', { target_household: householdId }),
      client.from('assistant_conversations').select('id, household_id, title, state, prompt_version, created_at, updated_at').eq('user_id', user.id).eq('household_id', householdId),
      client.from('travel_space_members').select('role, joined_at, travel_spaces(*)').eq('user_id', user.id),
    ]);
    const conversationIds = (conversations.data ?? []).map((conversation: any) => conversation.id);
    const turns = conversationIds.length
      ? await client.from('assistant_turns').select('id, conversation_id, role, content, structured_data, created_at')
        .in('conversation_id', conversationIds).limit(5_000)
      : { data: [], error: null };
    const exportPayload = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      account: {
        id: user.id,
        email: user.email,
        createdAt: user.created_at,
        lastSignInAt: user.last_sign_in_at,
        profile: result(profile),
      },
      householdId,
      householdData: Object.fromEntries(tableResults),
      personalData: {
        notificationPreferences: result(preferences),
        devices: result(devices),
        briefings: result(briefings),
        notificationHistory: result(notificationHistory),
        locationSettings: result(locationSettings),
        locations: result(locations),
        onboarding: result(onboarding),
        diagnostics: result(appEvents),
        calendarConnections: result(calendarConnections),
        cohConversations: result(conversations),
        cohTurns: result(turns),
        travelSpaces: result(travelMemberships),
      },
    };
    const exportPath = `${user.id}/${requestRow.id}.json`;
    const bytes = new TextEncoder().encode(JSON.stringify(exportPayload, null, 2));
    const { error: uploadError } = await admin.storage.from('privacy-exports').upload(
      exportPath,
      bytes,
      { contentType: 'application/json', upsert: false },
    );
    if (uploadError) throw uploadError;
    const { data: signed, error: signedError } = await admin.storage
      .from('privacy-exports')
      .createSignedUrl(exportPath, 60 * 60);
    if (signedError || !signed?.signedUrl) throw signedError ?? new Error('Export URL was not created.');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1_000).toISOString();
    await admin.from('data_subject_requests').update({
      status: 'ready',
      export_path: exportPath,
      export_expires_at: expiresAt,
      completed_at: new Date().toISOString(),
      metadata: { bytes: bytes.byteLength, schemaVersion: 1 },
    }).eq('id', requestRow.id);
    return json({ requestId: requestRow.id, downloadUrl: signed.signedUrl, expiresAt });
  } catch (error) {
    await admin.from('data_subject_requests').update({
      status: 'failed',
      failure_reason: error instanceof Error ? error.message.slice(0, 500) : 'Export failed.',
      completed_at: new Date().toISOString(),
    }).eq('id', requestRow.id);
    throw error;
  }
}

async function deleteAccount(admin: ReturnType<typeof createClient>, user: any) {
  const { data: requestRow, error: requestError } = await admin.from('data_subject_requests').insert({
    user_id: user.id,
    request_type: 'account_deletion',
    status: 'processing',
    metadata: { emailHashRecorded: true },
  }).select('id').single();
  if (requestError) throw requestError;

  try {
    const { data: memberships } = await admin.from('household_members')
      .select('household_id, role').eq('user_id', user.id);
    for (const membership of memberships ?? []) {
      if (membership.role !== 'owner') continue;
      const { data: successor } = await admin.from('household_members')
        .select('user_id, role, joined_at')
        .eq('household_id', membership.household_id)
        .neq('user_id', user.id)
        .in('role', ['admin', 'member'])
        .order('role', { ascending: true })
        .order('joined_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (successor) {
        await admin.from('household_members').update({ role: 'owner' })
          .eq('household_id', membership.household_id).eq('user_id', successor.user_id);
        await admin.from('households').update({ created_by: successor.user_id })
          .eq('id', membership.household_id);
      } else {
        await admin.from('households').delete().eq('id', membership.household_id);
      }
    }

    const { data: travelMemberships } = await admin.from('travel_space_members')
      .select('travel_space_id, role').eq('user_id', user.id);
    for (const membership of travelMemberships ?? []) {
      if (membership.role !== 'host') continue;
      const { data: successor } = await admin.from('travel_space_members')
        .select('user_id, joined_at')
        .eq('travel_space_id', membership.travel_space_id)
        .neq('user_id', user.id)
        .order('joined_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (successor) {
        await admin.from('travel_space_members').update({ role: 'host' })
          .eq('travel_space_id', membership.travel_space_id).eq('user_id', successor.user_id);
        await admin.from('travel_spaces').update({ created_by: successor.user_id })
          .eq('id', membership.travel_space_id);
      } else {
        await admin.from('travel_spaces').delete().eq('id', membership.travel_space_id);
      }
    }

    const encryptionKey = Deno.env.get('CALENDAR_TOKEN_ENCRYPTION_KEY');
    if (encryptionKey) {
      const { data: calendarConnections } = await admin.from('calendar_connections')
        .select('provider, access_token_ciphertext').eq('user_id', user.id);
      await Promise.all((calendarConnections ?? []).map(async (connection: any) => {
        if (connection.provider !== 'google') return;
        try {
          const token = await openCalendarSecret(connection.access_token_ciphertext, encryptionKey);
          await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          });
        } catch {
          // Local token deletion still prevents Coho from using this connection.
        }
      }));
    }

    const { data: linkedPeople } = await admin.from('household_people')
      .select('id, avatar_url').eq('linked_user_id', user.id);
    const avatarPaths = (linkedPeople ?? [])
      .map((person: any) => safe(person.avatar_url, 1_000))
      .filter(Boolean);
    if (avatarPaths.length) {
      await admin.storage.from('family-avatars').remove(avatarPaths);
    }
    await admin.from('household_people').delete().eq('linked_user_id', user.id);
    await admin.from('messages').delete().eq('sender_id', user.id);

    const { data: files } = await admin.storage.from('privacy-exports').list(user.id, { limit: 1_000 });
    if (files?.length) {
      await admin.storage.from('privacy-exports').remove(files.map((file) => `${user.id}/${file.name}`));
    }
    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
    if (deleteError) throw deleteError;
    await admin.from('data_subject_requests').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      metadata: { accountDeleted: true },
    }).eq('id', requestRow.id);
    return json({ deleted: true });
  } catch (error) {
    await admin.from('data_subject_requests').update({
      status: 'failed',
      failure_reason: error instanceof Error ? error.message.slice(0, 500) : 'Deletion failed.',
      completed_at: new Date().toISOString(),
    }).eq('id', requestRow.id);
    throw error;
  }
}

function result(response: { data: unknown; error: { message: string } | null }) {
  return response.error ? { error: response.error.message } : response.data;
}
