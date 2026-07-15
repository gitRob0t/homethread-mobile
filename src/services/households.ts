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
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!userData.user) throw new Error('You must be signed in.');

  const { data, error } = await supabase
    .from('households')
    .insert({ name: name.trim(), created_by: userData.user.id })
    .select('id, name, created_at')
    .single();
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
