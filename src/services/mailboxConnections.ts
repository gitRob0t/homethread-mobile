import { supabase } from '../lib/supabase';
import { invokeEdgeFunction } from './edgeFunctions';

export type MailboxProvider = 'google' | 'outlook';
export type MailboxConnectionStatus =
  | 'pending'
  | 'active'
  | 'syncing'
  | 'reauthorize'
  | 'paused'
  | 'disconnected'
  | 'error';
export type MailboxSyncMode = 'inbox' | 'selected_folders';
export type MailboxAutoAction = 'review';

export type MailboxFolder = {
  id: string;
  name: string;
  kind: 'inbox' | 'label' | 'folder';
  selected: boolean;
};

export type MailboxSyncPolicy = {
  mode: MailboxSyncMode;
  lookbackDays: number;
  autoAction: MailboxAutoAction;
};

/**
 * Sanitized mailbox metadata returned by list_mailbox_connections.
 *
 * Provider access and refresh tokens are intentionally absent: credentials
 * remain server-side and must never be exposed to the mobile client.
 */
export type MailboxConnection = {
  id: string;
  source_id: string | null;
  provider: MailboxProvider;
  provider_email: string | null;
  display_name: string | null;
  status: MailboxConnectionStatus;
  selected_folders: MailboxFolder[];
  sync_policy: MailboxSyncPolicy;
  sync_enabled: boolean;
  last_synced_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type SaveMailboxConnectionSettingsInput = {
  connectionId: string;
  mode: MailboxSyncMode;
  lookbackDays: number;
  selectedFolderIds: string[];
  syncEnabled: boolean;
};

export type MailboxSyncConnectionResult = {
  connectionId: string;
  ok: boolean;
  imported?: number;
  duplicates?: number;
  failed?: number;
  skipped?: boolean;
  reason?: string;
  error?: string;
};

export type MailboxSyncResult = {
  ok: boolean;
  results: MailboxSyncConnectionResult[];
};

export type MailboxCapabilities = {
  enabled: boolean;
  providers: Record<MailboxProvider, boolean>;
};

export async function getMailboxCapabilities(): Promise<MailboxCapabilities> {
  const data = await invokeEdgeFunction<Partial<MailboxCapabilities>>('mailbox-oauth', {
    body: { action: 'capabilities' },
  });
  return {
    enabled: data?.enabled === true,
    providers: {
      google: data?.providers?.google === true,
      outlook: data?.providers?.outlook === true,
    },
  };
}

export async function listMailboxConnections(householdId: string) {
  const { data, error } = await supabase.rpc('list_mailbox_connections', {
    target_household: householdId,
  });
  if (error) throw error;
  return (data ?? []) as MailboxConnection[];
}

export async function startMailboxConnection(
  householdId: string,
  provider: MailboxProvider,
) {
  const data = await invokeEdgeFunction<{ authorizationUrl: string }>(
    'mailbox-oauth',
    {
      body: {
        action: 'start',
        householdId,
        provider,
        returnUri: `coho://mail-connected/${provider}`,
      },
    },
  );
  if (!data?.authorizationUrl) {
    throw new Error('The mailbox provider authorization page was not returned.');
  }
  return data.authorizationUrl;
}

export async function saveMailboxConnectionSettings(
  input: SaveMailboxConnectionSettingsInput,
) {
  return invokeEdgeFunction<{ updated: boolean }>('mailbox-oauth', {
    // Calendar writes remain review-only even if a stale client or local value
    // still contains an older experimental auto-action preference.
    body: { action: 'settings', ...input, autoAction: 'review' },
  });
}

export async function syncMailboxConnection(connectionId: string) {
  return invokeEdgeFunction<MailboxSyncResult>('mailbox-sync', {
    body: { connectionId },
  });
}

export async function disconnectMailboxConnection(connectionId: string) {
  return invokeEdgeFunction<{ disconnected: boolean }>('mailbox-oauth', {
    body: { action: 'disconnect', connectionId },
  });
}
