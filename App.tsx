import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
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
type MoreView = 'Menu' | 'Notes' | 'Recaps' | 'Integrations' | 'Settings';

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

export default function App() {
  const systemScheme = useColorScheme();
  const [dark, setDark] = useState(systemScheme === 'dark');
  const [tab, setTab] = useState<Tab>('Today');
  const [moreView, setMoreView] = useState<MoreView>('Menu');
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddType, setQuickAddType] = useState('Event');
  const [quickAddTitle, setQuickAddTitle] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [chores, setChores] = useState(initialChores);
  const [messages, setMessages] = useState([
    { id: '1', mine: false, author: 'Loren', text: 'Can someone grab Oliver at 3:15? My last appointment may run over.' },
    { id: '2', mine: true, author: 'You', text: 'I’ve got it. I added the drive time to the calendar too.' },
  ]);
  const [messageDraft, setMessageDraft] = useState('');
  const [connected, setConnected] = useState<Record<string, boolean>>({ 'Apple Calendar': true, 'iOS Notifications': true });

  useEffect(() => {
    AsyncStorage.getItem('homethread-theme').then((saved) => {
      if (saved) setDark(saved === 'dark');
    });
  }, []);

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

  function sendMessage() {
    if (!messageDraft.trim()) return;
    setMessages((current) => [...current, { id: String(Date.now()), mine: true, author: 'You', text: messageDraft.trim() }]);
    setMessageDraft('');
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
          {tab === 'Calendar' && <CalendarScreen theme={theme} styles={styles} />}
          {tab === 'Chores' && <ChoresScreen styles={styles} chores={chores} onToggle={(id: string) => setChores((items) => items.map((item) => item.id === id ? { ...item, done: !item.done } : item))} />}
          {tab === 'Chat' && <ChatScreen styles={styles} messages={messages} draft={messageDraft} setDraft={setMessageDraft} onSend={sendMessage} />}
          {tab === 'More' && moreView === 'Menu' && <MoreMenu styles={styles} setView={setMoreView} />}
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

function CalendarScreen({ styles }: any) {
  const days = [{ d: 'MON', n: '13' }, { d: 'TUE', n: '14' }, { d: 'WED', n: '15' }, { d: 'THU', n: '16' }, { d: 'FRI', n: '17' }];
  return <ScrollView contentContainerStyle={styles.scrollContent}><View style={styles.calendarTop}><Pressable style={styles.smallButton}><Ionicons name="chevron-back" size={18} color={styles.iconColor.color} /></Pressable><Text style={styles.calendarPeriod}>July 13–19</Text><Pressable style={styles.smallButton}><Ionicons name="chevron-forward" size={18} color={styles.iconColor.color} /></Pressable></View><View style={styles.weekRow}>{days.map((day) => <Pressable key={day.d} style={[styles.dayBubble, day.n === '15' && styles.dayBubbleActive]}><Text style={[styles.dayLabel, day.n === '15' && styles.dayTextActive]}>{day.d}</Text><Text style={[styles.dayNumber, day.n === '15' && styles.dayTextActive]}>{day.n}</Text></Pressable>)}</View><Text style={styles.sectionTitle}>Wednesday’s schedule</Text>{[
    ['3:15 PM', 'School pickup', 'Oliver · Oakview Elementary', '#2257F4'], ['6:00 PM', 'Asher soccer', 'Field 4 · Bring blue jersey', '#19A47B'], ['8:00 PM', 'Trash to curb', 'Assigned to Chad', '#FF7A2E']
  ].map(([time, title, detail, color]) => <Pressable key={title} style={styles.timelineRow}><View style={[styles.timelineLine, { backgroundColor: color }]} /><Text style={styles.timelineTime}>{time}</Text><View style={styles.flex}><Text style={styles.timelineTitle}>{title}</Text><Text style={styles.muted}>{detail}</Text></View><Ionicons name="chevron-forward" size={18} color={styles.iconColor.color} /></Pressable>)}<View style={styles.syncCard}><Ionicons name="sync" size={18} color="#2257F4" /><View style={styles.flex}><Text style={styles.syncTitle}>Calendars synced</Text><Text style={styles.muted}>Apple Calendar · Google · Skylight</Text></View><Text style={styles.link}>Manage</Text></View></ScrollView>;
}

function ChoresScreen({ styles, chores, onToggle }: any) {
  const completed = chores.filter((item: any) => item.done).length;
  return <ScrollView contentContainerStyle={styles.scrollContent}><View style={styles.progressCard}><View><Text style={styles.progressLabel}>FAMILY PROGRESS</Text><Text style={styles.progressValue}>{completed} of {chores.length}</Text><Text style={styles.muted}>chores complete today</Text></View><View style={styles.progressRing}><Text style={styles.progressPercent}>{Math.round(completed / chores.length * 100)}%</Text></View></View><Text style={styles.sectionTitle}>This week</Text>{chores.map((chore: any) => <Pressable key={chore.id} onPress={() => onToggle(chore.id)} style={styles.choreRow}><View style={[styles.checkCircle, chore.done && { backgroundColor: '#19A47B', borderColor: '#19A47B' }]}>{chore.done && <Ionicons name="checkmark" size={17} color="#fff" />}</View><View style={styles.flex}><Text style={[styles.choreTitle, chore.done && styles.struck]}>{chore.title}</Text><Text style={styles.muted}>{chore.owner} · {chore.due}</Text></View><View style={[styles.ownerDot, { backgroundColor: chore.color }]} /><Ionicons name="chevron-forward" size={17} color={styles.iconColor.color} /></Pressable>)}<Pressable style={styles.outlineAction}><Ionicons name="add" size={19} color="#2257F4" /><Text style={styles.outlineActionText}>Add a recurring chore</Text></Pressable></ScrollView>;
}

function ChatScreen({ styles, messages, draft, setDraft, onSend }: any) {
  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}><FlatList data={messages} keyExtractor={(item) => item.id} contentContainerStyle={styles.messageList} renderItem={({ item }) => <View style={[styles.messageWrap, item.mine && styles.messageMine]}>{!item.mine && <View style={[styles.avatar, styles.chatAvatar]}><Text style={styles.avatarText}>LC</Text></View>}<View><Text style={[styles.messageAuthor, item.mine && styles.messageAuthorMine]}>{item.author}</Text><View style={[styles.messageBubble, item.mine && styles.messageBubbleMine]}><Text style={[styles.messageText, item.mine && styles.messageTextMine]}>{item.text}</Text></View></View></View>} ListHeaderComponent={<View style={styles.chatHeader}><View style={styles.homeThreadIcon}><Text>🏠</Text></View><View><Text style={styles.chatTitle}>Everyone</Text><Text style={styles.muted}>4 family members</Text></View></View>} /><View style={styles.composeRow}><Pressable style={styles.composePlus}><Ionicons name="add" size={22} color="#2257F4" /></Pressable><TextInput value={draft} onChangeText={setDraft} placeholder="Message everyone…" placeholderTextColor="#8B93A5" style={styles.composeInput} returnKeyType="send" onSubmitEditing={onSend} /><Pressable onPress={onSend} style={styles.sendButton}><Ionicons name="send" size={17} color="#fff" /></Pressable></View></KeyboardAvoidingView>;
}

