import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { supabase } from '../lib/supabase';

const EAS_PROJECT_ID = '7b3c09f6-d932-4a01-943b-a74fe2a4fd88';

export type BriefingPreferences = {
  daily: boolean;
  dailyTime: string;
  weekAhead: boolean;
  weekAheadDay: string;
  weekAheadTime: string;
  followUp: boolean;
  followUpDay: string;
  followUpTime: string;
  push: boolean;
  email: boolean;
  messages: boolean;
  events: boolean;
  chores: boolean;
  followUps: boolean;
  quietHours: boolean;
};

export type StoredBriefingPreferences = Partial<BriefingPreferences>;

export async function registerPushDevice(
  userId: string,
  householdId: string | null,
) {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return null;
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return null;
  const token = (await Notifications.getExpoPushTokenAsync({
    projectId: EAS_PROJECT_ID,
  })).data;
  const { error } = await supabase.from('device_push_tokens').upsert({
    user_id: userId,
    household_id: householdId,
    expo_push_token: token,
    platform: Platform.OS,
    enabled: true,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    locale: Intl.DateTimeFormat().resolvedOptions().locale || 'en-US',
    last_seen_at: new Date().toISOString(),
  }, { onConflict: 'expo_push_token' });
  if (error) throw error;
  if (householdId) {
    await supabase.from('member_onboarding_state').upsert({
      household_id: householdId,
      user_id: userId,
      notifications_completed: true,
      last_active_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'household_id,user_id' });
  }
  return token;
}

export async function syncBriefingPreferences(
  userId: string,
  preferences: BriefingPreferences,
) {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const { error } = await supabase.from('notification_preferences').upsert({
    user_id: userId,
    daily_recap: preferences.daily && (preferences.push || preferences.email),
    event_reminders: preferences.events && preferences.push,
    chore_reminders: preferences.chores && preferences.push,
    messages: preferences.messages && preferences.push,
    push_delivery: preferences.push,
    email_copy: preferences.email,
    recap_time: databaseTime(preferences.dailyTime),
    timezone,
    week_ahead: preferences.weekAhead && (preferences.push || preferences.email),
    week_ahead_weekday: weekdayIndex(preferences.weekAheadDay),
    week_ahead_time: databaseTime(preferences.weekAheadTime),
    follow_up: preferences.followUp && preferences.followUps && (preferences.push || preferences.email),
    follow_up_weekday: weekdayIndex(preferences.followUpDay),
    follow_up_time: databaseTime(preferences.followUpTime),
    quiet_hours: preferences.quietHours,
    quiet_hours_start: '21:00:00',
    quiet_hours_end: '07:00:00',
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  if (error) throw error;
}

export async function loadBriefingPreferences(
  userId: string,
): Promise<StoredBriefingPreferences | null> {
  const { data, error } = await supabase
    .from('notification_preferences')
    .select('daily_recap, event_reminders, chore_reminders, messages, recap_time, week_ahead, week_ahead_weekday, week_ahead_time, follow_up, follow_up_weekday, follow_up_time, push_delivery, email_copy, quiet_hours')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    daily: data.daily_recap !== false,
    dailyTime: displayTime(data.recap_time, '7:00 AM'),
    weekAhead: data.week_ahead !== false,
    weekAheadDay: weekdayName(data.week_ahead_weekday, 'Sunday'),
    weekAheadTime: displayTime(data.week_ahead_time, '6:00 PM'),
    followUp: data.follow_up !== false,
    followUpDay: weekdayName(data.follow_up_weekday, 'Friday'),
    followUpTime: displayTime(data.follow_up_time, '5:00 PM'),
    push: data.push_delivery !== false,
    email: data.email_copy === true,
    events: data.event_reminders !== false,
    chores: data.chore_reminders !== false,
    messages: data.messages !== false,
    followUps: data.follow_up !== false,
    quietHours: data.quiet_hours !== false,
  };
}

function databaseTime(value: string) {
  const match = value.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  let hour = Number(match?.[1] ?? 7);
  const minute = Number(match?.[2] ?? 0);
  if (match?.[3]?.toUpperCase() === 'PM' && hour < 12) hour += 12;
  if (match?.[3]?.toUpperCase() === 'AM' && hour === 12) hour = 0;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
}

function weekdayIndex(day: string) {
  const value = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].indexOf(day);
  return value < 0 ? 0 : value;
}

function weekdayName(value: unknown, fallback: string) {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const index = Number(value);
  return Number.isInteger(index) && days[index] ? days[index] : fallback;
}

function displayTime(value: unknown, fallback: string) {
  const match = String(value ?? '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) return fallback;
  const hour = Number(match[1]);
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return fallback;
  const meridiem = hour >= 12 ? 'PM' : 'AM';
  return `${hour % 12 || 12}:${match[2]} ${meridiem}`;
}
