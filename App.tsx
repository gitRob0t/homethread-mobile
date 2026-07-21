import AuthGate from './src/components/AuthGate';
import FamilyHub from './src/components/FamilyHub';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import { ShareIntentProvider, useShareIntentContext } from 'expo-share-intent';
import { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
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
type BotEvent = { id: string; title: string; person: string; day: string; time: string; place?: string; reminder?: number; directions?: boolean };
type BotDraft = Omit<BotEvent, 'id'> & { step: 'place' | 'directions' | 'reminder' | 'confirm' };
type ChiefPrefs = { daily: boolean; dailyTime: string; weekAhead: boolean; weekAheadDay: string; weekAheadTime: string; followUp: boolean; followUpDay: string; followUpTime: string; push: boolean; email: boolean; quietHours: boolean; events: boolean; chores: boolean; messages: boolean; followUps: boolean; members: string[] };

const defaultChiefPrefs: ChiefPrefs = { daily: true, dailyTime: '7:00 AM', weekAhead: true, weekAheadDay: 'Sunday', weekAheadTime: '6:00 PM', followUp: true, followUpDay: 'Friday', followUpTime: '5:00 PM', push: true, email: false, quietHours: true, events: true, chores: true, messages: false, followUps: true, members: familyNames() };
function familyNames() { return ['Chad', 'Loren', 'Asher', 'Oliver']; }

const family = [
  { initials: 'CC', name: 'Chad', status: 'At work', color: '#DCE7FF', ink: '#2257F4' },
  { initials: 'LC', name: 'Loren', status: 'Working', color: '#FFE1CF', ink: '#D7550D' },
  { initials: 'AC', name: 'Asher', status: 'At school', color: '#D9F7ED', ink: '#168866' },
  { initials: 'OC', name: 'Oliver', status: 'At school', color: '#EADFFF', ink: '#6E3AE2' },
];

const initialChores = [
  { id: '1', title: 'Trash to curb', owner: 'Chad', due: 'Before 8 PM', done: false, color: '#2257F4' },
  { id: '2', title: 'Unload dishwasher', owner: 'Asher', due: 'After school', done: false, color: '#19A47B' },
  { id: '3', title: 'Feed the dog', owner: 'Oliver', due: '5:00 PM', done: true, color: '#7C4DFF' },
  { id: '4', title: 'Water front beds', owner: 'Loren', due: 'Thursday', done: false, color: '#FF7A2E' },
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

function HomeThreadApp() {
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
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: '1', mine: false, author: 'Loren', text: 'Can someone grab Oliver at 3:15? My last appointment may run over.' },
    { id: '2', mine: true, author: 'You', text: 'I’ve got it. I added the drive time to the calendar too.' },
  ]);
  const [messageDraft, setMessageDraft] = useState('');
  const [botDraft, setBotDraft] = useState<BotDraft | null>(null);
  const [botEvents, setBotEvents] = useState<BotEvent[]>([]);
  const [connected, setConnected] = useState<Record<string, boolean>>({ 'Apple Calendar': true, 'iOS Notifications': true });
  const [sharePreviewOpen, setSharePreviewOpen] = useState(false);
  const [sharedDraft, setSharedDraft] = useState('');
  const [chiefPrefs, setChiefPrefs] = useState<ChiefPrefs>(defaultChiefPrefs);

  useEffect(() => {
    AsyncStorage.getItem('homethread-theme').then((saved) => {
      if (saved) setDark(saved === 'dark');
    });
    AsyncStorage.getItem('kincue-chief-prefs').then((saved) => {
      if (saved) setChiefPrefs({ ...defaultChiefPrefs, ...JSON.parse(saved) });
    }).catch(() => undefined);
  }, []);

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
    setTimeout(() => setMessages((current) => [...current, { id: `bot-${Date.now()}`, mine: false, author: 'HomeBot', text, bot: true }]), 250);
  }

  function sendMessage() {
    const text = messageDraft.trim();
    if (!text) return;
    setMessages((current) => [...current, { id: String(Date.now()), mine: true, author: 'You', text }]);
    setMessageDraft('');
    handleBotMessage(text);
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
    const prompt = text.match(/^\s*(@bot|hey bot)/i) ? text : `@bot ${text}`;
    setMessages((current) => [...current, { id: `shared-${Date.now()}`, mine: true, author: 'You', text: prompt }]);
    setTimeout(() => handleBotMessage(prompt), 50);
    setSharedDraft('');
  }

  function handleBotMessage(text: string) {
    const normalized = text.trim().toLowerCase();
    if (!botDraft && !normalized.startsWith('@bot') && !normalized.startsWith('hey bot')) return;

    if (!botDraft) {
      const request = parseBotEvent(text);
      if (!request) {
        addBotMessage('I can add events, reminders, chores, and notes. Try “@bot haircut for Chad on Wednesday at 9:30 AM.”');
        return;
      }
      setBotDraft({ ...request, step: 'place' });
      addBotMessage(`I have “${request.title}” for ${request.person} on ${request.day} at ${request.time}. What’s the name of the place? You can also say “skip.”`);
      return;
    }

    if (botDraft.step === 'place') {
      const place = normalized === 'skip' || normalized === 'none' ? undefined : cleanAnswer(text);
      setBotDraft({ ...botDraft, place, step: place ? 'directions' : 'reminder' });
      addBotMessage(place ? `Got it — ${place}. Would you like me to add directions?` : 'Would you like a 15-minute reminder?');
      return;
    }

    if (botDraft.step === 'directions') {
      const directions = isYes(normalized);
      setBotDraft({ ...botDraft, directions, step: 'reminder' });
      addBotMessage('Would you like a 15-minute reminder?');
      return;
    }

    if (botDraft.step === 'reminder') {
      const reminder = isYes(normalized) ? 15 : parseReminder(normalized);
      const next = { ...botDraft, reminder, step: 'confirm' as const };
      setBotDraft(next);
      addBotMessage(`Ready to create “${next.title}” for ${next.person}, ${next.day} at ${next.time}${next.place ? ` at ${next.place}` : ''}${reminder ? ` with a ${reminder}-minute reminder` : ''}. Add it to the family calendar?`);
      return;
    }

    if (botDraft.step === 'confirm') {
      if (!isYes(normalized)) {
        addBotMessage('No problem — I didn’t create anything. Start over whenever you’re ready.');
        setBotDraft(null);
        return;
      }
      const event: BotEvent = { id: `event-${Date.now()}`, title: botDraft.title, person: botDraft.person, day: botDraft.day, time: botDraft.time, place: botDraft.place, reminder: botDraft.reminder, directions: botDraft.directions };
      setBotEvents((current) => [...current, event]);
      setBotDraft(null);
      addBotMessage(`Done — I created the event and added it to the family calendar.${event.directions && event.place ? ` Directions to ${event.place} are included.` : ''}`);
      showNotice('HomeBot added an event to the family calendar');
    }
  }

  async function enableNotifications() {
    const permission = await Notifications.requestPermissionsAsync();
    if (permission.granted) {
      await Notifications.scheduleNotificationAsync({
        content: { title: 'HomeThread is ready', body: 'Family reminders and daily recaps are now enabled.' },
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
      ids.push(await Notifications.scheduleNotificationAsync({ content: { title: 'Your full week ahead', body: 'Open KinCue for the family schedule, preparation list, and conflicts.' }, trigger: { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: weekdayNumber(chiefPrefs.weekAheadDay), hour, minute } }));
    }
    if (chiefPrefs.followUp && chiefPrefs.push) {
      const { hour, minute } = parseClock(chiefPrefs.followUpTime);
      ids.push(await Notifications.scheduleNotificationAsync({ content: { title: 'Weekly follow-up', body: 'A few appointments and conversations may still need action.' }, trigger: { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: weekdayNumber(chiefPrefs.followUpDay), hour, minute } }));
    }
    await AsyncStorage.setItem('kincue-chief-notification-ids', JSON.stringify(ids));
    showNotice('Chief of Home briefings are scheduled');
  }

  const title = tab === 'More' && moreView !== 'Menu' ? moreView : tab;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <View style={styles.app}>
        <Header
          title={title}
          theme={theme}
          styles={styles}
          dark={dark}
          onTheme={toggleTheme}
          onAdd={() => setQuickAddOpen(true)}
          onBack={tab === 'More' && moreView !== 'Menu' ? () => setMoreView('Menu') : undefined}
        />

        <View style={styles.screen}>
          {tab === 'Today' && <TodayScreen theme={theme} styles={styles} quickItems={notice ? [notice] : []} />}
          {tab === 'Calendar' && <CalendarScreen theme={theme} styles={styles} botEvents={botEvents} />}
          {tab === 'Chores' && <ChoresScreen styles={styles} chores={chores} onToggle={(id: string) => setChores((items) => items.map((item) => item.id === id ? { ...item, done: !item.done } : item))} />}
          {tab === 'Chat' && <ChatScreen styles={styles} messages={messages} draft={messageDraft} setDraft={setMessageDraft} onSend={sendMessage} />}
          {tab === 'More' && moreView === 'Menu' && <MoreMenu styles={styles} setView={setMoreView} />}
          {tab === 'More' && moreView === 'Chief of Home' && <ChiefOfHomeScreen styles={styles} prefs={chiefPrefs} setPrefs={saveChiefPreferences} onActivate={activateChiefOfHome} />}
          {tab === 'More' && moreView === 'Family' && <FamilyHub />}
          {tab === 'More' && moreView === 'Notes' && <NotesScreen styles={styles} />}
          {tab === 'More' && moreView === 'Recaps' && <RecapsScreen styles={styles} />}
          {tab === 'More' && moreView === 'Integrations' && <IntegrationsScreen styles={styles} connected={connected} onConnect={(name: string) => name === 'iOS Notifications' ? enableNotifications() : (setConnected((current) => ({ ...current, [name]: !current[name] })), showNotice(`${name} connection updated`))} />}
          {tab === 'More' && moreView === 'Settings' && <SettingsScreen styles={styles} dark={dark} onTheme={toggleTheme} onNotifications={enableNotifications} />}
        </View>

        <BottomTabs tab={tab} setTab={(next: Tab) => { setTab(next); if (next !== 'More') setMoreView('Menu'); }} theme={theme} styles={styles} />

        {notice && <View style={styles.toast}><Ionicons name="checkmark-circle" size={18} color="#19A47B" /><Text style={styles.toastText}>{notice}</Text></View>}
      </View>

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
    </SafeAreaView>
  );
}

