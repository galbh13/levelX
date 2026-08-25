import { useEffect, useState } from 'react';
import { Animated, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { NavigationContainer, DefaultTheme, getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { C } from './constants/colors';
import { createMaterialTopTabNavigator } from '@react-navigation/material-top-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import {
  useFonts,
  Exo2_400Regular,
  Exo2_600SemiBold,
  Exo2_700Bold,
} from '@expo-google-fonts/exo-2';
import { Cinzel_700Bold, Cinzel_900Black } from '@expo-google-fonts/cinzel';
import * as SplashScreen from 'expo-splash-screen';
import { F } from './constants/fonts';
import { supabase } from './lib/supabase';

import HomeScreen        from './screens/HomeScreen';
import SkillsScreen      from './screens/SkillsScreen';
import WorkoutsScreen    from './screens/WorkoutsScreen';
import CheckupScreen      from './screens/CheckupScreen';
import LoginScreen           from './screens/LoginScreen';
import SetPasswordScreen     from './screens/SetPasswordScreen';
import AdminDashboard        from './screens/AdminDashboard';
import PlayerAdminScreen     from './screens/PlayerAdminScreen';
import AdminCheckupScreen    from './screens/AdminCheckupScreen';
import AdminCheckupTemplateScreen from './screens/AdminCheckupTemplateScreen';
import StudentDetailScreen   from './screens/StudentDetailScreen';
import WorkoutDetailScreen   from './screens/WorkoutDetailScreen';
import WorkoutModeScreen     from './screens/WorkoutModeScreen';
import WorkoutSummaryScreen  from './screens/WorkoutSummaryScreen';
import ExerciseGalleryScreen    from './screens/ExerciseGalleryScreen';
import ExerciseDetailScreen     from './screens/ExerciseDetailScreen';
import AddExerciseScreen        from './screens/AddExerciseScreen';
import AddExampleWorkoutScreen  from './screens/AddExampleWorkoutScreen';
import WorkoutEditScreen       from './screens/WorkoutEditScreen';
import AllWorkoutsScreen       from './screens/AllWorkoutsScreen';
import EliteWorkoutsScreen     from './screens/EliteWorkoutsScreen';
import DailyQuestScreen        from './screens/CoachDailyQuestScreen';
import QuestTreeScreen         from './screens/QuestTreeScreen';
import PersonalScreen          from './screens/PersonalScreen';
import CommunityGroupScreen    from './screens/CommunityGroupScreen';
import CommunityChatScreen     from './screens/CommunityChatScreen';
import CoachChatScreen         from './screens/CoachChatScreen';
import HunterStatusScreen      from './screens/HunterStatusScreen';
import SystemScreen            from './screens/SystemScreen';
import AdminCommunityScreen    from './screens/AdminCommunityScreen';
import AdminGroupScreen        from './screens/AdminGroupScreen';
import AdminCheckupInboxScreen from './screens/AdminCheckupInboxScreen';
import AdminChatNotesScreen    from './screens/AdminChatNotesScreen';
import AdminBusinessScreen     from './screens/AdminBusinessScreen';
import AdminPlansScreen        from './screens/AdminPlansScreen';
import PlayerBillingScreen     from './screens/PlayerBillingScreen';
import { CoachProvider, useCoach } from './context/CoachContext';
import { CheckupNotifyProvider, useCheckupNotify } from './context/CheckupNotifyContext';
import { AdminNotifyProvider } from './context/AdminNotifyContext';
import { armHoloEntry } from './lib/holoEntry';
import SystemIntro from './components/SystemIntro';
import IntroBoundary from './components/IntroBoundary';

// One-line kill switch for the cold-start title sequence.
const INTRO_ENABLED = true;

SplashScreen.preventAutoHideAsync();

// Match the web build exactly: ignore the device's system font-size setting so
// every label renders at its designed size. Without this, Android inflates text
// per the user's Display "font size" setting and tight labels (e.g. the Sun–Sat
// day strip) wrap onto two lines — a native-only difference from web.
Text.defaultProps = Text.defaultProps || {};
Text.defaultProps.allowFontScaling = false;
TextInput.defaultProps = TextInput.defaultProps || {};
TextInput.defaultProps.allowFontScaling = false;

// React Navigation defaults to a WHITE scene background, which flashes white on
// mount/transitions. Force our dark navy everywhere.
const NAV_THEME = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: C.bg },
};

