import AuthGate from './src/components/AuthGate';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import { ShareIntentProvider, useShareIntentContext } from 'expo-share-intent';
import { useEffect, useMemo, useState } from 'react';
import { askCoh, type CohDraft, type CohHistoryItem } from './src/services/cohAssistant';
import {
  FlatList,
  Image,
  KeyboardAvoidingView,
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
type MoreView = 'Menu' | 'Chief of Home' | 'Family' | 'Notes' | 'Recaps' | 'Integrations' | 'Settings';
type ChatMessage = { id: string; mine: boolean; author: string; text: string; bot?: boolean };
type BotEvent = { id: string; title: string; person: string; day: string; dateISO?: string; time: string; place?: string; reminder?: number; directions?: boolean };
type BotField = 'title' | 'day' | 'time' | 'meridiem' | 'place' | 'directions' | 'reminder' | 'confirm';
type BotDraft = { title?: string; person?: string; day?: string; dateISO?: string; time?: string; meridiem?: 'AM' | 'PM'; place?: string; reminder?: number; directions?: boolean; awaiting: BotField };
type ChiefPrefs = { daily: boolean; dailyTime: string; weekAhead: boolean; weekAheadDay: string; weekAheadTime: string; followUp: boolean; followUpDay: string; followUpTime: string; push: boolean; email: boolean; quietHours: boolean; events: boolean; chores: boolean; messages: boolean; followUps: boolean; members: string[] };
type RewardGoal = { id: string; title: string; detail: string; cost: number; icon: string; color: string };
type FamilyProfile = { id: string; name: string; dob: string; bio: string; role: string; avatarUri?: string; color: string; ink: string };

const defaultChiefPrefs: ChiefPrefs = { daily: true, dailyTime: '7:00 AM', weekAhead: true, weekAheadDay: 'Sunday', weekAheadTime: '6:00 PM', followUp: true, followUpDay: 'Friday', followUpTime: '5:00 PM', push: true, email: false, quietHours: true, events: true, chores: true, messages: false, followUps: true, members: familyNames() };
function familyNames() { return ['Chad', 'Loren', 'Asher', 'Oliver']; }

const family = [
  { initials: 'CC', name: 'Chad', status: 'At work', color: '#DCE7FF', ink: '#2257F4' },
  { initials: 'LC', name: 'Loren', status: 'Working', color: '#FFE1CF', ink: '#D7550D' },
  { initials: 'AC', name: 'Asher', status: 'At school', color: '#D9F7ED', ink: '#168866' },
  { initials: 'OC', name: 'Oliver', status: 'At school', color: '#EADFFF', ink: '#6E3AE2' },
];

const initialProfiles: FamilyProfile[] = family.map((person, index) => ({ id: String(index + 1), name: person.name, dob: '', bio: index < 2 ? 'Family admin' : 'Family member', role: index < 2 ? 'Adult admin' : 'Child', color: person.color, ink: person.ink }));

const initialChores = [
  { id: '1', title: 'Trash to curb', owner: 'Chad', due: 'Before 8 PM', done: false, points: 20, color: '#2257F4' },
  { id: '2', title: 'Unload dishwasher', owner: 'Asher', due: 'After school', done: false, points: 15, color: '#19A47B' },
  { id: '3', title: 'Feed the dog', owner: 'Oliver', due: '5:00 PM', done: true, points: 10, color: '#7C4DFF' },
  { id: '4', title: 'Water front beds', owner: 'Loren', due: 'Thursday', done: false, points: 15, color: '#FF7A2E' },
];

const rewardGoals: RewardGoal[] = [
  { id: 'game', title: 'Game time', detail: '30 minutes', cost: 30, icon: 'game-controller', color: '#7047EE' },
  { id: 'vbucks', title: 'V-Bucks', detail: '1,000 V-Bucks', cost: 100, icon: 'diamond', color: '#2257F4' },
  { id: 'allowance', title: 'Allowance', detail: '$5 reward', cost: 75, icon: 'cash', color: '#19A47B' },
  { id: 'choice', title: 'My choice', detail: 'Pick a family privilege', cost: 50, icon: 'star', color: '#FF9F1C' },
];

const upcoming = [
  { date: '17', month: 'JUL', time: '3:00 PM', title: 'Leave for Pennsylvania', color: '#2257F4' },
  { date: '18', month: 'JUL', time: '11:00 AM', title: "Arrive at Harvey's Lake", color: '#19A47B' },
  { date: '21', month: 'JUL', time: '10:00 AM', title: 'Knoebels family day', color: '#FF7A2E' },
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
  const systemScheme = useColorScheme();
  const [dark, setDark] = useState(systemScheme === 'dark');
  const [tab, setTab] = useState<Tab>('Today');
  const [moreView, setMoreView] = useState<MoreView>('Menu');
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddType, setQuickAddType] = useState('Event');
  const [quickAddTitle, setQuickAddTitle] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [chores, setChores] = useState(initialChores);
  const [rewardMember, setRewardMember] = useState('Asher');
  const [selectedRewards, setSelectedRewards] = useState<Record<string, string>>({ Chad: 'choice', Loren: 'choice', Asher: 'game', Oliver: 'vbucks' });
  const [profiles, setProfiles] = useState<FamilyProfile[]>(initialProfiles);
  const [editingProfile, setEditingProfile] = useState<FamilyProfile | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: '1', mine: false, author: 'Loren', text: 'Can someone grab Oliver at 3:15? My last appointment may run over.' },
    { id: '2', mine: true, author: 'You', text: 'I’ve got it. I added the drive time to the calendar too.' },
  ]);
  const [messageDraft, setMessageDraft] = useState('');
  const [botDraft, setBotDraft] = useState<BotDraft | null>(null);
  const [botEvents, setBotEvents] = useState<BotEvent[]>([]);
  const [cohConversationId, setCohConversationId] = useState<string | null>(null);
  const [cohHistory, setCohHistory] = useState<CohHistoryItem[]>([]);
  const [cohRemoteAvailable, setCohRemoteAvailable] = useState<boolean | null>(null);
  const [cohThinking, setCohThinking] = useState(false);
  const [connected, setConnected] = useState<Record<string, boolean>>({ 'Apple Calendar': true, 'iOS Notifications': true });
  const [sharePreviewOpen, setSharePreviewOpen] = useState(false);
  const [sharedDraft, setSharedDraft] = useState('');
  const [chiefPrefs, setChiefPrefs] = useState<ChiefPrefs>(defaultChiefPrefs);
  const [localDataReady, setLocalDataReady] = useState(false);

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
    AsyncStorage.getItem('coho-family-profiles').then((saved) => {
      if (saved) setProfiles(JSON.parse(saved));
    }).catch(() => undefined);
    Promise.all([
      AsyncStorage.getItem('coho-chat-messages'),
      AsyncStorage.getItem('coho-calendar-events'),
      AsyncStorage.getItem('coho-chores'),
    ]).then(([savedMessages, savedEvents, savedChores]) => {
      if (savedMessages) setMessages(JSON.parse(savedMessages));
      if (savedEvents) setBotEvents(JSON.parse(savedEvents));
      if (savedChores) setChores(JSON.parse(savedChores));
    }).catch(() => undefined).finally(() => setLocalDataReady(true));
  }, []);

  useEffect(() => {
    if (!localDataReady) return;
    AsyncStorage.multiSet([
      ['coho-chat-messages', JSON.stringify(messages.slice(-150))],
      ['coho-calendar-events', JSON.stringify(botEvents)],
      ['coho-chores', JSON.stringify(chores)],
    ]).catch(() => undefined);
  }, [localDataReady, messages, botEvents, chores]);

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

  function saveQuickAdd() {
    if (!quickAddTitle.trim()) return;
    setQuickAddOpen(false);
    showNotice(`${quickAddType} added to the family thread`);
    setQuickAddTitle('');
  }

  function addBotMessage(text: string) {
    setTimeout(() => setMessages((current) => [...current, { id: `bot-${Date.now()}`, mine: false, author: 'Coh', text, bot: true }]), 250);
  }

  function sendMessage() {
    const text = messageDraft.trim();
    if (!text) return;
    setMessages((current) => [...current, { id: String(Date.now()), mine: true, author: 'You', text }]);
    setMessageDraft('');
    void handleBotMessage(text);
  }

  function cancelSharedItem() {
    setSharePreviewOpen(false);
    setSharedDraft('');
    resetShareIntent();
  }

  function sendSharedItemToCue() {
    const incoming = shareIntent as any;
    const hasImage = Boolean(incoming?.files?.length);
    const text = sharedDraft.trim();
    setSharePreviewOpen(false);
    resetShareIntent();
    setTab('Chat');
    if (!text) {
      addBotMessage(hasImage
        ? 'I received the screenshot, but image reading is not connected yet. Type the event details here and I’ll help add them.'
        : 'I did not receive any readable text. Nothing was saved.');
      return;
    }
    const prompt = text.match(/^\s*(@coh|hey coh|@bot|hey bot)/i) ? text : `@coh ${text}`;
    setMessages((current) => [...current, { id: `shared-${Date.now()}`, mine: true, author: 'You', text: prompt }]);
    setTimeout(() => void handleBotMessage(prompt), 50);
    setSharedDraft('');
  }

  async function handleBotMessage(text: string) {
    const normalized = text.trim().toLowerCase();
    const directlyInvoked = normalized.startsWith('@coh') || normalized.startsWith('hey coh') || normalized.startsWith('@bot') || normalized.startsWith('hey bot');
    if (!directlyInvoked && !botDraft && !cohConversationId) return;

    if (cohRemoteAvailable !== false) {
      setCohThinking(true);
      try {
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        const response = await askCoh({
          message: text,
          conversationId: cohConversationId,
          timezone,
          history: cohHistory,
        });
        setCohRemoteAvailable(true);
        setCohConversationId(response.conversationId);
        setCohHistory((current) => [...current, { role: 'user' as const, content: text }, { role: 'assistant' as const, content: response.reply }].slice(-16));
        addBotMessage(response.reply);

        if (response.status === 'confirmed' && response.proposed_action.type === 'create_event') {
          const event = eventFromCohDraft(response.draft);
          if (event) {
            setBotEvents((current) => current.some((item) => item.id === event.id) ? current : [...current, event]);
            showNotice('Coh added an approved event to the family calendar');
          }
          setCohConversationId(null);
          setCohHistory([]);
        } else if (response.status === 'canceled') {
          setCohConversationId(null);
          setCohHistory([]);
        }
        return;
      } catch {
        setCohRemoteAvailable(false);
      } finally {
        setCohThinking(false);
      }
    }

    handleLocalBotMessage(text);
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
        setBotEvents((current) => [...current, event]);
        setBotDraft(null);
        addBotMessage(`Done — “${event.title}” is on the family calendar for ${event.day} at ${event.time}.${event.reminder ? ` I’ll remind you ${event.reminder} minutes before.` : ''}${event.directions && event.place ? ` Directions to ${event.place} are included.` : ''}`);
        showNotice('Coh added an event to the family calendar');
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

  async function enableNotifications() {
    const permission = await Notifications.requestPermissionsAsync();
    if (permission.granted) {
      await Notifications.scheduleNotificationAsync({
        content: { title: 'Coho is ready', body: 'Family reminders and daily recaps are now enabled.' },
        trigger: null,
      });
      setConnected((current) => ({ ...current, 'iOS Notifications': true }));
      showNotice('iOS notifications enabled');
    } else {
      showNotice('Notification permission was not enabled');
    }
  }

  async function saveChiefPreferences(next: ChiefPrefs) {
    setChiefPrefs(next);
    await AsyncStorage.setItem('kincue-chief-prefs', JSON.stringify(next));
  }

  async function activateChiefOfHome() {
    await saveChiefPreferences(chiefPrefs);
    const permission = await Notifications.requestPermissionsAsync();
    if (!permission.granted) {
      showNotice('Enable notifications in iOS Settings to receive briefings');
      return;
    }
    const oldIds = JSON.parse(await AsyncStorage.getItem('kincue-chief-notification-ids') || '[]');
    await Promise.all(oldIds.map((id: string) => Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined)));
    const ids: string[] = [];
    if (chiefPrefs.daily && chiefPrefs.push) {
      const { hour, minute } = parseClock(chiefPrefs.dailyTime);
      ids.push(await Notifications.scheduleNotificationAsync({ content: { title: 'Your Chief of Home briefing', body: 'Appointments, chores, follow-ups, and what your family needs today.' }, trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute } }));
    }
    if (chiefPrefs.weekAhead && chiefPrefs.push) {
      const { hour, minute } = parseClock(chiefPrefs.weekAheadTime);
      ids.push(await Notifications.scheduleNotificationAsync({ content: { title: 'Your full week ahead', body: 'Open Coho for the family schedule, preparation list, and conflicts.' }, trigger: { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: weekdayNumber(chiefPrefs.weekAheadDay), hour, minute } }));
    }
    if (chiefPrefs.followUp && chiefPrefs.push) {
      const { hour, minute } = parseClock(chiefPrefs.followUpTime);
      ids.push(await Notifications.scheduleNotificationAsync({ content: { title: 'Weekly follow-up', body: 'A few appointments and conversations may still need action.' }, trigger: { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: weekdayNumber(chiefPrefs.followUpDay), hour, minute } }));
    }
    await AsyncStorage.setItem('kincue-chief-notification-ids', JSON.stringify(ids));
    showNotice('Chief of Home briefings are scheduled');
  }

  const title = tab === 'More' && moreView !== 'Menu' ? moreView : tab;
  const openRecaps = () => { setMoreView('Recaps'); setTab('More'); };

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
          onTheme={toggleTheme}
          onRecap={openRecaps}
          onAdd={() => setQuickAddOpen(true)}
          onBack={tab === 'More' && moreView !== 'Menu' ? () => setMoreView('Menu') : undefined}
        />

        <View style={styles.screen}>
          {tab === 'Today' && <TodayScreen theme={theme} styles={styles} quickItems={notice ? [notice] : []} onCalendar={() => setTab('Calendar')} onRecap={openRecaps} onAction={showNotice} />}
          {tab === 'Calendar' && <CalendarScreen theme={theme} styles={styles} botEvents={botEvents} onAction={showNotice} onManage={() => { setMoreView('Integrations'); setTab('More'); }} />}
          {tab === 'Chores' && <ChoresScreen styles={styles} chores={chores} rewardMember={rewardMember} setRewardMember={setRewardMember} selectedRewards={selectedRewards} onAdd={() => { setQuickAddType('Chore'); setQuickAddOpen(true); }} onSelectReward={(member: string, reward: string) => { const next = { ...selectedRewards, [member]: reward }; setSelectedRewards(next); AsyncStorage.setItem('coho-reward-goals', JSON.stringify(next)); showNotice(`${member} picked a new reward goal`); }} onToggle={(id: string) => setChores((items) => items.map((item) => item.id === id ? { ...item, done: !item.done } : item))} />}
          {tab === 'Chat' && <ChatScreen styles={styles} messages={messages} draft={messageDraft} setDraft={setMessageDraft} onSend={sendMessage} onAdd={() => setQuickAddOpen(true)} cohThinking={cohThinking} />}
          {tab === 'More' && moreView === 'Menu' && <MoreMenu styles={styles} setView={setMoreView} />}
          {tab === 'More' && moreView === 'Chief of Home' && <ChiefOfHomeScreen styles={styles} prefs={chiefPrefs} setPrefs={saveChiefPreferences} onActivate={activateChiefOfHome} />}
          {tab === 'More' && moreView === 'Family' && <FamilyProfilesScreen styles={styles} profiles={profiles} onEdit={setEditingProfile} onAdd={() => setEditingProfile({ id: `profile-${Date.now()}`, name: '', dob: '', bio: '', role: 'Family member', color: '#DCE7FF', ink: '#2257F4' })} />}
          {tab === 'More' && moreView === 'Notes' && <NotesScreen styles={styles} onAction={showNotice} />}
          {tab === 'More' && moreView === 'Recaps' && <RecapsScreen styles={styles} onAction={showNotice} events={botEvents} chores={chores} messages={messages} />}
          {tab === 'More' && moreView === 'Integrations' && <IntegrationsScreen styles={styles} connected={connected} onConnect={(name: string) => name === 'iOS Notifications' ? enableNotifications() : (setConnected((current) => ({ ...current, [name]: !current[name] })), showNotice(`${name} connection updated`))} />}
          {tab === 'More' && moreView === 'Settings' && <SettingsScreen styles={styles} dark={dark} onTheme={toggleTheme} onNotifications={enableNotifications} onFamily={() => setMoreView('Family')} onAction={showNotice} profiles={profiles} />}
        </View>

        <BottomTabs tab={tab} setTab={(next: Tab) => { setTab(next); if (next !== 'More') setMoreView('Menu'); }} theme={theme} styles={styles} />

        {notice && <View style={styles.toast}><Ionicons name="checkmark-circle" size={18} color="#19A47B" /><Text style={styles.toastText}>{notice}</Text></View>}
      </KeyboardAvoidingView>

      <QuickAddModal
        visible={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
        styles={styles}
        type={quickAddType}
        setType={setQuickAddType}
        title={quickAddTitle}
        setTitle={setQuickAddTitle}
        onSave={saveQuickAdd}
        dark={dark}
      />
      <ShareToCueModal
        visible={sharePreviewOpen}
        styles={styles}
        dark={dark}
        value={sharedDraft}
        onChange={setSharedDraft}
        hasImage={Boolean((shareIntent as any)?.files?.length)}
        error={shareError}
        onCancel={cancelSharedItem}
        onApprove={sendSharedItemToCue}
      />
      <ProfileEditorModal visible={Boolean(editingProfile)} profile={editingProfile} styles={styles} dark={dark} onClose={() => setEditingProfile(null)} onSave={(profile: FamilyProfile) => { const next = profiles.some((item) => item.id === profile.id) ? profiles.map((item) => item.id === profile.id ? profile : item) : [...profiles, profile]; setProfiles(next); AsyncStorage.setItem('coho-family-profiles', JSON.stringify(next)); setEditingProfile(null); showNotice(`${profile.name}’s profile was saved`); }} />
    </SafeAreaView>
  );
}

