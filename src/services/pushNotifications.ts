import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { supabase } from '../lib/supabase';

const EAS_PROJECT_ID = '7b3c09f6-d932-4a01-943b-a74fe2a4fd88';

type BriefingPreferences = {
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
};

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
    last_seen_at: new Date().toISOString(),
  }, { onConflict: 'expo_push_token' });
  if (error) throw error;
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
    event_reminders: preferences.push,
    chore_reminders: preferences.push,
    messages: preferences.messages && preferences.push,
    push_delivery: preferences.push,
    email_copy: preferences.email,
    recap_time: databaseTime(preferences.dailyTime),
    timezone,
    week_ahead: preferences.weekAhead && (preferences.push || preferences.email),
    week_ahead_weekday: weekdayIndex(preferences.weekAheadDay),
    week_ahead_time: databaseTime(preferences.weekAheadTime),
    follow_up: preferences.followUp && (preferences.push || preferences.email),
    follow_up_weekday: weekdayIndex(preferences.followUpDay),
    follow_up_time: databaseTime(preferences.followUpTime),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  if (error) throw error;
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
