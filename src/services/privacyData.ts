import { supabase } from '../lib/supabase';
import { clearLocationTrackingForSignOut } from './familyLocation';
import { invokeEdgeFunction } from './edgeFunctions';

export type PrivacyRequest = {
  id: string;
  request_type: 'export' | 'account_deletion';
  status: 'processing' | 'ready' | 'completed' | 'failed' | 'canceled';
  export_expires_at: string | null;
  failure_reason: string | null;
  requested_at: string;
  completed_at: string | null;
};

export async function getPrivacyAccount() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error('Sign in to manage your data.');
  return { id: data.user.id, email: data.user.email ?? '' };
}

export async function listPrivacyRequests() {
  const { data, error } = await supabase
    .from('data_subject_requests')
    .select('id, request_type, status, export_expires_at, failure_reason, requested_at, completed_at')
    .order('requested_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data ?? []) as PrivacyRequest[];
}

export async function createHouseholdExport(householdId: string) {
  const data = await invokeEdgeFunction<{
    requestId: string;
    downloadUrl: string;
    expiresAt: string;
  }>('privacy-data', { body: { action: 'export', householdId } });
  if (!data?.downloadUrl) throw new Error('The export download was not created.');
  return data;
}

export async function deleteCohoAccount(email: string, confirmation: string) {
  const data = await invokeEdgeFunction<{ deleted: boolean }>(
    'privacy-data',
    { body: { action: 'delete_account', email, confirmation } },
  );
  if (!data?.deleted) throw new Error('The account was not deleted.');
  await clearLocationTrackingForSignOut().catch(() => undefined);
  await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
}