function Header({ title, styles, dark, onTheme, onRecap, onAdd, onBack }: any) {
  const now = new Date();
  const dateLabel = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase();
  const greeting = now.getHours() < 12 ? 'Good morning,' : now.getHours() < 18 ? 'Good afternoon,' : 'Good evening,';
  return <View style={styles.header}>
    <View style={styles.headerTitleWrap}>
      {onBack && <Pressable onPress={onBack} style={styles.backButton}><Ionicons name="chevron-back" size={22} color={styles.iconColor.color} /></Pressable>}
      <View><Text style={styles.eyebrow}>{dateLabel}</Text><Text style={styles.headerTitle}>{title === 'Today' ? greeting : title}</Text>{title === 'Today' && <Text style={styles.headerTitle}>Cragle family {now.getHours() < 18 ? '☀️' : '🌙'}</Text>}</View>
    </View>
    <View style={styles.headerButtons}>
      <Pressable accessibilityLabel="Open daily recap" onPress={onRecap} style={styles.recapHeaderButton}><Ionicons name="sparkles" size={19} color="#fff" /></Pressable>
      <Pressable accessibilityLabel={dark ? 'Use light mode' : 'Use dark mode'} onPress={onTheme} style={styles.iconButton}><Ionicons name={dark ? 'sunny-outline' : 'moon-outline'} size={20} color={styles.iconColor.color} /></Pressable>
      <Pressable accessibilityLabel="Add to family" onPress={onAdd} style={styles.addButton}><Ionicons name="add" size={25} color="#fff" /></Pressable>
    </View>
  </View>;
}