function Header({ title, styles, dark, onTheme, onAdd, onBack }: any) {
  return <View style={styles.header}>
    <View style={styles.headerTitleWrap}>
      {onBack && <Pressable onPress={onBack} style={styles.backButton}><Ionicons name="chevron-back" size={22} color={styles.iconColor.color} /></Pressable>}
      <View><Text style={styles.eyebrow}>WEDNESDAY · JULY 15</Text><Text style={styles.headerTitle}>{title === 'Today' ? 'Good morning,' : title}</Text>{title === 'Today' && <Text style={styles.headerTitle}>Cragle family ☀️</Text>}</View>
    </View>
    <View style={styles.headerButtons}>
      <Pressable accessibilityLabel={dark ? 'Use light mode' : 'Use dark mode'} onPress={onTheme} style={styles.iconButton}><Ionicons name={dark ? 'sunny-outline' : 'moon-outline'} size={20} color={styles.iconColor.color} /></Pressable>
      <Pressable accessibilityLabel="Add to family" onPress={onAdd} style={styles.addButton}><Ionicons name="add" size={25} color="#fff" /></Pressable>
    </View>
  </View>;
}

function TodayScreen({ theme, styles }: any) {
  const cards = [
    { title: 'School pickup', value: '3:15 PM', detail: 'Oliver · Oakview Elementary', icon: 'school-outline', color: '#2257F4', tint: '#DCE7FF' },
    { title: 'Asher soccer', value: '6:00 PM', detail: 'Field 4 · Bring blue jersey', icon: 'football-outline', color: '#168866', tint: '#D9F7ED' },
    { title: 'Trash to curb', value: 'Before 8 PM', detail: 'Assigned to Chad', icon: 'checkmark-done-outline', color: '#E86117', tint: '#FFE1CF' },
    { title: 'Groceries', value: '8 items left', detail: 'Milk, berries, dog food +5', icon: 'cart-outline', color: '#6E3AE2', tint: '#EADFFF' },
  ];
  return <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
    <View style={styles.sectionHead}><View><Text style={styles.sectionTitle}>Today</Text><Text style={styles.muted}>4 things on the family radar</Text></View><Pressable><Text style={styles.link}>See full day ›</Text></Pressable></View>
    <View style={styles.bentoGrid}>{cards.map((card) => <Pressable key={card.title} style={styles.bentoCard}>
      <View style={[styles.cardIcon, { backgroundColor: card.tint }]}><Ionicons name={card.icon as any} size={24} color={card.color} /></View>
      <Text style={styles.cardTitle}>{card.title}</Text><Text style={styles.cardValue}>{card.value}</Text><Text style={styles.cardDetail}>{card.detail}</Text>
      <View style={[styles.cardPill, { backgroundColor: `${card.color}12` }]}><Ionicons name="time-outline" size={13} color={card.color} /><Text style={[styles.cardPillText, { color: card.color }]}>Tap for details</Text></View>
    </Pressable>)}</View>
    <LinearGradient colors={['#2257F4', '#7047EE']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.recapCard}>
      <View style={styles.recapIcon}><Ionicons name="sparkles" size={21} color="#fff" /></View><View style={styles.recapCopy}><Text style={styles.recapLabel}>HOMETHREAD DAILY</Text><Text style={styles.recapTitle}>Your morning recap is ready</Text><Text style={styles.recapText}>Three events, two open chores, and one new family note.</Text></View><Ionicons name="chevron-forward" size={20} color="#fff" />
    </LinearGradient>
    <Text style={styles.sectionTitle}>Family status</Text><View style={styles.familyRow}>{family.map((person) => <View key={person.name} style={styles.familyPerson}><View style={[styles.avatar, { backgroundColor: person.color }]}><Text style={[styles.avatarText, { color: person.ink }]}>{person.initials}</Text></View><Text style={styles.familyName}>{person.name}</Text><Text style={styles.familyStatus}>{person.status}</Text></View>)}</View>
    <Text style={styles.sectionTitle}>Coming up</Text>{upcoming.map((event) => <Pressable key={event.title} style={styles.upcomingRow}><View style={[styles.dateTile, { borderColor: event.color }]}><Text style={[styles.dateMonth, { color: event.color }]}>{event.month}</Text><Text style={[styles.dateNumber, { color: event.color }]}>{event.date}</Text></View><View style={styles.flex}><Text style={styles.upcomingTime}>{event.time}</Text><Text style={styles.upcomingTitle}>{event.title}</Text></View><Ionicons name="chevron-forward" size={18} color={theme.muted} /></Pressable>)}
  </ScrollView>;
}

