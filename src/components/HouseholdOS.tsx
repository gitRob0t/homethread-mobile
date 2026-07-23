import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  type CalendarConflict,
  type CalendarConnection,
  type CalendarProvider,
  disconnectCalendarConnection,
  listCalendarConflicts,
  listCalendarConnections,
  resolveCalendarConflict,
  saveCalendarConnectionSettings,
  startCalendarConnection,
  syncCalendarConnection,
} from '../services/calendarConnections';
import {
  type DeviceCalendarSettings,
  type DeviceCalendarSummary,
  getDeviceCalendarSettings,
  hasDeviceCalendarAccess,
  importSelectedDeviceCalendars,
  listDeviceCalendars,
  requestDeviceCalendarAccess,
  saveDeviceCalendarSettings,
} from '../services/deviceCalendar';
import {
  type FamilyPlace,
  type LocationPrecision,
  type LocationSharingState,
  type MemberLocation,
  createFamilyPlaceFromCurrentLocation,
  disableLocationSharing,
  enableLivePlaceAlerts,
  getLocationSharingState,
  listFamilyPlaces,
  listMemberLocations,
  shareCurrentLocation,
} from '../services/familyLocation';
import {
  type GroceryItem,
  type MealPlan,
  type TravelEvent,
  type TravelSpace,
  addGroceryItems,
  addTravelEvent,
  createTravelInvitation,
  createTravelSpace,
  createInstacartShoppingLink,
  listGroceries,
  listMealPlans,
  listTravelEvents,
  listTravelSpaces,
  setGroceryChecked,
  subscribeToOperations,
  upsertMealPlans,
} from '../services/householdOperations';

type CommonProps = {
  dark: boolean;
  householdId: string | null;
  userId: string | null;
  onNotice: (message: string) => void;
};

