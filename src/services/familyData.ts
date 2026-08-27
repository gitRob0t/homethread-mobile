import { supabase } from '../lib/supabase';

type SharedTable = 'events' | 'chores' | 'notes' | 'messages' | 'event_follow_ups';

export type SharedNote = {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  updated_at: string;
};

export type SharedFollowUp = {
  id: string;
  event_id: string;
  note: string | null;
  due_at: string | null;
  status: 'open' | 'completed';
  event: {
    title: string;
    starts_at: string;
    location: string | null;
  } | Array<{
    title: string;
    starts_at: string;
    location: string | null;
  }> | null;
};

export type FamilyEvent = {
  id: string;
  title: string;
  details: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  location: string | null;
  created_by: string;
};

export type FamilyChore = {
  id: string;
  title: string;
  details: string | null;
  assigned_to: string | null;
  due_at: string | null;
  recurrence_rule: string | null;
  status: 'open' | 'completed' | 'skipped';
  created_by: string;
};

export type FamilyNote = {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  updated_at: string;
};

export type FamilyMessage = {
  id: string;
  body: string;
  sender_id: string;
  created_at: string;
  profiles?: { display_name: string; avatar_url: string | null }[] | null;
};

export async function listFamilyRecords(table: SharedTable, householdId: string) {
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .eq('household_id', householdId);
  if (error) throw error;
  return data;
}

