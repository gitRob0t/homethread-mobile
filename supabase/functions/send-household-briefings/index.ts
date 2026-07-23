import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const jsonHeaders = { 'Content-Type': 'application/json' };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}
type Preference = {
  user_id: string;
  daily_recap: boolean;
  recap_time: string;
  timezone: string;
  week_ahead: boolean;
  week_ahead_weekday: number;
  week_ahead_time: string;
  follow_up: boolean;
  follow_up_weekday: number;
  follow_up_time: string;
  push_delivery: boolean;
  email_copy: boolean;
};
type BriefingType = 'daily' | 'week_ahead' | 'follow_up';

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const expectedSecret = Deno.env.get('BRIEFING_CRON_SECRET');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authorization = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (
    authorization !== serviceKey
    && (!expectedSecret || request.headers.get('x-coho-cron-secret') !== expectedSecret)
  ) return json({ error: 'Unauthorized.' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  if (!supabaseUrl || !serviceKey) return json({ error: 'Service is not configured.' }, 503);
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: preferences, error } = await supabase
    .from('notification_preferences')
    .select('user_id, daily_recap, recap_time, timezone, week_ahead, week_ahead_weekday, week_ahead_time, follow_up, follow_up_weekday, follow_up_time, push_delivery, email_copy');
  if (error) return json({ error: 'Preferences could not be loaded.' }, 500);

  let prepared = 0;
  let skipped = 0;
  for (const preference of (preferences ?? []) as Preference[]) {
    const dueTypes = dueBriefings(preference, new Date());
    if (!dueTypes.length) continue;
    const { data: memberships } = await supabase
      .from('household_members')
      .select('household_id')
      .eq('user_id', preference.user_id)
      .order('joined_at', { ascending: true });
    for (const membership of memberships ?? []) {
      const localDate = dateInTimezone(new Date(), preference.timezone);
      for (const briefingType of dueTypes) {
        const { data: existing } = await supabase
          .from('briefing_snapshots')
          .select('id')
          .eq('user_id', preference.user_id)
          .eq('household_id', membership.household_id)
          .eq('briefing_type', briefingType)
          .eq('local_date', localDate)
          .maybeSingle();
        if (existing) {
          skipped += 1;
          continue;
        }

        const briefing = await buildBriefing(supabase, membership.household_id, briefingType);
        const { data: snapshot, error: snapshotError } = await supabase
          .from('briefing_snapshots')
          .insert({
            user_id: preference.user_id,
            household_id: membership.household_id,
            briefing_type: briefingType,
            local_date: localDate,
            timezone: preference.timezone || 'UTC',
            title: briefing.title,
            summary: briefing.summary,
            content: briefing.content,
          })
          .select('id')
          .single();
        if (snapshotError) {
          console.error('Briefing snapshot failed', snapshotError);
          continue;
        }

        const channels = [
          ...(preference.push_delivery ? ['push'] : []),
          ...(preference.email_copy ? ['email'] : []),
        ];
        const outboxRows = channels.map((channel) => ({
          household_id: membership.household_id,
          recipient_user_id: preference.user_id,
          category: briefingType,
          channel,
          title: briefing.title,
          body: briefing.summary,
          deep_link: `coho://recap/${snapshot.id}`,
          payload: {
            screen: 'Recaps',
            briefingType,
            briefingId: snapshot.id,
            deepLink: `coho://recap/${snapshot.id}`,
          },
          dedupe_key: `briefing:${snapshot.id}:${channel}`,
        }));
        if (outboxRows.length) {
          await supabase.from('notification_outbox').upsert(outboxRows, {
            onConflict: 'dedupe_key',
            ignoreDuplicates: true,
          });
        }
        await supabase.from('briefing_deliveries').upsert({
          user_id: preference.user_id,
          household_id: membership.household_id,
          briefing_type: briefingType,
          local_date: localDate,
          status: 'sent',
          provider_response: {
            state: 'queued',
            snapshot_id: snapshot.id,
            channels,
          },
        }, { onConflict: 'user_id,household_id,briefing_type,local_date' });
        prepared += 1;
      }
    }
  }

  const dispatch = fetch(`${supabaseUrl}/functions/v1/dispatch-notifications`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  }).catch((dispatchError) => console.error('Briefing dispatch failed', dispatchError));
  const edgeRuntime = (globalThis as any).EdgeRuntime;
  if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(dispatch);
  return json({ prepared, skipped });
});