// The screens' font sizes are tuned for a phone, so the web build renders huge on
// a desktop monitor. Bake in a zoom-out (what you'd otherwise do by hand in the
// browser) so it opens at a comfortable size. Web only — native devices are
// unaffected. Lower = smaller; tweak to taste.
const WEB_ZOOM = 0.7;

// Native has no document zoom, so the app would render ~40% bigger than the web
// build (which is zoomed to WEB_ZOOM) — users know the smaller web density from
// levelx.expo.app. Mirror it on native: render the whole tree into an OVERSIZED
// canvas (so every screen lays out with more room) then scale it back down to
// fill the device. Layout reflows correctly and touches map through the
// transform. Web keeps its own zoom and is untouched. Tweak to taste.
const NATIVE_SCALE = 0.72;

function ScaledRoot({ children }) {
  const { width, height } = useWindowDimensions();
  if (Platform.OS === 'web') return children;
  return (
    <View style={{ flex: 1, backgroundColor: C.bg, overflow: 'hidden' }}>
      <View
        style={{
          width: width / NATIVE_SCALE,
          height: height / NATIVE_SCALE,
          transform: [{ scale: NATIVE_SCALE }],
          transformOrigin: 'top left',
        }}
      >
        {children}
      </View>
    </View>
  );
}

const Tab           = createMaterialTopTabNavigator();
const RootStack     = createNativeStackNavigator();
const SkillsStack   = createNativeStackNavigator();
const WorkoutsStack = createNativeStackNavigator();
const PersonalStack = createNativeStackNavigator();
const AdminStack    = createNativeStackNavigator();

// Custom bottom nav — one cohesive ice-glow unit, text only (no icons). The
// active tab gets a glowing marker flush with the bar's top edge plus a glowing
// label; inactive tabs read as muted siblings on the same surface.
const INDICATOR_W = 34;

