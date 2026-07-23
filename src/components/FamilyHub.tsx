import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  listHouseholdMembers,
  listHouseholds,
  listInvitations,
  sendHouseholdInvitation,
  subscribeToHouseholdAccess,
} from '../services/households';

type Role = 'admin' | 'member' | 'child';
type Member = {
  user_id: string;
  role: string;
  profiles:
    | { display_name: string; avatar_url: string | null }
    | { display_name: string; avatar_url: string | null }[]
    | null;
  onboarding: {
    profile_completed: boolean;
    notifications_completed: boolean;
    calendar_completed: boolean;
    tour_completed: boolean;
    first_action_completed: boolean;
    last_active_at: string;
  } | null;
};
type Invitation = {
  id: string;
  email: string;
  role: string;
  status: string;
  expires_at: string;
  delivery_status?: string;
  last_delivery_error?: string | null;
};

export default function FamilyHub() {
  const [householdId, setHouseholdId] = useState('');
  const [householdName, setHouseholdName] = useState('Your family');
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    if (!householdId) return;
    return subscribeToHouseholdAccess(householdId, () => void load(false));
  }, [householdId]);

  async function load(showSpinner = true) {
    if (showSpinner) setBusy(true);
    try {
      const households = await listHouseholds();
      const first = households[0]?.households;
      const household = Array.isArray(first) ? first[0] : first;
      if (!household) return;
      setHouseholdId(household.id);
      setHouseholdName(household.name);
      const [nextMembers, nextInvitations] = await Promise.all([
        listHouseholdMembers(household.id),
        listInvitations(household.id),
      ]);
      setMembers(nextMembers as Member[]);
      setInvitations(nextInvitations as Invitation[]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load family members.');
    } finally {
      setBusy(false);
    }
  }

  async function sendInvite() {
    if (!email.includes('@') || !householdId) {
      setMessage('Enter a valid email address.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const invitation = await sendHouseholdInvitation({ householdId, email, role });
      if (!invitation.emailSent) {
        await Share.share({
          title: `Join ${householdName} on Coho`,
          message: `Join our family command center on Coho: ${invitation.inviteUrl}`,
        });
      }
      setEmail('');
      setMessage(invitation.emailSent
        ? 'Invitation emailed. Their household will appear here immediately after they join.'
        : 'The secure invite is ready to share. Their household will appear here immediately after they join.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to send invitation.');
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>HOUSEHOLD</Text>
        <Text style={styles.heroTitle}>{householdName}</Text>
        <Text style={styles.heroText}>{members.length} member{members.length === 1 ? '' : 's'} sharing one Coho household.</Text>
      </View>

      <Text style={styles.sectionTitle}>Family members</Text>
      {busy && members.length === 0 ? <ActivityIndicator color="#2257F4" /> : members.map((member) => {
        const readiness = memberReadiness(member);
        const profile = Array.isArray(member.profiles) ? member.profiles[0] : member.profiles;
        return (
          <View key={member.user_id} style={styles.row}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials(profile?.display_name ?? 'Family')}</Text>
            </View>
            <View style={styles.flex}>
              <Text style={styles.name}>{profile?.display_name ?? 'Family member'}</Text>
              <Text style={styles.meta}>{roleLabel(member.role)} · {readiness.detail}</Text>
            </View>
            <View style={[styles.activePill, { backgroundColor: readiness.background }]}>
              <Text style={[styles.activeText, { color: readiness.color }]}>{readiness.label}</Text>
            </View>
          </View>
        );
      })}

      <Text style={styles.sectionTitle}>Invite someone</Text>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Bring your family together</Text>
        <Text style={styles.cardText}>Coho emails a secure link. After they accept, their calendar, chat, assignments, notifications, and Coh workspace update in real time.</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="Family member’s email"
          placeholderTextColor="#8790A3"
          autoCapitalize="none"
          keyboardType="email-address"
          style={styles.input}
        />
        <View style={styles.roles}>
          {(['admin', 'member', 'child'] as Role[]).map((item) => (
            <Pressable key={item} onPress={() => setRole(item)} style={[styles.role, role === item && styles.roleActive]}>
              <Text style={[styles.roleText, role === item && styles.roleTextActive]}>{roleLabel(item)}</Text>
            </Pressable>
          ))}
        </View>
        {!!message && <Text style={styles.message}>{message}</Text>}
        <Pressable disabled={busy} onPress={sendInvite} style={[styles.button, busy && styles.disabled]}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Email secure invitation</Text>}
        </Pressable>
      </View>

      {invitations.length > 0 && <>
        <Text style={styles.sectionTitle}>Pending invitations</Text>
        {invitations.map((invite) => (
          <View key={invite.id} style={styles.row}>
            <View style={[styles.avatar, styles.inviteAvatar]}><Text>✉️</Text></View>
            <View style={styles.flex}><Text style={styles.name}>{invite.email}</Text><Text style={styles.meta}>{roleLabel(invite.role)} · {invite.delivery_status === 'sent' ? 'Email sent' : 'Share link ready'}</Text>{!!invite.last_delivery_error && <Text style={styles.warning}>Email delivery unavailable; use the share link.</Text>}</View>
          </View>
        ))}
      </>}
    </ScrollView>
  );
}

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function roleLabel(role: string) {
  if (role === 'owner') return 'Household owner';
  if (role === 'admin') return 'Adult admin';
  if (role === 'child') return 'Child account';
  return 'Family member';
}

