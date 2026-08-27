import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
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
  type EmailSourceProvider,
  type HouseholdEmailSource,
  listHouseholdEmailSources,
  registerForwardingEmailSource,
  removeHouseholdEmailSource,
  suggestedEmailProvider,
} from '../services/emailSources';
import {
  disconnectMailboxConnection,
  getMailboxCapabilities,
  listMailboxConnections,
  type MailboxCapabilities,
  type MailboxConnection,
  type MailboxProvider,
  saveMailboxConnectionSettings,
  startMailboxConnection,
  syncMailboxConnection,
} from '../services/mailboxConnections';
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
  refreshToken?: number;
  onNotice: (message: string) => void;
  onConnectionStateChange?: (provider: MailboxProvider, connected: boolean) => void;
  onReviewInbox: () => void;
  onSetupInbox: () => void;
};

const directProviders: Array<{
  id: MailboxProvider;
  title: string;
  shortTitle: string;
  detail: string;
  icon: string;
  color: string;
}> = [
  {
    id: 'google',
    title: 'Gmail or Google Workspace',
    shortTitle: 'Gmail',
    detail: 'Securely read selected Gmail labels with Google authorization.',
    icon: 'logo-google',
    color: '#4285F4',
  },
  {
    id: 'outlook',
    title: 'Outlook or Microsoft 365',
    shortTitle: 'Outlook',
    detail: 'Securely read selected Outlook folders with Microsoft authorization.',
    icon: 'logo-microsoft',
    color: '#0078D4',
  },
];

type ForwardingProvider = 'icloud' | 'yahoo' | 'custom';

