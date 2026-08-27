import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Calendar from 'expo-calendar/legacy';
import { Platform } from 'react-native';

import { supabase } from '../lib/supabase';

const CALENDAR_SETTINGS_KEY = 'coho-device-calendar-settings-v1';

export type DeviceCalendarSummary = {
  id: string;
  title: string;
  color: string;
  sourceName: string;
  allowsModifications: boolean;
};

export type DeviceCalendarSettings = {
  selectedCalendarIds: string[];
  writeBackCalendarId: string | null;
  lastSyncedAt: string | null;
};

export type DeviceCalendarSyncResult = {
  synced: number;
  removed: number;
};

const emptySettings: DeviceCalendarSettings = {
  selectedCalendarIds: [],
  writeBackCalendarId: null,
  lastSyncedAt: null,
};

export async function getDeviceCalendarSettings() {
  const raw = await AsyncStorage.getItem(CALENDAR_SETTINGS_KEY);
  if (!raw) return emptySettings;
  try {
    return { ...emptySettings, ...JSON.parse(raw) } as DeviceCalendarSettings;
  } catch {
    return emptySettings;
  }
}

export async function saveDeviceCalendarSettings(settings: DeviceCalendarSettings) {
  await AsyncStorage.setItem(CALENDAR_SETTINGS_KEY, JSON.stringify(settings));
}

export async function requestDeviceCalendarAccess() {
  if (Platform.OS === 'web') return false;
  const existing = await Calendar.getCalendarPermissionsAsync();
  if (existing.granted) return true;
  const requested = await Calendar.requestCalendarPermissionsAsync();
  return requested.granted;
}

export async function hasDeviceCalendarAccess() {
  if (Platform.OS === 'web') return false;
  return (await Calendar.getCalendarPermissionsAsync()).granted;
}

export async function listDeviceCalendars(): Promise<DeviceCalendarSummary[]> {
  const granted = await requestDeviceCalendarAccess();
  if (!granted) return [];
  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  return calendars
    .map((calendar) => ({
      id: calendar.id,
      title: calendar.title,
      color: calendar.color || '#2257F4',
      sourceName: calendar.source?.name || calendar.ownerAccount || 'On this device',
      allowsModifications: Boolean(calendar.allowsModifications),
    }))
    .sort((a, b) => a.sourceName.localeCompare(b.sourceName) || a.title.localeCompare(b.title));
}

export async function importSelectedDeviceCalendars(input: {
  householdId: string;
  userId: string;
  calendarIds: string[];
  daysAhead?: number;
}): Promise<DeviceCalendarSyncResult> {
  if (!input.calendarIds.length) return { synced: 0, removed: 0 };
  const start = new Date();
  start.setDate(start.getDate() - 14);
  const end = new Date();
  end.setDate(end.getDate() + (input.daysAhead ?? 90));
  const syncedAt = new Date().toISOString();

  const [events, calendars] = await Promise.all([
    Calendar.getEventsAsync(input.calendarIds, start, end),
    Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT),
  ]);
  const calendarNames = new Map(calendars.map((calendar) => [calendar.id, calendar.title]));
  const rows = events
    .filter((event) => (
      event.status !== Calendar.EventStatus.CANCELED
      && Boolean(event.title && event.startDate)
    ))
    .map((event) => ({
      household_id: input.householdId,
      title: event.title.trim().slice(0, 200),
      details: JSON.stringify({
        source: 'device_calendar',
        sourceCalendar: calendarNames.get(event.calendarId) ?? 'iPhone Calendar',
        sourceCalendarId: event.calendarId,
        importedBy: input.userId,
      }),
      starts_at: new Date(event.startDate).toISOString(),
      ends_at: event.endDate ? new Date(event.endDate).toISOString() : null,
      all_day: Boolean(event.allDay),
      location: event.location?.trim() || null,
      created_by: input.userId,
      provider: 'device-calendar',
      provider_event_id: deviceCalendarEventKey(
        event.calendarId,
        event.id,
        new Date(event.startDate).toISOString(),
      ),
      source_calendar_id: event.calendarId,
      status: 'confirmed',
      provider_updated_at: event.lastModifiedDate
        ? new Date(event.lastModifiedDate).toISOString()
        : syncedAt,
      updated_at: syncedAt,
    }));

  if (rows.length) {
    await persistDeviceCalendarRows(input.householdId, rows);
  }

  const currentProviderIds = new Set(rows.map((row) => row.provider_event_id));
  const { data: existing, error: existingError } = await supabase
    .from('events')
    .select('id, provider_event_id, source_calendar_id, status')
    .eq('household_id', input.householdId)
    .eq('provider', 'device-calendar')
    .gte('starts_at', start.toISOString())
    .lte('starts_at', end.toISOString());
  if (existingError) throw existingError;

  const removedIds = (existing ?? [])
    .filter((event) => (
      event.status !== 'canceled'
      && isSelectedDeviceCalendarEvent(
        event.source_calendar_id,
        event.provider_event_id,
        input.calendarIds,
      )
      && !currentProviderIds.has(event.provider_event_id)
    ))
    .map((event) => event.id);

  for (let offset = 0; offset < removedIds.length; offset += 100) {
    const { error } = await supabase
      .from('events')
      .update({
        status: 'canceled',
        created_by: input.userId,
        provider_updated_at: syncedAt,
        updated_at: syncedAt,
      })
      .in('id', removedIds.slice(offset, offset + 100));
    if (error) throw error;
  }

  const current = await getDeviceCalendarSettings();
  await saveDeviceCalendarSettings({
    ...current,
    selectedCalendarIds: input.calendarIds,
    lastSyncedAt: syncedAt,
  });
  return { synced: rows.length, removed: removedIds.length };
}