function CalendarScreen({ styles, botEvents }: any) {
  const days = [{ d: 'MON', n: '13' }, { d: 'TUE', n: '14' }, { d: 'WED', n: '15' }, { d: 'THU', n: '16' }, { d: 'FRI', n: '17' }];
  return <ScrollView contentContainerStyle={styles.scrollContent}><View style={styles.calendarTop}><Pressable style={styles.smallButton}><Ionicons name="chevron-back" size={18} color={styles.iconColor.color} /></Pressable><Text style={styles.calendarPeriod}>July 13–19</Text><Pressable style={styles.smallButton}><Ionicons name="chevron-forward" size={18} color={styles.iconColor.color} /></Pressable></View><View style={styles.weekRow}>{days.map((day) => <Pressable key={day.d} style={[styles.dayBubble, day.n === '15' && styles.dayBubbleActive]}><Text style={[styles.dayLabel, day.n === '15' && styles.dayTextActive]}>{day.d}</Text><Text style={[styles.dayNumber, day.n === '15' && styles.dayTextActive]}>{day.n}</Text></Pressable>)}</View><Text style={styles.sectionTitle}>Wednesday’s schedule</Text>{[
    ['3:15 PM', 'School pickup', 'Oliver · Oakview Elementary', '#2257F4'], ['6:00 PM', 'Asher soccer', 'Field 4 · Bring blue jersey', '#19A47B'], ['8:00 PM', 'Trash to curb', 'Assigned to Chad', '#FF7A2E']
  ].map(([time, title, detail, color]) => <Pressable key={title} style={styles.timelineRow}><View style={[styles.timelineLine, { backgroundColor: color }]} /><Text style={styles.timelineTime}>{time}</Text><View style={styles.flex}><Text style={styles.timelineTitle}>{title}</Text><Text style={styles.muted}>{detail}</Text></View><Ionicons name="chevron-forward" size={18} color={styles.iconColor.color} /></Pressable>)}{botEvents.map((event: BotEvent) => <Pressable key={event.id} style={styles.timelineRow}><View style={[styles.timelineLine, { backgroundColor: '#7047EE' }]} /><Text style={styles.timelineTime}>{event.time}</Text><View style={styles.flex}><Text style={styles.timelineTitle}>{event.title}</Text><Text style={styles.muted}>{event.person} · {event.place ?? event.day}{event.reminder ? ` · ${event.reminder} min reminder` : ''}</Text></View><Ionicons name="sparkles" size={18} color="#7047EE" /></Pressable>)}<View style={styles.syncCard}><Ionicons name="sync" size={18} color="#2257F4" /><View style={styles.flex}><Text style={styles.syncTitle}>Calendars synced</Text><Text style={styles.muted}>Apple Calendar · Google · Skylight</Text></View><Text style={styles.link}>Manage</Text></View></ScrollView>;
}

