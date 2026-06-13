import { useCallback, useEffect, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { C } from './constants/colors';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import {
  useFonts,
  Exo2_400Regular,
  Exo2_600SemiBold,
  Exo2_700Bold,
} from '@expo-google-fonts/exo-2';
import * as SplashScreen from 'expo-splash-screen';
import { F } from './constants/fonts';
import { supabase } from './lib/supabase';

import HomeScreen        from './screens/HomeScreen';
import SkillsScreen      from './screens/SkillsScreen';
import SkillTreeScreen   from './screens/SkillTreeScreen';
import WorkoutsScreen    from './screens/WorkoutsScreen';
import ProfileScreen     from './screens/ProfileScreen';
import ChallengesScreen  from './screens/ChallengesScreen';
import LoginScreen           from './screens/LoginScreen';
import AdminDashboard        from './screens/AdminDashboard';
import StudentDetailScreen   from './screens/StudentDetailScreen';
import WorkoutDetailScreen   from './screens/WorkoutDetailScreen';
import AddWorkoutScreen      from './screens/AddWorkoutScreen';
import ExerciseGalleryScreen    from './screens/ExerciseGalleryScreen';
import ExerciseDetailScreen     from './screens/ExerciseDetailScreen';
import AddExerciseScreen        from './screens/AddExerciseScreen';
import AddExampleWorkoutScreen  from './screens/AddExampleWorkoutScreen';
import CreateWorkoutScreen   from './screens/CreateWorkoutScreen';
import WorkoutEditScreen       from './screens/WorkoutEditScreen';
import AllWorkoutsScreen       from './screens/AllWorkoutsScreen';
import DailyQuestScreen        from './screens/CoachDailyQuestScreen';
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

const Tab           = createBottomTabNavigator();
const SkillsStack   = createNativeStackNavigator();
const WorkoutsStack = createNativeStackNavigator();
const AdminStack    = createNativeStackNavigator();

function TabIcon({ label, focused }) {
  const icons = { Skills: '⚡', Challenges: '🏆', Workouts: '🏋', Profile: '👤' };
  return (
    <Text style={{ fontSize: 38, opacity: focused ? 1 : 0.4 }}>{icons[label]}</Text>
  );
}

function SkillsNavigator() {
  return (
    <SkillsStack.Navigator screenOptions={{ headerShown: false }}>
      <SkillsStack.Screen name="SkillsList"  component={SkillsScreen} />
      <SkillsStack.Screen name="SkillTree"   component={SkillTreeScreen} />
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
      <WorkoutsStack.Screen name="Manage"         component={StudentDetailScreen} />
      <WorkoutsStack.Screen name="CreateWorkout"  component={CreateWorkoutScreen} />
      <WorkoutsStack.Screen name="AddWorkout"     component={AddWorkoutScreen} />
      <WorkoutsStack.Screen name="WorkoutEdit"    component={WorkoutEditScreen} />
      <WorkoutsStack.Screen name="ExerciseGallery" component={ExerciseGalleryScreen} />
      <WorkoutsStack.Screen name="ExerciseDetail"  component={ExerciseDetailScreen} />
      <WorkoutsStack.Screen name="AddExercise"     component={AddExerciseScreen} />
      <WorkoutsStack.Screen name="AllWorkouts"     component={AllWorkoutsScreen} />
      <WorkoutsStack.Screen name="DailyQuest"      component={DailyQuestScreen} />
    </WorkoutsStack.Navigator>
  );
}

function AdminNavigator() {
  return (
    <CoachProvider>
      <AdminStack.Navigator screenOptions={{ headerShown: false }}>
        <AdminStack.Screen name="AdminDashboard"     component={AdminDashboard} />
        <AdminStack.Screen name="Challenges"         component={ChallengesScreen} />
        <AdminStack.Screen name="ExerciseGallery"    component={ExerciseGalleryScreen} />
        <AdminStack.Screen name="ExerciseDetail"     component={ExerciseDetailScreen} />
        <AdminStack.Screen name="AddExercise"        component={AddExerciseScreen} />
        <AdminStack.Screen name="AddExampleWorkout"  component={AddExampleWorkoutScreen} />
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

function PlayerTabs() {
  return (
    <Tab.Navigator
      initialRouteName="Home"
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: C.navBg,
          borderTopColor: C.cardBorder,
          borderTopWidth: 1,
          height: 124,
          paddingBottom: 22,
          paddingTop: 16,
        },
        tabBarActiveTintColor: C.iceGlow,
        tabBarInactiveTintColor: C.textMuted,
        tabBarLabelStyle: {
          fontFamily: F.body,
          fontSize: 18,
          letterSpacing: 0.5,
        },
      }}
    >
      <Tab.Screen
        name="Skills"
        component={SkillsNavigator}
        options={{ tabBarIcon: ({ focused }) => <TabIcon label="Skills" focused={focused} /> }}
      />
      <Tab.Screen
        name="Challenges"
        component={ChallengesScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon label="Challenges" focused={focused} /> }}
      />
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          tabBarIcon: ({ focused }) => (
            <Text style={{ fontSize: 42, opacity: focused ? 1 : 0.4 }}>⚔</Text>
          ),
        }}
      />
      <Tab.Screen
        name="Workouts"
        component={WorkoutsNavigator}
        options={{ tabBarIcon: ({ focused }) => <TabIcon label="Workouts" focused={focused} /> }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon label="Profile" focused={focused} /> }}
      />
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