async function persistDeviceCalendarRows(
  householdId: string,
  rows: Array<Record<string, any> & { provider_event_id: string }>,
) {
  const existingByProviderId = new Map<string, string>();
  for (let offset = 0; offset < rows.length; offset += 100) {
    const providerIds = rows.slice(offset, offset + 100).map((row) => row.provider_event_id);
    const { data, error } = await supabase
      .from('events')
      .select('id, provider_event_id')
      .eq('household_id', householdId)
      .eq('provider', 'device-calendar')
      .in('provider_event_id', providerIds);
    if (error) throw error;
    (data ?? []).forEach((event) => {
      if (event.provider_event_id) existingByProviderId.set(event.provider_event_id, event.id);
    });
  }

  const inserts = rows.filter((row) => !existingByProviderId.has(row.provider_event_id));
  for (let offset = 0; offset < inserts.length; offset += 100) {
    const { error } = await supabase.from('events').insert(inserts.slice(offset, offset + 100));
    if (error) throw error;
  }
  const updates = rows.filter((row) => existingByProviderId.has(row.provider_event_id));
  for (const row of updates) {
    const id = existingByProviderId.get(row.provider_event_id);
    const { error } = await supabase.from('events').update(row).eq('id', id!);
    if (error) throw error;
  }
}

function deviceCalendarEventKey(calendarId: string, eventId: string, startsAt: string) {
  return [calendarId, eventId, startsAt].join(':');
}

function isSelectedDeviceCalendarEvent(
  sourceCalendarId: string | null,
  providerEventId: string | null,
  selectedCalendarIds: string[],
) {
  if (sourceCalendarId) return selectedCalendarIds.includes(sourceCalendarId);
  return selectedCalendarIds.some((calendarId) =>
    providerEventId?.startsWith(`${calendarId}:`));
}

export async function writeApprovedEventToDevice(input: {
  id: string;
  title: string;
  startsAt: string;
  endsAt?: string | null;
  allDay?: boolean;
  location?: string | null;
  notes?: string | null;
  reminderMinutes?: number | null;
  recurrenceRule?: string | Calendar.RecurrenceRule | null;
}) {
  if (Platform.OS === 'web') return null;
  const settings = await getDeviceCalendarSettings();
  if (!settings.writeBackCalendarId) return null;

  const dedupeKey = `coho-device-event:${input.id}`;
  if (await AsyncStorage.getItem(dedupeKey)) return null;

  const { startDate, endDate } = deviceEventDateRange(
    input.startsAt,
    input.endsAt,
    Boolean(input.allDay),
  );
  const eventId = await Calendar.createEventAsync(settings.writeBackCalendarId, {
    title: input.title,
    startDate,
    endDate,
    allDay: Boolean(input.allDay),
    location: input.location || undefined,
    notes: [input.notes, 'Created by Coho'].filter(Boolean).join('\n\n'),
    alarms: input.reminderMinutes
      ? [{ relativeOffset: -Math.abs(input.reminderMinutes) }]
      : undefined,
    recurrenceRule: deviceRecurrenceRule(input.recurrenceRule),
  });
  await AsyncStorage.setItem(dedupeKey, eventId);
  return eventId;
}

