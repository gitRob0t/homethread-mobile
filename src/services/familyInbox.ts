import { supabase } from '../lib/supabase';

export type HouseholdInbox = {
  id: string;
  household_id: string;
  alias: string;
  domain: string;
  status: 'reserved' | 'active' | 'paused';
  display_name: string | null;
};

export type InboundAttachment = {
  id: string;
  filename: string;
  content_type: string;
  byte_size: number;
  status: 'metadata' | 'quarantined' | 'stored' | 'processed' | 'rejected' | 'failed';
  processing_error: string | null;
};

export type InboundItem = {
  id: string;
  sender: string | null;
  subject: string | null;
  body_preview: string | null;
  body_text: string | null;
  received_at: string;
  status: 'queued' | 'processing' | 'needs_review' | 'needs_details' | 'ready' | 'approved' | 'executing' | 'imported' | 'rejected' | 'failed';
  extraction_status: 'queued' | 'processing' | 'needs_details' | 'ready' | 'failed';
  processing_error: string | null;
  processed_at: string | null;
  attachments: Array<{
    id: string;
    filename: string;
    content_type: string;
    size: number;
  }>;
  attachment_records: InboundAttachment[];
  recipient: string | null;
  extracted_data: {
    sender_trusted?: boolean;
    requires_human_review?: boolean;
    summary?: string;
    category?: string;
    confidence?: number;
    action_count?: number;
  } | null;
};

export async function getHouseholdInbox(householdId: string) {
  const { data, error } = await supabase
    .from('household_inboxes')
    .select('id, household_id, alias, domain, status, display_name')
    .eq('household_id', householdId)
    .maybeSingle();
  if (error) throw error;
  return data as HouseholdInbox | null;
}

export async function reserveHouseholdInbox(input: {
  householdId: string;
  alias: string;
  displayName?: string | null;
}) {
  const { data, error } = await supabase.rpc('reserve_household_inbox', {
    target_household: input.householdId,
    requested_alias: input.alias.trim().toLowerCase(),
    requested_display_name: input.displayName?.trim() || null,
  });
  if (error) throw error;
  return data?.[0] as {
    inbox_id: string;
    inbox_alias: string;
    inbox_domain: string;
    inbox_status: HouseholdInbox['status'];
  } | undefined;
}

export async function listInboundItems(householdId: string) {
  const { data, error } = await supabase
    .from('inbound_items')
    .select('id, sender, subject, body_preview, body_text, received_at, status, extraction_status, processing_error, processed_at, attachments, recipient, extracted_data, attachment_records:inbound_attachments(id, filename, content_type, byte_size, status, processing_error)')
    .eq('household_id', householdId)
    .order('received_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as InboundItem[];
}

export async function reviewInboundItem(input: {
  itemId: string;
  userId: string;
  status: 'approved' | 'rejected';
  notes?: string | null;
}) {
  const { error } = await supabase
    .from('inbound_items')
    .update({
      status: input.status,
      reviewed_by: input.userId,
      reviewed_at: new Date().toISOString(),
      review_notes: input.notes?.trim() || null,
    })
    .eq('id', input.itemId);
  if (error) throw error;
}

export async function trustInboxSender(input: {
  householdId: string;
  inboxId: string;
  sender: string;
  userId: string;
  trusted: boolean;
}) {
  const normalized = input.sender.trim().toLowerCase();
  if (!normalized) throw new Error('This email has no sender address.');
  const { error } = await supabase
    .from('household_inbox_sender_rules')
    .upsert({
      household_id: input.householdId,
      inbox_id: input.inboxId,
      sender_address: normalized,
      trusted: input.trusted,
      created_by: input.userId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'inbox_id,sender_address' });
  if (error) throw error;
}

export function subscribeToFamilyInbox(householdId: string, onChange: () => void) {
  const channel = supabase
    .channel(`family-inbox:${householdId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'inbound_items',
        filter: `household_id=eq.${householdId}`,
      },
      onChange,
    )
    .subscribe();
  return () => void supabase.removeChannel(channel);
}

export function inboxAddress(inbox: HouseholdInbox) {
  return `${inbox.alias}@${inbox.domain}`;
}