function TodayScreen({ theme, styles, onCalendar, onRecap, onAction }: any) {
  const cards = [
    { title: 'School pickup', value: '3:15 PM', detail: 'Oliver · Oakview Elementary', icon: 'school-outline', color: '#2257F4', tint: '#DCE7FF' },
    { title: 'Asher soccer', value: '6:00 PM', detail: 'Field 4 · Bring blue jersey', icon: 'football-outline', color: '#168866', tint: '#D9F7ED' },
    { title: 'Trash to curb', value: 'Before 8 PM', detail: 'Assigned to Chad', icon: 'checkmark-done-outline', color: '#E86117', tint: '#FFE1CF' },
    { title: 'Groceries', value: '8 items left', detail: 'Milk, berries, dog food +5', icon: 'cart-outline', color: '#6E3AE2', tint: '#EADFFF' },
  ];
  return <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
    <View style={styles.sectionHead}><View><Text style={styles.sectionTitle}>Today</Text><Text style={styles.muted}>4 things on the family radar</Text></View><Pressable onPress={onCalendar}><Text style={styles.link}>See full day ›</Text></Pressable></View>
    <View style={styles.bentoGrid}>{cards.map((card) => <Pressable key={card.title} onPress={() => onAction(`${card.title}: ${card.detail}`)} style={styles.bentoCard}>
      <View style={[styles.cardIcon, { backgroundColor: card.tint }]}><Ionicons name={card.icon as any} size={24} color={card.color} /></View>
      <Text style={styles.cardTitle}>{card.title}</Text><Text style={styles.cardValue}>{card.value}</Text><Text style={styles.cardDetail}>{card.detail}</Text>
      <View style={[styles.cardPill, { backgroundColor: `${card.color}12` }]}><Ionicons name="time-outline" size={13} color={card.color} /><Text style={[styles.cardPillText, { color: card.color }]}>Tap for details</Text></View>
    </Pressable>)}</View>
    <Pressable onPress={onRecap}><LinearGradient colors={['#2257F4', '#7047EE']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.recapCard}>
      <View style={styles.recapIcon}><Ionicons name="sparkles" size={21} color="#fff" /></View><View style={styles.recapCopy}><Text style={styles.recapLabel}>COHO DAILY</Text><Text style={styles.recapTitle}>Your morning recap is ready</Text><Text style={styles.recapText}>Three events, two open chores, and one new family note.</Text></View><Ionicons name="chevron-forward" size={20} color="#fff" />
    </LinearGradient></Pressable>
    <Text style={styles.sectionTitle}>Family status</Text><View style={styles.familyRow}>{family.map((person) => <View key={person.name} style={styles.familyPerson}><View style={[styles.avatar, { backgroundColor: person.color }]}><Text style={[styles.avatarText, { color: person.ink }]}>{person.initials}</Text></View><Text style={styles.familyName}>{person.name}</Text><Text style={styles.familyStatus}>{person.status}</Text></View>)}</View>
    <Text style={styles.sectionTitle}>Coming up</Text>{liveUpcoming().map((event) => <Pressable key={event.title} onPress={() => onAction(`${event.title} · ${event.time}`)} style={styles.upcomingRow}><View style={[styles.dateTile, { borderColor: event.color }]}><Text style={[styles.dateMonth, { color: event.color }]}>{event.month}</Text><Text style={[styles.dateNumber, { color: event.color }]}>{event.date}</Text></View><View style={styles.flex}><Text style={styles.upcomingTime}>{event.time}</Text><Text style={styles.upcomingTitle}>{event.title}</Text></View><Ionicons name="chevron-forward" size={18} color={theme.muted} /></Pressable>)}
  </ScrollView>;
}

function CalendarScreen({ styles, botEvents, onAction, onManage }: any) {
  const [selected, setSelected] = useState(startOfDay(new Date()));
  const weekStart = startOfWeek(selected);
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const visibleBotEvents = botEvents.filter((event: BotEvent) => !event.dateISO || event.dateISO === localDateKey(selected));
  const period = `${days[0].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}–${days[6].toLocaleDateString(undefined, { month: days[0].getMonth() === days[6].getMonth() ? undefined : 'short', day: 'numeric' })}`;
  return <ScrollView contentContainerStyle={styles.scrollContent}><View style={styles.calendarTop}><Pressable onPress={() => setSelected(addDays(selected, -7))} style={styles.smallButton}><Ionicons name="chevron-back" size={18} color={styles.iconColor.color} /></Pressable><Pressable onPress={() => setSelected(startOfDay(new Date()))}><Text style={styles.calendarPeriod}>{period}</Text><Text style={styles.calendarTodayLink}>Tap for today</Text></Pressable><Pressable onPress={() => setSelected(addDays(selected, 7))} style={styles.smallButton}><Ionicons name="chevron-forward" size={18} color={styles.iconColor.color} /></Pressable></View><View style={styles.weekRow}>{days.map((day) => { const active = sameDay(day, selected); return <Pressable key={day.toISOString()} onPress={() => setSelected(day)} style={[styles.dayBubble, active && styles.dayBubbleActive]}><Text style={[styles.dayLabel, active && styles.dayTextActive]}>{day.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase()}</Text><Text style={[styles.dayNumber, active && styles.dayTextActive]}>{day.getDate()}</Text></Pressable>; })}</View><Text style={styles.sectionTitle}>{selected.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</Text>{[
    ['3:15 PM', 'School pickup', 'Oliver · Oakview Elementary', '#2257F4'], ['6:00 PM', 'Asher soccer', 'Field 4 · Bring blue jersey', '#19A47B'], ['8:00 PM', 'Trash to curb', 'Assigned to Chad', '#FF7A2E']
  ].map(([time, title, detail, color]) => <Pressable key={title} onPress={() => onAction(`${title} · ${time} · ${detail}`)} style={styles.timelineRow}><View style={[styles.timelineLine, { backgroundColor: color }]} /><Text style={styles.timelineTime}>{time}</Text><View style={styles.flex}><Text style={styles.timelineTitle}>{title}</Text><Text style={styles.muted}>{detail}</Text></View><Ionicons name="chevron-forward" size={18} color={styles.iconColor.color} /></Pressable>)}{visibleBotEvents.map((event: BotEvent) => <Pressable key={event.id} onPress={() => onAction(`${event.title} · ${event.time}`)} style={styles.timelineRow}><View style={[styles.timelineLine, { backgroundColor: '#7047EE' }]} /><Text style={styles.timelineTime}>{event.time}</Text><View style={styles.flex}><Text style={styles.timelineTitle}>{event.title}</Text><Text style={styles.muted}>{event.person} · {event.place ?? event.day}{event.reminder ? ` · ${event.reminder} min reminder` : ''}</Text></View><Ionicons name="sparkles" size={18} color="#7047EE" /></Pressable>)}<Pressable onPress={onManage} style={styles.syncCard}><Ionicons name="sync" size={18} color="#2257F4" /><View style={styles.flex}><Text style={styles.syncTitle}>Calendars synced</Text><Text style={styles.muted}>Apple Calendar · Google · Skylight</Text></View><Text style={styles.link}>Manage</Text></Pressable></ScrollView>;
}

function ChoresScreen({ styles, chores, onToggle, rewardMember, setRewardMember, selectedRewards, onSelectReward, onAdd }: any) {
  const completed = chores.filter((item: any) => item.done).length;
  const balances = familyNames().reduce((result, name) => ({ ...result, [name]: chores.filter((item: any) => item.owner === name && item.done).reduce((sum: number, item: any) => sum + item.points, 0) }), {} as Record<string, number>);
  const selected = rewardGoals.find((reward) => reward.id === selectedRewards[rewardMember]) ?? rewardGoals[0];
  const balance = balances[rewardMember] ?? 0;
  const progress = Math.min(100, Math.round(balance / selected.cost * 100));
  return <ScrollView contentContainerStyle={styles.scrollContent}>
    <View style={styles.progressCard}><View><Text style={styles.progressLabel}>FAMILY PROGRESS</Text><Text style={styles.progressValue}>{completed} of {chores.length}</Text><Text style={styles.muted}>chores complete today</Text></View><View style={styles.progressRing}><Text style={styles.progressPercent}>{Math.round(completed / chores.length * 100)}%</Text></View></View>
    <Text style={styles.sectionTitle}>Earn rewards</Text>
    <View style={styles.memberRewardTabs}>{familyNames().map((name) => <Pressable key={name} onPress={() => setRewardMember(name)} style={[styles.memberRewardTab, rewardMember === name && styles.memberRewardTabActive]}><Text style={[styles.memberRewardName, rewardMember === name && styles.memberRewardNameActive]}>{name}</Text><Text style={[styles.memberRewardPoints, rewardMember === name && styles.memberRewardNameActive]}>{balances[name] ?? 0} pts</Text></Pressable>)}</View>
    <View style={styles.rewardHero}><View style={[styles.rewardIcon, { backgroundColor: `${selected.color}20` }]}><Ionicons name={selected.icon as any} size={25} color={selected.color} /></View><View style={styles.flex}><Text style={styles.progressLabel}>{rewardMember.toUpperCase()} IS EARNING TOWARD</Text><Text style={styles.rewardHeroTitle}>{selected.title} · {selected.detail}</Text><View style={styles.rewardProgressTrack}><View style={[styles.rewardProgressFill, { width: `${progress}%`, backgroundColor: selected.color }]} /></View><Text style={styles.rewardProgressText}>{balance} of {selected.cost} points · {Math.max(0, selected.cost - balance)} to go</Text></View></View>
    <Text style={styles.rewardPrompt}>What does {rewardMember} want to earn?</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rewardChoices}>{rewardGoals.map((reward) => { const active = selected.id === reward.id; return <Pressable key={reward.id} onPress={() => onSelectReward(rewardMember, reward.id)} style={[styles.rewardChoice, active && { borderColor: reward.color, backgroundColor: `${reward.color}12` }]}><Ionicons name={reward.icon as any} size={21} color={reward.color} /><Text style={styles.rewardChoiceTitle}>{reward.title}</Text><Text style={styles.muted}>{reward.detail}</Text><Text style={[styles.rewardCost, { color: reward.color }]}>{reward.cost} points</Text>{active && <Ionicons name="checkmark-circle" size={18} color={reward.color} style={styles.rewardSelected} />}</Pressable>; })}</ScrollView>
    <Text style={styles.sectionTitle}>This week</Text>{chores.map((chore: any) => <Pressable key={chore.id} onPress={() => onToggle(chore.id)} style={styles.choreRow}><View style={[styles.checkCircle, chore.done && { backgroundColor: '#19A47B', borderColor: '#19A47B' }]}>{chore.done && <Ionicons name="checkmark" size={17} color="#fff" />}</View><View style={styles.flex}><Text style={[styles.choreTitle, chore.done && styles.struck]}>{chore.title}</Text><Text style={styles.muted}>{chore.owner} · {chore.due}</Text></View><View style={styles.pointPill}><Ionicons name="sparkles" size={12} color="#7047EE" /><Text style={styles.pointPillText}>+{chore.points}</Text></View><View style={[styles.ownerDot, { backgroundColor: chore.color }]} /></Pressable>)}<Pressable onPress={onAdd} style={styles.outlineAction}><Ionicons name="add" size={19} color="#2257F4" /><Text style={styles.outlineActionText}>Add a recurring chore</Text></Pressable>
  </ScrollView>;
}