const fallbackProviders: Array<{
  id: ForwardingProvider;
  title: string;
  detail: string;
  icon: string;
  color: string;
}> = [
  {
    id: 'icloud',
    title: 'iCloud Mail',
    detail: 'Forward selected messages from iCloud or an iCloud+ custom domain.',
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

const providerMetadata = [
  ...directProviders.map((provider) => ({
    ...provider,
    legacyId: provider.id === 'outlook' ? 'microsoft' : provider.id,
  })),
  ...fallbackProviders.map((provider) => ({ ...provider, legacyId: provider.id })),
];

export default function EmailConnectionsScreen({
  dark,
  householdId,
  userId,
  initialProvider = 'custom',
  canManage,
  refreshToken = 0,
  onNotice,
  onConnectionStateChange,
  onReviewInbox,
  onSetupInbox,
}: Props) {
  const styles = useMemo(() => createStyles(dark), [dark]);
  const mutedColor = dark ? '#A8B1C4' : '#727D94';
  const placeholderColor = dark ? '#7F8AA0' : '#8B93A5';
  const [inbox, setInbox] = useState<HouseholdInbox | null>(null);
  const [sources, setSources] = useState<HouseholdEmailSource[]>([]);
  const [mailboxConnections, setMailboxConnections] = useState<MailboxConnection[]>([]);
  const [mailboxCapabilities, setMailboxCapabilities] = useState<MailboxCapabilities | null>(null);
  const [reviewCount, setReviewCount] = useState(0);
  const [email, setEmail] = useState('');
  const [provider, setProvider] = useState<ForwardingProvider>(
    isForwardingProvider(initialProvider) ? initialProvider : 'custom',
  );
  const [providerOverridden, setProviderOverridden] = useState(
    isForwardingProvider(initialProvider) && initialProvider !== 'custom',
  );
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState('');
  const loadSequence = useRef(0);
  const requestedHouseholdId = useRef<string | null | undefined>(undefined);

  async function load(options: { preserveError?: boolean } = {}) {
    const loadId = ++loadSequence.current;
    const targetHouseholdId = householdId;
    if (requestedHouseholdId.current !== targetHouseholdId) {
      requestedHouseholdId.current = targetHouseholdId;
      setInbox(null);
      setSources([]);
      setMailboxConnections([]);
      setMailboxCapabilities(null);
      setReviewCount(0);
      onConnectionStateChange?.('google', false);
      onConnectionStateChange?.('outlook', false);
    }
    if (!targetHouseholdId) {
      try {
        const capabilities = await getMailboxCapabilities();
        if (loadId !== loadSequence.current) return;
        setMailboxCapabilities(capabilities);
        if (!options.preserveError) setError('');
      } catch (nextError) {
        if (loadId !== loadSequence.current) return;
        setMailboxCapabilities(null);
        if (!options.preserveError) {
          setError(errorMessage(nextError, 'Direct mailbox setup status could not be checked.'));
        }
      }
      return;
    }
    const [
      inboxResult,
      sourcesResult,
      reviewResult,
      connectionsResult,
      capabilitiesResult,
    ] = await Promise.allSettled([
      getHouseholdInbox(targetHouseholdId),
      listHouseholdEmailSources(targetHouseholdId),
      countInboundItemsForReview(targetHouseholdId),
      listMailboxConnections(targetHouseholdId),
      getMailboxCapabilities(),
    ]);
    if (loadId !== loadSequence.current) return;

    if (inboxResult.status === 'fulfilled') setInbox(inboxResult.value);
    if (sourcesResult.status === 'fulfilled') setSources(sourcesResult.value);
    if (reviewResult.status === 'fulfilled') setReviewCount(reviewResult.value);
    const capabilities = capabilitiesResult.status === 'fulfilled'
      ? capabilitiesResult.value
      : null;
    setMailboxCapabilities(capabilities);
    if (connectionsResult.status === 'fulfilled') {
      setMailboxConnections(connectionsResult.value);
      for (const providerId of ['google', 'outlook'] as const) {
        onConnectionStateChange?.(
          providerId,
          connectionsResult.value.some((connection) =>
            connection.provider === providerId
            && ['active', 'syncing', 'paused'].includes(connection.status)),
        );
      }
    }

    const failure = [capabilitiesResult, connectionsResult, inboxResult, sourcesResult, reviewResult]
      .find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') {
      if (!options.preserveError) {
        setError(errorMessage(failure.reason, 'Some email connection details could not be loaded.'));
      }
    } else if (!options.preserveError) {
      setError('');
    }
  }

  useEffect(() => {
    void load();
  }, [householdId, refreshToken]);

  useEffect(() => {
    if (isForwardingProvider(initialProvider)) {
      setProvider(initialProvider);
      setProviderOverridden(initialProvider !== 'custom');
    }
  }, [initialProvider]);

  function updateEmail(value: string) {
    setEmail(value);
    if (!providerOverridden) {
      const suggested = suggestedEmailProvider(value);
      setProvider(isForwardingProvider(suggested) ? suggested : 'custom');
    }
  }

  async function connectMailbox(providerId: MailboxProvider) {
    if (!canManage) {
      setError('Ask a household owner or adult admin to connect this mailbox.');
      return;
    }
    if (!householdId) {
      setError('Join an OutrSPACE household before connecting a mailbox.');
      return;
    }
    if (!inbox) {
      setError('Create the Family Inbox first so Ace has a private review queue.');
      return;
    }
    if (
      mailboxCapabilities?.enabled !== true
      || mailboxCapabilities.providers[providerId] !== true
    ) {
      setError(`${providerName(providerId)} direct connection setup is not available yet. Use forwarding below for now.`);
      return;
    }
    setBusyAction(`connect:${providerId}`);
    setError('');
    try {
      const authorizationUrl = await startMailboxConnection(householdId, providerId);
      onNotice(`Opening ${providerName(providerId)} authorization`);
      await Linking.openURL(authorizationUrl);
    } catch (nextError) {
      setError(errorMessage(nextError, 'The mailbox connection could not start.'));
    } finally {
      setBusyAction(null);
    }
  }

  async function syncMailbox(connection: MailboxConnection) {
    setBusyAction(`sync:${connection.id}`);
    setError('');
    try {
      const result = await syncMailboxConnection(connection.id);
      const connectionResult = Array.isArray(result.results)
        ? result.results.find((item) => item.connectionId === connection.id)
        : undefined;
      if (!connectionResult) {
        throw new Error('The mailbox sync finished without a result for this account. Retry safely.');
      }
      if (!result.ok || connectionResult.ok === false) {
        throw new Error(connectionResult?.error || 'The mailbox sync needs attention.');
      }
      if (connectionResult.skipped) {
        onNotice(`${providerName(connection.provider)} is already syncing`);
      } else {
        const imported = connectionResult.imported ?? 0;
        onNotice(
          imported
            ? `${imported} new email ${imported === 1 ? 'item is' : 'items are'} ready for review`
            : `${providerName(connection.provider)} is up to date`,
        );
      }
      await load();
    } catch (nextError) {
      setError(errorMessage(nextError, 'The mailbox could not sync.'));
      await load({ preserveError: true });
    } finally {
      setBusyAction(null);
    }
  }

  async function saveMailboxSettings(connection: MailboxConnection) {
    const selectedFolderIds = connection.selected_folders
      .filter((folder) => folder.selected)
      .map((folder) => folder.id);
    if (connection.sync_policy.mode === 'selected_folders' && selectedFolderIds.length === 0) {
      setError('Choose at least one label or folder, or use Inbox only.');
      return;
    }
    setBusyAction(`settings:${connection.id}`);
    setError('');
    try {
      await saveMailboxConnectionSettings({
        connectionId: connection.id,
        mode: connection.sync_policy.mode,
        lookbackDays: connection.sync_policy.lookbackDays,
        selectedFolderIds,
        syncEnabled: connection.sync_enabled,
      });
      onNotice('Mailbox settings saved');
      await load();
    } catch (nextError) {
      setError(errorMessage(nextError, 'Mailbox settings could not be saved.'));
    } finally {
      setBusyAction(null);
    }
  }

  function disconnectMailbox(connection: MailboxConnection) {
    Alert.alert(
      `Disconnect ${providerName(connection.provider)}?`,
      'OutrSPACE will stop reading new email from this account. Existing Family Inbox items and approved events remain.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setBusyAction(`disconnect:${connection.id}`);
              setError('');
              try {
                await disconnectMailboxConnection(connection.id);
                await load();
                onNotice(`${providerName(connection.provider)} disconnected`);
              } catch (nextError) {
                setError(errorMessage(nextError, 'The mailbox could not be disconnected.'));
              } finally {
                setBusyAction(null);
              }
            })();
          },
        },
      ],
    );
  }

  function patchMailboxConnection(
    connectionId: string,
    patch: (connection: MailboxConnection) => MailboxConnection,
  ) {
    setMailboxConnections((current) => current.map((connection) =>
      connection.id === connectionId ? patch(connection) : connection));
  }

  async function registerSource() {
    if (!canManage) {
      setError('Ask a household owner or adult admin to add this email source.');
      return;
    }
    if (!householdId || !userId) {
      setError('Join an OutrSPACE household before adding an email source.');
      return;
    }
    if (!inbox) {
      setError('Create the Family Inbox first so OutrSPACE has a private address for forwarded mail.');
      onSetupInbox();
      return;
    }
    setBusyAction('forwarding:add');
    setError('');
    try {
      const source = await registerForwardingEmailSource({
        householdId,
        userId,
        emailAddress: email,
        provider,
      });
      setEmail('');
      setProviderOverridden(isForwardingProvider(initialProvider) && initialProvider !== 'custom');
      await load();
      onNotice(`${source.email_address} is ready for forwarding setup`);
      await shareForwardingSteps(source);
    } catch (nextError) {
      setError(errorMessage(nextError, 'That email source could not be added.'));
    } finally {
      setBusyAction(null);
    }
  }

  async function shareForwardingSteps(source: HouseholdEmailSource) {
    if (!inbox) {
      onSetupInbox();
      return;
    }
    const destination = inboxAddress(inbox);
    try {
      await Share.share({
        message:
          `Set ${source.email_address} to forward important school, appointment, travel, ticket, and activity email to ${destination}.\n\n`
          + 'OutrSPACE keeps each message private, suggests calendar or task details, and waits for family approval before creating anything.',
      });
    } catch {
      setError(`The forwarding source is saved, but sharing did not open. Forward selected email to ${destination}.`);
    }
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
              setBusyAction(`forwarding:remove:${source.id}`);
              setError('');
              try {
                await removeHouseholdEmailSource(source.id);
                await load();
                onNotice(`${source.email_address} was removed`);
              } catch (nextError) {
                setError(errorMessage(nextError, 'The email source could not be removed.'));
              } finally {
                setBusyAction(null);
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
        <Text style={styles.heroTitle}>Connect email. Let Ace find what matters.</Text>
        <Text style={styles.heroText}>
          Ace securely reads the Gmail or Outlook scope you choose, extracts dates, people, places, tasks, updates,
          and cancellations, then prepares actions for family review.
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
                : 'Create one private review queue for connected and forwarded family email.'}
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

      <Text style={styles.sectionTitle}>Connect a mailbox</Text>
      <Text style={styles.sectionCopy}>
        Sign in with Google or Microsoft, choose the smallest email scope your family needs, and let Ace
        continuously extract event suggestions. OutrSPACE never receives your mailbox password.
      </Text>
      {!canManage && <View style={styles.recommendedCard}>
        <Ionicons name="people-outline" size={19} color="#7047EE" />
        <Text style={styles.recommendedText}>
          A household owner or adult admin manages mailbox connections. You can still review approved family events and actions.
        </Text>
      </View>}
      {directProviders.map((meta) => {
        const providerConnections = mailboxConnections.filter((connection) =>
          connection.provider === meta.id);
        const providerAvailable = mailboxCapabilities
          ? mailboxCapabilities.enabled && mailboxCapabilities.providers[meta.id]
          : null;
        return <View key={meta.id} style={styles.formCard}>
          <View style={styles.cardTop}>
            <View style={[styles.iconBox, { backgroundColor: `${meta.color}18` }]}>
              <Ionicons name={meta.icon as any} size={22} color={meta.color} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>{meta.title}</Text>
              <Text style={styles.muted}>{meta.detail}</Text>
            </View>
          </View>
          {providerAvailable !== true && <View style={styles.setupPendingCard}>
            <Ionicons
              name={providerAvailable === null ? 'hourglass-outline' : 'construct-outline'}
              size={18}
              color="#A96013"
            />
            <Text style={styles.setupPendingText}>
              {providerAvailable === null
                ? `${meta.shortTitle} connection availability could not be verified. Retry when OutrSPACE is online.`
                : `${meta.shortTitle} direct connection setup is pending. Use forwarding below until the provider is enabled.`}
            </Text>
          </View>}

          {providerConnections.length === 0 ? <Pressable
            disabled={!canManage || busyAction !== null || providerAvailable !== true}
            onPress={() => void connectMailbox(meta.id)}
            style={[
              styles.saveButton,
              (!canManage || busyAction !== null || providerAvailable !== true) && styles.disabled,
            ]}
          >
            {busyAction === `connect:${meta.id}` ? <ActivityIndicator color="#fff" /> : <>
              <Ionicons name="lock-closed-outline" size={17} color="#fff" />
              <Text style={styles.saveButtonText}>Connect {meta.shortTitle}</Text>
            </>}
          </Pressable> : providerConnections.map((connection) => {
            const status = mailboxStatus(connection, providerAvailable);
            const canConfigure = ['active', 'syncing', 'paused', 'error'].includes(connection.status);
            const controlsDisabled = !canManage
              || busyAction !== null
              || providerAvailable !== true
              || connection.status === 'syncing';
            return <View key={connection.id} style={styles.connectionPanel}>
              <View style={styles.cardTop}>
                <View style={styles.flex}>
                  <Text style={styles.connectionEmail}>{connection.provider_email || connection.display_name || meta.shortTitle}</Text>
                  <Text style={styles.muted}>
                    {connection.last_synced_at
                      ? `Last synced ${relativeTime(connection.last_synced_at)}`
                      : connection.status === 'active'
                        ? 'Authorized; the first successful sync has not finished yet.'
                        : 'No successful mailbox sync yet.'}
                  </Text>
                </View>
                <View style={[styles.statusPill, { backgroundColor: `${status.color}16` }]}>
                  <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
                </View>
              </View>

              {!!connection.last_error && <Text style={styles.connectionError}>{connection.last_error}</Text>}

              {canConfigure && <>
                <Text style={styles.label}>EMAIL SCOPE</Text>
                <View style={styles.choiceRow}>
                  {([
                    ['inbox', 'Inbox only'],
                    ['selected_folders', 'Choose folders'],
                  ] as const).map(([mode, label]) => <Pressable
                    key={mode}
                    disabled={controlsDisabled}
                    onPress={() => patchMailboxConnection(connection.id, (current) => ({
                      ...current,
                      sync_policy: { ...current.sync_policy, mode },
                    }))}
                    style={[
                      styles.choiceChip,
                      connection.sync_policy.mode === mode && styles.choiceChipActive,
                      controlsDisabled && styles.disabled,
                    ]}
                  >
                    <Text style={[styles.choiceChipText, connection.sync_policy.mode === mode && styles.choiceChipTextActive]}>{label}</Text>
                  </Pressable>)}
                </View>
                {connection.sync_policy.mode === 'selected_folders' && <View style={styles.folderChoices}>
                  {connection.selected_folders.map((folder) => <Pressable
                    key={folder.id}
                    disabled={controlsDisabled}
                    onPress={() => patchMailboxConnection(connection.id, (current) => ({
                      ...current,
                      selected_folders: current.selected_folders.map((item) =>
                        item.id === folder.id ? { ...item, selected: !item.selected } : item),
                    }))}
                    style={[
                      styles.folderChip,
                      folder.selected && styles.folderChipActive,
                      controlsDisabled && styles.disabled,
                    ]}
                  >
                    <Ionicons name={folder.selected ? 'checkmark-circle' : 'ellipse-outline'} size={15} color={folder.selected ? '#2257F4' : mutedColor} />
                    <Text style={[styles.folderChipText, folder.selected && styles.folderChipTextActive]}>{folder.name}</Text>
                  </Pressable>)}
                </View>}

                <Text style={styles.label}>RECENT EMAIL TO CHECK ON FIRST SYNC</Text>
                <View style={styles.choiceRow}>
                  {([
                    [0, 'New mail only'],
                    [7, 'Past 7 days'],
                    [30, 'Past 30 days'],
                  ] as const).map(([days, label]) => <Pressable
                    key={days}
                    disabled={controlsDisabled}
                    onPress={() => patchMailboxConnection(connection.id, (current) => ({
                      ...current,
                      sync_policy: { ...current.sync_policy, lookbackDays: days },
                    }))}
                    style={[
                      styles.choiceChip,
                      connection.sync_policy.lookbackDays === days && styles.choiceChipActive,
                      controlsDisabled && styles.disabled,
                    ]}
                  >
                    <Text style={[styles.choiceChipText, connection.sync_policy.lookbackDays === days && styles.choiceChipTextActive]}>{label}</Text>
                  </Pressable>)}
                </View>

                <Text style={styles.label}>WHAT ACE DOES WITH A COMPLETE EVENT</Text>
                <View style={[styles.behaviorChoice, styles.behaviorChoiceActive]}>
                  <Ionicons name="checkmark-circle" size={18} color="#7047EE" />
                  <View style={styles.flex}>
                    <Text style={styles.providerTitle}>Prepare it for approval</Text>
                    <Text style={styles.muted}>
                      Ace extracts the event, cancellation, change, or task and puts a one-tap action in Family Inbox.
                      Calendar writing stays human-approved so your family controls every change.
                    </Text>
                  </View>
                </View>

                <View style={styles.switchRow}>
                  <View style={styles.flex}>
                    <Text style={styles.providerTitle}>Keep this mailbox syncing</Text>
                    <Text style={styles.muted}>Turn off to pause new email without disconnecting.</Text>
                  </View>
                  <Switch
                    disabled={controlsDisabled}
                    value={connection.sync_enabled}
                    onValueChange={(syncEnabled) => patchMailboxConnection(connection.id, (current) => ({
                      ...current,
                      sync_enabled: syncEnabled,
                    }))}
                    trackColor={{ false: '#9BA4B6', true: '#2257F4' }}
                  />
                </View>

                <Pressable
                  disabled={controlsDisabled}
                  onPress={() => void saveMailboxSettings(connection)}
                  style={[styles.primaryButton, styles.fullButton, controlsDisabled && styles.disabled]}
                >
                  {busyAction === `settings:${connection.id}`
                    ? <ActivityIndicator color="#fff" />
                    : <Text style={styles.primaryButtonText}>Save mailbox settings</Text>}
                </Pressable>
              </>}

              <View style={styles.actionRow}>
                {connection.sync_enabled && ['active', 'error'].includes(connection.status) && <Pressable
                  disabled={controlsDisabled}
                  onPress={() => void syncMailbox(connection)}
                  style={[styles.secondaryButton, controlsDisabled && styles.disabled]}
                >
                  {busyAction === `sync:${connection.id}`
                    ? <ActivityIndicator color="#2257F4" />
                    : <Text style={styles.secondaryButtonText}>Sync now</Text>}
                </Pressable>}
                {['reauthorize', 'disconnected'].includes(connection.status) && <Pressable
                  disabled={!canManage || busyAction !== null || providerAvailable !== true}
                  onPress={() => void connectMailbox(connection.provider)}
                  style={[
                    styles.secondaryButton,
                    (!canManage || busyAction !== null || providerAvailable !== true) && styles.disabled,
                  ]}
                >
                  <Text style={styles.secondaryButtonText}>Reconnect</Text>
                </Pressable>}
                {connection.status !== 'disconnected' && canManage && <Pressable
                  disabled={controlsDisabled}
                  onPress={() => disconnectMailbox(connection)}
                  style={[styles.removeButton, controlsDisabled && styles.disabled]}
                >
                  {busyAction === `disconnect:${connection.id}`
                    ? <ActivityIndicator color="#D34A3B" />
                    : <><Ionicons name="unlink-outline" size={17} color="#D34A3B" /><Text style={styles.removeText}>Disconnect</Text></>}
                </Pressable>}
              </View>
            </View>;
          })}

          {providerConnections.length > 0 && <Pressable
            disabled={!canManage || busyAction !== null || providerAvailable !== true}
            onPress={() => void connectMailbox(meta.id)}
            style={[
              styles.addAccountButton,
              (!canManage || busyAction !== null || providerAvailable !== true) && styles.disabled,
            ]}
          >
            <Ionicons name="add-circle-outline" size={17} color={meta.color} />
            <Text style={[styles.secondaryButtonText, { color: meta.color }]}>Connect another {meta.shortTitle} account</Text>
          </Pressable>}
        </View>;
      })}

      {!!error && <Text style={styles.error}>{error}</Text>}

      <Text style={styles.sectionTitle}>Forwarding fallback</Text>
      <Text style={styles.sectionCopy}>
        For iCloud, Yahoo, and other providers without direct OutrSPACE authorization, forward only selected family email
        to the private Family Inbox. Forwarding is not a connected mailbox and does not scan your account.
      </Text>
      <View style={styles.formCard}>
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
        <Text style={styles.label}>FORWARDING PROVIDER</Text>
        <View style={styles.providerChoices}>
          {fallbackProviders.map((item) => {
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
        <Pressable
          disabled={!canManage || busyAction !== null || !email.trim()}
          onPress={() => void registerSource()}
          style={[styles.saveButton, (!canManage || busyAction !== null || !email.trim()) && styles.disabled]}
        >
          {busyAction === 'forwarding:add' ? <ActivityIndicator color="#fff" /> : <>
            <Ionicons name="arrow-redo-outline" size={18} color="#fff" />
            <Text style={styles.saveButtonText}>Get forwarding steps</Text>
          </>}
        </Pressable>
      </View>

      <Text style={styles.sectionTitle}>Forwarding sources</Text>
      {sources.filter((source) => source.connection_method === 'forwarding').length === 0 ? (
        <View style={styles.emptyCard}>
          <Ionicons name="arrow-redo-outline" size={28} color="#7047EE" />
          <Text style={styles.cardTitle}>No forwarding fallbacks</Text>
          <Text style={styles.muted}>Use this only when direct Gmail or Outlook authorization is not available.</Text>
        </View>
      ) : sources.filter((source) => source.connection_method === 'forwarding').map((source) => {
        const meta = providerMetadata.find((item) => item.legacyId === source.provider)
          ?? providerMetadata[providerMetadata.length - 1];
        const active = source.status === 'active';
        return <View key={source.id} style={styles.sourceCard}>
          <View style={styles.cardTop}>
            <View style={[styles.iconBox, { backgroundColor: `${meta.color}18` }]}>
              <Ionicons name={meta.icon as any} size={21} color={meta.color} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>{source.email_address}</Text>
              <Text style={styles.muted}>{meta.title} · Forwarding fallback</Text>
            </View>
            <View style={[styles.statusPill, active && styles.statusActive]}>
              <Text style={[styles.statusText, active && styles.statusTextActive]}>
                {active ? 'MAIL RECEIVED' : 'STEPS READY'}
              </Text>
            </View>
          </View>
          <Text style={styles.sourceStatus}>
            {active
              ? `Forwarded mail received${source.last_received_at ? ` ${relativeTime(source.last_received_at)}` : ''}.`
              : `Forward selected mail to ${destination ?? 'your Family Inbox'}. This source is not connected until mail is received.`}
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
          Approved events and tasks become visible to the family. OutrSPACE never treats instructions inside an email as authorization.
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

function isForwardingProvider(provider: EmailSourceProvider): provider is ForwardingProvider {
  return provider === 'icloud' || provider === 'yahoo' || provider === 'custom';
}

function providerName(provider: MailboxProvider) {
  return provider === 'google' ? 'Gmail' : 'Outlook';
}

function mailboxStatus(connection: MailboxConnection, providerAvailable: boolean | null) {
  if (providerAvailable === null) return { label: 'CHECKING', color: '#A96013' };
  if (!providerAvailable) return { label: 'SETUP PENDING', color: '#A96013' };
  if (connection.status === 'active' && connection.sync_enabled) {
    return { label: 'CONNECTED', color: '#168866' };
  }
  if (connection.status === 'syncing') return { label: 'SYNCING', color: '#2257F4' };
  if (connection.status === 'pending') return { label: 'CONNECTING', color: '#A96013' };
  if (connection.status === 'reauthorize') return { label: 'RECONNECT', color: '#D34A3B' };
  if (connection.status === 'error') return { label: 'NEEDS ATTENTION', color: '#D34A3B' };
  if (connection.status === 'paused' || !connection.sync_enabled) {
    return { label: 'PAUSED', color: '#A96013' };
  }
  return { label: 'DISCONNECTED', color: '#727D94' };
}

function relativeTime(value: string) {
  const diff = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(diff)) return '';
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message.trim();
  }
  return fallback;
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
    connectionPanel: { borderRadius: 18, padding: 13, gap: 10, backgroundColor: palette.surface2, borderWidth: 1, borderColor: palette.line },
    connectionEmail: { color: palette.text, fontSize: 12, fontWeight: '900' },
    connectionError: { color: '#D34A3B', fontSize: 9, lineHeight: 14, fontWeight: '700' },
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
    setupPendingCard: { borderRadius: 15, padding: 11, flexDirection: 'row', alignItems: 'flex-start', gap: 9, backgroundColor: '#A9601310', borderWidth: 1, borderColor: '#A9601335' },
    setupPendingText: { flex: 1, color: palette.text, fontSize: 9, lineHeight: 14, fontWeight: '600' },
    saveButton: { minHeight: 49, borderRadius: 15, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2257F4' },
    saveButtonText: { color: '#fff', fontSize: 10, fontWeight: '900' },
    primaryButton: { flex: 1, minHeight: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2257F4', paddingHorizontal: 12 },
    primaryButtonText: { color: '#fff', fontSize: 10, fontWeight: '900' },
    secondaryButton: { flex: 1, minHeight: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2257F410', borderWidth: 1, borderColor: '#2257F455', paddingHorizontal: 10 },
    secondaryButtonText: { color: '#2257F4', fontSize: 9, fontWeight: '900' },
    fullButton: { flex: 0, width: '100%' },
    actionRow: { flexDirection: 'row', gap: 9 },
    choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
    choiceChip: { minHeight: 35, borderRadius: 12, justifyContent: 'center', paddingHorizontal: 11, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line },
    choiceChipActive: { backgroundColor: '#2257F414', borderColor: '#2257F4' },
    choiceChipText: { color: palette.muted, fontSize: 8, fontWeight: '800' },
    choiceChipTextActive: { color: '#2257F4' },
    folderChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
    folderChip: { minHeight: 35, maxWidth: '100%', borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line },
    folderChipActive: { backgroundColor: '#2257F410', borderColor: '#2257F466' },
    folderChipText: { color: palette.muted, maxWidth: 210, fontSize: 8, fontWeight: '700' },
    folderChipTextActive: { color: palette.text },
    behaviorChoices: { gap: 7 },
    behaviorChoice: { minHeight: 58, borderRadius: 15, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line },
    behaviorChoiceActive: { backgroundColor: '#7047EE0D', borderColor: '#7047EE66' },
    switchRow: { minHeight: 54, borderRadius: 15, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line },
    addAccountButton: { minHeight: 40, borderRadius: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderWidth: 1, borderStyle: 'dashed', borderColor: palette.line },
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