function ChoresScreen({ styles, chores, onToggle }: any) {
  const completed = chores.filter((item: any) => item.done).length;
  return <ScrollView contentContainerStyle={styles.scrollContent}><View style={styles.progressCard}><View><Text style={styles.progressLabel}>FAMILY PROGRESS</Text><Text style={styles.progressValue}>{completed} of {chores.length}</Text><Text style={styles.muted}>chores complete today</Text></View><View style={styles.progressRing}><Text style={styles.progressPercent}>{Math.round(completed / chores.length * 100)}%</Text></View></View><Text style={styles.sectionTitle}>This week</Text>{chores.map((chore: any) => <Pressable key={chore.id} onPress={() => onToggle(chore.id)} style={styles.choreRow}><View style={[styles.checkCircle, chore.done && { backgroundColor: '#19A47B', borderColor: '#19A47B' }]}>{chore.done && <Ionicons name="checkmark" size={17} color="#fff" />}</View><View style={styles.flex}><Text style={[styles.choreTitle, chore.done && styles.struck]}>{chore.title}</Text><Text style={styles.muted}>{chore.owner} · {chore.due}</Text></View><View style={[styles.ownerDot, { backgroundColor: chore.color }]} /><Ionicons name="chevron-forward" size={17} color={styles.iconColor.color} /></Pressable>)}<Pressable style={styles.outlineAction}><Ionicons name="add" size={19} color="#2257F4" /><Text style={styles.outlineActionText}>Add a recurring chore</Text></Pressable></ScrollView>;
}

function ChatScreen({ styles, messages, draft, setDraft, onSend }: any) {
  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'height' : undefined} keyboardVerticalOffset={0} style={styles.flex}><FlatList data={messages} keyExtractor={(item) => item.id} contentContainerStyle={styles.messageList} keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled" renderItem={({ item }) => <View style={[styles.messageWrap, item.mine && styles.messageMine]}>{!item.mine && <View style={[styles.avatar, item.bot ? styles.botAvatar : styles.chatAvatar]}>{item.bot ? <Ionicons name="sparkles" size={17} color="#fff" /> : <Text style={styles.avatarText}>LC</Text>}</View>}<View style={styles.messageBody}><Text style={[styles.messageAuthor, item.mine && styles.messageAuthorMine, item.bot && styles.botAuthor]}>{item.author}</Text><View style={[styles.messageBubble, item.mine && styles.messageBubbleMine, item.bot && styles.botBubble]}><Text style={[styles.messageText, item.mine && styles.messageTextMine]}>{item.text}</Text></View></View></View>} ListHeaderComponent={<View><View style={styles.chatHeader}><View style={styles.homeThreadIcon}><Text>🏠</Text></View><View><Text style={styles.chatTitle}>Everyone</Text><Text style={styles.muted}>4 family members + HomeBot</Text></View></View><View style={styles.botHint}><Ionicons name="sparkles" size={15} color="#7047EE" /><Text style={styles.botHintText}>Try “@bot haircut for Chad on Wednesday at 9:30 AM”</Text></View></View>} /><View style={styles.composeRow}><Pressable style={styles.composePlus}><Ionicons name="add" size={22} color="#2257F4" /></Pressable><TextInput value={draft} onChangeText={setDraft} placeholder="Message everyone or @bot…" placeholderTextColor="#8B93A5" style={styles.composeInput} returnKeyType="send" onSubmitEditing={onSend} /><Pressable onPress={onSend} style={styles.sendButton}><Ionicons name="send" size={17} color="#fff" /></Pressable></View></KeyboardAvoidingView>;
}

