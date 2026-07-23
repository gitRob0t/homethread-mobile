import AuthGate from './src/components/AuthGate';
import AppErrorBoundary from './src/components/AppErrorBoundary';
import AutomationRulesScreen from './src/components/AutomationRules';
import FamilyInboxScreen from './src/components/FamilyInbox';
import FamilyHub from './src/components/FamilyHub';
import PrivacyDataScreen from './src/components/PrivacyData';
import {
  CalendarConnectionScreen,
  FamilyPlacesScreen,
  FoodHubScreen,
  TravelHubScreen,
} from './src/components/HouseholdOS';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import * as Notifications from 'expo-notifications';
import * as Speech from 'expo-speech';
import { StatusBar } from 'expo-status-bar';
import { ShareIntentProvider, useShareIntentContext } from 'expo-share-intent';
import { useEffect, useMemo, useState } from 'react';
import {
  askCoh,
  attachmentFromUri,
  type CohAttachment,
  type CohDraft,
  type CohHistoryItem,
} from './src/services/cohAssistant';
import { writeApprovedEventToDevice } from './src/services/deviceCalendar';
import { supabase } from './src/lib/supabase';
import {
  listHouseholdPeople,
  listHouseholds,
  saveHouseholdPerson,
  type HouseholdPerson,
  uploadHouseholdPersonAvatar,
} from './src/services/households';
import { addGroceryItems, upsertMealPlans } from './src/services/householdOperations';
import { registerPushDevice, syncBriefingPreferences } from './src/services/pushNotifications';
import {
  getHouseholdAction,
  listBriefingSnapshots,
  recordMemberActive,
  recordNotificationOpened,
  subscribeToClosedLoop,
  type BriefingSnapshot,
  type HouseholdAction,
} from './src/services/householdActions';
import {
  completeEventFollowUp,
  createEventFollowUp,
  createFamilyChore,
  createFamilyEvent,
  deleteFamilyChore,
  listEventFollowUps,
  listSharedChores,
  listSharedEvents,
  listSharedMessages,
  listSharedNotes,
  saveFamilyNote,
  sendFamilyMessage,
  setFamilyChoreCompleted,
  type SharedFollowUp,
  type SharedNote,
  subscribeToHousehold,
  updateFamilyChore,
} from './src/services/familyData';
import {
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';

type Theme = ReturnType<typeof createTheme>;
type Tab = 'Today' | 'Calendar' | 'Chores' | 'Chat' | 'More';
type MoreView =
  | 'Menu'
  | 'Chief of Home'
  | 'Family'
  | 'Notes'
  | 'Recaps'
  | 'Automations'
  | 'Integrations'
  | 'Calendar Sync'
  | 'Family Places'
  | 'Meals & Groceries'
  | 'Family Inbox'
  | 'Trips'
  | 'Privacy'
  | 'Settings';
type ChatChannel = 'family' | 'coh';
type ChatMessage = { id: string; mine: boolean; author: string; text: string; bot?: boolean; channel?: ChatChannel };
type BotEvent = {
  id: string;
  sourceId?: string;
  title: string;
  person: string;
  day: string;
  dateISO?: string;
  time: string;
  place?: string;
  reminder?: number;
  directions?: boolean;
  provider?: 'coho' | 'google' | 'outlook' | 'apple' | string;
  sourceCalendarId?: string;
  recurrenceRule?: string;
};
type ChoreRepeat = 'none' | 'daily' | 'weekdays' | 'weekly' | 'biweekly' | 'monthly';
type Chore = {
  id: string;
  title: string;
  details: string;
  owner: string;
  assignedPersonId: string | null;
  assignedUserId: string | null;
  dueAt: string | null;
  due: string;
  recurrence: ChoreRepeat;
  recurrenceRule: string | null;
  reminderMinutes: number | null;
  done: boolean;
  points: number;
  rewardId: string;
  rewardValue: number;
  rewardLabel: string | null;
  color: string;
};
type ChoreFormValue = {
  title: string;
  details: string;
  assignedPersonId: string | null;
  dueAt: Date;
  recurrence: ChoreRepeat;
  reminderMinutes: number | null;
  rewardId: string;
  rewardValue: number;
  rewardLabel: string;
};
type BotField = 'title' | 'day' | 'time' | 'meridiem' | 'place' | 'directions' | 'reminder' | 'confirm';
type BotDraft = { title?: string; person?: string; day?: string; dateISO?: string; time?: string; meridiem?: 'AM' | 'PM'; place?: string; reminder?: number; directions?: boolean; awaiting: BotField };
type ChiefPrefs = { daily: boolean; dailyTime: string; weekAhead: boolean; weekAheadDay: string; weekAheadTime: string; followUp: boolean; followUpDay: string; followUpTime: string; push: boolean; email: boolean; quietHours: boolean; events: boolean; chores: boolean; messages: boolean; followUps: boolean; members: string[] };
type RewardGoal = { id: string; title: string; detail: string; cost: number; icon: string; color: string };
type FamilyProfile = {
  id: string;
  linkedUserId?: string | null;
  name: string;
  dob: string;
  bio: string;
  role: 'Adult admin' | 'Family member' | 'Child';
  avatarUri?: string;
  avatarBase64?: string;
  avatarMime?: string | null;
  color: string;
  ink: string;
};

const defaultChiefPrefs: ChiefPrefs = { daily: true, dailyTime: '7:00 AM', weekAhead: true, weekAheadDay: 'Sunday', weekAheadTime: '6:00 PM', followUp: true, followUpDay: 'Friday', followUpTime: '5:00 PM', push: true, email: false, quietHours: true, events: true, chores: true, messages: false, followUps: true, members: [] };

const rewardGoals: RewardGoal[] = [
  { id: 'game', title: 'Game time', detail: '30 minutes', cost: 30, icon: 'game-controller', color: '#7047EE' },
  { id: 'vbucks', title: 'V-Bucks', detail: '1,000 V-Bucks', cost: 100, icon: 'diamond', color: '#2257F4' },
  { id: 'allowance', title: 'Allowance', detail: '$5 reward', cost: 75, icon: 'cash', color: '#19A47B' },
  { id: 'choice', title: 'My choice', detail: 'Pick a family privilege', cost: 50, icon: 'star', color: '#FF9F1C' },
];

const choreRewardOptions = [
  { id: 'points', title: 'Points', icon: 'trophy', color: '#2257F4', presets: [5, 10, 15, 20, 30, 50] },
  { id: 'game', title: 'Game time', icon: 'game-controller', color: '#7047EE', presets: [15, 30, 45, 60] },
  { id: 'vbucks', title: 'V-Bucks', icon: 'diamond', color: '#2257F4', presets: [100, 200, 500, 1000] },
  { id: 'allowance', title: 'Allowance', icon: 'cash', color: '#19A47B', presets: [1, 2, 5, 10, 20] },
  { id: 'choice', title: 'Custom', icon: 'star', color: '#FF9F1C', presets: [1] },
] as const;

const choreRepeatOptions: Array<{ id: ChoreRepeat; label: string; rule: string | null }> = [
  { id: 'none', label: 'Does not repeat', rule: null },
  { id: 'daily', label: 'Daily', rule: 'FREQ=DAILY' },
  { id: 'weekdays', label: 'Weekdays', rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
  { id: 'weekly', label: 'Weekly', rule: 'FREQ=WEEKLY' },
  { id: 'biweekly', label: 'Every 2 weeks', rule: 'FREQ=WEEKLY;INTERVAL=2' },
  { id: 'monthly', label: 'Monthly', rule: 'FREQ=MONTHLY' },
];

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

function CohoApp() {
  const { hasShareIntent, shareIntent, resetShareIntent, error: shareError } = useShareIntentContext();
  const voiceRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const voiceRecorderState = useAudioRecorderState(voiceRecorder, 250);
  const systemScheme = useColorScheme();
  const [dark, setDark] = useState(systemScheme === 'dark');
  const [tab, setTab] = useState<Tab>('Today');
  const [moreView, setMoreView] = useState<MoreView>('Menu');
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddType, setQuickAddType] = useState('Event');
  const [quickAddTitle, setQuickAddTitle] = useState('');
  const [quickAddDetails, setQuickAddDetails] = useState('');
  const [quickAddSaving, setQuickAddSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [chores, setChores] = useState<Chore[]>([]);
  const [rewardMember, setRewardMember] = useState('');
  const [selectedRewards, setSelectedRewards] = useState<Record<string, string>>({});
  const [profiles, setProfiles] = useState<FamilyProfile[]>([]);
  const [editingProfile, setEditingProfile] = useState<FamilyProfile | null>(null);
  const [familyHubOpen, setFamilyHubOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatMode, setChatMode] = useState<ChatChannel>('family');
  const [messageDraft, setMessageDraft] = useState('');
  const [botDraft, setBotDraft] = useState<BotDraft | null>(null);
  const [botEvents, setBotEvents] = useState<BotEvent[]>([]);
  const [followUps, setFollowUps] = useState<SharedFollowUp[]>([]);
  const [calendarFocusDate, setCalendarFocusDate] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<BotEvent | null>(null);
  const [editingChore, setEditingChore] = useState<Chore | null>(null);
  const [cohConversationId, setCohConversationId] = useState<string | null>(null);
  const [cohHistory, setCohHistory] = useState<CohHistoryItem[]>([]);
  const [cohThinking, setCohThinking] = useState(false);
  const [voiceSending, setVoiceSending] = useState(false);
  const [connected, setConnected] = useState<Record<string, boolean>>({});
  const [sharePreviewOpen, setSharePreviewOpen] = useState(false);
  const [sharedDraft, setSharedDraft] = useState('');
  const [chiefPrefs, setChiefPrefs] = useState<ChiefPrefs>(defaultChiefPrefs);
  const [localDataReady, setLocalDataReady] = useState(false);
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [householdName, setHouseholdName] = useState('Your family');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [initialInboxItemId, setInitialInboxItemId] = useState<string | null>(null);
  const [initialRecapId, setInitialRecapId] = useState<string | null>(null);
  const [briefingSnapshots, setBriefingSnapshots] = useState<BriefingSnapshot[]>([]);
  const [secondUserWelcomeOpen, setSecondUserWelcomeOpen] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem('homethread-theme').then((saved) => {
      if (saved) setDark(saved === 'dark');
    });
    AsyncStorage.getItem('kincue-chief-prefs').then((saved) => {
      if (saved) setChiefPrefs({ ...defaultChiefPrefs, ...JSON.parse(saved) });
    }).catch(() => undefined);
    AsyncStorage.getItem('coho-reward-goals').then((saved) => {
      if (saved) setSelectedRewards(JSON.parse(saved));
    }).catch(() => undefined);
    Promise.all([
      AsyncStorage.getItem('coho-chat-messages-v2'),
      AsyncStorage.getItem('coho-calendar-events-v2'),
      AsyncStorage.getItem('coho-chores-v2'),
    ]).then(([savedMessages, savedEvents, savedChores]) => {
      if (savedMessages) setMessages(JSON.parse(savedMessages));
      if (savedEvents) setBotEvents(JSON.parse(savedEvents));
      if (savedChores) setChores(JSON.parse(savedChores).map((chore: Chore) => ({
        ...chore,
        details: chore.details ?? '',
        assignedPersonId: chore.assignedPersonId ?? null,
        assignedUserId: chore.assignedUserId ?? null,
        dueAt: chore.dueAt ?? null,
        recurrence: chore.recurrence ?? 'none',
        recurrenceRule: chore.recurrenceRule ?? null,
        reminderMinutes: chore.reminderMinutes ?? null,
        rewardId: chore.rewardId ?? 'choice',
        rewardValue: chore.rewardValue ?? chore.points ?? 10,
        rewardLabel: chore.rewardLabel ?? null,
      })));
    }).catch(() => undefined).finally(() => setLocalDataReady(true));
    Notifications.getPermissionsAsync().then((permission) => {
      if (permission.granted) setConnected((current) => ({ ...current, 'iOS Notifications': true }));
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!localDataReady) return;
    AsyncStorage.multiSet([
      ['coho-chat-messages-v2', JSON.stringify(messages.slice(-150))],
      ['coho-calendar-events-v2', JSON.stringify(botEvents)],
      ['coho-chores-v2', JSON.stringify(chores)],
    ]).catch(() => undefined);
  }, [localDataReady, messages, botEvents, chores]);

  useEffect(() => {
    const openNotification = (response: Notifications.NotificationResponse | null) => {
      const data = response?.notification.request.content.data as Record<string, unknown> | undefined;
      if (!data) return;
      if (typeof data.notificationId === 'string') {
        void recordNotificationOpened(data.notificationId, { source: 'push', platform: Platform.OS })
          .catch(() => undefined);
      }
      if (typeof data.deepLink === 'string') {
        void openDeepLink(data.deepLink);
        return;
      }
      openLegacyNotification(data);
    };
    Notifications.getLastNotificationResponseAsync().then(openNotification).catch(() => undefined);
    const subscription = Notifications.addNotificationResponseReceivedListener(openNotification);
    Linking.getInitialURL().then((url) => {
      if (url && /^(coho|homethread):\/\//i.test(url) && !/\/invite\//i.test(url)) {
        void openDeepLink(url);
      }
    }).catch(() => undefined);
    const linkSubscription = Linking.addEventListener('url', ({ url }) => {
      if (!/\/invite\//i.test(url)) void openDeepLink(url);
    });
    return () => {
      subscription.remove();
      linkSubscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!localDataReady) return;
    let active = true;
    let removeSubscriptions: Array<() => void> = [];

    async function connectHousehold() {
      try {
        const [{ data: authData }, memberships] = await Promise.all([
          supabase.auth.getUser(),
          listHouseholds(),
        ]);
        const first = memberships[0]?.households;
        const household = Array.isArray(first) ? first[0] : first;
        if (!active || !authData.user || !household?.id) return;
        setHouseholdId(household.id);
        setHouseholdName(household.name || 'Your family');
        setCurrentUserId(authData.user.id);
        const membershipRole = memberships[0]?.role;
        if (membershipRole && membershipRole !== 'owner') {
          const welcomeSeen = await AsyncStorage.getItem(`coho-member-welcome:${authData.user.id}:${household.id}`);
          if (!welcomeSeen && active) setSecondUserWelcomeOpen(true);
        }
        await reloadSharedData(household.id, authData.user.id);
        const notificationPermission = await Notifications.getPermissionsAsync();
        if (notificationPermission.granted) {
          await registerPushDevice(authData.user.id, household.id).catch(() => undefined);
        }
        await recordMemberActive(household.id).catch(() => undefined);
        if (!active) return;
        removeSubscriptions = (['messages', 'events', 'chores', 'event_follow_ups'] as const).map((table) =>
          subscribeToHousehold(table, household.id, () => void reloadSharedData(household.id, authData.user!.id)),
        );
        removeSubscriptions.push(
          subscribeToClosedLoop(household.id, () => void reloadSharedData(household.id, authData.user!.id)),
        );
      } catch {
        showNotice('Coho is offline. Changes will stay on this iPhone until the household reconnects.');
      }
    }

    void connectHousehold();
    return () => {
      active = false;
      removeSubscriptions.forEach((remove) => remove());
    };
  }, [localDataReady]);

  async function reloadSharedData(targetHousehold = householdId, targetUser = currentUserId) {
    if (!targetHousehold || !targetUser) return;
    const [sharedMessages, sharedEvents, sharedChores, sharedFollowUps, householdPeople, snapshots] = await Promise.all([
      listSharedMessages(targetHousehold),
      listSharedEvents(targetHousehold),
      listSharedChores(targetHousehold),
      listEventFollowUps(targetHousehold),
      listHouseholdPeople(targetHousehold),
      listBriefingSnapshots(targetHousehold),
    ]);
    setMessages((current) => [
      ...current.filter((message) => messageChannel(message) === 'coh'),
      ...sharedMessages.map((message: any) => cloudMessage(message, targetUser)),
    ]);
    setBotEvents(sharedEvents.map((event: any) => cloudEvent(event)));
    setChores(sharedChores.map((chore: any, index: number) => cloudChore(chore, index)));
    setFollowUps(sharedFollowUps);
    setBriefingSnapshots(snapshots);
    const nextProfiles = householdPeople.map((person, index) => personToProfile(person, index));
    setProfiles(nextProfiles);
    setRewardMember((current) => nextProfiles.some((profile) => profile.name === current) ? current : nextProfiles[0]?.name ?? '');
    setChiefPrefs((current) => current.members.length ? current : { ...current, members: nextProfiles.map((profile) => profile.name) });
  }

  useEffect(() => {
    if (!hasShareIntent) return;
    const incoming = shareIntent as any;
    setSharedDraft((incoming?.text || incoming?.webUrl || '').trim());
    setSharePreviewOpen(true);
  }, [hasShareIntent, shareIntent]);

  const theme = useMemo(() => createTheme(dark), [dark]);
  const styles = useMemo(() => createStyles(theme), [theme]);

  async function toggleTheme() {
    const next = !dark;
    setDark(next);
    await AsyncStorage.setItem('homethread-theme', next ? 'dark' : 'light');
  }

  function showNotice(message: string) {
    setNotice(message);
    setTimeout(() => setNotice(null), 2600);
  }

  async function saveQuickAdd(choreForm?: ChoreFormValue) {
    const title = (choreForm?.title ?? quickAddTitle).trim();
    const details = (choreForm?.details ?? quickAddDetails).trim();
    if (!title || quickAddSaving) return;
    const finish = () => {
      setQuickAddOpen(false);
      setQuickAddTitle('');
      setQuickAddDetails('');
    };
    if (quickAddType === 'Chore') {
      if (!householdId || !currentUserId) {
        showNotice('Join a household before sharing a family chore.');
        return;
      }
      if (!choreForm) {
        showNotice('Choose the chore owner, schedule, and reward before saving.');
        return;
      }
      const assignee = profiles.find((profile) => profile.id === choreForm.assignedPersonId) ?? null;
      setQuickAddSaving(true);
      try {
        await createFamilyChore({
          householdId,
          userId: currentUserId,
          title,
          details,
          assignedPersonId: assignee?.id ?? null,
          assignedUserId: assignee?.linkedUserId ?? null,
          dueAt: choreForm.dueAt.toISOString(),
          recurrenceRule: recurrenceRuleFor(choreForm.recurrence),
          reminderMinutes: choreForm.reminderMinutes,
          rewardType: databaseRewardType(choreForm.rewardId),
          rewardValue: choreForm.rewardValue,
          rewardLabel: choreForm.rewardId === 'choice'
            ? choreForm.rewardLabel.trim()
            : choreRewardMeta(choreForm.rewardId).title,
        });
        finish();
        await reloadSharedData(householdId, currentUserId);
        showNotice(`${title} assigned${assignee ? ` to ${assignee.name}` : ''}`);
      } catch (error) {
        showNotice(error instanceof Error ? error.message : 'The chore could not be shared. Try again when Coho is online.');
      } finally {
        setQuickAddSaving(false);
      }
      return;
    }
    finish();
    if (quickAddType === 'Message') {
      setChatMode('family');
      setTab('Chat');
      setMessageDraft([title, details].filter(Boolean).join('\n'));
      showNotice('Review your family message, then send it');
      return;
    }
    if (quickAddType === 'Note') {
      if (!householdId || !currentUserId) {
        showNotice('Join a household before sharing a family note.');
        return;
      }
      try {
        await saveFamilyNote({
          householdId,
          userId: currentUserId,
          title,
          body: details,
          pinned: false,
        });
        showNotice('Note added to the shared household');
      } catch {
        showNotice('The note could not be shared. Try again when Coho is online.');
      }
      return;
    }
    const prompt = `@coh Add an event: ${title}${details ? `. Details: ${details}` : ''}`;
    setChatMode('coh');
    setMessageDraft(prompt);
    setTab('Chat');
    showNotice('Coh will confirm the missing event details before saving');
  }

  function addBotMessage(text: string) {
    setTimeout(() => setMessages((current) => [...current, { id: `bot-${Date.now()}`, mine: false, author: 'Coh', text, bot: true, channel: 'coh' }]), 250);
  }

  async function sendMessage() {
    const text = messageDraft.trim();
    if (!text) return;
    const optimistic = { id: `pending-${Date.now()}`, mine: true, author: 'You', text, channel: chatMode } as ChatMessage;
    setMessages((current) => [...current, optimistic]);
    setMessageDraft('');
    if (chatMode === 'coh') {
      void handleBotMessage(text.match(/^\s*(@coh|hey coh)/i) ? text : `@coh ${text}`);
      return;
    }
    if (!householdId || !currentUserId) {
      showNotice('Family chat is offline. Reconnect before sending this message.');
      return;
    }
    try {
      await sendFamilyMessage(householdId, currentUserId, text);
    } catch {
      setMessages((current) => current.filter((message) => message.id !== optimistic.id));
      setMessageDraft(text);
      showNotice('Message was not sent. Your text is back in the composer.');
    }
  }

  function cancelSharedItem() {
    setSharePreviewOpen(false);
    setSharedDraft('');
    resetShareIntent();
  }

  async function sendSharedItemToCoh() {
    const incoming = shareIntent as any;
    const sharedFiles = Array.isArray(incoming?.files) ? incoming.files.slice(0, 4) : [];
    const text = sharedDraft.trim();
    setSharePreviewOpen(false);
    setTab('Chat');
    setChatMode('coh');
    setCohThinking(true);
    try {
      const attachments = await Promise.all(sharedFiles.map((file: any) =>
        attachmentFromUri({
          uri: file.path,
          name: file.fileName,
          mimeType: file.mimeType,
          size: file.size,
        }),
      ));
      const promptText = text || (attachments.length
        ? '@coh Read this attachment, tell me what it means for our family, and turn anything actionable into proposed events or tasks.'
        : '');
      if (!promptText) {
        addBotMessage('I did not receive readable text or an attachment. Nothing was saved.');
        return;
      }
      const prompt = promptText.match(/^\s*(@coh|hey coh|@bot|hey bot)/i)
        ? promptText
        : `@coh ${promptText}`;
      setMessages((current) => [...current, {
        id: `shared-${Date.now()}`,
        mine: true,
        author: 'You',
        text: attachments.length ? `${prompt}\n📎 ${attachments.map((item) => item.name).join(', ')}` : prompt,
        channel: 'coh',
      }]);
      await handleBotMessage(prompt, attachments);
      setSharedDraft('');
    } catch (nextError) {
      addBotMessage(nextError instanceof Error
        ? nextError.message
        : 'I could not read that attachment. Nothing was saved.');
    } finally {
      resetShareIntent();
      setCohThinking(false);
    }
  }

  async function handleBotMessage(text: string, attachments: CohAttachment[] = []) {
    const normalized = text.trim().toLowerCase();
    const directlyInvoked = normalized.startsWith('@coh') || normalized.startsWith('hey coh') || normalized.startsWith('@bot') || normalized.startsWith('hey bot');
    if (!directlyInvoked && !botDraft && !cohConversationId) return;

    setCohThinking(true);
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const response = await askCoh({
        message: text,
        conversationId: cohConversationId,
        householdId,
        timezone,
        history: cohHistory,
        attachments,
      });
      setCohConversationId(response.conversationId);
      setCohHistory((current) => [...current, { role: 'user' as const, content: text }, { role: 'assistant' as const, content: response.reply }].slice(-16));
      addBotMessage(response.reply);

      if (response.status === 'confirmed' && response.action?.targetId) {
        if (householdId && currentUserId) {
          await reloadSharedData(householdId, currentUserId);
        }
        const targetLabel = response.action.targetTable === 'events'
          ? 'the family calendar'
          : response.action.targetTable === 'chores'
            ? 'shared chores'
            : response.action.targetTable === 'notes'
              ? 'family notes'
              : response.action.targetTable === 'grocery_items'
                ? 'the grocery list'
                : response.action.targetTable === 'meal_plans'
                  ? 'the family meal plan'
                  : 'Coho';
        addBotMessage(`Done — it’s now in ${targetLabel}.`);
        if (response.action.targetTable === 'events') setTab('Calendar');
        if (response.action.targetTable === 'chores') setTab('Chores');
        if (response.action.targetTable === 'notes') { setMoreView('Notes'); setTab('More'); }
        if (response.action.targetTable === 'grocery_items' || response.action.targetTable === 'meal_plans') {
          setMoreView('Meals & Groceries');
          setTab('More');
        }
        setCohConversationId(null);
        setCohHistory([]);
      } else if (response.status === 'confirmed' && response.proposed_action.type === 'create_event') {
        const event = eventFromCohDraft(response.draft);
        if (event) {
          const result = await persistApprovedEvent(event);
          addBotMessage(eventSaveReply(event, result));
        }
        setCohConversationId(null);
        setCohHistory([]);
      } else if (response.status === 'confirmed' && response.proposed_action.type === 'create_chore') {
        if (!householdId || !currentUserId || !response.draft.title) {
          addBotMessage('I could not save that chore because the shared household or title is missing.');
        } else {
          const assignee = response.draft.person
            ? profiles.find((profile) =>
              profile.name.localeCompare(response.draft.person ?? '', undefined, { sensitivity: 'base' }) === 0,
            )
            : null;
          await createFamilyChore({
            householdId,
            userId: currentUserId,
            title: response.draft.title,
            details: response.draft.notes ?? '',
            assignedPersonId: assignee?.id ?? null,
            assignedUserId: assignee?.linkedUserId ?? null,
            dueAt: response.draft.due_at,
            recurrenceRule: response.draft.recurrence_rule,
            reminderMinutes: response.draft.reminder_minutes,
            rewardType: response.draft.reward_type ?? 'points',
            rewardValue: response.draft.reward_value ?? 10,
            rewardLabel: response.draft.reward_label,
          });
          addBotMessage(`Done — “${response.draft.title}” is now a shared chore${assignee ? ` for ${assignee.name}` : ''}. Open Chores to choose what it earns.`);
          showNotice('Coh added the chore to the household');
        }
        setCohConversationId(null);
        setCohHistory([]);
      } else if (response.status === 'confirmed' && response.proposed_action.type === 'create_note') {
        if (!householdId || !currentUserId || !response.draft.title) {
          addBotMessage('I could not save that note because the shared household or title is missing.');
        } else {
          await saveFamilyNote({
            householdId,
            userId: currentUserId,
            title: response.draft.title,
            body: response.draft.notes ?? '',
            pinned: false,
          });
          addBotMessage(`Done — “${response.draft.title}” is in the shared family notes.`);
          showNotice('Coh added the note to the household');
        }
        setCohConversationId(null);
        setCohHistory([]);
      } else if (response.status === 'confirmed' && response.proposed_action.type === 'add_grocery_items') {
        if (!householdId || !currentUserId) {
          addBotMessage('Join a Coho household first so I can add those items to a shared grocery list.');
        } else {
          await addGroceryItems({
            householdId,
            userId: currentUserId,
            items: response.draft.grocery_items,
          });
          showNotice(`${response.draft.grocery_items.length} grocery item${response.draft.grocery_items.length === 1 ? '' : 's'} added`);
        }
        setCohConversationId(null);
        setCohHistory([]);
      } else if (response.status === 'confirmed' && response.proposed_action.type === 'create_meal_plan') {
        if (!householdId || !currentUserId) {
          addBotMessage('Join a Coho household first so I can save the meal plan for everyone.');
        } else {
          await upsertMealPlans({
            householdId,
            userId: currentUserId,
            meals: response.draft.meals.map((meal) => ({
              date: meal.date,
              mealType: meal.meal_type,
              title: meal.title,
              notes: meal.notes,
            })),
          });
          showNotice(`${response.draft.meals.length} meal${response.draft.meals.length === 1 ? '' : 's'} added to the family week`);
        }
        setCohConversationId(null);
        setCohHistory([]);
      } else if (response.status === 'canceled') {
        setCohConversationId(null);
        setCohHistory([]);
      }
      return;
    } catch (error) {
      const detail = error instanceof Error && error.message
        ? ` (${error.message})`
        : '';
      addBotMessage(`I couldn’t reach the secure Coh service, so I did not create anything. Your request is still here—try again in a moment.${detail}`);
      return;
    } finally {
      setCohThinking(false);
    }
  }

  async function toggleVoiceRequest() {
    if (voiceSending || cohThinking) return;
    if (voiceRecorderState.isRecording) {
      setVoiceSending(true);
      try {
        await voiceRecorder.stop();
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
        if (!voiceRecorder.uri) throw new Error('The voice note could not be saved.');
        const attachment = await attachmentFromUri({
          uri: voiceRecorder.uri,
          name: `coh-voice-${Date.now()}.m4a`,
          mimeType: 'audio/m4a',
        });
        const prompt = '@coh Listen to this voice note and help me finish the household action.';
        setMessages((current) => [...current, {
          id: `voice-${Date.now()}`,
          mine: true,
          author: 'You',
          text: '🎙️ Voice request',
          channel: 'coh',
        }]);
        await handleBotMessage(prompt, [attachment]);
      } catch (nextError) {
        addBotMessage(nextError instanceof Error ? nextError.message : 'I could not read that voice note.');
      } finally {
        setVoiceSending(false);
      }
      return;
    }

    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      showNotice('Microphone permission is needed only when you choose to speak to Coh.');
      return;
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await voiceRecorder.prepareToRecordAsync();
    voiceRecorder.record();
    setChatMode('coh');
    showNotice('Listening… tap the microphone again when you’re done');
  }

  function handleLocalBotMessage(text: string) {
    const normalized = text.trim().toLowerCase();
    if (!botDraft && !normalized.startsWith('@coh') && !normalized.startsWith('hey coh') && !normalized.startsWith('@bot') && !normalized.startsWith('hey bot')) return;

    if (/^(cancel|never mind|nevermind|stop)\b/.test(normalized)) {
      setBotDraft(null);
      addBotMessage('Canceled — I didn’t create anything.');
      return;
    }

    if (!botDraft) {
      const extracted = extractEventIntent(text);
      const next: BotDraft = { ...extracted, person: extracted.person ?? 'You', awaiting: 'title' };
      continueBotDraft(next);
      return;
    }

    if (botDraft.awaiting === 'title') {
      const extracted = extractEventIntent(`@coh ${text}`);
      continueBotDraft({ ...botDraft, ...extracted, title: extracted.title ?? titleCaseWords(text.trim()) });
      return;
    }

    if (botDraft.awaiting === 'day') {
      const date = extractDate(text);
      if (!date) { addBotMessage(`I couldn’t identify the day. Try “tomorrow,” “Wednesday,” or “August 14.”`); return; }
      continueBotDraft({ ...botDraft, ...date });
      return;
    }

    if (botDraft.awaiting === 'time') {
      const time = extractTime(text);
      if (!time) { addBotMessage('What time should I use? For example, “9:15 AM.”'); return; }
      continueBotDraft({ ...botDraft, ...time });
      return;
    }

    if (botDraft.awaiting === 'meridiem') {
      const meridiem = normalized.match(/\b(am|pm)\b/i)?.[1]?.toUpperCase() as 'AM' | 'PM' | undefined;
      if (!meridiem) { addBotMessage(`Is ${botDraft.time} in the morning or evening? Reply AM or PM.`); return; }
      continueBotDraft({ ...botDraft, meridiem });
      return;
    }

    if (botDraft.awaiting === 'place') {
      const place = /^(skip|none|no place|home)\b/.test(normalized) ? undefined : cleanAnswer(text);
      continueBotDraft({ ...botDraft, place, awaiting: place ? 'directions' : 'reminder' });
      return;
    }

    if (botDraft.awaiting === 'directions') {
      if (!isYes(normalized) && !isNo(normalized)) { addBotMessage('Should I include directions? Reply yes or no.'); return; }
      continueBotDraft({ ...botDraft, directions: isYes(normalized), awaiting: 'reminder' });
      return;
    }

    if (botDraft.awaiting === 'reminder') {
      if (!isYes(normalized) && !isNo(normalized) && !parseReminder(normalized)) { addBotMessage('Would you like a reminder? Say “no,” “yes” for 15 minutes, or tell me another number.'); return; }
      continueBotDraft({ ...botDraft, reminder: isNo(normalized) ? undefined : isYes(normalized) ? 15 : parseReminder(normalized), awaiting: 'confirm' });
      return;
    }

    if (botDraft.awaiting === 'confirm') {
      if (isYes(normalized) || /^(add it|create it|save it|done)\b/.test(normalized)) {
        const event: BotEvent = { id: `event-${Date.now()}`, title: botDraft.title!, person: botDraft.person ?? 'You', day: botDraft.day!, dateISO: botDraft.dateISO, time: formatDraftTime(botDraft), place: botDraft.place, reminder: botDraft.reminder, directions: botDraft.directions };
        setBotDraft(null);
        void persistApprovedEvent(event).then((result) => addBotMessage(eventSaveReply(event, result)));
        return;
      }
      if (isNo(normalized)) {
        addBotMessage('Okay — I didn’t create it. Tell me what you’d like changed, or say cancel.');
        return;
      }
      const correction = extractDraftCorrection(text);
      if (Object.keys(correction).length) { continueBotDraft({ ...botDraft, ...correction, awaiting: 'confirm' }); return; }
      addBotMessage('Tell me what to change—such as “make it 10 AM,” “change the place to Brass Barber,” or say “add it.”');
    }
  }

  function continueBotDraft(draft: BotDraft) {
    let next = { ...draft };
    let question = '';
    if (!next.title) { next.awaiting = 'title'; question = 'Absolutely. What should I add?'; }
    else if (!next.day) { next.awaiting = 'day'; question = `What day is ${possessiveEvent(next)}?`; }
    else if (!next.time) { next.awaiting = 'time'; question = `What time is ${possessiveEvent(next)} on ${next.day}?`; }
    else if (!next.meridiem) { next.awaiting = 'meridiem'; question = `Is ${next.time} in the morning or evening? Reply AM or PM.`; }
    else if (next.awaiting === 'directions' && next.place) { question = `Got it — ${next.place}. Would you like me to include directions?`; }
    else if (next.awaiting === 'reminder') { question = 'Would you like a reminder? Say “yes” for 15 minutes, “no,” or choose another time.'; }
    else if (next.awaiting === 'confirm') { question = `${draftSummary(next)} Add it to the family calendar?`; }
    else { next.awaiting = 'place'; question = `I have ${draftSummary(next, false)} Where is it? You can give me the place name or say “skip.”`; }
    setBotDraft(next);
    addBotMessage(question);
    }

  function openCalendarEvent(event: BotEvent) {
    setCalendarFocusDate(event.dateISO ?? null);
    setSelectedEvent(event);
    setTab('Calendar');
    setMoreView('Menu');
  }

  function openLegacyNotification(data: Record<string, unknown>) {
    const screen = data.screen;
    if (screen === 'Recaps') {
      setInitialRecapId(null);
      setMoreView('Recaps');
      setTab('More');
    } else if (screen === 'Family Inbox') {
      setInitialInboxItemId(typeof data.itemId === 'string' ? data.itemId : null);
      setMoreView('Family Inbox');
      setTab('More');
    } else if (screen === 'Chat') {
      setChatMode('family');
      setTab('Chat');
    }
  }

  async function openActionTarget(action: HouseholdAction) {
    if (!action.target_id) {
      if (action.source_kind === 'family_inbox' && action.source_id) {
        setInitialInboxItemId(action.source_id);
        setMoreView('Family Inbox');
        setTab('More');
      } else {
        setChatMode('coh');
        setTab('Chat');
      }
      return;
    }
    if (action.target_table === 'events') {
      const { data } = await supabase.from('events').select('*').eq('id', action.target_id).maybeSingle();
      if (data) openCalendarEvent(cloudEvent(data));
      else { setCalendarFocusDate(action.starts_at?.slice(0, 10) ?? null); setTab('Calendar'); }
      return;
    }
    if (action.target_table === 'chores') {
      if (action.target_id) await openChoreById(action.target_id);
      else setTab('Chores');
      return;
    }
    if (action.target_table === 'notes') {
      setMoreView('Notes');
      setTab('More');
      return;
    }
    if (action.target_table === 'event_follow_ups') {
      setMoreView('Recaps');
      setTab('More');
      return;
    }
    if (action.target_table === 'grocery_items' || action.target_table === 'meal_plans') {
      setMoreView('Meals & Groceries');
      setTab('More');
    }
  }

  async function openChoreById(choreId: string) {
    setTab('Chores');
    const existing = chores.find((chore) => chore.id === choreId);
    if (existing) {
      setEditingChore(existing);
      return;
    }
    const { data } = await supabase
      .from('chores')
      .select('id, title, details, assigned_to, assigned_person_id, due_at, recurrence_rule, reminder_minutes, status, reward_type, reward_value, reward_label, assignee:profiles!chores_assigned_to_fkey(display_name), assigned_person:household_people!chores_assigned_person_id_fkey(id, display_name, linked_user_id)')
      .eq('id', choreId)
      .maybeSingle();
    if (data) setEditingChore(cloudChore(data, chores.length));
  }

  async function openDeepLink(url: string) {
    const calendarConnection = url.match(
      /^(?:coho|homethread):\/\/calendar-connected\/(google|outlook)(?:[/?#]|$)/i,
    );
    if (calendarConnection) {
      const label = calendarConnection[1].toLowerCase() === 'google'
        ? 'Google Calendar'
        : 'Outlook';
      setConnected((current) => ({ ...current, [label]: true }));
      setMoreView('Calendar Sync');
      setTab('More');
      showNotice(`${label} connected. Coho is completing the first sync.`);
      return;
    }
    const match = url.match(/^(?:coho|homethread):\/\/(action|event|chore|follow-up|message|inbox|recap|coh|automations)\/([^/?#]+)/i)
      ?? url.match(/^https:\/\/(?:app\.)?coho\.ai\/(action|event|chore|follow-up|message|inbox|recap|coh|automations)\/([^/?#]+)/i);
    if (!match) return;
    const [, kind, id] = match;
    if (kind.toLowerCase() === 'action') {
      const action = await getHouseholdAction(id).catch(() => null);
      if (action) await openActionTarget(action);
      return;
    }
    if (kind.toLowerCase() === 'event') {
      const { data } = await supabase.from('events').select('*').eq('id', id).maybeSingle();
      if (data) openCalendarEvent(cloudEvent(data));
      return;
    }
    if (kind.toLowerCase() === 'chore') {
      await openChoreById(id);
      return;
    }
    if (kind.toLowerCase() === 'follow-up' || kind.toLowerCase() === 'recap') {
      setInitialRecapId(
        kind.toLowerCase() === 'recap'
          && !['daily', 'week-ahead', 'follow-up', 'latest'].includes(id.toLowerCase())
          ? id
          : null,
      );
      setMoreView('Recaps');
      setTab('More');
      return;
    }
    if (kind.toLowerCase() === 'message') {
      setChatMode('family');
      setTab('Chat');
      return;
    }
    if (kind.toLowerCase() === 'coh') {
      setChatMode('coh');
      setMessageDraft(id === 'meal-plan'
        ? '@coh Help me plan our family meals for the next seven days, then build the grocery list.'
        : '@coh ');
      setTab('Chat');
      return;
    }
    if (kind.toLowerCase() === 'automations') {
      setMoreView('Automations');
      setTab('More');
      return;
    }
    if (kind.toLowerCase() === 'inbox') {
      setInitialInboxItemId(id);
      setMoreView('Family Inbox');
      setTab('More');
    }
  }

  async function markEventForFollowUp(event: BotEvent) {
    if (!householdId || !currentUserId || !event.sourceId) {
      showNotice('Share this event with the household before adding a follow-up.');
      return;
    }
    try {
      await createEventFollowUp({
        householdId,
        eventId: event.sourceId,
        userId: currentUserId,
        dueAt: nextFollowUpDate().toISOString(),
      });
      await reloadSharedData(householdId, currentUserId);
      setSelectedEvent(null);
      showNotice('This appointment will return in the weekly follow-up');
    } catch {
      showNotice('The follow-up could not be saved.');
    }
  }

  async function completeFollowUpItem(followUpId: string) {
    if (!householdId || !currentUserId) return;
    try {
      await completeEventFollowUp(followUpId, currentUserId);
      await reloadSharedData(householdId, currentUserId);
      showNotice('Follow-up completed');
    } catch {
      showNotice('The follow-up could not be completed.');
    }
  }

  async function persistApprovedEvent(event: BotEvent): Promise<'shared' | 'device' | 'failed'> {
    const startsAt = eventStartISO(event);
    if (!startsAt) {
      showNotice('The event time could not be saved. Open it and check the date and time.');
      return 'failed';
    }
    if (!householdId || !currentUserId || !event.dateISO) {
      try {
        await writeApprovedEventToDevice({
          id: event.id,
          title: event.title,
          startsAt,
          location: event.place,
          notes: `Added by Coh for ${event.person}`,
          reminderMinutes: event.reminder,
        });
        setBotEvents((current) => current.some((item) => item.id === event.id) ? current : [...current, event]);
        showNotice('Coh added the event on this iPhone. Connect the household to share it.');
        return 'device';
      } catch {
        showNotice('The event could not be saved. Check calendar access and try again.');
        return 'failed';
      }
    }
    try {
      const created = await createFamilyEvent({
        householdId,
        userId: currentUserId,
        title: event.title,
        startsAt,
        location: event.place,
        details: JSON.stringify({ person: event.person, reminder: event.reminder, directions: event.directions }),
      });
      await writeApprovedEventToDevice({
        id: created.id ?? event.id,
        title: event.title,
        startsAt,
        location: event.place,
        notes: `Added by Coh for ${event.person}`,
        reminderMinutes: event.reminder,
      }).catch(() => undefined);
      const saved = { ...event, id: created.id ?? event.id, sourceId: created.id ?? undefined };
      setBotEvents((current) => current.some((item) => item.id === saved.id) ? current : [...current, saved]);
      showNotice('Coh added the event to the shared family calendar');
      return 'shared';
    } catch {
      try {
        await writeApprovedEventToDevice({
          id: event.id,
          title: event.title,
          startsAt,
          location: event.place,
          notes: `Added by Coh for ${event.person}`,
          reminderMinutes: event.reminder,
        });
        setBotEvents((current) => current.some((item) => item.id === event.id) ? current : [...current, event]);
        showNotice('The event is on this iPhone but could not be shared yet.');
        return 'device';
      } catch {
        showNotice('The event could not be saved. Check calendar access and try again.');
        return 'failed';
      }
    }
  }

  async function toggleChore(choreId: string) {
    const chore = chores.find((item) => item.id === choreId);
    if (!chore) return;
    const done = !chore.done;
    setChores((items) => items.map((item) => item.id === choreId ? { ...item, done } : item));
    if (!householdId) return;
    try {
      await setFamilyChoreCompleted(choreId, done);
    } catch {
      setChores((items) => items.map((item) => item.id === choreId ? { ...item, done: !done } : item));
      showNotice('The chore could not be updated for the family.');
    }
  }

  async function saveChoreSettings(choreId: string, draft: ChoreFormValue) {
    const assignee = profiles.find((profile) => profile.id === draft.assignedPersonId) ?? null;
    if (!householdId) return;
    try {
      await updateFamilyChore(choreId, {
        title: draft.title.trim(),
        details: draft.details.trim() || null,
        assigned_person_id: assignee?.id ?? null,
        assigned_to: assignee?.linkedUserId ?? null,
        due_at: draft.dueAt.toISOString(),
        recurrence_rule: recurrenceRuleFor(draft.recurrence),
        reminder_minutes: draft.reminderMinutes,
        reward_type: databaseRewardType(draft.rewardId),
        reward_value: draft.rewardValue,
        reward_label: draft.rewardId === 'choice'
          ? draft.rewardLabel.trim()
          : choreRewardMeta(draft.rewardId).title,
        updated_at: new Date().toISOString(),
      });
      setEditingChore(null);
      await reloadSharedData(householdId, currentUserId);
      showNotice(`${draft.title.trim()} updated for the family`);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'The chore could not be updated for the family.');
    }
  }

  function deleteChore(chore: Chore) {
    Alert.alert(
      'Delete chore?',
      `“${chore.title}” will be removed for the whole family.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await deleteFamilyChore(chore.id);
                setEditingChore(null);
                if (householdId) await reloadSharedData(householdId, currentUserId);
                showNotice('Chore deleted');
              } catch (error) {
                showNotice(error instanceof Error ? error.message : 'The chore could not be deleted.');
              }
            })();
          },
        },
      ],
    );
  }

  async function speakDailySync(snapshotSummary?: string) {
    const openChores = chores.filter((item) => !item.done);
    const nextEvents = botEvents.slice(-4);
    const eventSummary = nextEvents.length
      ? `You have ${nextEvents.length} upcoming family events. ${nextEvents.map((event) => `${event.title}, ${event.day} at ${event.time}`).join('. ')}.`
      : 'There are no events added by Coh yet.';
    const choreSummary = openChores.length
      ? `${openChores.length} chores are still open. ${openChores.slice(0, 4).map((chore) => `${chore.title}, assigned to ${chore.owner}`).join('. ')}.`
      : 'All current chores are complete.';
    try {
      await setAudioModeAsync({ playsInSilentMode: true });
      await Speech.stop();
      Speech.speak(snapshotSummary || `Here is your Coho daily sync. ${eventSummary} ${choreSummary}`, {
        language: 'en-US',
        rate: 0.92,
        pitch: 1,
        onStart: () => showNotice('Playing your daily sync'),
        onError: () => showNotice('Audio could not be played. Check the iPhone media volume.'),
      });
    } catch {
      showNotice('Audio could not be played. Check the iPhone media volume.');
    }
  }

  async function refreshDailySync() {
    if (!householdId || !currentUserId) {
      showNotice('Reconnect the household to refresh this sync.');
      return;
    }
    try {
      await reloadSharedData(householdId, currentUserId);
      showNotice('Daily sync refreshed with the latest family activity');
    } catch {
      showNotice('The daily sync could not refresh. The last saved version is still available.');
    }
  }

  async function enableNotifications() {
    const permission = await Notifications.requestPermissionsAsync();
    if (permission.granted) {
      await Notifications.scheduleNotificationAsync({
        content: { title: 'Coho is ready', body: 'Family reminders and daily recaps are now enabled.', sound: 'default', data: { screen: 'Recaps', deepLink: 'coho://recap/latest' } },
        trigger: null,
      });
      await scheduleChiefNotifications(chiefPrefs);
      if (currentUserId) {
        await Promise.all([
          syncBriefingPreferences(currentUserId, chiefPrefs),
          registerPushDevice(currentUserId, householdId),
        ]).catch(() => undefined);
      }
      setConnected((current) => ({ ...current, 'iOS Notifications': true }));
      showNotice('iOS notifications enabled');
    } else {
      showNotice('Notification permission was not enabled');
    }
  }

  async function finishSecondUserWelcome(destination: 'family' | 'coh' | 'today' = 'today') {
    if (currentUserId && householdId) {
      await AsyncStorage.setItem(`coho-member-welcome:${currentUserId}:${householdId}`, 'complete');
      await supabase.from('member_onboarding_state').upsert({
        household_id: householdId,
        user_id: currentUserId,
        tour_completed: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'household_id,user_id' });
    }
    setSecondUserWelcomeOpen(false);
    if (destination === 'family') {
      setChatMode('family');
      setTab('Chat');
    } else if (destination === 'coh') {
      setChatMode('coh');
      setTab('Chat');
    } else {
      setTab('Today');
    }
  }

  async function saveChiefPreferences(next: ChiefPrefs) {
    setChiefPrefs(next);
    await AsyncStorage.setItem('kincue-chief-prefs', JSON.stringify(next));
    if (currentUserId) {
      await syncBriefingPreferences(currentUserId, next).catch(() => undefined);
    }
  }

  async function saveFamilyProfile(profile: FamilyProfile) {
    if (!householdId || !currentUserId) {
      showNotice('Reconnect the household before saving this profile.');
      return;
    }
    if (profile.dob && !/^\d{4}-\d{2}-\d{2}$/.test(profile.dob)) {
      showNotice('Use YYYY-MM-DD for the date of birth.');
      return;
    }
    try {
      const existing = profiles.some((item) => item.id === profile.id);
      const personId = await saveHouseholdPerson({
        id: existing ? profile.id : undefined,
        householdId,
        userId: currentUserId,
        displayName: profile.name,
        dateOfBirth: profile.dob || null,
        bio: profile.bio,
        role: profile.role,
      });
      if (profile.linkedUserId === currentUserId) {
        await Promise.all([
          supabase.from('profiles').update({
            display_name: profile.name.trim(),
            date_of_birth: profile.dob || null,
            bio: profile.bio.trim() || null,
            updated_at: new Date().toISOString(),
          }).eq('id', currentUserId),
          supabase.from('member_onboarding_state').upsert({
            household_id: householdId,
            user_id: currentUserId,
            profile_completed: true,
            last_active_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }, { onConflict: 'household_id,user_id' }),
        ]);
      }
      if (profile.avatarBase64) {
        const avatarPath = await uploadHouseholdPersonAvatar({
          householdId,
          personId,
          base64: profile.avatarBase64,
          mimeType: profile.avatarMime,
        });
        if (profile.linkedUserId === currentUserId) {
          await supabase.from('profiles').update({
            avatar_url: avatarPath,
            updated_at: new Date().toISOString(),
          }).eq('id', currentUserId);
        }
      }
      await reloadSharedData(householdId, currentUserId);
      setEditingProfile(null);
      showNotice(`${profile.name}’s profile was saved for the household`);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'The family profile could not be saved.');
    }
  }

  async function activateChiefOfHome() {
    await saveChiefPreferences(chiefPrefs);
    if (chiefPrefs.push) {
      const permission = await Notifications.requestPermissionsAsync();
      if (!permission.granted) {
        showNotice(chiefPrefs.email
          ? 'Email briefings are saved. Enable notifications in iOS Settings for push too.'
          : 'Enable notifications in iOS Settings to receive briefings');
        return;
      }
      await scheduleChiefNotifications(chiefPrefs);
      if (currentUserId) {
        await registerPushDevice(currentUserId, householdId).catch(() => undefined);
      }
      setConnected((current) => ({ ...current, 'iOS Notifications': true }));
    } else {
      await scheduleChiefNotifications({ ...chiefPrefs, push: false });
    }
    showNotice(chiefPrefs.email && chiefPrefs.push
      ? 'Push and email briefings are scheduled'
      : chiefPrefs.email
        ? 'Email briefings are scheduled'
        : chiefPrefs.push
          ? 'Push briefings are scheduled'
          : 'Briefings are off until you choose push or email');
  }

  async function scheduleChiefNotifications(prefs: ChiefPrefs) {
    const oldIds = JSON.parse(await AsyncStorage.getItem('kincue-chief-notification-ids') || '[]');
    await Promise.all(oldIds.map((id: string) => Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined)));
    const ids: string[] = [];
    if (prefs.daily && prefs.push) {
      const { hour, minute } = parseClock(prefs.dailyTime);
      ids.push(await Notifications.scheduleNotificationAsync({ content: { title: 'Your Chief of Home briefing', body: 'Appointments, chores, follow-ups, and what your family needs today.', sound: 'default', data: { screen: 'Recaps', deepLink: 'coho://recap/daily' } }, trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute } }));
    }
    if (prefs.weekAhead && prefs.push) {
      const { hour, minute } = parseClock(prefs.weekAheadTime);
      ids.push(await Notifications.scheduleNotificationAsync({ content: { title: 'Your full week ahead', body: 'Open Coho for the family schedule, preparation list, and conflicts.', sound: 'default', data: { screen: 'Recaps', deepLink: 'coho://recap/week-ahead' } }, trigger: { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: weekdayNumber(prefs.weekAheadDay), hour, minute } }));
    }
    if (prefs.followUp && prefs.push) {
      const { hour, minute } = parseClock(prefs.followUpTime);
      ids.push(await Notifications.scheduleNotificationAsync({ content: { title: 'Weekly follow-up', body: 'A few appointments and conversations may still need action.', sound: 'default', data: { screen: 'Recaps', deepLink: 'coho://recap/follow-up' } }, trigger: { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: weekdayNumber(prefs.followUpDay), hour, minute } }));
    }
    await AsyncStorage.setItem('kincue-chief-notification-ids', JSON.stringify(ids));
  }

  const title = tab === 'More' && moreView !== 'Menu' ? moreView : tab;
  const openRecaps = () => { setInitialRecapId(null); setMoreView('Recaps'); setTab('More'); };
  const openCohPrompt = (prompt: string) => {
    setChatMode('coh');
    setMessageDraft(prompt);
    setMoreView('Menu');
    setTab('Chat');
    showNotice('Review the request, then send it to Coh');
  };
  const openHouseholdOS = (view: MoreView) => {
    setMoreView(view);
    setTab('More');
  };
  const handleIntegration = (name: string) => {
    if (name === 'iOS Notifications') return void enableNotifications();
    if (name === 'Family Inbox') return openHouseholdOS('Family Inbox');
    if (name === 'Family Places') return openHouseholdOS('Family Places');
    if (['Apple Calendar', 'Google Calendar', 'Outlook'].includes(name)) return openHouseholdOS('Calendar Sync');
    if (name === 'Instacart') return openHouseholdOS('Meals & Groceries');
    if (name === 'OpenTable') return openHouseholdOS('Trips');
    showNotice(`${name} setup requires provider authorization. Coho will never mark it connected before that succeeds.`);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <KeyboardAvoidingView
        style={styles.app}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <Header
          title={title}
          theme={theme}
          styles={styles}
          dark={dark}
          householdName={householdName}
          onTheme={toggleTheme}
          onRecap={openRecaps}
          onAdd={() => setQuickAddOpen(true)}
          onBack={tab === 'More' && moreView !== 'Menu' ? () => setMoreView('Menu') : undefined}
        />

        <View style={styles.screen}>
          {tab === 'Today' && <TodayScreen styles={styles} events={botEvents} chores={chores} onCalendar={() => setTab('Calendar')} onRecap={openRecaps} onOpenEvent={openCalendarEvent} onChores={() => setTab('Chores')} />}
          {tab === 'Calendar' && <CalendarScreen theme={theme} styles={styles} botEvents={botEvents} focusDate={calendarFocusDate} onOpenEvent={setSelectedEvent} onAction={showNotice} onManage={() => { setMoreView('Integrations'); setTab('More'); }} />}
          {tab === 'Chores' && <ChoresScreen styles={styles} chores={chores} memberNames={profiles.map((profile) => profile.name)} rewardMember={rewardMember} setRewardMember={setRewardMember} selectedRewards={selectedRewards} onConfigure={setEditingChore} onAdd={() => { setQuickAddType('Chore'); setQuickAddOpen(true); }} onSelectReward={(member: string, reward: string) => { const next = { ...selectedRewards, [member]: reward }; setSelectedRewards(next); AsyncStorage.setItem('coho-reward-goals', JSON.stringify(next)); showNotice(`${member} picked a new reward goal`); }} onToggle={toggleChore} />}
          {tab === 'Chat' && <ChatScreen styles={styles} messages={messages} mode={chatMode} setMode={setChatMode} draft={messageDraft} setDraft={setMessageDraft} onSend={sendMessage} onAdd={() => setQuickAddOpen(true)} onVoice={toggleVoiceRequest} voiceRecording={voiceRecorderState.isRecording} voiceSending={voiceSending} cohThinking={cohThinking} />}
          {tab === 'More' && moreView === 'Menu' && <MoreMenu styles={styles} setView={setMoreView} />}
          {tab === 'More' && moreView === 'Chief of Home' && <ChiefOfHomeScreen styles={styles} prefs={chiefPrefs} memberNames={profiles.map((profile) => profile.name)} setPrefs={saveChiefPreferences} onActivate={activateChiefOfHome} />}
          {tab === 'More' && moreView === 'Family' && <FamilyProfilesScreen styles={styles} profiles={profiles} onInvite={() => setFamilyHubOpen(true)} onEdit={setEditingProfile} onAdd={() => setEditingProfile({ id: `new-${Date.now()}`, name: '', dob: '', bio: '', role: 'Family member', color: '#DCE7FF', ink: '#2257F4' })} />}
          {tab === 'More' && moreView === 'Notes' && <NotesScreen styles={styles} householdId={householdId} userId={currentUserId} onAction={showNotice} />}
          {tab === 'More' && moreView === 'Recaps' && <RecapsScreen styles={styles} onRefresh={refreshDailySync} onListen={speakDailySync} onOpenEvent={openCalendarEvent} onCompleteFollowUp={completeFollowUpItem} events={botEvents} chores={chores} messages={messages} followUps={followUps} snapshots={briefingSnapshots} initialSnapshotId={initialRecapId} />}
          {tab === 'More' && moreView === 'Automations' && <AutomationRulesScreen dark={dark} householdId={householdId} userId={currentUserId} onNotice={showNotice} />}
          {tab === 'More' && moreView === 'Integrations' && <IntegrationsScreen styles={styles} connected={connected} onConnect={handleIntegration} />}
          {tab === 'More' && moreView === 'Calendar Sync' && <CalendarConnectionScreen dark={dark} householdId={householdId} userId={currentUserId} onNotice={showNotice} onConnected={(source) => setConnected((current) => ({
            ...current,
            [source === 'google' ? 'Google Calendar' : source === 'outlook' ? 'Outlook' : 'Apple Calendar']: true,
          }))} />}
          {tab === 'More' && moreView === 'Family Inbox' && <FamilyInboxScreen dark={dark} householdId={householdId} householdName={householdName} userId={currentUserId} onNotice={showNotice} onAskCoh={openCohPrompt} onOpenAction={openActionTarget} initialItemId={initialInboxItemId} />}
          {tab === 'More' && moreView === 'Family Places' && <FamilyPlacesScreen dark={dark} householdId={householdId} userId={currentUserId} onNotice={showNotice} />}
          {tab === 'More' && moreView === 'Meals & Groceries' && <FoodHubScreen dark={dark} householdId={householdId} userId={currentUserId} onNotice={showNotice} onAskCoh={openCohPrompt} />}
          {tab === 'More' && moreView === 'Trips' && <TravelHubScreen dark={dark} householdId={householdId} userId={currentUserId} onNotice={showNotice} onAskCoh={openCohPrompt} />}
          {tab === 'More' && moreView === 'Privacy' && <PrivacyDataScreen dark={dark} householdId={householdId} onNotice={showNotice} />}
          {tab === 'More' && moreView === 'Settings' && <SettingsScreen styles={styles} dark={dark} onTheme={toggleTheme} onNotifications={enableNotifications} onFamily={() => setMoreView('Family')} onPrivacy={() => setMoreView('Privacy')} profiles={profiles} />}
        </View>

        <BottomTabs tab={tab} setTab={(next: Tab) => { setTab(next); if (next !== 'More') setMoreView('Menu'); }} theme={theme} styles={styles} />

        {notice && <View style={styles.toast}><Ionicons name="checkmark-circle" size={18} color="#19A47B" /><Text style={styles.toastText}>{notice}</Text></View>}
      </KeyboardAvoidingView>

      <QuickAddModal
        visible={quickAddOpen}
        onClose={() => {
          setQuickAddOpen(false);
          setQuickAddTitle('');
          setQuickAddDetails('');
        }}
        styles={styles}
        type={quickAddType}
        setType={setQuickAddType}
        title={quickAddTitle}
        setTitle={setQuickAddTitle}
        details={quickAddDetails}
        setDetails={setQuickAddDetails}
        profiles={profiles}
        currentUserId={currentUserId}
        saving={quickAddSaving}
        onSave={saveQuickAdd}
        dark={dark}
      />
      <ShareToCohModal
        visible={sharePreviewOpen}
        styles={styles}
        dark={dark}
        value={sharedDraft}
        onChange={setSharedDraft}
        hasImage={Boolean((shareIntent as any)?.files?.length)}
        error={shareError}
        onCancel={cancelSharedItem}
        onApprove={sendSharedItemToCoh}
      />
      <ProfileEditorModal visible={Boolean(editingProfile)} profile={editingProfile} styles={styles} dark={dark} onClose={() => setEditingProfile(null)} onSave={saveFamilyProfile} />
      <Modal visible={familyHubOpen} animationType="slide" onRequestClose={() => setFamilyHubOpen(false)}><SafeAreaView style={styles.safeArea}><View style={styles.fullModalHeader}><View><Text style={styles.eyebrow}>HOUSEHOLD ACCESS</Text><Text style={styles.modalTitle}>Invite your family</Text></View><Pressable onPress={() => setFamilyHubOpen(false)} style={styles.iconButton}><Ionicons name="close" size={21} color={styles.iconColor.color} /></Pressable></View><FamilyHub /></SafeAreaView></Modal>
      <EventDetailModal event={selectedEvent} styles={styles} dark={dark} onClose={() => setSelectedEvent(null)} onFollowUp={markEventForFollowUp} />
      <ChoreEditorModal chore={editingChore} profiles={profiles} styles={styles} dark={dark} onClose={() => setEditingChore(null)} onSave={saveChoreSettings} onDelete={deleteChore} />
      <SecondUserWelcomeModal
        visible={secondUserWelcomeOpen}
        householdName={householdName}
        styles={styles}
        dark={dark}
        notificationsEnabled={connected['iOS Notifications'] === true}
        onEnableNotifications={enableNotifications}
        onContinue={finishSecondUserWelcome}
      />
    </SafeAreaView>
  );
}

function Header({ title, styles, dark, householdName, onTheme, onRecap, onAdd, onBack }: any) {
  const now = new Date();
  const dateLabel = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase();
  const greeting = now.getHours() < 12 ? 'Good morning,' : now.getHours() < 18 ? 'Good afternoon,' : 'Good evening,';
  return <View style={styles.header}>
    <View style={styles.headerTitleWrap}>
      {onBack && <Pressable onPress={onBack} style={styles.backButton}><Ionicons name="chevron-back" size={22} color={styles.iconColor.color} /></Pressable>}
      <View><Text style={styles.eyebrow}>{dateLabel}</Text><Text style={styles.headerTitle}>{title === 'Today' ? greeting : title}</Text>{title === 'Today' && <Text style={styles.headerTitle}>{householdName} {now.getHours() < 18 ? '☀️' : '🌙'}</Text>}</View>
    </View>
    <View style={styles.headerButtons}>
      <Pressable accessibilityLabel="Open daily recap" onPress={onRecap} style={styles.recapHeaderButton}><Ionicons name="sparkles" size={19} color="#fff" /></Pressable>
      <Pressable accessibilityLabel={dark ? 'Use light mode' : 'Use dark mode'} onPress={onTheme} style={styles.iconButton}><Ionicons name={dark ? 'sunny-outline' : 'moon-outline'} size={20} color={styles.iconColor.color} /></Pressable>
      <Pressable accessibilityLabel="Add to family" onPress={onAdd} style={styles.addButton}><Ionicons name="add" size={25} color="#fff" /></Pressable>
    </View>
  </View>;
}

function TodayScreen({ styles, events, chores, onCalendar, onRecap, onOpenEvent, onChores }: any) {
  const today = localDateKey(new Date());
  const todaysEvents = events.filter((event: BotEvent) => event.dateISO === today);
  const openChores = chores.filter((chore: Chore) => !chore.done);
  const cards = [
    ...todaysEvents.map((event: BotEvent) => ({ kind: 'event', item: event, title: event.title, value: event.time, detail: `${event.person}${event.place ? ` · ${event.place}` : ''}`, icon: 'calendar-outline', color: '#2257F4', tint: '#DCE7FF' })),
    ...openChores.map((chore: Chore) => ({ kind: 'chore', item: chore, title: chore.title, value: chore.due, detail: `${chore.owner} · ${formatChoreReward(chore)}`, icon: 'checkmark-done-outline', color: '#19A47B', tint: '#D9F7ED' })),
  ].slice(0, 4);
  const upcomingEvents = events.filter((event: BotEvent) => !event.dateISO || event.dateISO >= today).slice(0, 5);
  return <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
    <View style={styles.sectionHead}><View><Text style={styles.sectionTitle}>Today</Text><Text style={styles.muted}>{todaysEvents.length} event{todaysEvents.length === 1 ? '' : 's'} · {openChores.length} open chore{openChores.length === 1 ? '' : 's'}</Text></View><Pressable onPress={onCalendar}><Text style={styles.link}>See full day ›</Text></Pressable></View>
    {cards.length === 0 ? <View style={styles.emptyChat}><Ionicons name="sparkles-outline" size={28} color="#7047EE" /><Text style={styles.settingTitle}>Your family radar is clear</Text><Text style={styles.muted}>Ask Coh to add an event or create the first shared chore.</Text></View> : <View style={styles.bentoGrid}>{cards.map((card: any) => <Pressable key={`${card.kind}-${card.item.id}`} onPress={() => card.kind === 'event' ? onOpenEvent(card.item) : onChores()} style={styles.bentoCard}>
      <View style={[styles.cardIcon, { backgroundColor: card.tint }]}><Ionicons name={card.icon as any} size={24} color={card.color} /></View>
      <Text style={styles.cardTitle}>{card.title}</Text><Text style={styles.cardValue}>{card.value}</Text><Text style={styles.cardDetail}>{card.detail}</Text>
      <View style={[styles.cardPill, { backgroundColor: `${card.color}12` }]}><Ionicons name="time-outline" size={13} color={card.color} /><Text style={[styles.cardPillText, { color: card.color }]}>Tap for details</Text></View>
    </Pressable>)}</View>}
    <Pressable onPress={onRecap}><LinearGradient colors={['#2257F4', '#7047EE']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.recapCard}>
      <View style={styles.recapIcon}><Ionicons name="sparkles" size={21} color="#fff" /></View><View style={styles.recapCopy}><Text style={styles.recapLabel}>COHO DAILY</Text><Text style={styles.recapTitle}>Your live family sync</Text><Text style={styles.recapText}>{events.length} shared event{events.length === 1 ? '' : 's'} and {openChores.length} open chore{openChores.length === 1 ? '' : 's'}.</Text></View><Ionicons name="chevron-forward" size={20} color="#fff" />
    </LinearGradient></Pressable>
    <Text style={styles.sectionTitle}>Coming up</Text>{upcomingEvents.length === 0 ? <Text style={styles.muted}>No upcoming events yet.</Text> : upcomingEvents.map((event: BotEvent) => <Pressable key={event.id} onPress={() => onOpenEvent(event)} style={styles.upcomingRow}><View style={[styles.dateTile, { borderColor: '#2257F4' }]}><Text style={[styles.dateMonth, { color: '#2257F4' }]}>{event.dateISO ? new Date(`${event.dateISO}T12:00:00`).toLocaleDateString(undefined, { month: 'short' }).toUpperCase() : 'NEXT'}</Text><Text style={[styles.dateNumber, { color: '#2257F4' }]}>{event.dateISO ? Number(event.dateISO.slice(-2)) : '•'}</Text></View><View style={styles.flex}><Text style={styles.upcomingTime}>{event.time}{event.provider && event.provider !== 'coho' ? ` · ${calendarSourceLabel(event.provider)}` : ''}</Text><Text style={styles.upcomingTitle}>{event.title}</Text></View><Ionicons name="chevron-forward" size={18} color="#2257F4" /></Pressable>)}
  </ScrollView>;
}

function CalendarScreen({ styles, botEvents, focusDate, onOpenEvent, onAction, onManage }: any) {
  const [selected, setSelected] = useState(startOfDay(new Date()));
  useEffect(() => {
    if (!focusDate) return;
    const date = new Date(`${focusDate}T12:00:00`);
    if (!Number.isNaN(date.getTime())) setSelected(startOfDay(date));
  }, [focusDate]);
  const weekStart = startOfWeek(selected);
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const visibleBotEvents = botEvents.filter((event: BotEvent) => !event.dateISO || event.dateISO === localDateKey(selected));
  const period = `${days[0].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}–${days[6].toLocaleDateString(undefined, { month: days[0].getMonth() === days[6].getMonth() ? undefined : 'short', day: 'numeric' })}`;
  return <ScrollView contentContainerStyle={styles.scrollContent}><View style={styles.calendarTop}><Pressable onPress={() => setSelected(addDays(selected, -7))} style={styles.smallButton}><Ionicons name="chevron-back" size={18} color={styles.iconColor.color} /></Pressable><Pressable onPress={() => setSelected(startOfDay(new Date()))}><Text style={styles.calendarPeriod}>{period}</Text><Text style={styles.calendarTodayLink}>Tap for today</Text></Pressable><Pressable onPress={() => setSelected(addDays(selected, 7))} style={styles.smallButton}><Ionicons name="chevron-forward" size={18} color={styles.iconColor.color} /></Pressable></View><View style={styles.weekRow}>{days.map((day) => { const active = sameDay(day, selected); return <Pressable key={day.toISOString()} onPress={() => setSelected(day)} style={[styles.dayBubble, active && styles.dayBubbleActive]}><Text style={[styles.dayLabel, active && styles.dayTextActive]}>{day.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase()}</Text><Text style={[styles.dayNumber, active && styles.dayTextActive]}>{day.getDate()}</Text></Pressable>; })}</View><Text style={styles.sectionTitle}>{selected.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</Text>{visibleBotEvents.length === 0 && <View style={styles.emptyChat}><Ionicons name="calendar-clear-outline" size={28} color="#2257F4" /><Text style={styles.settingTitle}>Nothing scheduled</Text><Text style={styles.muted}>Ask Coh to add something or choose another day.</Text></View>}{visibleBotEvents.map((event: BotEvent) => <Pressable key={event.id} onPress={() => onOpenEvent(event)} style={styles.timelineRow}><View style={[styles.timelineLine, { backgroundColor: calendarSourceColor(event.provider) }]} /><Text style={styles.timelineTime}>{event.time}</Text><View style={styles.flex}><View style={styles.eventSourceTitleRow}><Text style={styles.timelineTitle}>{event.title}</Text>{event.provider && event.provider !== 'coho' && <View style={[styles.eventSourcePill, { backgroundColor: `${calendarSourceColor(event.provider)}18` }]}><Text style={[styles.eventSourceText, { color: calendarSourceColor(event.provider) }]}>{calendarSourceLabel(event.provider)}</Text></View>}</View><Text style={styles.muted}>{event.person} · {event.place ?? event.day}{event.reminder ? ` · ${event.reminder} min reminder` : ''}{event.recurrenceRule ? ' · Repeats' : ''}</Text></View><Ionicons name="chevron-forward" size={18} color="#7047EE" /></Pressable>)}<Pressable onPress={onManage} style={styles.syncCard}><Ionicons name="sync" size={18} color="#2257F4" /><View style={styles.flex}><Text style={styles.syncTitle}>Calendar connections</Text><Text style={styles.muted}>Connect only the calendars your household chooses</Text></View><Text style={styles.link}>Manage</Text></Pressable></ScrollView>;
}

function ChoresScreen({ styles, chores, memberNames, onToggle, onConfigure, rewardMember, setRewardMember, selectedRewards, onSelectReward, onAdd }: any) {
  const weekStart = startOfWeek(new Date());
  const weekEnd = addDays(weekStart, 7);
  const visibleChores = chores.filter((item: Chore) => {
    if (!item.dueAt) return true;
    const dueAt = new Date(item.dueAt);
    if (Number.isNaN(dueAt.getTime())) return true;
    return item.done
      ? dueAt >= weekStart && dueAt < weekEnd
      : dueAt < weekEnd;
  });
  const completed = visibleChores.filter((item: Chore) => item.done).length;
  const balances = memberNames.reduce((result: Record<string, number>, name: string) => ({ ...result, [name]: chores.filter((item: Chore) => item.owner === name && item.done && item.rewardId === 'points').reduce((sum: number, item: Chore) => sum + item.rewardValue, 0) }), {} as Record<string, number>);
  const selected = rewardGoals.find((reward) => reward.id === selectedRewards[rewardMember]) ?? rewardGoals[0];
  const balance = balances[rewardMember] ?? 0;
  const progress = Math.min(100, Math.round(balance / selected.cost * 100));
  return <ScrollView contentContainerStyle={styles.scrollContent}>
    <View style={styles.progressCard}><View><Text style={styles.progressLabel}>FAMILY PROGRESS</Text><Text style={styles.progressValue}>{completed} of {visibleChores.length}</Text><Text style={styles.muted}>due or completed this week</Text></View><View style={styles.progressRing}><Text style={styles.progressPercent}>{visibleChores.length ? Math.round(completed / visibleChores.length * 100) : 0}%</Text></View></View>
    <Text style={styles.sectionTitle}>Earn rewards</Text>
    {memberNames.length === 0 ? <View style={styles.emptyChat}><Ionicons name="people-outline" size={28} color="#7047EE" /><Text style={styles.settingTitle}>Add a family profile first</Text><Text style={styles.muted}>Rewards are personalized to real people in this household.</Text></View> : <>
      <View style={styles.memberRewardTabs}>{memberNames.map((name: string) => <Pressable key={name} onPress={() => setRewardMember(name)} style={[styles.memberRewardTab, rewardMember === name && styles.memberRewardTabActive]}><Text style={[styles.memberRewardName, rewardMember === name && styles.memberRewardNameActive]}>{name}</Text><Text style={[styles.memberRewardPoints, rewardMember === name && styles.memberRewardNameActive]}>{balances[name] ?? 0} pts</Text></Pressable>)}</View>
      <View style={styles.rewardHero}><View style={[styles.rewardIcon, { backgroundColor: `${selected.color}20` }]}><Ionicons name={selected.icon as any} size={25} color={selected.color} /></View><View style={styles.flex}><Text style={styles.progressLabel}>{rewardMember.toUpperCase()} IS EARNING TOWARD</Text><Text style={styles.rewardHeroTitle}>{selected.title} · {selected.detail}</Text><View style={styles.rewardProgressTrack}><View style={[styles.rewardProgressFill, { width: `${progress}%`, backgroundColor: selected.color }]} /></View><Text style={styles.rewardProgressText}>{balance} of {selected.cost} points · {Math.max(0, selected.cost - balance)} to go</Text></View></View>
      <Text style={styles.rewardPrompt}>What does {rewardMember} want to earn?</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rewardChoices}>{rewardGoals.map((reward) => { const active = selected.id === reward.id; return <Pressable key={reward.id} onPress={() => onSelectReward(rewardMember, reward.id)} style={[styles.rewardChoice, active && { borderColor: reward.color, backgroundColor: `${reward.color}12` }]}><Ionicons name={reward.icon as any} size={21} color={reward.color} /><Text style={styles.rewardChoiceTitle}>{reward.title}</Text><Text style={styles.muted}>{reward.detail}</Text><Text style={[styles.rewardCost, { color: reward.color }]}>{reward.cost} points</Text>{active && <Ionicons name="checkmark-circle" size={18} color={reward.color} style={styles.rewardSelected} />}</Pressable>; })}</ScrollView>
    </>}
    <Text style={styles.sectionTitle}>This week</Text>{visibleChores.length === 0 && <View style={styles.emptyChat}><Ionicons name="checkbox-outline" size={28} color="#19A47B" /><Text style={styles.settingTitle}>No chores due this week</Text><Text style={styles.muted}>Add one, assign it, schedule it, and choose exactly what completing it earns.</Text></View>}{visibleChores.map((chore: Chore) => { const reward = choreRewardMeta(chore.rewardId); return <Pressable key={chore.id} onPress={() => onConfigure(chore)} style={styles.choreRow}><Pressable accessibilityLabel={chore.done ? `Mark ${chore.title} incomplete` : `Complete ${chore.title}`} onPress={() => onToggle(chore.id)} style={[styles.checkCircle, chore.done && { backgroundColor: '#19A47B', borderColor: '#19A47B' }]}>{chore.done && <Ionicons name="checkmark" size={17} color="#fff" />}</Pressable><View style={styles.flex}><Text style={[styles.choreTitle, chore.done && styles.struck]}>{chore.title}</Text><Text style={styles.muted}>{chore.owner} · {chore.due}</Text><Text style={styles.choreScheduleText}>{recurrenceLabel(chore.recurrence)}{chore.reminderMinutes != null ? ` · Remind ${chore.reminderMinutes === 0 ? 'at due time' : `${chore.reminderMinutes} min before`}` : ''}</Text><Text style={[styles.choreRewardText, { color: reward.color }]}>{formatChoreReward(chore)}</Text></View><View style={[styles.pointPill, { backgroundColor: `${reward.color}14` }]}><Ionicons name={reward.icon as any} size={12} color={reward.color} /><Text style={[styles.pointPillText, { color: reward.color }]}>Edit</Text></View><View style={[styles.ownerDot, { backgroundColor: chore.color }]} /></Pressable>; })}<Pressable onPress={onAdd} style={styles.outlineAction}><Ionicons name="add" size={19} color="#2257F4" /><Text style={styles.outlineActionText}>Add a chore</Text></Pressable>
  </ScrollView>;
}

function ChatScreen({ styles, messages, mode, setMode, draft, setDraft, onSend, onAdd, onVoice, voiceRecording, voiceSending, cohThinking }: any) {
  const cohActive = mode === 'coh';
  const visibleMessages = messages.filter((message: ChatMessage) => messageChannel(message) === mode);
  return <View style={styles.flex}><View style={styles.chatModeTabs}><Pressable onPress={() => setMode('family')} style={[styles.chatModeTab, mode === 'family' && styles.chatModeTabActive]}><Ionicons name="people" size={16} color={mode === 'family' ? '#fff' : styles.iconColor.color} /><Text style={[styles.chatModeText, mode === 'family' && styles.chatModeTextActive]}>Family chat</Text></Pressable><Pressable onPress={() => setMode('coh')} style={[styles.chatModeTab, mode === 'coh' && styles.chatModeCohActive]}><Ionicons name="sparkles" size={16} color={mode === 'coh' ? '#fff' : '#7047EE'} /><Text style={[styles.chatModeText, mode === 'coh' && styles.chatModeTextActive]}>Ask Coh</Text></Pressable></View><FlatList data={visibleMessages} keyExtractor={(item) => item.id} contentContainerStyle={styles.messageList} automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled" renderItem={({ item }) => <View style={[styles.messageWrap, item.mine && styles.messageMine]}>{!item.mine && <View style={[styles.avatar, item.bot ? styles.botAvatar : styles.chatAvatar]}>{item.bot ? <Ionicons name="sparkles" size={17} color="#fff" /> : <Text style={styles.avatarText}>{initials(item.author)}</Text>}</View>}<View style={styles.messageBody}><Text style={[styles.messageAuthor, item.mine && styles.messageAuthorMine, item.bot && styles.botAuthor]}>{item.author}</Text><View style={[styles.messageBubble, item.mine && styles.messageBubbleMine, item.bot && styles.botBubble]}><MentionText text={item.text} mine={item.mine} styles={styles} /></View></View></View>} ListHeaderComponent={cohActive ? <View style={styles.botHint}><Ionicons name="sparkles" size={15} color="#7047EE" /><Text style={styles.botHintText}>Private Coh workspace · type, speak, or share screenshots and PDFs into Coho.</Text></View> : <View style={styles.chatHeader}><View style={styles.homeThreadIcon}><Ionicons name="home" size={20} color="#F5A623" /></View><View><Text style={styles.chatTitle}>Everyone</Text><Text style={styles.muted}>Family messages only</Text></View></View>} ListEmptyComponent={<View style={styles.emptyChat}><Ionicons name={cohActive ? 'sparkles-outline' : 'chatbubbles-outline'} size={28} color={cohActive ? '#7047EE' : styles.iconColor.color} /><Text style={styles.settingTitle}>{cohActive ? 'Ask Coh to organize something' : 'Start the family conversation'}</Text></View>} ListFooterComponent={cohActive && (cohThinking || voiceRecording || voiceSending) ? <View style={styles.cohThinking}><Ionicons name={voiceRecording ? 'mic' : 'sparkles'} size={15} color={voiceRecording ? '#E94F64' : '#7047EE'} /><Text style={styles.botAuthor}>{voiceRecording ? 'Listening… tap the red microphone to send' : voiceSending ? 'Coh is transcribing…' : 'Coh is thinking…'}</Text></View> : null} /><View style={[styles.composeRow, cohActive && styles.composeRowCoh]}><Pressable accessibilityLabel={cohActive ? (voiceRecording ? 'Stop and send voice request' : 'Speak to Coh') : 'Add'} onPress={cohActive ? onVoice : onAdd} style={[styles.composePlus, cohActive && styles.composeCohBadge, voiceRecording && { backgroundColor: '#E94F64' }]}>{cohActive ? <Ionicons name={voiceRecording ? 'stop' : 'mic'} size={18} color="#fff" /> : <Ionicons name="add" size={22} color="#2257F4" />}</Pressable><TextInput value={draft} onChangeText={setDraft} placeholder={voiceRecording ? 'Listening…' : cohThinking ? 'Coh is thinking…' : cohActive ? 'Ask Coh anything about home…' : 'Message your family…'} placeholderTextColor="#8B93A5" editable={!cohThinking && !voiceRecording} style={[styles.composeInput, cohActive && styles.composeInputCoh]} returnKeyType="send" onSubmitEditing={onSend} /><Pressable disabled={cohThinking || voiceRecording} onPress={onSend} style={[styles.sendButton, cohActive && styles.sendButtonCoh, (cohThinking || voiceRecording) && { opacity: .55 }]}><Ionicons name={cohActive ? 'sparkles' : 'send'} size={17} color="#fff" /></Pressable></View></View>;
}

function messageChannel(message: ChatMessage): ChatChannel {
  if (message.channel) return message.channel;
  return message.bot || /(@coh|hey coh)\b/i.test(message.text) ? 'coh' : 'family';
}

function eventSaveReply(event: BotEvent, result: 'shared' | 'device' | 'failed') {
  if (result === 'failed') {
    return `I couldn’t save “${event.title}.” Check calendar access or your connection, then ask me to try again.`;
  }
  const destination = result === 'shared'
    ? 'the shared family calendar'
    : 'this iPhone’s calendar';
  return `Done — “${event.title}” is on ${destination} for ${event.day} at ${event.time}.${event.reminder ? ` The reminder is ${event.reminder} minutes before.` : ''}${event.directions && event.place ? ` Directions to ${event.place} are included.` : ''}`;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : parts[0]?.slice(0, 2) || 'FM').toUpperCase();
}

function MentionText({ text, mine, styles }: { text: string; mine: boolean; styles: any }) {
  const match = text.match(/(@coh|hey coh)\b/i);
  if (!match || match.index === undefined) return <Text style={[styles.messageText, mine && styles.messageTextMine]}>{text}</Text>;
  const start = match.index;
  const end = start + match[0].length;
  return <Text style={[styles.messageText, mine && styles.messageTextMine]}>{text.slice(0, start)}<Text style={styles.cohMention}>✦ {match[0]}</Text>{text.slice(end)}</Text>;
}

function relatedName(value: any, fallback: string) {
  const profile = Array.isArray(value) ? value[0] : value;
  return profile?.display_name || fallback;
}

function calendarSourceLabel(provider?: string) {
  if (provider === 'google') return 'Google';
  if (provider === 'outlook') return 'Outlook';
  if (provider === 'apple') return 'Apple';
  return 'Coho';
}

function calendarSourceColor(provider?: string) {
  if (provider === 'google') return '#4285F4';
  if (provider === 'outlook') return '#0078D4';
  if (provider === 'apple') return '#5A667A';
  return '#7047EE';
}

function cloudMessage(row: any, currentUserId: string): ChatMessage {
  const mine = row.sender_id === currentUserId;
  return {
    id: `cloud-${row.id}`,
    mine,
    author: mine ? 'You' : relatedName(row.sender, 'Family'),
    text: row.body,
    channel: 'family',
  };
}

function personToProfile(person: HouseholdPerson, index: number): FamilyProfile {
  const colors = [
    ['#DCE7FF', '#2257F4'],
    ['#FFE1CF', '#D7550D'],
    ['#D9F7ED', '#168866'],
    ['#EADFFF', '#6E3AE2'],
  ];
  const [color, ink] = colors[index % colors.length];
  return {
    id: person.id,
    linkedUserId: person.linked_user_id,
    name: person.display_name,
    dob: person.date_of_birth ?? '',
    bio: person.bio ?? '',
    role: person.role,
    avatarUri: person.avatar_signed_url ?? undefined,
    color,
    ink,
  };
}

function cloudEvent(row: any): BotEvent {
  const startsAt = new Date(row.starts_at);
  let metadata: any = {};
  try { metadata = row.details ? JSON.parse(row.details) : {}; } catch { metadata = {}; }
  return {
    id: `cloud-${row.id}`,
    sourceId: row.id,
    title: row.title,
    person: metadata.person || relatedName(row.creator, 'Family'),
    day: startsAt.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }),
    dateISO: localDateKey(startsAt),
    time: startsAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
    place: row.location || undefined,
    reminder: typeof metadata.reminder === 'number' ? metadata.reminder : undefined,
    directions: typeof metadata.directions === 'boolean' ? metadata.directions : undefined,
    provider: row.provider || 'coho',
    sourceCalendarId: row.source_calendar_id || undefined,
    recurrenceRule: row.recurrence_rule || undefined,
  };
}

function cloudChore(row: any, index: number): Chore {
  const rewardId = appRewardId(row.reward_type);
  const rewardValue = Number(row.reward_value ?? 10);
  const colors = ['#2257F4', '#19A47B', '#7C4DFF', '#FF7A2E'];
  const dueAt = row.due_at ? new Date(row.due_at) : null;
  const assignedPerson = Array.isArray(row.assigned_person) ? row.assigned_person[0] : row.assigned_person;
  return {
    id: row.id,
    title: row.title,
    details: row.details ?? '',
    owner: assignedPerson?.display_name || relatedName(row.assignee, 'Unassigned'),
    assignedPersonId: row.assigned_person_id ?? assignedPerson?.id ?? null,
    assignedUserId: row.assigned_to ?? assignedPerson?.linked_user_id ?? null,
    dueAt: dueAt && !Number.isNaN(dueAt.getTime()) ? dueAt.toISOString() : null,
    due: dueAt ? dueAt.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'No due time',
    recurrence: recurrenceFromRule(row.recurrence_rule),
    recurrenceRule: row.recurrence_rule ?? null,
    reminderMinutes: typeof row.reminder_minutes === 'number' ? row.reminder_minutes : row.reminder_minutes == null ? null : Number(row.reminder_minutes),
    done: row.status === 'completed',
    points: rewardValue,
    rewardId,
    rewardValue,
    rewardLabel: row.reward_label ?? null,
    color: colors[index % colors.length],
  };
}

function appRewardId(type?: string) {
  if (type === 'game_time') return 'game';
  if (type === 'points') return 'points';
  if (type === 'vbucks') return 'vbucks';
  if (type === 'allowance') return 'allowance';
  return 'choice';
}

function databaseRewardType(rewardId: string) {
  if (rewardId === 'game') return 'game_time';
  if (rewardId === 'points') return 'points';
  if (rewardId === 'vbucks') return 'vbucks';
  if (rewardId === 'allowance') return 'allowance';
  return 'custom';
}

function recurrenceFromRule(rule?: string | null): ChoreRepeat {
  return choreRepeatOptions.find((option) => option.rule === rule)?.id ?? 'none';
}

function recurrenceRuleFor(recurrence: ChoreRepeat) {
  return choreRepeatOptions.find((option) => option.id === recurrence)?.rule ?? null;
}

function recurrenceLabel(recurrence: ChoreRepeat) {
  return choreRepeatOptions.find((option) => option.id === recurrence)?.label ?? 'Does not repeat';
}

function choreRewardMeta(rewardId: string) {
  return choreRewardOptions.find((option) => option.id === rewardId) ?? choreRewardOptions[0];
}

function formatChoreReward(chore: Pick<Chore, 'rewardId' | 'rewardValue' | 'rewardLabel'>) {
  const value = Number(chore.rewardValue);
  if (chore.rewardId === 'game') return `${value} min game time`;
  if (chore.rewardId === 'vbucks') return `${value.toLocaleString()} V-Bucks`;
  if (chore.rewardId === 'allowance') return `$${value.toLocaleString()} allowance`;
  if (chore.rewardId === 'choice') return chore.rewardLabel || 'Custom reward';
  return `${value.toLocaleString()} points`;
}

function defaultChoreDue() {
  const due = new Date();
  due.setSeconds(0, 0);
  due.setMinutes(Math.ceil(due.getMinutes() / 5) * 5);
  due.setHours(18, 0, 0, 0);
  if (due.getTime() <= Date.now() + 30 * 60 * 1000) {
    due.setDate(due.getDate() + 1);
    due.setHours(9, 0, 0, 0);
  }
  return due;
}

function defaultChoreForm(
  profiles: FamilyProfile[],
  currentUserId: string | null,
  title = '',
  details = '',
): ChoreFormValue {
  const defaultOwner = profiles.find((profile) => profile.linkedUserId === currentUserId) ?? profiles[0] ?? null;
  return {
    title,
    details,
    assignedPersonId: defaultOwner?.id ?? null,
    dueAt: defaultChoreDue(),
    recurrence: 'none',
    reminderMinutes: 30,
    rewardId: 'points',
    rewardValue: 10,
    rewardLabel: '',
  };
}

function choreToForm(chore: Chore, profiles: FamilyProfile[]): ChoreFormValue {
  const dueAt = chore.dueAt ? new Date(chore.dueAt) : defaultChoreDue();
  const owner = profiles.find((profile) => profile.id === chore.assignedPersonId)
    ?? profiles.find((profile) => profile.linkedUserId === chore.assignedUserId)
    ?? profiles.find((profile) => profile.name === chore.owner);
  return {
    title: chore.title,
    details: chore.details,
    assignedPersonId: owner?.id ?? null,
    dueAt: Number.isNaN(dueAt.getTime()) ? defaultChoreDue() : dueAt,
    recurrence: chore.recurrence,
    reminderMinutes: chore.reminderMinutes,
    rewardId: chore.rewardId,
    rewardValue: chore.rewardValue,
    rewardLabel: chore.rewardLabel ?? '',
  };
}

function mergeChoreDate(current: Date, next: Date, mode: 'date' | 'time') {
  const merged = new Date(current);
  if (mode === 'date') {
    merged.setFullYear(next.getFullYear(), next.getMonth(), next.getDate());
  } else {
    merged.setHours(next.getHours(), next.getMinutes(), 0, 0);
  }
  return merged;
}

function rewardValueLabel(rewardId: string) {
  if (rewardId === 'game') return 'MINUTES EARNED';
  if (rewardId === 'vbucks') return 'V-BUCKS EARNED';
  if (rewardId === 'allowance') return 'DOLLARS EARNED';
  return 'POINTS EARNED';
}

function rewardPresetLabel(rewardId: string, value: number) {
  if (rewardId === 'game') return `${value} min`;
  if (rewardId === 'vbucks') return value.toLocaleString();
  if (rewardId === 'allowance') return `$${value}`;
  return `+${value}`;
}

function choreFormSummary(value: ChoreFormValue, profiles: FamilyProfile[]) {
  const owner = profiles.find((profile) => profile.id === value.assignedPersonId)?.name ?? 'Anyone';
  const due = value.dueAt.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const reward = formatChoreReward({
    rewardId: value.rewardId,
    rewardValue: value.rewardValue,
    rewardLabel: value.rewardLabel,
  });
  return `${owner} · ${due} · ${recurrenceLabel(value.recurrence)} · ${reward}`;
}

function eventStartISO(event: BotEvent) {
  if (!event.dateISO) return null;
  const dateMatch = event.dateISO.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = event.time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!dateMatch || !timeMatch) return null;
  let hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const meridiem = timeMatch[3].toUpperCase();
  if (meridiem === 'PM' && hour < 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;
  return new Date(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]), hour, minute).toISOString();
}

function eventFromCohDraft(draft: CohDraft): BotEvent | null {
  if (!draft.title || !draft.date || !draft.time) return null;
  const date = new Date(`${draft.date}T${draft.time}:00`);
  if (Number.isNaN(date.getTime())) return null;
  return {
    id: `coh-${draft.date}-${draft.time}-${draft.title.toLowerCase().replace(/\W+/g, '-')}`,
    title: draft.title,
    person: draft.person ?? 'You',
    day: date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }),
    dateISO: draft.date,
    time: date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
    place: draft.location ?? undefined,
    reminder: draft.reminder_minutes ?? undefined,
    directions: draft.directions ?? undefined,
  };
}

function extractEventIntent(text: string): Partial<BotDraft> {
  const cleaned = text.replace(/^\s*(@coh|hey coh|@bot|hey bot)[,:]?\s*/i, '').trim();
  const date = extractDate(cleaned);
  const time = extractTime(cleaned);
  const personMatch = cleaned.match(/\b(?:for|with)\s+([a-z][a-z'-]*)\b/i);
  const placeMatch = cleaned.match(/\b(?:at|place is|location is)\s+([a-z][a-z0-9&'. -]{2,})$/i);
  let title = cleaned
    .replace(/\b(today|tomorrow|tonight|this morning|this afternoon|this evening|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, ' ')
    .replace(/\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?\b/gi, ' ')
    .replace(/\b\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?\b/g, ' ')
    .replace(/\b(?:at\s*)?\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/gi, ' ')
    .replace(/\b(?:for|with)\s+[a-z][a-z'-]*\b/gi, ' ')
    .replace(/\b(i have|i've got|my|please|can you|could you|add|create|schedule|put|make|an?|the|on|at)\b/gi, ' ')
    .replace(/[,.;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (/^(hair|hair cut|barber|barber appointment)$/i.test(title)) title = 'Haircut';
  const result: Partial<BotDraft> = { ...date, ...time };
  if (title) result.title = titleCaseWords(title);
  if (personMatch) result.person = titleCase(personMatch[1]);
  else if (/\b(i have|i need|my)\b/i.test(cleaned)) result.person = 'You';
  if (placeMatch && !/^\d/.test(placeMatch[1])) result.place = titleCaseWords(placeMatch[1].trim());
  return result;
}

function extractDate(text: string): Partial<BotDraft> | null {
  const normalized = text.toLowerCase();
  const today = startOfDay(new Date());
  let target: Date | null = null;
  if (/\btoday\b/.test(normalized)) target = today;
  else if (/\btonight\b/.test(normalized)) target = today;
  else if (/\btomorrow\b/.test(normalized)) target = addDays(today, 1);
  else {
    const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const weekday = weekdays.findIndex((day) => new RegExp(`\\b${day}\\b`, 'i').test(text));
    if (weekday >= 0) {
      let offset = (weekday - today.getDay() + 7) % 7;
      if (offset === 0 && !/\btoday\b/i.test(text)) offset = 7;
      target = addDays(today, offset);
    }
  }
  const numeric = text.match(/\b(1[0-2]|0?[1-9])[\/-](3[01]|[12]\d|0?[1-9])(?:[\/-](\d{2,4}))?\b/);
  if (numeric) {
    let year = numeric[3] ? Number(numeric[3]) : today.getFullYear();
    if (year < 100) year += 2000;
    target = new Date(year, Number(numeric[1]) - 1, Number(numeric[2]));
    if (!numeric[3] && target < today) target.setFullYear(year + 1);
  }
  const named = text.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/i);
  if (named) {
    const parsed = new Date(`${named[1]} ${named[2]}, ${named[3] ?? today.getFullYear()}`);
    if (!Number.isNaN(parsed.getTime())) { target = parsed; if (!named[3] && target < today) target.setFullYear(today.getFullYear() + 1); }
  }
  if (!target || Number.isNaN(target.getTime())) return null;
  return { day: target.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }), dateISO: localDateKey(target) };
}

function extractTime(text: string): Partial<BotDraft> | null {
  const withoutDates = text
    .replace(/\b\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?\b/g, ' ')
    .replace(/\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\b/gi, ' ');
  const match = withoutDates.match(/\b(?:at\s*)?(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)?\b/i);
  if (!match) return null;
  const hour = String(Number(match[1]));
  const time = match[2] ? `${hour}:${match[2]}` : `${hour}:00`;
  const meridiem = match[3]?.toUpperCase() as 'AM' | 'PM' | undefined;
  return { time, meridiem };
}

function extractDraftCorrection(text: string): Partial<BotDraft> {
  const correction: Partial<BotDraft> = {};
  const date = extractDate(text);
  const time = extractTime(text);
  const place = text.match(/\b(?:change|set|make)?\s*(?:the\s+)?(?:place|location)\s*(?:to|is)?\s+(.+)$/i);
  const person = text.match(/\b(?:change|set|make)?\s*(?:the\s+)?(?:person|name|for)\s*(?:to|is)?\s+([a-z][a-z'-]*)\b/i);
  const title = text.match(/\b(?:change|rename|set)\s+(?:the\s+)?(?:event|title)\s*(?:to|as|is)\s+(.+)$/i);
  if (date) Object.assign(correction, date);
  if (time) Object.assign(correction, time);
  if (place) correction.place = titleCaseWords(place[1].trim());
  if (person) correction.person = titleCase(person[1]);
  if (title) correction.title = titleCaseWords(title[1].trim());
  return correction;
}

function titleCase(value: string) { return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase(); }
function titleCaseWords(value: string) { return value.split(/\s+/).map(titleCase).join(' '); }
function isYes(value: string) { return /^(yes|y|yeah|yep|sure|please|ok|okay)\b/.test(value); }
function isNo(value: string) { return /^(no|n|nope|skip|none|not now)\b/.test(value); }
function parseReminder(value: string) { const match = value.match(/(\d+)\s*(?:minute|min)/); return match ? Number(match[1]) : undefined; }
function cleanAnswer(value: string) { return value.replace(/^(it is|it's|the place is|at)\s+/i, '').trim(); }
function possessiveEvent(draft: BotDraft) { return draft.person && draft.person !== 'You' ? `${draft.person}’s ${draft.title?.toLowerCase()}` : `your ${draft.title?.toLowerCase()}`; }
function formatDraftTime(draft: BotDraft) { return `${draft.time} ${draft.meridiem}`; }
function draftSummary(draft: BotDraft, sentence = true) { const text = `“${draft.title}” for ${draft.person ?? 'You'} on ${draft.day} at ${formatDraftTime(draft)}${draft.place ? ` at ${draft.place}` : ''}${draft.directions ? ' with directions' : ''}${draft.reminder ? ` and a ${draft.reminder}-minute reminder` : ''}.`; return sentence ? `Here’s what I have: ${text}` : text; }
function parseClock(value: string) { const match = value.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i); let hour = Number(match?.[1] ?? 7); const minute = Number(match?.[2] ?? 0); const pm = match?.[3]?.toUpperCase() === 'PM'; if (pm && hour < 12) hour += 12; if (!pm && hour === 12) hour = 0; return { hour, minute }; }
function weekdayNumber(day: string) { return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].indexOf(day) + 1; }
function startOfDay(date: Date) { const next = new Date(date); next.setHours(0, 0, 0, 0); return next; }
function addDays(date: Date, count: number) { const next = new Date(date); next.setDate(next.getDate() + count); return next; }
function nextFollowUpDate() {
  const next = new Date();
  let days = (5 - next.getDay() + 7) % 7;
  if (days === 0) days = 7;
  next.setDate(next.getDate() + days);
  next.setHours(17, 0, 0, 0);
  return next;
}
function startOfWeek(date: Date) { const next = startOfDay(date); next.setDate(next.getDate() - next.getDay()); return next; }
function sameDay(a: Date, b: Date) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function localDateKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function FamilyProfilesScreen({ styles, profiles, onEdit, onAdd, onInvite }: { styles: any; profiles: FamilyProfile[]; onEdit: (profile: FamilyProfile) => void; onAdd: () => void; onInvite: () => void }) {
  return <ScrollView contentContainerStyle={styles.scrollContent}><View style={styles.familyHero}><View style={styles.flex}><Text style={styles.progressLabel}>YOUR HOUSEHOLD</Text><Text style={styles.familyHeroTitle}>{profiles.length} family members</Text><Text style={styles.muted}>Profiles help Coh personalize schedules, rewards, reminders, and recaps.</Text></View><Pressable onPress={onAdd} style={styles.addProfileButton}><Ionicons name="person-add" size={20} color="#fff" /></Pressable></View><Pressable onPress={onInvite} style={styles.inviteFamilyCard}><View style={styles.inviteFamilyIcon}><Ionicons name="mail-unread" size={21} color="#fff" /></View><View style={styles.flex}><Text style={styles.settingTitle}>Invite another family member</Text><Text style={styles.muted}>Create a secure household invitation and share it from your iPhone.</Text></View><Ionicons name="chevron-forward" size={19} color={styles.iconColor.color} /></Pressable><Text style={styles.sectionTitle}>People</Text>{profiles.map((profile) => <Pressable key={profile.id} onPress={() => onEdit(profile)} style={styles.profileRow}><ProfileAvatar profile={profile} styles={styles} size="large" /><View style={styles.flex}><Text style={styles.profileName}>{profile.name || 'New family member'}</Text><Text style={styles.muted}>{profile.role}{profile.dob ? ` · Born ${profile.dob}` : ''}</Text><Text numberOfLines={1} style={styles.profileBio}>{profile.bio || 'Add a bio, interests, allergies, school, or anything Coh should know.'}</Text></View><Ionicons name="create-outline" size={20} color={styles.iconColor.color} /></Pressable>)}<Pressable onPress={onAdd} style={styles.outlineAction}><Ionicons name="person-add-outline" size={19} color="#2257F4" /><Text style={styles.outlineActionText}>Add family profile</Text></Pressable></ScrollView>;
}

function ProfileAvatar({ profile, styles, size }: { profile: FamilyProfile; styles: any; size?: string }) {
  const initials = profile.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';
  return <View style={[styles.profileAvatar, size === 'large' && styles.profileAvatarLarge, { backgroundColor: profile.color }]}>{profile.avatarUri ? <Image source={{ uri: profile.avatarUri }} style={styles.profileAvatarImage} /> : <Text style={[styles.avatarText, { color: profile.ink }]}>{initials}</Text>}</View>;
}

function ProfileEditorModal({ visible, profile, styles, dark, onClose, onSave }: any) {
  const [draft, setDraft] = useState<FamilyProfile | null>(profile);
  useEffect(() => setDraft(profile), [profile]);
  if (!draft) return null;
  async function choosePhoto() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: .75, base64: true });
    if (!result.canceled) {
      const asset = result.assets[0];
      setDraft((current) => current ? {
        ...current,
        avatarUri: asset.uri,
        avatarBase64: asset.base64 ?? undefined,
        avatarMime: asset.mimeType,
      } : current);
    }
  }
  const update = (patch: Partial<FamilyProfile>) => setDraft((current) => current ? { ...current, ...patch } : current);
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}><Pressable style={styles.modalDismiss} onPress={onClose} /><ScrollView style={styles.profileSheet} contentContainerStyle={styles.profileSheetContent} keyboardShouldPersistTaps="handled"><View style={styles.modalHandle} /><View style={styles.modalHead}><View><Text style={styles.eyebrow}>FAMILY PROFILE</Text><Text style={styles.modalTitle}>{draft.name ? `Edit ${draft.name}` : 'Add someone'}</Text></View><Pressable onPress={onClose} style={styles.iconButton}><Ionicons name="close" size={21} color={styles.iconColor.color} /></Pressable></View><Pressable onPress={choosePhoto} style={styles.photoEditor}><ProfileAvatar profile={draft} styles={styles} size="large" /><View><Text style={styles.settingTitle}>Profile picture</Text><Text style={styles.link}>Choose from Photos</Text></View></Pressable><Text style={styles.fieldLabel}>NAME</Text><TextInput value={draft.name} onChangeText={(name) => update({ name })} placeholder="Full name" placeholderTextColor="#8B93A5" style={styles.modalInput} /><Text style={styles.fieldLabel}>DATE OF BIRTH</Text><TextInput value={draft.dob} onChangeText={(dob) => update({ dob })} placeholder="YYYY-MM-DD" placeholderTextColor="#8B93A5" keyboardType="numbers-and-punctuation" style={styles.modalInput} /><Text style={styles.fieldLabel}>ROLE</Text><View style={styles.chipRow}>{(['Adult admin', 'Family member', 'Child'] as FamilyProfile['role'][]).map((role) => <Pressable key={role} onPress={() => update({ role })} style={[styles.choiceChip, draft.role === role && styles.choiceChipActive]}><Text style={[styles.choiceChipText, draft.role === role && styles.choiceChipTextActive]}>{role}</Text></Pressable>)}</View><Text style={styles.fieldLabel}>ABOUT</Text><TextInput value={draft.bio} onChangeText={(bio) => update({ bio })} multiline placeholder="Interests, allergies, school, preferences, or anything useful for the family" placeholderTextColor="#8B93A5" style={[styles.modalInput, styles.modalTextArea]} /><Text style={styles.profilePrivacy}>This information stays inside your Coho household and is used to personalize family assistance.</Text><Pressable disabled={!draft.name.trim()} onPress={() => onSave(draft)} style={[styles.saveButton, !draft.name.trim() && { opacity: .45 }]}><Text style={styles.saveButtonText}>Save profile</Text></Pressable></ScrollView><StatusBar style={dark ? 'light' : 'dark'} /></KeyboardAvoidingView></Modal>;
}

function MoreMenu({ styles, setView }: any) {
  const items = [
    ['Chief of Home', 'home-outline', '#7047EE', 'Personal briefings, week ahead, and follow-ups'],
    ['Family', 'people-outline', '#2257F4', 'Members, roles, and family invitations'],
    ['Family Inbox', 'mail-unread-outline', '#FF7A2E', 'One private address for school, appointments, and activities'],
    ['Meals & Groceries', 'restaurant-outline', '#D7550D', 'Meal plans, shared groceries, and Coh Home Chef'],
    ['Family Places', 'location-outline', '#19A47B', 'Opt-in location, arrivals, and departures'],
    ['Trips', 'airplane-outline', '#7047EE', 'Private schedules with friends and other families'],
    ['Calendar Sync', 'calendar-outline', '#2257F4', 'Connect selected calendars on this iPhone'],
    ['Notes', 'document-text-outline', '#7C4DFF', 'Lists, instructions, and family details'],
    ['Recaps', 'sparkles-outline', '#2257F4', 'Daily summaries by push and email'],
    ['Automations', 'flash-outline', '#7047EE', 'Real cloud rules, retries, and household follow-through'],
    ['Integrations', 'extension-puzzle-outline', '#19A47B', 'Skylight, calendars, email, and more'],
    ['Settings', 'settings-outline', '#FF7A2E', 'Household, privacy, and preferences'],
  ];
  return <ScrollView contentContainerStyle={styles.scrollContent}><Text style={styles.moreIntro}>Everything else your household needs, without cluttering the everyday view.</Text><View style={styles.moreGrid}>{items.map(([title, icon, color, detail]) => <Pressable key={title} onPress={() => setView(title)} style={styles.moreCard}><View style={[styles.moreIcon, { backgroundColor: `${color}18` }]}><Ionicons name={icon as any} size={25} color={color} /></View><Text style={styles.moreTitle}>{title}</Text><Text style={styles.moreDetail}>{detail}</Text><Ionicons name="chevron-forward" size={18} color={styles.iconColor.color} style={styles.moreChevron} /></Pressable>)}</View></ScrollView>;
}

function ChiefOfHomeScreen({ styles, prefs, memberNames, setPrefs, onActivate }: { styles: any; prefs: ChiefPrefs; memberNames: string[]; setPrefs: (value: ChiefPrefs) => void; onActivate: () => void }) {
  const update = (patch: Partial<ChiefPrefs>) => setPrefs({ ...prefs, ...patch });
  const toggleMember = (name: string) => update({ members: prefs.members.includes(name) ? prefs.members.filter((item) => item !== name) : [...prefs.members, name] });
  const briefingRows = [
    { key: 'daily', icon: 'sunny-outline', color: '#FF7A2E', title: 'Daily briefing', detail: `Every day at ${prefs.dailyTime}`, times: ['6:30 AM', '7:00 AM', '8:00 AM'] },
    { key: 'weekAhead', icon: 'calendar-outline', color: '#2257F4', title: 'Full week ahead', detail: `${prefs.weekAheadDay} at ${prefs.weekAheadTime}`, times: ['5:00 PM', '6:00 PM', '7:00 PM'] },
    { key: 'followUp', icon: 'refresh-outline', color: '#19A47B', title: 'Weekly follow-up', detail: `${prefs.followUpDay} at ${prefs.followUpTime}`, times: ['4:00 PM', '5:00 PM', '6:00 PM'] },
  ];
  return <ScrollView contentContainerStyle={styles.scrollContent}>
    <LinearGradient colors={['#24116D', '#7047EE']} style={styles.chiefHero}><View style={styles.chiefBadge}><Ionicons name="home" size={22} color="#7047EE" /></View><Text style={styles.recapHeroLabel}>COHO</Text><Text style={styles.chiefHeroTitle}>Your Chief of Home</Text><Text style={styles.recapHeroText}>The right family information, resurfaced before anyone has to remember it.</Text></LinearGradient>
    <Text style={styles.sectionTitle}>Your briefings</Text>
    {briefingRows.map((row) => <View key={row.key} style={styles.chiefSettingCard}><View style={styles.settingRowTop}><View style={[styles.integrationIcon, { backgroundColor: `${row.color}18` }]}><Ionicons name={row.icon as any} size={22} color={row.color} /></View><View style={styles.flex}><Text style={styles.settingTitle}>{row.title}</Text><Text style={styles.muted}>{row.detail}</Text></View><Switch value={(prefs as any)[row.key]} onValueChange={(value) => update({ [row.key]: value })} trackColor={{ true: '#6687FF' }} /></View><View style={styles.chipRow}>{row.times.map((time) => { const field = row.key === 'daily' ? 'dailyTime' : row.key === 'weekAhead' ? 'weekAheadTime' : 'followUpTime'; return <Pressable key={time} onPress={() => update({ [field]: time })} style={[styles.choiceChip, (prefs as any)[field] === time && styles.choiceChipActive]}><Text style={[styles.choiceChipText, (prefs as any)[field] === time && styles.choiceChipTextActive]}>{time}</Text></Pressable>; })}</View></View>)}
    <Text style={styles.sectionTitle}>Include</Text><View style={styles.preferenceGrid}>{([['events', 'Appointments & events'], ['chores', 'Chores'], ['followUps', 'Follow-ups'], ['messages', 'Important messages']] as const).map(([key, label]) => <Pressable key={key} onPress={() => update({ [key]: !prefs[key] })} style={[styles.preferenceTile, prefs[key] && styles.preferenceTileActive]}><Ionicons name={prefs[key] ? 'checkmark-circle' : 'ellipse-outline'} size={19} color={prefs[key] ? '#19A47B' : styles.iconColor.color} /><Text style={styles.preferenceText}>{label}</Text></Pressable>)}</View>
    <Text style={styles.sectionTitle}>Family members</Text><View style={styles.chipRow}>{memberNames.map((name) => <Pressable key={name} onPress={() => toggleMember(name)} style={[styles.memberChip, prefs.members.includes(name) && styles.memberChipActive]}><Text style={[styles.choiceChipText, prefs.members.includes(name) && styles.choiceChipTextActive]}>{name}</Text></Pressable>)}</View>
    <Text style={styles.sectionTitle}>Delivery</Text><View style={styles.settingRow}><Ionicons name="notifications-outline" size={21} color="#7047EE" /><View style={styles.flex}><Text style={styles.settingTitle}>Push notifications</Text><Text style={styles.muted}>Delivered to this iPhone</Text></View><Switch value={prefs.push} onValueChange={(push) => update({ push })} trackColor={{ true: '#6687FF' }} /></View><View style={styles.settingRow}><Ionicons name="mail-outline" size={21} color="#2257F4" /><View style={styles.flex}><Text style={styles.settingTitle}>Email copy</Text><Text style={styles.muted}>Delivered to your verified Coho sign-in email</Text></View><Switch value={prefs.email} onValueChange={(email) => update({ email })} trackColor={{ true: '#6687FF' }} /></View><View style={styles.settingRow}><Ionicons name="moon-outline" size={21} color="#7C4DFF" /><View style={styles.flex}><Text style={styles.settingTitle}>Quiet hours</Text><Text style={styles.muted}>9:00 PM–7:00 AM · urgent alerts only</Text></View><Switch value={prefs.quietHours} onValueChange={(quietHours) => update({ quietHours })} trackColor={{ true: '#6687FF' }} /></View>
    <Pressable onPress={onActivate} style={styles.saveButton}><Text style={styles.saveButtonText}>Save and schedule my briefings</Text></Pressable>
  </ScrollView>;
}

function NotesScreen({ styles, householdId, userId, onAction }: { styles: any; householdId: string | null; userId: string | null; onAction: (message: string) => void }) {
  const [notes, setNotes] = useState<SharedNote[]>([]);
  const [query, setQuery] = useState('');
  const [editor, setEditor] = useState<{ id?: string; title: string; body: string; pinned: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!householdId) return setNotes([]);
    setNotes(await listSharedNotes(householdId));
  }

  useEffect(() => {
    void load().catch(() => undefined);
    if (!householdId) return;
    return subscribeToHousehold('notes', householdId, () => void load());
  }, [householdId]);

  async function save() {
    if (!editor?.title.trim() || !householdId || !userId) return;
    setBusy(true);
    try {
      await saveFamilyNote({
        ...editor,
        householdId,
        userId,
      });
      await load();
      setEditor(null);
      onAction('Shared family note saved');
    } catch (error) {
      onAction(error instanceof Error ? error.message : 'The note could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  const filtered = notes.filter((note) => `${note.title} ${note.body}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <>
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <View style={styles.sectionHead}><View><Text style={styles.sectionTitle}>Shared family notes</Text><Text style={styles.muted}>Real-time household lists, instructions, and details</Text></View><Pressable onPress={() => setEditor({ title: '', body: '', pinned: false })} style={styles.addProfileButton}><Ionicons name="add" size={20} color="#fff" /></Pressable></View>
      <TextInput value={query} onChangeText={setQuery} placeholder="Search family notes" placeholderTextColor="#8B93A5" style={styles.searchInput} />
      {filtered.length === 0 ? <View style={styles.emptyChat}><Ionicons name="document-text-outline" size={28} color="#7C4DFF" /><Text style={styles.settingTitle}>{query ? 'No matching notes' : 'No shared notes yet'}</Text><Text style={styles.muted}>Create the first note and it will appear for the household in real time.</Text></View> : <View style={styles.notesGrid}>{filtered.map((note) => <Pressable key={note.id} onPress={() => setEditor(note)} style={styles.noteCard}><Ionicons name={note.pinned ? 'pin' : 'document-text-outline'} size={23} color={note.pinned ? '#FF7A2E' : '#7C4DFF'} /><Text style={styles.noteTitle}>{note.title}</Text><Text numberOfLines={3} style={styles.muted}>{note.body || 'No details yet'}</Text><Text style={styles.muted}>Updated {new Date(note.updated_at).toLocaleDateString()}</Text><Ionicons name="chevron-forward" size={16} color={styles.iconColor.color} style={styles.noteChevron} /></Pressable>)}</View>}
    </ScrollView>
    <Modal visible={Boolean(editor)} transparent animationType="slide" onRequestClose={() => setEditor(null)}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
        <Pressable style={styles.modalDismiss} onPress={() => setEditor(null)} />
        {editor && <View style={styles.modalSheet}>
          <View style={styles.modalHandle} />
          <View style={styles.modalHead}><View><Text style={styles.eyebrow}>SHARED NOTE</Text><Text style={styles.modalTitle}>{editor.id ? 'Edit family note' : 'New family note'}</Text></View><Pressable onPress={() => setEditor(null)} style={styles.iconButton}><Ionicons name="close" size={21} color={styles.iconColor.color} /></Pressable></View>
          <Text style={styles.fieldLabel}>TITLE</Text><TextInput value={editor.title} onChangeText={(title) => setEditor({ ...editor, title })} placeholder="Note title" placeholderTextColor="#8B93A5" style={styles.modalInput} />
          <Text style={styles.fieldLabel}>DETAILS</Text><TextInput value={editor.body} onChangeText={(body) => setEditor({ ...editor, body })} multiline placeholder="Everything the family should know…" placeholderTextColor="#8B93A5" style={[styles.modalInput, styles.modalTextArea]} />
          <View style={styles.settingRow}><Ionicons name="pin-outline" size={21} color="#FF7A2E" /><View style={styles.flex}><Text style={styles.settingTitle}>Pin for the household</Text><Text style={styles.muted}>Keep this note at the top</Text></View><Switch value={editor.pinned} onValueChange={(pinned) => setEditor({ ...editor, pinned })} trackColor={{ true: '#FF7A2E' }} /></View>
          <Pressable disabled={busy || !editor.title.trim()} onPress={save} style={[styles.saveButton, (busy || !editor.title.trim()) && { opacity: .5 }]}><Text style={styles.saveButtonText}>{busy ? 'Saving…' : 'Save shared note'}</Text></Pressable>
        </View>}
      </KeyboardAvoidingView>
    </Modal>
  </>;
}

function RecapsScreen({ styles, onRefresh, onListen, onOpenEvent, onCompleteFollowUp, events, chores, messages, followUps, snapshots, initialSnapshotId }: any) {
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(initialSnapshotId ?? snapshots[0]?.id ?? null);
  useEffect(() => {
    if (initialSnapshotId && snapshots.some((snapshot: BriefingSnapshot) => snapshot.id === initialSnapshotId)) {
      setSelectedSnapshotId(initialSnapshotId);
      return;
    }
    if (!selectedSnapshotId && snapshots[0]?.id) setSelectedSnapshotId(snapshots[0].id);
  }, [snapshots, selectedSnapshotId, initialSnapshotId]);
  const openChores = chores.filter((item: any) => !item.done).length;
  const recentMessages = messages.filter((item: ChatMessage) => !item.bot).slice(-5).length;
  const syncTime = new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const today = localDateKey(new Date());
  const weekEvents = events.filter((event: BotEvent) => !event.dateISO || event.dateISO >= today).slice(0, 14);
  const selected = snapshots.find((snapshot: BriefingSnapshot) => snapshot.id === selectedSnapshotId) ?? null;

  return <ScrollView contentContainerStyle={styles.scrollContent}>
    <LinearGradient colors={['#2257F4', '#7047EE']} style={styles.recapHero}>
      <Ionicons name="sparkles" size={24} color="#fff" />
      <Text style={styles.recapHeroLabel}>LIVE DAILY SYNC · {syncTime.toUpperCase()}</Text>
      <Text style={styles.recapHeroTitle}>Here’s what your home needs now.</Text>
      <Text style={styles.recapHeroText}>{events.length} family event{events.length === 1 ? '' : 's'}, {openChores} open chore{openChores === 1 ? '' : 's'}, {followUps.length} follow-up{followUps.length === 1 ? '' : 's'}, and {recentMessages} recent family message{recentMessages === 1 ? '' : 's'} are in your current briefing.</Text>
      <View style={styles.recapActionRow}>
        <Pressable onPress={() => void onRefresh()} style={styles.recapHeroButton}><Ionicons name="refresh" size={15} color="#2257F4" /><Text>Refresh now</Text></Pressable>
        <Pressable onPress={() => onListen()} style={styles.recapHeroButton}><Ionicons name="volume-high" size={15} color="#2257F4" /><Text>Listen</Text></Pressable>
      </View>
    </LinearGradient>

    <Text style={styles.sectionTitle}>Saved daily & weekly syncs</Text>
    {snapshots.length === 0 ? <View style={styles.emptyChat}><Ionicons name="albums-outline" size={28} color="#7047EE" /><Text style={styles.settingTitle}>Your first saved sync is coming</Text><Text style={styles.muted}>Scheduled briefings are saved here, so you can open them again at any time.</Text></View> : snapshots.slice(0, 12).map((snapshot: BriefingSnapshot) => <Pressable key={snapshot.id} onPress={() => setSelectedSnapshotId(selectedSnapshotId === snapshot.id ? null : snapshot.id)} style={[styles.recapSnapshot, selectedSnapshotId === snapshot.id && styles.recapSnapshotActive]}>
      <View style={styles.recapSnapshotIcon}><Ionicons name={snapshot.briefing_type === 'daily' ? 'sunny' : snapshot.briefing_type === 'week_ahead' ? 'calendar' : 'refresh-circle'} size={18} color="#7047EE" /></View>
      <View style={styles.flex}><Text style={styles.highlightText}>{snapshot.title}</Text><Text style={styles.muted}>{new Date(`${snapshot.local_date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</Text></View>
      <Ionicons name={selectedSnapshotId === snapshot.id ? 'chevron-up' : 'chevron-down'} size={17} color="#7047EE" />
    </Pressable>)}
    {selected && <View style={styles.recapSnapshotDetail}>
      <Text style={styles.settingTitle}>{selected.summary}</Text>
      <Pressable onPress={() => onListen(selected.summary)} style={styles.listenSnapshot}><Ionicons name="volume-high" size={15} color="#7047EE" /><Text style={styles.link}>Listen to this sync</Text></Pressable>
      {(selected.content.events ?? []).map((event: any) => <Pressable key={event.id} onPress={() => onOpenEvent(cloudEvent(event))} style={styles.highlightRow}><Text style={styles.highlightTime}>{new Date(event.starts_at).toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase()}</Text><View style={styles.flex}><Text style={styles.highlightText}>{event.title}</Text><Text style={styles.muted}>{new Date(event.starts_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}{event.location ? ` · ${event.location}` : ''}</Text></View><Ionicons name="chevron-forward" size={17} color="#7047EE" /></Pressable>)}
      {(selected.content.chores ?? []).map((chore: any) => <View key={chore.id} style={styles.highlightRow}><Text style={styles.highlightTime}>TODO</Text><View style={styles.flex}><Text style={styles.highlightText}>{chore.title}</Text><Text style={styles.muted}>{chore.due_at ? `Due ${new Date(chore.due_at).toLocaleString()}` : 'Open family chore'}</Text></View></View>)}
      {(selected.content.actions ?? []).map((action: any) => <View key={action.id} style={styles.highlightRow}><Text style={styles.highlightTime}>LOOP</Text><View style={styles.flex}><Text style={styles.highlightText}>{action.title}</Text><Text style={styles.muted}>{String(action.status).replace('_', ' ')}</Text></View></View>)}
    </View>}

    <Text style={styles.sectionTitle}>Week ahead</Text>
    {weekEvents.length === 0 ? <View style={styles.emptyChat}><Ionicons name="calendar-clear-outline" size={28} color="#2257F4" /><Text style={styles.settingTitle}>No upcoming events</Text><Text style={styles.muted}>When Coh or a family member adds one, it will appear here.</Text></View> : weekEvents.map((event: BotEvent) => <Pressable key={event.id} onPress={() => onOpenEvent(event)} style={styles.highlightRow}><Text style={styles.highlightTime}>{event.dateISO ? new Date(`${event.dateISO}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase() : 'NEXT'}</Text><View style={styles.flex}><Text style={styles.highlightText}>{event.title}</Text><Text style={styles.muted}>{event.time} · {event.person}{event.place ? ` · ${event.place}` : ''}</Text></View><Ionicons name="chevron-forward" size={17} color="#7047EE" /></Pressable>)}

    <Text style={styles.sectionTitle}>Needs follow-up</Text>
    {followUps.length === 0 ? <View style={styles.emptyChat}><Ionicons name="refresh-circle-outline" size={28} color="#19A47B" /><Text style={styles.settingTitle}>Nothing needs follow-up</Text><Text style={styles.muted}>Open a shared appointment and choose “Add to follow-up” when it needs another step.</Text></View> : followUps.map((item: SharedFollowUp) => {
      const event = Array.isArray(item.event) ? item.event[0] : item.event;
      return <View key={item.id} style={styles.highlightRow}><Text style={styles.highlightTime}>{item.due_at ? new Date(item.due_at).toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase() : 'OPEN'}</Text><View style={styles.flex}><Text style={styles.highlightText}>{event?.title || 'Appointment follow-up'}</Text><Text style={styles.muted}>{item.note || 'Check the outcome and capture the next step'}{event?.location ? ` · ${event.location}` : ''}</Text></View><Pressable accessibilityLabel={`Complete follow-up for ${event?.title || 'appointment'}`} onPress={() => onCompleteFollowUp(item.id)} style={styles.checkCircle}><Ionicons name="checkmark" size={16} color="#19A47B" /></Pressable></View>;
    })}
  </ScrollView>;
}

function IntegrationsScreen({ styles, connected, onConnect }: any) {
  const items = [
    { name: 'iOS Notifications', icon: 'phone-portrait-outline', color: '#7C4DFF', detail: 'Daily syncs, week-ahead briefings, and reminders' },
    { name: 'Family Inbox', icon: 'mail-unread-outline', color: '#FF7A2E', detail: 'Forward school and appointment email into a review queue' },
    { name: 'Family Places', icon: 'location-outline', color: '#19A47B', detail: 'Consent-first phone location and arrival or departure alerts' },
    { name: 'Apple Calendar', icon: 'calendar-outline', color: '#2257F4', detail: 'Read and write approved family events' },
    { name: 'Google Calendar', icon: 'logo-google', color: '#19A47B', detail: 'Import selected calendars with per-calendar controls' },
    { name: 'Outlook', icon: 'mail-outline', color: '#2257F4', detail: 'Calendar and forwarded-email connection' },
    { name: 'Instacart', icon: 'basket-outline', color: '#19A47B', detail: 'Live local products, pricing, shopping lists, and checkout' },
    { name: 'OpenTable', icon: 'restaurant-outline', color: '#D7550D', detail: 'Restaurant discovery and confirmed reservation handoff' },
    { name: 'Skylight', icon: 'cloud-outline', color: '#FF7A2E', detail: 'Migration bridge for existing family schedules' },
  ];
  return <ScrollView contentContainerStyle={styles.scrollContent}><LinearGradient colors={['#24116D', '#6648EF']} style={styles.automationCard}><Ionicons name="flash" size={23} color="#fff" /><View style={styles.flex}><Text style={styles.automationLabel}>REVIEW FIRST</Text><Text style={styles.automationTitle}>Coh suggests events from email. A family member approves before anything reaches the calendar.</Text></View></LinearGradient>{items.map(({ name, icon, color, detail }) => <View key={name} style={styles.integrationRow}><View style={[styles.integrationIcon, { backgroundColor: `${color}18` }]}><Ionicons name={icon as any} size={23} color={color} /></View><View style={styles.flex}><Text style={styles.integrationTitle}>{name}</Text><Text style={styles.muted}>{detail}</Text></View><Pressable onPress={() => onConnect(name)} style={[styles.connectButton, connected[name] && styles.connectedButton]}><Text style={[styles.connectText, connected[name] && styles.connectedText]}>{connected[name] ? 'Connected' : name === 'iOS Notifications' ? 'Enable' : 'Set up'}</Text></Pressable></View>)}</ScrollView>;
}

function SettingsScreen({ styles, dark, onTheme, onNotifications, onFamily, onPrivacy, profiles }: any) {
  return <ScrollView contentContainerStyle={styles.scrollContent}><Text style={styles.sectionTitle}>Household</Text><Pressable onPress={onFamily} style={styles.settingRow}><Ionicons name="people-outline" size={21} color="#2257F4" /><View style={styles.flex}><Text style={styles.settingTitle}>Family profiles</Text><Text style={styles.muted}>{profiles.length} people · names, photos, DOB, roles, and bios</Text></View><Ionicons name="chevron-forward" size={18} color={styles.iconColor.color} /></Pressable><Text style={styles.sectionTitle}>Preferences</Text><View style={styles.settingRow}><Ionicons name="moon-outline" size={21} color="#7C4DFF" /><View style={styles.flex}><Text style={styles.settingTitle}>Dark mode</Text><Text style={styles.muted}>Use the darker Coho theme</Text></View><Switch value={dark} onValueChange={onTheme} trackColor={{ true: '#6687FF' }} /></View><Pressable onPress={onNotifications} style={styles.settingRow}><Ionicons name="notifications-outline" size={21} color="#FF7A2E" /><View style={styles.flex}><Text style={styles.settingTitle}>Smart notifications</Text><Text style={styles.muted}>Enable reminders and daily recaps</Text></View><Ionicons name="chevron-forward" size={18} color={styles.iconColor.color} /></Pressable><Pressable onPress={onPrivacy} style={styles.settingRow}><Ionicons name="shield-checkmark-outline" size={21} color="#19A47B" /><View style={styles.flex}><Text style={styles.settingTitle}>Privacy and family data</Text><Text style={styles.muted}>Secure exports and in-app account deletion</Text></View><Ionicons name="chevron-forward" size={18} color={styles.iconColor.color} /></Pressable></ScrollView>;
}

function BottomTabs({ tab, setTab, styles }: any) {
  const tabs = [['Today', 'sparkles'], ['Calendar', 'calendar'], ['Chores', 'checkbox'], ['Chat', 'chatbubble-ellipses'], ['More', 'grid']];
  return <View style={styles.tabBar}>{tabs.map(([name, icon]) => <Pressable key={name} onPress={() => setTab(name)} style={styles.tabItem}><View style={[styles.tabIconWrap, tab === name && styles.tabIconActive]}><Ionicons name={(tab === name ? icon : `${icon}-outline`) as any} size={21} color={tab === name ? '#fff' : styles.iconColor.color} /></View><Text style={[styles.tabLabel, tab === name && styles.tabLabelActive]}>{name}</Text></Pressable>)}</View>;
}

function EventDetailModal({ event, styles, dark, onClose, onFollowUp }: { event: BotEvent | null; styles: any; dark: boolean; onClose: () => void; onFollowUp: (event: BotEvent) => void }) {
  if (!event) return null;
  const openDirections = () => {
    if (!event.place) return;
    const query = encodeURIComponent(event.place);
    void Linking.openURL(Platform.OS === 'ios' ? `http://maps.apple.com/?q=${query}` : `https://www.google.com/maps/search/?api=1&query=${query}`);
  };
  return <Modal visible transparent animationType="slide" onRequestClose={onClose}><View style={styles.modalBackdrop}><Pressable style={styles.modalDismiss} onPress={onClose} /><View style={styles.modalSheet}><View style={styles.modalHandle} /><View style={styles.modalHead}><View style={styles.flex}><Text style={styles.eyebrow}>FAMILY EVENT</Text><Text style={styles.modalTitle}>{event.title}</Text>{event.provider && <Text style={[styles.eventDetailSource, { color: calendarSourceColor(event.provider) }]}>{calendarSourceLabel(event.provider)}{event.sourceCalendarId ? ' · Connected calendar' : ''}{event.recurrenceRule ? ' · Recurring' : ''}</Text>}</View><Pressable onPress={onClose} style={styles.iconButton}><Ionicons name="close" size={21} color={styles.iconColor.color} /></Pressable></View><View style={styles.eventDetailRow}><Ionicons name="calendar-outline" size={20} color="#2257F4" /><View><Text style={styles.settingTitle}>{event.day}</Text><Text style={styles.muted}>{event.time}</Text></View></View><View style={styles.eventDetailRow}><Ionicons name="person-outline" size={20} color="#7047EE" /><Text style={styles.settingTitle}>{event.person}</Text></View>{event.place && <Pressable accessibilityRole="button" accessibilityLabel={`Open directions to ${event.place}`} onPress={openDirections} style={styles.eventDetailRow}><Ionicons name="location-outline" size={20} color="#19A47B" /><View style={styles.flex}><Text style={styles.settingTitle}>{event.place}</Text><Text style={styles.link}>Open directions</Text></View><Ionicons name="open-outline" size={18} color="#2257F4" /></Pressable>}{event.reminder && <View style={styles.eventDetailRow}><Ionicons name="notifications-outline" size={20} color="#FF7A2E" /><Text style={styles.settingTitle}>{event.reminder}-minute reminder</Text></View>}<Pressable onPress={() => onFollowUp(event)} style={styles.outlineAction}><Ionicons name="refresh-circle-outline" size={19} color="#19A47B" /><Text style={[styles.outlineActionText, { color: '#168866' }]}>Add to weekly follow-up</Text></Pressable><Pressable onPress={onClose} style={styles.saveButton}><Text style={styles.saveButtonText}>Done</Text></Pressable></View><StatusBar style={dark ? 'light' : 'dark'} /></View></Modal>;
}

function SecondUserWelcomeModal({
  visible,
  householdName,
  styles,
  dark,
  notificationsEnabled,
  onEnableNotifications,
  onContinue,
}: {
  visible: boolean;
  householdName: string;
  styles: any;
  dark: boolean;
  notificationsEnabled: boolean;
  onEnableNotifications: () => Promise<void>;
  onContinue: (destination: 'family' | 'coh' | 'today') => Promise<void>;
}) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <SafeAreaView style={styles.welcomePage}>
        <ScrollView contentContainerStyle={styles.welcomeContent}>
          <LinearGradient colors={['#24116D', '#7047EE']} style={styles.welcomeHero}>
            <View style={styles.welcomeMark}><Ionicons name="home" size={28} color="#7047EE" /></View>
            <Text style={styles.recapHeroLabel}>YOU’RE IN</Text>
            <Text style={styles.welcomeTitle}>Welcome to {householdName}.</Text>
            <Text style={styles.welcomeText}>Everything here is live. Updates from another family member appear automatically—no refreshing, forwarding, or setup help required.</Text>
          </LinearGradient>
          {[
            ['chatbubbles-outline', '#2257F4', 'Family chat stays human', 'Messages with the family live in Family chat. Coh has a separate private workspace, so assistant replies never flood the conversation.'],
            ['checkmark-circle-outline', '#19A47B', 'Assignments come to you', 'Open an alert to the exact event, chore, follow-up, message, or Family Inbox item. Accept and complete work from the same screen.'],
            ['sparkles-outline', '#7047EE', 'Coh works for you too', 'Ask questions, share screenshots or PDFs, speak a request, correct details, and approve actions without depending on the household owner.'],
          ].map(([icon, color, title, detail]) => (
            <View key={title} style={styles.welcomeRow}>
              <View style={[styles.integrationIcon, { backgroundColor: `${color}18` }]}><Ionicons name={icon as any} size={22} color={color} /></View>
              <View style={styles.flex}><Text style={styles.settingTitle}>{title}</Text><Text style={styles.muted}>{detail}</Text></View>
            </View>
          ))}
          <View style={styles.welcomeAlertCard}>
            <Ionicons name={notificationsEnabled ? 'checkmark-circle' : 'notifications'} size={22} color={notificationsEnabled ? '#19A47B' : '#FF7A2E'} />
            <View style={styles.flex}><Text style={styles.settingTitle}>{notificationsEnabled ? 'Alerts are ready' : 'Turn on family alerts'}</Text><Text style={styles.muted}>Assignment, reminder, completion, Family Inbox, daily sync, and week-ahead alerts open the correct item.</Text></View>
            {!notificationsEnabled && <Pressable onPress={() => void onEnableNotifications()} style={styles.welcomeEnableButton}><Text style={styles.welcomeEnableText}>Enable</Text></Pressable>}
          </View>
          <Pressable onPress={() => void onContinue('family')} style={styles.saveButton}><Ionicons name="chatbubbles" size={18} color="#fff" /><Text style={styles.saveButtonText}>Open family chat</Text></Pressable>
          <View style={styles.welcomeActions}>
            <Pressable onPress={() => void onContinue('coh')} style={styles.secondaryWelcomeButton}><Ionicons name="sparkles" size={17} color="#7047EE" /><Text style={styles.secondaryWelcomeText}>Try Coh privately</Text></Pressable>
            <Pressable onPress={() => void onContinue('today')} style={styles.secondaryWelcomeButton}><Text style={styles.secondaryWelcomeText}>Go to Today</Text></Pressable>
          </View>
        </ScrollView>
        <StatusBar style={dark ? 'light' : 'dark'} />
      </SafeAreaView>
    </Modal>
  );
}

function ChoreEditorModal({
  chore,
  profiles,
  styles,
  dark,
  onClose,
  onSave,
  onDelete,
}: {
  chore: Chore | null;
  profiles: FamilyProfile[];
  styles: any;
  dark: boolean;
  onClose: () => void;
  onSave: (choreId: string, draft: ChoreFormValue) => Promise<void>;
  onDelete: (chore: Chore) => void;
}) {
  const [draft, setDraft] = useState<ChoreFormValue>(() => defaultChoreForm(profiles, null));
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (chore) setDraft(choreToForm(chore, profiles));
  }, [chore, profiles]);
  if (!chore) return null;
  const invalid = !draft.title.trim() || (draft.rewardId === 'choice' && !draft.rewardLabel.trim());
  const save = async () => {
    if (invalid || saving) return;
    setSaving(true);
    try {
      await onSave(chore.id, draft);
    } finally {
      setSaving(false);
    }
  };
  return <Modal visible transparent animationType="slide" onRequestClose={onClose}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
      <Pressable style={styles.modalDismiss} onPress={onClose} />
      <View style={[styles.modalSheet, styles.choreModalSheet]}>
        <View style={styles.modalHandle} />
        <View style={styles.modalHead}>
          <View style={styles.flex}><Text style={styles.eyebrow}>CHORE DETAILS</Text><Text style={styles.modalTitle}>Edit chore</Text><Text style={styles.muted}>Update the owner, schedule, repeat pattern, reminder, and reward.</Text></View>
          <Pressable onPress={onClose} style={styles.iconButton}><Ionicons name="close" size={21} color={styles.iconColor.color} /></Pressable>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.choreFormContent}>
          <ChoreFormFields value={draft} onChange={setDraft} profiles={profiles} styles={styles} dark={dark} autoFocus={false} />
          <Pressable disabled={invalid || saving} onPress={() => void save()} style={[styles.saveButton, (invalid || saving) && styles.disabled]}>
            <Text style={styles.saveButtonText}>{saving ? 'Saving…' : 'Save chore'}</Text>
          </Pressable>
          <Pressable disabled={saving} onPress={() => onDelete(chore)} style={styles.deleteChoreButton}>
            <Ionicons name="trash-outline" size={17} color="#D64545" /><Text style={styles.deleteChoreText}>Delete chore</Text>
          </Pressable>
        </ScrollView>
      </View>
      <StatusBar style={dark ? 'light' : 'dark'} />
    </KeyboardAvoidingView>
  </Modal>;
}

function QuickAddModal({
  visible,
  onClose,
  styles,
  type,
  setType,
  title,
  setTitle,
  details,
  setDetails,
  profiles,
  currentUserId,
  saving,
  onSave,
  dark,
}: any) {
  const [choreDraft, setChoreDraft] = useState<ChoreFormValue>(() => defaultChoreForm(profiles, currentUserId));
  useEffect(() => {
    if (visible && type === 'Chore') {
      setChoreDraft(defaultChoreForm(profiles, currentUserId, title, details));
    }
  }, [visible, type]);
  const updateChore = (next: ChoreFormValue) => {
    setChoreDraft(next);
    setTitle(next.title);
    setDetails(next.details);
  };
  const invalidChore = !choreDraft.title.trim() || (choreDraft.rewardId === 'choice' && !choreDraft.rewardLabel.trim());
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
      <Pressable style={styles.modalDismiss} onPress={onClose} />
      <View style={[styles.modalSheet, type === 'Chore' && styles.choreModalSheet]}>
        <View style={styles.modalHandle} />
        <View style={styles.modalHead}>
          <View><Text style={styles.eyebrow}>QUICK ADD</Text><Text style={styles.modalTitle}>Share with the family</Text></View>
          <Pressable onPress={onClose} style={styles.iconButton}><Ionicons name="close" size={21} color={styles.iconColor.color} /></Pressable>
        </View>
        <View style={styles.typeTabs}>{['Event', 'Chore', 'Note', 'Message'].map((item) => <Pressable key={item} onPress={() => setType(item)} style={[styles.typeTab, type === item && styles.typeTabActive]}><Text style={[styles.typeTabText, type === item && styles.typeTabTextActive]}>{item}</Text></Pressable>)}</View>
        {type === 'Chore' ? <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.choreFormContent}>
          <ChoreFormFields value={choreDraft} onChange={updateChore} profiles={profiles} styles={styles} dark={dark} autoFocus />
          <Pressable disabled={invalidChore || saving} onPress={() => void onSave(choreDraft)} style={[styles.saveButton, (invalidChore || saving) && styles.disabled]}>
            <Text style={styles.saveButtonText}>{saving ? 'Adding chore…' : 'Add chore'}</Text>
          </Pressable>
        </ScrollView> : <>
          <Text style={styles.fieldLabel}>{type} title</Text>
          <TextInput value={title} onChangeText={setTitle} autoFocus placeholder={`Add a ${type.toLowerCase()}…`} placeholderTextColor="#8B93A5" style={styles.modalInput} />
          <Text style={styles.fieldLabel}>Details</Text>
          <TextInput value={details} onChangeText={setDetails} multiline placeholder="Location, instructions, links, or anything the family should know" placeholderTextColor="#8B93A5" style={[styles.modalInput, styles.modalTextArea]} />
          <Pressable disabled={!title.trim()} onPress={() => void onSave()} style={[styles.saveButton, !title.trim() && styles.disabled]}><Text style={styles.saveButtonText}>{type === 'Event' ? 'Continue with Coh' : `Add ${type.toLowerCase()}`}</Text></Pressable>
        </>}
      </View>
      <StatusBar style={dark ? 'light' : 'dark'} />
    </KeyboardAvoidingView>
  </Modal>;
}

function ChoreFormFields({
  value,
  onChange,
  profiles,
  styles,
  dark,
  autoFocus,
}: {
  value: ChoreFormValue;
  onChange: (next: ChoreFormValue) => void;
  profiles: FamilyProfile[];
  styles: any;
  dark: boolean;
  autoFocus?: boolean;
}) {
  const reward = choreRewardMeta(value.rewardId);
  const reminderOptions: Array<{ value: number | null; label: string }> = [
    { value: null, label: 'None' },
    { value: 0, label: 'At due time' },
    { value: 15, label: '15 min' },
    { value: 30, label: '30 min' },
    { value: 60, label: '1 hour' },
    { value: 1440, label: '1 day' },
  ];
  return <>
    <Text style={styles.fieldLabel}>CHORE</Text>
    <TextInput value={value.title} onChangeText={(title) => onChange({ ...value, title })} autoFocus={autoFocus} placeholder="What needs to get done?" placeholderTextColor="#8B93A5" style={styles.modalInput} />

    <Text style={styles.fieldLabel}>OWNER</Text>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choreOwnerChoices}>
      <Pressable onPress={() => onChange({ ...value, assignedPersonId: null })} style={[styles.choreOwnerChip, value.assignedPersonId === null && styles.choreOwnerChipActive]}>
        <Ionicons name="people-outline" size={16} color={value.assignedPersonId === null ? '#fff' : styles.iconColor.color} />
        <Text style={[styles.choreOwnerText, value.assignedPersonId === null && styles.choreOwnerTextActive]}>Unassigned</Text>
      </Pressable>
      {profiles.map((profile) => {
        const active = value.assignedPersonId === profile.id;
        return <Pressable key={profile.id} onPress={() => onChange({ ...value, assignedPersonId: profile.id })} style={[styles.choreOwnerChip, active && styles.choreOwnerChipActive]}>
          <View style={[styles.choreOwnerAvatar, { backgroundColor: active ? '#fff' : profile.color }]}><Text style={[styles.avatarText, { color: active ? '#2257F4' : profile.ink }]}>{initials(profile.name)}</Text></View>
          <Text style={[styles.choreOwnerText, active && styles.choreOwnerTextActive]}>{profile.name}</Text>
        </Pressable>;
      })}
    </ScrollView>

    <Text style={styles.fieldLabel}>DUE DATE & TIME</Text>
    <View style={styles.choreDateRow}>
      <View style={styles.choreDateField}><Ionicons name="calendar-outline" size={18} color="#2257F4" /><DateTimePicker value={value.dueAt} mode="date" display={Platform.OS === 'ios' ? 'compact' : 'default'} themeVariant={dark ? 'dark' : 'light'} onChange={(_, next) => next && onChange({ ...value, dueAt: mergeChoreDate(value.dueAt, next, 'date') })} /></View>
      <View style={styles.choreDateField}><Ionicons name="time-outline" size={18} color="#7047EE" /><DateTimePicker value={value.dueAt} mode="time" minuteInterval={5} display={Platform.OS === 'ios' ? 'compact' : 'default'} themeVariant={dark ? 'dark' : 'light'} onChange={(_, next) => next && onChange({ ...value, dueAt: mergeChoreDate(value.dueAt, next, 'time') })} /></View>
    </View>

    <Text style={styles.fieldLabel}>REPEAT</Text>
    <View style={styles.choreOptionWrap}>{choreRepeatOptions.map((option) => {
      const active = value.recurrence === option.id;
      return <Pressable key={option.id} onPress={() => onChange({ ...value, recurrence: option.id })} style={[styles.choiceChip, active && styles.choiceChipActive]}><Text style={[styles.choiceChipText, active && styles.choiceChipTextActive]}>{option.label}</Text></Pressable>;
    })}</View>

    <Text style={styles.fieldLabel}>REMINDER</Text>
    <View style={styles.choreOptionWrap}>{reminderOptions.map((option) => {
      const active = value.reminderMinutes === option.value;
      return <Pressable key={option.label} onPress={() => onChange({ ...value, reminderMinutes: option.value })} style={[styles.choiceChip, active && styles.choiceChipActive]}><Text style={[styles.choiceChipText, active && styles.choiceChipTextActive]}>{option.label}</Text></Pressable>;
    })}</View>

    <Text style={styles.fieldLabel}>REWARD</Text>
    <View style={styles.rewardModalGrid}>{choreRewardOptions.map((option) => {
      const active = value.rewardId === option.id;
      return <Pressable key={option.id} onPress={() => onChange({ ...value, rewardId: option.id, rewardValue: option.presets[0] })} style={[styles.rewardModalChoice, active && { borderColor: option.color, backgroundColor: `${option.color}12` }]}>
        <Ionicons name={option.icon as any} size={20} color={option.color} /><Text style={styles.choiceChipText}>{option.title}</Text>
      </Pressable>;
    })}</View>
    {value.rewardId === 'choice' ? <>
      <Text style={styles.fieldLabel}>CUSTOM REWARD</Text>
      <TextInput value={value.rewardLabel} onChangeText={(rewardLabel) => onChange({ ...value, rewardLabel })} placeholder="Example: Pick Friday’s movie" placeholderTextColor="#8B93A5" style={styles.modalInput} />
    </> : <>
      <Text style={styles.fieldLabel}>{rewardValueLabel(value.rewardId)}</Text>
      <View style={styles.rewardValueRow}>{reward.presets.map((amount) => {
        const active = value.rewardValue === amount;
        return <Pressable key={amount} onPress={() => onChange({ ...value, rewardValue: amount })} style={[styles.choiceChip, active && { backgroundColor: reward.color, borderColor: reward.color }]}><Text style={[styles.choiceChipText, active && styles.choiceChipTextActive]}>{rewardPresetLabel(value.rewardId, amount)}</Text></Pressable>;
      })}</View>
      <TextInput value={String(value.rewardValue)} onChangeText={(amount) => onChange({ ...value, rewardValue: Math.max(0, Number(amount.replace(/[^0-9.]/g, '')) || 0) })} keyboardType="decimal-pad" placeholder="Custom amount" placeholderTextColor="#8B93A5" style={[styles.modalInput, styles.choreRewardInput]} />
    </>}

    <Text style={styles.fieldLabel}>INSTRUCTIONS</Text>
    <TextInput value={value.details} onChangeText={(details) => onChange({ ...value, details })} multiline placeholder="Where, how, supplies needed, or anything the owner should know" placeholderTextColor="#8B93A5" style={[styles.modalInput, styles.modalTextArea]} />
    <View style={styles.choreSummaryCard}><Ionicons name="checkmark-circle-outline" size={20} color="#19A47B" /><Text style={styles.choreSummaryText}>{choreFormSummary(value, profiles)}</Text></View>
  </>;
}

function ShareToCohModal({ visible, styles, dark, value, onChange, hasImage, error, onCancel, onApprove }: any) {
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
      <Pressable style={styles.modalDismiss} onPress={onCancel} />
      <View style={styles.modalSheet}>
        <View style={styles.modalHandle} />
        <View style={styles.modalHead}>
          <View style={styles.flex}><Text style={styles.eyebrow}>ONLY THIS ITEM</Text><Text style={styles.modalTitle}>Share to Coh</Text></View>
          <Pressable accessibilityLabel="Cancel sharing" onPress={onCancel} style={styles.iconButton}><Ionicons name="close" size={21} color={styles.iconColor.color} /></Pressable>
        </View>
        <View style={styles.privacyCard}><Ionicons name="shield-checkmark" size={20} color="#19A47B" /><Text style={styles.privacyText}>Coh receives only what you selected—not the conversation. The shared content is discarded if you cancel.</Text></View>
        {hasImage && <View style={styles.sharedAttachment}><Ionicons name="image-outline" size={20} color="#7047EE" /><View style={styles.flex}><Text style={styles.settingTitle}>Attachment ready for Coh</Text><Text style={styles.muted}>Coh can read screenshots, PDFs, text, calendar files, and supported audio after you approve this share.</Text></View></View>}
        <Text style={styles.fieldLabel}>REVIEW OR EDIT BEFORE SENDING</Text>
        <TextInput value={value} onChangeText={onChange} multiline placeholder={hasImage ? 'Example: Haircut for Chad Wednesday at 9:30 AM' : 'Selected text or link'} placeholderTextColor="#8B93A5" style={[styles.modalInput, styles.sharePreviewInput]} />
        {error && <Text style={styles.shareError}>The shared item could not be read. Nothing has been saved.</Text>}
        <View style={styles.shareActions}><Pressable onPress={onCancel} style={styles.cancelButton}><Text style={styles.cancelButtonText}>Cancel</Text></Pressable><Pressable onPress={onApprove} style={styles.approveButton}><Ionicons name="sparkles" size={16} color="#fff" /><Text style={styles.saveButtonText}>Ask Coh</Text></Pressable></View>
      </View>
      <StatusBar style={dark ? 'light' : 'dark'} />
    </KeyboardAvoidingView>
  </Modal>;
}

function createTheme(dark: boolean) {
  return dark ? { dark: true, canvas: '#101624', surface: '#171F30', surfaceStrong: '#1D273A', text: '#F7F8FC', muted: '#AEB8CB', line: '#2B3850', primary: '#6687FF' } : { dark: false, canvas: '#FFF8E9', surface: '#FFFDF8', surfaceStrong: '#FFFFFF', text: '#14213D', muted: '#6D7486', line: '#EADFC9', primary: '#2257F4' };
}

function createStyles(t: Theme) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: t.canvas }, app: { flex: 1, backgroundColor: t.canvas }, screen: { flex: 1 }, flex: { flex: 1 }, iconColor: { color: t.muted },
    header: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line },
    headerTitleWrap: { flexDirection: 'row', alignItems: 'center', flex: 1 }, backButton: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: t.surface, marginRight: 8 },
    eyebrow: { color: t.primary, fontSize: 9, fontWeight: '800', letterSpacing: 1.1, marginBottom: 4 }, headerTitle: { color: t.text, fontSize: 30, fontWeight: '800', letterSpacing: -1.4, lineHeight: 31 }, headerButtons: { flexDirection: 'row', gap: 8 },
    iconButton: { width: 42, height: 42, borderRadius: 14, borderWidth: 1, borderColor: t.line, backgroundColor: t.surface, alignItems: 'center', justifyContent: 'center' }, recapHeaderButton: { width: 42, height: 42, borderRadius: 14, backgroundColor: '#7047EE', alignItems: 'center', justifyContent: 'center', shadowColor: '#7047EE', shadowOpacity: .35, shadowRadius: 10 }, addButton: { width: 43, height: 43, borderRadius: 15, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center', shadowColor: t.primary, shadowOpacity: .26, shadowRadius: 10, shadowOffset: { width: 0, height: 6 } },
    scrollContent: { padding: 18, paddingBottom: 32, gap: 12 }, sectionHead: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 4 }, sectionTitle: { color: t.text, fontSize: 20, fontWeight: '800', letterSpacing: -.5, marginTop: 10 }, muted: { color: t.muted, fontSize: 11, lineHeight: 15 }, link: { color: t.primary, fontSize: 11, fontWeight: '700' },
    bentoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, bentoCard: { width: '48.5%', minHeight: 190, borderRadius: 22, padding: 15, backgroundColor: t.surfaceStrong, borderWidth: 1, borderColor: t.line, shadowColor: '#392B14', shadowOpacity: t.dark ? .24 : .07, shadowRadius: 12, shadowOffset: { width: 0, height: 7 } },
    cardIcon: { width: 43, height: 43, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 14 }, cardTitle: { color: t.text, fontSize: 14, fontWeight: '800' }, cardValue: { color: t.text, fontSize: 21, fontWeight: '800', letterSpacing: -.7, marginTop: 3 }, cardDetail: { color: t.muted, fontSize: 9, marginTop: 4, minHeight: 26 }, cardPill: { alignSelf: 'flex-start', flexDirection: 'row', gap: 4, alignItems: 'center', borderRadius: 99, paddingHorizontal: 8, paddingVertical: 6, marginTop: 'auto' }, cardPillText: { fontSize: 8, fontWeight: '700' },
    recapCard: { minHeight: 88, borderRadius: 21, padding: 15, flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 2 }, recapIcon: { width: 43, height: 43, borderRadius: 14, backgroundColor: '#FFFFFF24', alignItems: 'center', justifyContent: 'center' }, recapCopy: { flex: 1 }, recapLabel: { color: '#FFFFFFB5', fontSize: 7, fontWeight: '800', letterSpacing: 1 }, recapTitle: { color: '#fff', fontSize: 13, fontWeight: '800', marginTop: 2 }, recapText: { color: '#FFFFFFB8', fontSize: 9, lineHeight: 13, marginTop: 2 },
    familyRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, borderRadius: 20, padding: 13 }, familyPerson: { width: '24%', alignItems: 'center' }, avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }, avatarText: { color: '#2257F4', fontSize: 11, fontWeight: '800' }, familyName: { color: t.text, fontSize: 10, fontWeight: '700', marginTop: 6 }, familyStatus: { color: t.muted, fontSize: 8, marginTop: 2 },
    upcomingRow: { minHeight: 63, borderRadius: 17, borderWidth: 1, borderColor: t.line, backgroundColor: t.surface, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 11 }, dateTile: { width: 43, height: 44, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center' }, dateMonth: { fontSize: 7, fontWeight: '800' }, dateNumber: { fontSize: 18, fontWeight: '800', lineHeight: 19 }, upcomingTime: { color: t.muted, fontSize: 8, fontWeight: '700' }, upcomingTitle: { color: t.text, fontSize: 11, fontWeight: '700', marginTop: 3 },
    tabBar: { minHeight: 68, paddingTop: 7, paddingBottom: Platform.OS === 'ios' ? 5 : 8, paddingHorizontal: 7, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.line, backgroundColor: t.surfaceStrong, flexDirection: 'row', justifyContent: 'space-around' }, tabItem: { flex: 1, alignItems: 'center', gap: 3 }, tabIconWrap: { width: 38, height: 32, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, tabIconActive: { backgroundColor: t.primary }, tabLabel: { color: t.muted, fontSize: 8, fontWeight: '700' }, tabLabelActive: { color: t.primary },
    toast: { position: 'absolute', left: 18, right: 18, bottom: 78, minHeight: 50, borderRadius: 16, paddingHorizontal: 14, backgroundColor: t.surfaceStrong, borderWidth: 1, borderColor: t.line, flexDirection: 'row', alignItems: 'center', gap: 8, shadowColor: '#000', shadowOpacity: .16, shadowRadius: 16, shadowOffset: { width: 0, height: 7 } }, toastText: { color: t.text, fontSize: 11, fontWeight: '700', flex: 1 },
    calendarTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14 }, smallButton: { width: 38, height: 38, borderRadius: 12, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, alignItems: 'center', justifyContent: 'center' }, calendarPeriod: { color: t.text, fontWeight: '800', fontSize: 15, textAlign: 'center' }, calendarTodayLink: { color: t.primary, fontSize: 8, fontWeight: '800', textAlign: 'center', marginTop: 2 }, weekRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: t.surface, borderRadius: 18, borderWidth: 1, borderColor: t.line, padding: 7 }, dayBubble: { width: 40, height: 58, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, dayBubbleActive: { backgroundColor: t.primary }, dayLabel: { color: t.muted, fontSize: 7, fontWeight: '800' }, dayNumber: { color: t.text, fontSize: 17, fontWeight: '800', marginTop: 3 }, dayTextActive: { color: '#fff' }, timelineRow: { minHeight: 76, borderRadius: 18, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10 }, timelineLine: { width: 4, height: 42, borderRadius: 3 }, timelineTime: { color: t.muted, fontSize: 10, width: 50, fontWeight: '700' }, timelineTitle: { color: t.text, fontSize: 13, fontWeight: '800' }, eventSourceTitleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }, eventSourcePill: { borderRadius: 99, paddingHorizontal: 7, paddingVertical: 3 }, eventSourceText: { fontSize: 7, fontWeight: '900', letterSpacing: .3 }, eventDetailSource: { fontSize: 9, fontWeight: '800', marginTop: 4 }, syncCard: { minHeight: 67, borderRadius: 18, padding: 13, flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: `${t.primary}0C`, borderWidth: 1, borderColor: `${t.primary}24` }, syncTitle: { color: t.text, fontSize: 11, fontWeight: '800' },
    progressCard: { minHeight: 130, borderRadius: 23, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, padding: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, progressLabel: { color: t.primary, fontSize: 8, fontWeight: '800', letterSpacing: 1 }, progressValue: { color: t.text, fontSize: 28, fontWeight: '800', letterSpacing: -1, marginTop: 5 }, progressRing: { width: 74, height: 74, borderRadius: 37, borderWidth: 8, borderColor: '#19A47B', alignItems: 'center', justifyContent: 'center' }, progressPercent: { color: t.text, fontSize: 16, fontWeight: '800' }, memberRewardTabs: { flexDirection: 'row', padding: 4, borderRadius: 16, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line }, memberRewardTab: { flex: 1, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, memberRewardTabActive: { backgroundColor: t.primary }, memberRewardName: { color: t.text, fontSize: 10, fontWeight: '800' }, memberRewardNameActive: { color: '#fff' }, memberRewardPoints: { color: t.muted, fontSize: 8, marginTop: 2, fontWeight: '700' }, rewardHero: { minHeight: 118, borderRadius: 21, padding: 16, flexDirection: 'row', gap: 13, alignItems: 'center', backgroundColor: t.surface, borderWidth: 1, borderColor: t.line }, rewardIcon: { width: 52, height: 52, borderRadius: 17, alignItems: 'center', justifyContent: 'center' }, rewardHeroTitle: { color: t.text, fontSize: 14, lineHeight: 19, fontWeight: '800', marginTop: 4 }, rewardProgressTrack: { height: 7, borderRadius: 4, backgroundColor: t.line, overflow: 'hidden', marginTop: 10 }, rewardProgressFill: { height: 7, borderRadius: 4 }, rewardProgressText: { color: t.muted, fontSize: 8, fontWeight: '700', marginTop: 5 }, rewardPrompt: { color: t.text, fontSize: 12, fontWeight: '800', marginTop: 2 }, rewardChoices: { gap: 10, paddingRight: 18 }, rewardChoice: { width: 145, minHeight: 130, borderRadius: 18, padding: 14, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line }, rewardChoiceTitle: { color: t.text, fontSize: 12, fontWeight: '800', marginTop: 11, marginBottom: 3 }, rewardCost: { fontSize: 9, fontWeight: '800', marginTop: 10 }, rewardSelected: { position: 'absolute', right: 10, top: 10 }, choreRow: { minHeight: 70, borderRadius: 17, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }, checkCircle: { width: 27, height: 27, borderRadius: 14, borderWidth: 2, borderColor: t.line, alignItems: 'center', justifyContent: 'center' }, choreTitle: { color: t.text, fontSize: 13, fontWeight: '800' }, struck: { textDecorationLine: 'line-through', color: t.muted }, pointPill: { minHeight: 27, borderRadius: 14, paddingHorizontal: 8, flexDirection: 'row', gap: 4, alignItems: 'center', backgroundColor: '#7047EE14' }, pointPillText: { color: '#7047EE', fontSize: 9, fontWeight: '900' }, ownerDot: { width: 9, height: 9, borderRadius: 5 }, outlineAction: { minHeight: 48, borderRadius: 15, borderWidth: 1, borderStyle: 'dashed', borderColor: t.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }, outlineActionText: { color: t.primary, fontSize: 11, fontWeight: '800' },
    messageList: { padding: 18, paddingBottom: 24, gap: 16 }, chatHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line }, homeThreadIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: `${t.primary}14`, alignItems: 'center', justifyContent: 'center' }, chatTitle: { color: t.text, fontSize: 14, fontWeight: '800' }, botHint: { minHeight: 48, borderRadius: 15, paddingHorizontal: 12, marginBottom: 5, flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: '#7047EE12', borderWidth: 1, borderColor: '#7047EE30' }, botHintText: { color: t.text, fontSize: 10, lineHeight: 14, flex: 1, fontWeight: '700' }, messageWrap: { maxWidth: '88%', flexDirection: 'row', gap: 8, alignSelf: 'flex-start' }, messageBody: { flexShrink: 1 }, messageMine: { alignSelf: 'flex-end' }, chatAvatar: { width: 32, height: 32, backgroundColor: '#FFE1CF' }, botAvatar: { width: 32, height: 32, backgroundColor: '#7047EE' }, messageAuthor: { color: t.muted, fontSize: 8, marginBottom: 4 }, botAuthor: { color: '#7047EE', fontWeight: '800' }, messageAuthorMine: { textAlign: 'right' }, messageBubble: { backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, borderRadius: 5, borderTopRightRadius: 16, borderBottomLeftRadius: 16, borderBottomRightRadius: 16, padding: 12 }, botBubble: { borderColor: '#7047EE55', backgroundColor: t.dark ? '#251F46' : '#F5F0FF' }, messageBubbleMine: { backgroundColor: t.primary, borderColor: t.primary, borderTopLeftRadius: 16, borderTopRightRadius: 5 }, messageText: { color: t.text, fontSize: 12, lineHeight: 17 }, messageTextMine: { color: '#fff' }, cohMention: { color: '#FFD84D', fontWeight: '900', textShadowColor: '#FFD84D99', textShadowRadius: 8 }, composeRow: { minHeight: 61, paddingHorizontal: 12, paddingVertical: 8, gap: 8, flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.line, backgroundColor: t.surfaceStrong }, composeRowCoh: { borderTopColor: '#A777FF', backgroundColor: t.dark ? '#211A42' : '#F7F0FF', shadowColor: '#7047EE', shadowOpacity: .42, shadowRadius: 16, shadowOffset: { width: 0, height: -3 } }, composePlus: { width: 36, height: 36, borderRadius: 12, backgroundColor: `${t.primary}13`, alignItems: 'center', justifyContent: 'center' }, composeCohBadge: { backgroundColor: '#7047EE', shadowColor: '#A777FF', shadowOpacity: .9, shadowRadius: 10 }, composeInput: { flex: 1, minHeight: 40, maxHeight: 90, borderRadius: 13, borderWidth: 1, borderColor: t.line, backgroundColor: t.surface, color: t.text, paddingHorizontal: 12, fontSize: 12 }, composeInputCoh: { borderColor: '#A777FF', borderWidth: 2, color: t.dark ? '#E8DDFF' : '#4B168D', fontWeight: '800', shadowColor: '#7047EE', shadowOpacity: .5, shadowRadius: 9 }, sendButton: { width: 37, height: 37, borderRadius: 12, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center' }, sendButtonCoh: { backgroundColor: '#7047EE', shadowColor: '#A777FF', shadowOpacity: .9, shadowRadius: 10 },
    moreIntro: { color: t.muted, fontSize: 12, lineHeight: 18, marginBottom: 4 }, moreGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 11 }, moreCard: { width: '48.5%', minHeight: 180, borderRadius: 22, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, padding: 16 }, moreIcon: { width: 45, height: 45, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, moreTitle: { color: t.text, fontSize: 15, fontWeight: '800', marginTop: 17 }, moreDetail: { color: t.muted, fontSize: 9, lineHeight: 14, marginTop: 5, paddingRight: 10 }, moreChevron: { position: 'absolute', right: 14, bottom: 14 },
    familyHero: { minHeight: 116, borderRadius: 22, padding: 18, flexDirection: 'row', alignItems: 'center', backgroundColor: t.surface, borderWidth: 1, borderColor: t.line }, familyHeroTitle: { color: t.text, fontSize: 22, fontWeight: '900', marginTop: 5, marginBottom: 4 }, addProfileButton: { width: 46, height: 46, borderRadius: 15, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center', marginLeft: 'auto' }, profileRow: { minHeight: 88, borderRadius: 19, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line }, profileAvatar: { width: 42, height: 42, borderRadius: 15, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }, profileAvatarLarge: { width: 58, height: 58, borderRadius: 19 }, profileAvatarImage: { width: '100%', height: '100%' }, profileName: { color: t.text, fontSize: 14, fontWeight: '900' }, profileBio: { color: t.muted, fontSize: 9, lineHeight: 13, marginTop: 4 }, profileSheet: { maxHeight: '88%', backgroundColor: t.surfaceStrong, borderTopLeftRadius: 28, borderTopRightRadius: 28 }, profileSheetContent: { paddingHorizontal: 19, paddingTop: 9, paddingBottom: 34 }, photoEditor: { minHeight: 76, borderRadius: 18, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line }, profilePrivacy: { color: t.muted, fontSize: 9, lineHeight: 14, marginTop: 14 },
    searchInput: { height: 45, borderRadius: 15, borderWidth: 1, borderColor: t.line, backgroundColor: t.surface, color: t.text, paddingHorizontal: 14 }, notesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, noteCard: { width: '48.5%', minHeight: 140, borderRadius: 19, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, padding: 15 }, noteEmoji: { fontSize: 24 }, noteTitle: { color: t.text, fontSize: 12, fontWeight: '800', marginTop: 18, marginBottom: 4 }, noteChevron: { position: 'absolute', right: 12, bottom: 12 },
    recapHero: { minHeight: 260, borderRadius: 24, padding: 23, justifyContent: 'center' }, recapHeroLabel: { color: '#FFFFFFB5', fontSize: 8, fontWeight: '800', letterSpacing: 1, marginTop: 13 }, recapHeroTitle: { color: '#fff', fontSize: 28, lineHeight: 31, fontWeight: '800', letterSpacing: -1, marginTop: 8 }, recapHeroText: { color: '#FFFFFFC0', fontSize: 11, lineHeight: 16, marginTop: 8 }, recapActionRow: { flexDirection: 'row', gap: 8, marginTop: 18 }, recapHeroButton: { alignSelf: 'flex-start', minHeight: 38, borderRadius: 12, backgroundColor: '#fff', flexDirection: 'row', gap: 7, alignItems: 'center', paddingHorizontal: 13 }, recapSnapshot: { minHeight: 66, borderRadius: 17, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line }, recapSnapshotActive: { borderColor: '#7047EE88', backgroundColor: t.dark ? '#251F46' : '#F5F0FF' }, recapSnapshotIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#7047EE14' }, recapSnapshotDetail: { borderRadius: 19, padding: 13, gap: 8, backgroundColor: t.surface, borderWidth: 1, borderColor: '#7047EE55' }, listenSnapshot: { alignSelf: 'flex-start', minHeight: 36, borderRadius: 11, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#7047EE12' }, highlightRow: { minHeight: 61, flexDirection: 'row', gap: 11, alignItems: 'center', borderRadius: 16, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, padding: 12 }, highlightTime: { color: t.primary, fontSize: 11, fontWeight: '800', width: 38 }, highlightText: { color: t.text, fontSize: 11, fontWeight: '700', flex: 1 },
    automationCard: { minHeight: 90, borderRadius: 20, padding: 16, flexDirection: 'row', gap: 12, alignItems: 'center' }, automationLabel: { color: '#FFFFFFA8', fontSize: 7, fontWeight: '800', letterSpacing: 1 }, automationTitle: { color: '#fff', fontSize: 12, fontWeight: '800', lineHeight: 17, marginTop: 3 }, integrationRow: { minHeight: 78, borderRadius: 18, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }, integrationIcon: { width: 43, height: 43, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, integrationTitle: { color: t.text, fontSize: 12, fontWeight: '800' }, connectButton: { minHeight: 31, borderRadius: 10, borderWidth: 1, borderColor: t.primary, paddingHorizontal: 9, alignItems: 'center', justifyContent: 'center' }, connectedButton: { borderColor: '#19A47B', backgroundColor: '#19A47B12' }, connectText: { color: t.primary, fontSize: 8, fontWeight: '800' }, connectedText: { color: '#19A47B' },
    chiefHero: { minHeight: 210, borderRadius: 24, padding: 22, justifyContent: 'center' }, chiefBadge: { width: 48, height: 48, borderRadius: 16, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }, chiefHeroTitle: { color: '#fff', fontSize: 28, lineHeight: 32, fontWeight: '800', letterSpacing: -1, marginTop: 5 }, chiefSettingCard: { borderRadius: 19, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, padding: 13, gap: 12 }, settingRowTop: { flexDirection: 'row', alignItems: 'center', gap: 10 }, chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, choiceChip: { minHeight: 34, borderRadius: 11, borderWidth: 1, borderColor: t.line, paddingHorizontal: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: t.surfaceStrong }, choiceChipActive: { backgroundColor: t.primary, borderColor: t.primary }, choiceChipText: { color: t.text, fontSize: 9, fontWeight: '800' }, choiceChipTextActive: { color: '#fff' }, preferenceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 }, preferenceTile: { width: '48.5%', minHeight: 58, borderRadius: 15, padding: 11, flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: t.surface, borderWidth: 1, borderColor: t.line }, preferenceTileActive: { borderColor: '#19A47B55', backgroundColor: '#19A47B0D' }, preferenceText: { color: t.text, fontSize: 10, fontWeight: '700', flex: 1 }, memberChip: { minHeight: 36, borderRadius: 18, borderWidth: 1, borderColor: t.line, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: t.surface }, memberChipActive: { backgroundColor: t.primary, borderColor: t.primary }, followUpCard: { minHeight: 72, borderRadius: 18, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line },
    personSetting: { minHeight: 65, borderRadius: 17, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 10 }, settingRow: { minHeight: 70, borderRadius: 17, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 11 }, settingTitle: { color: t.text, fontSize: 12, fontWeight: '800' },
    modalBackdrop: { flex: 1, backgroundColor: '#0C111D88', justifyContent: 'flex-end' }, modalDismiss: { flex: 1 }, modalSheet: { backgroundColor: t.surfaceStrong, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 19, paddingTop: 9, paddingBottom: Platform.OS === 'ios' ? 28 : 18 }, choreModalSheet: { maxHeight: '94%', paddingBottom: Platform.OS === 'ios' ? 12 : 8 }, modalHandle: { width: 39, height: 4, borderRadius: 2, backgroundColor: t.line, alignSelf: 'center', marginBottom: 15 }, modalHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }, modalTitle: { color: t.text, fontSize: 23, fontWeight: '800', letterSpacing: -.7 }, typeTabs: { flexDirection: 'row', borderRadius: 14, padding: 4, backgroundColor: t.canvas, marginTop: 19 }, typeTab: { flex: 1, minHeight: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }, typeTabActive: { backgroundColor: t.surfaceStrong }, typeTabText: { color: t.muted, fontSize: 10, fontWeight: '700' }, typeTabTextActive: { color: t.primary }, fieldLabel: { color: t.muted, fontSize: 9, fontWeight: '800', marginTop: 15, marginBottom: 6 }, modalInput: { minHeight: 46, borderRadius: 13, borderWidth: 1, borderColor: t.line, backgroundColor: t.surface, color: t.text, paddingHorizontal: 12 }, modalTextArea: { minHeight: 83, paddingTop: 12, textAlignVertical: 'top' }, saveButton: { minHeight: 48, borderRadius: 15, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center', marginTop: 18 }, saveButtonText: { color: '#fff', fontSize: 12, fontWeight: '800' }, disabled: { opacity: .45 },
    privacyCard: { minHeight: 66, borderRadius: 16, padding: 12, marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#19A47B12', borderWidth: 1, borderColor: '#19A47B35' }, privacyText: { color: t.text, fontSize: 10, lineHeight: 15, flex: 1, fontWeight: '600' }, sharedAttachment: { minHeight: 62, borderRadius: 15, padding: 12, marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line }, sharePreviewInput: { minHeight: 110, paddingTop: 12, textAlignVertical: 'top' }, shareError: { color: '#D64545', fontSize: 10, marginTop: 8 }, shareActions: { flexDirection: 'row', gap: 10, marginTop: 16 }, cancelButton: { flex: 1, minHeight: 48, borderRadius: 15, borderWidth: 1, borderColor: t.line, alignItems: 'center', justifyContent: 'center' }, cancelButtonText: { color: t.text, fontSize: 12, fontWeight: '800' }, approveButton: { flex: 1.4, minHeight: 48, borderRadius: 15, backgroundColor: t.primary, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center' },
    cohThinking: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 40, minHeight: 38, paddingHorizontal: 13, borderRadius: 16, backgroundColor: '#7047EE14', borderWidth: 1, borderColor: '#7047EE35' },
    chatModeTabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: t.surfaceStrong, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line }, chatModeTab: { flex: 1, minHeight: 39, borderRadius: 13, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: t.surface, borderWidth: 1, borderColor: t.line }, chatModeTabActive: { backgroundColor: t.primary, borderColor: t.primary }, chatModeCohActive: { backgroundColor: '#7047EE', borderColor: '#7047EE' }, chatModeText: { color: t.text, fontSize: 10, fontWeight: '800' }, chatModeTextActive: { color: '#fff' }, emptyChat: { minHeight: 180, alignItems: 'center', justifyContent: 'center', gap: 10, opacity: .82 },
    choreRewardText: { fontSize: 9, fontWeight: '800', marginTop: 4 }, choreScheduleText: { color: t.muted, fontSize: 8, fontWeight: '700', marginTop: 3 }, choreFormContent: { paddingTop: 2, paddingBottom: Platform.OS === 'ios' ? 28 : 18 }, choreOwnerChoices: { gap: 8, paddingRight: 18 }, choreOwnerChip: { minHeight: 42, borderRadius: 15, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line }, choreOwnerChipActive: { backgroundColor: t.primary, borderColor: t.primary }, choreOwnerText: { color: t.text, fontSize: 10, fontWeight: '800' }, choreOwnerTextActive: { color: '#fff' }, choreOwnerAvatar: { width: 25, height: 25, borderRadius: 9, alignItems: 'center', justifyContent: 'center' }, choreDateRow: { flexDirection: 'row', gap: 8 }, choreDateField: { flex: 1, minHeight: 48, borderRadius: 14, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, overflow: 'hidden' }, choreOptionWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, choreRewardInput: { marginTop: 8 }, choreSummaryCard: { minHeight: 58, borderRadius: 15, padding: 12, marginTop: 15, flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: '#19A47B12', borderWidth: 1, borderColor: '#19A47B35' }, choreSummaryText: { color: t.text, fontSize: 9, lineHeight: 14, flex: 1, fontWeight: '700' }, deleteChoreButton: { minHeight: 44, marginTop: 10, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: '#D645450D', borderWidth: 1, borderColor: '#D6454535' }, deleteChoreText: { color: '#D64545', fontSize: 10, fontWeight: '800' }, rewardModalGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, rewardModalChoice: { width: '48.5%', minHeight: 58, borderRadius: 15, padding: 11, flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: t.surface, borderWidth: 1, borderColor: t.line }, rewardValueRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, eventDetailRow: { minHeight: 62, borderRadius: 16, marginTop: 10, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line },
    fullModalHeader: { minHeight: 72, paddingHorizontal: 18, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: t.surfaceStrong, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line }, inviteFamilyCard: { minHeight: 82, borderRadius: 19, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: '#7047EE12', borderWidth: 1, borderColor: '#7047EE35' }, inviteFamilyIcon: { width: 45, height: 45, borderRadius: 15, backgroundColor: '#7047EE', alignItems: 'center', justifyContent: 'center' },
    welcomePage: { flex: 1, backgroundColor: t.canvas },
    welcomeContent: { padding: 18, paddingBottom: 36, gap: 12 },
    welcomeHero: { minHeight: 260, borderRadius: 26, padding: 23, justifyContent: 'center', shadowColor: '#24116D', shadowOpacity: .24, shadowRadius: 18, shadowOffset: { width: 0, height: 9 } },
    welcomeMark: { width: 54, height: 54, borderRadius: 18, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
    welcomeTitle: { color: '#fff', fontSize: 29, lineHeight: 33, fontWeight: '900', letterSpacing: -1, marginTop: 8 },
    welcomeText: { color: '#FFFFFFCC', fontSize: 12, lineHeight: 18, marginTop: 9 },
    welcomeRow: { minHeight: 94, borderRadius: 20, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line },
    welcomeAlertCard: { minHeight: 84, borderRadius: 20, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: t.surfaceStrong, borderWidth: 1, borderColor: '#FF7A2E42' },
    welcomeEnableButton: { minHeight: 34, borderRadius: 11, backgroundColor: '#FF7A2E', paddingHorizontal: 11, alignItems: 'center', justifyContent: 'center' },
    welcomeEnableText: { color: '#fff', fontSize: 9, fontWeight: '900' },
    welcomeActions: { flexDirection: 'row', gap: 9 },
    secondaryWelcomeButton: { flex: 1, minHeight: 48, borderRadius: 15, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: t.surface, borderWidth: 1, borderColor: t.line },
    secondaryWelcomeText: { color: t.text, fontSize: 10, fontWeight: '900' },
  });
}


export default function App() {
  return <AppErrorBoundary><ShareIntentProvider><AuthGate><CohoApp /></AuthGate></ShareIntentProvider></AppErrorBoundary>;
}
