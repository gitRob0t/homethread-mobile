import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-coho-cron-secret',
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

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !serviceKey || !anonKey) {
    return json({ error: 'Automation execution is not configured.' }, 503);
  }
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const body = await request.json().catch(() => ({}));
  const bearer = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const cronSecret = Deno.env.get('AUTOMATION_CRON_SECRET');
  const serviceRequest = bearer === serviceKey
    || Boolean(cronSecret && request.headers.get('x-coho-cron-secret') === cronSecret);
  let userId: string | null = null;
  if (!serviceRequest) {
    if (!bearer) return json({ error: 'Authentication required.' }, 401);
    const client = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${bearer}` } },
      auth: { persistSession: false },
    });
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return json({ error: 'Invalid session.' }, 401);
    userId = data.user.id;
  }

  const ruleId = safe(body?.ruleId, 100);
  const householdId = safe(body?.householdId, 100);
  const triggerType = safe(body?.triggerType, 80);
  const force = body?.force === true;
  const context = cleanContext(body?.context);
  let query = admin
    .from('automation_rules')
    .select('*')
    .eq('enabled', true)
    .limit(100);
  if (ruleId) query = query.eq('id', ruleId);
  else if (householdId) query = query.eq('household_id', householdId);
  if (triggerType) query = query.eq('trigger_type', triggerType);
  if (!ruleId && !triggerType) query = query.lte('next_run_at', new Date().toISOString());
  const { data: rows, error: rulesError } = await query;
  if (rulesError) return json({ error: 'Automation rules could not be loaded.' }, 500);

  if (userId) {
    if (!ruleId || rows?.length !== 1) return json({ error: 'Choose one automation to run.' }, 400);
    const { data: membership } = await admin
      .from('household_members')
      .select('role')
      .eq('household_id', rows[0].household_id)
      .eq('user_id', userId)
      .maybeSingle();
    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return json({ error: 'Only an adult household administrator can run automations.' }, 403);
    }
  }

  let executed = 0;
  let skipped = 0;
  let failed = 0;
  let notificationsQueued = false;
  for (const rule of rows ?? []) {
    if (!force && !triggerType && rule.next_run_at && new Date(rule.next_run_at).getTime() > Date.now()) {
      skipped += 1;
      continue;
    }
    if (triggerType && !eventMatches(rule, context)) {
      skipped += 1;
      continue;
    }

    const dedupeKey = automationDedupeKey(rule, triggerType, context, force);
    const { data: run, error: runError } = await admin
      .from('automation_runs')
      .insert({
        rule_id: rule.id,
        household_id: rule.household_id,
        trigger_type: triggerType || rule.trigger_type,
        trigger_context: context,
        dedupe_key: dedupeKey,
      })
      .select('id')
      .single();
    if (runError) {
      if (runError.code === '23505') {
        skipped += 1;
        continue;
      }
      failed += 1;
      continue;
    }

    try {
      const result = await executeRule(admin, rule, context, dedupeKey);
      notificationsQueued = notificationsQueued || Number(result.notifications_queued ?? 0) > 0;
      await admin.from('automation_runs').update({
        status: result.skipped ? 'skipped' : 'succeeded',
        action_id: result.action_id ?? null,
        result,
        completed_at: new Date().toISOString(),
      }).eq('id', run.id);
      await admin.from('automation_rules').update({
        last_run_at: new Date().toISOString(),
        next_run_at: nextOccurrence(rule.trigger_config, rule.timezone, new Date()),
        last_error: null,
        updated_at: new Date().toISOString(),
      }).eq('id', rule.id);
      if (result.skipped) skipped += 1;
      else executed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 1_000) : 'Automation failed.';
      await Promise.all([
        admin.from('automation_runs').update({
          status: 'failed',
          error_message: message,
          completed_at: new Date().toISOString(),
        }).eq('id', run.id),
        admin.from('automation_rules').update({
          last_run_at: new Date().toISOString(),
          next_run_at: nextOccurrence(rule.trigger_config, rule.timezone, new Date()),
          last_error: message,
          updated_at: new Date().toISOString(),
        }).eq('id', rule.id),
      ]);
      await admin.from('app_events').insert({
        household_id: rule.household_id,
        user_id: rule.created_by,
        event_name: 'automation_failed',
        severity: 'error',
        correlation_id: run.id,
        properties: { rule_id: rule.id, message },
      });
      failed += 1;
    }
  }

  if (notificationsQueued) {
    const dispatch = fetch(`${supabaseUrl}/functions/v1/dispatch-notifications`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    }).catch((error) => console.error('Automation notification dispatch failed', error));
    const edgeRuntime = (globalThis as any).EdgeRuntime;
    if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(dispatch);
  }
  return json({ executed, skipped, failed });
});

async function executeRule(
  admin: ReturnType<typeof createClient>,
  rule: any,
  context: Record<string, unknown>,
  dedupeKey: string,
) {
  const template = rule.action_template ?? {};
  const mode = safe(template.mode, 80) || 'notify';
  if (mode === 'resurface_overdue') {
    return resurfaceOverdue(admin, rule, template, dedupeKey);
  }
  if (mode === 'propose_action') {
    const title = interpolate(safe(template.title, 240), context);
    const kind = safe(template.kind, 40);
    if (!title || !['event', 'task', 'chore', 'note', 'follow_up', 'grocery', 'meal'].includes(kind)) {
      throw new Error('The automation action template is incomplete.');
    }
    const idempotencyKey = `automation:${dedupeKey}`;
    const { data, error } = await admin
      .from('household_actions')
      .upsert({
        household_id: rule.household_id,
        source_kind: 'automation',
        source_id: rule.id,
        kind,
        title,
        details: interpolate(safe(template.details, 8_000), context) || null,
        status: 'pending_approval',
        missing_fields: [],
        proposed_payload: template.proposed_payload ?? {},
        assigned_person_id: template.assigned_person_id ?? null,
        assigned_user_id: template.assigned_user_id ?? null,
        starts_at: timestampOrNull(template.starts_at),
        due_at: timestampOrNull(template.due_at),
        reminder_minutes: numberOrNull(template.reminder_minutes),
        follow_up_at: timestampOrNull(template.follow_up_at),
        idempotency_key: idempotencyKey,
        created_by: rule.created_by,
      }, { onConflict: 'household_id,idempotency_key' })
      .select('id')
      .single();
    if (error) throw error;
    const recipients = await automationRecipients(admin, rule.household_id, 'all_adults', rule.created_by);
    const queued = await queueNotifications(admin, recipients, {
      householdId: rule.household_id,
      actionId: data.id,
      title: 'Coh prepared a household action',
      body: title,
      deepLink: `coho://action/${data.id}`,
      dedupeKey: `${dedupeKey}:approval`,
    });
    return { action_id: data.id, notifications_queued: queued };
  }

  const title = interpolate(safe(template.title, 200) || rule.name, context);
  const body = interpolate(safe(template.body, 1_000) || 'Open Coho for the next family step.', context);
  const deepLink = notificationDeepLink(template, context);
  const recipients = await automationRecipients(
    admin,
    rule.household_id,
    safe(template.audience, 40) || 'all_adults',
    rule.created_by,
  );
  if (!recipients.length) return { skipped: true, reason: 'No eligible recipients.' };
  const queued = await queueNotifications(admin, recipients, {
    householdId: rule.household_id,
    title,
    body,
    deepLink,
    dedupeKey,
  });
  return { notifications_queued: queued, deep_link: deepLink };
}