function parseBotEvent(text: string): Omit<BotEvent, 'id'> | null {
  const cleaned = text.replace(/^\s*(@bot|hey bot)[,:]?\s*/i, '').trim();
  const timeMatch = cleaned.match(/\b(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i);
  const dayMatch = cleaned.match(/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
  const personMatch = cleaned.match(/\bfor\s+([a-z][a-z'-]*)\b/i);
  if (!timeMatch || !dayMatch) return null;
  const titleEnd = personMatch?.index ?? dayMatch.index ?? cleaned.length;
  const title = cleaned.slice(0, titleEnd).replace(/\bon\s*$/i, '').trim();
  return { title: title || 'Family event', person: titleCase(personMatch?.[1] ?? 'Family'), day: titleCase(dayMatch[1]), time: timeMatch[1].replace(/\s+/g, ' ').toUpperCase() };
}

function titleCase(value: string) { return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase(); }
function isYes(value: string) { return /^(yes|y|yeah|yep|sure|please|ok|okay)\b/.test(value); }
function parseReminder(value: string) { const match = value.match(/(\d+)\s*(?:minute|min)/); return match ? Number(match[1]) : undefined; }
function cleanAnswer(value: string) { return value.replace(/^(it is|it's|the place is|at)\s+/i, '').trim(); }
function parseClock(value: string) { const match = value.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i); let hour = Number(match?.[1] ?? 7); const minute = Number(match?.[2] ?? 0); const pm = match?.[3]?.toUpperCase() === 'PM'; if (pm && hour < 12) hour += 12; if (!pm && hour === 12) hour = 0; return { hour, minute }; }
function weekdayNumber(day: string) { return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].indexOf(day) + 1; }

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

function NotesScreen({ styles }: any) {
  const notes = [['🛒', 'Weekly groceries', '8 items · Updated 12 min ago'], ['🏡', 'Lake house details', 'Shared with everyone'], ['🍝', 'Dinner ideas', '12 recipes'], ['☎️', 'Emergency contacts', 'Pinned · Family admins'], ['🎁', 'Gift ideas', 'Private to adults'], ['🧳', 'PA packing list', '23 of 31 packed']];
  return <ScrollView contentContainerStyle={styles.scrollContent}><TextInput placeholder="Search family notes" placeholderTextColor="#8B93A5" style={styles.searchInput} /><View style={styles.notesGrid}>{notes.map(([icon, title, meta]) => <Pressable key={title} style={styles.noteCard}><Text style={styles.noteEmoji}>{icon}</Text><Text style={styles.noteTitle}>{title}</Text><Text style={styles.muted}>{meta}</Text></Pressable>)}</View></ScrollView>;
}

function RecapsScreen({ styles }: any) {
  const week = [['MON', 'Dentist follow-up · Chad', '9:30 AM'], ['TUE', 'Asher soccer practice', '6:00 PM'], ['WED', 'School pickup · Oliver', '3:15 PM'], ['THU', 'Lake trip packing deadline', '7:00 PM'], ['FRI', 'Family dinner reservation', '6:30 PM'], ['SAT', 'Knoebels family day', '10:00 AM'], ['SUN', 'Plan the coming week', '6:00 PM']];
  return <ScrollView contentContainerStyle={styles.scrollContent}><LinearGradient colors={['#2257F4', '#7047EE']} style={styles.recapHero}><Ionicons name="sparkles" size={24} color="#fff" /><Text style={styles.recapHeroLabel}>CHIEF OF HOME</Text><Text style={styles.recapHeroTitle}>The full week ahead.</Text><Text style={styles.recapHeroText}>Appointments, chores, preparation, and family commitments in one private briefing.</Text><Pressable style={styles.recapHeroButton}><Ionicons name="play" size={15} color="#2257F4" /><Text>Listen to briefing</Text></Pressable></LinearGradient><Text style={styles.sectionTitle}>Week ahead</Text>{week.map(([day, text, time]) => <View key={day} style={styles.highlightRow}><Text style={styles.highlightTime}>{day}</Text><View style={styles.flex}><Text style={styles.highlightText}>{text}</Text><Text style={styles.muted}>{time}</Text></View><Ionicons name="chevron-forward" size={17} color={styles.iconColor.color} /></View>)}<Text style={styles.sectionTitle}>Needs follow-up</Text>{[['Dentist visit', 'Schedule the six-month follow-up'], ['School meeting', 'Return the signed permission form']].map(([title, detail]) => <View key={title} style={styles.followUpCard}><Ionicons name="refresh-circle" size={23} color="#19A47B" /><View style={styles.flex}><Text style={styles.settingTitle}>{title}</Text><Text style={styles.muted}>{detail}</Text></View><Pressable style={styles.connectButton}><Text style={styles.connectText}>Resolve</Text></Pressable></View>)}</ScrollView>;
}

function IntegrationsScreen({ styles, connected, onConnect }: any) {
  const items = [['Apple Calendar', 'calendar-outline', '#2257F4'], ['Skylight', 'cloud-outline', '#FF7A2E'], ['Google Calendar', 'logo-google', '#19A47B'], ['Outlook', 'mail-outline', '#2257F4'], ['iOS Notifications', 'phone-portrait-outline', '#7C4DFF'], ['Email Inbox', 'mail-unread-outline', '#FF7A2E'], ['Automations', 'flash-outline', '#7C4DFF']];
  return <ScrollView contentContainerStyle={styles.scrollContent}><LinearGradient colors={['#24116D', '#6648EF']} style={styles.automationCard}><Ionicons name="flash" size={23} color="#fff" /><View style={styles.flex}><Text style={styles.automationLabel}>AUTOMATION IDEA</Text><Text style={styles.automationTitle}>Turn school emails into suggested family events.</Text></View></LinearGradient>{items.map(([name, icon, color]) => <View key={name} style={styles.integrationRow}><View style={[styles.integrationIcon, { backgroundColor: `${color}18` }]}><Ionicons name={icon as any} size={23} color={color} /></View><View style={styles.flex}><Text style={styles.integrationTitle}>{name}</Text><Text style={styles.muted}>{name === 'Skylight' ? 'Calendar and chore synchronization' : 'Keep family information flowing automatically'}</Text></View><Pressable onPress={() => onConnect(name)} style={[styles.connectButton, connected[name] && styles.connectedButton]}><Text style={[styles.connectText, connected[name] && styles.connectedText]}>{connected[name] ? 'Connected' : 'Connect'}</Text></Pressable></View>)}</ScrollView>;
}

function SettingsScreen({ styles, dark, onTheme, onNotifications }: any) {
  return <ScrollView contentContainerStyle={styles.scrollContent}><Text style={styles.sectionTitle}>Household</Text>{family.map((person, index) => <View key={person.name} style={styles.personSetting}><View style={[styles.avatar, { backgroundColor: person.color }]}><Text style={[styles.avatarText, { color: person.ink }]}>{person.initials}</Text></View><View style={styles.flex}><Text style={styles.settingTitle}>{person.name}</Text><Text style={styles.muted}>{index < 2 ? 'Family admin' : 'Family member'}</Text></View><Ionicons name="ellipsis-horizontal" size={19} color={styles.iconColor.color} /></View>)}<Text style={styles.sectionTitle}>Preferences</Text><View style={styles.settingRow}><Ionicons name="moon-outline" size={21} color="#7C4DFF" /><View style={styles.flex}><Text style={styles.settingTitle}>Dark mode</Text><Text style={styles.muted}>Use the darker HomeThread theme</Text></View><Switch value={dark} onValueChange={onTheme} trackColor={{ true: '#6687FF' }} /></View><Pressable onPress={onNotifications} style={styles.settingRow}><Ionicons name="notifications-outline" size={21} color="#FF7A2E" /><View style={styles.flex}><Text style={styles.settingTitle}>Smart notifications</Text><Text style={styles.muted}>Enable reminders and daily recaps</Text></View><Ionicons name="chevron-forward" size={18} color={styles.iconColor.color} /></Pressable><View style={styles.settingRow}><Ionicons name="shield-checkmark-outline" size={21} color="#19A47B" /><View style={styles.flex}><Text style={styles.settingTitle}>Privacy and family data</Text><Text style={styles.muted}>Permissions, exports, and deletion</Text></View><Ionicons name="chevron-forward" size={18} color={styles.iconColor.color} /></View></ScrollView>;
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
          <View style={styles.flex}><Text style={styles.eyebrow}>ONLY THIS ITEM</Text><Text style={styles.modalTitle}>Share to Cue</Text></View>
          <Pressable accessibilityLabel="Cancel sharing" onPress={onCancel} style={styles.iconButton}><Ionicons name="close" size={21} color={styles.iconColor.color} /></Pressable>
        </View>
        <View style={styles.privacyCard}><Ionicons name="shield-checkmark" size={20} color="#19A47B" /><Text style={styles.privacyText}>KinCue receives only what you selected—not the conversation. The shared content is discarded if you cancel.</Text></View>
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
    iconButton: { width: 42, height: 42, borderRadius: 14, borderWidth: 1, borderColor: t.line, backgroundColor: t.surface, alignItems: 'center', justifyContent: 'center' }, addButton: { width: 43, height: 43, borderRadius: 15, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center', shadowColor: t.primary, shadowOpacity: .26, shadowRadius: 10, shadowOffset: { width: 0, height: 6 } },
    scrollContent: { padding: 18, paddingBottom: 32, gap: 12 }, sectionHead: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 4 }, sectionTitle: { color: t.text, fontSize: 20, fontWeight: '800', letterSpacing: -.5, marginTop: 10 }, muted: { color: t.muted, fontSize: 11, lineHeight: 15 }, link: { color: t.primary, fontSize: 11, fontWeight: '700' },
    bentoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, bentoCard: { width: '48.5%', minHeight: 190, borderRadius: 22, padding: 15, backgroundColor: t.surfaceStrong, borderWidth: 1, borderColor: t.line, shadowColor: '#392B14', shadowOpacity: t.dark ? .24 : .07, shadowRadius: 12, shadowOffset: { width: 0, height: 7 } },
    cardIcon: { width: 43, height: 43, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 14 }, cardTitle: { color: t.text, fontSize: 14, fontWeight: '800' }, cardValue: { color: t.text, fontSize: 21, fontWeight: '800', letterSpacing: -.7, marginTop: 3 }, cardDetail: { color: t.muted, fontSize: 9, marginTop: 4, minHeight: 26 }, cardPill: { alignSelf: 'flex-start', flexDirection: 'row', gap: 4, alignItems: 'center', borderRadius: 99, paddingHorizontal: 8, paddingVertical: 6, marginTop: 'auto' }, cardPillText: { fontSize: 8, fontWeight: '700' },
    recapCard: { minHeight: 88, borderRadius: 21, padding: 15, flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 2 }, recapIcon: { width: 43, height: 43, borderRadius: 14, backgroundColor: '#FFFFFF24', alignItems: 'center', justifyContent: 'center' }, recapCopy: { flex: 1 }, recapLabel: { color: '#FFFFFFB5', fontSize: 7, fontWeight: '800', letterSpacing: 1 }, recapTitle: { color: '#fff', fontSize: 13, fontWeight: '800', marginTop: 2 }, recapText: { color: '#FFFFFFB8', fontSize: 9, lineHeight: 13, marginTop: 2 },
    familyRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, borderRadius: 20, padding: 13 }, familyPerson: { width: '24%', alignItems: 'center' }, avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' }, avatarText: { color: '#2257F4', fontSize: 11, fontWeight: '800' }, familyName: { color: t.text, fontSize: 10, fontWeight: '700', marginTop: 6 }, familyStatus: { color: t.muted, fontSize: 8, marginTop: 2 },
    upcomingRow: { minHeight: 63, borderRadius: 17, borderWidth: 1, borderColor: t.line, backgroundColor: t.surface, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 11 }, dateTile: { width: 43, height: 44, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center' }, dateMonth: { fontSize: 7, fontWeight: '800' }, dateNumber: { fontSize: 18, fontWeight: '800', lineHeight: 19 }, upcomingTime: { color: t.muted, fontSize: 8, fontWeight: '700' }, upcomingTitle: { color: t.text, fontSize: 11, fontWeight: '700', marginTop: 3 },
    tabBar: { minHeight: 68, paddingTop: 7, paddingBottom: Platform.OS === 'ios' ? 5 : 8, paddingHorizontal: 7, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.line, backgroundColor: t.surfaceStrong, flexDirection: 'row', justifyContent: 'space-around' }, tabItem: { flex: 1, alignItems: 'center', gap: 3 }, tabIconWrap: { width: 38, height: 32, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, tabIconActive: { backgroundColor: t.primary }, tabLabel: { color: t.muted, fontSize: 8, fontWeight: '700' }, tabLabelActive: { color: t.primary },
    toast: { position: 'absolute', left: 18, right: 18, bottom: 78, minHeight: 50, borderRadius: 16, paddingHorizontal: 14, backgroundColor: t.surfaceStrong, borderWidth: 1, borderColor: t.line, flexDirection: 'row', alignItems: 'center', gap: 8, shadowColor: '#000', shadowOpacity: .16, shadowRadius: 16, shadowOffset: { width: 0, height: 7 } }, toastText: { color: t.text, fontSize: 11, fontWeight: '700', flex: 1 },
    calendarTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14 }, smallButton: { width: 38, height: 38, borderRadius: 12, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, alignItems: 'center', justifyContent: 'center' }, calendarPeriod: { color: t.text, fontWeight: '800', fontSize: 15 }, weekRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: t.surface, borderRadius: 18, borderWidth: 1, borderColor: t.line, padding: 8 }, dayBubble: { width: 52, height: 63, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, dayBubbleActive: { backgroundColor: t.primary }, dayLabel: { color: t.muted, fontSize: 8, fontWeight: '800' }, dayNumber: { color: t.text, fontSize: 19, fontWeight: '800', marginTop: 3 }, dayTextActive: { color: '#fff' }, timelineRow: { minHeight: 76, borderRadius: 18, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10 }, timelineLine: { width: 4, height: 42, borderRadius: 3 }, timelineTime: { color: t.muted, fontSize: 10, width: 50, fontWeight: '700' }, timelineTitle: { color: t.text, fontSize: 13, fontWeight: '800' }, syncCard: { minHeight: 67, borderRadius: 18, padding: 13, flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: `${t.primary}0C`, borderWidth: 1, borderColor: `${t.primary}24` }, syncTitle: { color: t.text, fontSize: 11, fontWeight: '800' },
    progressCard: { minHeight: 130, borderRadius: 23, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, padding: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, progressLabel: { color: t.primary, fontSize: 8, fontWeight: '800', letterSpacing: 1 }, progressValue: { color: t.text, fontSize: 28, fontWeight: '800', letterSpacing: -1, marginTop: 5 }, progressRing: { width: 74, height: 74, borderRadius: 37, borderWidth: 8, borderColor: '#19A47B', alignItems: 'center', justifyContent: 'center' }, progressPercent: { color: t.text, fontSize: 16, fontWeight: '800' }, choreRow: { minHeight: 70, borderRadius: 17, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }, checkCircle: { width: 27, height: 27, borderRadius: 14, borderWidth: 2, borderColor: t.line, alignItems: 'center', justifyContent: 'center' }, choreTitle: { color: t.text, fontSize: 13, fontWeight: '800' }, struck: { textDecorationLine: 'line-through', color: t.muted }, ownerDot: { width: 9, height: 9, borderRadius: 5 }, outlineAction: { minHeight: 48, borderRadius: 15, borderWidth: 1, borderStyle: 'dashed', borderColor: t.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }, outlineActionText: { color: t.primary, fontSize: 11, fontWeight: '800' },
    messageList: { padding: 18, paddingBottom: 24, gap: 16 }, chatHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line }, homeThreadIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: `${t.primary}14`, alignItems: 'center', justifyContent: 'center' }, chatTitle: { color: t.text, fontSize: 14, fontWeight: '800' }, botHint: { minHeight: 48, borderRadius: 15, paddingHorizontal: 12, marginBottom: 5, flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: '#7047EE12', borderWidth: 1, borderColor: '#7047EE30' }, botHintText: { color: t.text, fontSize: 10, lineHeight: 14, flex: 1, fontWeight: '700' }, messageWrap: { maxWidth: '88%', flexDirection: 'row', gap: 8, alignSelf: 'flex-start' }, messageBody: { flexShrink: 1 }, messageMine: { alignSelf: 'flex-end' }, chatAvatar: { width: 32, height: 32, backgroundColor: '#FFE1CF' }, botAvatar: { width: 32, height: 32, backgroundColor: '#7047EE' }, messageAuthor: { color: t.muted, fontSize: 8, marginBottom: 4 }, botAuthor: { color: '#7047EE', fontWeight: '800' }, messageAuthorMine: { textAlign: 'right' }, messageBubble: { backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, borderRadius: 5, borderTopRightRadius: 16, borderBottomLeftRadius: 16, borderBottomRightRadius: 16, padding: 12 }, botBubble: { borderColor: '#7047EE55', backgroundColor: t.dark ? '#251F46' : '#F5F0FF' }, messageBubbleMine: { backgroundColor: t.primary, borderColor: t.primary, borderTopLeftRadius: 16, borderTopRightRadius: 5 }, messageText: { color: t.text, fontSize: 12, lineHeight: 17 }, messageTextMine: { color: '#fff' }, composeRow: { minHeight: 61, paddingHorizontal: 12, paddingVertical: 8, gap: 8, flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.line, backgroundColor: t.surfaceStrong }, composePlus: { width: 36, height: 36, borderRadius: 12, backgroundColor: `${t.primary}13`, alignItems: 'center', justifyContent: 'center' }, composeInput: { flex: 1, minHeight: 40, maxHeight: 90, borderRadius: 13, borderWidth: 1, borderColor: t.line, backgroundColor: t.surface, color: t.text, paddingHorizontal: 12, fontSize: 12 }, sendButton: { width: 37, height: 37, borderRadius: 12, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center' },
    moreIntro: { color: t.muted, fontSize: 12, lineHeight: 18, marginBottom: 4 }, moreGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 11 }, moreCard: { width: '48.5%', minHeight: 180, borderRadius: 22, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, padding: 16 }, moreIcon: { width: 45, height: 45, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, moreTitle: { color: t.text, fontSize: 15, fontWeight: '800', marginTop: 17 }, moreDetail: { color: t.muted, fontSize: 9, lineHeight: 14, marginTop: 5, paddingRight: 10 }, moreChevron: { position: 'absolute', right: 14, bottom: 14 },
    searchInput: { height: 45, borderRadius: 15, borderWidth: 1, borderColor: t.line, backgroundColor: t.surface, color: t.text, paddingHorizontal: 14 }, notesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, noteCard: { width: '48.5%', minHeight: 140, borderRadius: 19, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, padding: 15 }, noteEmoji: { fontSize: 24 }, noteTitle: { color: t.text, fontSize: 12, fontWeight: '800', marginTop: 18, marginBottom: 4 },
    recapHero: { minHeight: 260, borderRadius: 24, padding: 23, justifyContent: 'center' }, recapHeroLabel: { color: '#FFFFFFB5', fontSize: 8, fontWeight: '800', letterSpacing: 1, marginTop: 13 }, recapHeroTitle: { color: '#fff', fontSize: 28, lineHeight: 31, fontWeight: '800', letterSpacing: -1, marginTop: 8 }, recapHeroText: { color: '#FFFFFFC0', fontSize: 11, lineHeight: 16, marginTop: 8 }, recapHeroButton: { alignSelf: 'flex-start', minHeight: 38, borderRadius: 12, backgroundColor: '#fff', flexDirection: 'row', gap: 7, alignItems: 'center', paddingHorizontal: 13, marginTop: 18 }, highlightRow: { minHeight: 61, flexDirection: 'row', gap: 11, alignItems: 'center', borderRadius: 16, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, padding: 12 }, highlightTime: { color: t.primary, fontSize: 11, fontWeight: '800', width: 38 }, highlightText: { color: t.text, fontSize: 11, fontWeight: '700', flex: 1 },
    automationCard: { minHeight: 90, borderRadius: 20, padding: 16, flexDirection: 'row', gap: 12, alignItems: 'center' }, automationLabel: { color: '#FFFFFFA8', fontSize: 7, fontWeight: '800', letterSpacing: 1 }, automationTitle: { color: '#fff', fontSize: 12, fontWeight: '800', lineHeight: 17, marginTop: 3 }, integrationRow: { minHeight: 78, borderRadius: 18, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }, integrationIcon: { width: 43, height: 43, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, integrationTitle: { color: t.text, fontSize: 12, fontWeight: '800' }, connectButton: { minHeight: 31, borderRadius: 10, borderWidth: 1, borderColor: t.primary, paddingHorizontal: 9, alignItems: 'center', justifyContent: 'center' }, connectedButton: { borderColor: '#19A47B', backgroundColor: '#19A47B12' }, connectText: { color: t.primary, fontSize: 8, fontWeight: '800' }, connectedText: { color: '#19A47B' },
    chiefHero: { minHeight: 210, borderRadius: 24, padding: 22, justifyContent: 'center' }, chiefBadge: { width: 48, height: 48, borderRadius: 16, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }, chiefHeroTitle: { color: '#fff', fontSize: 28, lineHeight: 32, fontWeight: '800', letterSpacing: -1, marginTop: 5 }, chiefSettingCard: { borderRadius: 19, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, padding: 13, gap: 12 }, settingRowTop: { flexDirection: 'row', alignItems: 'center', gap: 10 }, chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, choiceChip: { minHeight: 34, borderRadius: 11, borderWidth: 1, borderColor: t.line, paddingHorizontal: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: t.surfaceStrong }, choiceChipActive: { backgroundColor: t.primary, borderColor: t.primary }, choiceChipText: { color: t.text, fontSize: 9, fontWeight: '800' }, choiceChipTextActive: { color: '#fff' }, preferenceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 }, preferenceTile: { width: '48.5%', minHeight: 58, borderRadius: 15, padding: 11, flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: t.surface, borderWidth: 1, borderColor: t.line }, preferenceTileActive: { borderColor: '#19A47B55', backgroundColor: '#19A47B0D' }, preferenceText: { color: t.text, fontSize: 10, fontWeight: '700', flex: 1 }, memberChip: { minHeight: 36, borderRadius: 18, borderWidth: 1, borderColor: t.line, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: t.surface }, memberChipActive: { backgroundColor: t.primary, borderColor: t.primary }, followUpCard: { minHeight: 72, borderRadius: 18, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line },
    personSetting: { minHeight: 65, borderRadius: 17, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 10 }, settingRow: { minHeight: 70, borderRadius: 17, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 11 }, settingTitle: { color: t.text, fontSize: 12, fontWeight: '800' },
    modalBackdrop: { flex: 1, backgroundColor: '#0C111D88', justifyContent: 'flex-end' }, modalDismiss: { flex: 1 }, modalSheet: { backgroundColor: t.surfaceStrong, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 19, paddingTop: 9, paddingBottom: Platform.OS === 'ios' ? 28 : 18 }, modalHandle: { width: 39, height: 4, borderRadius: 2, backgroundColor: t.line, alignSelf: 'center', marginBottom: 15 }, modalHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }, modalTitle: { color: t.text, fontSize: 23, fontWeight: '800', letterSpacing: -.7 }, typeTabs: { flexDirection: 'row', borderRadius: 14, padding: 4, backgroundColor: t.canvas, marginTop: 19 }, typeTab: { flex: 1, minHeight: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }, typeTabActive: { backgroundColor: t.surfaceStrong }, typeTabText: { color: t.muted, fontSize: 10, fontWeight: '700' }, typeTabTextActive: { color: t.primary }, fieldLabel: { color: t.muted, fontSize: 9, fontWeight: '800', marginTop: 15, marginBottom: 6 }, modalInput: { minHeight: 46, borderRadius: 13, borderWidth: 1, borderColor: t.line, backgroundColor: t.surface, color: t.text, paddingHorizontal: 12 }, modalTextArea: { minHeight: 83, paddingTop: 12, textAlignVertical: 'top' }, saveButton: { minHeight: 48, borderRadius: 15, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center', marginTop: 18 }, saveButtonText: { color: '#fff', fontSize: 12, fontWeight: '800' },
    privacyCard: { minHeight: 66, borderRadius: 16, padding: 12, marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#19A47B12', borderWidth: 1, borderColor: '#19A47B35' }, privacyText: { color: t.text, fontSize: 10, lineHeight: 15, flex: 1, fontWeight: '600' }, sharedAttachment: { minHeight: 62, borderRadius: 15, padding: 12, marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line }, sharePreviewInput: { minHeight: 110, paddingTop: 12, textAlignVertical: 'top' }, shareError: { color: '#D64545', fontSize: 10, marginTop: 8 }, shareActions: { flexDirection: 'row', gap: 10, marginTop: 16 }, cancelButton: { flex: 1, minHeight: 48, borderRadius: 15, borderWidth: 1, borderColor: t.line, alignItems: 'center', justifyContent: 'center' }, cancelButtonText: { color: t.text, fontSize: 12, fontWeight: '800' }, approveButton: { flex: 1.4, minHeight: 48, borderRadius: 15, backgroundColor: t.primary, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center' },
  });
}


export default function App() {
  return <ShareIntentProvider><AuthGate><HomeThreadApp /></AuthGate></ShareIntentProvider>;
}
