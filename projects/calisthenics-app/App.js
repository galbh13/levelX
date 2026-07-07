import { useCallback, useEffect, useState } from 'react';
import { Animated, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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
import ProfileScreen     from './screens/ProfileScreen';
import LoginScreen           from './screens/LoginScreen';
import AdminDashboard        from './screens/AdminDashboard';
import PlayerAdminScreen     from './screens/PlayerAdminScreen';
import StudentDetailScreen   from './screens/StudentDetailScreen';
import WorkoutDetailScreen   from './screens/WorkoutDetailScreen';
import WorkoutModeScreen     from './screens/WorkoutModeScreen';
import WorkoutSummaryScreen  from './screens/WorkoutSummaryScreen';
import ExerciseGalleryScreen    from './screens/ExerciseGalleryScreen';
import ExerciseDetailScreen     from './screens/ExerciseDetailScreen';
import AddExerciseScreen        from './screens/AddExerciseScreen';
import AddExampleWorkoutScreen  from './screens/AddExampleWorkoutScreen';
import CreateWorkoutScreen   from './screens/CreateWorkoutScreen';
import WorkoutEditScreen       from './screens/WorkoutEditScreen';
import AllWorkoutsScreen       from './screens/AllWorkoutsScreen';
import EliteWorkoutsScreen     from './screens/EliteWorkoutsScreen';
import DailyQuestScreen        from './screens/CoachDailyQuestScreen';
import WeeklyAccessoriesScreen from './screens/WeeklyAccessoriesScreen';
import QuestTreeScreen         from './screens/QuestTreeScreen';
import { CoachProvider, useCoach } from './context/CoachContext';
import { armHoloEntry } from './lib/holoEntry';

SplashScreen.preventAutoHideAsync();

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

const Tab           = createMaterialTopTabNavigator();
const SkillsStack   = createNativeStackNavigator();
const WorkoutsStack = createNativeStackNavigator();
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
      setActiveIndex(prev => (prev === next ? prev : next));
    });
    return () => position.removeListener(id);
  }, [position, count]);
  // Snap to the committed index too (covers tab presses, where position may jump).
  useEffect(() => { setActiveIndex(state.index); }, [state.index]);

  const inputRange = state.routes.map((_, i) => i);
  const translateX = position.interpolate({
    inputRange: inputRange.length > 1 ? inputRange : [0, 1],
    outputRange: (inputRange.length > 1 ? inputRange : [0, 1]).map(
      i => tabWidth * (i + 0.5) - INDICATOR_W / 2,
    ),
  });
  return (
    <View style={tabStyles.bar} onLayout={e => setBarWidth(e.nativeEvent.layout.width)}>
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
          const event = navigation.emit({
            type: 'tabPress', target: route.key, canPreventDefault: true,
          });
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
            <Text style={[tabStyles.label, focused ? tabStyles.labelActive : tabStyles.labelMuted]}>
              {route.name.toUpperCase()}
            </Text>
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
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Glowing marker pinned to the bar's top edge — ties the active tab to the
  // surface above it so the whole bar feels like one piece. Positioned at the
  // bar's left edge and slid horizontally via an animated translateX.
  indicatorWrap: { position: 'absolute', top: 0, left: 0, width: INDICATOR_W, alignItems: 'center' },
  indicator: {
    width: INDICATOR_W, height: 3, borderRadius: 2,
    backgroundColor: C.iceGlow,
    shadowColor: C.iceGlow, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.9, shadowRadius: 8,
  },
  label: {
    fontFamily: F.heading,
    fontSize: 15,
    letterSpacing: 1.5,
  },
  labelActive: {
    color: C.iceGlow,
    textShadowColor: 'rgba(74,158,191,0.6)',
    textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 12,
  },
  labelMuted: { color: C.textMuted },
});

function SkillsNavigator() {
  return (
    <SkillsStack.Navigator screenOptions={{ headerShown: false }}>
      <SkillsStack.Screen name="SkillsList"  component={SkillsScreen} />
      <SkillsStack.Screen name="QuestTree"   component={QuestTreeScreen} />
    </SkillsStack.Navigator>
  );
}

// Workouts stack now carries the full self-coaching authoring flow: the player
// schedules / creates / edits their own workouts (Manage = StudentDetailScreen
// scoped to self) and manages their own daily quests.
function WorkoutsNavigator() {
  return (
    <WorkoutsStack.Navigator screenOptions={{ headerShown: false }}>
      <WorkoutsStack.Screen name="WorkoutsList"   component={WorkoutsScreen} />
      <WorkoutsStack.Screen name="WorkoutDetail"  component={WorkoutDetailScreen} />
      <WorkoutsStack.Screen name="WorkoutMode"    component={WorkoutModeScreen} />
      <WorkoutsStack.Screen name="WorkoutSummary" component={WorkoutSummaryScreen} />
      <WorkoutsStack.Screen name="Manage"         component={StudentDetailScreen} options={({ route }) => ({ animation: route.params?.fromForge ? 'none' : 'default' })} />
      <WorkoutsStack.Screen name="CreateWorkout"  component={CreateWorkoutScreen} />
      <WorkoutsStack.Screen name="WorkoutEdit"    component={WorkoutEditScreen} />
      <WorkoutsStack.Screen name="ExerciseGallery" component={ExerciseGalleryScreen} />
      <WorkoutsStack.Screen name="ExerciseDetail"  component={ExerciseDetailScreen} />
      <WorkoutsStack.Screen name="AddExercise"     component={AddExerciseScreen} />
      <WorkoutsStack.Screen name="AllWorkouts"     component={AllWorkoutsScreen} />
      <WorkoutsStack.Screen name="EliteWorkouts"   component={EliteWorkoutsScreen} />
      <WorkoutsStack.Screen name="WeeklyAccessories" component={WeeklyAccessoriesScreen} />
      <WorkoutsStack.Screen name="DailyQuest"      component={DailyQuestScreen} options={{ presentation: 'transparentModal', animation: 'fade' }} />
    </WorkoutsStack.Navigator>
  );
}