async function resurfaceOverdue(
  admin: ReturnType<typeof createClient>,
  rule: any,
  template: Record<string, unknown>,
  dedupeKey: string,
) {
  const now = new Date().toISOString();
  const { data: actions, error } = await admin
    .from('household_actions')
    .select('id, title, assigned_user_id, created_by, due_at, follow_up_at')
    .eq('household_id', rule.household_id)
    .in('status', ['scheduled', 'in_progress'])
    .or(`due_at.lt.${now},follow_up_at.lt.${now}`)
    .limit(100);
  if (error) throw error;
  let queued = 0;
  for (const action of actions ?? []) {
    const recipient = action.assigned_user_id || action.created_by;
    if (!recipient) continue;
    queued += await queueNotifications(admin, [recipient], {
      householdId: rule.household_id,
      actionId: action.id,
      title: safe(template.title, 200) || 'This still needs attention',
      body: action.title,
      deepLink: `coho://action/${action.id}`,
      dedupeKey: `${dedupeKey}:${action.id}`,
    });
  }
  return actions?.length
    ? { notifications_queued: queued, overdue_count: actions.length }
    : { skipped: true, reason: 'No overdue household actions.' };
}

async function automationRecipients(
  admin: ReturnType<typeof createClient>,
  householdId: string,
  audience: string,
  fallbackUserId: string,
) {
  const { data } = await admin
    .from('household_members')
    .select('user_id, role')
    .eq('household_id', householdId);
  const members = data ?? [];
  if (audience === 'creator') return [fallbackUserId];
  if (audience === 'all') return members.map((member: any) => member.user_id);
  return members
    .filter((member: any) => ['owner', 'admin', 'member'].includes(member.role))
    .map((member: any) => member.user_id);
}

