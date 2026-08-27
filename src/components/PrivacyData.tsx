import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import {
  createHouseholdExport,
  deleteCohoAccount,
  getPrivacyAccount,
  listPrivacyRequests,
  type PrivacyRequest,
} from '../services/privacyData';

export default function PrivacyDataScreen({
  dark,
  householdId,
  onNotice,
}: {
  dark: boolean;
  householdId: string | null;
  onNotice: (message: string) => void;
}) {
  const colors = dark
    ? { canvas: '#101624', surface: '#171F30', text: '#F7F8FC', muted: '#AEB8CB', line: '#2B3850' }
    : { canvas: '#FFF8E9', surface: '#FFFDF8', text: '#14213D', muted: '#6D7486', line: '#EADFC9' };
  const styles = createStyles(colors);
  const [email, setEmail] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [phrase, setPhrase] = useState('');
  const [requests, setRequests] = useState<PrivacyRequest[]>([]);
  const [busy, setBusy] = useState<'load' | 'export' | 'delete' | null>('load');

  useEffect(() => {
    void Promise.all([getPrivacyAccount(), listPrivacyRequests()])
      .then(([account, nextRequests]) => {
        setEmail(account.email);
        setRequests(nextRequests);
      })
      .catch((error) => onNotice(error instanceof Error ? error.message : 'Privacy controls could not load.'))
      .finally(() => setBusy(null));
  }, []);

  async function exportData() {
    if (!householdId) return onNotice('Join a household before exporting family data.');
    setBusy('export');
    try {
      const result = await createHouseholdExport(householdId);
      await Linking.openURL(result.downloadUrl);
      setRequests(await listPrivacyRequests());
      onNotice('Your private JSON export is ready for one hour');
    } catch (error) {
      onNotice(error instanceof Error ? error.message : 'The export could not be created.');
    } finally {
      setBusy(null);
    }
  }

  function confirmDeletion() {
    if (phrase !== 'DELETE MY COHO ACCOUNT' || confirmEmail.trim().toLowerCase() !== email.toLowerCase()) {
      onNotice('Enter the exact phrase and your signed-in email.');
      return;
    }
    Alert.alert(
      'Permanently delete your Coho account?',
      'This removes your sign-in, private Coh history, devices, locations, and memberships. Shared household records remain anonymous so your family does not lose its calendar.',
      [
        { text: 'Keep account', style: 'cancel' },
        { text: 'Delete permanently', style: 'destructive', onPress: () => void deleteAccount() },
      ],
    );
  }

  async function deleteAccount() {
    setBusy('delete');
    try {
      await deleteCohoAccount(confirmEmail.trim().toLowerCase(), phrase);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : 'The account could not be deleted.');
      setBusy(null);
    }
  }

  return (
    <ScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={styles.hero}>
        <View style={styles.heroIcon}><Ionicons name="shield-checkmark" size={25} color="#19A47B" /></View>
        <Text style={styles.eyebrow}>PRIVACY CENTER</Text>
        <Text style={styles.heroTitle}>Your family data stays yours.</Text>
        <Text style={styles.heroText}>Download it, review recent requests, or permanently delete your account without contacting support.</Text>
      </View>

      <Text style={styles.sectionTitle}>Download your data</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <Ionicons name="download-outline" size={22} color="#2257F4" />
          <View style={styles.flex}>
            <Text style={styles.cardTitle}>Portable household export</Text>
            <Text style={styles.detail}>JSON containing accessible family records, your Coh history, integrations metadata, notification history, and consent settings. Provider tokens and secrets are never included.</Text>
          </View>
        </View>
        <Pressable disabled={busy !== null} onPress={() => void exportData()} style={[styles.primaryButton, busy !== null && styles.disabled]}>
          {busy === 'export' ? <ActivityIndicator color="#fff" /> : <><Ionicons name="lock-closed" size={16} color="#fff" /><Text style={styles.primaryText}>Create secure export</Text></>}
        </Pressable>
      </View>

      {!!requests.length && <>
        <Text style={styles.sectionTitle}>Recent requests</Text>
        {requests.slice(0, 5).map((request) => (
          <View key={request.id} style={styles.requestRow}>
            <Ionicons name={request.status === 'failed' ? 'alert-circle' : 'checkmark-circle'} size={18} color={request.status === 'failed' ? '#D64545' : '#19A47B'} />
            <View style={styles.flex}><Text style={styles.cardTitle}>{request.request_type === 'export' ? 'Data export' : 'Account deletion'}</Text><Text style={styles.detail}>{request.status} · {new Date(request.requested_at).toLocaleString()}</Text>{request.failure_reason && <Text style={styles.error}>{request.failure_reason}</Text>}</View>
          </View>
        ))}
      </>}

      <Text style={styles.sectionTitle}>Delete account</Text>
      <View style={[styles.card, styles.dangerCard]}>
        <Text style={styles.dangerTitle}>Permanent and immediate</Text>
        <Text style={styles.detail}>Coho transfers household ownership to another adult when possible. If you are the only adult, that household is removed. Shared records kept for other members lose your attribution.</Text>
        <Text style={styles.label}>TYPE THIS EXACTLY</Text>
        <Text style={styles.phrase}>DELETE MY COHO ACCOUNT</Text>
        <TextInput value={phrase} onChangeText={setPhrase} autoCapitalize="characters" placeholder="Confirmation phrase" placeholderTextColor={colors.muted} style={styles.input} />
        <Text style={styles.label}>SIGNED-IN EMAIL</Text>
        <TextInput value={confirmEmail} onChangeText={setConfirmEmail} autoCapitalize="none" keyboardType="email-address" placeholder={email || 'Email'} placeholderTextColor={colors.muted} style={styles.input} />
        <Pressable disabled={busy !== null} onPress={confirmDeletion} style={[styles.deleteButton, busy !== null && styles.disabled]}>
          {busy === 'delete' ? <ActivityIndicator color="#fff" /> : <Text style={styles.deleteText}>Permanently delete my account</Text>}
        </Pressable>
      </View>
    </ScrollView>
  );
}

