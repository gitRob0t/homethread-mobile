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
}) {
  if (!input.calendarIds.length) return 0;
  const start = new Date();
  start.setDate(start.getDate() - 14);
  const end = new Date();
  end.setDate(end.getDate() + (input.daysAhead ?? 90));

  const [events, calendars] = await Promise.all([
    Calendar.getEventsAsync(input.calendarIds, start, end),
    Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT),
  ]);
  const calendarNames = new Map(calendars.map((calendar) => [calendar.id, calendar.title]));
  const rows = events
    .filter((event) => Boolean(event.title && event.startDate))
    .map((event) => ({
      household_id: input.householdId,
      title: event.title.trim().slice(0, 200),
      details: JSON.stringify({
        source: 'device_calendar',
        sourceCalendar: calendarNames.get(event.calendarId) ?? 'iPhone Calendar',
        importedBy: input.userId,
      }),
      starts_at: new Date(event.startDate).toISOString(),
      ends_at: event.endDate ? new Date(event.endDate).toISOString() : null,
      all_day: Boolean(event.allDay),
      location: event.location?.trim() || null,
      created_by: input.userId,
      provider: 'device-calendar',
      provider_event_id: [
        event.calendarId,
        event.id,
        new Date(event.startDate).toISOString(),
      ].join(':'),
      updated_at: new Date().toISOString(),
    }));

  if (rows.length) {
    const { error } = await supabase
      .from('events')
      .upsert(rows, { onConflict: 'household_id,provider,provider_event_id' });
    if (error) throw error;
  }

  const current = await getDeviceCalendarSettings();
  await saveDeviceCalendarSettings({
    ...current,
    selectedCalendarIds: input.calendarIds,
    lastSyncedAt: new Date().toISOString(),
  });
  return rows.length;
}

export async function writeApprovedEventToDevice(input: {
  id: string;
  title: string;
  startsAt: string;
  endsAt?: string | null;
  location?: string | null;
  notes?: string | null;
  reminderMinutes?: number | null;
}) {
  if (Platform.OS === 'web') return null;
  const settings = await getDeviceCalendarSettings();
  if (!settings.writeBackCalendarId) return null;

  const dedupeKey = `coho-device-event:${input.id}`;
  if (await AsyncStorage.getItem(dedupeKey)) return null;

  const startDate = new Date(input.startsAt);
  const endDate = input.endsAt
    ? new Date(input.endsAt)
    : new Date(startDate.getTime() + 60 * 60 * 1000);
  const eventId = await Calendar.createEventAsync(settings.writeBackCalendarId, {
    title: input.title,
    startDate,
    endDate,
    location: input.location || undefined,
    notes: [input.notes, 'Created by Coho'].filter(Boolean).join('\n\n'),
    alarms: input.reminderMinutes
      ? [{ relativeOffset: -Math.abs(input.reminderMinutes) }]
      : undefined,
  });
  await AsyncStorage.setItem(dedupeKey, eventId);
  return eventId;
}
