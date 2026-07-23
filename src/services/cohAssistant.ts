import { supabase } from '../lib/supabase';
import { invokeEdgeFunction } from './edgeFunctions';
import { recordAppEvent } from './telemetry';

export type CohDraft = {
  title: string | null;
  person: string | null;
  date: string | null;
  time: string | null;
  location: string | null;
  reminder_minutes: number | null;
  directions: boolean | null;
  notes: string | null;
  starts_at: string | null;
  ends_at: string | null;
  due_at: string | null;
  recurrence_rule: string | null;
  follow_up_at: string | null;
  reward_type: 'points' | 'game_time' | 'vbucks' | 'allowance' | 'custom' | null;
  reward_value: number | null;
  reward_label: string | null;
  grocery_items: Array<{
    name: string;
    quantity: string | null;
    category: string | null;
  }>;
  meals: Array<{
    date: string;
    meal_type: 'breakfast' | 'lunch' | 'dinner' | 'snack';
    title: string;
    notes: string | null;
  }>;
};

export type CohResponse = {
  conversationId: string | null;
  reply: string;
  intent: 'event' | 'chore' | 'note' | 'grocery' | 'meal' | 'travel' | 'restaurant' | 'question' | 'none';
  status: 'collecting' | 'ready_for_confirmation' | 'confirmed' | 'canceled' | 'answered';
  missing_fields: string[];
  draft: CohDraft;
  proposed_action: {
    type: 'create_event' | 'create_chore' | 'create_note' | 'add_grocery_items' | 'create_meal_plan' | 'none';
    requires_confirmation: boolean;
  };
  action: {
    id: string;
    status: string;
    version: number;
    targetTable: string | null;
    targetId: string | null;
  } | null;
};

export type CohHistoryItem = { role: 'user' | 'assistant'; content: string };

export type CohAttachment = {
  name: string;
  mimeType: string;
  base64?: string;
  text?: string;
};

export async function askCoh(input: {
  message: string;
  conversationId?: string | null;
  householdId?: string | null;
  timezone: string;
  history: CohHistoryItem[];
  attachments?: CohAttachment[];
}): Promise<CohResponse> {
  let data: CohResponse;
  try {
    data = await invokeEdgeFunction<CohResponse>('coh-assistant', { body: input });
  } catch (error) {
    void recordAppEvent('coh_client_request_failed', {
      householdId: input.householdId,
      severity: 'error',
      correlationId: input.conversationId,
      properties: {
        attachmentCount: input.attachments?.length ?? 0,
        hasConversation: Boolean(input.conversationId),
      },
    });
    throw error;
  }
  if (!data?.reply) {
    void recordAppEvent('coh_client_invalid_response', {
      householdId: input.householdId,
      severity: 'error',
      correlationId: input.conversationId,
    });
    throw new Error('Coh returned an invalid response.');
  }
  return data;
}

export async function attachmentFromUri(input: {
  uri: string;
  name?: string | null;
  mimeType?: string | null;
  size?: number | null;
}): Promise<CohAttachment> {
  const mimeType = input.mimeType || mimeFromName(input.name || input.uri);
  const maxBytes = 6 * 1024 * 1024;
  if (input.size && input.size > maxBytes) {
    throw new Error('Coh attachments must be 6 MB or smaller.');
  }
  const response = await fetch(input.uri);
  if (!response.ok) throw new Error('That attachment could not be read.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new Error('Coh attachments must be 6 MB or smaller.');
  if (mimeType === 'text/plain' || mimeType === 'text/calendar') {
    return {
      name: input.name || `attachment.${mimeType === 'text/calendar' ? 'ics' : 'txt'}`,
      mimeType,
      text: new TextDecoder().decode(bytes).slice(0, 20_000),
    };
  }
  return {
    name: input.name || `attachment-${Date.now()}`,
    mimeType,
    base64: bytesToBase64(bytes),
  };
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const chunkSize = 16_384;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return globalThis.btoa(binary);
}

function mimeFromName(value: string) {
  const normalized = value.toLowerCase().split('?')[0];
  if (normalized.endsWith('.pdf')) return 'application/pdf';
  if (normalized.endsWith('.png')) return 'image/png';
  if (normalized.endsWith('.webp')) return 'image/webp';
  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) return 'image/jpeg';
  if (normalized.endsWith('.ics')) return 'text/calendar';
  if (normalized.endsWith('.txt')) return 'text/plain';
  if (normalized.endsWith('.wav')) return 'audio/wav';
  if (normalized.endsWith('.mp3')) return 'audio/mpeg';
  if (normalized.endsWith('.mp4')) return 'audio/mp4';
  return 'audio/m4a';
}
