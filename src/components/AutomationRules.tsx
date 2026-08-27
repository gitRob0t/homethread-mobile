import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import {
  automationPresets,
  createAutomationFromPreset,
  deleteAutomationRule,
  listAutomationRules,
  runAutomationNow,
  setAutomationEnabled,
  subscribeToAutomations,
  type AutomationRule,
} from '../services/automations';

type Props = {
  dark: boolean;
  householdId: string | null;
  userId: string | null;
  onNotice: (message: string) => void;
};

export default function AutomationRulesScreen({
  dark,
  householdId,
  userId,
  onNotice,
}: Props) {
  const styles = useMemo(() => createStyles(dark), [dark]);
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    if (!householdId) {
      setRules([]);
      setLoading(false);
      return;
    }
    setRules(await listAutomationRules(householdId));
    setLoading(false);
  }

  useEffect(() => {
    void load().catch((nextError) => {
      setError(nextError instanceof Error ? nextError.message : 'Automations could not be loaded.');
      setLoading(false);
    });
    if (!householdId) return;
    return subscribeToAutomations(householdId, () => void load().catch(() => undefined));
  }, [householdId]);

  async function addPreset(presetId: string) {
    if (!householdId || !userId) return;
    const preset = automationPresets.find((item) => item.id === presetId);
    if (!preset) return;
    setBusyId(presetId);
    setError('');
    try {
      await createAutomationFromPreset(householdId, userId, preset);
      await load();
      onNotice(`${preset.name} is active`);
    } catch (nextError) {
      setError(nextError instanceof Error
        ? nextError.message
        : 'Only an adult household administrator can add this automation.');
    } finally {
      setBusyId(null);
    }
  }

  async function toggle(rule: AutomationRule, enabled: boolean) {
    setBusyId(rule.id);
    setError('');
    try {
      await setAutomationEnabled(rule, enabled);
      await load();
      onNotice(`${rule.name} ${enabled ? 'enabled' : 'paused'}`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'The automation could not be changed.');
    } finally {
      setBusyId(null);
    }
  }

  async function run(rule: AutomationRule) {
    setBusyId(rule.id);
    setError('');
    try {
      const result = await runAutomationNow(rule.id);
      await load();
      onNotice(result?.executed
        ? `${rule.name} ran successfully`
        : `${rule.name} had nothing to do`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'The automation test did not run.');
    } finally {
      setBusyId(null);
    }
  }

  function remove(rule: AutomationRule) {
    Alert.alert(
      `Delete “${rule.name}”?`,
      'Its run history remains in the household audit trail only until this rule is deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setBusyId(rule.id);
            void deleteAutomationRule(rule.id)
              .then(load)
              .then(() => onNotice('Automation deleted'))
              .catch((nextError) => setError(nextError instanceof Error ? nextError.message : 'The automation could not be deleted.'))
              .finally(() => setBusyId(null));
          },
        },
      ],
    );
  }

  const installedNames = new Set(rules.map((rule) => rule.name));
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.hero}>
        <View style={styles.heroIcon}><Ionicons name="flash" size={25} color="#fff" /></View>
        <Text style={styles.eyebrow}>REAL HOUSEHOLD AUTOMATIONS</Text>
        <Text style={styles.heroTitle}>Coh watches the loop.</Text>
        <Text style={styles.heroText}>
          Rules run in the cloud even when the app is closed. Every run is deduplicated,
          auditable, permission-aware, and opens the exact place that needs attention.
        </Text>
      </View>

      {!householdId || !userId ? (
        <Empty
          styles={styles}
          title="Join a household first"
          text="Automations belong to one private family workspace."
        />
      ) : loading ? (
        <View style={styles.loading}><ActivityIndicator color="#7047EE" /><Text style={styles.meta}>Loading household rules…</Text></View>
      ) : (
        <>
          <Text style={styles.sectionTitle}>Active rules</Text>
          {rules.length === 0 ? (
            <Empty
              styles={styles}
              title="No rules yet"
              text="Add one of the production presets below. You can pause or test it at any time."
            />
          ) : rules.map((rule) => (
            <View key={rule.id} style={styles.ruleCard}>
              <View style={styles.ruleTop}>
                <View style={[styles.ruleIcon, { backgroundColor: '#7047EE18' }]}>
                  <Ionicons name={triggerIcon(rule.trigger_type) as any} size={20} color="#7047EE" />
                </View>
                <View style={styles.flex}>
                  <Text style={styles.ruleName}>{rule.name}</Text>
                  <Text style={styles.meta}>{triggerDescription(rule)}</Text>
                </View>
                {busyId === rule.id
                  ? <ActivityIndicator size="small" color="#7047EE" />
                  : <Switch value={rule.enabled} onValueChange={(value) => void toggle(rule, value)} trackColor={{ true: '#6687FF' }} />}
              </View>
              <View style={styles.statusRow}>
                <View style={[styles.statusPill, rule.last_error ? styles.errorPill : styles.okPill]}>
                  <Text style={[styles.statusText, rule.last_error ? styles.errorText : styles.okText]}>
                    {rule.last_error ? 'Needs attention' : rule.last_run_at ? `Last ran ${relativeTime(rule.last_run_at)}` : 'Ready'}
                  </Text>
                </View>
                {rule.next_run_at && <Text style={styles.meta}>Next {relativeTime(rule.next_run_at)}</Text>}
              </View>
              {!!rule.last_error && <Text style={styles.error}>{rule.last_error}</Text>}
              <View style={styles.actions}>
                {rule.trigger_type !== 'inbox_received' && (
                  <Pressable disabled={busyId === rule.id} onPress={() => void run(rule)} style={styles.secondaryButton}>
                    <Ionicons name="play-outline" size={16} color="#2257F4" />
                    <Text style={styles.secondaryText}>Run now</Text>
                  </Pressable>
                )}
                <Pressable disabled={busyId === rule.id} onPress={() => remove(rule)} style={styles.deleteButton}>
                  <Ionicons name="trash-outline" size={16} color="#D64545" />
                  <Text style={styles.deleteText}>Delete</Text>
                </Pressable>
              </View>
            </View>
          ))}

          <Text style={styles.sectionTitle}>Production presets</Text>
          {automationPresets.map((preset) => {
            const installed = installedNames.has(preset.name);
            return (
              <View key={preset.id} style={styles.presetCard}>
                <View style={[styles.ruleIcon, { backgroundColor: `${preset.color}18` }]}>
                  <Ionicons name={preset.icon as any} size={20} color={preset.color} />
                </View>
                <View style={styles.flex}>
                  <Text style={styles.ruleName}>{preset.name}</Text>
                  <Text style={styles.meta}>{preset.description}</Text>
                </View>
                <Pressable
                  disabled={installed || busyId === preset.id}
                  onPress={() => void addPreset(preset.id)}
                  style={[styles.addButton, installed && styles.installedButton]}
                >
                  {busyId === preset.id
                    ? <ActivityIndicator size="small" color={installed ? '#19A47B' : '#fff'} />
                    : <Text style={[styles.addText, installed && styles.installedText]}>{installed ? 'Added' : 'Add'}</Text>}
                </Pressable>
              </View>
            );
          })}

          <View style={styles.safetyCard}>
            <Ionicons name="shield-checkmark" size={19} color="#168866" />
            <Text style={styles.safetyText}>
              Automations may notify automatically. New calendar events, chores, purchases,
              and external transactions still require the family approval policy configured for that action.
            </Text>
          </View>
        </>
      )}
      {!!error && <Text style={styles.error}>{error}</Text>}
    </ScrollView>
  );
}