function dueBriefings(preference: Preference, now: Date): BriefingType[] {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: preference.timezone || 'UTC',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
  const currentMinutes = Number(parts.hour) * 60 + Number(parts.minute);
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  const due: BriefingType[] = [];
  if (preference.daily_recap && nearTime(currentMinutes, preference.recap_time)) due.push('daily');
  if (preference.week_ahead && weekday === preference.week_ahead_weekday && nearTime(currentMinutes, preference.week_ahead_time)) due.push('week_ahead');
  if (preference.follow_up && weekday === preference.follow_up_weekday && nearTime(currentMinutes, preference.follow_up_time)) due.push('follow_up');
  return due;
}

function nearTime(currentMinutes: number, value: string) {
  const [hour, minute] = value.split(':').map(Number);
  return Math.abs(currentMinutes - (hour * 60 + minute)) <= 8;
}

function dateInTimezone(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function buildBriefing(
  supabase: ReturnType<typeof createClient>,
  householdId: string,
  type: BriefingType,
) {
  const now = new Date();
  const end = new Date(now);
  end.setDate(end.getDate() + (type === 'daily' ? 1 : 7));
  const [{ data: events }, { data: chores }, { data: followUps }, { data: actions }] = await Promise.all([
    supabase
      .from('events')
      .select('id, title, starts_at, ends_at, location, assigned_person_id')
      .eq('household_id', householdId)
      .gte('starts_at', now.toISOString())
      .lt('starts_at', end.toISOString())
      .neq('status', 'canceled')
      .order('starts_at', { ascending: true })
      .limit(40),
    supabase
      .from('chores')
      .select('id, title, due_at, assigned_to, assigned_person_id, reward_type, reward_value, reward_label')
      .eq('household_id', householdId)
      .eq('status', 'open')
      .order('due_at', { ascending: true, nullsFirst: false })
      .limit(40),
    supabase
      .from('event_follow_ups')
      .select('id, note, due_at, event:events!event_follow_ups_event_id_fkey(id, title, starts_at, location)')
      .eq('household_id', householdId)
      .eq('status', 'open')
      .order('due_at', { ascending: true, nullsFirst: false })
      .limit(40),
    supabase
      .from('household_actions')
      .select('id, kind, title, status, due_at, follow_up_at, target_table, target_id')
      .eq('household_id', householdId)
      .in('status', ['needs_details', 'pending_approval', 'in_progress', 'failed'])
      .order('updated_at', { ascending: false })
      .limit(40),
  ]);
  const eventCount = events?.length ?? 0;
  const choreCount = chores?.length ?? 0;
  const followUpCount = followUps?.length ?? 0;
  const actionCount = actions?.length ?? 0;
  const next = events?.[0]?.title;
  let title = 'Your Coho daily sync';
  let summary = `${eventCount} event${eventCount === 1 ? '' : 's'}, ${choreCount} open chore${choreCount === 1 ? '' : 's'}, and ${actionCount} item${actionCount === 1 ? '' : 's'} needing attention.${next ? ` Next: ${next}.` : ''}`;
  if (type === 'week_ahead') {
    title = 'Your Coho week ahead';
    summary = `${eventCount} event${eventCount === 1 ? '' : 's'} and ${choreCount} open chore${choreCount === 1 ? '' : 's'} across the next seven days.${next ? ` First: ${next}.` : ''}`;
  } else if (type === 'follow_up') {
    title = 'Coho weekly follow-up';
    summary = `${followUpCount} appointment follow-up${followUpCount === 1 ? '' : 's'} and ${actionCount} household loop${actionCount === 1 ? '' : 's'} remain open.`;
  }
  return {
    title,
    summary,
    content: {
      generated_at: now.toISOString(),
      window_end: end.toISOString(),
      events: events ?? [],
      chores: chores ?? [],
      follow_ups: followUps ?? [],
      actions: actions ?? [],
    },
  };
}