function MoreMenu({ styles, setView }: any) {
  const items = [
    ['Notes', 'document-text-outline', '#7C4DFF', 'Lists, instructions, and family details'],
    ['Recaps', 'sparkles-outline', '#2257F4', 'Daily summaries by push and email'],
    ['Integrations', 'extension-puzzle-outline', '#19A47B', 'Skylight, calendars, email, and more'],
    ['Settings', 'settings-outline', '#FF7A2E', 'Household, privacy, and preferences'],
  ];
  return <ScrollView contentContainerStyle={styles.scrollContent}><Text style={styles.moreIntro}>Everything else your household needs, without cluttering the everyday view.</Text><View style={styles.moreGrid}>{items.map(([title, icon, color, detail]) => <Pressable key={title} onPress={() => setView(title)} style={styles.moreCard}><View style={[styles.moreIcon, { backgroundColor: `${color}18` }]}><Ionicons name={icon as any} size={25} color={color} /></View><Text style={styles.moreTitle}>{title}</Text><Text style={styles.moreDetail}>{detail}</Text><Ionicons name="chevron-forward" size={18} color={styles.iconColor.color} style={styles.moreChevron} /></Pressable>)}</View></ScrollView>;
}

function NotesScreen({ styles }: any) {
  const notes = [['🛒', 'Weekly groceries', '8 items · Updated 12 min ago'], ['🏡', 'Lake house details', 'Shared with everyone'], ['🍝', 'Dinner ideas', '12 recipes'], ['☎️', 'Emergency contacts', 'Pinned · Family admins'], ['🎁', 'Gift ideas', 'Private to adults'], ['🧳', 'PA packing list', '23 of 31 packed']];
  return <ScrollView contentContainerStyle={styles.scrollContent}><TextInput placeholder="Search family notes" placeholderTextColor="#8B93A5" style={styles.searchInput} /><View style={styles.notesGrid}>{notes.map(([icon, title, meta]) => <Pressable key={title} style={styles.noteCard}><Text style={styles.noteEmoji}>{icon}</Text><Text style={styles.noteTitle}>{title}</Text><Text style={styles.muted}>{meta}</Text></Pressable>)}</View></ScrollView>;
}