function Empty({ title, text, styles }: { title: string; text: string; styles: ReturnType<typeof createStyles> }) {
  return <View style={styles.empty}><Ionicons name="flash-outline" size={27} color="#7047EE" /><Text style={styles.ruleName}>{title}</Text><Text style={styles.meta}>{text}</Text></View>;
}

function triggerIcon(trigger: string) {
  if (trigger === 'schedule') return 'time-outline';
  if (trigger === 'action_overdue') return 'alert-circle-outline';
  if (trigger === 'inbox_received') return 'mail-unread-outline';
  if (trigger === 'location') return 'location-outline';
  if (trigger === 'calendar_change') return 'calendar-outline';
  return 'checkmark-done-outline';
}

function triggerDescription(rule: AutomationRule) {
  if (rule.trigger_type === 'inbox_received') return 'Runs when a new Family Inbox item is processed';
  if (rule.trigger_type === 'action_overdue') return `Checks ${scheduleLabel(rule.trigger_config)}`;
  if (rule.trigger_type === 'schedule') return `Runs ${scheduleLabel(rule.trigger_config)}`;
  return `Runs on ${rule.trigger_type.replaceAll('_', ' ')}`;
}

function scheduleLabel(config: Record<string, unknown>) {
  const time = formatClock(String(config.time ?? '17:00'));
  if (config.cadence === 'weekly') {
    const day = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][Number(config.weekday ?? 0)] ?? 'Sunday';
    return `${day} at ${time}`;
  }
  return `daily at ${time}`;
}