export function CalendarConnectionScreen({
  dark,
  householdId,
  userId,
  onNotice,
  onConnected,
  onSynced,
}: CommonProps & {
  onConnected: (source: CalendarProvider | 'device') => void;
  onSynced?: () => void | Promise<void>;
}) {
  const styles = useMemo(() => makeStyles(dark), [dark]);
  const [calendars, setCalendars] = useState<DeviceCalendarSummary[]>([]);
  const [settings, setSettings] = useState<DeviceCalendarSettings>({
    selectedCalendarIds: [],
    writeBackCalendarId: null,
    lastSyncedAt: null,
  });
  const [granted, setGranted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cloudConnections, setCloudConnections] = useState<CalendarConnection[]>([]);
  const [conflicts, setConflicts] = useState<CalendarConflict[]>([]);

  async function loadCloudConnections() {
    if (!householdId) return;
    const [connections, conflicts] = await Promise.all([
      listCalendarConnections(householdId),
      listCalendarConflicts(householdId),
    ]);
    setCloudConnections(connections);
    setConflicts(conflicts);
    connections
      .filter((connection) => connection.status === 'active')
      .forEach((connection) => onConnected(connection.provider));
  }

  useEffect(() => {
    Promise.all([getDeviceCalendarSettings(), hasDeviceCalendarAccess()])
      .then(async ([saved, hasAccess]) => {
        setSettings(saved);
        setGranted(hasAccess);
        if (hasAccess) setCalendars(await listDeviceCalendars());
      })
      .catch(() => undefined);
    void loadCloudConnections().catch(() => undefined);
    const subscription = Linking.addEventListener('url', ({ url }) => {
      if (/^(?:coho|homethread):\/\/calendar-connected\//i.test(url)) {
        setTimeout(() => void loadCloudConnections().catch(() => undefined), 700);
      }
    });
    return () => subscription.remove();
  }, [householdId]);

  async function connectProvider(provider: CalendarProvider) {
    if (!householdId) {
      setError('Join a Coho household before connecting a calendar.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const authorizationUrl = await startCalendarConnection(householdId, provider);
      await Linking.openURL(authorizationUrl);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'The provider connection could not start.');
    } finally {
      setBusy(false);
    }
  }

  function toggleCloudCalendar(connectionId: string, calendarId: string) {
    setCloudConnections((current) => current.map((connection) => connection.id === connectionId
      ? {
        ...connection,
        selected_calendars: connection.selected_calendars.map((calendar) =>
          calendar.id === calendarId ? { ...calendar, selected: !calendar.selected } : calendar),
      }
      : connection));
  }

  async function saveCloudConnection(connection: CalendarConnection) {
    setBusy(true);
    setError('');
    try {
      await saveCalendarConnectionSettings({
        connectionId: connection.id,
        selectedCalendarIds: connection.selected_calendars
          .filter((calendar) => calendar.selected)
          .map((calendar) => calendar.id),
        defaultWriteCalendarId: connection.default_write_calendar_id,
        syncEnabled: connection.sync_enabled,
      });
      onNotice('Calendar choices saved. Coho is syncing changes both ways.');
      await loadCloudConnections();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Calendar choices could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  async function syncCloudConnection(connection: CalendarConnection) {
    setBusy(true);
    setError('');
    try {
      const result = await syncCalendarConnection(connection.id);
      const summary = result.results?.[0];
      if (summary && !summary.ok) throw new Error(summary.error || 'Calendar sync failed.');
      onNotice(`Calendar synced · ${summary?.imported ?? 0} in · ${summary?.exported ?? 0} out`);
      await loadCloudConnections();
      await Promise.resolve(onSynced?.()).catch(() => undefined);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Calendar sync failed.');
    } finally {
      setBusy(false);
    }
  }

  async function disconnectCloud(connection: CalendarConnection) {
    setBusy(true);
    setError('');
    try {
      await disconnectCalendarConnection(connection.id);
      await loadCloudConnections();
      onNotice(`${connection.provider === 'google' ? 'Google' : 'Outlook'} Calendar disconnected`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Calendar connection could not be removed.');
    } finally {
      setBusy(false);
    }
  }

  async function resolveConflict(
    conflict: CalendarConflict,
    resolution: 'keep_local' | 'keep_provider',
  ) {
    setBusy(true);
    setError('');
    try {
      await resolveCalendarConflict(conflict.id, resolution);
      await loadCloudConnections();
      onNotice(resolution === 'keep_local'
        ? 'The Coho version now matches the connected calendar.'
        : 'The connected calendar version is now in Coho.');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'The calendar conflict could not be resolved.');
    } finally {
      setBusy(false);
    }
  }

  async function connect() {
    setBusy(true);
    setError('');
    try {
      const allowed = await requestDeviceCalendarAccess();
      setGranted(allowed);
      if (!allowed) {
        setError('Calendar access was not granted. You can change this in iPhone Settings.');
        return;
      }
      const next = await listDeviceCalendars();
      setCalendars(next);
      onNotice(`${next.length} iPhone calendar${next.length === 1 ? '' : 's'} available`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Unable to read iPhone calendars.');
    } finally {
      setBusy(false);
    }
  }

  function toggleCalendar(id: string) {
    setSettings((current) => ({
      ...current,
      selectedCalendarIds: current.selectedCalendarIds.includes(id)
        ? current.selectedCalendarIds.filter((item) => item !== id)
        : [...current.selectedCalendarIds, id],
    }));
  }

  async function sync() {
    if (!householdId || !userId) {
      setError('Join a Coho household before importing a calendar.');
      return;
    }
    if (!settings.selectedCalendarIds.length) {
      setError('Choose at least one calendar to import.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await importSelectedDeviceCalendars({
        householdId,
        userId,
        calendarIds: settings.selectedCalendarIds,
      });
      const next = {
        ...settings,
        lastSyncedAt: new Date().toISOString(),
      };
      await saveDeviceCalendarSettings(next);
      setSettings(next);
      onConnected('device');
      await Promise.resolve(onSynced?.()).catch(() => undefined);
      onNotice(
        `${result.synced} event${result.synced === 1 ? '' : 's'} synced`
        + (result.removed
          ? ` · ${result.removed} deleted event${result.removed === 1 ? '' : 's'} removed from Coho`
          : ''),
      );
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Calendar sync failed.');
    } finally {
      setBusy(false);
    }
  }

  async function chooseWriteBack(calendarId: string | null) {
    const next = { ...settings, writeBackCalendarId: calendarId };
    setSettings(next);
    await saveDeviceCalendarSettings(next);
    if (calendarId) onConnected('device');
    onNotice(calendarId
      ? 'Approved Coho events will also be saved to that iPhone calendar'
      : 'iPhone calendar write-back is off');
  }

  const writable = calendars.filter((calendar) => calendar.allowsModifications);
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={[styles.hero, { backgroundColor: '#2257F4' }]}>
        <Ionicons name="calendar" size={27} color="#fff" />
        <Text style={styles.heroEyebrow}>REAL DEVICE CONNECTION</Text>
        <Text style={styles.heroTitle}>Choose what Coho can see.</Text>
        <Text style={styles.heroText}>
          iPhone Calendar already combines iCloud, Google, Outlook, subscriptions, and other accounts
          you added to this phone. Coho imports only calendars you select.
        </Text>
      </View>

      <Text style={styles.sectionTitle}>Direct two-way connections</Text>
      <Text style={styles.meta}>Provider tokens stay encrypted on the server. Imported events keep their source and Coho detects simultaneous edits instead of silently overwriting them.</Text>
      {(['google', 'outlook'] as CalendarProvider[]).map((provider) => {
        const providerConnections = cloudConnections.filter((connection) =>
          connection.provider === provider && connection.status !== 'disconnected');
        if (!providerConnections.length) {
          return <Pressable key={provider} disabled={busy} onPress={() => connectProvider(provider)} style={styles.providerCard}>
            <View style={[styles.roundIcon, { backgroundColor: provider === 'google' ? '#4285F420' : '#0078D420' }]}>
              <Ionicons name={provider === 'google' ? 'logo-google' : 'logo-microsoft'} size={21} color={provider === 'google' ? '#4285F4' : '#0078D4'} />
            </View>
            <View style={styles.flex}><Text style={styles.rowTitle}>Connect {provider === 'google' ? 'Google' : 'Outlook'} Calendar</Text><Text style={styles.meta}>OAuth · recurring events · incremental two-way sync</Text></View>
            <Ionicons name="chevron-forward" size={19} color={styles.icon.color} />
          </Pressable>;
        }
        return providerConnections.map((connection) => <View key={connection.id} style={styles.settingCard}>
          <View style={styles.settingTop}>
            <View style={[styles.roundIcon, { backgroundColor: provider === 'google' ? '#4285F420' : '#0078D420' }]}>
              <Ionicons name={provider === 'google' ? 'logo-google' : 'logo-microsoft'} size={21} color={provider === 'google' ? '#4285F4' : '#0078D4'} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.rowTitle}>{connection.display_name || connection.provider_email || `${provider} calendar`}</Text>
              <Text style={styles.meta}>{connection.status === 'active' ? `Last synced ${connection.last_synced_at ? relativeTime(connection.last_synced_at) : 'not yet'}` : connection.status}</Text>
            </View>
            <View style={styles.successPill}><Ionicons name={connection.status === 'active' ? 'checkmark-circle' : 'warning'} size={15} color={connection.status === 'active' ? '#168866' : '#B46B12'} /><Text style={styles.successText}>{connection.status}</Text></View>
          </View>
          {connection.selected_calendars.map((calendar) => <Pressable key={calendar.id} onPress={() => toggleCloudCalendar(connection.id, calendar.id)} style={[styles.row, calendar.selected && styles.rowSelected]}>
            <View style={[styles.colorDot, { backgroundColor: calendar.color || '#2257F4' }]} />
            <View style={styles.flex}><Text style={styles.rowTitle}>{calendar.name}</Text><Text style={styles.meta}>{calendar.primary ? 'Primary · ' : ''}{calendar.canWrite === false ? 'Read only' : 'Read and write'}</Text></View>
            <Ionicons name={calendar.selected ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={calendar.selected ? '#19A47B' : styles.icon.color} />
          </Pressable>)}
          <Text style={styles.label}>WRITE NEW COHO EVENTS TO</Text>
          <View style={styles.chips}>
            <Pressable onPress={() => setCloudConnections((current) => current.map((item) => item.id === connection.id ? { ...item, default_write_calendar_id: null } : item))} style={[styles.chip, !connection.default_write_calendar_id && styles.chipActive]}><Text style={[styles.chipText, !connection.default_write_calendar_id && styles.chipTextActive]}>Coho only</Text></Pressable>
            {connection.selected_calendars.filter((calendar) => calendar.canWrite !== false).map((calendar) => <Pressable key={`write-${calendar.id}`} onPress={() => setCloudConnections((current) => current.map((item) => item.id === connection.id ? { ...item, default_write_calendar_id: calendar.id } : item))} style={[styles.chip, connection.default_write_calendar_id === calendar.id && styles.chipActive]}><Text style={[styles.chipText, connection.default_write_calendar_id === calendar.id && styles.chipTextActive]}>{calendar.name}</Text></Pressable>)}
          </View>
          {!!connection.last_error && <Text style={styles.error}>{connection.last_error}</Text>}
          <View style={styles.actionGrid}>
            <Pressable disabled={busy} onPress={() => saveCloudConnection(connection)} style={styles.primaryButton}><Ionicons name="save-outline" size={17} color="#fff" /><Text style={styles.primaryButtonText}>Save & sync</Text></Pressable>
            <Pressable disabled={busy} onPress={() => syncCloudConnection(connection)} style={styles.secondaryButton}><Ionicons name="sync" size={17} color="#2257F4" /><Text style={styles.secondaryButtonText}>Sync now</Text></Pressable>
          </View>
          <Pressable disabled={busy} onPress={() => disconnectCloud(connection)} style={styles.secondaryButton}><Ionicons name="unlink-outline" size={17} color="#D34A3B" /><Text style={[styles.secondaryButtonText, { color: '#D34A3B' }]}>Disconnect this account</Text></Pressable>
        </View>);
      })}
      {conflicts.length > 0 && <>
        <View style={styles.conflictNotice}>
          <Ionicons name="git-compare-outline" size={20} color="#B46B12" />
          <View style={styles.flex}>
            <Text style={styles.rowTitle}>{conflicts.length} simultaneous calendar edit{conflicts.length === 1 ? '' : 's'} need your choice</Text>
            <Text style={styles.meta}>Both versions are safe. Pick the one the family should keep.</Text>
          </View>
        </View>
        {conflicts.map((conflict) => {
          const connection = cloudConnections.find((item) => item.id === conflict.connection_id);
          const providerName = connection?.provider === 'outlook' ? 'Outlook' : 'Google';
          const localVersion = calendarConflictVersion(conflict.local_payload, 'local');
          const providerVersion = calendarConflictVersion(conflict.provider_payload, 'provider');
          return <View key={conflict.id} style={styles.conflictCard}>
            <View style={styles.settingTop}>
              <View style={[styles.roundIcon, { backgroundColor: '#B46B1218' }]}>
                <Ionicons name="calendar-outline" size={20} color="#B46B12" />
              </View>
              <View style={styles.flex}>
                <Text style={styles.rowTitle}>{localVersion.title || providerVersion.title || 'Calendar event'}</Text>
                <Text style={styles.meta}>Edited in both Coho and {providerName}</Text>
              </View>
            </View>
            <View style={styles.versionCard}>
              <Text style={styles.versionLabel}>COHO VERSION</Text>
              <Text style={styles.versionTitle}>{localVersion.title}</Text>
              <Text style={styles.meta}>{localVersion.when}</Text>
              {!!localVersion.location && <Text style={styles.meta}>{localVersion.location}</Text>}
            </View>
            <View style={styles.versionCard}>
              <Text style={styles.versionLabel}>{providerName.toUpperCase()} VERSION</Text>
              <Text style={styles.versionTitle}>{providerVersion.deleted ? 'Deleted from calendar' : providerVersion.title}</Text>
              {!providerVersion.deleted && <Text style={styles.meta}>{providerVersion.when}</Text>}
              {!providerVersion.deleted && !!providerVersion.location && <Text style={styles.meta}>{providerVersion.location}</Text>}
            </View>
            <View style={styles.actionGrid}>
              <Pressable disabled={busy} onPress={() => resolveConflict(conflict, 'keep_local')} style={[styles.primaryButton, styles.flex]}>
                <Ionicons name="sparkles" size={16} color="#fff" />
                <Text style={styles.primaryButtonText}>Keep Coho</Text>
              </Pressable>
              <Pressable disabled={busy} onPress={() => resolveConflict(conflict, 'keep_provider')} style={[styles.secondaryButton, styles.flex]}>
                <Ionicons name="cloud-done-outline" size={17} color="#2257F4" />
                <Text style={styles.secondaryButtonText}>Keep {providerName}</Text>
              </Pressable>
            </View>
          </View>;
        })}
      </>}

      <Text style={styles.sectionTitle}>This device</Text>
      {!granted ? (
        <Pressable disabled={busy} onPress={connect} style={styles.primaryButton}>
          {busy ? <ActivityIndicator color="#fff" /> : <>
            <Ionicons name="shield-checkmark" size={18} color="#fff" />
            <Text style={styles.primaryButtonText}>Choose iPhone calendars</Text>
          </>}
        </Pressable>
      ) : <>
        <Text style={styles.sectionTitle}>Read iPhone calendars into Coho</Text>
        {calendars.map((calendar) => {
          const selected = settings.selectedCalendarIds.includes(calendar.id);
          return (
            <Pressable key={calendar.id} onPress={() => toggleCalendar(calendar.id)} style={[styles.row, selected && styles.rowSelected]}>
              <View style={[styles.colorDot, { backgroundColor: calendar.color }]} />
              <View style={styles.flex}>
                <Text style={styles.rowTitle}>{calendar.title}</Text>
                <Text style={styles.meta}>{calendar.sourceName}</Text>
              </View>
              <Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={selected ? '#19A47B' : dark ? '#A8B1C4' : '#727D94'} />
            </Pressable>
          );
        })}
        <Pressable disabled={busy} onPress={sync} style={styles.primaryButton}>
          {busy ? <ActivityIndicator color="#fff" /> : <>
            <Ionicons name="sync" size={18} color="#fff" />
            <Text style={styles.primaryButtonText}>Sync selected calendars</Text>
          </>}
        </Pressable>
        {!!settings.lastSyncedAt && <Text style={styles.caption}>Last synced {relativeTime(settings.lastSyncedAt)}</Text>}

        <Text style={styles.sectionTitle}>Write approved Coho events</Text>
        <Pressable onPress={() => chooseWriteBack(null)} style={[styles.row, !settings.writeBackCalendarId && styles.rowSelected]}>
          <Ionicons name="ban-outline" size={21} color={dark ? '#A8B1C4' : '#727D94'} />
          <View style={styles.flex}><Text style={styles.rowTitle}>Do not write back</Text><Text style={styles.meta}>Keep Coho events inside the family calendar only</Text></View>
          {!settings.writeBackCalendarId && <Ionicons name="checkmark-circle" size={22} color="#19A47B" />}
        </Pressable>
        {writable.map((calendar) => (
          <Pressable key={`write-${calendar.id}`} onPress={() => chooseWriteBack(calendar.id)} style={[styles.row, settings.writeBackCalendarId === calendar.id && styles.rowSelected]}>
            <View style={[styles.colorDot, { backgroundColor: calendar.color }]} />
            <View style={styles.flex}><Text style={styles.rowTitle}>{calendar.title}</Text><Text style={styles.meta}>{calendar.sourceName}</Text></View>
            {settings.writeBackCalendarId === calendar.id && <Ionicons name="checkmark-circle" size={22} color="#19A47B" />}
          </Pressable>
        ))}
      </>}
      {!!error && <Text style={styles.error}>{error}</Text>}
      <View style={styles.privacyCard}>
        <Ionicons name="lock-closed" size={19} color="#19A47B" />
        <Text style={styles.privacyText}>iPhone calendar choices stay on this phone. Direct provider grants are encrypted and revocable. Imported records keep their source label, and Coho does not import attendees or private event notes.</Text>
      </View>
    </ScrollView>
  );
}

export function FamilyPlacesScreen({ dark, householdId, userId, onNotice }: CommonProps) {
  const styles = useMemo(() => makeStyles(dark), [dark]);
  const [sharing, setSharing] = useState<LocationSharingState>({
    sharing_enabled: false,
    precision: 'approximate',
    place_alerts_enabled: false,
  });
  const [places, setPlaces] = useState<FamilyPlace[]>([]);
  const [locations, setLocations] = useState<MemberLocation[]>([]);
  const [placeName, setPlaceName] = useState('');
  const [radius, setRadius] = useState(200);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    if (!householdId || !userId) return;
    const [nextSharing, nextPlaces, nextLocations] = await Promise.all([
      getLocationSharingState(householdId, userId),
      listFamilyPlaces(householdId),
      listMemberLocations(householdId),
    ]);
    setSharing(nextSharing);
    setPlaces(nextPlaces);
    setLocations(nextLocations);
  }

  useEffect(() => { void load().catch(() => undefined); }, [householdId, userId]);

  async function setLocationEnabled(enabled: boolean) {
    if (!householdId || !userId) return;
    setBusy(true);
    setError('');
    try {
      if (enabled) {
        await shareCurrentLocation({ householdId, userId, precision: sharing.precision });
        setSharing((current) => ({ ...current, sharing_enabled: true }));
        onNotice('Your current location is shared with this household');
      } else {
        await disableLocationSharing(householdId, userId);
        setSharing((current) => ({ ...current, sharing_enabled: false, place_alerts_enabled: false }));
        onNotice('Location sharing stopped and your last shared location was deleted');
      }
      await load();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Location sharing could not be changed.');
    } finally {
      setBusy(false);
    }
  }

  async function updateNow(precision = sharing.precision) {
    if (!householdId || !userId) return;
    setBusy(true);
    setError('');
    try {
      await shareCurrentLocation({ householdId, userId, precision });
      setSharing((current) => ({ ...current, sharing_enabled: true, precision }));
      await load();
      onNotice(`Location updated with ${precision} household sharing`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Location could not be updated.');
    } finally {
      setBusy(false);
    }
  }

  async function enableAlerts() {
    if (!householdId || !userId) return;
    setBusy(true);
    setError('');
    try {
      await enableLivePlaceAlerts({ householdId, userId, precision: sharing.precision });
      setSharing((current) => ({ ...current, sharing_enabled: true, place_alerts_enabled: true }));
      onNotice('Live sharing and Family Places alerts are on');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Live place alerts could not be enabled.');
    } finally {
      setBusy(false);
    }
  }

  async function addPlace() {
    if (!householdId || !userId || !placeName.trim()) return;
    setBusy(true);
    setError('');
    try {
      await createFamilyPlaceFromCurrentLocation({
        householdId,
        userId,
        name: placeName,
        radiusMeters: radius,
      });
      setPlaceName('');
      await load();
      onNotice('Family Place added at your current location');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'The Family Place could not be added.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={[styles.hero, { backgroundColor: '#168866' }]}>
        <Ionicons name="location" size={27} color="#fff" />
        <Text style={styles.heroEyebrow}>CONSENT-FIRST FAMILY AWARENESS</Text>
        <Text style={styles.heroTitle}>Useful location, not surveillance.</Text>
        <Text style={styles.heroText}>Each person opts in on their own phone, chooses approximate or precise sharing, and can erase their last location at any time.</Text>
      </View>

      <View style={styles.settingCard}>
        <View style={styles.settingTop}>
          <View style={styles.flex}><Text style={styles.rowTitle}>Share my phone location</Text><Text style={styles.meta}>{sharing.sharing_enabled ? `${capitalize(sharing.precision)} · updated only with consent` : 'Off by default'}</Text></View>
          {busy ? <ActivityIndicator color="#19A47B" /> : <Switch value={sharing.sharing_enabled} onValueChange={setLocationEnabled} trackColor={{ true: '#19A47B' }} />}
        </View>
        <Text style={styles.label}>WHAT THE HOUSEHOLD SEES</Text>
        <View style={styles.chips}>
          {(['approximate', 'precise'] as LocationPrecision[]).map((precision) => (
            <Pressable key={precision} onPress={() => updateNow(precision)} style={[styles.chip, sharing.precision === precision && styles.chipActive]}>
              <Text style={[styles.chipText, sharing.precision === precision && styles.chipTextActive]}>{capitalize(precision)}</Text>
            </Pressable>
          ))}
        </View>
        {sharing.sharing_enabled && <Pressable disabled={busy} onPress={() => updateNow()} style={styles.secondaryButton}><Ionicons name="navigate" size={17} color="#2257F4" /><Text style={styles.secondaryButtonText}>Update location now</Text></Pressable>}
        {sharing.sharing_enabled && !sharing.place_alerts_enabled && <Pressable disabled={busy} onPress={enableAlerts} style={styles.primaryButton}><Ionicons name="notifications" size={17} color="#fff" /><Text style={styles.primaryButtonText}>Enable live sharing & place alerts</Text></Pressable>}
        {sharing.place_alerts_enabled && <View style={styles.successPill}><Ionicons name="checkmark-circle" size={16} color="#168866" /><Text style={styles.successText}>Background sharing and geofences enabled</Text></View>}
      </View>

      <Text style={styles.sectionTitle}>Family now</Text>
      {locations.length === 0 ? <Empty icon="location-outline" title="No one is sharing yet" text="Each family member enables sharing from their own phone." styles={styles} /> : locations.map((location) => {
        const profile = Array.isArray(location.profile) ? location.profile[0] : location.profile;
        const nearby = nearestPlace(location, places);
        return (
          <Pressable key={location.user_id} onPress={() => openCoordinates(location.latitude, location.longitude)} style={styles.row}>
            <View style={[styles.roundIcon, { backgroundColor: '#19A47B18' }]}><Ionicons name="person" size={19} color="#168866" /></View>
            <View style={styles.flex}><Text style={styles.rowTitle}>{profile?.display_name || 'Family member'}</Text><Text style={styles.meta}>{nearby ? `${nearby.name} · ${nearby.distanceLabel}` : `${capitalize(location.precision)} location`} · {relativeTime(location.captured_at)}</Text></View>
            <Ionicons name="map-outline" size={20} color="#2257F4" />
          </Pressable>
        );
      })}

      <Text style={styles.sectionTitle}>Family Places</Text>
      {places.map((place) => (
        <Pressable key={place.id} onPress={() => openCoordinates(place.latitude, place.longitude)} style={styles.row}>
          <View style={[styles.roundIcon, { backgroundColor: '#2257F418' }]}><Ionicons name="home" size={19} color="#2257F4" /></View>
          <View style={styles.flex}><Text style={styles.rowTitle}>{place.name}</Text><Text style={styles.meta}>{place.radius_meters} m arrival/departure boundary</Text></View>
          <Ionicons name="chevron-forward" size={18} color={dark ? '#A8B1C4' : '#727D94'} />
        </Pressable>
      ))}
      <View style={styles.formCard}>
        <Text style={styles.rowTitle}>Add this location as a Place</Text>
        <TextInput value={placeName} onChangeText={setPlaceName} placeholder="Home, school, work, friend's house…" placeholderTextColor="#8790A3" style={styles.input} />
        <View style={styles.chips}>{[100, 200, 500].map((value) => <Pressable key={value} onPress={() => setRadius(value)} style={[styles.chip, radius === value && styles.chipActive]}><Text style={[styles.chipText, radius === value && styles.chipTextActive]}>{value} m</Text></Pressable>)}</View>
        <Pressable disabled={!placeName.trim() || busy} onPress={addPlace} style={[styles.primaryButton, (!placeName.trim() || busy) && styles.disabled]}><Text style={styles.primaryButtonText}>Add current location</Text></Pressable>
      </View>
      {!!error && <Text style={styles.error}>{error}</Text>}
      <View style={styles.privacyCard}><Ionicons name="shield-checkmark" size={19} color="#19A47B" /><Text style={styles.privacyText}>Coho uses the consenting person’s phone location. It does not access Apple Find My, AirTags, or another person’s device without their permission.</Text></View>
    </ScrollView>
  );
}

export function FoodHubScreen({ dark, householdId, userId, onNotice, onAskCoh }: CommonProps & { onAskCoh: (prompt: string) => void }) {
  const styles = useMemo(() => makeStyles(dark), [dark]);
  const week = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(new Date(), index)), []);
  const [groceries, setGroceries] = useState<GroceryItem[]>([]);
  const [meals, setMeals] = useState<MealPlan[]>([]);
  const [itemName, setItemName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [category, setCategory] = useState('Other');
  const [mealTitle, setMealTitle] = useState('');
  const [mealDate, setMealDate] = useState(dateKey(week[0]));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    if (!householdId) return;
    const [nextGroceries, nextMeals] = await Promise.all([
      listGroceries(householdId),
      listMealPlans(householdId, dateKey(week[0]), dateKey(week[6])),
    ]);
    setGroceries(nextGroceries);
    setMeals(nextMeals);
  }

  useEffect(() => {
    if (!householdId) return;
    void load().catch(() => undefined);
    const removeGroceries = subscribeToOperations('grocery_items', { column: 'household_id', value: householdId }, () => void load());
    const removeMeals = subscribeToOperations('meal_plans', { column: 'household_id', value: householdId }, () => void load());
    return () => { removeGroceries(); removeMeals(); };
  }, [householdId]);

  async function addItem() {
    if (!householdId || !userId || !itemName.trim()) return;
    setBusy(true);
    setError('');
    try {
      await addGroceryItems({ householdId, userId, items: [{ name: itemName, quantity, category }] });
      setItemName('');
      setQuantity('');
      await load();
      onNotice('Added to the shared grocery list');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Grocery item could not be added.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleItem(item: GroceryItem) {
    if (!userId) return;
    await setGroceryChecked(item.id, !item.checked, userId);
    await load();
  }

  async function addMeal() {
    if (!householdId || !userId || !mealTitle.trim()) return;
    setBusy(true);
    setError('');
    try {
      await upsertMealPlans({
        householdId,
        userId,
        meals: [{ date: mealDate, mealType: 'dinner', title: mealTitle }],
      });
      setMealTitle('');
      await load();
      onNotice('Dinner added to the shared week');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Meal could not be added.');
    } finally {
      setBusy(false);
    }
  }

  async function shopWithInstacart() {
    if (!householdId) return;
    setBusy(true);
    setError('');
    try {
      const result = await createInstacartShoppingLink(householdId);
      await Linking.openURL(result.url);
      onNotice(`${result.itemCount} grocery item${result.itemCount === 1 ? '' : 's'} sent to Instacart for review`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'The Instacart shopping link could not be created.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={[styles.hero, { backgroundColor: '#D7550D' }]}>
        <Ionicons name="restaurant" size={27} color="#fff" />
        <Text style={styles.heroEyebrow}>COH HOME CHEF</Text>
        <Text style={styles.heroTitle}>Plan once. Shop once. Eat better.</Text>
        <Text style={styles.heroText}>This week and the grocery list stay synced across the household. Coh can turn your preferences into a plan after you approve it.</Text>
      </View>

      <View style={styles.actionGrid}>
        <Pressable onPress={() => onAskCoh('Plan seven family dinners for the next week. Ask me about allergies, budget, schedule, leftovers, and foods the family dislikes before proposing the plan.')} style={[styles.actionTile, { backgroundColor: '#7047EE18' }]}>
          <Ionicons name="sparkles" size={23} color="#7047EE" /><Text style={styles.actionTitle}>Plan with Coh</Text><Text style={styles.meta}>Interactive 7-day meal plan</Text>
        </Pressable>
        <View style={[styles.actionTile, { backgroundColor: '#19A47B18' }]}>
          <Ionicons name="cart" size={23} color="#168866" /><Text style={styles.actionTitle}>{groceries.filter((item) => !item.checked).length} to buy</Text><Text style={styles.meta}>Live household list</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Dinner this week</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalCards}>
        {week.map((day) => {
          const meal = meals.find((item) => item.meal_date === dateKey(day) && item.meal_type === 'dinner');
          return (
            <Pressable key={dateKey(day)} onPress={() => setMealDate(dateKey(day))} style={[styles.dayCard, mealDate === dateKey(day) && styles.dayCardActive]}>
              <Text style={[styles.dayEyebrow, mealDate === dateKey(day) && styles.inverted]}>{day.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase()}</Text>
              <Text style={[styles.dayNumber, mealDate === dateKey(day) && styles.inverted]}>{day.getDate()}</Text>
              <Text numberOfLines={2} style={[styles.dayMeal, mealDate === dateKey(day) && styles.inverted]}>{meal?.title || 'Open'}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={styles.inlineForm}>
        <TextInput value={mealTitle} onChangeText={setMealTitle} placeholder={`Dinner for ${friendlyDate(mealDate)}`} placeholderTextColor="#8790A3" style={[styles.input, styles.flex]} />
        <Pressable disabled={!mealTitle.trim() || busy} onPress={addMeal} style={[styles.squareButton, (!mealTitle.trim() || busy) && styles.disabled]}><Ionicons name="add" size={22} color="#fff" /></Pressable>
      </View>

      <Text style={styles.sectionTitle}>Shared grocery list</Text>
      {groceries.length === 0 ? <Empty icon="basket-outline" title="The list is empty" text="Add the first item or ask Coh to build it from the meal plan." styles={styles} /> : groceries.map((item) => (
        <Pressable key={item.id} onPress={() => toggleItem(item)} style={[styles.row, item.checked && styles.checkedRow]}>
          <Ionicons name={item.checked ? 'checkmark-circle' : 'ellipse-outline'} size={23} color={item.checked ? '#19A47B' : '#2257F4'} />
          <View style={styles.flex}><Text style={[styles.rowTitle, item.checked && styles.struck]}>{item.name}</Text><Text style={styles.meta}>{[item.quantity, item.category].filter(Boolean).join(' · ')}</Text></View>
        </Pressable>
      ))}
      <View style={styles.formCard}>
        <View style={styles.inlineForm}>
          <TextInput value={itemName} onChangeText={setItemName} placeholder="Add grocery item" placeholderTextColor="#8790A3" style={[styles.input, styles.flex]} />
          <TextInput value={quantity} onChangeText={setQuantity} placeholder="Qty" placeholderTextColor="#8790A3" style={[styles.input, { width: 78 }]} />
        </View>
        <View style={styles.chips}>{['Produce', 'Dairy', 'Pantry', 'Frozen', 'Other'].map((item) => <Pressable key={item} onPress={() => setCategory(item)} style={[styles.chip, category === item && styles.chipActive]}><Text style={[styles.chipText, category === item && styles.chipTextActive]}>{item}</Text></Pressable>)}</View>
        <Pressable disabled={!itemName.trim() || busy} onPress={addItem} style={[styles.primaryButton, (!itemName.trim() || busy) && styles.disabled]}><Text style={styles.primaryButtonText}>Add to household list</Text></Pressable>
      </View>
      {!!error && <Text style={styles.error}>{error}</Text>}
      <Pressable disabled={busy || !groceries.some((item) => !item.checked)} onPress={shopWithInstacart} style={[styles.providerCard, (busy || !groceries.some((item) => !item.checked)) && styles.disabled]}><Ionicons name="storefront-outline" size={20} color="#2257F4" /><View style={styles.flex}><Text style={styles.rowTitle}>Shop this list with Instacart</Text><Text style={styles.meta}>Create a real shoppable list, choose a local store, review matches and prices, then check out with Instacart.</Text></View><Ionicons name="open-outline" size={18} color="#2257F4" /></Pressable>
    </ScrollView>
  );
}

export function TravelHubScreen({ dark, userId, onNotice, onAskCoh }: CommonProps & { onAskCoh: (prompt: string) => void }) {
  const styles = useMemo(() => makeStyles(dark), [dark]);
  const [spaces, setSpaces] = useState<TravelSpace[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [events, setEvents] = useState<TravelEvent[]>([]);
  const [title, setTitle] = useState('');
  const [destination, setDestination] = useState('');
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [eventTitle, setEventTitle] = useState('');
  const [eventDateTime, setEventDateTime] = useState('');
  const [eventLocation, setEventLocation] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function loadSpaces() {
    const next = await listTravelSpaces();
    setSpaces(next);
    setSelectedId((current) => current ?? next[0]?.id ?? null);
  }

  async function loadEvents(spaceId = selectedId) {
    if (!spaceId) return setEvents([]);
    setEvents(await listTravelEvents(spaceId));
  }

  useEffect(() => { void loadSpaces().catch(() => undefined); }, []);
  useEffect(() => {
    void loadEvents();
    if (!selectedId) return;
    return subscribeToOperations('travel_events', { column: 'travel_space_id', value: selectedId }, () => void loadEvents(selectedId));
  }, [selectedId]);

  async function addSpace() {
    if (!title.trim()) return;
    setBusy(true);
    setError('');
    try {
      const id = await createTravelSpace({ title, destination, startsOn, endsOn });
      setTitle(''); setDestination(''); setStartsOn(''); setEndsOn('');
      await loadSpaces();
      setSelectedId(id);
      onNotice('Private trip space created');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Trip space could not be created.');
    } finally {
      setBusy(false);
    }
  }

  async function addEvent() {
    if (!selectedId || !userId || !eventTitle.trim() || !eventDateTime.trim()) return;
    const date = new Date(eventDateTime.includes('T') ? eventDateTime : eventDateTime.replace(' ', 'T'));
    if (Number.isNaN(date.getTime())) {
      setError('Use the format YYYY-MM-DD HH:mm.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await addTravelEvent({
        travelSpaceId: selectedId,
        userId,
        title: eventTitle,
        startsAt: date.toISOString(),
        location: eventLocation,
      });
      setEventTitle(''); setEventDateTime(''); setEventLocation('');
      await loadEvents();
      onNotice('Added to the shared trip schedule');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Trip event could not be added.');
    } finally {
      setBusy(false);
    }
  }

  async function invite() {
    if (!selectedId || !inviteEmail.includes('@')) return;
    setBusy(true);
    setError('');
    try {
      const result = await createTravelInvitation(selectedId, inviteEmail);
      if (result?.invitation_token) {
        await Share.share({
          title: 'Join our Coho trip',
          message: `Join our private trip space on Coho: homethread://trip-invite/${result.invitation_token}`,
        });
      }
      setInviteEmail('');
      onNotice('Trip invitation created');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Trip invitation could not be created.');
    } finally {
      setBusy(false);
    }
  }

  const selected = spaces.find((space) => space.id === selectedId);
  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={[styles.hero, { backgroundColor: '#7047EE' }]}>
        <Ionicons name="airplane" size={27} color="#fff" />
        <Text style={styles.heroEyebrow}>VACATION & FRIEND CIRCLES</Text>
        <Text style={styles.heroTitle}>Plan together without merging households.</Text>
        <Text style={styles.heroText}>Invite another family into one trip schedule. They see the trip—not your household chat, chores, profiles, or location history.</Text>
      </View>

      {spaces.length > 0 && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalCards}>{spaces.map((space) => <Pressable key={space.id} onPress={() => setSelectedId(space.id)} style={[styles.tripPill, selectedId === space.id && styles.tripPillActive]}><Text style={[styles.chipText, selectedId === space.id && styles.chipTextActive]}>{space.title}</Text></Pressable>)}</ScrollView>}

      {selected ? <>
        <View style={styles.tripHero}>
          <View style={styles.flex}><Text style={styles.heroEyebrowDark}>ACTIVE TRIP SPACE</Text><Text style={styles.tripTitle}>{selected.title}</Text><Text style={styles.meta}>{[selected.destination, formatDateRange(selected.starts_on, selected.ends_on)].filter(Boolean).join(' · ')}</Text></View>
          <Ionicons name="people-circle" size={37} color="#7047EE" />
        </View>
        <View style={styles.actionGrid}>
          <Pressable onPress={() => onAskCoh(`Help plan our trip to ${selected.destination || selected.title}. Ask who is going, ages, budget, dates, food preferences, and pace before proposing activities and restaurants.`)} style={[styles.actionTile, { backgroundColor: '#7047EE18' }]}><Ionicons name="sparkles" size={22} color="#7047EE" /><Text style={styles.actionTitle}>Plan with Coh</Text><Text style={styles.meta}>Build an itinerary together</Text></Pressable>
          <Pressable onPress={() => openRestaurantSearch(selected.destination || selected.title)} style={[styles.actionTile, { backgroundColor: '#FF7A2E18' }]}><Ionicons name="restaurant" size={22} color="#D7550D" /><Text style={styles.actionTitle}>Find a table</Text><Text style={styles.meta}>Search real OpenTable listings</Text></Pressable>
        </View>

        <Text style={styles.sectionTitle}>Trip schedule</Text>
        {events.length === 0 ? <Empty icon="map-outline" title="Nothing scheduled yet" text="Add an activity, reservation, flight, or meetup." styles={styles} /> : events.map((event) => <View key={event.id} style={styles.row}><View style={[styles.roundIcon, { backgroundColor: '#7047EE18' }]}><Ionicons name="calendar" size={18} color="#7047EE" /></View><View style={styles.flex}><Text style={styles.rowTitle}>{event.title}</Text><Text style={styles.meta}>{new Date(event.starts_at).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}{event.location ? ` · ${event.location}` : ''}</Text></View></View>)}
        <View style={styles.formCard}>
          <Text style={styles.rowTitle}>Add to the trip</Text>
          <TextInput value={eventTitle} onChangeText={setEventTitle} placeholder="Dinner, museum, flight, beach…" placeholderTextColor="#8790A3" style={styles.input} />
          <TextInput value={eventDateTime} onChangeText={setEventDateTime} placeholder="YYYY-MM-DD HH:mm" placeholderTextColor="#8790A3" autoCapitalize="none" style={styles.input} />
          <TextInput value={eventLocation} onChangeText={setEventLocation} placeholder="Location (optional)" placeholderTextColor="#8790A3" style={styles.input} />
          <Pressable disabled={!eventTitle.trim() || !eventDateTime.trim() || busy} onPress={addEvent} style={[styles.primaryButton, (!eventTitle.trim() || !eventDateTime.trim() || busy) && styles.disabled]}><Text style={styles.primaryButtonText}>Add trip event</Text></Pressable>
        </View>

        <Text style={styles.sectionTitle}>Invite another family or friend</Text>
        <View style={styles.inlineForm}><TextInput value={inviteEmail} onChangeText={setInviteEmail} placeholder="Their email" placeholderTextColor="#8790A3" keyboardType="email-address" autoCapitalize="none" style={[styles.input, styles.flex]} /><Pressable disabled={!inviteEmail.includes('@') || busy} onPress={invite} style={[styles.squareButton, (!inviteEmail.includes('@') || busy) && styles.disabled]}><Ionicons name="send" size={19} color="#fff" /></Pressable></View>
      </> : <>
        <Text style={styles.sectionTitle}>Create your first trip space</Text>
        <Empty icon="people-outline" title="Trips are separate from home" text="Only invited people can see a trip’s schedule." styles={styles} />
      </>}

      <Text style={styles.sectionTitle}>New trip</Text>
      <View style={styles.formCard}>
        <TextInput value={title} onChangeText={setTitle} placeholder="Trip name" placeholderTextColor="#8790A3" style={styles.input} />
        <TextInput value={destination} onChangeText={setDestination} placeholder="Destination" placeholderTextColor="#8790A3" style={styles.input} />
        <View style={styles.inlineForm}><TextInput value={startsOn} onChangeText={setStartsOn} placeholder="Start YYYY-MM-DD" placeholderTextColor="#8790A3" autoCapitalize="none" style={[styles.input, styles.flex]} /><TextInput value={endsOn} onChangeText={setEndsOn} placeholder="End YYYY-MM-DD" placeholderTextColor="#8790A3" autoCapitalize="none" style={[styles.input, styles.flex]} /></View>
        <Pressable disabled={!title.trim() || busy} onPress={addSpace} style={[styles.primaryButton, (!title.trim() || busy) && styles.disabled]}><Text style={styles.primaryButtonText}>Create private trip space</Text></Pressable>
      </View>
      {!!error && <Text style={styles.error}>{error}</Text>}
    </ScrollView>
  );
}

function Empty({ icon, title, text, styles }: { icon: string; title: string; text: string; styles: ReturnType<typeof makeStyles> }) {
  return <View style={styles.empty}><Ionicons name={icon as any} size={27} color="#2257F4" /><Text style={styles.rowTitle}>{title}</Text><Text style={[styles.meta, { textAlign: 'center' }]}>{text}</Text></View>;
}

function relativeTime(value: string) {
  const difference = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.round(difference / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return new Date(value).toLocaleDateString();
}

function calendarConflictVersion(
  payload: Record<string, unknown>,
  source: 'local' | 'provider',
) {
  const title = String(payload.title || 'Untitled event');
  const startsAt = source === 'local' ? payload.starts_at : payload.startsAt;
  const endsAt = source === 'local' ? payload.ends_at : payload.endsAt;
  const location = payload.location ? String(payload.location) : '';
  const deleted = source === 'provider' && Boolean(payload.deleted);
  const start = typeof startsAt === 'string' ? new Date(startsAt) : null;
  const end = typeof endsAt === 'string' ? new Date(endsAt) : null;
  const validStart = start && !Number.isNaN(start.getTime());
  const validEnd = end && !Number.isNaN(end.getTime());
  const when = validStart
    ? `${start.toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })}${validEnd ? ` – ${end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : ''}`
    : 'Time not available';
  return { title, when, location, deleted };
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function openCoordinates(latitude: number, longitude: number) {
  const url = Platform.OS === 'ios'
    ? `http://maps.apple.com/?ll=${latitude},${longitude}`
    : `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
  void Linking.openURL(url);
}

function distanceMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const radius = 6371e3;
  const phi1 = a.latitude * Math.PI / 180;
  const phi2 = b.latitude * Math.PI / 180;
  const deltaPhi = (b.latitude - a.latitude) * Math.PI / 180;
  const deltaLambda = (b.longitude - a.longitude) * Math.PI / 180;
  const h = Math.sin(deltaPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function nearestPlace(location: MemberLocation, places: FamilyPlace[]) {
  const sorted = places
    .map((place) => ({ ...place, distance: distanceMeters(location, place) }))
    .sort((a, b) => a.distance - b.distance);
  const nearest = sorted[0];
  if (!nearest || nearest.distance > Math.max(nearest.radius_meters * 2, 1000)) return null;
  return {
    name: nearest.name,
    distanceLabel: nearest.distance <= nearest.radius_meters
      ? 'inside place'
      : `${Math.round(nearest.distance)} m away`,
  };
}

function addDays(date: Date, count: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + count);
  return next;
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function friendlyDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatDateRange(start: string | null, end: string | null) {
  if (!start) return '';
  const startText = friendlyDate(start);
  return end ? `${startText}–${friendlyDate(end)}` : startText;
}

function openRestaurantSearch(destination: string) {
  void Linking.openURL(`https://www.opentable.com/s?term=${encodeURIComponent(destination)}`);
}

function makeStyles(dark: boolean) {
  const palette = dark
    ? { canvas: '#0E1726', surface: '#151F31', surface2: '#1B2740', text: '#F7F8FB', muted: '#A8B1C4', line: '#2B3954' }
    : { canvas: '#F6F7FB', surface: '#FFFFFF', surface2: '#FAFBFD', text: '#182033', muted: '#727D94', line: '#E0E4EC' };
  return StyleSheet.create({
    page: { padding: 18, paddingBottom: 130, gap: 10, backgroundColor: palette.canvas },
    hero: { minHeight: 208, borderRadius: 25, padding: 21, justifyContent: 'center' },
    heroEyebrow: { color: '#FFFFFFB5', fontSize: 8, fontWeight: '900', letterSpacing: 1.2, marginTop: 12 },
    heroEyebrowDark: { color: '#7047EE', fontSize: 8, fontWeight: '900', letterSpacing: 1.2 },
    heroTitle: { color: '#fff', fontSize: 25, lineHeight: 29, fontWeight: '900', letterSpacing: -.8, marginTop: 7 },
    heroText: { color: '#FFFFFFD0', fontSize: 11, lineHeight: 17, marginTop: 8 },
    sectionTitle: { color: palette.text, fontSize: 16, fontWeight: '900', marginTop: 15, marginBottom: 2 },
    row: { minHeight: 70, borderRadius: 18, padding: 12, flexDirection: 'row', gap: 11, alignItems: 'center', backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line },
    rowSelected: { borderColor: '#19A47B77', backgroundColor: dark ? '#12352E' : '#F2FCF8' },
    checkedRow: { opacity: .62 },
    settingCard: { borderRadius: 21, padding: 15, gap: 10, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line },
    conflictNotice: { borderRadius: 18, padding: 14, flexDirection: 'row', gap: 11, alignItems: 'center', backgroundColor: '#B46B1212', borderWidth: 1, borderColor: '#B46B1240' },
    conflictCard: { borderRadius: 21, padding: 15, gap: 10, backgroundColor: palette.surface, borderWidth: 1, borderColor: '#B46B1260' },
    versionCard: { borderRadius: 15, padding: 12, backgroundColor: palette.surface2, borderWidth: 1, borderColor: palette.line },
    versionLabel: { color: '#B46B12', fontSize: 8, fontWeight: '900', letterSpacing: .9 },
    versionTitle: { color: palette.text, fontSize: 12, fontWeight: '800', marginTop: 5 },
    settingTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    formCard: { borderRadius: 21, padding: 15, gap: 10, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line },
    providerCard: { borderRadius: 18, padding: 14, flexDirection: 'row', gap: 11, backgroundColor: '#2257F410', borderWidth: 1, borderColor: '#2257F430' },
    privacyCard: { borderRadius: 18, padding: 14, flexDirection: 'row', gap: 11, alignItems: 'center', backgroundColor: '#19A47B12', borderWidth: 1, borderColor: '#19A47B35' },
    privacyText: { color: palette.text, flex: 1, fontSize: 10, lineHeight: 15, fontWeight: '600' },
    rowTitle: { color: palette.text, fontSize: 12, fontWeight: '800' },
    meta: { color: palette.muted, fontSize: 9, lineHeight: 13, marginTop: 3 },
    caption: { color: palette.muted, fontSize: 9, textAlign: 'center' },
    label: { color: palette.muted, fontSize: 8, fontWeight: '900', letterSpacing: 1, marginTop: 4 },
    flex: { flex: 1 },
    colorDot: { width: 13, height: 13, borderRadius: 7 },
    roundIcon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
    primaryButton: { minHeight: 49, borderRadius: 15, backgroundColor: '#2257F4', flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', marginTop: 3 },
    primaryButtonText: { color: '#fff', fontSize: 11, fontWeight: '900' },
    secondaryButton: { minHeight: 45, borderRadius: 14, borderWidth: 1, borderColor: '#2257F455', backgroundColor: '#2257F410', flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center' },
    secondaryButtonText: { color: '#2257F4', fontSize: 10, fontWeight: '900' },
    disabled: { opacity: .42 },
    error: { color: '#D34A3B', backgroundColor: '#D34A3B12', borderRadius: 13, padding: 11, fontSize: 10, lineHeight: 15 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
    chip: { minHeight: 34, borderRadius: 11, paddingHorizontal: 11, borderWidth: 1, borderColor: palette.line, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surface2 },
    chipActive: { backgroundColor: '#2257F4', borderColor: '#2257F4' },
    chipText: { color: palette.text, fontSize: 9, fontWeight: '800' },
    chipTextActive: { color: '#fff' },
    successPill: { minHeight: 38, borderRadius: 13, paddingHorizontal: 10, flexDirection: 'row', gap: 7, alignItems: 'center', backgroundColor: '#19A47B15' },
    successText: { color: '#168866', fontSize: 9, fontWeight: '800' },
    input: { minHeight: 47, borderRadius: 14, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.surface2, color: palette.text, paddingHorizontal: 12, fontSize: 11 },
    inlineForm: { flexDirection: 'row', gap: 8, alignItems: 'center' },
    squareButton: { width: 48, height: 48, borderRadius: 14, backgroundColor: '#2257F4', alignItems: 'center', justifyContent: 'center' },
    actionGrid: { flexDirection: 'row', gap: 9 },
    actionTile: { flex: 1, minHeight: 104, borderRadius: 19, padding: 14, justifyContent: 'center' },
    actionTitle: { color: palette.text, fontSize: 12, fontWeight: '900', marginTop: 9 },
    horizontalCards: { gap: 8, paddingRight: 18 },
    dayCard: { width: 88, minHeight: 112, borderRadius: 18, padding: 12, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line },
    dayCardActive: { backgroundColor: '#2257F4', borderColor: '#2257F4' },
    dayEyebrow: { color: palette.muted, fontSize: 8, fontWeight: '900' },
    dayNumber: { color: palette.text, fontSize: 22, fontWeight: '900', marginTop: 3 },
    dayMeal: { color: palette.text, fontSize: 9, fontWeight: '700', lineHeight: 13, marginTop: 9 },
    inverted: { color: '#fff' },
    struck: { textDecorationLine: 'line-through', color: palette.muted },
    empty: { minHeight: 142, borderRadius: 20, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.surface, alignItems: 'center', justifyContent: 'center', padding: 20, gap: 7 },
    tripPill: { minHeight: 38, borderRadius: 19, paddingHorizontal: 15, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: palette.line, backgroundColor: palette.surface },
    tripPillActive: { backgroundColor: '#7047EE', borderColor: '#7047EE' },
    tripHero: { minHeight: 104, borderRadius: 21, padding: 16, flexDirection: 'row', alignItems: 'center', backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line },
    tripTitle: { color: palette.text, fontSize: 20, fontWeight: '900', marginTop: 5 },
    icon: { color: palette.muted },
  });
}
