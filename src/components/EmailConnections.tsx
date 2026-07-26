import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  type EmailSourceProvider,
  type HouseholdEmailSource,
  listHouseholdEmailSources,
  registerForwardingEmailSource,
  removeHouseholdEmailSource,
  suggestedEmailProvider,
} from '../services/emailSources';
import {
  countInboundItemsForReview,
  type HouseholdInbox,
  getHouseholdInbox,
  inboxAddress,
} from '../services/familyInbox';

type Props = {
  dark: boolean;
  householdId: string | null;
  userId: string | null;
  initialProvider?: EmailSourceProvider;
  canManage: boolean;
  onNotice: (message: string) => void;
  onReviewInbox: () => void;
  onSetupInbox: () => void;
};

const providers: Array<{
  id: EmailSourceProvider;
  title: string;
  detail: string;
  icon: string;
  color: string;
}> = [
  {
    id: 'google',
    title: 'Gmail or Google Workspace',
    detail: 'Includes custom-domain mail hosted by Google.',
    icon: 'logo-google',
    color: '#4285F4',
  },
  {
    id: 'microsoft',
    title: 'Outlook or Microsoft 365',
    detail: 'Personal Outlook and custom-domain Microsoft mail.',
    icon: 'logo-microsoft',
    color: '#0078D4',
  },
  {
    id: 'icloud',
    title: 'iCloud Mail',
    detail: 'Includes custom domains hosted by iCloud+.',
    icon: 'logo-apple',
    color: '#5A667A',
  },
  {
    id: 'yahoo',
    title: 'Yahoo Mail',
    detail: 'Forward selected messages or a dedicated folder.',
    icon: 'mail-outline',
    color: '#6F2DBD',
  },
  {
    id: 'custom',
    title: 'Other or custom domain',
    detail: 'Fastmail, cPanel, Proton, or an address such as chad@cragles.net.',
    icon: 'globe-outline',
    color: '#FF7A2E',
  },
];

