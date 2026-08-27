import { supabase } from '../lib/supabase';

type AppEventInput = {
  householdId?: string | null;
  severity?: 'debug' | 'info' | 'warning' | 'error';
  correlationId?: string | null;
  properties?: Record<string, unknown>;
};

export async function recordAppEvent(eventName: string, input: AppEventInput = {}) {
  try {
    const { data } = await supabase.auth.getUser();
    if (!data.user) return;
    await supabase.from('app_events').insert({
      household_id: input.householdId ?? null,
      user_id: data.user.id,
      event_name: eventName.slice(0, 100),
      severity: input.severity ?? 'info',
      correlation_id: input.correlationId?.slice(0, 200) ?? null,
      properties: scrub(input.properties ?? {}),
    });
  } catch {
    // Telemetry must never break a family workflow or trigger a retry loop.
  }
}

function scrub(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[truncated]';
  if (value === null || ['boolean', 'number'].includes(typeof value)) return value;
  if (typeof value === 'string') return value.slice(0, 500);
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => scrub(item, depth + 1));
  if (typeof value !== 'object') return String(value).slice(0, 500);
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !/(token|password|secret|authorization|cookie|email|message|body|content)/i.test(key))
    .slice(0, 40)
    .map(([key, item]) => [key.slice(0, 100), scrub(item, depth + 1)]));
}
