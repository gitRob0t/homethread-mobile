import { supabase } from '../lib/supabase';

export async function listHouseholds() {
  const { data, error } = await supabase
    .from('household_members')
    .select('role, joined_at, households(id, name, created_at)')
    .order('joined_at', { ascending: true });
  if (error) throw error;
  return data;
}

export async function createHousehold(name: string) {
  const { data, error } = await supabase
    .rpc('create_household', { household_name: name.trim() });
  if (error) throw error;
  return data;
}

export async function inviteFamilyMember(
  householdId: string,
  email: string,
  role: 'admin' | 'member' | 'child' = 'member',
) {
  const { data, error } = await supabase.functions.invoke('invite-family-member', {
    body: { householdId, email: email.trim().toLowerCase(), role },
  });
  if (error) throw error;
  return data;
}