function ChatScreen({ styles, messages, draft, setDraft, onSend, onAdd, cohThinking }: any) {
  const cohActive = /^\s*(@coh|hey coh)\b/i.test(draft);
  return <View style={styles.flex}><FlatList data={messages} keyExtractor={(item) => item.id} contentContainerStyle={styles.messageList} automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled" renderItem={({ item }) => <View style={[styles.messageWrap, item.mine && styles.messageMine]}>{!item.mine && <View style={[styles.avatar, item.bot ? styles.botAvatar : styles.chatAvatar]}>{item.bot ? <Ionicons name="sparkles" size={17} color="#fff" /> : <Text style={styles.avatarText}>LC</Text>}</View>}<View style={styles.messageBody}><Text style={[styles.messageAuthor, item.mine && styles.messageAuthorMine, item.bot && styles.botAuthor]}>{item.author}</Text><View style={[styles.messageBubble, item.mine && styles.messageBubbleMine, item.bot && styles.botBubble]}><MentionText text={item.text} mine={item.mine} styles={styles} /></View></View></View>} ListHeaderComponent={<View><View style={styles.chatHeader}><View style={styles.homeThreadIcon}><Ionicons name="home" size={20} color="#F5A623" /></View><View><Text style={styles.chatTitle}>Everyone</Text><Text style={styles.muted}>4 family members + Coh</Text></View></View><View style={styles.botHint}><Ionicons name="sparkles" size={15} color="#7047EE" /><Text style={styles.botHintText}>Try “Hey Coh, haircut for Chad on Wednesday at 9:30 AM”</Text></View></View>} ListFooterComponent={cohThinking ? <View style={styles.cohThinking}><Ionicons name="sparkles" size={15} color="#7047EE" /><Text style={styles.botAuthor}>Coh is thinking…</Text></View> : null} /><View style={[styles.composeRow, cohActive && styles.composeRowCoh]}><Pressable onPress={onAdd} style={[styles.composePlus, cohActive && styles.composeCohBadge]}>{cohActive ? <Ionicons name="sparkles" size={18} color="#fff" /> : <Ionicons name="add" size={22} color="#2257F4" />}</Pressable><TextInput value={draft} onChangeText={setDraft} placeholder={cohThinking ? 'Coh is thinking…' : 'Message everyone or @Coh…'} placeholderTextColor="#8B93A5" editable={!cohThinking} style={[styles.composeInput, cohActive && styles.composeInputCoh]} returnKeyType="send" onSubmitEditing={onSend} /><Pressable disabled={cohThinking} onPress={onSend} style={[styles.sendButton, cohActive && styles.sendButtonCoh, cohThinking && { opacity: .55 }]}><Ionicons name={cohActive ? 'sparkles' : 'send'} size={17} color="#fff" /></Pressable></View></View>;
}

function MentionText({ text, mine, styles }: { text: string; mine: boolean; styles: any }) {
  const match = text.match(/(@coh|hey coh)\b/i);
  if (!match || match.index === undefined) return <Text style={[styles.messageText, mine && styles.messageTextMine]}>{text}</Text>;
  const start = match.index;
  const end = start + match[0].length;
  return <Text style={[styles.messageText, mine && styles.messageTextMine]}>{text.slice(0, start)}<Text style={styles.cohMention}>✦ {match[0]}</Text>{text.slice(end)}</Text>;
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
function startOfWeek(date: Date) { const next = startOfDay(date); next.setDate(next.getDate() - next.getDay()); return next; }
function sameDay(a: Date, b: Date) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function localDateKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function liveUpcoming() { return upcoming.map((event, index) => { const date = addDays(new Date(), index + 2); return { ...event, date: String(date.getDate()), month: date.toLocaleDateString(undefined, { month: 'short' }).toUpperCase() }; }); }

function FamilyProfilesScreen({ styles, profiles, onEdit, onAdd }: { styles: any; profiles: FamilyProfile[]; onEdit: (profile: FamilyProfile) => void; onAdd: () => void }) {
  return <ScrollView contentContainerStyle={styles.scrollContent}><View style={styles.familyHero}><View><Text style={styles.progressLabel}>YOUR HOUSEHOLD</Text><Text style={styles.familyHeroTitle}>{profiles.length} family members</Text><Text style={styles.muted}>Profiles help Coh personalize schedules, rewards, reminders, and recaps.</Text></View><Pressable onPress={onAdd} style={styles.addProfileButton}><Ionicons name="person-add" size={20} color="#fff" /></Pressable></View><Text style={styles.sectionTitle}>People</Text>{profiles.map((profile) => <Pressable key={profile.id} onPress={() => onEdit(profile)} style={styles.profileRow}><ProfileAvatar profile={profile} styles={styles} size="large" /><View style={styles.flex}><Text style={styles.profileName}>{profile.name || 'New family member'}</Text><Text style={styles.muted}>{profile.role}{profile.dob ? ` · Born ${profile.dob}` : ''}</Text><Text numberOfLines={1} style={styles.profileBio}>{profile.bio || 'Add a bio, interests, allergies, school, or anything Coh should know.'}</Text></View><Ionicons name="create-outline" size={20} color={styles.iconColor.color} /></Pressable>)}<Pressable onPress={onAdd} style={styles.outlineAction}><Ionicons name="person-add-outline" size={19} color="#2257F4" /><Text style={styles.outlineActionText}>Add family member</Text></Pressable></ScrollView>;
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
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: .8 });
    if (!result.canceled) setDraft((current) => current ? { ...current, avatarUri: result.assets[0].uri } : current);
  }
  const update = (patch: Partial<FamilyProfile>) => setDraft((current) => current ? { ...current, ...patch } : current);
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}><Pressable style={styles.modalDismiss} onPress={onClose} /><ScrollView style={styles.profileSheet} contentContainerStyle={styles.profileSheetContent} keyboardShouldPersistTaps="handled"><View style={styles.modalHandle} /><View style={styles.modalHead}><View><Text style={styles.eyebrow}>FAMILY PROFILE</Text><Text style={styles.modalTitle}>{draft.name ? `Edit ${draft.name}` : 'Add someone'}</Text></View><Pressable onPress={onClose} style={styles.iconButton}><Ionicons name="close" size={21} color={styles.iconColor.color} /></Pressable></View><Pressable onPress={choosePhoto} style={styles.photoEditor}><ProfileAvatar profile={draft} styles={styles} size="large" /><View><Text style={styles.settingTitle}>Profile picture</Text><Text style={styles.link}>Choose from Photos</Text></View></Pressable><Text style={styles.fieldLabel}>NAME</Text><TextInput value={draft.name} onChangeText={(name) => update({ name })} placeholder="Full name" placeholderTextColor="#8B93A5" style={styles.modalInput} /><Text style={styles.fieldLabel}>DATE OF BIRTH</Text><TextInput value={draft.dob} onChangeText={(dob) => update({ dob })} placeholder="MM/DD/YYYY" placeholderTextColor="#8B93A5" keyboardType="numbers-and-punctuation" style={styles.modalInput} /><Text style={styles.fieldLabel}>ROLE</Text><View style={styles.chipRow}>{['Adult admin', 'Family member', 'Child'].map((role) => <Pressable key={role} onPress={() => update({ role })} style={[styles.choiceChip, draft.role === role && styles.choiceChipActive]}><Text style={[styles.choiceChipText, draft.role === role && styles.choiceChipTextActive]}>{role}</Text></Pressable>)}</View><Text style={styles.fieldLabel}>ABOUT</Text><TextInput value={draft.bio} onChangeText={(bio) => update({ bio })} multiline placeholder="Interests, allergies, school, preferences, or anything useful for the family" placeholderTextColor="#8B93A5" style={[styles.modalInput, styles.modalTextArea]} /><Text style={styles.profilePrivacy}>This information stays inside your Coho household and is used to personalize family assistance.</Text><Pressable disabled={!draft.name.trim()} onPress={() => onSave(draft)} style={[styles.saveButton, !draft.name.trim() && { opacity: .45 }]}><Text style={styles.saveButtonText}>Save profile</Text></Pressable></ScrollView><StatusBar style={dark ? 'light' : 'dark'} /></KeyboardAvoidingView></Modal>;
}