function deviceEventDateRange(
  startsAt: string,
  endsAt: string | null | undefined,
  allDay: boolean,
) {
  const startDate = new Date(startsAt);
  if (!allDay) {
    return {
      startDate,
      endDate: endsAt
        ? new Date(endsAt)
        : new Date(startDate.getTime() + 60 * 60 * 1000),
    };
  }

  startDate.setHours(0, 0, 0, 0);
  const endDate = endsAt ? new Date(endsAt) : new Date(startDate);
  endDate.setHours(0, 0, 0, 0);
  if (endDate <= startDate) endDate.setDate(startDate.getDate() + 1);
  return { startDate, endDate };
}

function deviceRecurrenceRule(
  value: string | Calendar.RecurrenceRule | null | undefined,
): Calendar.RecurrenceRule | undefined {
  if (!value) return undefined;
  if (typeof value !== 'string') return value;

  const fields = new Map(
    value
      .trim()
      .replace(/^RRULE:/i, '')
      .split(';')
      .map((part) => {
        const separator = part.indexOf('=');
        return separator > 0
          ? [part.slice(0, separator).toUpperCase(), part.slice(separator + 1)]
          : ['', ''];
      }),
  );
  const frequency = {
    DAILY: Calendar.Frequency.DAILY,
    WEEKLY: Calendar.Frequency.WEEKLY,
    MONTHLY: Calendar.Frequency.MONTHLY,
    YEARLY: Calendar.Frequency.YEARLY,
  }[fields.get('FREQ')?.toUpperCase() ?? ''];
  if (!frequency) return undefined;

  const recurrence: Calendar.RecurrenceRule = { frequency };
  const interval = Number(fields.get('INTERVAL'));
  if (Number.isInteger(interval) && interval > 0) recurrence.interval = interval;

  const occurrence = Number(fields.get('COUNT'));
  if (Number.isInteger(occurrence) && occurrence > 0) recurrence.occurrence = occurrence;

  const endDate = parseRecurrenceEndDate(fields.get('UNTIL'));
  if (endDate) recurrence.endDate = endDate;

  const weekdayMap: Record<string, Calendar.DayOfTheWeek> = {
    SU: Calendar.DayOfTheWeek.Sunday,
    MO: Calendar.DayOfTheWeek.Monday,
    TU: Calendar.DayOfTheWeek.Tuesday,
    WE: Calendar.DayOfTheWeek.Wednesday,
    TH: Calendar.DayOfTheWeek.Thursday,
    FR: Calendar.DayOfTheWeek.Friday,
    SA: Calendar.DayOfTheWeek.Saturday,
  };
  const daysOfTheWeek = fields.get('BYDAY')
    ?.split(',')
    .map((day) => day.trim().toUpperCase())
    .map((day) => {
      const match = day.match(/^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/);
      if (!match) return null;
      const weekNumber = match[1] ? Number(match[1]) : undefined;
      return {
        dayOfTheWeek: weekdayMap[match[2]],
        ...(weekNumber ? { weekNumber } : {}),
      };
    })
    .filter((day): day is Calendar.DaysOfTheWeek => Boolean(day));
  if (daysOfTheWeek?.length) recurrence.daysOfTheWeek = daysOfTheWeek;

  return recurrence;
}

function parseRecurrenceEndDate(value: string | undefined) {
  if (!value) return undefined;
  const match = value.match(
    /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/,
  );
  if (!match) return undefined;
  const [, year, month, day, hour = '23', minute = '59', second = '59', utc] = match;
  const components = [
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  ] as const;
  const date = utc
    ? new Date(Date.UTC(...components))
    : new Date(...components);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