function AdminNavigator() {
  return (
    <CoachProvider>
      <AdminStack.Navigator screenOptions={{ headerShown: false }}>
        <AdminStack.Screen name="AdminDashboard"     component={AdminDashboard} />
        <AdminStack.Screen name="ExerciseGallery"    component={ExerciseGalleryScreen} />
        <AdminStack.Screen name="ExerciseDetail"     component={ExerciseDetailScreen} />
        <AdminStack.Screen name="AddExercise"        component={AddExerciseScreen} />
        <AdminStack.Screen name="AddExampleWorkout"  component={AddExampleWorkoutScreen} />
        {/* Lets admins run an example workout as a player would (gallery preview). */}
        <AdminStack.Screen name="WorkoutMode"        component={WorkoutModeScreen} />
        <AdminStack.Screen name="WorkoutSummary"     component={WorkoutSummaryScreen} />

        {/* Admin-as-coach: tap a player on the roster to manage their account.
            These reuse the self-coach screens, scoped to the tapped player via the
            shared CoachContext (selectedStudent) + a studentId param on Skills. */}
        <AdminStack.Screen name="PlayerAdmin"        component={PlayerAdminScreen} />
        <AdminStack.Screen name="WorkoutsList"       component={WorkoutsScreen} />
        <AdminStack.Screen name="SkillsList"         component={SkillsScreen} />
        <AdminStack.Screen name="QuestTree"          component={QuestTreeScreen} />
        <AdminStack.Screen name="Manage"             component={StudentDetailScreen} options={({ route }) => ({ animation: route.params?.fromForge ? 'none' : 'default' })} />
        <AdminStack.Screen name="DailyQuest"         component={DailyQuestScreen} options={{ presentation: 'transparentModal', animation: 'fade' }} />
        <AdminStack.Screen name="AllWorkouts"        component={AllWorkoutsScreen} />
        <AdminStack.Screen name="EliteWorkouts"      component={EliteWorkoutsScreen} />
        <AdminStack.Screen name="WeeklyAccessories"  component={WeeklyAccessoriesScreen} />
        <AdminStack.Screen name="CreateWorkout"      component={CreateWorkoutScreen} />
        <AdminStack.Screen name="WorkoutEdit"        component={WorkoutEditScreen} />
        <AdminStack.Screen name="WorkoutDetail"      component={WorkoutDetailScreen} />
      </AdminStack.Navigator>
    </CoachProvider>
  );
}

// Seeds the shared "selected student" context with the logged-in player's own
// profile. Self-coaching screens (CreateWorkout, StudentDetail/Manage, DailyQuest)
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
      tabBar={props => <PlayerTabBar {...props} />}
      // Mount all four tabs at app start so a swipe lands on an already-built,
      // already-fetched screen instead of a cold mount mid-gesture.
      screenOptions={{ swipeEnabled: true, lazy: false }}
      sceneContainerStyle={{ backgroundColor: C.bg }}
    >
      <Tab.Screen name="Skills"     component={SkillsNavigator}   options={swipeAtRoot('SkillsList')} />
      <Tab.Screen name="Home"       component={HomeScreen} />
      <Tab.Screen name="Workouts"   component={WorkoutsNavigator} options={swipeAtRoot('WorkoutsList')} />
      <Tab.Screen name="Profile"    component={ProfileScreen} />
    </Tab.Navigator>
  );
}

// The full player experience: their consumption tabs + self-coaching authoring,
// all sharing one CoachProvider seeded with the player's own profile.
function PlayerApp() {
  return (
    <CoachProvider>
      <SelfStudentSync />
      <PlayerTabs />
    </CoachProvider>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({
    Exo2_400Regular,
    Exo2_600SemiBold,
    Exo2_700Bold,
    Cinzel_700Bold,
    Cinzel_900Black,
  });

  const [session, setSession] = useState(undefined); // undefined = loading
  const [role, setRole]       = useState(null);

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
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) { armHoloEntry(); fetchRole(session.user.id); } // play build on app open
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      if (session) {
        if (event === 'SIGNED_IN') armHoloEntry();   // play build right after login
        fetchRole(session.user.id);
      } else {
        setRole(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function fetchRole(userId) {
    const { data } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .single();
    setRole(data?.role ?? null);
  }

  const onReady = useCallback(async () => {
    if (fontsLoaded && session !== undefined) await SplashScreen.hideAsync();
  }, [fontsLoaded, session]);

  // Hold splash until fonts + session check are done
  if (!fontsLoaded || session === undefined) {
    return <View style={{ flex: 1, backgroundColor: C.bg }} />;
  }

  // Not logged in
  if (!session) {
    return (
      <NavigationContainer theme={NAV_THEME} onReady={onReady}>
        <LoginScreen />
      </NavigationContainer>
    );
  }

  // Logged in — route by role (wait for role to load)
  if (!role) {
    return <View style={{ flex: 1, backgroundColor: C.bg }} />;
  }

  // Only two roles remain: admin and player. Everyone else is treated as a player.
  return (
    <NavigationContainer theme={NAV_THEME} onReady={onReady}>
      {role === 'admin' ? <AdminNavigator /> : <PlayerApp />}
    </NavigationContainer>
  );
}