function MoreMenu({ styles, setView }: any) {
  const items = [
    ['Chief of Home', 'home-outline', '#7047EE', 'Personal briefings, week ahead, and follow-ups'],
    ['Family', 'people-outline', '#2257F4', 'Members, roles, and family invitations'],
    ['Notes', 'document-text-outline', '#7C4DFF', 'Lists, instructions, and family details'],
    ['Recaps', 'sparkles-outline', '#2257F4', 'Daily summaries by push and email'],
    ['Integrations', 'extension-puzzle-outline', '#19A47B', 'Skylight, calendars, email, and more'],
    ['Settings', 'settings-outline', '#FF7A2E', 'Household, privacy, and preferences'],
  ];
  return <ScrollView contentContainerStyle={styles.scrollContent}><Text style={styles.moreIntro}>Everything else your household needs, without cluttering the everyday view.</Text><View style={styles.moreGrid}>{items.map(([title, icon, color, detail]) => <Pressable key={title} onPress={() => setView(title)} style={styles.moreCard}><View style={[styles.moreIcon, { backgroundColor: `${color}18` }]}><Ionicons name={icon as any} size={25} color={color} /></View><Text style={styles.moreTitle}>{title}</Text><Text style={styles.moreDetail}>{detail}</Text><Ionicons name="chevron-forward" size={18} color={styles.iconColor.color} style={styles.moreChevron} /></Pressable>)}</View></ScrollView>;
}

function ChiefOfHomeScreen({ styles, prefs, setPrefs, onActivate }: { styles: any; prefs: ChiefPrefs; setPrefs: (value: ChiefPrefs) => void; onActivate: () => void }) {
  const update = (patch: Partial<ChiefPrefs>) => setPrefs({ ...prefs, ...patch });
  const toggleMember = (name: string) => update({ members: prefs.members.includes(name) ? prefs.members.filter((item) => item !== name) : [...prefs.members, name] });
  const briefingRows = [
    { key: 'daily', icon: 'sunny-outline', color: '#FF7A2E', title: 'Daily briefing', detail: `Every day at ${prefs.dailyTime}`, times: ['6:30 AM', '7:00 AM', '8:00 AM'] },
    { key: 'weekAhead', icon: 'calendar-outline', color: '#2257F4', title: 'Full week ahead', detail: `${prefs.weekAheadDay} at ${prefs.weekAheadTime}`, times: ['5:00 PM', '6:00 PM', '7:00 PM'] },
    { key: 'followUp', icon: 'refresh-outline', color: '#19A47B', title: 'Weekly follow-up', detail: `${prefs.followUpDay} at ${prefs.followUpTime}`, times: ['4:00 PM', '5:00 PM', '6:00 PM'] },
  ];
  return <ScrollView contentContainerStyle={styles.scrollContent}>
    <LinearGradient colors={['#24116D', '#7047EE']} style={styles.chiefHero}><View style={styles.chiefBadge}><Ionicons name="home" size={22} color="#7047EE" /></View><Text style={styles.recapHeroLabel}>KINCUE</Text><Text style={styles.chiefHeroTitle}>Your Chief of Home</Text><Text style={styles.recapHeroText}>The right family information, resurfaced before anyone has to remember it.</Text></LinearGradient>
    <Text style={styles.sectionTitle}>Your briefings</Text>
    {briefingRows.map((row) => <View key={row.key} style={styles.chiefSettingCard}><View style={styles.settingRowTop}><View style={[styles.integrationIcon, { backgroundColor: `${row.color}18` }]}><Ionicons name={row.icon as any} size={22} color={row.color} /></View><View style={styles.flex}><Text style={styles.settingTitle}>{row.title}</Text><Text style={styles.muted}>{row.detail}</Text></View><Switch value={(prefs as any)[row.key]} onValueChange={(value) => update({ [row.key]: value })} trackColor={{ true: '#6687FF' }} /></View><View style={styles.chipRow}>{row.times.map((time) => { const field = row.key === 'daily' ? 'dailyTime' : row.key === 'weekAhead' ? 'weekAheadTime' : 'followUpTime'; return <Pressable key={time} onPress={() => update({ [field]: time })} style={[styles.choiceChip, (prefs as any)[field] === time && styles.choiceChipActive]}><Text style={[styles.choiceChipText, (prefs as any)[field] === time && styles.choiceChipTextActive]}>{time}</Text></Pressable>; })}</View></View>)}
    <Text style={styles.sectionTitle}>Include</Text><View style={styles.preferenceGrid}>{([['events', 'Appointments & events'], ['chores', 'Chores'], ['followUps', 'Follow-ups'], ['messages', 'Important messages']] as const).map(([key, label]) => <Pressable key={key} onPress={() => update({ [key]: !prefs[key] })} style={[styles.preferenceTile, prefs[key] && styles.preferenceTileActive]}><Ionicons name={prefs[key] ? 'checkmark-circle' : 'ellipse-outline'} size={19} color={prefs[key] ? '#19A47B' : styles.iconColor.color} /><Text style={styles.preferenceText}>{label}</Text></Pressable>)}</View>
    <Text style={styles.sectionTitle}>Family members</Text><View style={styles.chipRow}>{familyNames().map((name) => <Pressable key={name} onPress={() => toggleMember(name)} style={[styles.memberChip, prefs.members.includes(name) && styles.memberChipActive]}><Text style={[styles.choiceChipText, prefs.members.includes(name) && styles.choiceChipTextActive]}>{name}</Text></Pressable>)}</View>
    <Text style={styles.sectionTitle}>Delivery</Text><View style={styles.settingRow}><Ionicons name="notifications-outline" size={21} color="#7047EE" /><View style={styles.flex}><Text style={styles.settingTitle}>Push notifications</Text><Text style={styles.muted}>Delivered to this iPhone</Text></View><Switch value={prefs.push} onValueChange={(push) => update({ push })} trackColor={{ true: '#6687FF' }} /></View><View style={styles.settingRow}><Ionicons name="mail-outline" size={21} color="#2257F4" /><View style={styles.flex}><Text style={styles.settingTitle}>Email copy</Text><Text style={styles.muted}>Available when family email delivery is connected</Text></View><Switch value={prefs.email} onValueChange={(email) => update({ email })} trackColor={{ true: '#6687FF' }} /></View><View style={styles.settingRow}><Ionicons name="moon-outline" size={21} color="#7C4DFF" /><View style={styles.flex}><Text style={styles.settingTitle}>Quiet hours</Text><Text style={styles.muted}>9:00 PM–7:00 AM · urgent alerts only</Text></View><Switch value={prefs.quietHours} onValueChange={(quietHours) => update({ quietHours })} trackColor={{ true: '#6687FF' }} /></View>
    <Pressable onPress={onActivate} style={styles.saveButton}><Text style={styles.saveButtonText}>Save and schedule my briefings</Text></Pressable>
  </ScrollView>;
}

function NotesScreen({ styles, onAction }: any) {
  const notes = [['🛒', 'Weekly groceries', '8 items · Updated 12 min ago'], ['🏡', 'Lake house details', 'Shared with everyone'], ['🍝', 'Dinner ideas', '12 recipes'], ['☎️', 'Emergency contacts', 'Pinned · Family admins'], ['🎁', 'Gift ideas', 'Private to adults'], ['🧳', 'PA packing list', '23 of 31 packed']];
  return <ScrollView contentContainerStyle={styles.scrollContent}><TextInput placeholder="Search family notes" placeholderTextColor="#8B93A5" style={styles.searchInput} /><View style={styles.notesGrid}>{notes.map(([icon, title, meta]) => <Pressable key={title} onPress={() => onAction(`${title} · ${meta}`)} style={styles.noteCard}><Text style={styles.noteEmoji}>{icon}</Text><Text style={styles.noteTitle}>{title}</Text><Text style={styles.muted}>{meta}</Text><Ionicons name="chevron-forward" size={16} color={styles.iconColor.color} style={styles.noteChevron} /></Pressable>)}</View></ScrollView>;
}