function RecapsScreen({ styles }: any) {
  return <ScrollView contentContainerStyle={styles.scrollContent}><LinearGradient colors={['#2257F4', '#7047EE']} style={styles.recapHero}><Ionicons name="sparkles" size={24} color="#fff" /><Text style={styles.recapHeroLabel}>WEDNESDAY RECAP</Text><Text style={styles.recapHeroTitle}>Here’s what the family needs to know.</Text><Text style={styles.recapHeroText}>Generated from your shared calendar, chores, messages, and notes. Private to your household.</Text><Pressable style={styles.recapHeroButton}><Ionicons name="play" size={15} color="#2257F4" /><Text>Listen to recap</Text></Pressable></LinearGradient><Text style={styles.sectionTitle}>Today’s highlights</Text>{[['3:15', 'Chad is handling school pickup'], ['6:00', 'Asher has soccer on Field 4'], ['8:00', 'Trash needs to be at the curb']].map(([time, text]) => <View key={time} style={styles.highlightRow}><Text style={styles.highlightTime}>{time}</Text><Text style={styles.highlightText}>{text}</Text><Ionicons name="checkmark-circle" size={18} color="#19A47B" /></View>)}</ScrollView>;
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
    messageList: { padding: 18, gap: 16 }, chatHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line }, homeThreadIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: `${t.primary}14`, alignItems: 'center', justifyContent: 'center' }, chatTitle: { color: t.text, fontSize: 14, fontWeight: '800' }, messageWrap: { maxWidth: '84%', flexDirection: 'row', gap: 8, alignSelf: 'flex-start' }, messageMine: { alignSelf: 'flex-end' }, chatAvatar: { width: 32, height: 32, backgroundColor: '#FFE1CF' }, messageAuthor: { color: t.muted, fontSize: 8, marginBottom: 4 }, messageAuthorMine: { textAlign: 'right' }, messageBubble: { backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, borderRadius: 5, borderTopRightRadius: 16, borderBottomLeftRadius: 16, borderBottomRightRadius: 16, padding: 12 }, messageBubbleMine: { backgroundColor: t.primary, borderColor: t.primary, borderTopLeftRadius: 16, borderTopRightRadius: 5 }, messageText: { color: t.text, fontSize: 12, lineHeight: 17 }, messageTextMine: { color: '#fff' }, composeRow: { minHeight: 61, paddingHorizontal: 12, gap: 8, flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.line, backgroundColor: t.surfaceStrong }, composePlus: { width: 36, height: 36, borderRadius: 12, backgroundColor: `${t.primary}13`, alignItems: 'center', justifyContent: 'center' }, composeInput: { flex: 1, height: 40, borderRadius: 13, borderWidth: 1, borderColor: t.line, backgroundColor: t.surface, color: t.text, paddingHorizontal: 12, fontSize: 12 }, sendButton: { width: 37, height: 37, borderRadius: 12, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center' },
    moreIntro: { color: t.muted, fontSize: 12, lineHeight: 18, marginBottom: 4 }, moreGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 11 }, moreCard: { width: '48.5%', minHeight: 180, borderRadius: 22, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, padding: 16 }, moreIcon: { width: 45, height: 45, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, moreTitle: { color: t.text, fontSize: 15, fontWeight: '800', marginTop: 17 }, moreDetail: { color: t.muted, fontSize: 9, lineHeight: 14, marginTop: 5, paddingRight: 10 }, moreChevron: { position: 'absolute', right: 14, bottom: 14 },
    searchInput: { height: 45, borderRadius: 15, borderWidth: 1, borderColor: t.line, backgroundColor: t.surface, color: t.text, paddingHorizontal: 14 }, notesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, noteCard: { width: '48.5%', minHeight: 140, borderRadius: 19, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, padding: 15 }, noteEmoji: { fontSize: 24 }, noteTitle: { color: t.text, fontSize: 12, fontWeight: '800', marginTop: 18, marginBottom: 4 },
    recapHero: { minHeight: 260, borderRadius: 24, padding: 23, justifyContent: 'center' }, recapHeroLabel: { color: '#FFFFFFB5', fontSize: 8, fontWeight: '800', letterSpacing: 1, marginTop: 13 }, recapHeroTitle: { color: '#fff', fontSize: 28, lineHeight: 31, fontWeight: '800', letterSpacing: -1, marginTop: 8 }, recapHeroText: { color: '#FFFFFFC0', fontSize: 11, lineHeight: 16, marginTop: 8 }, recapHeroButton: { alignSelf: 'flex-start', minHeight: 38, borderRadius: 12, backgroundColor: '#fff', flexDirection: 'row', gap: 7, alignItems: 'center', paddingHorizontal: 13, marginTop: 18 }, highlightRow: { minHeight: 61, flexDirection: 'row', gap: 11, alignItems: 'center', borderRadius: 16, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, padding: 12 }, highlightTime: { color: t.primary, fontSize: 11, fontWeight: '800', width: 38 }, highlightText: { color: t.text, fontSize: 11, fontWeight: '700', flex: 1 },
    automationCard: { minHeight: 90, borderRadius: 20, padding: 16, flexDirection: 'row', gap: 12, alignItems: 'center' }, automationLabel: { color: '#FFFFFFA8', fontSize: 7, fontWeight: '800', letterSpacing: 1 }, automationTitle: { color: '#fff', fontSize: 12, fontWeight: '800', lineHeight: 17, marginTop: 3 }, integrationRow: { minHeight: 78, borderRadius: 18, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }, integrationIcon: { width: 43, height: 43, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, integrationTitle: { color: t.text, fontSize: 12, fontWeight: '800' }, connectButton: { minHeight: 31, borderRadius: 10, borderWidth: 1, borderColor: t.primary, paddingHorizontal: 9, alignItems: 'center', justifyContent: 'center' }, connectedButton: { borderColor: '#19A47B', backgroundColor: '#19A47B12' }, connectText: { color: t.primary, fontSize: 8, fontWeight: '800' }, connectedText: { color: '#19A47B' },
    personSetting: { minHeight: 65, borderRadius: 17, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 10 }, settingRow: { minHeight: 70, borderRadius: 17, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 11 }, settingTitle: { color: t.text, fontSize: 12, fontWeight: '800' },
    modalBackdrop: { flex: 1, backgroundColor: '#0C111D88', justifyContent: 'flex-end' }, modalDismiss: { flex: 1 }, modalSheet: { backgroundColor: t.surfaceStrong, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 19, paddingTop: 9, paddingBottom: Platform.OS === 'ios' ? 28 : 18 }, modalHandle: { width: 39, height: 4, borderRadius: 2, backgroundColor: t.line, alignSelf: 'center', marginBottom: 15 }, modalHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }, modalTitle: { color: t.text, fontSize: 23, fontWeight: '800', letterSpacing: -.7 }, typeTabs: { flexDirection: 'row', borderRadius: 14, padding: 4, backgroundColor: t.canvas, marginTop: 19 }, typeTab: { flex: 1, minHeight: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }, typeTabActive: { backgroundColor: t.surfaceStrong }, typeTabText: { color: t.muted, fontSize: 10, fontWeight: '700' }, typeTabTextActive: { color: t.primary }, fieldLabel: { color: t.muted, fontSize: 9, fontWeight: '800', marginTop: 15, marginBottom: 6 }, modalInput: { minHeight: 46, borderRadius: 13, borderWidth: 1, borderColor: t.line, backgroundColor: t.surface, color: t.text, paddingHorizontal: 12 }, modalTextArea: { minHeight: 83, paddingTop: 12, textAlignVertical: 'top' }, saveButton: { minHeight: 48, borderRadius: 15, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center', marginTop: 18 }, saveButtonText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  });
}
