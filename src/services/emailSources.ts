import { supabase } from '../lib/supabase';

export type EmailSourceProvider = 'google' | 'microsoft' | 'icloud' | 'yahoo' | 'custom';
export type EmailSourceStatus = 'setup_required' | 'active' | 'paused' | 'needs_attention';

export type HouseholdEmailSource = {
  id: string;
  household_id: string;
  email_address: string;
  provider: EmailSourceProvider;
  connection_method: 'forwarding' | 'oauth' | 'imap';
  status: EmailSourceStatus;
  last_received_at: string | null;
  created_at: string;
  updated_at: string;
};

export async function listHouseholdEmailSources(householdId: string) {
  const { data, error } = await supabase
    .from('household_email_sources')
    .select('id, household_id, email_address, provider, connection_method, status, last_received_at, created_at, updated_at')
    .eq('household_id', householdId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as HouseholdEmailSource[];
}

export async function registerForwardingEmailSource(input: {
  householdId: string;
  userId: string;
  emailAddress: string;
  provider: EmailSourceProvider;
}) {
  const emailAddress = input.emailAddress.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailAddress)) {
    throw new Error('Enter a complete email address, such as chad@cragles.net.');
  }
  const { data, error } = await supabase
    .from('household_email_sources')
    .upsert({
      household_id: input.householdId,
      created_by: input.userId,
      email_address: emailAddress,
      provider: input.provider,
      connection_method: 'forwarding',
      status: 'setup_required',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'household_id,email_address' })
    .select('id, household_id, email_address, provider, connection_method, status, last_received_at, created_at, updated_at')
    .single();
  if (error) throw error;
  return data as HouseholdEmailSource;
}

export async function removeHouseholdEmailSource(sourceId: string) {
  const { error } = await supabase
    .from('household_email_sources')
    .delete()
    .eq('id', sourceId);
  if (error) throw error;
}

export function suggestedEmailProvider(emailAddress: string): EmailSourceProvider {
  const domain = emailAddress.trim().toLowerCase().split('@')[1] ?? '';
  if (['gmail.com', 'googlemail.com'].includes(domain)) return 'google';
  if (['outlook.com', 'hotmail.com', 'live.com', 'msn.com'].includes(domain)) return 'microsoft';
  if (['icloud.com', 'me.com', 'mac.com'].includes(domain)) return 'icloud';
  if (['yahoo.com', 'ymail.com'].includes(domain)) return 'yahoo';
  return 'custom';
}