export async function listEvents(householdId: string) {
  const { data, error } = await supabase
    .from('events')
    .select('id, title, details, starts_at, ends_at, all_day, location, created_by')
    .eq('household_id', householdId)
    .order('starts_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as FamilyEvent[];
}

export async function createEvent(householdId: string, userId: string, title: string, details = '', startsAt = new Date()) {
  const { error } = await supabase.from('events').insert({
    household_id: householdId,
    created_by: userId,
    title: title.trim(),
    details: details.trim() || null,
    starts_at: startsAt.toISOString(),
  });
  if (error) throw error;
}

export async function deleteEvent(id: string) {
  const { error } = await supabase.from('events').delete().eq('id', id);
  if (error) throw error;
}

export async function listChores(householdId: string) {
  const { data, error } = await supabase
    .from('chores')
    .select('id, title, details, assigned_to, due_at, recurrence_rule, status, created_by')
    .eq('household_id', householdId)
    .order('due_at', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as FamilyChore[];
}

export async function createChore(householdId: string, userId: string, title: string, details = '', assignedTo: string | null = null) {
  const { error } = await supabase.from('chores').insert({
    household_id: householdId,
    created_by: userId,
    title: title.trim(),
    details: details.trim() || null,
    assigned_to: assignedTo,
  });
  if (error) throw error;
}

export async function updateChoreStatus(id: string, status: FamilyChore['status']) {
  const { error } = await supabase.from('chores').update({
    status,
    completed_at: status === 'completed' ? new Date().toISOString() : null,
  }).eq('id', id);
  if (error) throw error;
}

export async function listNotes(householdId: string) {
  const { data, error } = await supabase
    .from('notes')
    .select('id, title, body, pinned, updated_at')
    .eq('household_id', householdId)
    .order('pinned', { ascending: false })
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as FamilyNote[];
}

export async function createNote(householdId: string, userId: string, title: string, body = '') {
  const { error } = await supabase.from('notes').insert({
    household_id: householdId,
    created_by: userId,
    updated_by: userId,
    title: title.trim(),
    body: body.trim(),
  });
  if (error) throw error;
}

export async function listMessages(householdId: string) {
  const { data, error } = await supabase
    .from('messages')
    .select('id, body, sender_id, created_at, profiles!messages_sender_id_fkey(display_name, avatar_url)')
    .eq('household_id', householdId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as FamilyMessage[];
}

export async function createMessage(householdId: string, userId: string, body: string) {
  const { error } = await supabase.from('messages').insert({
    household_id: householdId,
    sender_id: userId,
    body: body.trim(),
  });
  if (error) throw error;
}

export function subscribeToHousehold(
  table: SharedTable,
  householdId: string,
  onChange: () => void,
) {
  const channel = supabase
    .channel(`${table}:${householdId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table, filter: `household_id=eq.${householdId}` },
      onChange,
    )
    .subscribe();

  return () => void supabase.removeChannel(channel);
}

export async function listSharedMessages(householdId: string) {
  const { data, error } = await supabase
    .from('messages')
    .select('id, sender_id, body, created_at, sender:profiles!messages_sender_id_fkey(display_name)')
    .eq('household_id', householdId)
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) throw error;
  return data ?? [];
}

export async function sendFamilyMessage(householdId: string, senderId: string, body: string) {
  const { data, error } = await supabase
    .from('messages')
    .insert({ household_id: householdId, sender_id: senderId, body: body.trim() })
    .select('id')
    .single();
  if (error) throw error;
  return data;
}

export async function listSharedEvents(householdId: string) {
  const { data, error } = await supabase
    .from('events')
    .select('id, title, details, starts_at, ends_at, all_day, location, created_by, assigned_person_id, provider, source_calendar_id, recurrence_rule, status, creator:profiles!events_created_by_fkey(display_name), assigned_person:household_people!events_assigned_person_id_fkey(id, display_name, linked_user_id)')
    .eq('household_id', householdId)
    .neq('status', 'canceled')
    .order('starts_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function createFamilyEvent(input: {
  householdId: string;
  userId: string;
  title: string;
  startsAt: string;
  endsAt?: string | null;
  allDay?: boolean;
  location?: string | null;
  details?: string | null;
  assignedPersonId?: string | null;
  provider?: string;
  recurrenceRule?: string | null;
}) {
  const { data, error } = await supabase
    .from('events')
    .insert({
      household_id: input.householdId,
      created_by: input.userId,
      title: input.title,
      starts_at: input.startsAt,
      ends_at: input.endsAt ?? null,
      all_day: input.allDay ?? false,
      location: input.location ?? null,
      details: input.details ?? null,
      assigned_person_id: input.assignedPersonId ?? null,
      provider: input.provider ?? 'coho',
      recurrence_rule: input.recurrenceRule ?? null,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data;
}

export async function listEventFollowUps(householdId: string) {
  const { data, error } = await supabase
    .from('event_follow_ups')
    .select('id, event_id, note, due_at, status, event:events!event_follow_ups_event_id_fkey(title, starts_at, location)')
    .eq('household_id', householdId)
    .eq('status', 'open')
    .order('due_at', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as SharedFollowUp[];
}

export async function createEventFollowUp(input: {
  householdId: string;
  eventId: string;
  userId: string;
  note?: string | null;
  dueAt?: string | null;
}) {
  const { data, error } = await supabase
    .from('event_follow_ups')
    .upsert({
      household_id: input.householdId,
      event_id: input.eventId,
      created_by: input.userId,
      note: input.note?.trim() || null,
      due_at: input.dueAt ?? null,
      status: 'open',
      completed_by: null,
      completed_at: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'event_id' })
    .select('id')
    .single();
  if (error) throw error;
  return data;
}

export async function completeEventFollowUp(followUpId: string, userId: string) {
  const { error } = await supabase
    .from('event_follow_ups')
    .update({
      status: 'completed',
      completed_by: userId,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', followUpId);
  if (error) throw error;
}

export async function listSharedChores(householdId: string) {
  const { data, error } = await supabase
    .from('chores')
    .select('id, title, details, assigned_to, assigned_person_id, due_at, recurrence_rule, reminder_minutes, status, reward_type, reward_value, reward_label, assignee:profiles!chores_assigned_to_fkey(display_name), assigned_person:household_people!chores_assigned_person_id_fkey(id, display_name, linked_user_id)')
    .eq('household_id', householdId)
    .order('due_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function createFamilyChore(input: {
  householdId: string;
  userId: string;
  title: string;
  details?: string | null;
  assignedPersonId?: string | null;
  assignedUserId?: string | null;
  dueAt?: string | null;
  recurrenceRule?: string | null;
  reminderMinutes?: number | null;
  rewardType?: 'points' | 'game_time' | 'vbucks' | 'allowance' | 'custom';
  rewardValue?: number;
  rewardLabel?: string | null;
}) {
  const { data, error } = await supabase
    .from('chores')
    .insert({
      household_id: input.householdId,
      created_by: input.userId,
      title: input.title.trim(),
      details: input.details?.trim() || null,
      assigned_person_id: input.assignedPersonId ?? null,
      assigned_to: input.assignedUserId ?? null,
      due_at: input.dueAt ?? null,
      recurrence_rule: input.recurrenceRule ?? null,
      reminder_minutes: input.reminderMinutes ?? null,
      reward_type: input.rewardType ?? 'points',
      reward_value: Math.max(0, input.rewardValue ?? 10),
      reward_label: input.rewardLabel?.trim() || null,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data;
}

export async function updateFamilyChore(choreId: string, patch: Record<string, unknown>) {
  const { error } = await supabase.from('chores').update(patch).eq('id', choreId);
  if (error) throw error;
}

export async function deleteFamilyChore(choreId: string) {
  const { error } = await supabase.from('chores').delete().eq('id', choreId);
  if (error) throw error;
}

export async function setFamilyChoreCompleted(choreId: string, completed: boolean) {
  const { data, error } = await supabase.rpc('set_household_chore_completed', {
    target_chore: choreId,
    is_completed: completed,
  });
  if (error) throw error;
  return data;
}

export async function listSharedNotes(householdId: string) {
  const { data, error } = await supabase
    .from('notes')
    .select('id, title, body, pinned, updated_at')
    .eq('household_id', householdId)
    .order('pinned', { ascending: false })
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as SharedNote[];
}

export async function saveFamilyNote(input: {
  id?: string;
  householdId: string;
  userId: string;
  title: string;
  body: string;
  pinned: boolean;
}) {
  const values = {
    title: input.title.trim(),
    body: input.body.trim(),
    pinned: input.pinned,
    updated_by: input.userId,
    updated_at: new Date().toISOString(),
  };
  if (input.id) {
    const { data, error } = await supabase
      .from('notes')
      .update(values)
      .eq('id', input.id)
      .select('id')
      .single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await supabase
    .from('notes')
    .insert({
      household_id: input.householdId,
      created_by: input.userId,
      ...values,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data;
}
