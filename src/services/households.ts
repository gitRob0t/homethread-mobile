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

export async function listHouseholdMembers(householdId: string) {
  const { data, error } = await supabase
    .from('household_members')
    .select('user_id, role, joined_at, profiles(display_name, avatar_url)')
    .eq('household_id', householdId)
    .order('joined_at', { ascending: true });
  if (error) throw error;
  return data;
}

export async function listInvitations(householdId: string) {
  const { data, error } = await supabase
    .from('invitations')
    .select('id, email, role, status, expires_at')
    .eq('household_id', householdId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}