function PlayerTabBar({ state, navigation, position }) {
  // Slide the glow marker continuously with the pager: `position` is a float
  // (0…routes-1) that tracks the swipe in real time, so the line moves in the
  // same ratio as the drag instead of jumping at the end.
  const [barWidth, setBarWidth] = useState(0);
  const { state: checkupState } = useCheckupNotify();   // 'none' | 'due' | 'late'
  const count = state.routes.length;
  const tabWidth = barWidth / count;

  // Which tab reads as ACTIVE (the bold ice-glow label). Driven by the live pager
  // `position` and rounded, so the label flips at the swipe's halfway point —
  // matching the sliding line — instead of waiting for the gesture to fully
  // commit (which reads late via `state.index`).
  const [activeIndex, setActiveIndex] = useState(state.index);
  useEffect(() => {
    const id = position.addListener(({ value }) => {
      const next = Math.max(0, Math.min(count - 1, Math.round(value)));
      setActiveIndex((prev) => (prev === next ? prev : next));
    });
    return () => position.removeListener(id);
  }, [position, count]);
  // Snap to the committed index too (covers tab presses, where position may jump).
  useEffect(() => { setActiveIndex(state.index); }, [state.index]);

  const inputRange = state.routes.map((_, i) => i);
  const translateX = position.interpolate({
    inputRange: inputRange.length > 1 ? inputRange : [0, 1],
    outputRange: (inputRange.length > 1 ? inputRange : [0, 1]).map(
      (i) => tabWidth * (i + 0.5) - INDICATOR_W / 2
    ),
  });

  return (
    <View style={tabStyles.bar} onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}>
      {barWidth > 0 && (
        <Animated.View
          pointerEvents="none"
          style={[tabStyles.indicatorWrap, { transform: [{ translateX }] }]}
        >
          <View style={tabStyles.indicator} />
        </Animated.View>
      )}

      {state.routes.map((route, index) => {
        // `focused` here is the VISUAL active tab (flips at 50% of a swipe). Nav
        // actions below still use the real committed index via `state.index`.
        const focused = activeIndex === index;
        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (state.index !== index && !event.defaultPrevented) navigation.navigate(route.name);
        };
        return (
          <TouchableOpacity
            key={route.key}
            accessibilityRole="button"
            accessibilityState={focused ? { selected: true } : {}}
            onPress={onPress}
            style={tabStyles.tab}
            activeOpacity={0.7}
          >
            <View style={tabStyles.labelWrap}>
              <Text
                numberOfLines={1}
                style={[
                  tabStyles.label,
                  focused ? tabStyles.labelActive : tabStyles.labelMuted,
                ]}
              >
                {route.name.toUpperCase()}
              </Text>
              {route.name === 'Checkup' && checkupState !== 'none' && (
                <View style={[tabStyles.dot, checkupState === 'late' && tabStyles.dotLate]} />
              )}
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const tabStyles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    height: 88,
    paddingBottom: 22,
    backgroundColor: C.navBg,
    borderTopWidth: 1,
    borderTopColor: C.cardBorder,
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Glowing marker pinned to the bar's top edge — ties the active tab to the
  // surface above it so the whole bar feels like one piece. Positioned at the
  // bar's left edge and slid horizontally via an animated translateX.
  indicatorWrap: { position: 'absolute', top: 0, left: 0, width: INDICATOR_W, alignItems: 'center' },
  indicator: {
    width: INDICATOR_W,
    height: 3,
    borderRadius: 2,
    backgroundColor: C.iceGlow,
    shadowColor: C.iceGlow,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 8,
  },

  // Wraps the label so the notification dot can pin to its top-right corner.
  labelWrap: { position: 'relative' },
  label: { fontFamily: F.heading, fontSize: 13, letterSpacing: 1 },

  // "Check-up owed" marker — a small static ice dot off the label's top-right.
  // No animation; it reads as a system indicator, not an alarm.
  dot: {
    position: 'absolute',
    top: -5,
    right: -12,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: C.iceGlow,
    shadowColor: C.iceGlow,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 6,
  },
  // Late — the grace day and still nothing sent.
  dotLate: { backgroundColor: '#E11D48', shadowColor: '#E11D48' },

  labelActive: {
    color: C.iceGlow,
    textShadowColor: 'rgba(74,158,191,0.6)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },
  labelMuted: { color: C.textMuted },
});

function SkillsNavigator() {
  return (
    <SkillsStack.Navigator screenOptions={{ headerShown: false }}>
      <SkillsStack.Screen name="SkillsList" component={SkillsScreen} />
      <SkillsStack.Screen name="QuestTree"  component={QuestTreeScreen} />
    </SkillsStack.Navigator>
  );
}

// Workouts stack now carries the full self-coaching authoring flow: the player
// schedules / creates / edits their own workouts (Manage = StudentDetailScreen
// scoped to self) and manages their own daily quests.
function WorkoutsNavigator() {
  return (
    <WorkoutsStack.Navigator screenOptions={{ headerShown: false }}>
      <WorkoutsStack.Screen name="WorkoutsList"    component={WorkoutsScreen} />
      <WorkoutsStack.Screen name="WorkoutDetail"   component={WorkoutDetailScreen} />
      <WorkoutsStack.Screen name="WorkoutMode"     component={WorkoutModeScreen} />
      <WorkoutsStack.Screen name="WorkoutSummary"  component={WorkoutSummaryScreen} />
      <WorkoutsStack.Screen name="Manage" component={StudentDetailScreen} options={({ route }) => (route.params?.fromForge ? { animation: 'none', presentation: 'transparentModal' } : { animation: 'default' })} />
      <WorkoutsStack.Screen name="WorkoutEdit"     component={WorkoutEditScreen} />
      <WorkoutsStack.Screen name="ExerciseGallery" component={ExerciseGalleryScreen} />
      <WorkoutsStack.Screen name="ExerciseDetail"  component={ExerciseDetailScreen} />
      <WorkoutsStack.Screen name="AddExercise"     component={AddExerciseScreen} />
      <WorkoutsStack.Screen name="AllWorkouts"     component={AllWorkoutsScreen} />
      <WorkoutsStack.Screen
        name="DailyQuest"
        component={DailyQuestScreen}
        options={{ presentation: 'transparentModal', animation: 'fade' }}
      />
    </WorkoutsStack.Navigator>
  );
}

// Personal stack: the player's private space — coach chat + The System.
function PersonalNavigator() {
  return (
    <PersonalStack.Navigator screenOptions={{ headerShown: false }}>
      <PersonalStack.Screen name="PersonalList" component={PersonalScreen} />
      <PersonalStack.Screen name="CoachChat"    component={CoachChatScreen} />
      <PersonalStack.Screen name="System"       component={SystemScreen} />
    </PersonalStack.Navigator>
  );
}

function AdminNavigator() {
  return (
    <CoachProvider isAdmin>
      <AdminNotifyProvider>
      <AdminStack.Navigator screenOptions={{ headerShown: false }}>
        <AdminStack.Screen name="AdminDashboard"    component={AdminDashboard} />
        <AdminStack.Screen name="ExerciseGallery"   component={ExerciseGalleryScreen} />
        <AdminStack.Screen name="ExerciseDetail"    component={ExerciseDetailScreen} />
        <AdminStack.Screen name="AddExercise"       component={AddExerciseScreen} />
        <AdminStack.Screen name="AddExampleWorkout" component={AddExampleWorkoutScreen} />
        <AdminStack.Screen name="WorkoutMode"       component={WorkoutModeScreen} />
        <AdminStack.Screen name="WorkoutSummary"    component={WorkoutSummaryScreen} />
        <AdminStack.Screen name="PlayerAdmin"       component={PlayerAdminScreen} />
        <AdminStack.Screen name="PlayerCheckup"     component={AdminCheckupScreen} />
        <AdminStack.Screen name="CheckupTemplates"  component={AdminCheckupTemplateScreen} />
        <AdminStack.Screen name="WorkoutsList"      component={WorkoutsScreen} />
        <AdminStack.Screen name="SkillsList"        component={SkillsScreen} />
        <AdminStack.Screen name="QuestTree"         component={QuestTreeScreen} />
        <AdminStack.Screen name="Manage" component={StudentDetailScreen} options={({ route }) => (route.params?.fromForge ? { animation: 'none', presentation: 'transparentModal' } : { animation: 'default' })} />
        <AdminStack.Screen name="DailyQuest" component={DailyQuestScreen} options={{ presentation: 'transparentModal', animation: 'fade' }} />
        <AdminStack.Screen name="AllWorkouts"       component={AllWorkoutsScreen} />
        <AdminStack.Screen name="EliteWorkouts"     component={EliteWorkoutsScreen} />
        <AdminStack.Screen name="WorkoutEdit"       component={WorkoutEditScreen} />
        <AdminStack.Screen name="WorkoutDetail"     component={WorkoutDetailScreen} />
        <AdminStack.Screen name="AdminCommunity"    component={AdminCommunityScreen} />
        <AdminStack.Screen name="AdminGroup"        component={AdminGroupScreen} />
        <AdminStack.Screen name="CommunityChat"     component={CommunityChatScreen} />
        <AdminStack.Screen name="CoachChat"         component={CoachChatScreen} />
        <AdminStack.Screen name="HunterStatus"      component={HunterStatusScreen} />
        <AdminStack.Screen name="CheckupInbox"      component={AdminCheckupInboxScreen} />
        <AdminStack.Screen name="ChatNotes"         component={AdminChatNotesScreen} />
        {/* Business layer — admin-only money surfaces (migration 20260825_business_billing). */}
        <AdminStack.Screen name="Business"          component={AdminBusinessScreen} />
        <AdminStack.Screen name="BillingPlans"      component={AdminPlansScreen} />
        <AdminStack.Screen name="PlayerBilling"     component={PlayerBillingScreen} />
      </AdminStack.Navigator>
      </AdminNotifyProvider>
    </CoachProvider>
  );
}

// Seeds the shared "selected student" context with the logged-in player's own
// profile. Self-coaching screens (StudentDetail/Manage, DailyQuest)
// were originally written for a coach acting on a student; pointing that subject
// at the player themselves makes the player their own coach with zero rewrites.
function SelfStudentSync() {
  const { setSelectedStudent } = useCoach();
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('id', user.id)
        .single();
      if (data) setSelectedStudent(data);
    })();
  }, [setSelectedStudent]);
  return null;
}

