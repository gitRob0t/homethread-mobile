import { supabase } from '../lib/supabase';

export type HouseholdActionKind =
  | 'event'
  | 'task'
  | 'chore'
  | 'note'
  | 'follow_up'
  | 'grocery'
  | 'meal';

export type HouseholdActionStatus =
  | 'draft'
  | 'needs_details'
  | 'pending_approval'
  | 'approved'
  | 'scheduled'
  | 'in_progress'
  | 'completed'
  | 'canceled'
  | 'failed';

export type HouseholdAction = {
  id: string;
  household_id: string;
  source_kind: 'coh' | 'family_inbox' | 'share' | 'manual' | 'calendar' | 'automation';
  source_id: string | null;
  kind: HouseholdActionKind;
  title: string;
  details: string | null;
  status: HouseholdActionStatus;
  missing_fields: string[];
  proposed_payload: Record<string, unknown>;
  assigned_person_id: string | null;
  assigned_user_id: string | null;
  starts_at: string | null;
  ends_at: string | null;
  due_at: string | null;
  location: string | null;
  recurrence_rule: string | null;
  reminder_minutes: number | null;
  follow_up_at: string | null;
  target_table: string | null;
  target_id: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  assignee?: {
    display_name: string;
    avatar_url: string | null;
  } | null;
};

export type InboxExtraction = {
  id: string;
  inbound_item_id: string;
  extraction_version: number;
  model: string;
  prompt_version: string;
  status: 'processing' | 'needs_details' | 'ready' | 'failed' | 'superseded';
  summary: string | null;
  category: string | null;
  confidence: number | null;
  missing_questions: string[];
  proposals: Array<Record<string, unknown>>;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
};

export type BriefingSnapshot = {
  id: string;
  briefing_type: 'daily' | 'week_ahead' | 'follow_up';
  local_date: string;
  timezone: string;
  title: string;
  summary: string;
  content: {
    events?: Array<Record<string, unknown>>;
    chores?: Array<Record<string, unknown>>;
    follow_ups?: Array<Record<string, unknown>>;
    actions?: Array<Record<string, unknown>>;
  };
  created_at: string;
};

const actionSelect = [
  'id',
  'household_id',
  'source_kind',
  'source_id',
  'kind',
  'title',
  'details',
  'status',
  'missing_fields',
  'proposed_payload',
  'assigned_person_id',
  'assigned_user_id',
  'starts_at',
  'ends_at',
  'due_at',
  'location',
  'recurrence_rule',
  'reminder_minutes',
  'follow_up_at',
  'target_table',
  'target_id',
  'version',
  'created_at',
  'updated_at',
  'assignee:profiles!household_actions_assigned_user_id_fkey(display_name, avatar_url)',
].join(', ');

export async function listHouseholdActions(
  householdId: string,
  options?: { sourceId?: string; statuses?: HouseholdActionStatus[]; limit?: number },
) {
  let query = supabase
    .from('household_actions')
    .select(actionSelect)
    .eq('household_id', householdId)
    .order('updated_at', { ascending: false })
    .limit(options?.limit ?? 100);
  if (options?.sourceId) query = query.eq('source_id', options.sourceId);
  if (options?.statuses?.length) query = query.in('status', options.statuses);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as HouseholdAction[];
}

export async function getHouseholdAction(actionId: string) {
  const { data, error } = await supabase
    .from('household_actions')
    .select(actionSelect)
    .eq('id', actionId)
    .maybeSingle();
  if (error) throw error;
  return data as unknown as HouseholdAction | null;
}

export async function getInboxExtraction(itemId: string) {
  const { data, error } = await supabase
    .from('inbox_extractions')
    .select('id, inbound_item_id, extraction_version, model, prompt_version, status, summary, category, confidence, missing_questions, proposals, error_code, error_message, created_at, completed_at')
    .eq('inbound_item_id', itemId)
    .order('extraction_version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as InboxExtraction | null;
}

export async function extractInboxItem(itemId: string, force = false) {
  const { data, error } = await supabase.functions.invoke<{
    extraction: InboxExtraction;
    actions: HouseholdAction[];
  }>('coh-extract', {
    body: { inboundItemId: itemId, force },
  });
  if (error) throw error;
  if (!data?.extraction) throw new Error('Coh did not return an inbox extraction.');
  return data;
}

export async function correctHouseholdAction(
  action: Pick<HouseholdAction, 'id' | 'version'>,
  patch: {
    title?: string;
    details?: string | null;
    starts_at?: string | null;
    ends_at?: string | null;
    due_at?: string | null;
    location?: string | null;
    reminder_minutes?: number | null;
    recurrence_rule?: string | null;
    assigned_person_id?: string | null;
    missing_fields?: string[];
    proposed_payload?: Record<string, unknown>;
  },
) {
  const { data, error } = await supabase.rpc('correct_household_action', {
    target_action: action.id,
    expected_version: action.version,
    patch,
  });
  if (error) throw error;
  return data as HouseholdAction;
}

export async function approveAndExecuteHouseholdAction(
  action: Pick<HouseholdAction, 'id' | 'version'>,
) {
  const { data, error } = await supabase.rpc('approve_and_execute_household_action', {
    target_action: action.id,
    expected_version: action.version,
  });
  if (error) throw error;
  return data as HouseholdAction;
}

export async function transitionHouseholdAction(
  action: Pick<HouseholdAction, 'id' | 'version'>,
  nextStatus: HouseholdActionStatus,
  reason?: string,
) {
  const { data, error } = await supabase.rpc('transition_household_action', {
    target_action: action.id,
    next_status: nextStatus,
    expected_version: action.version,
    reason: reason ?? null,
  });
  if (error) throw error;
  return data as HouseholdAction;
}

export async function listBriefingSnapshots(householdId: string, limit = 30) {
  const { data, error } = await supabase
    .from('briefing_snapshots')
    .select('id, briefing_type, local_date, timezone, title, summary, content, created_at')
    .eq('household_id', householdId)
    .order('local_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as BriefingSnapshot[];
}

export async function recordNotificationOpened(
  notificationId: string,
  metadata: Record<string, unknown> = {},
) {
  const { error } = await supabase.rpc('record_notification_opened', {
    target_notification: notificationId,
    receipt_metadata: metadata,
  });
  if (error) throw error;
}

export async function recordMemberActive(householdId: string) {
  const { error } = await supabase.rpc('record_member_active', {
    target_household: householdId,
  });
  if (error) throw error;
}

export function subscribeToClosedLoop(householdId: string, onChange: () => void) {
  const channel = supabase
    .channel(`closed-loop:${householdId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'household_actions',
        filter: `household_id=eq.${householdId}`,
      },
      onChange,
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'inbox_extractions',
        filter: `household_id=eq.${householdId}`,
      },
      onChange,
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'briefing_snapshots',
        filter: `household_id=eq.${householdId}`,
      },
      onChange,
    )
    .subscribe();
  return () => void supabase.removeChannel(channel);
}

export function actionDeepLink(action: Pick<HouseholdAction, 'id'>) {
  return `coho://action/${action.id}`;
}