function RecapsScreen({ styles, onAction, events, chores, messages }: any) {
  const week = [['MON', 'Dentist follow-up · Chad', '9:30 AM'], ['TUE', 'Asher soccer practice', '6:00 PM'], ['WED', 'School pickup · Oliver', '3:15 PM'], ['THU', 'Lake trip packing deadline', '7:00 PM'], ['FRI', 'Family dinner reservation', '6:30 PM'], ['SAT', 'Knoebels family day', '10:00 AM'], ['SUN', 'Plan the coming week', '6:00 PM']];
  const openChores = chores.filter((item: any) => !item.done).length;
  const recentMessages = messages.filter((item: ChatMessage) => !item.bot).slice(-5).length;
  const syncTime = new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return <ScrollView contentContainerStyle={styles.scrollContent}><LinearGradient colors={['#2257F4', '#7047EE']} style={styles.recapHero}><Ionicons name="sparkles" size={24} color="#fff" /><Text style={styles.recapHeroLabel}>LIVE DAILY SYNC · {syncTime.toUpperCase()}</Text><Text style={styles.recapHeroTitle}>Here’s what your home needs now.</Text><Text style={styles.recapHeroText}>{events.length} family event{events.length === 1 ? '' : 's'}, {openChores} open chore{openChores === 1 ? '' : 's'}, and {recentMessages} recent family message{recentMessages === 1 ? '' : 's'} are in your current briefing.</Text><View style={styles.recapActionRow}><Pressable onPress={() => onAction('Daily sync refreshed with the latest family activity')} style={styles.recapHeroButton}><Ionicons name="refresh" size={15} color="#2257F4" /><Text>Refresh now</Text></Pressable><Pressable onPress={() => onAction('Audio briefing playback is ready')} style={styles.recapHeroButton}><Ionicons name="play" size={15} color="#2257F4" /><Text>Listen</Text></Pressable></View></LinearGradient>{events.length > 0 && <><Text style={styles.sectionTitle}>Added by Coh</Text>{events.slice(-5).map((event: BotEvent) => <Pressable key={event.id} onPress={() => onAction(`${event.title} · ${event.day} at ${event.time}`)} style={styles.highlightRow}><Text style={styles.highlightTime}>{event.time}</Text><View style={styles.flex}><Text style={styles.highlightText}>{event.title}</Text><Text style={styles.muted}>{event.person} · {event.day}{event.place ? ` · ${event.place}` : ''}</Text></View><Ionicons name="sparkles" size={17} color="#7047EE" /></Pressable>)}</>}<Text style={styles.sectionTitle}>Week ahead</Text>{week.map(([day, text, time]) => <Pressable onPress={() => onAction(`${text} · ${time}`)} key={day} style={styles.highlightRow}><Text style={styles.highlightTime}>{day}</Text><View style={styles.flex}><Text style={styles.highlightText}>{text}</Text><Text style={styles.muted}>{time}</Text></View><Ionicons name="chevron-forward" size={17} color={styles.iconColor.color} /></Pressable>)}<Text style={styles.sectionTitle}>Needs follow-up</Text>{[['Dentist visit', 'Schedule the six-month follow-up'], ['School meeting', 'Return the signed permission form']].map(([title, detail]) => <View key={title} style={styles.followUpCard}><Ionicons name="refresh-circle" size={23} color="#19A47B" /><View style={styles.flex}><Text style={styles.settingTitle}>{title}</Text><Text style={styles.muted}>{detail}</Text></View><Pressable onPress={() => onAction(`${title} marked resolved`)} style={styles.connectButton}><Text style={styles.connectText}>Resolve</Text></Pressable></View>)}</ScrollView>;
}

function IntegrationsScreen({ styles, connected, onConnect }: any) {
  const items = [['Apple Calendar', 'calendar-outline', '#2257F4'], ['Skylight', 'cloud-outline', '#FF7A2E'], ['Google Calendar', 'logo-google', '#19A47B'], ['Outlook', 'mail-outline', '#2257F4'], ['iOS Notifications', 'phone-portrait-outline', '#7C4DFF'], ['Email Inbox', 'mail-unread-outline', '#FF7A2E'], ['Automations', 'flash-outline', '#7C4DFF']];
  return <ScrollView contentContainerStyle={styles.scrollContent}><LinearGradient colors={['#24116D', '#6648EF']} style={styles.automationCard}><Ionicons name="flash" size={23} color="#fff" /><View style={styles.flex}><Text style={styles.automationLabel}>AUTOMATION IDEA</Text><Text style={styles.automationTitle}>Turn school emails into suggested family events.</Text></View></LinearGradient>{items.map(([name, icon, color]) => <View key={name} style={styles.integrationRow}><View style={[styles.integrationIcon, { backgroundColor: `${color}18` }]}><Ionicons name={icon as any} size={23} color={color} /></View><View style={styles.flex}><Text style={styles.integrationTitle}>{name}</Text><Text style={styles.muted}>{name === 'Skylight' ? 'Calendar and chore synchronization' : 'Keep family information flowing automatically'}</Text></View><Pressable onPress={() => onConnect(name)} style={[styles.connectButton, connected[name] && styles.connectedButton]}><Text style={[styles.connectText, connected[name] && styles.connectedText]}>{connected[name] ? 'Connected' : 'Connect'}</Text></Pressable></View>)}</ScrollView>;
}

function SettingsScreen({ styles, dark, onTheme, onNotifications, onFamily, onAction, profiles }: any) {
  return <ScrollView contentContainerStyle={styles.scrollContent}><Text style={styles.sectionTitle}>Household</Text><Pressable onPress={onFamily} style={styles.settingRow}><Ionicons name="people-outline" size={21} color="#2257F4" /><View style={styles.flex}><Text style={styles.settingTitle}>Family profiles</Text><Text style={styles.muted}>{profiles.length} people · names, photos, DOB, roles, and bios</Text></View><Ionicons name="chevron-forward" size={18} color={styles.iconColor.color} /></Pressable><Text style={styles.sectionTitle}>Preferences</Text><View style={styles.settingRow}><Ionicons name="moon-outline" size={21} color="#7C4DFF" /><View style={styles.flex}><Text style={styles.settingTitle}>Dark mode</Text><Text style={styles.muted}>Use the darker Coho theme</Text></View><Switch value={dark} onValueChange={onTheme} trackColor={{ true: '#6687FF' }} /></View><Pressable onPress={onNotifications} style={styles.settingRow}><Ionicons name="notifications-outline" size={21} color="#FF7A2E" /><View style={styles.flex}><Text style={styles.settingTitle}>Smart notifications</Text><Text style={styles.muted}>Enable reminders and daily recaps</Text></View><Ionicons name="chevron-forward" size={18} color={styles.iconColor.color} /></Pressable><Pressable onPress={() => onAction('Privacy controls opened')} style={styles.settingRow}><Ionicons name="shield-checkmark-outline" size={21} color="#19A47B" /><View style={styles.flex}><Text style={styles.settingTitle}>Privacy and family data</Text><Text style={styles.muted}>Permissions, exports, and deletion</Text></View><Ionicons name="chevron-forward" size={18} color={styles.iconColor.color} /></Pressable></ScrollView>;
}

function BottomTabs({ tab, setTab, styles }: any) {
  const tabs = [['Today', 'sparkles'], ['Calendar', 'calendar'], ['Chores', 'checkbox'], ['Chat', 'chatbubble-ellipses'], ['More', 'grid']];
  return <View style={styles.tabBar}>{tabs.map(([name, icon]) => <Pressable key={name} onPress={() => setTab(name)} style={styles.tabItem}><View style={[styles.tabIconWrap, tab === name && styles.tabIconActive]}><Ionicons name={(tab === name ? icon : `${icon}-outline`) as any} size={21} color={tab === name ? '#fff' : styles.iconColor.color} /></View><Text style={[styles.tabLabel, tab === name && styles.tabLabelActive]}>{name}</Text></Pressable>)}</View>;
}

function QuickAddModal({ visible, onClose, styles, type, setType, title, setTitle, onSave, dark }: any) {
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}><Pressable style={styles.modalDismiss} onPress={onClose} /><View style={styles.modalSheet}><View style={styles.modalHandle} /><View style={styles.modalHead}><View><Text style={styles.eyebrow}>QUICK ADD</Text><Text style={styles.modalTitle}>Share with the family</Text></View><Pressable onPress={onClose} style={styles.iconButton}><Ionicons name="close" size={21} color={styles.iconColor.color} /></Pressable></View><View style={styles.typeTabs}>{['Event', 'Chore', 'Note', 'Message'].map((item) => <Pressable key={item} onPress={() => setType(item)} style={[styles.typeTab, type === item && styles.typeTabActive]}><Text style={[styles.typeTabText, type === item && styles.typeTabTextActive]}>{item}</Text></Pressable>)}</View><Text style={styles.fieldLabel}>{type} title</Text><TextInput value={title} onChangeText={setTitle} autoFocus placeholder={`Add a ${type.toLowerCase()}…`} placeholderTextColor="#8B93A5" style={styles.modalInput} /><Text style={styles.fieldLabel}>Details</Text><TextInput multiline placeholder="Location, instructions, links, or anything the family should know" placeholderTextColor="#8B93A5" style={[styles.modalInput, styles.modalTextArea]} /><Pressable onPress={onSave} style={styles.saveButton}><Text style={styles.saveButtonText}>Add {type.toLowerCase()}</Text></Pressable></View><StatusBar style={dark ? 'light' : 'dark'} /></KeyboardAvoidingView></Modal>;
}