// Swipe between the 4 tabs is disabled while a nested stack is on a sub-screen
// (e.g. QuestTree, WorkoutMode) so a horizontal drag there doesn't yank you to
// the neighbouring tab — swipe only switches tabs from each stack's root.
const swipeAtRoot = (rootRoute) => ({ route }) => ({
  swipeEnabled: (getFocusedRouteNameFromRoute(route) ?? rootRoute) === rootRoute,
});

function PlayerTabs() {
  return (
    <Tab.Navigator
      initialRouteName="Home"
      tabBarPosition="bottom"
      tabBar={(props) => <PlayerTabBar {...props} />}
      // Mount all four tabs at app start so a swipe lands on an already-built,
      // already-fetched screen instead of a cold mount mid-gesture.
      screenOptions={{ swipeEnabled: true, lazy: false }}
      sceneContainerStyle={{ backgroundColor: C.bg }}
    >
      <Tab.Screen name="Skills"   component={SkillsNavigator}   options={swipeAtRoot('SkillsList')} />
      <Tab.Screen name="Workouts" component={WorkoutsNavigator} options={swipeAtRoot('WorkoutsList')} />
      <Tab.Screen name="Home"     component={HomeScreen} />
      <Tab.Screen name="Personal" component={PersonalNavigator} options={swipeAtRoot('PersonalList')} />
      <Tab.Screen name="Checkup"  component={CheckupScreen} />
    </Tab.Navigator>
  );
}

