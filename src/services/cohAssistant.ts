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
  requestId: string;
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
    proposalHash: string;
    targetTable: string | null;
    targetId: string | null;
    missingFields?: string[];
  } | null;
  retryable?: boolean;
  correlationId?: string | null;
};

export type CohHistoryItem = { role: 'user' | 'assistant'; content: string };

export type CohTurn = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  requestId: string | null;
  operation: 'message' | 'confirm' | 'cancel' | null;
  requestState: 'processing' | 'completed' | 'failed' | null;
  retryable: boolean;
  errorCode: string | null;
  leaseExpiresAt: string | null;
  attachmentCount: number;
  timezone: string | null;
  response: CohResponse | null;
};

export type CohOutstandingRequest = {
  requestId: string;
  conversationId: string;
  operation: 'message' | 'confirm' | 'cancel';
  status: 'processing' | 'completed' | 'failed';
  retryable: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  leaseExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  action: CohResponse['action'];
  response: CohResponse | null;
};

export type CohSession = {
  conversationId: string | null;
  turns: CohTurn[];
  activeAction: CohResponse['action'];
  // Optional during a rolling Edge Function deployment. The app normalizes
  // an older response to an empty ledger instead of breaking recovery.
  outstandingRequests?: CohOutstandingRequest[];
  hasProcessingRequests?: boolean;
};

export type CohAttachment = {
  name: string;
  mimeType: string;
  base64?: string;
  text?: string;
};

export async function askCoh(input: {
  message: string;
  requestId: string;
  conversationId?: string | null;
  householdId?: string | null;
  timezone: string;
  attachments?: CohAttachment[];
}): Promise<CohResponse> {
  return invokeCoh({
    operation: 'message',
    ...input,
  });
}

export async function confirmCohAction(input: {
  requestId: string;
  conversationId: string;
  householdId: string;
  timezone: string;
  actionId: string;
  expectedVersion: number;
  proposalHash: string;
}): Promise<CohResponse> {
  return invokeCoh({
    operation: 'confirm',
    ...input,
  });
}

export async function cancelCohAction(input: {
  requestId: string;
  conversationId: string;
  householdId: string;
  timezone: string;
  actionId: string;
  expectedVersion: number;
  proposalHash: string;
}): Promise<CohResponse> {
  return invokeCoh({
    operation: 'cancel',
    ...input,
  });
}

export async function resumeCoh(input: {
  householdId: string;
  timezone: string;
}): Promise<CohSession> {
  return invokeEdgeFunction<CohSession>('coh-assistant', {
    body: {
      operation: 'resume',
      requestId: createCohRequestId(),
      ...input,
    },
  });
}

async function invokeCoh(input: {
  operation: 'message' | 'confirm' | 'cancel';
  message?: string;
  requestId: string;
  conversationId?: string | null;
  householdId?: string | null;
  timezone: string;
  actionId?: string;
  expectedVersion?: number;
  proposalHash?: string;
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
        operation: input.operation,
        requestId: input.requestId,
        attachmentCount: input.attachments?.length ?? 0,
        hasConversation: Boolean(input.conversationId),
      },
    });
    throw error;
  }
  const validProposal = data?.status !== 'ready_for_confirmation'
    || Boolean(
      data.action
      && Number.isInteger(data.action.version)
      && /^[0-9a-f]{64}$/i.test(data.action.proposalHash),
    );
  if (
    !data?.reply?.trim()
    || data.requestId !== input.requestId
    || !data.conversationId
    || !validProposal
  ) {
    void recordAppEvent('coh_client_invalid_response', {
      householdId: input.householdId,
      severity: 'error',
      correlationId: input.conversationId,
      properties: {
        operation: input.operation,
        requestId: input.requestId,
        responseRequestMatches: data?.requestId === input.requestId,
        hasConversation: Boolean(data?.conversationId),
        hasValidProposal: validProposal,
      },
    });
    throw new Error('Coh returned an invalid response.');
  }
  return data;
}

export function createCohRequestId() {
  return createUuid();
}

export function createCohConversationId() {
  return createUuid();
}

function createUuid() {
  const value = randomHex(32).split('');
  value[12] = '4';
  value[16] = ['8', '9', 'a', 'b'][Math.floor(Math.random() * 4)];
  return [
    value.slice(0, 8).join(''),
    value.slice(8, 12).join(''),
    value.slice(12, 16).join(''),
    value.slice(16, 20).join(''),
    value.slice(20, 32).join(''),
  ].join('-');
}

function randomHex(length: number) {
  let value = '';
  while (value.length < length) {
    value += Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0');
  }
  return value.slice(0, length);
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