function memberReadiness(member: Member) {
  const state = member.onboarding;
  if (!state) {
    return { label: 'Joined', detail: 'setup not started', color: '#B46B12', background: '#FFF1D8' };
  }
  const lastActive = new Date(state.last_active_at).getTime();
  const activeRecently = Number.isFinite(lastActive) && Date.now() - lastActive < 1000 * 60 * 60 * 24 * 2;
  if (!state.tour_completed || !state.notifications_completed) {
    const missing = [
      !state.tour_completed && 'tour',
      !state.notifications_completed && 'alerts',
    ].filter(Boolean).join(' + ');
    return { label: 'Setup', detail: `${missing} remaining`, color: '#B46B12', background: '#FFF1D8' };
  }
  if (!state.first_action_completed) {
    return { label: 'Ready', detail: 'waiting for first action', color: '#2257F4', background: '#E4EBFF' };
  }
  return activeRecently
    ? { label: 'Active', detail: 'recently used Coho', color: '#168866', background: '#E1F8F0' }
    : { label: 'Ready', detail: 'fully set up', color: '#2257F4', background: '#E4EBFF' };
}

const styles = StyleSheet.create({
  page: { padding: 18, paddingBottom: 110, gap: 11 },
  hero: { borderRadius: 24, backgroundColor: '#2257F4', padding: 22, marginBottom: 7 },
  eyebrow: { color: '#FFFFFFAA', fontSize: 9, fontWeight: '900', letterSpacing: 1.4 },
  heroTitle: { color: '#FFFFFF', fontSize: 26, fontWeight: '900', marginTop: 7 },
  heroText: { color: '#FFFFFFC4', fontSize: 12, marginTop: 5 },
  sectionTitle: { color: '#182033', fontSize: 16, fontWeight: '900', marginTop: 12, marginBottom: 2 },
  row: { minHeight: 72, borderRadius: 18, borderWidth: 1, borderColor: '#E3E6ED', backgroundColor: '#FFFFFF', padding: 12, flexDirection: 'row', alignItems: 'center', gap: 11 },
  avatar: { width: 44, height: 44, borderRadius: 15, backgroundColor: '#DCE7FF', alignItems: 'center', justifyContent: 'center' },
  inviteAvatar: { backgroundColor: '#FFF0E7' },
  avatarText: { color: '#2257F4', fontSize: 12, fontWeight: '900' },
  flex: { flex: 1 },
  name: { color: '#182033', fontSize: 13, fontWeight: '800' },
  meta: { color: '#778096', fontSize: 10, marginTop: 3 },
  activePill: { borderRadius: 10, backgroundColor: '#E1F8F0', paddingHorizontal: 8, paddingVertical: 5 },
  activeText: { color: '#168866', fontSize: 8, fontWeight: '900' },
  card: { borderRadius: 22, borderWidth: 1, borderColor: '#E3E6ED', backgroundColor: '#FFFFFF', padding: 17 },
  cardTitle: { color: '#182033', fontSize: 15, fontWeight: '900' },
  cardText: { color: '#778096', fontSize: 11, lineHeight: 16, marginTop: 5, marginBottom: 15 },
  input: { minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: '#DDE1EA', backgroundColor: '#FAFBFD', color: '#182033', paddingHorizontal: 13 },
  roles: { flexDirection: 'row', gap: 6, marginTop: 10 },
  role: { flex: 1, minHeight: 38, borderRadius: 12, backgroundColor: '#F1F3F7', alignItems: 'center', justifyContent: 'center' },
  roleActive: { backgroundColor: '#E4EBFF', borderWidth: 1, borderColor: '#2257F4' },
  roleText: { color: '#687188', fontSize: 9, fontWeight: '800' },
  roleTextActive: { color: '#2257F4' },
  message: { color: '#C44931', fontSize: 11, marginTop: 10 },
  warning: { color: '#B46B12', fontSize: 9, marginTop: 3 },
  button: { minHeight: 48, borderRadius: 14, backgroundColor: '#2257F4', alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  disabled: { opacity: 0.6 },
  buttonText: { color: '#FFFFFF', fontWeight: '900', fontSize: 12 },
});