// The full player experience: their consumption tabs + self-coaching authoring,
// all sharing one CoachProvider seeded with the player's own profile.
function PlayerApp() {
  return (
    <CoachProvider>
      <SelfStudentSync />
      <CheckupNotifyProvider>
        {/* The live Workout Mode session is pushed ABOVE the tab pager (full-screen,
            its own root-stack route) instead of living inside the Workouts stack.
            Inside the pager a horizontal drag mid-set could swipe you off to a
            neighbouring tab, and the bottom bar stayed visible over a screen that
            wants the whole display. Hoisting it also means backing out returns you
            exactly where you were in the tabs rather than unwinding the stack under
            the session (worsened when Home moved to the middle of the bar).
            WorkoutSummary rides along — it's the tail of the same full-screen flow. */}
        <RootStack.Navigator screenOptions={{ headerShown: false }}>
          <RootStack.Screen name="Tabs"           component={PlayerTabs} />
          <RootStack.Screen name="WorkoutMode"    component={WorkoutModeScreen} />
          <RootStack.Screen name="WorkoutSummary" component={WorkoutSummaryScreen} />
        </RootStack.Navigator>
      </CheckupNotifyProvider>
    </CoachProvider>
  );
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    Exo2_400Regular,
    Exo2_600SemiBold,
    Exo2_700Bold,
    Cinzel_700Bold,
    Cinzel_900Black,
  });

  // A slow or failed font load must never brick a cold start: proceed once the
  // fonts load, error out, or a short grace period elapses (text falls back).
  const [fontGrace, setFontGrace] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setFontGrace(true), 4000);
    return () => clearTimeout(t);
  }, []);
  const fontsReady = fontsLoaded || !!fontError || fontGrace;

  const [session, setSession] = useState(undefined); // undefined = loading
  const [role, setRole]       = useState(null);
  // An invited player still holding the shared starter password — the app is
  // blocked behind SetPasswordScreen until they pick their own.
  const [mustChangePw, setMustChangePw] = useState(false);
  // The THE SYSTEM title sequence — plays once per cold start, over everything.
  const [introDone, setIntroDone] = useState(false);

  // Apply the baked-in zoom-out on web so the app opens at a comfortable size,
  // and paint the document dark so no white page background flashes through when
  // the React tree remounts (e.g. login → app).
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.documentElement.style.zoom = String(WEB_ZOOM);
      document.documentElement.style.backgroundColor = C.bg;
      document.body.style.backgroundColor = C.bg;
      const root = document.getElementById('root');
      if (root) root.style.backgroundColor = C.bg;
    }
  }, []);

  // Listen to auth state changes
  useEffect(() => {
    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        setSession(session);
        if (session) { armHoloEntry(); fetchRole(session.user.id); } // play build on app open
      })
      .catch(() => setSession(null)); // a storage/auth hiccup must not hang the splash forever

    // Hard fallback: if the session check never settles (e.g. native storage
    // stalls), don't sit on a black splash — treat it as logged-out so login shows.
    const sessionFallback = setTimeout(() => {
      setSession((s) => (s === undefined ? null : s));
    }, 6000);

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      if (session) {
        if (event === 'SIGNED_IN') armHoloEntry();   // play build right after login
        fetchRole(session.user.id);
      } else {
        setRole(null);
        setMustChangePw(false);
      }
    });

    return () => { clearTimeout(sessionFallback); subscription.unsubscribe(); };
  }, []);

  async function fetchRole(userId) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .single();

      // No row at all (PGRST116 = zero rows from `.single()`) means this token
      // outlived its account — the coach deleted the player, but the access
      // token stays valid for the rest of its hour. Defaulting to 'player' there
      // mounts the whole tab app on top of a user that no longer exists, and
      // every screen then reads nothing: the black-home bug. Sign the ghost out
      // so they land on the login card instead.
      if (error?.code === 'PGRST116') {
        await supabase.auth.signOut();
        return;
      }

      setRole(data?.role ?? 'player');
    } catch {
      setRole('player'); // a failed role lookup defaults to player rather than bricking startup
    }

    // Deliberately a SEPARATE query from the role lookup above. `must_change_password`
    // is a newer column (migrations/20260825_invite_player.sql) and the live DB has
    // drifted from migrations before — folding it into the role select would make a
    // missing column brick routing for everyone, including the admin. On its own, an
    // error here just means "no forced change", which is the safe direction.
    try {
      const { data } = await supabase
        .from('profiles')
        .select('must_change_password')
        .eq('id', userId)
        .single();
      setMustChangePw(!!data?.must_change_password);
    } catch {
      setMustChangePw(false);
    }
  }

  // Hide the native splash as soon as we're ready to render. CRITICAL: do NOT tie
  // this to NavigationContainer's `onReady` — when logged out we render <LoginScreen/>
  // directly inside the container with NO navigator, so on native `onReady` never
  // fires and the splash hangs forever (the black-screen-on-launch bug). Hiding on
  // our own readiness state is navigator-independent, so it always fires.
  useEffect(() => {
    if (fontsReady && session !== undefined) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsReady, session]);

  // With the intro in play, also drop the native splash on mount so the title
  // sequence starts immediately and covers the font/session wait instead of the
  // user watching a static splash first. Both calls are idempotent.
  useEffect(() => { SplashScreen.hideAsync().catch(() => {}); }, []);

  // Hold splash until fonts + session check are done
  function renderContent() {
    if (!fontsReady || session === undefined) {
      return <View style={{ flex: 1, backgroundColor: C.bg }} />;
    }

    // Not logged in
    if (!session) {
      return (
        <ScaledRoot>
          <NavigationContainer theme={NAV_THEME}>
            <LoginScreen />
          </NavigationContainer>
        </ScaledRoot>
      );
    }

    // Logged in — route by role (wait for role to load)
    if (!role) {
      return <View style={{ flex: 1, backgroundColor: C.bg }} />;
    }

    // A freshly invited player is still on the shared starter password — nothing
    // else mounts until they replace it. Rendered bare (no navigator) like
    // LoginScreen, because there is nowhere to navigate to.
    if (mustChangePw) {
      return (
        <ScaledRoot>
          <NavigationContainer theme={NAV_THEME}>
            <SetPasswordScreen
              userId={session.user.id}
              onDone={() => setMustChangePw(false)}
            />
          </NavigationContainer>
        </ScaledRoot>
      );
    }

    // Only two roles remain: admin and player. Everyone else is treated as a player.
    return (
      <ScaledRoot>
        <NavigationContainer theme={NAV_THEME}>
          {role === 'admin' ? <AdminNavigator /> : <PlayerApp />}
        </NavigationContainer>
      </ScaledRoot>
    );
  }

  // The intro sits ABOVE the real tree rather than replacing it, so the login
  // card (or the tabs) mounts and lays out behind the clip and is already settled
  // when the fade uncovers it — no pop-in on the hand-off. It also masks the
  // font/session wait, which is why it renders while those are still pending.
  // Kept OUTSIDE ScaledRoot so the clip fills the real screen, not the zoomed canvas.
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {renderContent()}
      {INTRO_ENABLED && !introDone && (
        <IntroBoundary onFail={() => setIntroDone(true)}>
          <SystemIntro onDone={() => setIntroDone(true)} />
        </IntroBoundary>
      )}
    </View>
  );
}
