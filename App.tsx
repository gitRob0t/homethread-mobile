import AuthGate from './src/components/AuthGate';
import AppErrorBoundary from './src/components/AppErrorBoundary';
import AutomationRulesScreen from './src/components/AutomationRules';
import EmailConnectionsScreen from './src/components/EmailConnections';
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
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  askCoh,
  attachmentFromUri,
  cancelCohAction,
  confirmCohAction,
  createCohConversationId,
  createCohRequestId,
  resumeCoh,
  type CohAttachment,
  type CohDraft,
  type CohResponse,
} from './src/services/cohAssistant';
import { CohoEdgeFunctionError } from './src/services/edgeFunctions';
import {
  getDeviceCalendarSettings,
  hasDeviceCalendarAccess,
  writeApprovedEventToDevice,
} from './src/services/deviceCalendar';
import { listCalendarConnections, type CalendarProvider } from './src/services/calendarConnections';
import type { EmailSourceProvider } from './src/services/emailSources';
import { supabase } from './src/lib/supabase';
import {
  deleteHouseholdPerson,
  listHouseholdPeople,
  listHouseholds,
  removeHouseholdMember,
  saveHouseholdPerson,
  type HouseholdPerson,
  uploadHouseholdPersonAvatar,
} from './src/services/households';
import {
  loadMoreMenuPreferences,
  saveMoreMenuPreferences,
  type MoreMenuPreferences,
} from './src/services/uiPreferences';
import {
  countInboundItemsForReview,
  getHouseholdInbox,
  subscribeToFamilyInbox,
} from './src/services/familyInbox';
import { getLocationSharingState } from './src/services/familyLocation';
import {
  loadBriefingPreferences,
  registerPushDevice,
  syncBriefingPreferences,
  type BriefingPreferences,
} from './src/services/pushNotifications';
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
  | 'Calendars'
  | 'Email'
  | 'Notifications'
  | 'Food & Dining'
  | 'Location & Safety'
  | 'Displays & Migration'
  | 'Notification Settings'
  | 'Calendar Setup'
  | 'Email Connections'
  | 'Family Places'
  | 'Meals & Groceries'
  | 'Family Inbox'
  | 'Trips'
  | 'Privacy'
  | 'Settings';
