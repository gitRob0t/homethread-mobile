import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';

import { supabase } from '../lib/supabase';

export const COHO_LOCATION_TASK = 'coho-consented-location';
export const COHO_GEOFENCE_TASK = 'coho-family-places';
export const LOCATION_CONTEXT_KEY = 'coho-location-context-v1';

type LocationContext = {
  householdId: string;
  userId: string;
  precision: 'approximate' | 'precise';
};

function sharedCoordinates(
  latitude: number,
  longitude: number,
  precision: LocationContext['precision'],
) {
  if (precision === 'precise') return { latitude, longitude };
  return {
    latitude: Math.round(latitude * 100) / 100,
    longitude: Math.round(longitude * 100) / 100,
  };
}

if (!TaskManager.isTaskDefined(COHO_LOCATION_TASK)) {
  TaskManager.defineTask<{ locations: Location.LocationObject[] }>(
    COHO_LOCATION_TASK,
    async ({ data, error }) => {
      if (error || !data?.locations?.length) return;
      const raw = await AsyncStorage.getItem(LOCATION_CONTEXT_KEY);
      if (!raw) return;
      const context = JSON.parse(raw) as LocationContext;
      const latest = data.locations[data.locations.length - 1];
      const coordinates = sharedCoordinates(
        latest.coords.latitude,
        latest.coords.longitude,
        context.precision,
      );
      await supabase.from('member_locations').upsert({
        user_id: context.userId,
        household_id: context.householdId,
        ...coordinates,
        accuracy_meters: latest.coords.accuracy,
        precision: context.precision,
        captured_at: new Date(latest.timestamp).toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,household_id' });
    },
  );
}

if (!TaskManager.isTaskDefined(COHO_GEOFENCE_TASK)) {
  TaskManager.defineTask<{
    eventType: Location.GeofencingEventType;
    region: Location.LocationRegion;
  }>(COHO_GEOFENCE_TASK, async ({ data, error }) => {
    if (error || !data?.region?.identifier) return;
    const raw = await AsyncStorage.getItem(LOCATION_CONTEXT_KEY);
    if (!raw) return;
    const context = JSON.parse(raw) as LocationContext;
    const eventType = data.eventType === Location.GeofencingEventType.Enter ? 'enter' : 'exit';
    const placeId = data.region.identifier;
    await supabase.from('place_activity').insert({
      household_id: context.householdId,
      place_id: placeId,
      user_id: context.userId,
      event_type: eventType,
      occurred_at: new Date().toISOString(),
    });

    const { data: place } = await supabase
      .from('family_places')
      .select('name')
      .eq('id', placeId)
      .maybeSingle();
    const permission = await Notifications.getPermissionsAsync();
    if (permission.granted && place?.name) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: eventType === 'enter' ? `Arrived at ${place.name}` : `Left ${place.name}`,
          body: 'Coho recorded this because you enabled Family Places alerts.',
          sound: 'default',
        },
        trigger: null,
      });
    }
  });
}