export default function EmailConnectionsScreen({
  dark,
  householdId,
  userId,
  initialProvider = 'custom',
  canManage,
  onNotice,
  onReviewInbox,
  onSetupInbox,
}: Props) {
  const styles = useMemo(() => createStyles(dark), [dark]);
  const mutedColor = dark ? '#A8B1C4' : '#727D94';
  const placeholderColor = dark ? '#7F8AA0' : '#8B93A5';
  const [inbox, setInbox] = useState<HouseholdInbox | null>(null);
  const [sources, setSources] = useState<HouseholdEmailSource[]>([]);
  const [reviewCount, setReviewCount] = useState(0);
  const [email, setEmail] = useState('');
  const [provider, setProvider] = useState<EmailSourceProvider>(initialProvider);
  const [providerOverridden, setProviderOverridden] = useState(initialProvider !== 'custom');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    if (!householdId) {
      setInbox(null);
      setSources([]);
      setReviewCount(0);
      return;
    }
    const [nextInbox, nextSources, nextReviewCount] = await Promise.all([
      getHouseholdInbox(householdId),
      listHouseholdEmailSources(householdId),
      countInboundItemsForReview(householdId).catch(() => 0),
    ]);
    setInbox(nextInbox);
    setSources(nextSources);
    setReviewCount(nextReviewCount);
  }

  useEffect(() => {
    void load().catch((nextError) => {
      setError(nextError instanceof Error ? nextError.message : 'Email connections could not be loaded.');
    });
  }, [householdId]);

  useEffect(() => {
    setProvider(initialProvider);
    setProviderOverridden(initialProvider !== 'custom');
  }, [initialProvider]);

  function updateEmail(value: string) {
    setEmail(value);
    if (!providerOverridden) setProvider(suggestedEmailProvider(value));
  }

  async function registerSource() {
    if (!canManage) {
      setError('Ask a household owner or adult admin to add this email source.');
      return;
    }
    if (!householdId || !userId) {
      setError('Join a Coho household before adding an email source.');
      return;
    }
    if (!inbox) {
      setError('Create the Family Inbox first so Coho has a private address for forwarded mail.');
      onSetupInbox();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const source = await registerForwardingEmailSource({
        householdId,
        userId,
        emailAddress: email,
        provider,
      });
      setEmail('');
      setProviderOverridden(initialProvider !== 'custom');
      await load();
      onNotice(`${source.email_address} is ready for forwarding setup`);
      await shareForwardingSteps(source);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'That email source could not be added.');
    } finally {
      setBusy(false);
    }
  }

  async function shareForwardingSteps(source: HouseholdEmailSource) {
    if (!inbox) {
      onSetupInbox();
      return;
    }
    const destination = inboxAddress(inbox);
    await Share.share({
      message:
        `Set ${source.email_address} to forward important school, appointment, travel, ticket, and activity email to ${destination}.\n\n`
        + 'Coho keeps each message private, suggests calendar or task details, and waits for family approval before creating anything.',
    });
  }

  function removeSource(source: HouseholdEmailSource) {
    Alert.alert(
      'Remove email source?',
      `${source.email_address} will no longer appear as a configured source. Existing Family Inbox items and approved events remain.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setBusy(true);
              setError('');
              try {
                await removeHouseholdEmailSource(source.id);
                await load();
                onNotice(`${source.email_address} was removed`);
              } catch (nextError) {
                setError(nextError instanceof Error ? nextError.message : 'The email source could not be removed.');
              } finally {
                setBusy(false);
              }
            })();
          },
        },
      ],
    );
  }

  const destination = inbox ? inboxAddress(inbox) : null;
  return (
    <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
      <View style={styles.hero}>
        <View style={styles.heroIcon}><Ionicons name="mail-unread" size={24} color="#fff" /></View>
        <Text style={styles.eyebrow}>EMAIL INTELLIGENCE</Text>
        <Text style={styles.heroTitle}>Email becomes a suggestion—not an automatic action.</Text>
        <Text style={styles.heroText}>
          Coh reviews forwarded messages for dates, times, people, places, reminders, updates, and cancellations.
          A family member approves every event before it reaches the shared calendar.
        </Text>
      </View>

      <View style={styles.workflowCard}>
        <WorkflowStep icon="mail-outline" label="Receive" />
        <Ionicons name="chevron-forward" size={15} color={mutedColor} />
        <WorkflowStep icon="sparkles-outline" label="Extract" />
        <Ionicons name="chevron-forward" size={15} color={mutedColor} />
        <WorkflowStep icon="checkmark-circle-outline" label="Approve" />
        <Ionicons name="chevron-forward" size={15} color={mutedColor} />
        <WorkflowStep icon="calendar-outline" label="Calendar" />
      </View>

      <View style={styles.inboxCard}>
        <View style={styles.cardTop}>
          <View style={[styles.iconBox, { backgroundColor: '#FF7A2E18' }]}>
            <Ionicons name="file-tray-full-outline" size={22} color="#FF7A2E" />
          </View>
          <View style={styles.flex}>
            <Text style={styles.cardTitle}>Family Inbox review</Text>
            <Text style={styles.muted}>
              {destination
                ? `${destination} · ${reviewCount} waiting for review`
                : 'Create one private destination for forwarded family email.'}
            </Text>
          </View>
          {reviewCount > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{reviewCount}</Text></View>}
        </View>
        <View style={styles.actionRow}>
          <Pressable onPress={destination ? onReviewInbox : onSetupInbox} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>{destination ? 'Review suggestions' : 'Create Family Inbox'}</Text>
          </Pressable>
          {destination && <Pressable onPress={onSetupInbox} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Inbox settings</Text>
          </Pressable>}
        </View>
      </View>

      <Text style={styles.sectionTitle}>Add any email address</Text>
      <Text style={styles.sectionCopy}>
        Enter the address first, then choose the company that hosts its mailbox. A custom domain such as
        {' '}chad@cragles.net may still be Google Workspace, Microsoft 365, iCloud, or another provider.
      </Text>
      <View style={styles.formCard}>
        {!canManage && <View style={styles.recommendedCard}>
          <Ionicons name="people-outline" size={19} color="#7047EE" />
          <Text style={styles.recommendedText}>
            A household owner or adult admin manages email sources. You can still review approved family events and actions.
          </Text>
        </View>}
        <Text style={styles.label}>EMAIL ADDRESS</Text>
        <TextInput
          editable={canManage}
          value={email}
          onChangeText={updateEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          placeholder="chad@cragles.net"
          placeholderTextColor={placeholderColor}
          style={styles.input}
        />
        <Text style={styles.label}>WHO HOSTS THIS MAILBOX?</Text>
        <View style={styles.providerChoices}>
          {providers.map((item) => {
            const active = provider === item.id;
            return <Pressable key={item.id} disabled={!canManage} onPress={() => {
              setProvider(item.id);
              setProviderOverridden(true);
            }} style={[styles.providerChoice, !canManage && styles.disabled, active && { borderColor: item.color, backgroundColor: `${item.color}12` }]}>
              <View style={[styles.providerIcon, { backgroundColor: `${item.color}18` }]}>
                <Ionicons name={item.icon as any} size={20} color={item.color} />
              </View>
              <View style={styles.flex}><Text style={styles.providerTitle}>{item.title}</Text><Text style={styles.muted}>{item.detail}</Text></View>
              <Ionicons name={active ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={active ? item.color : mutedColor} />
            </Pressable>;
          })}
        </View>
        <View style={styles.recommendedCard}>
          <Ionicons name="shield-checkmark-outline" size={19} color="#19A47B" />
          <Text style={styles.recommendedText}>
            Secure forwarding is available now and never gives Coho your mailbox password. Direct Gmail and
            Microsoft scanning will appear only after provider OAuth and privacy verification are complete.
          </Text>
        </View>
        {!!error && <Text style={styles.error}>{error}</Text>}
        <Pressable disabled={!canManage || busy || !email.trim()} onPress={() => void registerSource()} style={[styles.saveButton, (!canManage || busy || !email.trim()) && styles.disabled]}>
          {busy ? <ActivityIndicator color="#fff" /> : <>
            <Ionicons name="arrow-redo-outline" size={18} color="#fff" />
            <Text style={styles.saveButtonText}>Add source & get forwarding steps</Text>
          </>}
        </Pressable>
      </View>

      <Text style={styles.sectionTitle}>Configured sources</Text>
      {sources.length === 0 ? (
        <View style={styles.emptyCard}>
          <Ionicons name="mail-open-outline" size={28} color="#7047EE" />
          <Text style={styles.cardTitle}>No email sources yet</Text>
          <Text style={styles.muted}>Add the accounts that receive school, appointment, travel, ticket, or activity email.</Text>
        </View>
      ) : sources.map((source) => {
        const meta = providers.find((item) => item.id === source.provider) ?? providers[providers.length - 1];
        const active = source.status === 'active';
        return <View key={source.id} style={styles.sourceCard}>
          <View style={styles.cardTop}>
            <View style={[styles.iconBox, { backgroundColor: `${meta.color}18` }]}>
              <Ionicons name={meta.icon as any} size={21} color={meta.color} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>{source.email_address}</Text>
              <Text style={styles.muted}>{meta.title} · Forwarding</Text>
            </View>
            <View style={[styles.statusPill, active && styles.statusActive]}>
              <Text style={[styles.statusText, active && styles.statusTextActive]}>
                {active ? 'ACTIVE' : 'FORWARDING READY'}
              </Text>
            </View>
          </View>
          <Text style={styles.sourceStatus}>
            {active
              ? `Mail received${source.last_received_at ? ` ${relativeTime(source.last_received_at)}` : ''}. Coh can suggest events from this source.`
              : `Forwarding is ready in Coho. Send selected mail to ${destination ?? 'your Family Inbox'} so it can enter the approval queue.`}
          </Text>
          <View style={styles.actionRow}>
            <Pressable onPress={() => void shareForwardingSteps(source)} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>Forwarding steps</Text>
            </Pressable>
            {canManage && <Pressable onPress={() => removeSource(source)} style={styles.removeButton}>
              <Ionicons name="trash-outline" size={17} color="#D34A3B" />
              <Text style={styles.removeText}>Remove</Text>
            </Pressable>}
          </View>
        </View>;
      })}

      <View style={styles.privacyCard}>
        <Ionicons name="lock-closed" size={19} color="#19A47B" />
        <Text style={styles.privacyText}>
          Raw email and attachments are limited to household owners and adult admins in the review queue.
          Approved events and tasks become visible to the family. Coho never treats instructions inside an email as authorization.
        </Text>
      </View>
    </ScrollView>
  );
}

function WorkflowStep({ icon, label }: { icon: string; label: string }) {
  return <View style={workflowStyles.step}>
    <Ionicons name={icon as any} size={17} color="#7047EE" />
    <Text style={workflowStyles.label}>{label}</Text>
  </View>;
}

const workflowStyles = StyleSheet.create({
  step: { flex: 1, alignItems: 'center', gap: 4 },
  label: { color: '#7047EE', fontSize: 8, fontWeight: '900' },
});

function relativeTime(value: string) {
  const diff = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(diff)) return '';
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function createStyles(dark: boolean) {
  const palette = dark
    ? { canvas: '#0E1726', surface: '#151F31', surface2: '#1B2740', text: '#F7F8FB', muted: '#A8B1C4', line: '#2B3954' }
    : { canvas: '#FFF8E8', surface: '#FFFFFF', surface2: '#FAFBFD', text: '#13203D', muted: '#727D94', line: '#E6DECC' };
  return StyleSheet.create({
    page: { padding: 18, paddingBottom: 130, gap: 11, backgroundColor: palette.canvas },
    hero: { borderRadius: 25, padding: 21, backgroundColor: '#24116D' },
    heroIcon: { width: 46, height: 46, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#7047EE' },
    eyebrow: { color: '#C9BCFF', fontSize: 8, fontWeight: '900', letterSpacing: 1.3, marginTop: 14 },
    heroTitle: { color: '#fff', fontSize: 24, lineHeight: 29, fontWeight: '900', letterSpacing: -.7, marginTop: 7 },
    heroText: { color: '#FFFFFFCC', fontSize: 11, lineHeight: 17, marginTop: 8 },
    workflowCard: { minHeight: 78, borderRadius: 20, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line },
    inboxCard: { borderRadius: 22, padding: 15, gap: 13, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line },
    formCard: { borderRadius: 22, padding: 15, gap: 9, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line },
    sourceCard: { borderRadius: 20, padding: 14, gap: 11, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line },
    cardTop: { flexDirection: 'row', alignItems: 'center', gap: 11 },
    iconBox: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
    flex: { flex: 1 },
    cardTitle: { color: palette.text, fontSize: 13, fontWeight: '900' },
    muted: { color: palette.muted, fontSize: 9, lineHeight: 14, marginTop: 3 },
    sectionTitle: { color: palette.text, fontSize: 17, fontWeight: '900', marginTop: 14 },
    sectionCopy: { color: palette.muted, fontSize: 10, lineHeight: 16 },
    label: { color: palette.muted, fontSize: 8, fontWeight: '900', letterSpacing: 1, marginTop: 4 },
    input: { minHeight: 49, borderRadius: 14, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.surface2, color: palette.text, paddingHorizontal: 13, fontSize: 12 },
    placeholder: { color: '#8B93A5' },
    providerChoices: { gap: 8 },
    providerChoice: { minHeight: 68, borderRadius: 17, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: palette.surface2, borderWidth: 1, borderColor: palette.line },
    providerIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
    providerTitle: { color: palette.text, fontSize: 11, fontWeight: '800' },
    recommendedCard: { borderRadius: 16, padding: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 9, backgroundColor: '#19A47B10', borderWidth: 1, borderColor: '#19A47B35' },
    recommendedText: { flex: 1, color: palette.text, fontSize: 9, lineHeight: 14, fontWeight: '600' },
    saveButton: { minHeight: 49, borderRadius: 15, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2257F4' },
    saveButtonText: { color: '#fff', fontSize: 10, fontWeight: '900' },
    primaryButton: { flex: 1, minHeight: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2257F4', paddingHorizontal: 12 },
    primaryButtonText: { color: '#fff', fontSize: 10, fontWeight: '900' },
    secondaryButton: { flex: 1, minHeight: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2257F410', borderWidth: 1, borderColor: '#2257F455', paddingHorizontal: 10 },
    secondaryButtonText: { color: '#2257F4', fontSize: 9, fontWeight: '900' },
    actionRow: { flexDirection: 'row', gap: 9 },
    badge: { minWidth: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FF7A2E' },
    badgeText: { color: '#fff', fontSize: 10, fontWeight: '900' },
    statusPill: { borderRadius: 12, paddingHorizontal: 9, paddingVertical: 7, backgroundColor: '#FF7A2E14' },
    statusActive: { backgroundColor: '#19A47B16' },
    statusText: { color: '#C16A22', fontSize: 7, fontWeight: '900' },
    statusTextActive: { color: '#168866' },
    sourceStatus: { color: palette.text, fontSize: 9, lineHeight: 14 },
    removeButton: { minHeight: 44, borderRadius: 14, paddingHorizontal: 13, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: '#D34A3B10', borderWidth: 1, borderColor: '#D34A3B30' },
    removeText: { color: '#D34A3B', fontSize: 9, fontWeight: '900' },
    error: { color: '#D34A3B', backgroundColor: '#D34A3B12', borderRadius: 13, padding: 11, fontSize: 10, lineHeight: 15 },
    disabled: { opacity: .45 },
    emptyCard: { minHeight: 145, borderRadius: 20, alignItems: 'center', justifyContent: 'center', gap: 7, padding: 20, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line },
    privacyCard: { borderRadius: 18, padding: 14, flexDirection: 'row', gap: 11, alignItems: 'flex-start', backgroundColor: '#19A47B10', borderWidth: 1, borderColor: '#19A47B35', marginTop: 8 },
    privacyText: { color: palette.text, flex: 1, fontSize: 9, lineHeight: 14, fontWeight: '600' },
  });
}