type ChatChannel = 'family' | 'coh';
type ChatMessage = {
  id: string;
  mine: boolean;
  author: string;
  text: string;
  bot?: boolean;
  channel?: ChatChannel;
  delivery?: 'sending' | 'sent' | 'failed';
  requestId?: string;
  retryable?: boolean;
  attachments?: CohAttachment[];
  attachmentCount?: number;
  timezone?: string;
  conversationId?: string;
  cohPrompt?: string;
  cohResponse?: CohResponse;
};
type BotEvent = {
  id: string;
  sourceId?: string;
  title: string;
  person: string;
  personId?: string;
  day: string;
  dateISO?: string;
  time: string;
  place?: string;
  reminder?: number;
  directions?: boolean;
  provider?: 'coho' | 'google' | 'outlook' | 'apple' | string;
  sourceCalendarId?: string;
  recurrenceRule?: string;
  allDay?: boolean;
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

function deviceTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function cohActionRequestKey(
  operation: 'confirm' | 'cancel',
  conversationId: string | null,
  action: CohResponse['action'],
) {
  return [
    operation,
    conversationId ?? 'no-conversation',
    action?.id ?? 'no-action',
    action?.version ?? 'no-version',
    action?.proposalHash ?? 'no-hash',
  ].join(':');
}

function cohActionOperationKey(
  operation: 'confirm' | 'cancel',
  response: CohResponse,
) {
  return cohActionRequestKey(operation, response.conversationId, response.action);
}

async function retryRequestInProgress<T>(
  request: () => Promise<T>,
  maxPolls = 6,
): Promise<T> {
  for (let poll = 0; ; poll += 1) {
    try {
      return await request();
    } catch (error) {
      const inProgress = error instanceof CohoEdgeFunctionError
        && error.code === 'REQUEST_IN_PROGRESS';
      if (!inProgress || poll >= maxPolls) throw error;
      const delay = Math.min(5_000, Math.max(1_000, error.retryAfterMs ?? 1_500));
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
type EventEntryMode = 'calendar' | 'email' | 'manual' | 'coh';
type EventFormValue = {
  title: string;
  details: string;
  assignedPersonId: string | null;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  location: string;
  recurrenceRule: string | null;
  reminderMinutes: number | null;
  writeToDevice: boolean;
};
type ChiefPrefs = BriefingPreferences & { members: string[] };
type RewardGoal = { id: string; title: string; detail: string; cost: number; icon: string; color: string };
type FamilyProfile = {
  id: string;
  linkedUserId?: string | null;
  membershipRole?: 'owner' | 'admin' | 'member' | 'child' | null;
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

type MoreMenuItem = {
  title: Exclude<MoreView, 'Menu' | 'Privacy'>;
  icon: string;
  color: string;
  detail: string;
};

const moreMenuItems: MoreMenuItem[] = [
  { title: 'Chief of Home', icon: 'home-outline', color: '#7047EE', detail: 'Personal briefings, week ahead, and follow-ups' },
  { title: 'Family', icon: 'people-outline', color: '#2257F4', detail: 'Members, roles, and family invitations' },
  { title: 'Calendars', icon: 'calendar-outline', color: '#2257F4', detail: 'Apple, Google, Outlook, and other calendar sources' },
  { title: 'Email', icon: 'mail-unread-outline', color: '#FF7A2E', detail: 'Connect any address and review Coh event suggestions' },
  { title: 'Meals & Groceries', icon: 'restaurant-outline', color: '#D7550D', detail: 'Meal plans, shared groceries, and Coh Home Chef' },
  { title: 'Family Places', icon: 'location-outline', color: '#19A47B', detail: 'Opt-in location, arrivals, and departures' },
  { title: 'Trips', icon: 'airplane-outline', color: '#7047EE', detail: 'Private schedules with friends and other families' },
  { title: 'Notes', icon: 'document-text-outline', color: '#7C4DFF', detail: 'Lists, instructions, and family details' },
  { title: 'Recaps', icon: 'sparkles-outline', color: '#2257F4', detail: 'Daily summaries by push and email' },
  { title: 'Automations', icon: 'flash-outline', color: '#7047EE', detail: 'Real cloud rules, retries, and household follow-through' },
  { title: 'Integrations', icon: 'extension-puzzle-outline', color: '#19A47B', detail: 'Skylight, calendars, email, and more' },
  { title: 'Settings', icon: 'settings-outline', color: '#FF7A2E', detail: 'Household, privacy, and preferences' },
];

type IntegrationCategoryView =
  | 'Calendars'
  | 'Email'
  | 'Notifications'
  | 'Food & Dining'
  | 'Location & Safety'
  | 'Displays & Migration';

type IntegrationProvider = {
  name: string;
  icon: string;
  color: string;
  detail: string;
};

type IntegrationCategory = {
  view: IntegrationCategoryView;
  icon: string;
  color: string;
  detail: string;
  providers: IntegrationProvider[];
};

const integrationCategories: IntegrationCategory[] = [
  {
    view: 'Calendars',
    icon: 'calendar-outline',
    color: '#2257F4',
    detail: 'Bring every approved family calendar into one timeline.',
    providers: [
      { name: 'Apple Calendar', icon: 'logo-apple', color: '#5A667A', detail: 'Choose calendars already available on this iPhone.' },
      { name: 'Google Calendar', icon: 'logo-google', color: '#4285F4', detail: 'Connect Google, then choose exactly which calendars Coho uses.' },
      { name: 'Outlook Calendar', icon: 'mail-outline', color: '#0078D4', detail: 'Connect Microsoft and choose work or personal calendars.' },
      { name: 'Other calendar', icon: 'link-outline', color: '#19A47B', detail: 'Use an ICS, subscribed, or CalDAV calendar already added to this iPhone.' },
    ],
  },
  {
    view: 'Email',
    icon: 'mail-unread-outline',
    color: '#FF7A2E',
    detail: 'Turn school, appointment, and activity email into approved actions.',
    providers: [
      { name: 'Gmail / Google Workspace', icon: 'logo-google', color: '#4285F4', detail: 'Google-hosted personal or custom-domain email.' },
      { name: 'Outlook / Microsoft 365', icon: 'logo-microsoft', color: '#0078D4', detail: 'Microsoft-hosted personal, work, or custom-domain email.' },
      { name: 'iCloud Mail', icon: 'logo-apple', color: '#5A667A', detail: 'iCloud Mail, including iCloud+ custom domains.' },
      { name: 'Yahoo Mail', icon: 'mail-outline', color: '#6F2DBD', detail: 'Yahoo-hosted email forwarded into the private Family Inbox.' },
      { name: 'Custom email or domain', icon: 'globe-outline', color: '#FF7A2E', detail: 'Add any address and identify its real mailbox host.' },
      { name: 'Family Inbox', icon: 'file-tray-full-outline', color: '#7047EE', detail: 'Review extracted suggestions before anything is added.' },
    ],
  },
  {
    view: 'Notifications',
    icon: 'notifications-outline',
    color: '#7047EE',
    detail: 'Configure each person’s delivery, timing, content, and quiet hours.',
    providers: [
      { name: 'iOS Notifications', icon: 'phone-portrait-outline', color: '#7047EE', detail: 'Push alerts, reminders, assignments, and deep links on this iPhone.' },
      { name: 'Email Briefings', icon: 'mail-outline', color: '#2257F4', detail: 'Daily sync, week-ahead, and follow-up copies by email.' },
    ],
  },
  {
    view: 'Food & Dining',
    icon: 'restaurant-outline',
    color: '#D7550D',
    detail: 'Move from a family plan to groceries or a reservation.',
    providers: [
      { name: 'Instacart', icon: 'basket-outline', color: '#19A47B', detail: 'Create a live shoppable list, review local prices, then check out.' },
      { name: 'OpenTable', icon: 'restaurant-outline', color: '#D7550D', detail: 'Find restaurants and complete a real reservation handoff.' },
    ],
  },
  {
    view: 'Location & Safety',
    icon: 'location-outline',
    color: '#19A47B',
    detail: 'Consent-first family location, saved places, and arrival alerts.',
    providers: [
      { name: 'Family Places', icon: 'location-outline', color: '#19A47B', detail: 'Share this phone’s location and create opt-in place alerts.' },
    ],
  },
  {
    view: 'Displays & Migration',
    icon: 'tablet-landscape-outline',
    color: '#A96013',
    detail: 'Move existing household schedules into Coho cleanly.',
    providers: [
      { name: 'Skylight', icon: 'cloud-download-outline', color: '#FF7A2E', detail: 'Import or subscribe to an exported Skylight calendar feed.' },
    ],
  },
];

const integrationCategoryViews = new Set<MoreView>(
  integrationCategories.map((category) => category.view),
);

const moreMenuStorageKey = 'coho-more-menu-v1';
const defaultMoreMenuPreferences: MoreMenuPreferences = {
  order: moreMenuItems.map((item) => item.title),
  hidden: [],
};

function normalizeMoreMenuPreferences(
  value: Partial<MoreMenuPreferences> | null | undefined,
): MoreMenuPreferences {
  const validTitles = new Set<string>(moreMenuItems.map((item) => item.title));
  const requestedOrder = Array.isArray(value?.order)
    ? value.order.filter((title): title is string => (
      typeof title === 'string' && validTitles.has(title)
    ))
    : [];
  const order = [...new Set([...requestedOrder, ...defaultMoreMenuPreferences.order])]
    .filter((title) => validTitles.has(title));
  const hidden = Array.isArray(value?.hidden)
    ? [...new Set(value.hidden.filter((title): title is string => (
      typeof title === 'string' && validTitles.has(title)
    )))]
    : [];
  return { order, hidden };
}

function parseMoreMenuPreferences(raw: string | null) {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Partial<MoreMenuPreferences>;
  } catch {
    return null;
  }
}

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
  const [lastPrimaryTab, setLastPrimaryTab] = useState<Exclude<Tab, 'More'>>('Today');
  const [moreView, setMoreView] = useState<MoreView>('Menu');
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddType, setQuickAddType] = useState('Event');
  const [quickAddTitle, setQuickAddTitle] = useState('');
  const [quickAddDetails, setQuickAddDetails] = useState('');
  const [quickAddSaving, setQuickAddSaving] = useState(false);
  const [manualEventOpen, setManualEventOpen] = useState(false);
  const [calendarSetupProvider, setCalendarSetupProvider] = useState<CalendarProvider | 'device'>('device');
  const [emailSetupProvider, setEmailSetupProvider] = useState<EmailSourceProvider>('custom');
  const [notice, setNotice] = useState<string | null>(null);
  const [chores, setChores] = useState<Chore[]>([]);
  const [rewardMember, setRewardMember] = useState('');
  const [selectedRewards, setSelectedRewards] = useState<Record<string, string>>({});
  const [profiles, setProfiles] = useState<FamilyProfile[]>([]);
  const [editingProfile, setEditingProfile] = useState<FamilyProfile | null>(null);
  const [familyHubOpen, setFamilyHubOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatMode, setChatMode] = useState<ChatChannel>('family');
  const [familyMessageDraft, setFamilyMessageDraft] = useState('');
  const [cohMessageDraft, setCohMessageDraft] = useState('');
  const [botEvents, setBotEvents] = useState<BotEvent[]>([]);
  const [followUps, setFollowUps] = useState<SharedFollowUp[]>([]);
  const [calendarFocusDate, setCalendarFocusDate] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<BotEvent | null>(null);
  const [editingChore, setEditingChore] = useState<Chore | null>(null);
  const [cohConversationId, setCohConversationId] = useState<string | null>(null);
  const [cohThinking, setCohThinking] = useState(false);
  const [cohRestoring, setCohRestoring] = useState(false);
  const [cohResumeNonce, setCohResumeNonce] = useState(0);
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
  const [inboxReviewCount, setInboxReviewCount] = useState(0);
  const [mailboxConnectionRefreshToken, setMailboxConnectionRefreshToken] = useState(0);
  const [integrationReturnView, setIntegrationReturnView] = useState<IntegrationCategoryView | null>(null);
  const [integrationCategoryBackView, setIntegrationCategoryBackView] = useState<'Menu' | 'Integrations'>('Menu');
  const [secondUserWelcomeOpen, setSecondUserWelcomeOpen] = useState(false);
  const familySendLockRef = useRef(false);
  const cohRequestLockRef = useRef(false);
  const voiceToggleLockRef = useRef(false);
  const cohRemoteBusyRef = useRef(false);
  const cohActionRequestIdsRef = useRef(new Map<string, {
    requestId: string;
    timezone: string;
  }>());
  const cohActionReplayStorageKeyRef = useRef<string | null>(null);
  const cohActionReplayLoadRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (tab !== 'More') setLastPrimaryTab(tab);
  }, [tab]);

  useEffect(() => {
    void ensureCohActionRequestIdsLoaded();
  }, [currentUserId, householdId]);

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
    // Older prototypes cached sample household data in global keys. Hydrating those
    // keys can leak stale/demo content into a different signed-in household after
    // an app update. Live household data is now the only source for chat, events,
    // and chores; remove the unsafe legacy cache before connecting.
    AsyncStorage.multiRemove([
      'coho-chat-messages-v2',
      'coho-calendar-events-v2',
      'coho-chores-v2',
    ]).catch(() => undefined).finally(() => setLocalDataReady(true));
    Notifications.getPermissionsAsync().then((permission) => {
      if (permission.granted) setConnected((current) => ({ ...current, 'iOS Notifications': true }));
    }).catch(() => undefined);
  }, []);

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
      if (
        url
        && !/\/invite\//i.test(url)
        && (
          /^(coho|homethread):\/\//i.test(url)
          || /^https:\/\/(?:app\.)?coho\.ai\//i.test(url)
        )
      ) {
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
        const remoteBriefingPreferences = await loadBriefingPreferences(authData.user.id)
          .catch(() => null);
        if (remoteBriefingPreferences && active) {
          setChiefPrefs((current) => ({
            ...current,
            ...remoteBriefingPreferences,
          }));
          setConnected((current) => ({
            ...current,
            'Email Briefings': remoteBriefingPreferences.email === true,
          }));
        }
        await reloadSharedData(household.id, authData.user.id);
        const [
          notificationPermission,
          deviceCalendarAccess,
          deviceCalendarSettings,
          calendarConnections,
          householdInbox,
          locationSharing,
        ] = await Promise.all([
          Notifications.getPermissionsAsync(),
          hasDeviceCalendarAccess().catch(() => false),
          getDeviceCalendarSettings().catch(() => null),
          listCalendarConnections(household.id).catch(() => []),
          getHouseholdInbox(household.id).catch(() => null),
          getLocationSharingState(household.id, authData.user.id).catch(() => null),
        ]);
        const activeCalendarProviders = new Set(
          calendarConnections
            .filter((connection) => connection.status === 'active')
            .map((connection) => connection.provider),
        );
        const inboxActive = householdInbox?.status === 'active';
        setConnected((current) => ({
          ...current,
          'iOS Notifications': notificationPermission.granted,
          'Apple Calendar': deviceCalendarAccess
            && Boolean(deviceCalendarSettings?.selectedCalendarIds.length),
          'Google Calendar': activeCalendarProviders.has('google'),
          'Outlook Calendar': activeCalendarProviders.has('outlook'),
          'Family Inbox': inboxActive,
          'Family Places': locationSharing?.sharing_enabled === true,
        }));
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
        removeSubscriptions.push(
          subscribeToFamilyInbox(household.id, () => void reloadSharedData(household.id, authData.user!.id)),
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

  useEffect(() => {
    if (!householdId || !currentUserId) return;
    let active = true;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let resumeFailureCount = 0;
    cohRemoteBusyRef.current = true;
    setCohRestoring(true);

    async function restoreSession() {
      try {
        const session = await resumeCoh({
          householdId: householdId!,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        });
        if (!active) return;
        resumeFailureCount = 0;
        const now = Date.now();
        const outstandingRequests = session.outstandingRequests ?? [];
        // Edge returns null when the history being reconciled is closed, while
        // still exposing that request's own conversation ID in the ledger.
        setCohConversationId(session.conversationId);

        await ensureCohActionRequestIdsLoaded();
        const pendingReplayRequestIds = new Set(
          [...cohActionRequestIdsRef.current.values()].map((replay) => replay.requestId),
        );
        let replayLedgerChanged = false;
        for (const request of outstandingRequests) {
          if (
            (request.operation !== 'confirm' && request.operation !== 'cancel')
            || (
              request.status !== 'completed'
              && !(request.status === 'failed' && !request.retryable)
            )
          ) continue;
          // The action version advances when it is confirmed or canceled, so
          // reconstructing the original map key from the terminal response is
          // unsafe. The request ID is the durable idempotency identity.
          for (const [operationKey, replay] of cohActionRequestIdsRef.current) {
            if (replay.requestId !== request.requestId) continue;
            cohActionRequestIdsRef.current.delete(operationKey);
            replayLedgerChanged = true;
          }
        }
        if (replayLedgerChanged) {
          await persistCohActionRequestIds().catch(() => undefined);
        }

        const restored = (session.turns ?? []).map((turn) => {
          const leaseExpiresAt = turn.leaseExpiresAt
            ? new Date(turn.leaseExpiresAt).getTime()
            : Number.NaN;
          const leaseExpired = turn.requestState === 'processing'
            && Boolean(turn.leaseExpiresAt)
            && (!Number.isFinite(leaseExpiresAt) || leaseExpiresAt <= now);
          const failedMessage = turn.role === 'user'
            && turn.operation === 'message'
            && (turn.requestState === 'failed' || leaseExpired);
          const processingMessage = turn.role === 'user'
            && turn.operation === 'message'
            && turn.requestState === 'processing'
            && !leaseExpired;
          return {
            id: `coh-turn-${turn.id}`,
            mine: turn.role === 'user',
            author: turn.role === 'user' ? 'You' : 'Coh',
            text: turn.content,
            bot: turn.role === 'assistant',
            channel: 'coh' as const,
            delivery: failedMessage
              ? 'failed' as const
              : processingMessage
                ? 'sending' as const
                : 'sent' as const,
            requestId: turn.requestId ?? undefined,
            retryable: failedMessage
              ? (leaseExpired || turn.retryable)
              : false,
            attachmentCount: turn.attachmentCount,
            timezone: turn.timezone ?? undefined,
            conversationId: session.conversationId ?? undefined,
            cohPrompt: turn.role === 'user' && turn.operation === 'message'
              ? turn.content
              : undefined,
            cohResponse: normalizeRestoredCohResponse(
              turn.response ?? undefined,
              session.activeAction,
            ),
          };
        });
        const restoredResponseRequestIds = new Set(
          restored
            .filter((message) => !message.mine && Boolean(message.cohResponse))
            .map((message) => message.requestId)
            .filter((requestId): requestId is string => Boolean(requestId)),
        );
        const receiptMessages: ChatMessage[] = outstandingRequests
          .filter((request) =>
            request.status === 'completed'
            && Boolean(request.response)
            && !restoredResponseRequestIds.has(request.requestId)
            && pendingReplayRequestIds.has(request.requestId),
          )
          .map((request) => ({
            id: `coh-receipt-${request.requestId}`,
            mine: false,
            author: 'Coh',
            text: request.response!.reply,
            bot: true,
            channel: 'coh',
            delivery: 'sent',
            requestId: request.requestId,
            conversationId: request.response!.conversationId ?? undefined,
            cohResponse: request.response!,
          }));
        const durableMessages = [...restored, ...receiptMessages];

        setMessages((current) => {
          const localByRequestId = new Map(
            current
              .filter((message) =>
                messageChannel(message) === 'coh' && Boolean(message.requestId),
              )
              .map((message) => [message.requestId!, message]),
          );
          const hydratedMessages = durableMessages.map((message) => {
            const local = message.requestId
              ? localByRequestId.get(message.requestId)
              : undefined;
            if (!message.mine || !local) return message;
            return {
              ...message,
              // Durable turns intentionally do not return attachment bytes.
              // Keep the in-memory envelope so an exact same-process retry can
              // still resend the original voice note, screenshot, or PDF.
              attachments: local.attachments,
              attachmentCount: Math.max(
                message.attachmentCount ?? 0,
                local.attachmentCount ?? local.attachments?.length ?? 0,
              ),
              timezone: message.timezone ?? local.timezone,
              conversationId: message.conversationId ?? local.conversationId,
              cohPrompt: message.cohPrompt ?? local.cohPrompt,
            };
          });
          const durableIds = new Set(hydratedMessages.map((message) => message.id));
          const durableRequestIds = new Set(
            hydratedMessages
              .map((message) => message.requestId)
              .filter((requestId): requestId is string => Boolean(requestId)),
          );
          const outstandingByRequestId = new Map(
            outstandingRequests.map((request) => [request.requestId, request]),
          );
          const localCoh = current
            .filter((message) =>
              messageChannel(message) === 'coh'
              && !durableIds.has(message.id)
              && (!message.requestId || !durableRequestIds.has(message.requestId))
              && (message.delivery === 'sending' || message.delivery === 'failed'),
            )
            .map((message) => {
              const request = message.requestId
                ? outstandingByRequestId.get(message.requestId)
                : undefined;
              if (!request || request.operation !== 'message') return message;
              const leaseExpiresAt = request.leaseExpiresAt
                ? new Date(request.leaseExpiresAt).getTime()
                : Number.NaN;
              const leaseExpired = request.status === 'processing'
                && Boolean(request.leaseExpiresAt)
                && (!Number.isFinite(leaseExpiresAt) || leaseExpiresAt <= now);
              if (request.status !== 'failed' && !leaseExpired) {
                return { ...message, delivery: 'sending' as const };
              }
              return {
                ...message,
                delivery: 'failed' as const,
                retryable: leaseExpired || request.retryable,
              };
            });
          const family = current.filter((message) => messageChannel(message) === 'family');
          return [...hydratedMessages, ...localCoh, ...family];
        });

        const hasProcessingTurn = session.turns.some((turn) =>
          turn.requestState === 'processing'
          && (!turn.leaseExpiresAt || new Date(turn.leaseExpiresAt).getTime() > now),
        );
        const hasProcessingLedgerRequest = outstandingRequests.some((request) =>
          request.status === 'processing'
          && (
            !request.leaseExpiresAt
            || new Date(request.leaseExpiresAt).getTime() > now
          ),
        );
        const hasProcessingRequest = hasProcessingTurn
          || hasProcessingLedgerRequest
          || (
            !Array.isArray(session.outstandingRequests)
            && session.hasProcessingRequests === true
          );
        if (hasProcessingRequest) {
          cohRemoteBusyRef.current = true;
          pollTimer = setTimeout(() => void restoreSession(), 2_000);
          return;
        }
      } catch {
        // Recovery is safety-critical: keep retrying after a transient fetch or
        // relay failure instead of leaving an in-flight request stuck forever.
        resumeFailureCount += 1;
        if (active) {
          const retryDelay = Math.min(30_000, 1_000 * (2 ** Math.min(resumeFailureCount, 5)));
          pollTimer = setTimeout(() => void restoreSession(), retryDelay);
        }
        return;
      }
      if (active) {
        cohRemoteBusyRef.current = false;
        setCohRestoring(false);
      }
    }

    void restoreSession();
    return () => {
      active = false;
      cohRemoteBusyRef.current = false;
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [householdId, currentUserId, cohResumeNonce]);

  async function reloadSharedData(targetHousehold = householdId, targetUser = currentUserId) {
    if (!targetHousehold || !targetUser) return;
    const [sharedMessages, sharedEvents, sharedChores, sharedFollowUps, householdPeople, snapshots, nextInboxReviewCount] = await Promise.all([
      listSharedMessages(targetHousehold),
      listSharedEvents(targetHousehold),
      listSharedChores(targetHousehold),
      listEventFollowUps(targetHousehold),
      listHouseholdPeople(targetHousehold),
      listBriefingSnapshots(targetHousehold),
      countInboundItemsForReview(targetHousehold).catch(() => 0),
    ]);
    setMessages((current) => [
      ...current.filter((message) => messageChannel(message) === 'coh'),
      ...sharedMessages.map((message: any) => cloudMessage(message, targetUser)),
    ]);
    setBotEvents(sharedEvents.flatMap((event: any) => expandCloudEvent(event)));
    setChores(sharedChores.map((chore: any, index: number) => cloudChore(chore, index)));
    setFollowUps(sharedFollowUps);
    setBriefingSnapshots(snapshots);
    setInboxReviewCount(nextInboxReviewCount);
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

  async function ensureCohActionRequestIdsLoaded() {
    const storageKey = currentUserId && householdId
      ? `coho-coh-action-replays-v1:${currentUserId}:${householdId}`
      : null;
    if (!storageKey) {
      cohActionReplayStorageKeyRef.current = null;
      cohActionRequestIdsRef.current.clear();
      cohActionReplayLoadRef.current = Promise.resolve();
      return;
    }
    if (cohActionReplayStorageKeyRef.current === storageKey) {
      await cohActionReplayLoadRef.current;
      return;
    }

    cohActionReplayStorageKeyRef.current = storageKey;
    cohActionRequestIdsRef.current.clear();
    const load = AsyncStorage.getItem(storageKey)
      .then((saved) => {
        if (!saved || cohActionReplayStorageKeyRef.current !== storageKey) return;
        const parsed: unknown = JSON.parse(saved);
        if (!Array.isArray(parsed)) return;
        for (const entry of parsed) {
          if (!Array.isArray(entry) || entry.length !== 2) continue;
          const [key, value] = entry;
          if (
            typeof key === 'string'
            && value
            && typeof value === 'object'
            && typeof (value as any).requestId === 'string'
            && typeof (value as any).timezone === 'string'
          ) {
            cohActionRequestIdsRef.current.set(key, {
              requestId: (value as any).requestId,
              timezone: (value as any).timezone,
            });
          }
        }
      })
      .catch(() => undefined);
    cohActionReplayLoadRef.current = load;
    await load;
  }

  async function persistCohActionRequestIds() {
    await ensureCohActionRequestIdsLoaded();
    const storageKey = cohActionReplayStorageKeyRef.current;
    if (!storageKey) return;
    await AsyncStorage.setItem(
      storageKey,
      JSON.stringify([...cohActionRequestIdsRef.current.entries()]),
    );
  }

  async function forgetCohActionRequestId(operationKey: string) {
    cohActionRequestIdsRef.current.delete(operationKey);
    await persistCohActionRequestIds().catch(() => undefined);
  }

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
      setFamilyMessageDraft([title, details].filter(Boolean).join('\n'));
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
    setCohMessageDraft(prompt);
    setTab('Chat');
    showNotice('Coh will confirm the missing event details before saving');
  }

  function openEventEntry(mode: EventEntryMode) {
    setQuickAddOpen(false);
    setQuickAddTitle('');
    setQuickAddDetails('');
    if (mode === 'manual') {
      setManualEventOpen(true);
      return;
    }
    if (mode === 'coh') {
      setChatMode('coh');
      setCohMessageDraft('@coh Help me create a family calendar event.');
      setTab('Chat');
      showNotice('Tell Coh what you know. It will ask only for missing details.');
      return;
    }
    if (mode === 'email') {
      setEmailSetupProvider('custom');
      setIntegrationCategoryBackView('Menu');
      setIntegrationReturnView('Email');
      setMoreView('Email Connections');
      setTab('More');
      return;
    }
    setIntegrationCategoryBackView('Menu');
    setIntegrationReturnView(null);
    setMoreView('Calendars');
    setTab('More');
  }

  async function saveManualEvent(form: EventFormValue) {
    if (!householdId || !currentUserId) {
      showNotice('Join a Coho household before adding a family event.');
      return;
    }
    if (!form.title.trim()) return;
    setQuickAddSaving(true);
    try {
      const assignee = profiles.find((profile) => profile.id === form.assignedPersonId) ?? null;
      const eventStart = form.allDay
        ? new Date(form.startsAt.getFullYear(), form.startsAt.getMonth(), form.startsAt.getDate())
        : form.startsAt;
      const eventEnd = form.allDay
        ? new Date(eventStart.getFullYear(), eventStart.getMonth(), eventStart.getDate() + 1)
        : form.endsAt;
      const startsAt = eventStart.toISOString();
      const endsAt = eventEnd.toISOString();
      const created = await createFamilyEvent({
        householdId,
        userId: currentUserId,
        title: form.title.trim(),
        startsAt,
        endsAt,
        allDay: form.allDay,
        location: form.location.trim() || null,
        details: JSON.stringify({
          notes: form.details.trim() || null,
          person: assignee?.name ?? 'Family',
          reminder: form.reminderMinutes,
          source: 'manual',
        }),
        assignedPersonId: assignee?.id ?? null,
        provider: 'coho',
        recurrenceRule: form.recurrenceRule,
      });
      const reminderScheduled = await scheduleManualEventReminder({
        eventId: created.id,
        title: form.title.trim(),
        startsAt: eventStart,
        reminderMinutes: form.reminderMinutes,
        recurrenceRule: form.recurrenceRule,
      });
      let wroteToDevice = false;
      if (form.writeToDevice) {
        wroteToDevice = Boolean(await writeApprovedEventToDevice({
          id: created.id,
          title: form.title.trim(),
          startsAt,
          endsAt,
          location: form.location.trim() || null,
          notes: form.details.trim() || 'Added manually in Coho',
          reminderMinutes: form.reminderMinutes,
          allDay: form.allDay,
          recurrenceRule: form.recurrenceRule,
        }).catch(() => null));
      }
      setManualEventOpen(false);
      setCalendarFocusDate(localDateKey(eventStart));
      await reloadSharedData(householdId, currentUserId);
      setTab('Calendar');
      const eventNotice = form.writeToDevice && !wroteToDevice
        ? 'Event added to Coho. Choose a write-back calendar to copy it to your phone.'
        : wroteToDevice
          ? 'Event added to Coho and your selected phone calendar'
          : 'Event added to the shared family calendar';
      showNotice(form.reminderMinutes && !reminderScheduled
        ? `${eventNotice} Enable iOS notifications to receive its reminder.`
        : eventNotice);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'The event could not be added.');
    } finally {
      setQuickAddSaving(false);
    }
  }

  async function scheduleManualEventReminder(input: {
    eventId: string;
    title: string;
    startsAt: Date;
    reminderMinutes: number | null;
    recurrenceRule: string | null;
  }) {
    if (!input.reminderMinutes) return true;
    let permission = await Notifications.getPermissionsAsync();
    if (!permission.granted) permission = await Notifications.requestPermissionsAsync();
    if (!permission.granted) return false;

    const reminderAt = new Date(input.startsAt.getTime() - input.reminderMinutes * 60_000);
    const content = {
      title: input.title,
      body: `Starts in ${formatReminderLead(input.reminderMinutes)}. Tap to open the family event.`,
      sound: 'default' as const,
      data: {
        screen: 'Calendar',
        eventId: input.eventId,
        deepLink: `coho://event/${input.eventId}`,
      },
    };
    const frequency = input.recurrenceRule?.match(/FREQ=(DAILY|WEEKLY|MONTHLY)/)?.[1];
    if (frequency) {
      const shared = {
        type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
        repeats: true,
        hour: reminderAt.getHours(),
        minute: reminderAt.getMinutes(),
      } as const;
      await Notifications.scheduleNotificationAsync({
        content,
        trigger: frequency === 'WEEKLY'
          ? { ...shared, weekday: reminderAt.getDay() + 1 }
          : frequency === 'MONTHLY'
            ? { ...shared, day: reminderAt.getDate() }
            : shared,
      });
      return true;
    }
    if (reminderAt.getTime() <= Date.now()) return false;
    await Notifications.scheduleNotificationAsync({
      content,
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: reminderAt,
      },
    });
    return true;
  }

  function addBotMessage(text: string, response?: CohResponse) {
    setMessages((current) => [...current, {
      id: `bot-${response?.requestId ?? createCohRequestId()}`,
      mine: false,
      author: 'Coh',
      text,
      bot: true,
      channel: 'coh',
      cohResponse: response,
    }]);
  }

  async function sendMessage() {
    const mode = chatMode;
    const lock = mode === 'coh' ? cohRequestLockRef : familySendLockRef;
    if (mode === 'coh' && cohRemoteBusyRef.current) {
      showNotice('Coh is still reconciling the previous request. Family chat remains available.');
      return;
    }
    if (lock.current) return;
    const text = (mode === 'coh' ? cohMessageDraft : familyMessageDraft).trim();
    if (!text) return;
    lock.current = true;
    const requestId = createCohRequestId();
    const timezone = deviceTimezone();
    const prompt = text.match(/^\s*(@coh|hey coh)/i) ? text : `@coh ${text}`;
    const conversationId = mode === 'coh'
      ? (cohConversationId ?? createCohConversationId())
      : undefined;
    const optimistic = {
      id: `pending-${requestId}`,
      mine: true,
      author: 'You',
      text,
      channel: mode,
      requestId: mode === 'coh' ? requestId : undefined,
      attachmentCount: 0,
      timezone: mode === 'coh' ? timezone : undefined,
      conversationId,
      cohPrompt: mode === 'coh' ? prompt : undefined,
      delivery: 'sending',
    } as ChatMessage;
    setMessages((current) => [...current, optimistic]);
    if (mode === 'coh') setCohMessageDraft('');
    else setFamilyMessageDraft('');
    if (mode === 'coh') {
      void handleBotMessage(
        prompt,
        [],
        requestId,
        optimistic.id,
        timezone,
        conversationId,
      )
        .finally(() => {
          cohRequestLockRef.current = false;
        });
      return;
    }
    if (!householdId || !currentUserId) {
      setMessages((current) => current.filter((message) => message.id !== optimistic.id));
      setFamilyMessageDraft(text);
      showNotice('Family chat is offline. Reconnect before sending this message.');
      familySendLockRef.current = false;
      return;
    }
    try {
      await sendFamilyMessage(householdId, currentUserId, text);
      setMessages((current) => current.map((message) =>
        message.id === optimistic.id ? { ...message, delivery: 'sent' } : message,
      ));
    } catch {
      setMessages((current) => current.filter((message) => message.id !== optimistic.id));
      setFamilyMessageDraft(text);
      showNotice('Message was not sent. Your text is back in the composer.');
    } finally {
      familySendLockRef.current = false;
    }
  }

  function cancelSharedItem() {
    setSharePreviewOpen(false);
    setSharedDraft('');
    resetShareIntent();
  }

  async function sendSharedItemToCoh() {
    if (cohRequestLockRef.current || cohRemoteBusyRef.current) {
      showNotice('Coh is finishing another request. Try sharing again in a moment.');
      return;
    }
    cohRequestLockRef.current = true;
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
      const requestId = createCohRequestId();
      const optimisticId = `pending-${requestId}`;
      const timezone = deviceTimezone();
      const conversationId = cohConversationId ?? createCohConversationId();
      setMessages((current) => [...current, {
        id: optimisticId,
        mine: true,
        author: 'You',
        text: attachments.length ? `${prompt}\n📎 ${attachments.map((item) => item.name).join(', ')}` : prompt,
        channel: 'coh',
        requestId,
        attachments,
        attachmentCount: attachments.length,
        timezone,
        conversationId,
        cohPrompt: prompt,
        delivery: 'sending',
      }]);
      await handleBotMessage(
        prompt,
        attachments,
        requestId,
        optimisticId,
        timezone,
        conversationId,
      );
      setSharedDraft('');
    } catch (nextError) {
      addBotMessage(nextError instanceof Error
        ? nextError.message
        : 'I could not read that attachment. Nothing was saved.');
    } finally {
      resetShareIntent();
      setCohThinking(false);
      cohRequestLockRef.current = false;
    }
  }

  async function handleBotMessage(
    text: string,
    attachments: CohAttachment[] = [],
    requestId = createCohRequestId(),
    optimisticId?: string,
    requestTimezone = deviceTimezone(),
    requestedConversationId?: string,
  ) {
    const normalized = text.trim().toLowerCase();
    const directlyInvoked = normalized.startsWith('@coh') || normalized.startsWith('hey coh') || normalized.startsWith('@bot') || normalized.startsWith('hey bot');
    if (!directlyInvoked && !cohConversationId) return;

    const conversationId = requestedConversationId
      ?? cohConversationId
      ?? createCohConversationId();
    if (!cohConversationId) setCohConversationId(conversationId);
    setCohThinking(true);
    try {
      const response = await retryRequestInProgress(() => askCoh({
        message: text,
        requestId,
        conversationId,
        householdId,
        timezone: requestTimezone,
        attachments,
      }));
      setCohConversationId(response.conversationId);
      setMessages((current) => {
        const updated = current.map((message) =>
          message.id === optimisticId
            || (message.mine && message.requestId === requestId)
            ? { ...message, delivery: 'sent' as const, conversationId }
            : response.action?.id
              && message.cohResponse?.action?.id === response.action.id
              ? {
                ...message,
                cohResponse: supersedeCohResponse(message.cohResponse),
              }
              : message,
        );
        const assistantMessage: ChatMessage = {
          id: `bot-${requestId}`,
          mine: false,
          author: 'Coh',
          text: response.reply,
          bot: true,
          channel: 'coh',
          cohResponse: response,
        };
        const existingAssistant = updated.findIndex((message) =>
          message.bot && message.cohResponse?.requestId === requestId,
        );
        if (existingAssistant >= 0) {
          updated[existingAssistant] = assistantMessage;
          return updated;
        }
        return [...updated, assistantMessage];
      });

      if (response.action?.targetId) {
        if (householdId && currentUserId) await reloadSharedData(householdId, currentUserId);
        setCohConversationId(null);
      } else if (response.status === 'canceled') {
        setCohConversationId(null);
      }
      return;
    } catch (error) {
      if (
        error instanceof CohoEdgeFunctionError
        && error.code === 'REQUEST_IN_PROGRESS'
      ) {
        if (optimisticId) {
          setMessages((current) => current.map((message) =>
            message.id === optimisticId
              ? {
                ...message,
                delivery: 'sending',
                requestId,
                attachments,
                attachmentCount: attachments.length,
                timezone: requestTimezone,
                conversationId,
                retryable: true,
              }
              : message,
          ));
        }
        cohRemoteBusyRef.current = true;
        setCohResumeNonce((current) => current + 1);
        showNotice('Coh is still working. This request will reconcile automatically; no need to send it again.');
        return;
      }
      if (optimisticId) {
        const retryable = error instanceof CohoEdgeFunctionError ? error.retryable : true;
        setMessages((current) => current.map((message) =>
          message.id === optimisticId
            ? {
              ...message,
              delivery: 'failed',
              requestId,
              attachments,
              attachmentCount: attachments.length,
              timezone: requestTimezone,
              conversationId,
              retryable,
            }
            : message,
        ));
      }
      const detail = error instanceof CohoEdgeFunctionError
        ? error.message
        : 'Coh could not finish that request.';
      const retryable = error instanceof CohoEdgeFunctionError ? error.retryable : true;
      showNotice(retryable
        ? `${detail} Your request is preserved—tap Retry.`
        : detail);
      return;
    } finally {
      setCohThinking(false);
    }
  }

  async function retryCohMessage(message: ChatMessage) {
    if (
      !message.requestId
      || message.retryable === false
      || cohRequestLockRef.current
      || cohRemoteBusyRef.current
    ) return;
    if (!message.timezone) {
      setCohMessageDraft(message.cohPrompt ?? message.text);
      showNotice('This older request is missing its original timezone. It is back in the composer so you can send it as a new request.');
      return;
    }
    if (!message.conversationId) {
      setCohMessageDraft(message.cohPrompt ?? message.text);
      showNotice('This older request is missing its original conversation. It is back in the composer so you can send it as a new request.');
      return;
    }
    const attachmentCount = message.attachmentCount ?? message.attachments?.length ?? 0;
    if (attachmentCount > 0 && (message.attachments?.length ?? 0) !== attachmentCount) {
      setCohMessageDraft(message.cohPrompt ?? message.text);
      showNotice('Reattach the original file or voice note, then send this as a new request. Coh will not retry a different payload under the old request ID.');
      return;
    }
    cohRequestLockRef.current = true;
    setMessages((current) => current.map((item) =>
      item.id === message.id ? { ...item, delivery: 'sending' } : item,
    ));
    try {
      await handleBotMessage(
        message.cohPrompt
          ?? (message.text.match(/^\s*(@coh|hey coh)/i) ? message.text : `@coh ${message.text}`),
        message.attachments ?? [],
        message.requestId,
        message.id,
        message.timezone,
        message.conversationId,
      );
    } finally {
      cohRequestLockRef.current = false;
    }
  }

  async function confirmCohProposal(response: CohResponse) {
    const conversationId = response.conversationId;
    const action = response.action;
    if (
      !householdId
      || !conversationId
      || !action
      || cohRequestLockRef.current
      || cohRemoteBusyRef.current
    ) return;
    cohRequestLockRef.current = true;
    await ensureCohActionRequestIdsLoaded();
    const operationKey = cohActionOperationKey('confirm', response);
    const replay = cohActionRequestIdsRef.current.get(operationKey) ?? {
      requestId: createCohRequestId(),
      timezone: deviceTimezone(),
    };
    cohActionRequestIdsRef.current.set(operationKey, replay);
    try {
      await persistCohActionRequestIds();
    } catch {
      cohActionRequestIdsRef.current.delete(operationKey);
      cohRequestLockRef.current = false;
      showNotice('Coho could not secure this confirmation for safe replay. Nothing was created; try again.');
      return;
    }
    const { requestId, timezone } = replay;
    const optimisticId = `pending-${requestId}`;
    setMessages((current) => [...current, {
      id: optimisticId,
      mine: true,
      author: 'You',
      text: 'Confirm & create',
      channel: 'coh',
      requestId,
      delivery: 'sending',
    }]);
    setCohThinking(true);
    try {
      const result = await retryRequestInProgress(() => confirmCohAction({
        requestId,
        conversationId,
        householdId,
        timezone,
        actionId: action.id,
        expectedVersion: action.version,
        proposalHash: action.proposalHash,
      }));
      await forgetCohActionRequestId(operationKey);
      applyCohActionResult(action.id, optimisticId, result);
      if (result.action?.targetId && currentUserId) {
        await reloadSharedData(householdId, currentUserId);
        setCohConversationId(null);
      }
    } catch (error) {
      // Confirmation is a distinct server operation. Do not leave a generic
      // "Retry safely" message behind because retrying that message would send
      // it through the normal conversation endpoint instead of re-validating
      // the proposal version and hash. Keep the proposal card actionable so
      // the user can explicitly confirm it again.
      setMessages((current) => current.filter((message) => message.id !== optimisticId));
      const retryable = !(error instanceof CohoEdgeFunctionError) || error.retryable;
      if (!retryable) await forgetCohActionRequestId(operationKey);
      const detail = error instanceof Error
        ? error.message
        : 'Coh could not confirm that action. Nothing new was claimed.';
      showNotice(retryable
        ? `${detail} Tap Confirm & create again to retry the exact same operation safely.`
        : detail);
    } finally {
      setCohThinking(false);
      cohRequestLockRef.current = false;
    }
  }

  async function cancelCohProposal(response: CohResponse) {
    const conversationId = response.conversationId;
    const action = response.action;
    if (
      !householdId
      || !conversationId
      || !action
      || cohRequestLockRef.current
      || cohRemoteBusyRef.current
    ) return;
    cohRequestLockRef.current = true;
    await ensureCohActionRequestIdsLoaded();
    const operationKey = cohActionOperationKey('cancel', response);
    const replay = cohActionRequestIdsRef.current.get(operationKey) ?? {
      requestId: createCohRequestId(),
      timezone: deviceTimezone(),
    };
    cohActionRequestIdsRef.current.set(operationKey, replay);
    try {
      await persistCohActionRequestIds();
    } catch {
      cohActionRequestIdsRef.current.delete(operationKey);
      cohRequestLockRef.current = false;
      showNotice('Coho could not secure this cancellation for safe replay. Nothing changed; try again.');
      return;
    }
    const { requestId, timezone } = replay;
    setCohThinking(true);
    try {
      const result = await retryRequestInProgress(() => cancelCohAction({
        requestId,
        conversationId,
        householdId,
        timezone,
        actionId: action.id,
        expectedVersion: action.version,
        proposalHash: action.proposalHash,
      }));
      await forgetCohActionRequestId(operationKey);
      applyCohActionResult(action.id, null, result);
      setCohConversationId(null);
    } catch (error) {
      const retryable = !(error instanceof CohoEdgeFunctionError) || error.retryable;
      if (!retryable) await forgetCohActionRequestId(operationKey);
      const detail = error instanceof Error ? error.message : 'Coh could not cancel that proposal.';
      showNotice(retryable
        ? `${detail} Tap Cancel again to retry the exact same operation safely.`
        : detail);
    } finally {
      setCohThinking(false);
      cohRequestLockRef.current = false;
    }
  }

  function applyCohActionResult(actionId: string, optimisticId: string | null, result: CohResponse) {
    setMessages((current) => [
      ...current.map((message) => {
        if (optimisticId && message.id === optimisticId) return { ...message, delivery: 'sent' as const };
        if (message.cohResponse?.action?.id === actionId) {
          return {
            ...message,
            cohResponse: {
              ...message.cohResponse,
              action: result.action,
              status: result.status,
            },
          };
        }
        return message;
      }),
      {
        id: `bot-${result.requestId}`,
        mine: false,
        author: 'Coh',
        text: result.reply,
        bot: true,
        channel: 'coh',
        cohResponse: result,
      },
    ]);
  }

  function changeCohProposal(response: CohResponse) {
    setCohConversationId(response.conversationId);
    setChatMode('coh');
    setCohMessageDraft('Change ');
    showNotice('Tell Coh exactly what to change; the current proposal stays intact until you confirm.');
  }

  async function openCohAction(response: CohResponse) {
    if (!response.action?.id) return;
    const action = await getHouseholdAction(response.action.id).catch(() => null);
    if (action) await openActionTarget(action);
    else showNotice('That item could not be opened. Refresh and try again.');
  }

  async function toggleVoiceRequest() {
    if (voiceToggleLockRef.current) return;
    if (!voiceRecorderState.isRecording && cohRemoteBusyRef.current) {
      showNotice('Coh is still reconciling the previous request. You can keep using Family chat meanwhile.');
      return;
    }
    voiceToggleLockRef.current = true;
    if (voiceRecorderState.isRecording) {
      if (cohRequestLockRef.current || cohRemoteBusyRef.current) {
        voiceToggleLockRef.current = false;
        showNotice('Coh is reconciling another request. Keep recording, then tap again when it is done to send this voice note.');
        return;
      }
      cohRequestLockRef.current = true;
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
        const requestId = createCohRequestId();
        const optimisticId = `pending-${requestId}`;
        const timezone = deviceTimezone();
        const conversationId = cohConversationId ?? createCohConversationId();
        setMessages((current) => [...current, {
          id: optimisticId,
          mine: true,
          author: 'You',
          text: '🎙️ Voice request',
          channel: 'coh',
          requestId,
          attachments: [attachment],
          attachmentCount: 1,
          timezone,
          conversationId,
          cohPrompt: prompt,
          delivery: 'sending',
        }]);
        await handleBotMessage(
          prompt,
          [attachment],
          requestId,
          optimisticId,
          timezone,
          conversationId,
        );
      } catch (nextError) {
        addBotMessage(nextError instanceof Error ? nextError.message : 'I could not read that voice note.');
      } finally {
        setVoiceSending(false);
        cohRequestLockRef.current = false;
        voiceToggleLockRef.current = false;
      }
      return;
    }

    try {
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
    } finally {
      voiceToggleLockRef.current = false;
    }
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
    const mailboxConnection = url.match(
      /^(?:coho|homethread):\/\/mail-connected\/(google|outlook)(?:[/?#]|$)/i,
    );
    if (mailboxConnection) {
      const provider = mailboxConnection[1].toLowerCase() as 'google' | 'outlook';
      const label = provider === 'google' ? 'Gmail' : 'Outlook';
      const connectionId = url.match(/[?&]connectionId=([^&#]+)/i)?.[1];
      setEmailSetupProvider(provider === 'google' ? 'google' : 'microsoft');
      setMailboxConnectionRefreshToken((current) => current + 1);
      setIntegrationReturnView('Email');
      setMoreView('Email Connections');
      setTab('More');
      showNotice(connectionId
        ? `${label} authorization returned. Coho is verifying the connection and first sync.`
        : `${label} authorization was not completed. Nothing new was connected.`);
      return;
    }
    const calendarConnection = url.match(
      /^(?:coho|homethread):\/\/calendar-connected\/(google|outlook)(?:[/?#]|$)/i,
    );
    if (calendarConnection) {
      const label = calendarConnection[1].toLowerCase() === 'google'
        ? 'Google Calendar'
        : 'Outlook';
      setConnected((current) => ({ ...current, [label]: true }));
      setCalendarSetupProvider(calendarConnection[1].toLowerCase() as CalendarProvider);
      setIntegrationReturnView('Calendars');
      setMoreView('Calendar Setup');
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
      setCohMessageDraft(id === 'meal-plan'
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
    const now = Date.now();
    const today = localDateKey(new Date());
    const nextEvents = botEvents
      .filter((event) => isUpcomingCalendarEvent(event, now, today))
      .sort((a, b) => botEventTimestamp(a) - botEventTimestamp(b))
      .slice(0, 4);
    const eventSummary = nextEvents.length
      ? `You have ${nextEvents.length} upcoming family events. ${nextEvents.map((event) => `${event.title}, ${event.day} at ${event.time}`).join('. ')}.`
      : 'There are no upcoming events on the shared family calendar.';
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

  function deleteFamilyProfile(profile: FamilyProfile) {
    const isSignedInMember = Boolean(profile.linkedUserId);
    Alert.alert(
      isSignedInMember ? 'Remove family member?' : 'Delete family profile?',
      isSignedInMember
        ? `${profile.name} will lose access to this household, its calendar, chat, assignments, and notifications. Shared family history will remain.`
        : `${profile.name} will be removed from family profiles and future assignments. Existing shared history will remain.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: isSignedInMember ? 'Remove' : 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              if (!householdId) return;
              try {
                if (profile.linkedUserId) {
                  await removeHouseholdMember(householdId, profile.linkedUserId);
                } else {
                  await deleteHouseholdPerson(profile.id);
                }
                setEditingProfile(null);
                await reloadSharedData(householdId, currentUserId);
                showNotice(isSignedInMember
                  ? `${profile.name} was removed from the household`
                  : `${profile.name}’s profile was deleted`);
              } catch (error) {
                showNotice(error instanceof Error
                  ? error.message
                  : 'The family member could not be removed.');
              }
            })();
          },
        },
      ],
    );
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
      setConnected((current) => ({
        ...current,
        'iOS Notifications': true,
        'Email Briefings': chiefPrefs.email,
      }));
    } else {
      await scheduleChiefNotifications({ ...chiefPrefs, push: false });
      setConnected((current) => ({
        ...current,
        'Email Briefings': chiefPrefs.email,
      }));
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

  const title = tab === 'Today'
    ? 'Command Center'
    : tab === 'More' && moreView !== 'Menu'
      ? moreView === 'Email Connections'
        ? 'Email'
        : moreView
      : tab;
  const currentMembershipRole = profiles.find(
    (profile) => profile.linkedUserId === currentUserId,
  )?.membershipRole;
  const canManageFamily = currentMembershipRole === 'owner' || currentMembershipRole === 'admin';
  const openRecaps = () => { setInitialRecapId(null); setMoreView('Recaps'); setTab('More'); };
  const openCohPrompt = (prompt: string) => {
    setChatMode('coh');
    setCohMessageDraft(prompt);
    setMoreView('Menu');
    setTab('Chat');
    showNotice('Review the request, then send it to Coh');
  };
  const openHouseholdOS = (view: MoreView) => {
    setIntegrationReturnView(null);
    if (integrationCategoryViews.has(view)) setIntegrationCategoryBackView('Menu');
    setMoreView(view);
    setTab('More');
  };
  const openIntegrationCategory = (view: IntegrationCategoryView) => {
    setIntegrationReturnView(null);
    setIntegrationCategoryBackView('Integrations');
    setMoreView(view);
    setTab('More');
  };
  const handleIntegration = (name: string, returnView?: IntegrationCategoryView) => {
    if (returnView) setIntegrationReturnView(returnView);
    if (['iOS Notifications', 'Email Briefings'].includes(name)) {
      setMoreView('Notification Settings');
      setTab('More');
      return;
    }
    if (name === 'Family Inbox') {
      setMoreView('Family Inbox');
      setTab('More');
      return;
    }
    if (['Gmail / Google Workspace', 'Outlook / Microsoft 365', 'iCloud Mail', 'Yahoo Mail', 'Custom email or domain'].includes(name)) {
      setEmailSetupProvider(
        name === 'Gmail / Google Workspace'
          ? 'google'
          : name === 'Outlook / Microsoft 365'
            ? 'microsoft'
            : name === 'iCloud Mail'
              ? 'icloud'
              : name === 'Yahoo Mail'
                ? 'yahoo'
                : 'custom',
      );
      setMoreView('Email Connections');
      setTab('More');
      return;
    }
    if (name === 'Family Places') {
      setMoreView('Family Places');
      setTab('More');
      return;
    }
    if (['Apple Calendar', 'Google Calendar', 'Outlook Calendar', 'Other calendar'].includes(name)) {
      setCalendarSetupProvider(
        name === 'Google Calendar'
          ? 'google'
          : name === 'Outlook Calendar'
            ? 'outlook'
            : 'device',
      );
      setMoreView('Calendar Setup');
      setTab('More');
      return;
    }
    if (name === 'Instacart') {
      setMoreView('Meals & Groceries');
      setTab('More');
      return;
    }
    if (name === 'OpenTable') {
      setMoreView('Trips');
      setTab('More');
      return;
    }
    showNotice(`${name} setup requires provider authorization. Coho will never mark it connected before that succeeds.`);
  };
  const handleMoreBack = () => {
    if (integrationReturnView && !integrationCategoryViews.has(moreView)) {
      setMoreView(integrationReturnView);
      setIntegrationReturnView(null);
      return;
    }
    if (integrationCategoryViews.has(moreView)) {
      setMoreView(integrationCategoryBackView);
      setIntegrationCategoryBackView('Menu');
      return;
    }
    if (moreView !== 'Menu') {
      setMoreView('Menu');
      return;
    }
    setTab(lastPrimaryTab);
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
          onAdd={() => {
            if (tab === 'Calendar') setQuickAddType('Event');
            setQuickAddOpen(true);
          }}
          onBack={tab === 'More' ? handleMoreBack : undefined}
        />

        <View style={styles.screen}>
          {tab === 'Today' && <TodayScreen
            styles={styles}
            events={botEvents}
            chores={chores}
            messages={messages}
            followUps={followUps}
            profiles={profiles}
            inboxReviewCount={inboxReviewCount}
            notificationsEnabled={connected['iOS Notifications'] === true}
            onCalendar={() => setTab('Calendar')}
            onRecap={openRecaps}
            onOpenEvent={openCalendarEvent}
            onChores={() => setTab('Chores')}
            onInbox={() => { setMoreView('Family Inbox'); setTab('More'); }}
            onChat={() => { setChatMode('family'); setTab('Chat'); }}
            onFamily={() => { setMoreView('Family'); setTab('More'); }}
            onNotifications={() => { setMoreView('Notification Settings'); setTab('More'); }}
          />}
          {tab === 'Calendar' && <CalendarScreen theme={theme} styles={styles} botEvents={botEvents} profiles={profiles} focusDate={calendarFocusDate} onOpenEvent={setSelectedEvent} onAction={showNotice} onManage={() => { setIntegrationReturnView(null); setIntegrationCategoryBackView('Menu'); setMoreView('Calendars'); setTab('More'); }} onAdd={() => { setQuickAddType('Event'); setQuickAddOpen(true); }} />}
          {tab === 'Chores' && <ChoresScreen styles={styles} chores={chores} memberNames={profiles.map((profile) => profile.name)} rewardMember={rewardMember} setRewardMember={setRewardMember} selectedRewards={selectedRewards} onConfigure={setEditingChore} onAdd={() => { setQuickAddType('Chore'); setQuickAddOpen(true); }} onSelectReward={(member: string, reward: string) => { const next = { ...selectedRewards, [member]: reward }; setSelectedRewards(next); AsyncStorage.setItem('coho-reward-goals', JSON.stringify(next)); showNotice(`${member} picked a new reward goal`); }} onToggle={toggleChore} />}
          {tab === 'Chat' && <ChatScreen
            styles={styles}
            messages={messages}
            mode={chatMode}
            setMode={setChatMode}
            draft={chatMode === 'coh' ? cohMessageDraft : familyMessageDraft}
            setDraft={chatMode === 'coh' ? setCohMessageDraft : setFamilyMessageDraft}
            onSend={sendMessage}
            onAdd={() => setQuickAddOpen(true)}
            onVoice={toggleVoiceRequest}
            onRetry={retryCohMessage}
            onConfirm={confirmCohProposal}
            onCancel={cancelCohProposal}
            onChange={changeCohProposal}
            onOpenAction={openCohAction}
            voiceRecording={voiceRecorderState.isRecording}
            voiceSending={voiceSending}
            cohThinking={cohThinking || cohRestoring}
          />}
          {tab === 'More' && moreView === 'Menu' && <MoreMenu styles={styles} setView={(view) => {
            setIntegrationReturnView(null);
            if (integrationCategoryViews.has(view)) setIntegrationCategoryBackView('Menu');
            setMoreView(view);
          }} userId={currentUserId} onNotice={showNotice} />}
          {tab === 'More' && moreView === 'Chief of Home' && <ChiefOfHomeScreen styles={styles} prefs={chiefPrefs} memberNames={profiles.map((profile) => profile.name)} setPrefs={saveChiefPreferences} onActivate={activateChiefOfHome} />}
          {tab === 'More' && moreView === 'Family' && <FamilyProfilesScreen styles={styles} profiles={profiles} onInvite={() => setFamilyHubOpen(true)} onEdit={setEditingProfile} onAdd={() => setEditingProfile({ id: `new-${Date.now()}`, name: '', dob: '', bio: '', role: 'Family member', color: '#DCE7FF', ink: '#2257F4' })} />}
          {tab === 'More' && moreView === 'Notes' && <NotesScreen styles={styles} householdId={householdId} userId={currentUserId} onAction={showNotice} />}
          {tab === 'More' && moreView === 'Recaps' && <RecapsScreen styles={styles} onRefresh={refreshDailySync} onListen={speakDailySync} onOpenEvent={openCalendarEvent} onCompleteFollowUp={completeFollowUpItem} events={botEvents} chores={chores} messages={messages} followUps={followUps} snapshots={briefingSnapshots} initialSnapshotId={initialRecapId} />}
          {tab === 'More' && moreView === 'Automations' && <AutomationRulesScreen dark={dark} householdId={householdId} userId={currentUserId} onNotice={showNotice} />}
          {tab === 'More' && moreView === 'Integrations' && <IntegrationsScreen styles={styles} connected={connected} onOpenCategory={openIntegrationCategory} />}
          {tab === 'More' && integrationCategoryViews.has(moreView) && <IntegrationCategoryScreen
            styles={styles}
            view={moreView as IntegrationCategoryView}
            connected={connected}
            onConnect={handleIntegration}
          />}
          {tab === 'More' && moreView === 'Notification Settings' && <NotificationCenterScreen
            styles={styles}
            prefs={chiefPrefs}
            permissionEnabled={connected['iOS Notifications'] === true}
            onChange={saveChiefPreferences}
            onEnable={enableNotifications}
            onSave={activateChiefOfHome}
          />}
          {tab === 'More' && moreView === 'Calendar Setup' && <CalendarConnectionScreen dark={dark} householdId={householdId} userId={currentUserId} initialProvider={calendarSetupProvider} onNotice={showNotice} onConnected={(source) => setConnected((current) => ({
            ...current,
            [source === 'google' ? 'Google Calendar' : source === 'outlook' ? 'Outlook Calendar' : 'Apple Calendar']: true,
          }))} onSynced={() => reloadSharedData()} />}
          {tab === 'More' && moreView === 'Email Connections' && <EmailConnectionsScreen
            dark={dark}
            householdId={householdId}
            userId={currentUserId}
            initialProvider={emailSetupProvider}
            canManage={canManageFamily}
            refreshToken={mailboxConnectionRefreshToken}
            onNotice={showNotice}
            onConnectionStateChange={(provider, isConnected) => setConnected((current) => ({
              ...current,
              [provider === 'google' ? 'Gmail / Google Workspace' : 'Outlook / Microsoft 365']: isConnected,
            }))}
            onReviewInbox={() => { setInitialInboxItemId(null); setMoreView('Family Inbox'); setTab('More'); }}
            onSetupInbox={() => { setInitialInboxItemId(null); setMoreView('Family Inbox'); setTab('More'); }}
          />}
          {tab === 'More' && moreView === 'Family Inbox' && <FamilyInboxScreen dark={dark} householdId={householdId} householdName={householdName} userId={currentUserId} onNotice={showNotice} onAskCoh={openCohPrompt} onOpenAction={openActionTarget} initialItemId={initialInboxItemId} />}
          {tab === 'More' && moreView === 'Family Places' && <FamilyPlacesScreen dark={dark} householdId={householdId} userId={currentUserId} onNotice={showNotice} />}
          {tab === 'More' && moreView === 'Meals & Groceries' && <FoodHubScreen dark={dark} householdId={householdId} userId={currentUserId} onNotice={showNotice} onAskCoh={openCohPrompt} />}
          {tab === 'More' && moreView === 'Trips' && <TravelHubScreen dark={dark} householdId={householdId} userId={currentUserId} onNotice={showNotice} onAskCoh={openCohPrompt} />}
          {tab === 'More' && moreView === 'Privacy' && <PrivacyDataScreen dark={dark} householdId={householdId} onNotice={showNotice} />}
          {tab === 'More' && moreView === 'Settings' && <SettingsScreen styles={styles} dark={dark} onTheme={toggleTheme} onNotifications={() => setMoreView('Notification Settings')} onFamily={() => setMoreView('Family')} onPrivacy={() => setMoreView('Privacy')} profiles={profiles} />}
        </View>

        <BottomTabs tab={tab} setTab={(next: Tab) => {
          setTab(next);
          setIntegrationReturnView(null);
          if (next !== 'More') setMoreView('Menu');
        }} theme={theme} styles={styles} />

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
        onEventSource={openEventEntry}
        dark={dark}
      />
      <ManualEventModal
        visible={manualEventOpen}
        profiles={profiles}
        currentUserId={currentUserId}
        styles={styles}
        dark={dark}
        saving={quickAddSaving}
        onClose={() => setManualEventOpen(false)}
        onSave={saveManualEvent}
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
      <ProfileEditorModal
        visible={Boolean(editingProfile)}
        profile={editingProfile}
        styles={styles}
        dark={dark}
        onClose={() => setEditingProfile(null)}
        onSave={saveFamilyProfile}
        onDelete={deleteFamilyProfile}
        canDelete={Boolean(
          editingProfile
          && !editingProfile.id.startsWith('new-')
          && canManageFamily
          && editingProfile.membershipRole !== 'owner'
          && editingProfile.linkedUserId !== currentUserId
        )}
      />
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
  return <View style={styles.header}>
    <View style={styles.headerTitleWrap}>
      {onBack && <Pressable onPress={onBack} style={styles.backButton}><Ionicons name="chevron-back" size={22} color={styles.iconColor.color} /></Pressable>}
      <View style={styles.flex}><Text style={styles.eyebrow}>{dateLabel}</Text><Text numberOfLines={1} style={styles.headerTitle}>{title}</Text>{title === 'Command Center' && <Text numberOfLines={1} style={styles.headerSubtitle}>{householdName}</Text>}</View>
    </View>
    <View style={styles.headerButtons}>
      <Pressable accessibilityLabel="Open daily recap" onPress={onRecap} style={styles.recapHeaderButton}><Ionicons name="sparkles" size={19} color="#fff" /></Pressable>
      <Pressable accessibilityLabel={dark ? 'Use light mode' : 'Use dark mode'} onPress={onTheme} style={styles.iconButton}><Ionicons name={dark ? 'sunny-outline' : 'moon-outline'} size={20} color={styles.iconColor.color} /></Pressable>
      <Pressable accessibilityLabel="Add to family" onPress={onAdd} style={styles.addButton}><Ionicons name="add" size={25} color="#fff" /></Pressable>
    </View>
  </View>;
}

function TodayScreen({
  styles,
  events,
  chores,
  messages,
  followUps,
  profiles,
  inboxReviewCount,
  notificationsEnabled,
  onCalendar,
  onRecap,
  onOpenEvent,
  onChores,
  onInbox,
  onChat,
  onFamily,
  onNotifications,
}: any) {
  const now = new Date();
  const nowValue = now.getTime();
  const today = localDateKey(now);
  const tomorrowStart = startOfDay(addDays(now, 1)).getTime();
  const todaysEvents = events.filter((event: BotEvent) => event.dateISO === today);
  const openChores = chores.filter((chore: Chore) => !chore.done);
  const todaysChores = openChores.filter((chore: Chore) =>
    chore.dueAt && new Date(chore.dueAt).getTime() < tomorrowStart,
  );
  const overdueChores = openChores.filter((chore: Chore) =>
    chore.dueAt && new Date(chore.dueAt).getTime() < nowValue,
  );
  const familyMessages = messages.filter((message: ChatMessage) =>
    messageChannel(message) === 'family' && !message.bot,
  );
  const cards = [
    ...todaysEvents.map((event: BotEvent) => ({ kind: 'event', item: event, title: event.title, value: event.time, detail: `${event.person}${event.place ? ` · ${event.place}` : ''}`, icon: 'calendar-outline', color: '#2257F4', tint: '#DCE7FF' })),
    ...todaysChores.map((chore: Chore) => ({ kind: 'chore', item: chore, title: chore.title, value: chore.due, detail: `${chore.owner} · ${formatChoreReward(chore)}`, icon: 'checkmark-done-outline', color: '#19A47B', tint: '#D9F7ED' })),
  ].slice(0, 4);
  const upcomingEvents = events
    .filter((event: BotEvent) => isUpcomingCalendarEvent(event, nowValue, today))
    .sort((a: BotEvent, b: BotEvent) => botEventTimestamp(a) - botEventTimestamp(b))
    .slice(0, 5);
  const nextEvent = upcomingEvents[0] ?? null;
  const attentionItems = [
    inboxReviewCount > 0 && {
      key: 'inbox',
      icon: 'mail-unread-outline',
      color: '#FF7A2E',
      title: `${inboxReviewCount} inbox item${inboxReviewCount === 1 ? '' : 's'} need review`,
      detail: 'Approve the details before Coh adds anything.',
      action: onInbox,
    },
    followUps.length > 0 && {
      key: 'follow-ups',
      icon: 'refresh-circle-outline',
      color: '#7047EE',
      title: `${followUps.length} follow-up${followUps.length === 1 ? '' : 's'} still open`,
      detail: 'Resurface outcomes and capture the next step.',
      action: onRecap,
    },
    overdueChores.length > 0 && {
      key: 'chores',
      icon: 'alert-circle-outline',
      color: '#D7550D',
      title: `${overdueChores.length} chore${overdueChores.length === 1 ? '' : 's'} overdue`,
      detail: 'Reassign, reschedule, or mark completed.',
      action: onChores,
    },
    !notificationsEnabled && {
      key: 'notifications',
      icon: 'notifications-off-outline',
      color: '#D64545',
      title: 'Family alerts are not ready',
      detail: 'Choose delivery, timing, and quiet hours.',
      action: onNotifications,
    },
  ].filter(Boolean) as Array<{
    key: string;
    icon: string;
    color: string;
    title: string;
    detail: string;
    action: () => void;
  }>;
  const commandStats = [
    { label: 'Today', value: todaysEvents.length, color: '#2257F4', action: onCalendar },
    { label: 'Open chores', value: openChores.length, color: '#19A47B', action: onChores },
    { label: 'Inbox', value: inboxReviewCount, color: '#FF7A2E', action: onInbox },
    { label: 'Follow-ups', value: followUps.length, color: '#7047EE', action: onRecap },
  ];
  return <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
    <LinearGradient colors={['#1C49DB', '#7047EE']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.commandCenterHero}>
      <View style={styles.commandCenterTop}>
        <View style={styles.commandCenterMark}><Ionicons name="home" size={21} color="#7047EE" /></View>
        <View style={styles.flex}><Text style={styles.commandCenterLabel}>FAMILY COMMAND CENTER</Text><Text style={styles.commandCenterTitle}>{nextEvent ? `Next: ${nextEvent.title}` : 'Your household is clear.'}</Text><Text style={styles.commandCenterDetail}>{nextEvent ? `${nextEvent.day} at ${nextEvent.time}${nextEvent.place ? ` · ${nextEvent.place}` : ''}` : 'Coh is watching the calendar, chores, inbox, and follow-ups.'}</Text></View>
      </View>
      <View style={styles.commandStatsRow}>{commandStats.map((item) => <Pressable key={item.label} onPress={item.action} style={styles.commandStat}>
        <Text style={styles.commandStatValue}>{item.value}</Text><Text style={styles.commandStatLabel}>{item.label}</Text>
      </Pressable>)}</View>
    </LinearGradient>

    <View style={styles.sectionHead}><View><Text style={styles.sectionTitle}>Needs attention</Text><Text style={styles.muted}>{attentionItems.length ? 'The shortest path to a clear household.' : 'Nothing is waiting on the family.'}</Text></View></View>
    {attentionItems.length === 0 ? <View style={styles.commandClear}><Ionicons name="checkmark-circle" size={23} color="#19A47B" /><View style={styles.flex}><Text style={styles.settingTitle}>You’re caught up</Text><Text style={styles.muted}>No reviews, overdue chores, or follow-ups need action.</Text></View></View> : attentionItems.slice(0, 4).map((item) => <Pressable key={item.key} onPress={item.action} style={styles.attentionRow}>
      <View style={[styles.attentionIcon, { backgroundColor: `${item.color}18` }]}><Ionicons name={item.icon as any} size={21} color={item.color} /></View>
      <View style={styles.flex}><Text style={styles.settingTitle}>{item.title}</Text><Text style={styles.muted}>{item.detail}</Text></View>
      <Ionicons name="chevron-forward" size={18} color={item.color} />
    </Pressable>)}

    <View style={styles.sectionHead}><View><Text style={styles.sectionTitle}>Today</Text><Text style={styles.muted}>{todaysEvents.length} event{todaysEvents.length === 1 ? '' : 's'} · {todaysChores.length} chore{todaysChores.length === 1 ? '' : 's'} due</Text></View><Pressable onPress={onCalendar}><Text style={styles.link}>See full day ›</Text></Pressable></View>
    {cards.length === 0 ? <View style={styles.emptyChat}><Ionicons name="sparkles-outline" size={28} color="#7047EE" /><Text style={styles.settingTitle}>Your family radar is clear</Text><Text style={styles.muted}>Ask Coh to add an event or create the first shared chore.</Text></View> : <View style={styles.bentoGrid}>{cards.map((card: any) => <Pressable key={`${card.kind}-${card.item.id}`} onPress={() => card.kind === 'event' ? onOpenEvent(card.item) : onChores()} style={styles.bentoCard}>
      <View style={[styles.cardIcon, { backgroundColor: card.tint }]}><Ionicons name={card.icon as any} size={24} color={card.color} /></View>
      <Text style={styles.cardTitle}>{card.title}</Text><Text style={styles.cardValue}>{card.value}</Text><Text style={styles.cardDetail}>{card.detail}</Text>
      <View style={[styles.cardPill, { backgroundColor: `${card.color}12` }]}><Ionicons name="time-outline" size={13} color={card.color} /><Text style={[styles.cardPillText, { color: card.color }]}>Tap for details</Text></View>
    </Pressable>)}</View>}
    <Pressable onPress={onRecap}><LinearGradient colors={['#2257F4', '#7047EE']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.recapCard}>
      <View style={styles.recapIcon}><Ionicons name="sparkles" size={21} color="#fff" /></View><View style={styles.recapCopy}><Text style={styles.recapLabel}>COHO DAILY</Text><Text style={styles.recapTitle}>Your live family sync</Text><Text style={styles.recapText}>{events.length} shared event{events.length === 1 ? '' : 's'} and {openChores.length} open chore{openChores.length === 1 ? '' : 's'}.</Text></View><Ionicons name="chevron-forward" size={20} color="#fff" />
    </LinearGradient></Pressable>
    <Text style={styles.sectionTitle}>Family pulse</Text>
    <View style={styles.familyPulseGrid}>
      <Pressable onPress={onFamily} style={styles.familyPulseCard}><Ionicons name="people-outline" size={22} color="#2257F4" /><Text style={styles.familyPulseValue}>{profiles.length}</Text><Text style={styles.familyPulseLabel}>Family members</Text></Pressable>
      <Pressable onPress={onChat} style={styles.familyPulseCard}><Ionicons name="chatbubbles-outline" size={22} color="#7047EE" /><Text style={styles.familyPulseValue}>{familyMessages.length}</Text><Text style={styles.familyPulseLabel}>Shared messages</Text></Pressable>
    </View>
    <Text style={styles.sectionTitle}>Coming up</Text>{upcomingEvents.length === 0 ? <Text style={styles.muted}>No upcoming events yet.</Text> : upcomingEvents.map((event: BotEvent) => <Pressable key={event.id} onPress={() => onOpenEvent(event)} style={styles.upcomingRow}><View style={[styles.dateTile, { borderColor: '#2257F4' }]}><Text style={[styles.dateMonth, { color: '#2257F4' }]}>{event.dateISO ? new Date(`${event.dateISO}T12:00:00`).toLocaleDateString(undefined, { month: 'short' }).toUpperCase() : 'NEXT'}</Text><Text style={[styles.dateNumber, { color: '#2257F4' }]}>{event.dateISO ? Number(event.dateISO.slice(-2)) : '•'}</Text></View><View style={styles.flex}><Text style={styles.upcomingTime}>{event.time}{event.provider && event.provider !== 'coho' ? ` · ${calendarSourceLabel(event.provider)}` : ''}</Text><Text style={styles.upcomingTitle}>{event.title}</Text></View><Ionicons name="chevron-forward" size={18} color="#2257F4" /></Pressable>)}
  </ScrollView>;
}

type CalendarViewMode = 'month' | 'week' | 'agenda';

const calendarPersonPalette = [
  '#2257F4',
  '#7047EE',
  '#19A47B',
  '#FF7A2E',
  '#D6457A',
  '#0F8FA8',
  '#A96013',
  '#5E6AD2',
];

function stableCalendarColor(value: string) {
  const index = [...value].reduce((result, char) => result + char.charCodeAt(0), 0);
  return calendarPersonPalette[index % calendarPersonPalette.length];
}

function calendarTimeValue(value: string) {
  const text = value.trim().toLowerCase();
  if (text.includes('all day')) return -1;
  const match = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  if (match[3] === 'pm' && hour < 12) hour += 12;
  if (match[3] === 'am' && hour === 12) hour = 0;
  return hour * 60 + minute;
}

function calendarEventSort(a: BotEvent, b: BotEvent) {
  const dateCompare = (a.dateISO ?? '').localeCompare(b.dateISO ?? '');
  return dateCompare || calendarTimeValue(a.time) - calendarTimeValue(b.time) || a.title.localeCompare(b.title);
}

function botEventTimestamp(event: BotEvent) {
  if (!event.dateISO) return Number.MAX_SAFE_INTEGER;
  const date = new Date(`${event.dateISO}T00:00:00`);
  if (Number.isNaN(date.getTime())) return Number.MAX_SAFE_INTEGER;
  const minutes = calendarTimeValue(event.time);
  if (minutes === Number.MAX_SAFE_INTEGER) return date.getTime();
  if (minutes >= 0) date.setMinutes(minutes);
  return date.getTime();
}

function isUpcomingCalendarEvent(event: BotEvent, now: number, today: string) {
  if (!event.dateISO) return false;
  if (/all day/i.test(event.time)) return event.dateISO >= today;
  return botEventTimestamp(event) >= now;
}

function addMonths(date: Date, count: number) {
  const next = new Date(date.getFullYear(), date.getMonth() + count, 1, 12, 0, 0, 0);
  return startOfDay(next);
}

function CalendarScreen({ theme, styles, botEvents, profiles, focusDate, onOpenEvent, onAction, onManage, onAdd }: any) {
  const [selected, setSelected] = useState(startOfDay(new Date()));
  const [view, setView] = useState<CalendarViewMode>('month');
  const [personFilter, setPersonFilter] = useState<string | null>(null);
  useEffect(() => {
    if (!focusDate) return;
    const date = new Date(`${focusDate}T12:00:00`);
    if (!Number.isNaN(date.getTime())) setSelected(startOfDay(date));
  }, [focusDate]);

  const people = useMemo(() => {
    const byName = new Map<string, { id?: string; name: string; color: string; tint: string }>();
    (profiles as FamilyProfile[]).forEach((profile) => {
      const name = profile.name.trim();
      if (name) byName.set(name.toLowerCase(), { id: profile.id, name, color: profile.ink || stableCalendarColor(profile.id || name), tint: profile.color || `${stableCalendarColor(profile.id || name)}18` });
    });
    (botEvents as BotEvent[]).forEach((event) => {
      const name = event.person?.trim();
      if (!name || /^(family|everyone|all)$/i.test(name) || byName.has(name.toLowerCase())) return;
      const color = stableCalendarColor(name);
      byName.set(name.toLowerCase(), { name, color, tint: `${color}18` });
    });
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [botEvents, profiles]);

  const personMeta = (name: string, id?: string) => {
    if (/^(family|everyone|all)$/i.test(name ?? '')) return { name: 'Family', color: '#7047EE', tint: '#7047EE18' };
    return people.find((person) => (id && person.id === id) || person.name.toLowerCase() === name?.toLowerCase())
      ?? { name: name || 'Family', color: stableCalendarColor(name || 'Family'), tint: `${stableCalendarColor(name || 'Family')}18` };
  };

  const filteredEvents = useMemo(() => (botEvents as BotEvent[])
    .filter((event) => !personFilter || event.person?.toLowerCase() === personFilter.toLowerCase())
    .sort(calendarEventSort), [botEvents, personFilter]);
  const datedEvents = filteredEvents.filter((event) => Boolean(event.dateISO));
  const unscheduledEvents = filteredEvents.filter((event) => !event.dateISO);
  const eventsByDate = useMemo(() => {
    const result = new Map<string, BotEvent[]>();
    datedEvents.forEach((event) => result.set(event.dateISO!, [...(result.get(event.dateISO!) ?? []), event]));
    return result;
  }, [datedEvents]);
  const conflictIds = useMemo(() => {
    const result = new Set<string>();
    const slots = new Map<string, BotEvent[]>();
    datedEvents.forEach((event) => {
      if (!event.time || /all day/i.test(event.time)) return;
      const key = `${event.dateISO}-${calendarTimeValue(event.time)}`;
      slots.set(key, [...(slots.get(key) ?? []), event]);
    });
    slots.forEach((events) => {
      if (events.length > 1) events.forEach((event) => result.add(event.id));
    });
    return result;
  }, [datedEvents]);

  const selectedKey = localDateKey(selected);
  const selectedEvents = eventsByDate.get(selectedKey) ?? [];
  const weekStart = startOfWeek(selected);
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const monthStart = new Date(selected.getFullYear(), selected.getMonth(), 1, 12, 0, 0, 0);
  const monthGridStart = startOfWeek(monthStart);
  const monthDays = Array.from({ length: 42 }, (_, index) => addDays(monthGridStart, index));
  const agendaStart = startOfDay(selected);
  const agendaEnd = addDays(agendaStart, 30);
  const agendaKeys = [...eventsByDate.keys()]
    .filter((key) => {
      const date = new Date(`${key}T12:00:00`);
      return date >= agendaStart && date < agendaEnd;
    })
    .sort();
  const viewOptions: Array<{ id: CalendarViewMode; label: string; icon: string }> = [
    { id: 'month', label: 'Month', icon: 'calendar-outline' },
    { id: 'week', label: 'Week', icon: 'albums-outline' },
    { id: 'agenda', label: 'Agenda', icon: 'list-outline' },
  ];
  const period = view === 'month'
    ? selected.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    : view === 'week'
      ? `${weekDays[0].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}–${weekDays[6].toLocaleDateString(undefined, { month: weekDays[0].getMonth() === weekDays[6].getMonth() ? undefined : 'short', day: 'numeric' })}`
      : `${agendaStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}–${addDays(agendaEnd, -1).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;

  function navigatePeriod(direction: -1 | 1) {
    setSelected((current) => view === 'month'
      ? addMonths(current, direction)
      : addDays(current, direction * (view === 'week' ? 7 : 30)));
  }

  function renderEvent(event: BotEvent, compact = false) {
    const person = personMeta(event.person, event.personId);
    const conflict = conflictIds.has(event.id);
    return <Pressable key={event.id} accessibilityRole="button" accessibilityLabel={`Open ${event.title} for ${person.name}`} onPress={() => onOpenEvent(event)} style={[styles.calendarEventRow, compact && styles.calendarEventRowCompact]}>
      <View style={[styles.calendarEventAccent, { backgroundColor: person.color }]} />
      <View style={[styles.calendarEventAvatar, { backgroundColor: person.tint }]}><Text style={[styles.calendarEventInitials, { color: person.color }]}>{initials(person.name)}</Text></View>
      <View style={styles.flex}>
        <View style={styles.eventSourceTitleRow}>
          <Text numberOfLines={1} style={styles.timelineTitle}>{event.title}</Text>
          {conflict && <View style={styles.calendarConflictPill}><Ionicons name="warning" size={9} color="#D7550D" /><Text style={styles.calendarConflictText}>Conflict</Text></View>}
        </View>
        <Text style={styles.calendarEventMeta}>{event.time} · {person.name}{event.place ? ` · ${event.place}` : ''}</Text>
        <View style={styles.calendarEventFooter}>
          {event.provider && <Text style={[styles.calendarSourceText, { color: calendarSourceColor(event.provider) }]}>{calendarSourceLabel(event.provider)}</Text>}
          {event.recurrenceRule && <Text style={styles.calendarEventSecondary}>Repeats</Text>}
          {event.reminder != null && <Text style={styles.calendarEventSecondary}>{event.reminder}m alert</Text>}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={16} color={person.color} />
    </Pressable>;
  }

  function renderDaySection(day: Date, showEmpty = false) {
    const key = localDateKey(day);
    const events = eventsByDate.get(key) ?? [];
    if (!showEmpty && events.length === 0) return null;
    return <View key={key} style={styles.calendarDaySection}>
      <Pressable onPress={() => setSelected(day)} style={styles.calendarDayHeading}>
        <View style={[styles.calendarAgendaDate, sameDay(day, new Date()) && styles.calendarAgendaDateToday]}>
          <Text style={[styles.calendarAgendaWeekday, sameDay(day, new Date()) && styles.calendarAgendaDateTodayText]}>{day.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase()}</Text>
          <Text style={[styles.calendarAgendaNumber, sameDay(day, new Date()) && styles.calendarAgendaDateTodayText]}>{day.getDate()}</Text>
        </View>
        <View style={styles.flex}><Text style={styles.calendarDayTitle}>{day.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</Text><Text style={styles.muted}>{events.length} event{events.length === 1 ? '' : 's'}</Text></View>
      </Pressable>
      {events.length ? events.map((event) => renderEvent(event, true)) : <Text style={styles.calendarEmptyDay}>No family plans</Text>}
    </View>;
  }

  return <ScrollView contentContainerStyle={styles.calendarScrollContent} showsVerticalScrollIndicator={false}>
    <View style={styles.calendarViewTabs}>{viewOptions.map((option) => {
      const active = view === option.id;
      return <Pressable key={option.id} accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={() => setView(option.id)} style={[styles.calendarViewTab, active && styles.calendarViewTabActive]}>
        <Ionicons name={option.icon as any} size={14} color={active ? '#fff' : styles.iconColor.color} />
        <Text style={[styles.calendarViewTabText, active && styles.calendarViewTabTextActive]}>{option.label}</Text>
      </Pressable>;
    })}</View>

    <View style={styles.calendarNav}>
      <Pressable accessibilityLabel={`Previous ${view}`} hitSlop={8} onPress={() => navigatePeriod(-1)} style={styles.smallButton}><Ionicons name="chevron-back" size={18} color={styles.iconColor.color} /></Pressable>
      <View style={styles.flex}><Text style={styles.calendarPeriod}>{period}</Text><Pressable onPress={() => setSelected(startOfDay(new Date()))}><Text style={styles.calendarTodayLink}>TODAY</Text></Pressable></View>
      <Pressable accessibilityLabel={`Next ${view}`} hitSlop={8} onPress={() => navigatePeriod(1)} style={styles.smallButton}><Ionicons name="chevron-forward" size={18} color={styles.iconColor.color} /></Pressable>
    </View>

    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.calendarPeopleFilters}>
      <Pressable onPress={() => setPersonFilter(null)} style={[styles.calendarPersonFilter, personFilter === null && styles.calendarPersonFilterActive]}>
        <Ionicons name="people" size={14} color={personFilter === null ? '#fff' : '#7047EE'} /><Text style={[styles.calendarPersonFilterText, personFilter === null && styles.calendarPersonFilterTextActive]}>Everyone</Text>
      </Pressable>
      {people.map((person) => {
        const active = personFilter?.toLowerCase() === person.name.toLowerCase();
        return <Pressable key={person.name} onPress={() => setPersonFilter(active ? null : person.name)} style={[styles.calendarPersonFilter, active && { backgroundColor: person.color, borderColor: person.color }]}>
          <View style={[styles.calendarPersonDot, { backgroundColor: active ? '#fff' : person.color }]} /><Text style={[styles.calendarPersonFilterText, active && styles.calendarPersonFilterTextActive]}>{person.name}</Text>
        </Pressable>;
      })}
    </ScrollView>

    <View style={styles.calendarSummary}>
      <View><Text style={styles.calendarSummaryValue}>{datedEvents.length}</Text><Text style={styles.calendarSummaryLabel}>scheduled</Text></View>
      <View style={styles.calendarSummaryDivider} />
      <View><Text style={styles.calendarSummaryValue}>{new Set(datedEvents.map((event) => event.person)).size}</Text><Text style={styles.calendarSummaryLabel}>people</Text></View>
      <View style={styles.calendarSummaryDivider} />
      <Pressable onPress={() => conflictIds.size && onAction(`${conflictIds.size} events share the same start time. Open the highlighted items to resolve them.`)}><Text style={[styles.calendarSummaryValue, conflictIds.size > 0 && { color: '#D7550D' }]}>{conflictIds.size}</Text><Text style={styles.calendarSummaryLabel}>conflicts</Text></Pressable>
      <View style={styles.calendarSummaryDivider} />
      <View><Text style={styles.calendarSummaryValue}>{unscheduledEvents.length}</Text><Text style={styles.calendarSummaryLabel}>unscheduled</Text></View>
    </View>

    {view === 'month' && <>
      <View style={styles.calendarMonthCard}>
        <View style={styles.calendarWeekdayRow}>{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => <Text key={`${day}-${index}`} style={[styles.calendarWeekdayLabel, (index === 0 || index === 6) && { color: theme.primary }]}>{day}</Text>)}</View>
        <View style={styles.calendarMonthGrid}>{monthDays.map((day) => {
          const key = localDateKey(day);
          const events = eventsByDate.get(key) ?? [];
          const inMonth = day.getMonth() === selected.getMonth();
          const active = sameDay(day, selected);
          const today = sameDay(day, new Date());
          return <Pressable key={key} accessibilityRole="button" accessibilityLabel={`${day.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}, ${events.length} events`} onPress={() => setSelected(day)} style={[styles.calendarMonthDay, !inMonth && styles.calendarMonthDayOutside, active && styles.calendarMonthDaySelected]}>
            <View style={[styles.calendarMonthNumberWrap, today && styles.calendarMonthToday]}><Text style={[styles.calendarMonthNumber, today && styles.calendarMonthTodayText]}>{day.getDate()}</Text></View>
            {events.slice(0, 2).map((event) => {
              const person = personMeta(event.person, event.personId);
              return <View key={event.id} style={[styles.calendarMonthEvent, { backgroundColor: person.color }]}><Text numberOfLines={1} style={styles.calendarMonthEventText}>{event.title}</Text></View>;
            })}
            {events.length > 2 && <Text style={styles.calendarMonthMore}>+{events.length - 2}</Text>}
          </Pressable>;
        })}</View>
      </View>
      <View style={styles.sectionHead}><View><Text style={styles.sectionTitle}>{selected.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</Text><Text style={styles.muted}>{selectedEvents.length ? `${selectedEvents.length} family event${selectedEvents.length === 1 ? '' : 's'}` : 'No plans yet'}</Text></View></View>
      {selectedEvents.length ? selectedEvents.map((event) => renderEvent(event)) : <View style={styles.calendarEmptyCard}><Ionicons name="calendar-clear-outline" size={25} color="#2257F4" /><View style={styles.flex}><Text style={styles.settingTitle}>This day is open</Text><Text style={styles.muted}>Add a plan or ask Coh to schedule it.</Text></View></View>}
    </>}

    {view === 'week' && <View style={styles.calendarSections}>{weekDays.map((day) => renderDaySection(day, true))}</View>}

    {view === 'agenda' && <View style={styles.calendarSections}>
      {agendaKeys.length ? agendaKeys.map((key) => renderDaySection(new Date(`${key}T12:00:00`))) : <View style={styles.calendarEmptyCard}><Ionicons name="list-outline" size={25} color="#2257F4" /><View style={styles.flex}><Text style={styles.settingTitle}>No plans in the next 30 days</Text><Text style={styles.muted}>Connect calendars or ask Coh to add the first one.</Text></View></View>}
      {unscheduledEvents.length > 0 && <View style={styles.calendarDaySection}><View style={styles.calendarDayHeading}><View style={styles.calendarAgendaDate}><Ionicons name="help" size={17} color="#D7550D" /></View><View style={styles.flex}><Text style={styles.calendarDayTitle}>Needs a date</Text><Text style={styles.muted}>{unscheduledEvents.length} imported or incomplete item{unscheduledEvents.length === 1 ? '' : 's'}</Text></View></View>{unscheduledEvents.map((event) => renderEvent(event, true))}</View>}
    </View>}

    <View style={styles.calendarBottomActions}>
      <Pressable onPress={onAdd} style={styles.calendarAddAction}><Ionicons name="add-circle" size={21} color="#fff" /><View style={styles.flex}><Text style={styles.calendarAddActionTitle}>Add to your family calendar</Text><Text style={styles.calendarAddActionDetail}>Manual · Coh · email suggestion · calendar import</Text></View><Ionicons name="chevron-forward" size={18} color="#fff" /></Pressable>
      <Pressable onPress={onManage} style={styles.syncCard}><Ionicons name="sync" size={18} color="#2257F4" /><View style={styles.flex}><Text style={styles.syncTitle}>Calendar connections</Text><Text style={styles.muted}>Apple, Google, Outlook, and other sources</Text></View><Text style={styles.link}>Manage</Text></Pressable>
    </View>
  </ScrollView>;
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

function ChatScreen({
  styles,
  messages,
  mode,
  setMode,
  draft,
  setDraft,
  onSend,
  onAdd,
  onVoice,
  onRetry,
  onConfirm,
  onCancel,
  onChange,
  onOpenAction,
  voiceRecording,
  voiceSending,
  cohThinking,
}: any) {
  const cohActive = mode === 'coh';
  const assistantBusy = cohActive && cohThinking;
  const assistantVoiceBusy = cohActive && (voiceRecording || voiceSending);
  const composerBusy = assistantBusy || assistantVoiceBusy;
  const visibleMessages = messages.filter((message: ChatMessage) => messageChannel(message) === mode);
  const messageListRef = useRef<FlatList<ChatMessage>>(null);

  useEffect(() => {
    if (!visibleMessages.length && !assistantBusy && !assistantVoiceBusy) return;
    const frame = requestAnimationFrame(() => {
      messageListRef.current?.scrollToEnd({ animated: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [visibleMessages.length, mode, assistantBusy, assistantVoiceBusy]);

  return <View style={styles.flex}>
    <View style={styles.chatModeTabs}>
      <Pressable onPress={() => setMode('family')} style={[styles.chatModeTab, mode === 'family' && styles.chatModeTabActive]}>
        <Ionicons name="people" size={16} color={mode === 'family' ? '#fff' : styles.iconColor.color} />
        <Text style={[styles.chatModeText, mode === 'family' && styles.chatModeTextActive]}>Family chat</Text>
      </Pressable>
      <Pressable onPress={() => setMode('coh')} style={[styles.chatModeTab, mode === 'coh' && styles.chatModeCohActive]}>
        <Ionicons name="sparkles" size={16} color={mode === 'coh' ? '#fff' : '#7047EE'} />
        <Text style={[styles.chatModeText, mode === 'coh' && styles.chatModeTextActive]}>Ask Coh</Text>
      </Pressable>
    </View>
    <FlatList
      ref={messageListRef}
      data={visibleMessages}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.messageList}
      automaticallyAdjustKeyboardInsets
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      renderItem={({ item }) => <View style={[styles.messageWrap, item.mine && styles.messageMine]}>
        {!item.mine && <View style={[styles.avatar, item.bot ? styles.botAvatar : styles.chatAvatar]}>
          {item.bot
            ? <Ionicons name="sparkles" size={17} color="#fff" />
            : <Text style={styles.avatarText}>{initials(item.author)}</Text>}
        </View>}
        <View style={styles.messageBody}>
          <Text style={[styles.messageAuthor, item.mine && styles.messageAuthorMine, item.bot && styles.botAuthor]}>{item.author}</Text>
          <View style={[styles.messageBubble, item.mine && styles.messageBubbleMine, item.bot && styles.botBubble]}>
            <MentionText text={item.text} mine={item.mine} styles={styles} />
          </View>
          {item.delivery === 'sending' && <Text style={[styles.messageDelivery, item.mine && styles.messageDeliveryMine]}>Sending…</Text>}
          {item.delivery === 'failed' && <View style={[styles.messageFailure, item.mine && styles.messageFailureMine]}>
            <Ionicons name="cloud-offline-outline" size={14} color="#C74732" />
            <Text style={styles.messageFailureText}>Not delivered</Text>
            {item.channel === 'coh' && item.requestId && item.retryable !== false && <Pressable disabled={assistantBusy} onPress={() => onRetry(item)} style={styles.messageRetryButton}>
              <Ionicons name="refresh" size={13} color="#7047EE" />
              <Text style={styles.messageRetryText}>Retry safely</Text>
            </Pressable>}
          </View>}
          {item.bot && item.cohResponse && <CohActionCard
            styles={styles}
            response={item.cohResponse}
            busy={assistantBusy}
            onConfirm={() => onConfirm(item.cohResponse)}
            onCancel={() => onCancel(item.cohResponse)}
            onChange={() => onChange(item.cohResponse)}
            onOpen={() => onOpenAction(item.cohResponse)}
          />}
        </View>
      </View>}
      ListHeaderComponent={cohActive
        ? <View style={styles.botHint}><Ionicons name="sparkles" size={15} color="#7047EE" /><Text style={styles.botHintText}>Private Coh workspace · type, speak, or share screenshots and PDFs into Coho.</Text></View>
        : <View style={styles.chatHeader}><View style={styles.homeThreadIcon}><Ionicons name="home" size={20} color="#F5A623" /></View><View><Text style={styles.chatTitle}>Everyone</Text><Text style={styles.muted}>Family messages only</Text></View></View>}
      ListEmptyComponent={<View style={styles.emptyChat}><Ionicons name={cohActive ? 'sparkles-outline' : 'chatbubbles-outline'} size={28} color={cohActive ? '#7047EE' : styles.iconColor.color} /><Text style={styles.settingTitle}>{cohActive ? 'Ask Coh to organize something' : 'Start the family conversation'}</Text></View>}
      ListFooterComponent={cohActive && (assistantBusy || voiceRecording || voiceSending)
        ? <View style={styles.cohThinking}><Ionicons name={voiceRecording ? 'mic' : 'sparkles'} size={15} color={voiceRecording ? '#E94F64' : '#7047EE'} /><Text style={styles.botAuthor}>{voiceRecording ? 'Listening… tap the red microphone to send' : voiceSending ? 'Coh is transcribing…' : 'Coh is thinking…'}</Text></View>
        : null}
    />
    <View style={[styles.composeRow, cohActive && styles.composeRowCoh]}>
      <Pressable
        accessibilityLabel={cohActive ? (voiceRecording ? 'Stop and send voice request' : 'Speak to Coh') : 'Add'}
        disabled={cohActive && assistantBusy && !voiceRecording}
        onPress={cohActive ? onVoice : onAdd}
        style={[
          styles.composePlus,
          cohActive && styles.composeCohBadge,
          voiceRecording && { backgroundColor: '#E94F64' },
          cohActive && assistantBusy && !voiceRecording && { opacity: .55 },
        ]}
      >
        {cohActive ? <Ionicons name={voiceRecording ? 'stop' : 'mic'} size={18} color="#fff" /> : <Ionicons name="add" size={22} color="#2257F4" />}
      </Pressable>
      <TextInput
        value={draft}
        onChangeText={setDraft}
        placeholder={cohActive && voiceRecording ? 'Listening…' : assistantBusy ? 'Coh is thinking…' : cohActive ? 'Ask Coh anything about home…' : 'Message your family…'}
        placeholderTextColor="#8B93A5"
        editable={!composerBusy}
        style={[styles.composeInput, cohActive && styles.composeInputCoh]}
        returnKeyType="send"
        onSubmitEditing={onSend}
      />
      <Pressable disabled={composerBusy} onPress={onSend} style={[styles.sendButton, cohActive && styles.sendButtonCoh, composerBusy && { opacity: .55 }]}>
        <Ionicons name={cohActive ? 'sparkles' : 'send'} size={17} color="#fff" />
      </Pressable>
    </View>
  </View>;
}

function CohActionCard({
  styles,
  response,
  busy,
  onConfirm,
  onCancel,
  onChange,
  onOpen,
}: {
  styles: any;
  response: CohResponse;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onChange: () => void;
  onOpen: () => void;
}) {
  const actionType = response.proposed_action?.type ?? 'none';
  const hasAction = actionType !== 'none' || Boolean(response.action);
  if (!hasAction) return null;

  const action = response.action;
  const missing = response.missing_fields?.length
    ? response.missing_fields
    : action?.missingFields ?? [];
  const ready = response.status === 'ready_for_confirmation'
    && action?.status === 'pending_approval';
  const created = Boolean(action?.targetId)
    || ['scheduled', 'in_progress', 'completed'].includes(action?.status ?? '');
  const canceled = response.status === 'canceled' || action?.status === 'canceled';
  const superseded = action?.status === 'superseded';
  const rows = cohDraftRows(response);
  const title = response.draft?.title || cohActionLabel(actionType);

  return <View style={[
    styles.cohActionCard,
    ready && styles.cohActionCardReady,
    created && styles.cohActionCardCreated,
    (canceled || superseded) && styles.cohActionCardCanceled,
  ]}>
    <View style={styles.cohActionHeader}>
      <View style={[styles.cohActionIcon, created && styles.cohActionIconCreated]}>
        <Ionicons
          name={created ? 'checkmark' : canceled ? 'close' : cohActionIcon(actionType)}
          size={16}
          color="#fff"
        />
      </View>
      <View style={styles.flex}>
        <Text style={styles.cohActionEyebrow}>
          {created
            ? 'CREATED BY COH'
            : canceled
              ? 'PROPOSAL CANCELED'
              : superseded
                ? 'UPDATED IN A LATER MESSAGE'
                : ready
                  ? 'READY FOR YOUR APPROVAL'
                  : 'COH IS BUILDING THIS'}
        </Text>
        <Text style={styles.cohActionTitle}>{title}</Text>
      </View>
    </View>

    {rows.map((row) => <View key={row.label} style={styles.cohActionRow}>
      <Text style={styles.cohActionLabel}>{row.label}</Text>
      <Text style={styles.cohActionValue}>{row.value}</Text>
    </View>)}

    {!created && !canceled && missing.length > 0 && <View style={styles.cohMissingBox}>
      <Ionicons name="help-circle" size={16} color="#A76400" />
      <Text style={styles.cohMissingText}>Still needed: {missing.map(cohFieldLabel).join(', ')}</Text>
    </View>}

    {ready && <View style={styles.cohActionButtons}>
      <Pressable disabled={busy} onPress={onConfirm} style={[styles.cohPrimaryAction, busy && styles.cohActionDisabled]}>
        <Ionicons name="checkmark-circle" size={17} color="#fff" />
        <Text style={styles.cohPrimaryActionText}>Confirm & create</Text>
      </Pressable>
      <View style={styles.cohSecondaryActionRow}>
        <Pressable disabled={busy} onPress={onChange} style={styles.cohSecondaryAction}>
          <Ionicons name="create-outline" size={15} color="#7047EE" />
          <Text style={styles.cohSecondaryActionText}>Change</Text>
        </Pressable>
        <Pressable disabled={busy} onPress={onCancel} style={styles.cohDangerAction}>
          <Ionicons name="close-circle-outline" size={15} color="#C74732" />
          <Text style={styles.cohDangerActionText}>Cancel</Text>
        </Pressable>
      </View>
    </View>}

    {created && <Pressable disabled={busy} onPress={onOpen} style={styles.cohOpenAction}>
      <Text style={styles.cohOpenActionText}>Open {cohActionTargetLabel(action?.targetTable, actionType)}</Text>
      <Ionicons name="arrow-forward-circle" size={18} color="#167D62" />
    </Pressable>}
  </View>;
}

function normalizeRestoredCohResponse(
  response: CohResponse | undefined,
  activeAction: CohResponse['action'],
) {
  if (!response?.action || response.status !== 'ready_for_confirmation') {
    return response;
  }
  const stillPending = activeAction?.status === 'pending_approval'
    && response.action.id === activeAction.id
    && response.action.version === activeAction.version
    && response.action.proposalHash === activeAction.proposalHash;
  return stillPending
    ? { ...response, action: activeAction }
    : supersedeCohResponse(response);
}

function supersedeCohResponse(response: CohResponse): CohResponse {
  if (!response.action) return response;
  return {
    ...response,
    status: 'collecting',
    action: {
      ...response.action,
      status: 'superseded',
    },
  };
}

function cohDraftRows(response: CohResponse) {
  const draft = response.draft;
  const rows: Array<{ label: string; value: string }> = [];
  if (!draft) return rows;
  if (draft.person) rows.push({ label: 'For', value: draft.person });
  const schedule = formatCohSchedule(draft);
  if (schedule) rows.push({ label: draft.due_at ? 'Due' : 'When', value: schedule });
  if (draft.location) rows.push({ label: 'Where', value: draft.location });
  if (draft.reminder_minutes != null) {
    rows.push({
      label: 'Reminder',
      value: draft.reminder_minutes === 0 ? 'At start time' : `${draft.reminder_minutes} minutes before`,
    });
  }
  if (draft.recurrence_rule) rows.push({ label: 'Repeats', value: friendlyRecurrence(draft.recurrence_rule) });
  if (draft.reward_type) {
    const reward = [
      draft.reward_value != null ? String(draft.reward_value) : '',
      draft.reward_label || draft.reward_type.replace('_', ' '),
    ].filter(Boolean).join(' ');
    rows.push({ label: 'Reward', value: reward });
  }
  if (draft.grocery_items?.length) {
    rows.push({ label: 'Groceries', value: `${draft.grocery_items.length} item${draft.grocery_items.length === 1 ? '' : 's'}` });
  }
  if (draft.meals?.length) {
    rows.push({ label: 'Meal plan', value: `${draft.meals.length} meal${draft.meals.length === 1 ? '' : 's'}` });
  }
  if (draft.notes && response.intent === 'note') rows.push({ label: 'Note', value: draft.notes });
  return rows.slice(0, 7);
}

function formatCohSchedule(draft: CohDraft) {
  const timestamp = draft.starts_at || draft.due_at;
  if (timestamp) {
    const value = new Date(timestamp);
    if (!Number.isNaN(value.getTime())) {
      return value.toLocaleString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    }
  }
  return [draft.date, draft.time].filter(Boolean).join(' at ');
}

function friendlyRecurrence(rule: string) {
  if (/FREQ=DAILY/i.test(rule)) return 'Daily';
  if (/FREQ=WEEKLY/i.test(rule) && /INTERVAL=2/i.test(rule)) return 'Every 2 weeks';
  if (/FREQ=WEEKLY/i.test(rule)) return 'Weekly';
  if (/FREQ=MONTHLY/i.test(rule)) return 'Monthly';
  return rule;
}

function cohActionLabel(type: CohResponse['proposed_action']['type']) {
  if (type === 'create_event') return 'Family calendar event';
  if (type === 'create_chore') return 'Family chore';
  if (type === 'create_note') return 'Family note';
  if (type === 'add_grocery_items') return 'Grocery list';
  if (type === 'create_meal_plan') return 'Family meal plan';
  return 'Household action';
}

function cohActionIcon(type: CohResponse['proposed_action']['type']): any {
  if (type === 'create_event') return 'calendar';
  if (type === 'create_chore') return 'checkbox';
  if (type === 'create_note') return 'document-text';
  if (type === 'add_grocery_items') return 'cart';
  if (type === 'create_meal_plan') return 'restaurant';
  return 'sparkles';
}

function cohActionTargetLabel(targetTable: string | null | undefined, type: CohResponse['proposed_action']['type']) {
  if (targetTable === 'events' || type === 'create_event') return 'event';
  if (targetTable === 'chores' || type === 'create_chore') return 'chore';
  if (targetTable === 'notes' || type === 'create_note') return 'note';
  if (targetTable === 'grocery_items' || type === 'add_grocery_items') return 'grocery list';
  if (targetTable === 'meal_plans' || type === 'create_meal_plan') return 'meal plan';
  return 'created item';
}

function cohFieldLabel(field: string) {
  const labels: Record<string, string> = {
    title: 'title',
    person: 'family member',
    date: 'date',
    time: 'time',
    starts_at: 'date and time',
    due_at: 'due date',
    location: 'place',
    reminder_minutes: 'reminder',
    reward_type: 'reward',
    grocery_items: 'items',
    meals: 'meals',
  };
  return labels[field] ?? field.replace(/_/g, ' ');
}

function messageChannel(message: ChatMessage): ChatChannel {
  if (message.channel) return message.channel;
  return message.bot || /(@coh|hey coh)\b/i.test(message.text) ? 'coh' : 'family';
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
  if (provider === 'device-calendar') return 'iPhone calendar';
  return 'Coho';
}

function calendarSourceColor(provider?: string) {
  if (provider === 'google') return '#4285F4';
  if (provider === 'outlook') return '#0078D4';
  if (provider === 'apple') return '#5A667A';
  if (provider === 'device-calendar') return '#5A667A';
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
  const ink = stableCalendarColor(person.id || person.display_name || String(index));
  const color = `${ink}18`;
  return {
    id: person.id,
    linkedUserId: person.linked_user_id,
    membershipRole: person.membership_role ?? null,
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
  const assignedPerson = Array.isArray(row.assigned_person) ? row.assigned_person[0] : row.assigned_person;
  let metadata: any = {};
  try { metadata = row.details ? JSON.parse(row.details) : {}; } catch { metadata = {}; }
  return {
    id: `cloud-${row.id}`,
    sourceId: row.id,
    title: row.title,
    person: assignedPerson?.display_name || metadata.person || relatedName(row.creator, 'Family'),
    personId: row.assigned_person_id || assignedPerson?.id || undefined,
    day: startsAt.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }),
    dateISO: localDateKey(startsAt),
    time: row.all_day ? 'All day' : startsAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
    place: row.location || undefined,
    reminder: typeof metadata.reminder === 'number' ? metadata.reminder : undefined,
    directions: typeof metadata.directions === 'boolean' ? metadata.directions : undefined,
    provider: row.provider || 'coho',
    sourceCalendarId: row.source_calendar_id || undefined,
    recurrenceRule: row.recurrence_rule || undefined,
    allDay: Boolean(row.all_day),
  };
}

function expandCloudEvent(row: any): BotEvent[] {
  const base = cloudEvent(row);
  const frequency = row.provider === 'coho'
    ? String(row.recurrence_rule ?? '').match(/FREQ=(DAILY|WEEKLY|MONTHLY)/)?.[1]
    : null;
  if (!frequency) return [base];

  const originalStart = new Date(row.starts_at);
  if (Number.isNaN(originalStart.getTime())) return [base];
  const originalEnd = row.ends_at ? new Date(row.ends_at) : null;
  const duration = originalEnd && !Number.isNaN(originalEnd.getTime())
    ? Math.max(0, originalEnd.getTime() - originalStart.getTime())
    : null;
  const windowStart = new Date();
  windowStart.setHours(0, 0, 0, 0);
  windowStart.setDate(windowStart.getDate() - 31);
  const windowEnd = new Date(windowStart);
  windowEnd.setDate(windowEnd.getDate() + 397);

  const anchorDay = originalStart.getDate();
  const occurrences: BotEvent[] = [];
  let cursor = new Date(originalStart);
  let guard = 0;
  while (cursor <= windowEnd && guard < 5000) {
    if (cursor >= windowStart) {
      const startsAt = cursor.toISOString();
      const event = cloudEvent({
        ...row,
        starts_at: startsAt,
        ends_at: duration === null ? null : new Date(cursor.getTime() + duration).toISOString(),
      });
      event.id = `cloud-${row.id}-${startsAt}`;
      occurrences.push(event);
    }
    cursor = nextRecurringDate(cursor, frequency, anchorDay);
    guard += 1;
  }
  return occurrences.length ? occurrences : [base];
}

function nextRecurringDate(current: Date, frequency: string, anchorDay: number) {
  const next = new Date(current);
  if (frequency === 'DAILY') {
    next.setDate(next.getDate() + 1);
  } else if (frequency === 'WEEKLY') {
    next.setDate(next.getDate() + 7);
  } else {
    next.setDate(1);
    next.setMonth(next.getMonth() + 1);
    const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    next.setDate(Math.min(anchorDay, lastDay));
  }
  return next;
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

function formatReminderLead(minutes: number) {
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? '' : 's'}`;
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? '' : 's'}`;
  return `${minutes} minutes`;
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

function defaultEventForm(profiles: FamilyProfile[], currentUserId: string | null): EventFormValue {
  const startsAt = new Date();
  startsAt.setSeconds(0, 0);
  startsAt.setMinutes(Math.ceil(startsAt.getMinutes() / 30) * 30);
  if (startsAt.getTime() < Date.now() + 30 * 60_000) startsAt.setTime(startsAt.getTime() + 30 * 60_000);
  const endsAt = new Date(startsAt.getTime() + 60 * 60_000);
  const currentPerson = profiles.find((profile) => profile.linkedUserId === currentUserId) ?? null;
  return {
    title: '',
    details: '',
    assignedPersonId: currentPerson?.id ?? null,
    startsAt,
    endsAt,
    allDay: false,
    location: '',
    recurrenceRule: null,
    reminderMinutes: 15,
    writeToDevice: false,
  };
}

function mergeEventDate(current: Date, next: Date, mode: 'date' | 'time') {
  const merged = new Date(current);
  if (mode === 'date') {
    merged.setFullYear(next.getFullYear(), next.getMonth(), next.getDate());
  } else {
    merged.setHours(next.getHours(), next.getMinutes(), 0, 0);
  }
  return merged;
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
  return <ScrollView contentContainerStyle={styles.scrollContent}><View style={styles.familyHero}><View style={styles.flex}><Text style={styles.progressLabel}>YOUR HOUSEHOLD</Text><Text style={styles.familyHeroTitle}>{profiles.length} family members</Text><Text style={styles.muted}>Profiles help Coh personalize schedules, rewards, reminders, and recaps.</Text></View><Pressable onPress={onAdd} style={styles.addProfileButton}><Ionicons name="person-add" size={20} color="#fff" /></Pressable></View><Pressable onPress={onInvite} style={styles.inviteFamilyCard}><View style={styles.inviteFamilyIcon}><Ionicons name="mail-unread" size={21} color="#fff" /></View><View style={styles.flex}><Text style={styles.settingTitle}>Invite another family member</Text><Text style={styles.muted}>Create a secure household invitation and share it from your iPhone.</Text></View><Ionicons name="chevron-forward" size={19} color={styles.iconColor.color} /></Pressable><Text style={styles.sectionTitle}>People</Text>{profiles.map((profile) => <Pressable key={profile.id} onPress={() => onEdit(profile)} style={styles.profileRow}><ProfileAvatar profile={profile} styles={styles} size="large" /><View style={styles.flex}><Text style={styles.profileName}>{profile.name || 'New family member'}</Text><Text style={styles.muted}>{profile.membershipRole === 'owner' ? 'Household owner' : profile.role}{profile.dob ? ` · Born ${profile.dob}` : ''}</Text><Text numberOfLines={1} style={styles.profileBio}>{profile.bio || 'Add a bio, interests, allergies, school, or anything Coh should know.'}</Text></View><Ionicons name="create-outline" size={20} color={styles.iconColor.color} /></Pressable>)}<Pressable onPress={onAdd} style={styles.outlineAction}><Ionicons name="person-add-outline" size={19} color="#2257F4" /><Text style={styles.outlineActionText}>Add family profile</Text></Pressable></ScrollView>;
}

function ProfileAvatar({ profile, styles, size }: { profile: FamilyProfile; styles: any; size?: string }) {
  const initials = profile.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';
  return <View style={[styles.profileAvatar, size === 'large' && styles.profileAvatarLarge, { backgroundColor: profile.color }]}>{profile.avatarUri ? <Image source={{ uri: profile.avatarUri }} style={styles.profileAvatarImage} /> : <Text style={[styles.avatarText, { color: profile.ink }]}>{initials}</Text>}</View>;
}

function ProfileEditorModal({ visible, profile, styles, dark, onClose, onSave, onDelete, canDelete }: any) {
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
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}><Pressable style={styles.modalDismiss} onPress={onClose} /><ScrollView style={styles.profileSheet} contentContainerStyle={styles.profileSheetContent} keyboardShouldPersistTaps="handled"><View style={styles.modalHandle} /><View style={styles.modalHead}><View><Text style={styles.eyebrow}>FAMILY PROFILE</Text><Text style={styles.modalTitle}>{draft.name ? `Edit ${draft.name}` : 'Add someone'}</Text></View><Pressable onPress={onClose} style={styles.iconButton}><Ionicons name="close" size={21} color={styles.iconColor.color} /></Pressable></View><Pressable onPress={choosePhoto} style={styles.photoEditor}><ProfileAvatar profile={draft} styles={styles} size="large" /><View><Text style={styles.settingTitle}>Profile picture</Text><Text style={styles.link}>Choose from Photos</Text></View></Pressable><Text style={styles.fieldLabel}>NAME</Text><TextInput value={draft.name} onChangeText={(name) => update({ name })} placeholder="Full name" placeholderTextColor="#8B93A5" style={styles.modalInput} /><Text style={styles.fieldLabel}>DATE OF BIRTH</Text><TextInput value={draft.dob} onChangeText={(dob) => update({ dob })} placeholder="YYYY-MM-DD" placeholderTextColor="#8B93A5" keyboardType="numbers-and-punctuation" style={styles.modalInput} /><Text style={styles.fieldLabel}>ROLE</Text><View style={styles.chipRow}>{(['Adult admin', 'Family member', 'Child'] as FamilyProfile['role'][]).map((role) => <Pressable key={role} onPress={() => update({ role })} style={[styles.choiceChip, draft.role === role && styles.choiceChipActive]}><Text style={[styles.choiceChipText, draft.role === role && styles.choiceChipTextActive]}>{role}</Text></Pressable>)}</View><Text style={styles.fieldLabel}>ABOUT</Text><TextInput value={draft.bio} onChangeText={(bio) => update({ bio })} multiline placeholder="Interests, allergies, school, preferences, or anything useful for the family" placeholderTextColor="#8B93A5" style={[styles.modalInput, styles.modalTextArea]} /><Text style={styles.profilePrivacy}>This information stays inside your Coho household and is used to personalize family assistance.</Text><Pressable disabled={!draft.name.trim()} onPress={() => onSave(draft)} style={[styles.saveButton, !draft.name.trim() && { opacity: .45 }]}><Text style={styles.saveButtonText}>Save profile</Text></Pressable>{canDelete && <Pressable onPress={() => onDelete(draft)} style={styles.deleteProfileButton}><Ionicons name="trash-outline" size={18} color="#D64545" /><Text style={styles.deleteProfileText}>{draft.linkedUserId ? 'Remove from household' : 'Delete family profile'}</Text></Pressable>}</ScrollView><StatusBar style={dark ? 'light' : 'dark'} /></KeyboardAvoidingView></Modal>;
}

function MoreMenu({ styles, setView, userId, onNotice }: { styles: any; setView: (view: MoreView) => void; userId: string | null; onNotice: (message: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [preferences, setPreferences] = useState<MoreMenuPreferences>(defaultMoreMenuPreferences);

  useEffect(() => {
    let active = true;
    void (async () => {
      const local = await AsyncStorage.getItem(moreMenuStorageKey).catch(() => null);
      const localPreferences = normalizeMoreMenuPreferences(parseMoreMenuPreferences(local));
      let next = localPreferences;
      if (userId) {
        next = await loadMoreMenuPreferences(userId)
          .then((remote) => remote
            ? normalizeMoreMenuPreferences(remote)
            : localPreferences)
          .catch(() => localPreferences);
      }
      if (active) setPreferences(next);
    })();
    return () => { active = false; };
  }, [userId]);

  async function persist(next: MoreMenuPreferences) {
    const normalized = normalizeMoreMenuPreferences(next);
    setPreferences(normalized);
    await AsyncStorage.setItem(moreMenuStorageKey, JSON.stringify(normalized));
    if (userId) {
      await saveMoreMenuPreferences(userId, normalized).catch(() => undefined);
    }
  }

  function move(title: string, offset: -1 | 1) {
    const order = [...preferences.order];
    const visibleOrder = order.filter((item) => !preferences.hidden.includes(item));
    const visibleFrom = visibleOrder.indexOf(title);
    const visibleTo = visibleFrom + offset;
    if (visibleFrom < 0 || visibleTo < 0 || visibleTo >= visibleOrder.length) return;
    const from = order.indexOf(title);
    const to = order.indexOf(visibleOrder[visibleTo]);
    [order[from], order[to]] = [order[to], order[from]];
    void persist({ ...preferences, order });
  }

  function removeFromMore(title: string) {
    void persist({
      ...preferences,
      hidden: [...new Set([...preferences.hidden, title])],
    });
    onNotice(`${title} was removed from More. You can restore it anytime.`);
  }

  function restore(title: string) {
    void persist({
      ...preferences,
      hidden: preferences.hidden.filter((item) => item !== title),
    });
    onNotice(`${title} is back in More`);
  }

  const byTitle = new Map<string, MoreMenuItem>(
    moreMenuItems.map((item) => [item.title, item]),
  );
  const orderedItems = preferences.order
    .map((title) => byTitle.get(title))
    .filter((item): item is MoreMenuItem => Boolean(item));
  const visibleItems = orderedItems.filter((item) => !preferences.hidden.includes(item.title));
  const hiddenItems = orderedItems.filter((item) => preferences.hidden.includes(item.title));

  return <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
    <View style={styles.moreToolbar}>
      <Text style={styles.moreIntro}>Everything else your household needs, without cluttering the everyday view.</Text>
      <Pressable onPress={() => setEditing((current) => !current)} style={[styles.moreCustomizeButton, editing && styles.moreCustomizeButtonActive]}>
        <Ionicons name={editing ? 'checkmark' : 'options-outline'} size={17} color={editing ? '#fff' : '#2257F4'} />
        <Text style={[styles.moreCustomizeText, editing && styles.moreCustomizeTextActive]}>{editing ? 'Done' : 'Customize'}</Text>
      </Pressable>
    </View>
    {editing && <View style={styles.moreEditingHint}><Ionicons name="information-circle-outline" size={18} color="#7047EE" /><Text style={styles.moreEditingHintText}>Move features earlier or later, or remove anything you do not use. Removing a feature never deletes its data.</Text></View>}
    <View style={styles.moreGrid}>{visibleItems.map((item, index) => <Pressable key={item.title} disabled={editing} onPress={() => setView(item.title)} style={styles.moreCard}>
      <View style={[styles.moreIcon, { backgroundColor: `${item.color}18` }]}><Ionicons name={item.icon as any} size={25} color={item.color} /></View>
      <Text style={styles.moreTitle}>{item.title}</Text>
      <Text style={styles.moreDetail}>{item.detail}</Text>
      {editing ? <View style={styles.moreEditControls}>
        <Pressable accessibilityLabel={`Move ${item.title} earlier`} disabled={index === 0} onPress={() => move(item.title, -1)} style={[styles.moreEditButton, index === 0 && styles.moreEditButtonDisabled]}><Ionicons name="arrow-back" size={16} color={styles.iconColor.color} /></Pressable>
        <Pressable accessibilityLabel={`Move ${item.title} later`} disabled={index === visibleItems.length - 1} onPress={() => move(item.title, 1)} style={[styles.moreEditButton, index === visibleItems.length - 1 && styles.moreEditButtonDisabled]}><Ionicons name="arrow-forward" size={16} color={styles.iconColor.color} /></Pressable>
        <Pressable accessibilityLabel={`Remove ${item.title} from More`} onPress={() => removeFromMore(item.title)} style={[styles.moreEditButton, styles.moreHideButton]}><Ionicons name="eye-off-outline" size={16} color="#D64545" /></Pressable>
      </View> : <Ionicons name="chevron-forward" size={18} color={styles.iconColor.color} style={styles.moreChevron} />}
    </Pressable>)}</View>
    {editing && hiddenItems.length > 0 && <>
      <Text style={styles.sectionTitle}>Removed from More</Text>
      <View style={styles.moreHiddenList}>{hiddenItems.map((item) => <View key={item.title} style={styles.moreHiddenRow}>
        <View style={[styles.moreHiddenIcon, { backgroundColor: `${item.color}18` }]}><Ionicons name={item.icon as any} size={18} color={item.color} /></View>
        <Text style={styles.moreHiddenTitle}>{item.title}</Text>
        <Pressable onPress={() => restore(item.title)} style={styles.moreRestoreButton}><Text style={styles.moreRestoreText}>Restore</Text></Pressable>
      </View>)}</View>
    </>}
    {editing && <Pressable onPress={() => void persist(defaultMoreMenuPreferences)} style={styles.moreResetButton}><Text style={styles.moreResetText}>Reset default layout</Text></Pressable>}
  </ScrollView>;
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
  const recentMessages = messages
    .filter((item: ChatMessage) => messageChannel(item) === 'family' && !item.bot)
    .slice(-5)
    .length;
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

function IntegrationsScreen({
  styles,
  connected,
  onOpenCategory,
}: {
  styles: any;
  connected: Record<string, boolean>;
  onOpenCategory: (view: IntegrationCategoryView) => void;
}) {
  return <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
    <LinearGradient colors={['#24116D', '#6648EF']} style={styles.integrationHero}>
      <View style={styles.commandCenterMark}><Ionicons name="extension-puzzle" size={22} color="#7047EE" /></View>
      <Text style={styles.recapHeroLabel}>COHO CONNECTIONS</Text>
      <Text style={styles.integrationHeroTitle}>Everything connected, nothing cluttered.</Text>
      <Text style={styles.recapHeroText}>Choose a category, then connect only the services your household trusts. Coh keeps the important output in one command center.</Text>
    </LinearGradient>
    <View style={styles.integrationCategoryGrid}>{integrationCategories.map((category) => {
      const connectedCount = category.providers.filter((provider) => connected[provider.name]).length;
      return <Pressable key={category.view} onPress={() => onOpenCategory(category.view)} style={styles.integrationCategoryCard}>
        <View style={[styles.integrationCategoryIcon, { backgroundColor: `${category.color}18` }]}><Ionicons name={category.icon as any} size={24} color={category.color} /></View>
        <Text style={styles.integrationCategoryTitle}>{category.view}</Text>
        <Text style={styles.integrationCategoryDetail}>{category.detail}</Text>
        <View style={styles.integrationCategoryFooter}><Text style={[styles.integrationCategoryCount, { color: category.color }]}>{connectedCount ? `${connectedCount} connected` : `${category.providers.length} option${category.providers.length === 1 ? '' : 's'}`}</Text><Ionicons name="chevron-forward" size={18} color={category.color} /></View>
      </Pressable>;
    })}</View>
    <View style={styles.integrationTrustCard}><Ionicons name="shield-checkmark-outline" size={22} color="#19A47B" /><View style={styles.flex}><Text style={styles.settingTitle}>Household-controlled by design</Text><Text style={styles.muted}>Connections are opt-in, visible, and removable. Inbox suggestions always require family approval before creating an action.</Text></View></View>
  </ScrollView>;
}

function IntegrationCategoryScreen({
  styles,
  view,
  connected,
  onConnect,
}: {
  styles: any;
  view: IntegrationCategoryView;
  connected: Record<string, boolean>;
  onConnect: (name: string, returnView?: IntegrationCategoryView) => void;
}) {
  const category = integrationCategories.find((item) => item.view === view)
    ?? integrationCategories[0];
  return <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
    <View style={styles.integrationCategoryHeader}>
      <View style={[styles.integrationCategoryIconLarge, { backgroundColor: `${category.color}18` }]}><Ionicons name={category.icon as any} size={27} color={category.color} /></View>
      <View style={styles.flex}><Text style={styles.eyebrow}>INTEGRATIONS</Text><Text style={styles.integrationCategoryPageTitle}>{category.view}</Text><Text style={styles.muted}>{category.detail}</Text></View>
    </View>
    {category.providers.map((provider) => {
      const active = connected[provider.name] === true;
      const actionLabel = ['iOS Notifications', 'Email Briefings'].includes(provider.name)
        ? 'Configure'
        : ['Family Inbox', 'Instacart', 'OpenTable'].includes(provider.name)
          ? 'Open'
          : active
            ? 'Manage'
            : 'Set up';
      return <View key={provider.name} style={styles.integrationProviderCard}>
        <View style={[styles.integrationIcon, { backgroundColor: `${provider.color}18` }]}><Ionicons name={provider.icon as any} size={23} color={provider.color} /></View>
        <View style={styles.flex}><View style={styles.integrationProviderTitleRow}><Text style={styles.integrationTitle}>{provider.name}</Text>{active && <View style={styles.integrationConnectedPill}><Text style={styles.integrationConnectedPillText}>CONNECTED</Text></View>}</View><Text style={styles.muted}>{provider.detail}</Text></View>
        <Pressable onPress={() => onConnect(provider.name, view)} style={[styles.connectButton, active && styles.connectedButton]}><Text style={[styles.connectText, active && styles.connectedText]}>{actionLabel}</Text></Pressable>
      </View>;
    })}
  </ScrollView>;
}

function NotificationCenterScreen({
  styles,
  prefs,
  permissionEnabled,
  onChange,
  onEnable,
  onSave,
}: {
  styles: any;
  prefs: ChiefPrefs;
  permissionEnabled: boolean;
  onChange: (value: ChiefPrefs) => void;
  onEnable: () => void;
  onSave: () => void;
}) {
  const update = (patch: Partial<ChiefPrefs>) => onChange({ ...prefs, ...patch });
  const briefingRows = [
    { key: 'daily' as const, timeKey: 'dailyTime' as const, title: 'Daily sync', detail: 'Appointments, chores, messages, and priorities', times: ['6:30 AM', '7:00 AM', '8:00 AM'] },
    { key: 'weekAhead' as const, timeKey: 'weekAheadTime' as const, title: 'Week ahead', detail: `${prefs.weekAheadDay} preparation and conflicts`, times: ['5:00 PM', '6:00 PM', '7:00 PM'] },
    { key: 'followUp' as const, timeKey: 'followUpTime' as const, title: 'Weekly follow-up', detail: `${prefs.followUpDay} unresolved appointments and actions`, times: ['4:00 PM', '5:00 PM', '6:00 PM'] },
  ];
  return <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
    <View style={[styles.notificationStatusCard, permissionEnabled && styles.notificationStatusReady]}>
      <View style={[styles.integrationIcon, { backgroundColor: permissionEnabled ? '#19A47B18' : '#FF7A2E18' }]}><Ionicons name={permissionEnabled ? 'checkmark-circle' : 'notifications-off-outline'} size={23} color={permissionEnabled ? '#19A47B' : '#FF7A2E'} /></View>
      <View style={styles.flex}><Text style={styles.settingTitle}>{permissionEnabled ? 'This iPhone is registered' : 'iOS permission is required'}</Text><Text style={styles.muted}>{permissionEnabled ? 'Your settings below are saved to your Coho profile and follow you across sessions.' : 'Enable once in iOS, then personalize what Coho sends below.'}</Text></View>
      {!permissionEnabled && <Pressable onPress={onEnable} style={styles.connectButton}><Text style={styles.connectText}>Enable</Text></Pressable>}
    </View>

    <Text style={styles.sectionTitle}>Delivery</Text>
    <View style={styles.notificationChoiceGrid}>
      <Pressable onPress={() => update({ push: !prefs.push })} style={[styles.notificationChoice, prefs.push && styles.notificationChoiceActive]}><Ionicons name="phone-portrait-outline" size={21} color={prefs.push ? '#7047EE' : styles.iconColor.color} /><View style={styles.flex}><Text style={styles.settingTitle}>Push</Text><Text style={styles.muted}>On this device</Text></View><Ionicons name={prefs.push ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={prefs.push ? '#19A47B' : styles.iconColor.color} /></Pressable>
      <Pressable onPress={() => update({ email: !prefs.email })} style={[styles.notificationChoice, prefs.email && styles.notificationChoiceActive]}><Ionicons name="mail-outline" size={21} color={prefs.email ? '#2257F4' : styles.iconColor.color} /><View style={styles.flex}><Text style={styles.settingTitle}>Email</Text><Text style={styles.muted}>Verified account</Text></View><Ionicons name={prefs.email ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={prefs.email ? '#19A47B' : styles.iconColor.color} /></Pressable>
    </View>

    <Text style={styles.sectionTitle}>Notify me about</Text>
    <View style={styles.preferenceGrid}>{([
      ['events', 'Events & reminders', 'calendar-outline'],
      ['chores', 'Chores & assignments', 'checkbox-outline'],
      ['messages', 'Family messages', 'chatbubble-outline'],
      ['followUps', 'Follow-ups', 'refresh-outline'],
    ] as const).map(([key, label, icon]) => <Pressable key={key} onPress={() => update({ [key]: !prefs[key] })} style={[styles.preferenceTile, prefs[key] && styles.preferenceTileActive]}><Ionicons name={icon} size={19} color={prefs[key] ? '#19A47B' : styles.iconColor.color} /><Text style={styles.preferenceText}>{label}</Text><Ionicons name={prefs[key] ? 'checkmark-circle' : 'ellipse-outline'} size={18} color={prefs[key] ? '#19A47B' : styles.iconColor.color} /></Pressable>)}</View>

    <Text style={styles.sectionTitle}>Scheduled briefings</Text>
    {briefingRows.map((row) => <View key={row.key} style={styles.notificationBriefingCard}>
      <View style={styles.settingRowTop}><View style={styles.flex}><Text style={styles.settingTitle}>{row.title}</Text><Text style={styles.muted}>{row.detail}</Text></View><Switch value={prefs[row.key]} onValueChange={(value) => update({ [row.key]: value })} trackColor={{ true: '#6687FF' }} /></View>
      {prefs[row.key] && <View style={styles.chipRow}>{row.times.map((time) => <Pressable key={time} onPress={() => update({ [row.timeKey]: time })} style={[styles.choiceChip, prefs[row.timeKey] === time && styles.choiceChipActive]}><Text style={[styles.choiceChipText, prefs[row.timeKey] === time && styles.choiceChipTextActive]}>{time}</Text></Pressable>)}</View>}
    </View>)}

    <Text style={styles.sectionTitle}>Quiet hours</Text>
    <View style={styles.settingRow}><Ionicons name="moon-outline" size={21} color="#7047EE" /><View style={styles.flex}><Text style={styles.settingTitle}>9:00 PM–7:00 AM</Text><Text style={styles.muted}>Non-urgent notifications wait until morning. Urgent alerts still arrive.</Text></View><Switch value={prefs.quietHours} onValueChange={(quietHours) => update({ quietHours })} trackColor={{ true: '#6687FF' }} /></View>

    <Pressable onPress={onSave} style={styles.saveButton}><Text style={styles.saveButtonText}>Save notification profile</Text></Pressable>
    <Pressable onPress={() => void Linking.openSettings()} style={styles.notificationSystemLink}><Ionicons name="settings-outline" size={17} color="#2257F4" /><Text style={styles.link}>Open iOS notification settings</Text></Pressable>
  </ScrollView>;
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

function ManualEventModal({
  visible,
  profiles,
  currentUserId,
  styles,
  dark,
  saving,
  onClose,
  onSave,
}: {
  visible: boolean;
  profiles: FamilyProfile[];
  currentUserId: string | null;
  styles: any;
  dark: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: (value: EventFormValue) => Promise<void>;
}) {
  const [draft, setDraft] = useState<EventFormValue>(() => defaultEventForm(profiles, currentUserId));
  useEffect(() => {
    if (visible) setDraft(defaultEventForm(profiles, currentUserId));
  }, [visible, currentUserId, profiles.length]);
  const update = (patch: Partial<EventFormValue>) => setDraft((current) => ({ ...current, ...patch }));
  const invalid = !draft.title.trim() || draft.endsAt.getTime() <= draft.startsAt.getTime();
  const repeatOptions = [
    { label: 'Does not repeat', rule: null },
    { label: 'Daily', rule: 'FREQ=DAILY' },
    { label: 'Weekly', rule: 'FREQ=WEEKLY' },
    { label: 'Monthly', rule: 'FREQ=MONTHLY' },
  ];
  const reminderOptions: Array<{ label: string; value: number | null }> = [
    { label: 'None', value: null },
    { label: '15 min', value: 15 },
    { label: '30 min', value: 30 },
    { label: '1 hour', value: 60 },
    { label: '1 day', value: 1440 },
  ];
  function changeStart(next: Date, mode: 'date' | 'time') {
    const oldDuration = Math.max(30 * 60_000, draft.endsAt.getTime() - draft.startsAt.getTime());
    const startsAt = mergeEventDate(draft.startsAt, next, mode);
    const endsAt = mode === 'date'
      ? mergeEventDate(draft.endsAt, next, 'date')
      : new Date(startsAt.getTime() + oldDuration);
    update({ startsAt, endsAt: endsAt > startsAt ? endsAt : new Date(startsAt.getTime() + oldDuration) });
  }
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
      <Pressable style={styles.modalDismiss} onPress={onClose} />
      <View style={[styles.modalSheet, styles.choreModalSheet]}>
        <View style={styles.modalHandle} />
        <View style={styles.modalHead}>
          <View style={styles.flex}>
            <Text style={styles.eyebrow}>MANUAL EVENT</Text>
            <Text style={styles.modalTitle}>Add to the family calendar</Text>
            <Text style={styles.muted}>This works independently of Coh and saves directly to your shared calendar.</Text>
          </View>
          <Pressable onPress={onClose} style={styles.iconButton}><Ionicons name="close" size={21} color={styles.iconColor.color} /></Pressable>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.choreFormContent}>
          <Text style={styles.fieldLabel}>EVENT TITLE</Text>
          <TextInput value={draft.title} onChangeText={(title) => update({ title })} autoFocus placeholder="What is happening?" placeholderTextColor="#8B93A5" style={styles.modalInput} />

          <View style={styles.manualEventToggle}>
            <View style={styles.flex}><Text style={styles.settingTitle}>All-day event</Text><Text style={styles.muted}>Hide start and end times</Text></View>
            <Switch value={draft.allDay} onValueChange={(allDay) => update({ allDay })} trackColor={{ true: '#6687FF' }} />
          </View>

          <Text style={styles.fieldLabel}>DATE</Text>
          <View style={styles.manualDateField}>
            <Ionicons name="calendar-outline" size={18} color="#2257F4" />
            <DateTimePicker value={draft.startsAt} mode="date" display={Platform.OS === 'ios' ? 'compact' : 'default'} themeVariant={dark ? 'dark' : 'light'} onChange={(_, next) => next && changeStart(next, 'date')} />
          </View>

          {!draft.allDay && <>
            <Text style={styles.fieldLabel}>START & END</Text>
            <View style={styles.choreDateRow}>
              <View style={styles.choreDateField}><Text style={styles.timeFieldLabel}>START</Text><DateTimePicker value={draft.startsAt} mode="time" minuteInterval={5} display={Platform.OS === 'ios' ? 'compact' : 'default'} themeVariant={dark ? 'dark' : 'light'} onChange={(_, next) => next && changeStart(next, 'time')} /></View>
              <View style={styles.choreDateField}><Text style={styles.timeFieldLabel}>END</Text><DateTimePicker value={draft.endsAt} mode="time" minuteInterval={5} display={Platform.OS === 'ios' ? 'compact' : 'default'} themeVariant={dark ? 'dark' : 'light'} onChange={(_, next) => next && update({ endsAt: mergeEventDate(draft.endsAt, next, 'time') })} /></View>
            </View>
            {draft.endsAt <= draft.startsAt && <Text style={styles.inlineError}>End time must be after the start time.</Text>}
          </>}

          <Text style={styles.fieldLabel}>WHO IS THIS FOR?</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choreOwnerChoices}>
            <Pressable onPress={() => update({ assignedPersonId: null })} style={[styles.choreOwnerChip, draft.assignedPersonId === null && styles.choreOwnerChipActive]}>
              <Ionicons name="people-outline" size={16} color={draft.assignedPersonId === null ? '#fff' : styles.iconColor.color} />
              <Text style={[styles.choreOwnerText, draft.assignedPersonId === null && styles.choreOwnerTextActive]}>Everyone</Text>
            </Pressable>
            {profiles.map((profile) => {
              const active = draft.assignedPersonId === profile.id;
              return <Pressable key={profile.id} onPress={() => update({ assignedPersonId: profile.id })} style={[styles.choreOwnerChip, active && styles.choreOwnerChipActive]}>
                <View style={[styles.choreOwnerAvatar, { backgroundColor: active ? '#fff' : profile.color }]}><Text style={[styles.avatarText, { color: active ? '#2257F4' : profile.ink }]}>{initials(profile.name)}</Text></View>
                <Text style={[styles.choreOwnerText, active && styles.choreOwnerTextActive]}>{profile.name}</Text>
              </Pressable>;
            })}
          </ScrollView>

          <Text style={styles.fieldLabel}>LOCATION</Text>
          <TextInput value={draft.location} onChangeText={(location) => update({ location })} placeholder="Place or address" placeholderTextColor="#8B93A5" style={styles.modalInput} />

          <Text style={styles.fieldLabel}>REPEAT</Text>
          <View style={styles.choreOptionWrap}>{repeatOptions.map((option) => {
            const active = draft.recurrenceRule === option.rule;
            return <Pressable key={option.label} onPress={() => update({ recurrenceRule: option.rule })} style={[styles.choiceChip, active && styles.choiceChipActive]}><Text style={[styles.choiceChipText, active && styles.choiceChipTextActive]}>{option.label}</Text></Pressable>;
          })}</View>

          <Text style={styles.fieldLabel}>REMINDER</Text>
          <View style={styles.choreOptionWrap}>{reminderOptions.map((option) => {
            const active = draft.reminderMinutes === option.value;
            return <Pressable key={option.label} onPress={() => update({ reminderMinutes: option.value })} style={[styles.choiceChip, active && styles.choiceChipActive]}><Text style={[styles.choiceChipText, active && styles.choiceChipTextActive]}>{option.label}</Text></Pressable>;
          })}</View>

          <Text style={styles.fieldLabel}>NOTES</Text>
          <TextInput value={draft.details} onChangeText={(details) => update({ details })} multiline placeholder="Confirmation number, instructions, links, or preparation details" placeholderTextColor="#8B93A5" style={[styles.modalInput, styles.modalTextArea]} />

          <View style={styles.manualEventToggle}>
            <View style={styles.flex}><Text style={styles.settingTitle}>Also copy to my phone calendar</Text><Text style={styles.muted}>Uses the write-back calendar selected in Calendar connections</Text></View>
            <Switch value={draft.writeToDevice} onValueChange={(writeToDevice) => update({ writeToDevice })} trackColor={{ true: '#6687FF' }} />
          </View>

          <Pressable disabled={invalid || saving} onPress={() => void onSave(draft)} style={[styles.saveButton, (invalid || saving) && styles.disabled]}>
            <Text style={styles.saveButtonText}>{saving ? 'Adding event…' : 'Add event'}</Text>
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
  onEventSource,
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
      <View style={[styles.modalSheet, (type === 'Chore' || type === 'Event') && styles.choreModalSheet]}>
        <View style={styles.modalHandle} />
        <View style={styles.modalHead}>
          <View><Text style={styles.eyebrow}>QUICK ADD</Text><Text style={styles.modalTitle}>Share with the family</Text></View>
          <Pressable onPress={onClose} style={styles.iconButton}><Ionicons name="close" size={21} color={styles.iconColor.color} /></Pressable>
        </View>
        <View style={styles.typeTabs}>{['Event', 'Chore', 'Note', 'Message'].map((item) => <Pressable key={item} onPress={() => setType(item)} style={[styles.typeTab, type === item && styles.typeTabActive]}><Text style={[styles.typeTabText, type === item && styles.typeTabTextActive]}>{item}</Text></Pressable>)}</View>
        {type === 'Event' ? <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.eventEntryContent}>
          <Text style={styles.eventEntryGroupLabel}>CREATE</Text>
          <View style={styles.eventEntryGrid}>
            <EventEntryChoice styles={styles} icon="create-outline" color="#2257F4" title="Enter manually" detail="Date, time, people, repeat, place, and reminder" onPress={() => onEventSource('manual')} />
            <EventEntryChoice styles={styles} icon="sparkles" color="#7047EE" title="Ask Coh" detail="Describe it naturally; Coh asks for missing details" onPress={() => onEventSource('coh')} />
          </View>
          <Text style={styles.eventEntryGroupLabel}>BRING INTO COHO</Text>
          <View style={styles.eventEntryGrid}>
            <EventEntryChoice styles={styles} icon="mail-unread-outline" color="#FF7A2E" title="Find in email" detail="Review and approve events found in Family Inbox" onPress={() => onEventSource('email')} />
            <EventEntryChoice styles={styles} icon="calendar-outline" color="#19A47B" title="Import from calendar" detail="Connect a provider and choose calendars to sync" onPress={() => onEventSource('calendar')} />
          </View>
          <View style={styles.eventEntrySafety}><Ionicons name="shield-checkmark-outline" size={19} color="#19A47B" /><Text style={styles.eventEntrySafetyText}>Manual entry always works without Coh. Email suggestions never reach the family calendar until someone approves them.</Text></View>
        </ScrollView> : type === 'Chore' ? <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.choreFormContent}>
          <ChoreFormFields value={choreDraft} onChange={updateChore} profiles={profiles} styles={styles} dark={dark} autoFocus />
          <Pressable disabled={invalidChore || saving} onPress={() => void onSave(choreDraft)} style={[styles.saveButton, (invalidChore || saving) && styles.disabled]}>
            <Text style={styles.saveButtonText}>{saving ? 'Adding chore…' : 'Add chore'}</Text>
          </Pressable>
        </ScrollView> : <>
          <Text style={styles.fieldLabel}>{type} title</Text>
          <TextInput value={title} onChangeText={setTitle} autoFocus placeholder={`Add a ${type.toLowerCase()}…`} placeholderTextColor="#8B93A5" style={styles.modalInput} />
          <Text style={styles.fieldLabel}>Details</Text>
          <TextInput value={details} onChangeText={setDetails} multiline placeholder="Location, instructions, links, or anything the family should know" placeholderTextColor="#8B93A5" style={[styles.modalInput, styles.modalTextArea]} />
          <Pressable disabled={!title.trim()} onPress={() => void onSave()} style={[styles.saveButton, !title.trim() && styles.disabled]}><Text style={styles.saveButtonText}>{`Add ${type.toLowerCase()}`}</Text></Pressable>
        </>}
      </View>
      <StatusBar style={dark ? 'light' : 'dark'} />
    </KeyboardAvoidingView>
  </Modal>;
}

function EventEntryChoice({
  styles,
  icon,
  color,
  title,
  detail,
  onPress,
}: {
  styles: any;
  icon: string;
  color: string;
  title: string;
  detail: string;
  onPress: () => void;
}) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={styles.eventEntryChoice}>
    <View style={[styles.eventEntryIcon, { backgroundColor: `${color}18` }]}>
      <Ionicons name={icon as any} size={22} color={color} />
    </View>
    <Text style={styles.eventEntryTitle}>{title}</Text>
    <Text style={styles.eventEntryDetail}>{detail}</Text>
    <Ionicons name="chevron-forward" size={17} color={color} />
  </Pressable>;
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
    eyebrow: { color: t.primary, fontSize: 9, fontWeight: '800', letterSpacing: 1.1, marginBottom: 4 }, headerTitle: { color: t.text, fontSize: 30, fontWeight: '800', letterSpacing: -1.4, lineHeight: 31 }, headerSubtitle: { color: t.muted, fontSize: 9, fontWeight: '700', marginTop: 3 }, headerButtons: { flexDirection: 'row', gap: 8 },
    iconButton: { width: 42, height: 42, borderRadius: 14, borderWidth: 1, borderColor: t.line, backgroundColor: t.surface, alignItems: 'center', justifyContent: 'center' }, recapHeaderButton: { width: 42, height: 42, borderRadius: 14, backgroundColor: '#7047EE', alignItems: 'center', justifyContent: 'center', shadowColor: '#7047EE', shadowOpacity: .35, shadowRadius: 10 }, addButton: { width: 43, height: 43, borderRadius: 15, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center', shadowColor: t.primary, shadowOpacity: .26, shadowRadius: 10, shadowOffset: { width: 0, height: 6 } },
    scrollContent: { padding: 18, paddingBottom: 32, gap: 12 }, sectionHead: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 4 }, sectionTitle: { color: t.text, fontSize: 20, fontWeight: '800', letterSpacing: -.5, marginTop: 10 }, muted: { color: t.muted, fontSize: 11, lineHeight: 15 }, link: { color: t.primary, fontSize: 11, fontWeight: '700' },
    commandCenterHero: { minHeight: 222, borderRadius: 26, padding: 18, gap: 18, shadowColor: '#24116D', shadowOpacity: t.dark ? .34 : .22, shadowRadius: 18, shadowOffset: { width: 0, height: 9 } },
    commandCenterTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
    commandCenterMark: { width: 46, height: 46, borderRadius: 15, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', shadowColor: '#24116D', shadowOpacity: .16, shadowRadius: 9, shadowOffset: { width: 0, height: 4 } },
    commandCenterLabel: { color: '#FFFFFFB8', fontSize: 8, fontWeight: '900', letterSpacing: 1.1 },
    commandCenterTitle: { color: '#fff', fontSize: 23, lineHeight: 27, fontWeight: '900', letterSpacing: -.8, marginTop: 5 },
    commandCenterDetail: { color: '#FFFFFFC7', fontSize: 10, lineHeight: 15, marginTop: 6 },
    commandStatsRow: { marginTop: 'auto', flexDirection: 'row', gap: 7 },
    commandStat: { flex: 1, minHeight: 58, borderRadius: 15, paddingHorizontal: 8, paddingVertical: 9, justifyContent: 'center', backgroundColor: '#FFFFFF18', borderWidth: 1, borderColor: '#FFFFFF20' },
    commandStatValue: { color: '#fff', fontSize: 19, lineHeight: 21, fontWeight: '900' },
    commandStatLabel: { color: '#FFFFFFB8', fontSize: 7, lineHeight: 10, fontWeight: '800', marginTop: 3 },
    commandClear: { minHeight: 68, borderRadius: 18, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#19A47B10', borderWidth: 1, borderColor: '#19A47B35' },
    attentionRow: { minHeight: 72, borderRadius: 18, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line },
    attentionIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
    familyPulseGrid: { flexDirection: 'row', gap: 10 },
    familyPulseCard: { flex: 1, minHeight: 112, borderRadius: 19, padding: 14, justifyContent: 'space-between', backgroundColor: t.surface, borderWidth: 1, borderColor: t.line },
    familyPulseValue: { color: t.text, fontSize: 25, lineHeight: 27, fontWeight: '900', marginTop: 10 },
    familyPulseLabel: { color: t.muted, fontSize: 9, fontWeight: '800', marginTop: 2 },
    bentoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, bentoCard: { width: '48.5%', minHeight: 190, borderRadius: 22, padding: 15, backgroundColor: t.surfaceStrong, borderWidth: 1, borderColor: t.line, shadowColor: '#392B14', shadowOpacity: t.dark ? .24 : .07, shadowRadius: 12, shadowOffset: { width: 0, height: 7 } },
    cardIcon: { width: 43, height: 43, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 14 }, cardTitle: { color: t.text, fontSize: 14, fontWeight: '800' }, cardValue: { color: t.text, fontSize: 21, fontWeight: '800', letterSpacing: -.7, marginTop: 3 }, cardDetail: { color: t.muted, fontSize: 9, marginTop: 4, minHeight: 26 }, cardPill: { alignSelf: 'flex-start', flexDirection: 'row', gap: 4, alignItems: 'center', borderRadius: 99, paddingHorizontal: 8, paddingVertical: 6, marginTop: 'auto' }, cardPillText: { fontSize: 8, fontWeight: '700' },
    recapCard: { minHeight: 88, borderRadius: 21, padding: 15, flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 2 }, recapIcon: { width: 43, height: 43, borderRadius: 14, backgroundColor: '#FFFFFF24', alignItems: 'center', justifyContent: 'center' }, recapCopy: { flex: 1 }, recapLabel: { color: '#FFFFFFB5', fontSize: 7, fontWeight: '800', letterSpacing: 1 }, recapTitle: { color: '#fff', fontSize: 13, fontWeight: '800', marginTop: 2 }, recapText: { color: '#FFFFFFB8', fontSize: 9, lineHeight: 13, marginTop: 2 },
    familyRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, borderRadius: 20, padding: 13 }, familyPerson: { width: '24%', alignItems: 'center' }, avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }, avatarText: { color: '#2257F4', fontSize: 11, fontWeight: '800' }, familyName: { color: t.text, fontSize: 10, fontWeight: '700', marginTop: 6 }, familyStatus: { color: t.muted, fontSize: 8, marginTop: 2 },
    upcomingRow: { minHeight: 63, borderRadius: 17, borderWidth: 1, borderColor: t.line, backgroundColor: t.surface, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 11 }, dateTile: { width: 43, height: 44, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center' }, dateMonth: { fontSize: 7, fontWeight: '800' }, dateNumber: { fontSize: 18, fontWeight: '800', lineHeight: 19 }, upcomingTime: { color: t.muted, fontSize: 8, fontWeight: '700' }, upcomingTitle: { color: t.text, fontSize: 11, fontWeight: '700', marginTop: 3 },
    tabBar: { minHeight: 68, paddingTop: 7, paddingBottom: Platform.OS === 'ios' ? 5 : 8, paddingHorizontal: 7, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.line, backgroundColor: t.surfaceStrong, flexDirection: 'row', justifyContent: 'space-around' }, tabItem: { flex: 1, alignItems: 'center', gap: 3 }, tabIconWrap: { width: 38, height: 32, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, tabIconActive: { backgroundColor: t.primary }, tabLabel: { color: t.muted, fontSize: 8, fontWeight: '700' }, tabLabelActive: { color: t.primary },
    toast: { position: 'absolute', left: 18, right: 18, bottom: 78, minHeight: 50, borderRadius: 16, paddingHorizontal: 14, backgroundColor: t.surfaceStrong, borderWidth: 1, borderColor: t.line, flexDirection: 'row', alignItems: 'center', gap: 8, shadowColor: '#000', shadowOpacity: .16, shadowRadius: 16, shadowOffset: { width: 0, height: 7 } }, toastText: { color: t.text, fontSize: 11, fontWeight: '700', flex: 1 },
    calendarTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14 }, smallButton: { width: 38, height: 38, borderRadius: 12, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, alignItems: 'center', justifyContent: 'center' }, calendarPeriod: { color: t.text, fontWeight: '900', fontSize: 17, textAlign: 'center', letterSpacing: -.4 }, calendarTodayLink: { color: t.primary, fontSize: 8, fontWeight: '900', textAlign: 'center', marginTop: 3, letterSpacing: .7 }, weekRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: t.surface, borderRadius: 18, borderWidth: 1, borderColor: t.line, padding: 7 }, dayBubble: { width: 40, height: 58, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, dayBubbleActive: { backgroundColor: t.primary }, dayLabel: { color: t.muted, fontSize: 7, fontWeight: '800' }, dayNumber: { color: t.text, fontSize: 17, fontWeight: '800', marginTop: 3 }, dayTextActive: { color: '#fff' }, timelineRow: { minHeight: 76, borderRadius: 18, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10 }, timelineLine: { width: 4, height: 42, borderRadius: 3 }, timelineTime: { color: t.muted, fontSize: 10, width: 50, fontWeight: '700' }, timelineTitle: { color: t.text, fontSize: 13, fontWeight: '800', flexShrink: 1 }, eventSourceTitleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }, eventSourcePill: { borderRadius: 99, paddingHorizontal: 7, paddingVertical: 3 }, eventSourceText: { fontSize: 7, fontWeight: '900', letterSpacing: .3 }, eventDetailSource: { fontSize: 9, fontWeight: '800', marginTop: 4 }, syncCard: { minHeight: 67, borderRadius: 18, padding: 13, flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: `${t.primary}0C`, borderWidth: 1, borderColor: `${t.primary}24` }, syncTitle: { color: t.text, fontSize: 11, fontWeight: '800' },
    calendarScrollContent: { padding: 14, paddingBottom: 34, gap: 12 },
    calendarBottomActions: { gap: 10, marginTop: 4 },
    calendarAddAction: { minHeight: 76, borderRadius: 20, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: t.primary, shadowColor: t.primary, shadowOpacity: .2, shadowRadius: 10, shadowOffset: { width: 0, height: 5 } },
    calendarAddActionTitle: { color: '#fff', fontSize: 12, fontWeight: '900' },
    calendarAddActionDetail: { color: '#FFFFFFC4', fontSize: 8, lineHeight: 12, fontWeight: '700', marginTop: 3 },
    calendarViewTabs: { minHeight: 48, padding: 4, borderRadius: 17, flexDirection: 'row', gap: 5, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line },
    calendarViewTab: { flex: 1, minHeight: 38, borderRadius: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
    calendarViewTabActive: { backgroundColor: t.primary, shadowColor: t.primary, shadowOpacity: .22, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
    calendarViewTabText: { color: t.muted, fontSize: 10, fontWeight: '900' },
    calendarViewTabTextActive: { color: '#fff' },
    calendarNav: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10 },
    calendarPeopleFilters: { gap: 8, paddingRight: 16 },
    calendarPersonFilter: { minHeight: 37, borderRadius: 19, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line },
    calendarPersonFilterActive: { backgroundColor: '#7047EE', borderColor: '#7047EE' },
    calendarPersonFilterText: { color: t.text, fontSize: 9, fontWeight: '900' },
    calendarPersonFilterTextActive: { color: '#fff' },
    calendarPersonDot: { width: 9, height: 9, borderRadius: 5 },
    calendarSummary: { minHeight: 66, borderRadius: 18, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: t.surface, borderWidth: 1, borderColor: t.line },
    calendarSummaryValue: { color: t.text, fontSize: 18, lineHeight: 20, fontWeight: '900', textAlign: 'center' },
    calendarSummaryLabel: { color: t.muted, fontSize: 7, fontWeight: '800', textAlign: 'center', marginTop: 3 },
    calendarSummaryDivider: { width: 1, height: 28, backgroundColor: t.line },
    calendarMonthCard: { borderRadius: 20, overflow: 'hidden', backgroundColor: t.surface, borderWidth: 1, borderColor: t.line },
    calendarWeekdayRow: { minHeight: 32, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line, backgroundColor: t.surfaceStrong },
    calendarWeekdayLabel: { width: '14.2857%', textAlign: 'center', color: t.muted, fontSize: 8, fontWeight: '900' },
    calendarMonthGrid: { flexDirection: 'row', flexWrap: 'wrap' },
    calendarMonthDay: { width: '14.2857%', minHeight: 72, padding: 3, borderRightWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: t.line, backgroundColor: t.surface },
    calendarMonthDayOutside: { opacity: .35 },
    calendarMonthDaySelected: { backgroundColor: `${t.primary}12` },
    calendarMonthNumberWrap: { width: 21, height: 21, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
    calendarMonthToday: { backgroundColor: t.primary },
    calendarMonthNumber: { color: t.text, fontSize: 9, fontWeight: '900' },
    calendarMonthTodayText: { color: '#fff' },
    calendarMonthEvent: { minHeight: 14, borderRadius: 4, justifyContent: 'center', marginTop: 2, paddingHorizontal: 3, overflow: 'hidden' },
    calendarMonthEventText: { color: '#fff', fontSize: 5.5, lineHeight: 8, fontWeight: '900' },
    calendarMonthMore: { color: t.muted, fontSize: 6, lineHeight: 8, fontWeight: '900', marginTop: 2, paddingLeft: 2 },
    calendarEmptyCard: { minHeight: 82, borderRadius: 18, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line },
    calendarSections: { gap: 12 },
    calendarDaySection: { gap: 8, borderRadius: 19, padding: 10, backgroundColor: t.surfaceStrong, borderWidth: 1, borderColor: t.line },
    calendarDayHeading: { minHeight: 49, flexDirection: 'row', alignItems: 'center', gap: 10 },
    calendarAgendaDate: { width: 43, height: 43, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: `${t.primary}0D`, borderWidth: 1, borderColor: `${t.primary}28` },
    calendarAgendaDateToday: { backgroundColor: t.primary, borderColor: t.primary },
    calendarAgendaDateTodayText: { color: '#fff' },
    calendarAgendaWeekday: { color: t.primary, fontSize: 6, fontWeight: '900', letterSpacing: .5 },
    calendarAgendaNumber: { color: t.text, fontSize: 17, lineHeight: 18, fontWeight: '900' },
    calendarDayTitle: { color: t.text, fontSize: 12, fontWeight: '900' },
    calendarEmptyDay: { color: t.muted, fontSize: 9, fontWeight: '700', paddingHorizontal: 53, paddingBottom: 8 },
    calendarEventRow: { minHeight: 76, borderRadius: 17, padding: 10, gap: 9, flexDirection: 'row', alignItems: 'center', overflow: 'hidden', backgroundColor: t.surface, borderWidth: 1, borderColor: t.line },
    calendarEventRowCompact: { minHeight: 68 },
    calendarEventAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
    calendarEventAvatar: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginLeft: 3 },
    calendarEventInitials: { fontSize: 9, fontWeight: '900' },
    calendarEventMeta: { color: t.muted, fontSize: 9, lineHeight: 13, fontWeight: '700', marginTop: 3 },
    calendarEventFooter: { minHeight: 14, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 7, marginTop: 3 },
    calendarSourceText: { fontSize: 7, fontWeight: '900', letterSpacing: .3 },
    calendarEventSecondary: { color: t.muted, fontSize: 7, fontWeight: '800' },
    calendarConflictPill: { minHeight: 20, borderRadius: 10, paddingHorizontal: 6, flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#FF7A2E14' },
    calendarConflictText: { color: '#D7550D', fontSize: 6, fontWeight: '900' },
    progressCard: { minHeight: 130, borderRadius: 23, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, padding: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, progressLabel: { color: t.primary, fontSize: 8, fontWeight: '800', letterSpacing: 1 }, progressValue: { color: t.text, fontSize: 28, fontWeight: '800', letterSpacing: -1, marginTop: 5 }, progressRing: { width: 74, height: 74, borderRadius: 37, borderWidth: 8, borderColor: '#19A47B', alignItems: 'center', justifyContent: 'center' }, progressPercent: { color: t.text, fontSize: 16, fontWeight: '800' }, memberRewardTabs: { flexDirection: 'row', padding: 4, borderRadius: 16, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line }, memberRewardTab: { flex: 1, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, memberRewardTabActive: { backgroundColor: t.primary }, memberRewardName: { color: t.text, fontSize: 10, fontWeight: '800' }, memberRewardNameActive: { color: '#fff' }, memberRewardPoints: { color: t.muted, fontSize: 8, marginTop: 2, fontWeight: '700' }, rewardHero: { minHeight: 118, borderRadius: 21, padding: 16, flexDirection: 'row', gap: 13, alignItems: 'center', backgroundColor: t.surface, borderWidth: 1, borderColor: t.line }, rewardIcon: { width: 52, height: 52, borderRadius: 17, alignItems: 'center', justifyContent: 'center' }, rewardHeroTitle: { color: t.text, fontSize: 14, lineHeight: 19, fontWeight: '800', marginTop: 4 }, rewardProgressTrack: { height: 7, borderRadius: 4, backgroundColor: t.line, overflow: 'hidden', marginTop: 10 }, rewardProgressFill: { height: 7, borderRadius: 4 }, rewardProgressText: { color: t.muted, fontSize: 8, fontWeight: '700', marginTop: 5 }, rewardPrompt: { color: t.text, fontSize: 12, fontWeight: '800', marginTop: 2 }, rewardChoices: { gap: 10, paddingRight: 18 }, rewardChoice: { width: 145, minHeight: 130, borderRadius: 18, padding: 14, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line }, rewardChoiceTitle: { color: t.text, fontSize: 12, fontWeight: '800', marginTop: 11, marginBottom: 3 }, rewardCost: { fontSize: 9, fontWeight: '800', marginTop: 10 }, rewardSelected: { position: 'absolute', right: 10, top: 10 }, choreRow: { minHeight: 70, borderRadius: 17, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }, checkCircle: { width: 27, height: 27, borderRadius: 14, borderWidth: 2, borderColor: t.line, alignItems: 'center', justifyContent: 'center' }, choreTitle: { color: t.text, fontSize: 13, fontWeight: '800' }, struck: { textDecorationLine: 'line-through', color: t.muted }, pointPill: { minHeight: 27, borderRadius: 14, paddingHorizontal: 8, flexDirection: 'row', gap: 4, alignItems: 'center', backgroundColor: '#7047EE14' }, pointPillText: { color: '#7047EE', fontSize: 9, fontWeight: '900' }, ownerDot: { width: 9, height: 9, borderRadius: 5 }, outlineAction: { minHeight: 48, borderRadius: 15, borderWidth: 1, borderStyle: 'dashed', borderColor: t.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }, outlineActionText: { color: t.primary, fontSize: 11, fontWeight: '800' },
    messageList: { padding: 18, paddingBottom: 24, gap: 16 }, chatHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line }, homeThreadIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: `${t.primary}14`, alignItems: 'center', justifyContent: 'center' }, chatTitle: { color: t.text, fontSize: 14, fontWeight: '800' }, botHint: { minHeight: 48, borderRadius: 15, paddingHorizontal: 12, marginBottom: 5, flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: '#7047EE12', borderWidth: 1, borderColor: '#7047EE30' }, botHintText: { color: t.text, fontSize: 10, lineHeight: 14, flex: 1, fontWeight: '700' }, messageWrap: { maxWidth: '88%', flexDirection: 'row', gap: 8, alignSelf: 'flex-start' }, messageBody: { flexShrink: 1 }, messageMine: { alignSelf: 'flex-end' }, chatAvatar: { width: 32, height: 32, backgroundColor: '#FFE1CF' }, botAvatar: { width: 32, height: 32, backgroundColor: '#7047EE' }, messageAuthor: { color: t.muted, fontSize: 8, marginBottom: 4 }, botAuthor: { color: '#7047EE', fontWeight: '800' }, messageAuthorMine: { textAlign: 'right' }, messageBubble: { backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, borderRadius: 5, borderTopRightRadius: 16, borderBottomLeftRadius: 16, borderBottomRightRadius: 16, padding: 12 }, botBubble: { borderColor: '#7047EE55', backgroundColor: t.dark ? '#251F46' : '#F5F0FF' }, messageBubbleMine: { backgroundColor: t.primary, borderColor: t.primary, borderTopLeftRadius: 16, borderTopRightRadius: 5 }, messageText: { color: t.text, fontSize: 12, lineHeight: 17 }, messageTextMine: { color: '#fff' }, cohMention: { color: '#FFD84D', fontWeight: '900', textShadowColor: '#FFD84D99', textShadowRadius: 8 }, composeRow: { minHeight: 61, paddingHorizontal: 12, paddingVertical: 8, gap: 8, flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.line, backgroundColor: t.surfaceStrong }, composeRowCoh: { borderTopColor: '#A777FF', backgroundColor: t.dark ? '#211A42' : '#F7F0FF', shadowColor: '#7047EE', shadowOpacity: .42, shadowRadius: 16, shadowOffset: { width: 0, height: -3 } }, composePlus: { width: 36, height: 36, borderRadius: 12, backgroundColor: `${t.primary}13`, alignItems: 'center', justifyContent: 'center' }, composeCohBadge: { backgroundColor: '#7047EE', shadowColor: '#A777FF', shadowOpacity: .9, shadowRadius: 10 }, composeInput: { flex: 1, minHeight: 40, maxHeight: 90, borderRadius: 13, borderWidth: 1, borderColor: t.line, backgroundColor: t.surface, color: t.text, paddingHorizontal: 12, fontSize: 12 }, composeInputCoh: { borderColor: '#A777FF', borderWidth: 2, color: t.dark ? '#E8DDFF' : '#4B168D', fontWeight: '800', shadowColor: '#7047EE', shadowOpacity: .5, shadowRadius: 9 }, sendButton: { width: 37, height: 37, borderRadius: 12, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center' }, sendButtonCoh: { backgroundColor: '#7047EE', shadowColor: '#A777FF', shadowOpacity: .9, shadowRadius: 10 },
    moreToolbar: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 }, moreIntro: { flex: 1, color: t.muted, fontSize: 12, lineHeight: 18, marginBottom: 4 }, moreCustomizeButton: { minHeight: 36, borderRadius: 12, borderWidth: 1, borderColor: `${t.primary}55`, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: `${t.primary}0D` }, moreCustomizeButtonActive: { backgroundColor: '#7047EE', borderColor: '#7047EE' }, moreCustomizeText: { color: t.primary, fontSize: 9, fontWeight: '900' }, moreCustomizeTextActive: { color: '#fff' }, moreEditingHint: { minHeight: 64, borderRadius: 16, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: '#7047EE12', borderWidth: 1, borderColor: '#7047EE35' }, moreEditingHintText: { flex: 1, color: t.text, fontSize: 9, lineHeight: 14, fontWeight: '700' }, moreGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }, moreCard: { width: '48%', minHeight: 180, marginBottom: 10, borderRadius: 22, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, padding: 16 }, moreIcon: { width: 45, height: 45, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, moreTitle: { color: t.text, fontSize: 15, fontWeight: '800', marginTop: 17 }, moreDetail: { color: t.muted, fontSize: 9, lineHeight: 14, marginTop: 5, paddingRight: 10 }, moreChevron: { position: 'absolute', right: 14, bottom: 14 }, moreEditControls: { position: 'absolute', left: 12, right: 12, bottom: 11, flexDirection: 'row', gap: 6 }, moreEditButton: { flex: 1, minHeight: 30, borderRadius: 9, backgroundColor: t.surfaceStrong, borderWidth: 1, borderColor: t.line, alignItems: 'center', justifyContent: 'center' }, moreEditButtonDisabled: { opacity: .3 }, moreHideButton: { backgroundColor: '#D645450D', borderColor: '#D6454535' }, moreHiddenList: { borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: t.line, backgroundColor: t.surface }, moreHiddenRow: { minHeight: 58, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line }, moreHiddenIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' }, moreHiddenTitle: { flex: 1, color: t.text, fontSize: 11, fontWeight: '800' }, moreRestoreButton: { minHeight: 32, borderRadius: 10, paddingHorizontal: 10, backgroundColor: `${t.primary}12`, alignItems: 'center', justifyContent: 'center' }, moreRestoreText: { color: t.primary, fontSize: 9, fontWeight: '900' }, moreResetButton: { alignSelf: 'center', minHeight: 38, borderRadius: 12, borderWidth: 1, borderColor: t.line, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: t.surface }, moreResetText: { color: t.muted, fontSize: 9, fontWeight: '800' },
    familyHero: { minHeight: 116, borderRadius: 22, padding: 18, flexDirection: 'row', alignItems: 'center', backgroundColor: t.surface, borderWidth: 1, borderColor: t.line }, familyHeroTitle: { color: t.text, fontSize: 22, fontWeight: '900', marginTop: 5, marginBottom: 4 }, addProfileButton: { width: 46, height: 46, borderRadius: 15, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center', marginLeft: 'auto' }, profileRow: { minHeight: 88, borderRadius: 19, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line }, profileAvatar: { width: 42, height: 42, borderRadius: 15, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }, profileAvatarLarge: { width: 58, height: 58, borderRadius: 19 }, profileAvatarImage: { width: '100%', height: '100%' }, profileName: { color: t.text, fontSize: 14, fontWeight: '900' }, profileBio: { color: t.muted, fontSize: 9, lineHeight: 13, marginTop: 4 }, profileSheet: { maxHeight: '88%', backgroundColor: t.surfaceStrong, borderTopLeftRadius: 28, borderTopRightRadius: 28 }, profileSheetContent: { paddingHorizontal: 19, paddingTop: 9, paddingBottom: 34 }, photoEditor: { minHeight: 76, borderRadius: 18, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line }, profilePrivacy: { color: t.muted, fontSize: 9, lineHeight: 14, marginTop: 14 }, deleteProfileButton: { minHeight: 44, marginTop: 10, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: '#D645450D', borderWidth: 1, borderColor: '#D6454535' }, deleteProfileText: { color: '#D64545', fontSize: 10, fontWeight: '800' },
    searchInput: { height: 45, borderRadius: 15, borderWidth: 1, borderColor: t.line, backgroundColor: t.surface, color: t.text, paddingHorizontal: 14 }, notesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, noteCard: { width: '48.5%', minHeight: 140, borderRadius: 19, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, padding: 15 }, noteEmoji: { fontSize: 24 }, noteTitle: { color: t.text, fontSize: 12, fontWeight: '800', marginTop: 18, marginBottom: 4 }, noteChevron: { position: 'absolute', right: 12, bottom: 12 },
    recapHero: { minHeight: 260, borderRadius: 24, padding: 23, justifyContent: 'center' }, recapHeroLabel: { color: '#FFFFFFB5', fontSize: 8, fontWeight: '800', letterSpacing: 1, marginTop: 13 }, recapHeroTitle: { color: '#fff', fontSize: 28, lineHeight: 31, fontWeight: '800', letterSpacing: -1, marginTop: 8 }, recapHeroText: { color: '#FFFFFFC0', fontSize: 11, lineHeight: 16, marginTop: 8 }, recapActionRow: { flexDirection: 'row', gap: 8, marginTop: 18 }, recapHeroButton: { alignSelf: 'flex-start', minHeight: 38, borderRadius: 12, backgroundColor: '#fff', flexDirection: 'row', gap: 7, alignItems: 'center', paddingHorizontal: 13 }, recapSnapshot: { minHeight: 66, borderRadius: 17, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line }, recapSnapshotActive: { borderColor: '#7047EE88', backgroundColor: t.dark ? '#251F46' : '#F5F0FF' }, recapSnapshotIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#7047EE14' }, recapSnapshotDetail: { borderRadius: 19, padding: 13, gap: 8, backgroundColor: t.surface, borderWidth: 1, borderColor: '#7047EE55' }, listenSnapshot: { alignSelf: 'flex-start', minHeight: 36, borderRadius: 11, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#7047EE12' }, highlightRow: { minHeight: 61, flexDirection: 'row', gap: 11, alignItems: 'center', borderRadius: 16, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, padding: 12 }, highlightTime: { color: t.primary, fontSize: 11, fontWeight: '800', width: 38 }, highlightText: { color: t.text, fontSize: 11, fontWeight: '700', flex: 1 },
    automationCard: { minHeight: 90, borderRadius: 20, padding: 16, flexDirection: 'row', gap: 12, alignItems: 'center' }, automationLabel: { color: '#FFFFFFA8', fontSize: 7, fontWeight: '800', letterSpacing: 1 }, automationTitle: { color: '#fff', fontSize: 12, fontWeight: '800', lineHeight: 17, marginTop: 3 },
    integrationHero: { minHeight: 230, borderRadius: 25, padding: 20, justifyContent: 'center', shadowColor: '#24116D', shadowOpacity: t.dark ? .34 : .2, shadowRadius: 17, shadowOffset: { width: 0, height: 8 } },
    integrationHeroTitle: { color: '#fff', fontSize: 26, lineHeight: 30, fontWeight: '900', letterSpacing: -.9, marginTop: 7 },
    integrationCategoryGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
    integrationCategoryCard: { width: '48.5%', minHeight: 190, marginBottom: 10, borderRadius: 21, padding: 15, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line },
    integrationCategoryIcon: { width: 45, height: 45, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
    integrationCategoryTitle: { color: t.text, fontSize: 14, lineHeight: 18, fontWeight: '900', marginTop: 15 },
    integrationCategoryDetail: { color: t.muted, fontSize: 9, lineHeight: 14, marginTop: 5 },
    integrationCategoryFooter: { marginTop: 'auto', paddingTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    integrationCategoryCount: { fontSize: 8, fontWeight: '900' },
    integrationTrustCard: { minHeight: 82, borderRadius: 19, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: '#19A47B0D', borderWidth: 1, borderColor: '#19A47B35' },
    integrationCategoryHeader: { minHeight: 106, borderRadius: 21, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line },
    integrationCategoryIconLarge: { width: 55, height: 55, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
    integrationCategoryPageTitle: { color: t.text, fontSize: 23, lineHeight: 26, fontWeight: '900', letterSpacing: -.7, marginBottom: 4 },
    integrationProviderCard: { minHeight: 92, borderRadius: 19, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line },
    integrationProviderTitleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 3 },
    integrationConnectedPill: { borderRadius: 99, paddingHorizontal: 7, paddingVertical: 3, backgroundColor: '#19A47B12' },
    integrationConnectedPillText: { color: '#168866', fontSize: 6, fontWeight: '900', letterSpacing: .5 },
    integrationRow: { minHeight: 78, borderRadius: 18, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }, integrationIcon: { width: 43, height: 43, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, integrationTitle: { color: t.text, fontSize: 12, fontWeight: '800' }, connectButton: { minHeight: 31, borderRadius: 10, borderWidth: 1, borderColor: t.primary, paddingHorizontal: 9, alignItems: 'center', justifyContent: 'center' }, connectedButton: { borderColor: '#19A47B', backgroundColor: '#19A47B12' }, connectText: { color: t.primary, fontSize: 8, fontWeight: '800' }, connectedText: { color: '#19A47B' },
    notificationStatusCard: { minHeight: 88, borderRadius: 20, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#FF7A2E0D', borderWidth: 1, borderColor: '#FF7A2E42' },
    notificationStatusReady: { backgroundColor: '#19A47B0D', borderColor: '#19A47B42' },
    notificationChoiceGrid: { flexDirection: 'row', gap: 10 },
    notificationChoice: { flex: 1, minHeight: 82, borderRadius: 18, padding: 12, gap: 8, justifyContent: 'center', backgroundColor: t.surface, borderWidth: 1, borderColor: t.line },
    notificationChoiceActive: { borderColor: '#7047EE55', backgroundColor: t.dark ? '#251F46' : '#F6F1FF' },
    notificationBriefingCard: { borderRadius: 19, padding: 14, gap: 12, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line },
    notificationSystemLink: { minHeight: 44, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: `${t.primary}0C`, borderWidth: 1, borderColor: `${t.primary}2A` },
    chiefHero: { minHeight: 210, borderRadius: 24, padding: 22, justifyContent: 'center' }, chiefBadge: { width: 48, height: 48, borderRadius: 16, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }, chiefHeroTitle: { color: '#fff', fontSize: 28, lineHeight: 32, fontWeight: '800', letterSpacing: -1, marginTop: 5 }, chiefSettingCard: { borderRadius: 19, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, padding: 13, gap: 12 }, settingRowTop: { flexDirection: 'row', alignItems: 'center', gap: 10 }, chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, choiceChip: { minHeight: 34, borderRadius: 11, borderWidth: 1, borderColor: t.line, paddingHorizontal: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: t.surfaceStrong }, choiceChipActive: { backgroundColor: t.primary, borderColor: t.primary }, choiceChipText: { color: t.text, fontSize: 9, fontWeight: '800' }, choiceChipTextActive: { color: '#fff' }, preferenceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 }, preferenceTile: { width: '48.5%', minHeight: 58, borderRadius: 15, padding: 11, flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: t.surface, borderWidth: 1, borderColor: t.line }, preferenceTileActive: { borderColor: '#19A47B55', backgroundColor: '#19A47B0D' }, preferenceText: { color: t.text, fontSize: 10, fontWeight: '700', flex: 1 }, memberChip: { minHeight: 36, borderRadius: 18, borderWidth: 1, borderColor: t.line, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: t.surface }, memberChipActive: { backgroundColor: t.primary, borderColor: t.primary }, followUpCard: { minHeight: 72, borderRadius: 18, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line },
    personSetting: { minHeight: 65, borderRadius: 17, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 10 }, settingRow: { minHeight: 70, borderRadius: 17, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 11 }, settingTitle: { color: t.text, fontSize: 12, fontWeight: '800' },
    modalBackdrop: { flex: 1, backgroundColor: '#0C111D88', justifyContent: 'flex-end' }, modalDismiss: { flex: 1 }, modalSheet: { backgroundColor: t.surfaceStrong, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 19, paddingTop: 9, paddingBottom: Platform.OS === 'ios' ? 28 : 18 }, choreModalSheet: { maxHeight: '94%', paddingBottom: Platform.OS === 'ios' ? 12 : 8 }, modalHandle: { width: 39, height: 4, borderRadius: 2, backgroundColor: t.line, alignSelf: 'center', marginBottom: 15 }, modalHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }, modalTitle: { color: t.text, fontSize: 23, fontWeight: '800', letterSpacing: -.7 }, typeTabs: { flexDirection: 'row', borderRadius: 14, padding: 4, backgroundColor: t.canvas, marginTop: 19 }, typeTab: { flex: 1, minHeight: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }, typeTabActive: { backgroundColor: t.surfaceStrong }, typeTabText: { color: t.muted, fontSize: 10, fontWeight: '700' }, typeTabTextActive: { color: t.primary }, fieldLabel: { color: t.muted, fontSize: 9, fontWeight: '800', marginTop: 15, marginBottom: 6 }, modalInput: { minHeight: 46, borderRadius: 13, borderWidth: 1, borderColor: t.line, backgroundColor: t.surface, color: t.text, paddingHorizontal: 12 }, modalTextArea: { minHeight: 83, paddingTop: 12, textAlignVertical: 'top' }, saveButton: { minHeight: 48, borderRadius: 15, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center', marginTop: 18 }, saveButtonText: { color: '#fff', fontSize: 12, fontWeight: '800' }, disabled: { opacity: .45 },
    eventEntryContent: { paddingTop: 16, paddingBottom: 8, gap: 10 },
    eventEntryGroupLabel: { color: t.muted, fontSize: 8, fontWeight: '900', letterSpacing: 1.2, marginTop: 4 },
    eventEntryGrid: { flexDirection: 'row', gap: 9 },
    eventEntryChoice: { flex: 1, minHeight: 128, borderRadius: 19, padding: 13, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line },
    eventEntryIcon: { width: 39, height: 39, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
    eventEntryTitle: { color: t.text, fontSize: 11, lineHeight: 14, fontWeight: '900' },
    eventEntryDetail: { color: t.muted, fontSize: 8, lineHeight: 12, fontWeight: '700', marginTop: 5 },
    messageDelivery: { color: t.muted, fontSize: 8, fontWeight: '700', marginTop: 4 },
    messageDeliveryMine: { textAlign: 'right' },
    messageFailure: { minHeight: 30, marginTop: 5, paddingHorizontal: 9, borderRadius: 10, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#C747320D', borderWidth: 1, borderColor: '#C7473228' },
    messageFailureMine: { alignSelf: 'flex-end' },
    messageFailureText: { color: '#C74732', fontSize: 8, fontWeight: '800' },
    messageRetryButton: { minHeight: 24, marginLeft: 3, paddingHorizontal: 7, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#7047EE12' },
    messageRetryText: { color: '#7047EE', fontSize: 8, fontWeight: '900' },
    cohActionCard: { minWidth: 248, marginTop: 8, padding: 12, borderRadius: 17, backgroundColor: t.surface, borderWidth: 1, borderColor: '#7047EE42', shadowColor: '#7047EE', shadowOpacity: .09, shadowRadius: 9, shadowOffset: { width: 0, height: 4 } },
    cohActionCardReady: { borderColor: '#7047EE88', backgroundColor: t.dark ? '#211A42' : '#FBF8FF' },
    cohActionCardCreated: { borderColor: '#19A47B66', backgroundColor: t.dark ? '#132D28' : '#F3FBF8' },
    cohActionCardCanceled: { opacity: .72, borderColor: t.line },
    cohActionHeader: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 8 },
    cohActionIcon: { width: 31, height: 31, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#7047EE' },
    cohActionIconCreated: { backgroundColor: '#19A47B' },
    cohActionEyebrow: { color: '#7047EE', fontSize: 7, lineHeight: 10, fontWeight: '900', letterSpacing: .8 },
    cohActionTitle: { color: t.text, fontSize: 13, lineHeight: 17, fontWeight: '900', marginTop: 2 },
    cohActionRow: { minHeight: 30, paddingVertical: 6, flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.line },
    cohActionLabel: { width: 55, color: t.muted, fontSize: 8, lineHeight: 13, fontWeight: '800' },
    cohActionValue: { flex: 1, color: t.text, fontSize: 9, lineHeight: 13, fontWeight: '700', textAlign: 'right' },
    cohMissingBox: { minHeight: 38, marginTop: 8, paddingHorizontal: 9, paddingVertical: 8, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#FFB02016', borderWidth: 1, borderColor: '#FFB02040' },
    cohMissingText: { flex: 1, color: '#A76400', fontSize: 8, lineHeight: 12, fontWeight: '800' },
    cohActionButtons: { gap: 7, marginTop: 10 },
    cohPrimaryAction: { minHeight: 42, borderRadius: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: '#7047EE' },
    cohPrimaryActionText: { color: '#fff', fontSize: 10, fontWeight: '900' },
    cohSecondaryActionRow: { flexDirection: 'row', gap: 7 },
    cohSecondaryAction: { flex: 1, minHeight: 35, borderRadius: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: '#7047EE10', borderWidth: 1, borderColor: '#7047EE35' },
    cohSecondaryActionText: { color: '#7047EE', fontSize: 9, fontWeight: '900' },
    cohDangerAction: { flex: 1, minHeight: 35, borderRadius: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: '#C747320A', borderWidth: 1, borderColor: '#C747322B' },
    cohDangerActionText: { color: '#C74732', fontSize: 9, fontWeight: '900' },
    cohActionDisabled: { opacity: .55 },
    cohOpenAction: { minHeight: 40, marginTop: 9, paddingHorizontal: 11, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#19A47B12', borderWidth: 1, borderColor: '#19A47B35' },
    cohOpenActionText: { color: '#167D62', fontSize: 9, fontWeight: '900' },
    eventEntrySafety: { minHeight: 62, borderRadius: 16, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#19A47B10', borderWidth: 1, borderColor: '#19A47B35', marginTop: 2 },
    eventEntrySafetyText: { flex: 1, color: t.text, fontSize: 9, lineHeight: 14, fontWeight: '700' },
    manualEventToggle: { minHeight: 62, borderRadius: 16, marginTop: 14, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line },
    manualDateField: { minHeight: 50, borderRadius: 14, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: t.surface, borderWidth: 1, borderColor: t.line },
    timeFieldLabel: { color: t.muted, fontSize: 7, fontWeight: '900', letterSpacing: .7 },
    inlineError: { color: '#D64545', fontSize: 9, fontWeight: '700', marginTop: 6 },
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
