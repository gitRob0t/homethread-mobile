import { supabase } from '../lib/supabase';
import { invokeEdgeFunction } from './edgeFunctions';

export type CalendarProvider = 'google' | 'outlook';
export type ProviderCalendar = {
  id: string;
  name: string;
  color?: string;
  primary?: boolean;
  canWrite?: boolean;
  selected?: boolean;
};
export type CalendarConnection = {
  id: string;
  provider: CalendarProvider;
  provider_email: string | null;
  display_name: string | null;
  status: 'active' | 'reauthorize' | 'paused' | 'disconnected' | 'error';
  selected_calendars: ProviderCalendar[];
  default_write_calendar_id: string | null;
  sync_enabled: boolean;
  last_synced_at: string | null;
  last_error: string | null;
};

export type CalendarConflict = {
  id: string;
  connection_id: string;
  event_id: string | null;
  provider_event_id: string | null;
  local_payload: Record<string, unknown>;
  provider_payload: Record<string, unknown>;
  status: string;
  created_at: string;
};

export async function listCalendarConnections(householdId: string) {
  const { data, error } = await supabase.rpc('list_calendar_connections', {
    target_household: householdId,
  });
  if (error) throw error;
  return (data ?? []) as CalendarConnection[];
}

export async function startCalendarConnection(
  householdId: string,
  provider: CalendarProvider,
) {
  const data = await invokeEdgeFunction<{ authorizationUrl: string }>(
    'calendar-oauth',
    {
      body: {
        action: 'start',
        householdId,
        provider,
        returnUri: `coho://calendar-connected/${provider}`,
      },
    },
  );
  if (!data?.authorizationUrl) throw new Error('The provider authorization page was not returned.');
  return data.authorizationUrl;
}

export async function saveCalendarConnectionSettings(input: {
  connectionId: string;
  selectedCalendarIds: string[];
  defaultWriteCalendarId: string | null;
  syncEnabled: boolean;
}) {
  return invokeEdgeFunction('calendar-oauth', {
    body: { action: 'settings', ...input },
  });
}

export async function syncCalendarConnection(connectionId: string) {
  return invokeEdgeFunction<{
    results?: Array<{
      ok: boolean;
      imported?: number;
      exported?: number;
      deleted?: number;
      conflicts?: number;
      error?: string;
    }>;
  }>('calendar-sync', {
    body: { connectionId },
  });
}

export async function disconnectCalendarConnection(connectionId: string) {
  return invokeEdgeFunction('calendar-oauth', {
    body: { action: 'disconnect', connectionId },
  });
}

export async function listCalendarConflicts(householdId: string) {
  const { data, error } = await supabase
    .from('calendar_sync_conflicts')
    .select('id, connection_id, event_id, provider_event_id, local_payload, provider_payload, status, created_at')
    .eq('household_id', householdId)
    .eq('status', 'open')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as CalendarConflict[];
}

export async function resolveCalendarConflict(
  conflictId: string,
  resolution: 'keep_local' | 'keep_provider',
) {
  const data = await invokeEdgeFunction<{
    ok: boolean;
    eventId: string;
    status: 'kept_local' | 'kept_provider';
  }>('calendar-sync', {
    body: {
      action: 'resolve_conflict',
      conflictId,
      resolution,
    },
  });
  if (!data?.ok) throw new Error('The calendar conflict could not be resolved.');
  return data;
}