function createStyles(colors: { canvas: string; surface: string; text: string; muted: string; line: string }) {
  return StyleSheet.create({
    page: { padding: 18, paddingBottom: 50, gap: 11 },
    hero: { minHeight: 230, borderRadius: 25, padding: 22, justifyContent: 'center', backgroundColor: '#172B24', borderWidth: 1, borderColor: '#19A47B55' },
    heroIcon: { width: 50, height: 50, borderRadius: 17, backgroundColor: '#E1F8F0', alignItems: 'center', justifyContent: 'center' },
    eyebrow: { color: '#65D7B1', fontSize: 8, fontWeight: '900', letterSpacing: 1.2, marginTop: 14 },
    heroTitle: { color: '#fff', fontSize: 27, lineHeight: 31, fontWeight: '900', letterSpacing: -0.8, marginTop: 6 },
    heroText: { color: '#FFFFFFBF', fontSize: 11, lineHeight: 17, marginTop: 8 },
    sectionTitle: { color: colors.text, fontSize: 18, fontWeight: '900', marginTop: 11 },
    card: { borderRadius: 21, padding: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
    dangerCard: { borderColor: '#D6454555' },
    row: { flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
    flex: { flex: 1 },
    cardTitle: { color: colors.text, fontSize: 12, fontWeight: '900' },
    detail: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 4 },
    primaryButton: { minHeight: 48, borderRadius: 15, backgroundColor: '#2257F4', flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center', marginTop: 15 },
    primaryText: { color: '#fff', fontSize: 11, fontWeight: '900' },
    disabled: { opacity: 0.55 },
    requestRow: { minHeight: 64, borderRadius: 16, padding: 12, flexDirection: 'row', gap: 9, alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
    error: { color: '#D64545', fontSize: 9, marginTop: 3 },
    dangerTitle: { color: '#D64545', fontSize: 14, fontWeight: '900' },
    label: { color: colors.muted, fontSize: 8, fontWeight: '900', letterSpacing: 0.8, marginTop: 14, marginBottom: 6 },
    phrase: { color: '#D64545', fontSize: 10, fontWeight: '900', marginBottom: 7 },
    input: { minHeight: 47, borderRadius: 14, paddingHorizontal: 12, color: colors.text, backgroundColor: colors.canvas, borderWidth: 1, borderColor: colors.line },
    deleteButton: { minHeight: 48, borderRadius: 15, backgroundColor: '#D64545', alignItems: 'center', justifyContent: 'center', marginTop: 16 },
    deleteText: { color: '#fff', fontSize: 11, fontWeight: '900' },
  });
}
