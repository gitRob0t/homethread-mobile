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
  if (!expectedSecret || request.headers.get('x-coho-cron-secret') !== expectedSecret) {
    return json({ error: 'Unauthorized.' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return json({ error: 'Service is not configured.' }, 503);
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const { data: preferences, error } = await supabase
    .from('notification_preferences')
    .select('user_id, daily_recap, recap_time, timezone, week_ahead, week_ahead_weekday, week_ahead_time, follow_up, follow_up_weekday, follow_up_time, push_delivery, email_copy');
  if (error) return json({ error: 'Preferences could not be loaded.' }, 500);

  let sent = 0;
  let skipped = 0;
  for (const preference of (preferences ?? []) as Preference[]) {
    const dueTypes = dueBriefings(preference, new Date());
    if (!dueTypes.length) continue;
    const { data: membership } = await supabase
      .from('household_members')
      .select('household_id')
      .eq('user_id', preference.user_id)
      .order('joined_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!membership?.household_id) continue;

    const { data: tokens } = preference.push_delivery
      ? await supabase
        .from('device_push_tokens')
        .select('expo_push_token')
        .eq('user_id', preference.user_id)
        .eq('enabled', true)
      : { data: [] };
    const emailAddress = preference.email_copy
      ? await getUserEmail(supabase, preference.user_id)
      : null;
    if (!tokens?.length && !emailAddress) continue;

    const localDate = dateInTimezone(new Date(), preference.timezone);
    for (const briefingType of dueTypes) {
      const { data: existing } = await supabase
        .from('briefing_deliveries')
        .select('id, status')
        .eq('user_id', preference.user_id)
        .eq('household_id', membership.household_id)
        .eq('briefing_type', briefingType)
        .eq('local_date', localDate)
        .maybeSingle();
      if (existing?.status === 'sent') {
        skipped += 1;
        continue;
      }

      const content = await buildBriefing(supabase, membership.household_id, briefingType);
      const pushResult = tokens?.length
        ? await sendPush(tokens, content, briefingType)
        : null;
      const emailResult = emailAddress
        ? await sendEmail(emailAddress, content, briefingType)
        : null;
      const attempts = [pushResult, emailResult].filter(Boolean) as Array<{ ok: boolean }>;
      const delivered = attempts.length > 0 && attempts.every((attempt) => attempt.ok);
      await supabase.from('briefing_deliveries').upsert({
        user_id: preference.user_id,
        household_id: membership.household_id,
        briefing_type: briefingType,
        local_date: localDate,
        status: delivered ? 'sent' : 'failed',
        provider_response: { push: pushResult, email: emailResult },
      }, { onConflict: 'user_id,household_id,briefing_type,local_date' });
      if (delivered) sent += 1;
    }
  }
  return json({ sent, skipped });
});

async function getUserEmail(
  supabase: ReturnType<typeof createClient>,
  userId: string,
) {
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error) {
    console.error('Briefing email lookup failed', error.message);
    return null;
  }
  return data.user?.email ?? null;
}

async function sendPush(
  tokens: Array<{ expo_push_token: string }>,
  content: { title: string; body: string },
  briefingType: BriefingType,
) {
  const response = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(tokens.map((token) => ({
      to: token.expo_push_token,
      title: content.title,
      body: content.body,
      sound: 'default',
      data: { screen: 'Recaps', briefingType },
    }))),
  });
  return {
    ok: response.ok,
    status: response.status,
    payload: await response.json().catch(() => ({})),
  };
}

async function sendEmail(
  address: string,
  content: { title: string; body: string },
  briefingType: BriefingType,
) {
  const key = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('COHO_FROM_EMAIL');
  if (!key || !from) {
    return { ok: false, status: 503, error: 'Email delivery is not configured.' };
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [address],
      subject: content.title,
      text: content.body,
      html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:auto;padding:28px"><p style="color:#7047EE;font-weight:800;letter-spacing:.08em">COHO</p><h1 style="color:#14213D">${escapeHtml(content.title)}</h1><p style="color:#3C465B;font-size:17px;line-height:1.6">${escapeHtml(content.body)}</p><p style="color:#7A8498;font-size:13px">Open Coho to view the live ${escapeHtml(briefingType.replace('_', ' '))} and its details.</p></div>`,
    }),
  });
  return {
    ok: response.ok,
    status: response.status,
    payload: await response.json().catch(() => ({})),
  };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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
  const [{ data: events }, { data: chores }, { data: followUps }] = await Promise.all([
    supabase
      .from('events')
      .select('title, starts_at')
      .eq('household_id', householdId)
      .gte('starts_at', now.toISOString())
      .lt('starts_at', end.toISOString())
      .order('starts_at', { ascending: true })
      .limit(20),
    supabase
      .from('chores')
      .select('title')
      .eq('household_id', householdId)
      .eq('status', 'open')
      .limit(20),
    supabase
      .from('event_follow_ups')
      .select('note, event:events!event_follow_ups_event_id_fkey(title)')
      .eq('household_id', householdId)
      .eq('status', 'open')
      .order('due_at', { ascending: true, nullsFirst: false })
      .limit(20),
  ]);
  const eventCount = events?.length ?? 0;
  const choreCount = chores?.length ?? 0;
  const followUpCount = followUps?.length ?? 0;
  const next = events?.[0]?.title;
  if (type === 'week_ahead') {
    return {
      title: 'Your Coho week ahead',
      body: `${eventCount} event${eventCount === 1 ? '' : 's'} and ${choreCount} open chore${choreCount === 1 ? '' : 's'} this week.${next ? ` First: ${next}.` : ''}`,
    };
  }
  if (type === 'follow_up') {
    const firstFollowUp = Array.isArray(followUps?.[0]?.event)
      ? followUps?.[0]?.event?.[0]?.title
      : followUps?.[0]?.event?.title;
    return {
      title: 'Coho weekly follow-up',
      body: `${followUpCount} appointment follow-up${followUpCount === 1 ? '' : 's'} and ${choreCount} chore${choreCount === 1 ? '' : 's'} remain open.${firstFollowUp ? ` Start with: ${firstFollowUp}.` : ''}`,
    };
  }
  return {
    title: 'Your Coho daily sync',
    body: `${eventCount} event${eventCount === 1 ? '' : 's'} and ${choreCount} open chore${choreCount === 1 ? '' : 's'} today.${next ? ` Next: ${next}.` : ''}`,
  };
}
