import { supabase } from '../lib/supabase';

export type AutomationTrigger =
  | 'schedule'
  | 'event_completed'
  | 'action_overdue'
  | 'location'
  | 'calendar_change'
  | 'inbox_received';

export type AutomationRule = {
  id: string;
  household_id: string;
  name: string;
  enabled: boolean;
  trigger_type: AutomationTrigger;
  trigger_config: Record<string, unknown>;
  conditions: Array<Record<string, unknown>>;
  action_template: Record<string, unknown>;
  timezone: string;
  next_run_at: string | null;
  last_run_at: string | null;
  last_error: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type AutomationPreset = {
  id: 'meal-plan' | 'overdue' | 'inbox' | 'week-ahead';
  name: string;
  description: string;
  icon: string;
  color: string;
  triggerType: AutomationTrigger;
  triggerConfig: Record<string, unknown>;
  actionTemplate: Record<string, unknown>;
};

export const automationPresets: AutomationPreset[] = [
  {
    id: 'meal-plan',
    name: 'Sunday meal planning',
    description: 'Every Sunday, open a private Coh planning prompt before the grocery week begins.',
    icon: 'restaurant-outline',
    color: '#D7550D',
    triggerType: 'schedule',
    triggerConfig: { cadence: 'weekly', weekday: 0, time: '17:00' },
    actionTemplate: {
      mode: 'notify',
      title: 'Plan the family meals',
      body: 'Coh is ready to build the week’s meal plan and grocery list.',
      deep_link: 'coho://coh/meal-plan',
      audience: 'all_adults',
    },
  },
  {
    id: 'overdue',
    name: 'Nothing falls through',
    description: 'Each afternoon, resurface overdue assignments and follow-ups to the right person.',
    icon: 'refresh-circle-outline',
    color: '#19A47B',
    triggerType: 'action_overdue',
    triggerConfig: { cadence: 'daily', time: '17:30', older_than_minutes: 0 },
    actionTemplate: {
      mode: 'resurface_overdue',
      title: 'This still needs attention',
      audience: 'assignee_or_creator',
    },
  },
  {
    id: 'inbox',
    name: 'School mail triage',
    description: 'When family inbox mail arrives, notify adults after Coh safely prepares its review.',
    icon: 'mail-unread-outline',
    color: '#FF7A2E',
    triggerType: 'inbox_received',
    triggerConfig: {},
    actionTemplate: {
      mode: 'notify',
      title: 'New Family Inbox item',
      body: 'Coh prepared this email for private family review.',
      deep_link_from_context: 'inboxItemId',
      audience: 'all_adults',
    },
  },
  {
    id: 'week-ahead',
    name: 'Sunday command center',
    description: 'Open the full week-ahead sync every Sunday evening for appointments and prep.',
    icon: 'calendar-outline',
    color: '#2257F4',
    triggerType: 'schedule',
    triggerConfig: { cadence: 'weekly', weekday: 0, time: '18:00' },
    actionTemplate: {
      mode: 'notify',
      title: 'Your Coho week ahead',
      body: 'Appointments, assignments, conflicts, and preparation are ready.',
      deep_link: 'coho://recap/week-ahead',
      audience: 'all',
    },
  },
];

export async function listAutomationRules(householdId: string) {
  const { data, error } = await supabase
    .from('automation_rules')
    .select('id, household_id, name, enabled, trigger_type, trigger_config, conditions, action_template, timezone, next_run_at, last_run_at, last_error, created_by, created_at, updated_at')
    .eq('household_id', householdId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as AutomationRule[];
}

export async function createAutomationFromPreset(
  householdId: string,
  userId: string,
  preset: AutomationPreset,
) {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const { data, error } = await supabase
    .from('automation_rules')
    .insert({
      household_id: householdId,
      created_by: userId,
      name: preset.name,
      trigger_type: preset.triggerType,
      trigger_config: preset.triggerConfig,
      action_template: preset.actionTemplate,
      conditions: [],
      timezone,
      next_run_at: preset.triggerType === 'inbox_received'
        ? null
        : nextRunForConfig(preset.triggerConfig),
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

export async function setAutomationEnabled(
  rule: Pick<AutomationRule, 'id' | 'trigger_type' | 'trigger_config'>,
  enabled: boolean,
) {
  const { error } = await supabase
    .from('automation_rules')
    .update({
      enabled,
      next_run_at: enabled && rule.trigger_type !== 'inbox_received'
        ? nextRunForConfig(rule.trigger_config)
        : null,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', rule.id);
  if (error) throw error;
}

export async function deleteAutomationRule(ruleId: string) {
  const { error } = await supabase.from('automation_rules').delete().eq('id', ruleId);
  if (error) throw error;
}

export async function runAutomationNow(ruleId: string) {
  const { data, error } = await supabase.functions.invoke<{
    executed: number;
    skipped: number;
    failed: number;
  }>('run-automations', {
    body: { ruleId, force: true },
  });
  if (error) throw error;
  return data;
}

export function subscribeToAutomations(householdId: string, onChange: () => void) {
  const channel = supabase
    .channel(`automations:${householdId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'automation_rules',
        filter: `household_id=eq.${householdId}`,
      },
      onChange,
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'automation_runs',
        filter: `household_id=eq.${householdId}`,
      },
      onChange,
    )
    .subscribe();
  return () => void supabase.removeChannel(channel);
}

function nextRunForConfig(config: Record<string, unknown>) {
  const cadence = String(config.cadence ?? 'daily');
  const [hour, minute] = String(config.time ?? '17:00').split(':').map(Number);
  const next = new Date();
  next.setHours(Number.isFinite(hour) ? hour : 17, Number.isFinite(minute) ? minute : 0, 0, 0);
  if (cadence === 'weekly') {
    const weekday = Math.max(0, Math.min(6, Number(config.weekday ?? 0)));
    let offset = (weekday - next.getDay() + 7) % 7;
    if (offset === 0 && next.getTime() <= Date.now()) offset = 7;
    next.setDate(next.getDate() + offset);
  } else if (next.getTime() <= Date.now()) {
    next.setDate(next.getDate() + 1);
  }
  return next.toISOString();
}
