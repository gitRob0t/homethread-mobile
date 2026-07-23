import { supabase } from '../lib/supabase';

export type HouseholdPerson = {
  id: string;
  linked_user_id: string | null;
  display_name: string;
  date_of_birth: string | null;
  bio: string | null;
  role: 'Adult admin' | 'Family member' | 'Child';
  avatar_url: string | null;
  avatar_signed_url?: string | null;
};

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
  const { data, error } = await supabase.rpc('create_household_invitation', {
    target_household: householdId,
    target_email: email.trim().toLowerCase(),
    target_role: role,
  });
  if (error) throw error;
  return data?.[0] as { invitation_id: string; invitation_token: string } | undefined;
}

export async function sendHouseholdInvitation(input: {
  householdId: string;
  email: string;
  role: 'admin' | 'member' | 'child';
  name?: string;
}) {
  const { data, error } = await supabase.functions.invoke<{
    invitationId: string;
    invitationToken: string;
    inviteUrl: string;
    emailSent: boolean;
    deliveryError?: string | null;
  }>('send-household-invite', { body: input });
  if (error) throw error;
  if (!data?.inviteUrl) throw new Error('The secure invitation link was not returned.');
  return data;
}

export async function acceptHouseholdInvitation(token: string) {
  const { data, error } = await supabase.rpc('accept_household_invitation', {
    raw_token: token,
  });
  if (error) throw error;
  return data as string;
}

export async function listHouseholdMembers(householdId: string) {
  const [memberResult, onboardingResult] = await Promise.all([
    supabase
      .from('household_members')
      .select('user_id, role, joined_at, profiles(display_name, avatar_url)')
      .eq('household_id', householdId)
      .order('joined_at', { ascending: true }),
    supabase
      .from('member_onboarding_state')
      .select('user_id, profile_completed, notifications_completed, calendar_completed, tour_completed, first_action_completed, last_active_at')
      .eq('household_id', householdId),
  ]);
  if (memberResult.error) throw memberResult.error;
  if (onboardingResult.error) throw onboardingResult.error;
  const readinessByUser = new Map((onboardingResult.data ?? []).map((row) => [row.user_id, row]));
  return (memberResult.data ?? []).map((member) => ({
    ...member,
    onboarding: readinessByUser.get(member.user_id) ?? null,
  }));
}

export async function listInvitations(householdId: string) {
  const { data, error } = await supabase
    .from('invitations')
    .select('id, email, role, status, expires_at, delivery_status, last_delivery_error')
    .eq('household_id', householdId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export function subscribeToHouseholdAccess(householdId: string, onChange: () => void) {
  const channel = supabase
    .channel(`household-access:${householdId}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'household_members',
      filter: `household_id=eq.${householdId}`,
    }, onChange)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'invitations',
      filter: `household_id=eq.${householdId}`,
    }, onChange)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'member_onboarding_state',
      filter: `household_id=eq.${householdId}`,
    }, onChange)
    .subscribe();
  return () => { void supabase.removeChannel(channel); };
}

export async function listHouseholdPeople(householdId: string) {
  const { data, error } = await supabase
    .from('household_people')
    .select('id, linked_user_id, display_name, date_of_birth, bio, role, avatar_url')
    .eq('household_id', householdId)
    .order('created_at', { ascending: true });
  if (error) throw error;

  return Promise.all(((data ?? []) as HouseholdPerson[]).map(async (person) => {
    if (!person.avatar_url) return person;
    const { data: signed } = await supabase.storage
      .from('family-avatars')
      .createSignedUrl(person.avatar_url, 60 * 60);
    return { ...person, avatar_signed_url: signed?.signedUrl ?? null };
  }));
}

export async function saveHouseholdPerson(input: {
  id?: string;
  householdId: string;
  userId: string;
  displayName: string;
  dateOfBirth?: string | null;
  bio?: string | null;
  role: HouseholdPerson['role'];
}) {
  const values = {
    display_name: input.displayName.trim(),
    date_of_birth: input.dateOfBirth || null,
    bio: input.bio?.trim() || null,
    role: input.role,
    updated_at: new Date().toISOString(),
  };
  if (input.id) {
    const { data, error } = await supabase
      .from('household_people')
      .update(values)
      .eq('id', input.id)
      .select('id')
      .single();
    if (error) throw error;
    return data.id as string;
  }

  const { data, error } = await supabase
    .from('household_people')
    .insert({
      household_id: input.householdId,
      linked_user_id: null,
      created_by: input.userId,
      ...values,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

export async function uploadHouseholdPersonAvatar(input: {
  householdId: string;
  personId: string;
  base64: string;
  mimeType?: string | null;
}) {
  const mimeType = ['image/jpeg', 'image/png', 'image/webp'].includes(input.mimeType || '')
    ? input.mimeType!
    : 'image/jpeg';
  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  const path = `${input.householdId}/${input.personId}/avatar-${Date.now()}.${extension}`;
  const binary = globalThis.atob(input.base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const { error: uploadError } = await supabase.storage
    .from('family-avatars')
    .upload(path, bytes.buffer, { contentType: mimeType, upsert: false });
  if (uploadError) throw uploadError;
  const { error: updateError } = await supabase
    .from('household_people')
    .update({ avatar_url: path, updated_at: new Date().toISOString() })
    .eq('id', input.personId);
  if (updateError) throw updateError;
  return path;
}
