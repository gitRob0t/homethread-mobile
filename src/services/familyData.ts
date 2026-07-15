import { supabase } from '../lib/supabase';

type SharedTable = 'events' | 'chores' | 'notes' | 'messages';

export async function listFamilyRecords(table: SharedTable, householdId: string) {
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .eq('household_id', householdId);
  if (error) throw error;
  return data;
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
