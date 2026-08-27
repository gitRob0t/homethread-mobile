import { supabase } from '../lib/supabase';

type SharedTable = 'events' | 'chores' | 'notes' | 'messages';

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