function formatClock(value: string) {
  const [rawHour, minute = '00'] = value.split(':');
  const hour = Number(rawHour);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  return `${hour % 12 || 12}:${minute} ${suffix}`;
}

function relativeTime(value: string) {
  const difference = new Date(value).getTime() - Date.now();
  const absolute = Math.abs(difference);
  if (absolute < 60_000) return difference < 0 ? 'just now' : 'now';
  if (absolute < 3_600_000) {
    const minutes = Math.max(1, Math.round(absolute / 60_000));
    return difference < 0 ? `${minutes}m ago` : `in ${minutes}m`;
  }
  if (absolute < 86_400_000) {
    const hours = Math.max(1, Math.round(absolute / 3_600_000));
    return difference < 0 ? `${hours}h ago` : `in ${hours}h`;
  }
  const days = Math.max(1, Math.round(absolute / 86_400_000));
  return difference < 0 ? `${days}d ago` : `in ${days}d`;
}

function createStyles(dark: boolean) {
  const colors = dark
    ? { bg: '#101624', surface: '#171F30', text: '#F7F8FC', muted: '#AEB8CB', line: '#2B3850' }
    : { bg: '#FFF8E9', surface: '#FFFDF8', text: '#14213D', muted: '#6D7486', line: '#EADFC9' };
  return StyleSheet.create({
    page: { backgroundColor: colors.bg, padding: 18, paddingBottom: 48, gap: 12 },
    flex: { flex: 1 },
    hero: { borderRadius: 24, padding: 20, backgroundColor: '#24116D', overflow: 'hidden' },
    heroIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#7047EE', marginBottom: 14 },
    eyebrow: { color: '#BDAAFF', fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
    heroTitle: { color: '#fff', fontSize: 26, fontWeight: '900', marginTop: 5, letterSpacing: -.7 },
    heroText: { color: '#D7D0F5', fontSize: 12, lineHeight: 18, marginTop: 7 },
    sectionTitle: { color: colors.text, fontSize: 20, fontWeight: '900', marginTop: 10 },
    loading: { minHeight: 150, alignItems: 'center', justifyContent: 'center', gap: 10 },
    empty: { minHeight: 140, borderRadius: 20, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
    ruleCard: { borderRadius: 20, padding: 15, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, gap: 12 },
    ruleTop: { flexDirection: 'row', gap: 11, alignItems: 'center' },
    ruleIcon: { width: 43, height: 43, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
    ruleName: { color: colors.text, fontSize: 13, fontWeight: '900' },
    meta: { color: colors.muted, fontSize: 10, lineHeight: 14, marginTop: 2 },
    statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    statusPill: { borderRadius: 99, paddingHorizontal: 9, paddingVertical: 5 },
    okPill: { backgroundColor: '#19A47B16' },
    errorPill: { backgroundColor: '#D6454516' },
    statusText: { fontSize: 8, fontWeight: '900' },
    okText: { color: '#168866' },
    errorText: { color: '#D64545' },
    actions: { flexDirection: 'row', gap: 8 },
    secondaryButton: { minHeight: 36, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', borderRadius: 12, paddingHorizontal: 12, borderWidth: 1, borderColor: '#2257F445', backgroundColor: '#2257F40A' },
    secondaryText: { color: '#2257F4', fontSize: 9, fontWeight: '900' },
    deleteButton: { minHeight: 36, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', borderRadius: 12, paddingHorizontal: 12 },
    deleteText: { color: '#D64545', fontSize: 9, fontWeight: '900' },
    presetCard: { minHeight: 83, borderRadius: 18, padding: 13, flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
    addButton: { minWidth: 58, minHeight: 34, paddingHorizontal: 12, borderRadius: 11, backgroundColor: '#2257F4', alignItems: 'center', justifyContent: 'center' },
    installedButton: { backgroundColor: '#19A47B13', borderWidth: 1, borderColor: '#19A47B45' },
    addText: { color: '#fff', fontSize: 9, fontWeight: '900' },
    installedText: { color: '#168866' },
    safetyCard: { borderRadius: 18, padding: 14, flexDirection: 'row', gap: 10, backgroundColor: '#19A47B0F', borderWidth: 1, borderColor: '#19A47B35' },
    safetyText: { flex: 1, color: dark ? '#BDE9DC' : '#17634F', fontSize: 10, lineHeight: 15 },
    error: { color: '#D64545', fontSize: 10, lineHeight: 14, fontWeight: '700' },
  });
}