function ShareToCueModal({ visible, styles, dark, value, onChange, hasImage, error, onCancel, onApprove }: any) {
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
        {hasImage && <View style={styles.sharedAttachment}><Ionicons name="image-outline" size={20} color="#7047EE" /><View style={styles.flex}><Text style={styles.settingTitle}>Screenshot attached</Text><Text style={styles.muted}>Image reading is not connected yet. Add the event details below.</Text></View></View>}
        <Text style={styles.fieldLabel}>REVIEW OR EDIT BEFORE SENDING</Text>
        <TextInput value={value} onChangeText={onChange} multiline placeholder={hasImage ? 'Example: Haircut for Chad Wednesday at 9:30 AM' : 'Selected text or link'} placeholderTextColor="#8B93A5" style={[styles.modalInput, styles.sharePreviewInput]} />
        {error && <Text style={styles.shareError}>The shared item could not be read. Nothing has been saved.</Text>}
        <View style={styles.shareActions}><Pressable onPress={onCancel} style={styles.cancelButton}><Text style={styles.cancelButtonText}>Cancel</Text></Pressable><Pressable onPress={onApprove} style={styles.approveButton}><Ionicons name="sparkles" size={16} color="#fff" /><Text style={styles.saveButtonText}>Ask Cue</Text></Pressable></View>
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
    calendarTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14 }, smallButton: { width: 38, height: 38, borderRadius: 12, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, alignItems: 'center', justifyContent: 'center' }, calendarPeriod: { color: t.text, fontWeight: '800', fontSize: 15, textAlign: 'center' }, calendarTodayLink: { color: t.primary, fontSize: 8, fontWeight: '800', textAlign: 'center', marginTop: 2 }, weekRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: t.surface, borderRadius: 18, borderWidth: 1, borderColor: t.line, padding: 7 }, dayBubble: { width: 40, height: 58, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, dayBubbleActive: { backgroundColor: t.primary }, dayLabel: { color: t.muted, fontSize: 7, fontWeight: '800' }, dayNumber: { color: t.text, fontSize: 17, fontWeight: '800', marginTop: 3 }, dayTextActive: { color: '#fff' }, timelineRow: { minHeight: 76, borderRadius: 18, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10 }, timelineLine: { width: 4, height: 42, borderRadius: 3 }, timelineTime: { color: t.muted, fontSize: 10, width: 50, fontWeight: '700' }, timelineTitle: { color: t.text, fontSize: 13, fontWeight: '800' }, syncCard: { minHeight: 67, borderRadius: 18, padding: 13, flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: `${t.primary}0C`, borderWidth: 1, borderColor: `${t.primary}24` }, syncTitle: { color: t.text, fontSize: 11, fontWeight: '800' },
    progressCard: { minHeight: 130, borderRadius: 23, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, padding: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, progressLabel: { color: t.primary, fontSize: 8, fontWeight: '800', letterSpacing: 1 }, progressValue: { color: t.text, fontSize: 28, fontWeight: '800', letterSpacing: -1, marginTop: 5 }, progressRing: { width: 74, height: 74, borderRadius: 37, borderWidth: 8, borderColor: '#19A47B', alignItems: 'center', justifyContent: 'center' }, progressPercent: { color: t.text, fontSize: 16, fontWeight: '800' }, memberRewardTabs: { flexDirection: 'row', padding: 4, borderRadius: 16, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line }, memberRewardTab: { flex: 1, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, memberRewardTabActive: { backgroundColor: t.primary }, memberRewardName: { color: t.text, fontSize: 10, fontWeight: '800' }, memberRewardNameActive: { color: '#fff' }, memberRewardPoints: { color: t.muted, fontSize: 8, marginTop: 2, fontWeight: '700' }, rewardHero: { minHeight: 118, borderRadius: 21, padding: 16, flexDirection: 'row', gap: 13, alignItems: 'center', backgroundColor: t.surface, borderWidth: 1, borderColor: t.line }, rewardIcon: { width: 52, height: 52, borderRadius: 17, alignItems: 'center', justifyContent: 'center' }, rewardHeroTitle: { color: t.text, fontSize: 14, lineHeight: 19, fontWeight: '800', marginTop: 4 }, rewardProgressTrack: { height: 7, borderRadius: 4, backgroundColor: t.line, overflow: 'hidden', marginTop: 10 }, rewardProgressFill: { height: 7, borderRadius: 4 }, rewardProgressText: { color: t.muted, fontSize: 8, fontWeight: '700', marginTop: 5 }, rewardPrompt: { color: t.text, fontSize: 12, fontWeight: '800', marginTop: 2 }, rewardChoices: { gap: 10, paddingRight: 18 }, rewardChoice: { width: 145, minHeight: 130, borderRadius: 18, padding: 14, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line }, rewardChoiceTitle: { color: t.text, fontSize: 12, fontWeight: '800', marginTop: 11, marginBottom: 3 }, rewardCost: { fontSize: 9, fontWeight: '800', marginTop: 10 }, rewardSelected: { position: 'absolute', right: 10, top: 10 }, choreRow: { minHeight: 70, borderRadius: 17, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }, checkCircle: { width: 27, height: 27, borderRadius: 14, borderWidth: 2, borderColor: t.line, alignItems: 'center', justifyContent: 'center' }, choreTitle: { color: t.text, fontSize: 13, fontWeight: '800' }, struck: { textDecorationLine: 'line-through', color: t.muted }, pointPill: { minHeight: 27, borderRadius: 14, paddingHorizontal: 8, flexDirection: 'row', gap: 4, alignItems: 'center', backgroundColor: '#7047EE14' }, pointPillText: { color: '#7047EE', fontSize: 9, fontWeight: '900' }, ownerDot: { width: 9, height: 9, borderRadius: 5 }, outlineAction: { minHeight: 48, borderRadius: 15, borderWidth: 1, borderStyle: 'dashed', borderColor: t.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }, outlineActionText: { color: t.primary, fontSize: 11, fontWeight: '800' },
    messageList: { padding: 18, paddingBottom: 24, gap: 16 }, chatHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line }, homeThreadIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: `${t.primary}14`, alignItems: 'center', justifyContent: 'center' }, chatTitle: { color: t.text, fontSize: 14, fontWeight: '800' }, botHint: { minHeight: 48, borderRadius: 15, paddingHorizontal: 12, marginBottom: 5, flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: '#7047EE12', borderWidth: 1, borderColor: '#7047EE30' }, botHintText: { color: t.text, fontSize: 10, lineHeight: 14, flex: 1, fontWeight: '700' }, messageWrap: { maxWidth: '88%', flexDirection: 'row', gap: 8, alignSelf: 'flex-start' }, messageBody: { flexShrink: 1 }, messageMine: { alignSelf: 'flex-end' }, chatAvatar: { width: 32, height: 32, backgroundColor: '#FFE1CF' }, botAvatar: { width: 32, height: 32, backgroundColor: '#7047EE' }, messageAuthor: { color: t.muted, fontSize: 8, marginBottom: 4 }, botAuthor: { color: '#7047EE', fontWeight: '800' }, messageAuthorMine: { textAlign: 'right' }, messageBubble: { backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, borderRadius: 5, borderTopRightRadius: 16, borderBottomLeftRadius: 16, borderBottomRightRadius: 16, padding: 12 }, botBubble: { borderColor: '#7047EE55', backgroundColor: t.dark ? '#251F46' : '#F5F0FF' }, messageBubbleMine: { backgroundColor: t.primary, borderColor: t.primary, borderTopLeftRadius: 16, borderTopRightRadius: 5 }, messageText: { color: t.text, fontSize: 12, lineHeight: 17 }, messageTextMine: { color: '#fff' }, cohMention: { color: '#FFD84D', fontWeight: '900', textShadowColor: '#FFD84D99', textShadowRadius: 8 }, composeRow: { minHeight: 61, paddingHorizontal: 12, paddingVertical: 8, gap: 8, flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.line, backgroundColor: t.surfaceStrong }, composeRowCoh: { borderTopColor: '#A777FF', backgroundColor: t.dark ? '#211A42' : '#F7F0FF', shadowColor: '#7047EE', shadowOpacity: .42, shadowRadius: 16, shadowOffset: { width: 0, height: -3 } }, composePlus: { width: 36, height: 36, borderRadius: 12, backgroundColor: `${t.primary}13`, alignItems: 'center', justifyContent: 'center' }, composeCohBadge: { backgroundColor: '#7047EE', shadowColor: '#A777FF', shadowOpacity: .9, shadowRadius: 10 }, composeInput: { flex: 1, minHeight: 40, maxHeight: 90, borderRadius: 13, borderWidth: 1, borderColor: t.line, backgroundColor: t.surface, color: t.text, paddingHorizontal: 12, fontSize: 12 }, composeInputCoh: { borderColor: '#A777FF', borderWidth: 2, color: t.dark ? '#E8DDFF' : '#4B168D', fontWeight: '800', shadowColor: '#7047EE', shadowOpacity: .5, shadowRadius: 9 }, sendButton: { width: 37, height: 37, borderRadius: 12, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center' }, sendButtonCoh: { backgroundColor: '#7047EE', shadowColor: '#A777FF', shadowOpacity: .9, shadowRadius: 10 },
    moreIntro: { color: t.muted, fontSize: 12, lineHeight: 18, marginBottom: 4 }, moreGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 11 }, moreCard: { width: '48.5%', minHeight: 180, borderRadius: 22, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, padding: 16 }, moreIcon: { width: 45, height: 45, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, moreTitle: { color: t.text, fontSize: 15, fontWeight: '800', marginTop: 17 }, moreDetail: { color: t.muted, fontSize: 9, lineHeight: 14, marginTop: 5, paddingRight: 10 }, moreChevron: { position: 'absolute', right: 14, bottom: 14 },
    familyHero: { minHeight: 116, borderRadius: 22, padding: 18, flexDirection: 'row', alignItems: 'center', backgroundColor: t.surface, borderWidth: 1, borderColor: t.line }, familyHeroTitle: { color: t.text, fontSize: 22, fontWeight: '900', marginTop: 5, marginBottom: 4 }, addProfileButton: { width: 46, height: 46, borderRadius: 15, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center', marginLeft: 'auto' }, profileRow: { minHeight: 88, borderRadius: 19, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line }, profileAvatar: { width: 42, height: 42, borderRadius: 15, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }, profileAvatarLarge: { width: 58, height: 58, borderRadius: 19 }, profileAvatarImage: { width: '100%', height: '100%' }, profileName: { color: t.text, fontSize: 14, fontWeight: '900' }, profileBio: { color: t.muted, fontSize: 9, lineHeight: 13, marginTop: 4 }, profileSheet: { maxHeight: '88%', backgroundColor: t.surfaceStrong, borderTopLeftRadius: 28, borderTopRightRadius: 28 }, profileSheetContent: { paddingHorizontal: 19, paddingTop: 9, paddingBottom: 34 }, photoEditor: { minHeight: 76, borderRadius: 18, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line }, profilePrivacy: { color: t.muted, fontSize: 9, lineHeight: 14, marginTop: 14 },
    searchInput: { height: 45, borderRadius: 15, borderWidth: 1, borderColor: t.line, backgroundColor: t.surface, color: t.text, paddingHorizontal: 14 }, notesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, noteCard: { width: '48.5%', minHeight: 140, borderRadius: 19, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, padding: 15 }, noteEmoji: { fontSize: 24 }, noteTitle: { color: t.text, fontSize: 12, fontWeight: '800', marginTop: 18, marginBottom: 4 }, noteChevron: { position: 'absolute', right: 12, bottom: 12 },
    recapHero: { minHeight: 260, borderRadius: 24, padding: 23, justifyContent: 'center' }, recapHeroLabel: { color: '#FFFFFFB5', fontSize: 8, fontWeight: '800', letterSpacing: 1, marginTop: 13 }, recapHeroTitle: { color: '#fff', fontSize: 28, lineHeight: 31, fontWeight: '800', letterSpacing: -1, marginTop: 8 }, recapHeroText: { color: '#FFFFFFC0', fontSize: 11, lineHeight: 16, marginTop: 8 }, recapActionRow: { flexDirection: 'row', gap: 8, marginTop: 18 }, recapHeroButton: { alignSelf: 'flex-start', minHeight: 38, borderRadius: 12, backgroundColor: '#fff', flexDirection: 'row', gap: 7, alignItems: 'center', paddingHorizontal: 13 }, highlightRow: { minHeight: 61, flexDirection: 'row', gap: 11, alignItems: 'center', borderRadius: 16, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, padding: 12 }, highlightTime: { color: t.primary, fontSize: 11, fontWeight: '800', width: 38 }, highlightText: { color: t.text, fontSize: 11, fontWeight: '700', flex: 1 },
    automationCard: { minHeight: 90, borderRadius: 20, padding: 16, flexDirection: 'row', gap: 12, alignItems: 'center' }, automationLabel: { color: '#FFFFFFA8', fontSize: 7, fontWeight: '800', letterSpacing: 1 }, automationTitle: { color: '#fff', fontSize: 12, fontWeight: '800', lineHeight: 17, marginTop: 3 }, integrationRow: { minHeight: 78, borderRadius: 18, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }, integrationIcon: { width: 43, height: 43, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, integrationTitle: { color: t.text, fontSize: 12, fontWeight: '800' }, connectButton: { minHeight: 31, borderRadius: 10, borderWidth: 1, borderColor: t.primary, paddingHorizontal: 9, alignItems: 'center', justifyContent: 'center' }, connectedButton: { borderColor: '#19A47B', backgroundColor: '#19A47B12' }, connectText: { color: t.primary, fontSize: 8, fontWeight: '800' }, connectedText: { color: '#19A47B' },
    chiefHero: { minHeight: 210, borderRadius: 24, padding: 22, justifyContent: 'center' }, chiefBadge: { width: 48, height: 48, borderRadius: 16, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }, chiefHeroTitle: { color: '#fff', fontSize: 28, lineHeight: 32, fontWeight: '800', letterSpacing: -1, marginTop: 5 }, chiefSettingCard: { borderRadius: 19, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, padding: 13, gap: 12 }, settingRowTop: { flexDirection: 'row', alignItems: 'center', gap: 10 }, chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, choiceChip: { minHeight: 34, borderRadius: 11, borderWidth: 1, borderColor: t.line, paddingHorizontal: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: t.surfaceStrong }, choiceChipActive: { backgroundColor: t.primary, borderColor: t.primary }, choiceChipText: { color: t.text, fontSize: 9, fontWeight: '800' }, choiceChipTextActive: { color: '#fff' }, preferenceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 }, preferenceTile: { width: '48.5%', minHeight: 58, borderRadius: 15, padding: 11, flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: t.surface, borderWidth: 1, borderColor: t.line }, preferenceTileActive: { borderColor: '#19A47B55', backgroundColor: '#19A47B0D' }, preferenceText: { color: t.text, fontSize: 10, fontWeight: '700', flex: 1 }, memberChip: { minHeight: 36, borderRadius: 18, borderWidth: 1, borderColor: t.line, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: t.surface }, memberChipActive: { backgroundColor: t.primary, borderColor: t.primary }, followUpCard: { minHeight: 72, borderRadius: 18, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line },
    personSetting: { minHeight: 65, borderRadius: 17, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 10 }, settingRow: { minHeight: 70, borderRadius: 17, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 11 }, settingTitle: { color: t.text, fontSize: 12, fontWeight: '800' },
    modalBackdrop: { flex: 1, backgroundColor: '#0C111D88', justifyContent: 'flex-end' }, modalDismiss: { flex: 1 }, modalSheet: { backgroundColor: t.surfaceStrong, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 19, paddingTop: 9, paddingBottom: Platform.OS === 'ios' ? 28 : 18 }, modalHandle: { width: 39, height: 4, borderRadius: 2, backgroundColor: t.line, alignSelf: 'center', marginBottom: 15 }, modalHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }, modalTitle: { color: t.text, fontSize: 23, fontWeight: '800', letterSpacing: -.7 }, typeTabs: { flexDirection: 'row', borderRadius: 14, padding: 4, backgroundColor: t.canvas, marginTop: 19 }, typeTab: { flex: 1, minHeight: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }, typeTabActive: { backgroundColor: t.surfaceStrong }, typeTabText: { color: t.muted, fontSize: 10, fontWeight: '700' }, typeTabTextActive: { color: t.primary }, fieldLabel: { color: t.muted, fontSize: 9, fontWeight: '800', marginTop: 15, marginBottom: 6 }, modalInput: { minHeight: 46, borderRadius: 13, borderWidth: 1, borderColor: t.line, backgroundColor: t.surface, color: t.text, paddingHorizontal: 12 }, modalTextArea: { minHeight: 83, paddingTop: 12, textAlignVertical: 'top' }, saveButton: { minHeight: 48, borderRadius: 15, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center', marginTop: 18 }, saveButtonText: { color: '#fff', fontSize: 12, fontWeight: '800' },
    privacyCard: { minHeight: 66, borderRadius: 16, padding: 12, marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#19A47B12', borderWidth: 1, borderColor: '#19A47B35' }, privacyText: { color: t.text, fontSize: 10, lineHeight: 15, flex: 1, fontWeight: '600' }, sharedAttachment: { minHeight: 62, borderRadius: 15, padding: 12, marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line }, sharePreviewInput: { minHeight: 110, paddingTop: 12, textAlignVertical: 'top' }, shareError: { color: '#D64545', fontSize: 10, marginTop: 8 }, shareActions: { flexDirection: 'row', gap: 10, marginTop: 16 }, cancelButton: { flex: 1, minHeight: 48, borderRadius: 15, borderWidth: 1, borderColor: t.line, alignItems: 'center', justifyContent: 'center' }, cancelButtonText: { color: t.text, fontSize: 12, fontWeight: '800' }, approveButton: { flex: 1.4, minHeight: 48, borderRadius: 15, backgroundColor: t.primary, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center' },
    cohThinking: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 40, minHeight: 38, paddingHorizontal: 13, borderRadius: 16, backgroundColor: '#7047EE14', borderWidth: 1, borderColor: '#7047EE35' },
  });
}


export default function App() {
  return <ShareIntentProvider><AuthGate><CohoApp /></AuthGate></ShareIntentProvider>;
}