async function queueNotifications(
  admin: ReturnType<typeof createClient>,
  recipients: string[],
  input: {
    householdId: string;
    actionId?: string;
    title: string;
    body: string;
    deepLink: string;
    dedupeKey: string;
  },
) {
  const rows = [...new Set(recipients)].filter(Boolean).map((recipient) => ({
    household_id: input.householdId,
    recipient_user_id: recipient,
    action_id: input.actionId ?? null,
    category: 'automation',
    title: input.title,
    body: input.body,
    deep_link: input.deepLink,
    payload: {
      screen: input.actionId ? 'Action' : 'Automations',
      actionId: input.actionId ?? null,
      deepLink: input.deepLink,
    },
    dedupe_key: `${input.dedupeKey}:${recipient}`,
  }));
  if (!rows.length) return 0;
  const { error } = await admin.from('notification_outbox').upsert(rows, {
    onConflict: 'dedupe_key',
    ignoreDuplicates: true,
  });
  if (error) throw error;
  return rows.length;
}

function notificationDeepLink(
  template: Record<string, unknown>,
  context: Record<string, unknown>,
) {
  const contextField = safe(template.deep_link_from_context, 80);
  if (contextField === 'inboxItemId' && context.inboxItemId) {
    return `coho://inbox/${encodeURIComponent(String(context.inboxItemId))}`;
  }
  return safe(template.deep_link, 500) || 'coho://automations/home';
}

function eventMatches(rule: any, context: Record<string, unknown>) {
  if (!context || typeof context !== 'object') return false;
  const senderDomain = safe(rule.conditions?.find?.((condition: any) =>
    condition.field === 'sender_domain')?.equals, 200).toLowerCase();
  if (senderDomain && !safe(context.sender, 320).toLowerCase().endsWith(`@${senderDomain}`)) {
    return false;
  }
  return true;
}

function automationDedupeKey(
  rule: any,
  triggerType: string,
  context: Record<string, unknown>,
  force: boolean,
) {
  if (force) return `automation:${rule.id}:manual:${crypto.randomUUID()}`;
  const contextId = safe(context.eventId || context.inboxItemId || context.actionId, 120);
  if (triggerType && contextId) return `automation:${rule.id}:${triggerType}:${contextId}`;
  const scheduled = rule.next_run_at
    ? new Date(rule.next_run_at).toISOString().slice(0, 16)
    : new Date().toISOString().slice(0, 13);
  return `automation:${rule.id}:schedule:${scheduled}`;
}

function nextOccurrence(config: Record<string, unknown>, timezone: string, now: Date) {
  const cadence = safe(config?.cadence, 20);
  if (!['daily', 'weekly'].includes(cadence)) return null;
  const timeMatch = safe(config?.time, 10).match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  const hour = Number(timeMatch?.[1] ?? 17);
  const minute = Number(timeMatch?.[2] ?? 0);
  const parts = zonedParts(now, timezone || 'UTC');
  let targetDay = parts.day;
  let targetMonth = parts.month;
  let targetYear = parts.year;
  if (cadence === 'weekly') {
    const wanted = Math.max(0, Math.min(6, Number(config?.weekday ?? 0)));
    let offset = (wanted - parts.weekday + 7) % 7;
    const todayTarget = zonedToUtc(parts.year, parts.month, parts.day, hour, minute, timezone);
    if (offset === 0 && todayTarget.getTime() <= now.getTime()) offset = 7;
    const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + offset, 12));
    targetYear = date.getUTCFullYear();
    targetMonth = date.getUTCMonth() + 1;
    targetDay = date.getUTCDate();
  } else {
    const todayTarget = zonedToUtc(parts.year, parts.month, parts.day, hour, minute, timezone);
    if (todayTarget.getTime() <= now.getTime()) {
      const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1, 12));
      targetYear = date.getUTCFullYear();
      targetMonth = date.getUTCMonth() + 1;
      targetDay = date.getUTCDate();
    }
  }
  return zonedToUtc(targetYear, targetMonth, targetDay, hour, minute, timezone).toISOString();
}

function zonedParts(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday),
  };
}

function zonedToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string,
) {
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = new Date(desired);
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const actual = zonedParts(guess, timezone || 'UTC');
    const represented = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    guess = new Date(guess.getTime() + (desired - represented));
  }
  return guess;
}

function interpolate(value: string, context: Record<string, unknown>) {
  return value.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key) => safe(context[key], 500));
}

function timestampOrNull(value: unknown) {
  const parsed = safe(value, 100);
  if (!parsed) return null;
  const date = new Date(parsed);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function cleanContext(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 30)) {
    if (typeof item === 'string') result[key.slice(0, 80)] = item.slice(0, 2_000);
    else if (typeof item === 'number' || typeof item === 'boolean' || item === null) {
      result[key.slice(0, 80)] = item;
    }
  }
  return result;
}
