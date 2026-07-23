import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { Platform } from 'react-native';

import { supabase } from '../lib/supabase';
import {
  COHO_GEOFENCE_TASK,
  COHO_LOCATION_TASK,
  LOCATION_CONTEXT_KEY,
} from './locationTasks';

export type LocationPrecision = 'approximate' | 'precise';

export type FamilyPlace = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
  created_at: string;
};

export type MemberLocation = {
  user_id: string;
  latitude: number;
  longitude: number;
  accuracy_meters: number | null;
  precision: LocationPrecision;
  captured_at: string;
  updated_at: string;
  profile?: { display_name?: string; avatar_url?: string | null } | Array<{ display_name?: string; avatar_url?: string | null }>;
};

export type LocationSharingState = {
  sharing_enabled: boolean;
  precision: LocationPrecision;
  place_alerts_enabled: boolean;
};

const defaultState: LocationSharingState = {
  sharing_enabled: false,
  precision: 'approximate',
  place_alerts_enabled: false,
};

export async function getLocationSharingState(
  householdId: string,
  userId: string,
): Promise<LocationSharingState> {
  const { data, error } = await supabase
    .from('member_location_settings')
    .select('sharing_enabled, precision, place_alerts_enabled')
    .eq('household_id', householdId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data ? { ...defaultState, ...data } : defaultState;
}

async function saveSharingState(
  householdId: string,
  userId: string,
  patch: Partial<LocationSharingState>,
) {
  const current = await getLocationSharingState(householdId, userId);
  const next = { ...current, ...patch };
  const { error } = await supabase.from('member_location_settings').upsert({
    user_id: userId,
    household_id: householdId,
    ...next,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,household_id' });
  if (error) throw error;
  await AsyncStorage.setItem(LOCATION_CONTEXT_KEY, JSON.stringify({
    householdId,
    userId,
    precision: next.precision,
  }));
  return next;
}

function shareableCoordinates(
  latitude: number,
  longitude: number,
  precision: LocationPrecision,
) {
  if (precision === 'precise') return { latitude, longitude };
  return {
    latitude: Math.round(latitude * 100) / 100,
    longitude: Math.round(longitude * 100) / 100,
  };
}

export async function shareCurrentLocation(input: {
  householdId: string;
  userId: string;
  precision: LocationPrecision;
}) {
  if (Platform.OS === 'web') throw new Error('Location sharing requires the Coho mobile app.');
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) throw new Error('Location permission was not granted.');
  await saveSharingState(input.householdId, input.userId, {
    sharing_enabled: true,
    precision: input.precision,
  });
  const location = await Location.getCurrentPositionAsync({
    accuracy: input.precision === 'precise' ? Location.Accuracy.High : Location.Accuracy.Balanced,
  });
  const coordinates = shareableCoordinates(
    location.coords.latitude,
    location.coords.longitude,
    input.precision,
  );
  const { error } = await supabase.from('member_locations').upsert({
    user_id: input.userId,
    household_id: input.householdId,
    ...coordinates,
    accuracy_meters: location.coords.accuracy,
    precision: input.precision,
    captured_at: new Date(location.timestamp).toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,household_id' });
  if (error) throw error;
  return location;
}

export async function enableLivePlaceAlerts(input: {
  householdId: string;
  userId: string;
  precision: LocationPrecision;
}) {
  await shareCurrentLocation(input);
  const backgroundAvailable = await Location.isBackgroundLocationAvailableAsync();
  if (!backgroundAvailable) throw new Error('Background location is not available on this device.');
  const backgroundPermission = await Location.requestBackgroundPermissionsAsync();
  if (!backgroundPermission.granted) {
    throw new Error('Always-on location was not granted. Manual location sharing remains enabled.');
  }
  await saveSharingState(input.householdId, input.userId, {
    sharing_enabled: true,
    precision: input.precision,
    place_alerts_enabled: true,
  });
  await Location.startLocationUpdatesAsync(COHO_LOCATION_TASK, {
    accuracy: Location.Accuracy.Balanced,
    distanceInterval: 150,
    deferredUpdatesDistance: 250,
    deferredUpdatesInterval: 5 * 60 * 1000,
    pausesUpdatesAutomatically: true,
    showsBackgroundLocationIndicator: false,
  });
  await refreshPlaceGeofences(input.householdId);
}

export async function refreshPlaceGeofences(householdId: string) {
  const places = await listFamilyPlaces(householdId);
  if (!places.length) {
    if (await Location.hasStartedGeofencingAsync(COHO_GEOFENCE_TASK)) {
      await Location.stopGeofencingAsync(COHO_GEOFENCE_TASK);
    }
    return;
  }
  await Location.startGeofencingAsync(
    COHO_GEOFENCE_TASK,
    places.slice(0, 20).map((place) => ({
      identifier: place.id,
      latitude: place.latitude,
      longitude: place.longitude,
      radius: place.radius_meters,
      notifyOnEnter: true,
      notifyOnExit: true,
    })),
  );
}

export async function disableLocationSharing(householdId: string, userId: string) {
  if (await Location.hasStartedLocationUpdatesAsync(COHO_LOCATION_TASK)) {
    await Location.stopLocationUpdatesAsync(COHO_LOCATION_TASK);
  }
  if (await Location.hasStartedGeofencingAsync(COHO_GEOFENCE_TASK)) {
    await Location.stopGeofencingAsync(COHO_GEOFENCE_TASK);
  }
  await Promise.all([
    supabase.from('member_locations').delete()
      .eq('household_id', householdId)
      .eq('user_id', userId),
    supabase.from('member_location_settings').upsert({
      user_id: userId,
      household_id: householdId,
      sharing_enabled: false,
      place_alerts_enabled: false,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,household_id' }),
  ]);
  await AsyncStorage.removeItem(LOCATION_CONTEXT_KEY);
}

export async function listFamilyPlaces(householdId: string) {
  const { data, error } = await supabase
    .from('family_places')
    .select('id, name, latitude, longitude, radius_meters, created_at')
    .eq('household_id', householdId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as FamilyPlace[];
}

export async function createFamilyPlaceFromCurrentLocation(input: {
  householdId: string;
  userId: string;
  name: string;
  radiusMeters: number;
}) {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) throw new Error('Location permission was not granted.');
  const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  const { data, error } = await supabase.from('family_places').insert({
    household_id: input.householdId,
    created_by: input.userId,
    name: input.name.trim(),
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    radius_meters: input.radiusMeters,
  }).select('id').single();
  if (error) throw error;
  const state = await getLocationSharingState(input.householdId, input.userId);
  if (state.place_alerts_enabled) await refreshPlaceGeofences(input.householdId);
  return data;
}

export async function listMemberLocations(householdId: string) {
  const { data, error } = await supabase
    .from('member_locations')
    .select('user_id, latitude, longitude, accuracy_meters, precision, captured_at, updated_at, profile:profiles!member_locations_user_id_fkey(display_name, avatar_url)')
    .eq('household_id', householdId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as MemberLocation[];
}

export async function clearLocationTrackingForSignOut() {
  if (Platform.OS === 'web') return;
  if (await Location.hasStartedLocationUpdatesAsync(COHO_LOCATION_TASK)) {
    await Location.stopLocationUpdatesAsync(COHO_LOCATION_TASK);
  }
  if (await Location.hasStartedGeofencingAsync(COHO_GEOFENCE_TASK)) {
    await Location.stopGeofencingAsync(COHO_GEOFENCE_TASK);
  }
  await AsyncStorage.removeItem(LOCATION_CONTEXT_KEY);
}
