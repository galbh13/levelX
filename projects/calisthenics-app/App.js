import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
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
import CommunityScreen   from './screens/CommunityScreen';
import ChatScreen        from './screens/ChatScreen';
import LoginScreen           from './screens/LoginScreen';
import AdminDashboard        from './screens/AdminDashboard';
import CoachDashboard        from './screens/CoachDashboard';
import StudentDetailScreen   from './screens/StudentDetailScreen';
import WorkoutDetailScreen   from './screens/WorkoutDetailScreen';
import AddWorkoutScreen      from './screens/AddWorkoutScreen';
import ExerciseGalleryScreen from './screens/ExerciseGalleryScreen';
import ExerciseDetailScreen  from './screens/ExerciseDetailScreen';
import AddExerciseScreen     from './screens/AddExerciseScreen';
import CreateWorkoutScreen   from './screens/CreateWorkoutScreen';
import WorkoutEditScreen       from './screens/WorkoutEditScreen';
import AllWorkoutsScreen       from './screens/AllWorkoutsScreen';
import CheckupBuilderScreen    from './screens/CheckupBuilderScreen';
import CheckupScreen           from './screens/CheckupScreen';
import CheckupReviewScreen     from './screens/CheckupReviewScreen';
import CoachResponseScreen     from './screens/CoachResponseScreen';
import ClassQuestScreen        from './screens/ClassQuestScreen';
import { CoachProvider }       from './context/CoachContext';

SplashScreen.preventAutoHideAsync();

const Tab           = createBottomTabNavigator();
const SkillsStack   = createNativeStackNavigator();
const WorkoutsStack = createNativeStackNavigator();
const CoachStack    = createNativeStackNavigator();
const AdminStack    = createNativeStackNavigator();

function TabIcon({ label, focused }) {
  const icons = { Skills: '⚡', Chat: '💬', Workouts: '🏋', Community: '👥' };
  return (
    <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.4 }}>{icons[label]}</Text>
  );
}

function SkillsNavigator() {
  return (
    <SkillsStack.Navigator screenOptions={{ headerShown: false }}>
      <SkillsStack.Screen name="SkillsList" component={SkillsScreen} />
      <SkillsStack.Screen name="SkillTree"  component={SkillTreeScreen} />
    </SkillsStack.Navigator>
  );
}

function WorkoutsNavigator() {
  return (
    <WorkoutsStack.Navigator screenOptions={{ headerShown: false }}>
      <WorkoutsStack.Screen name="WorkoutsList"  component={WorkoutsScreen} />
      <WorkoutsStack.Screen name="WorkoutDetail"   component={WorkoutDetailScreen} />
      <WorkoutsStack.Screen name="Checkup"         component={CheckupScreen} />
      <WorkoutsStack.Screen name="CoachResponse"   component={CoachResponseScreen} />
    </WorkoutsStack.Navigator>
  );
}

function CoachNavigator() {
  return (
    <CoachProvider>
      <CoachStack.Navigator screenOptions={{ headerShown: false }}>
        <CoachStack.Screen name="CoachDashboard"   component={CoachDashboard} />
        <CoachStack.Screen name="StudentDetail"    component={StudentDetailScreen} />
        <CoachStack.Screen name="WorkoutDetail"    component={WorkoutDetailScreen} />
        <CoachStack.Screen name="WorkoutEdit"      component={WorkoutEditScreen} />
        <CoachStack.Screen name="AddWorkout"       component={AddWorkoutScreen} />
        <CoachStack.Screen name="CreateWorkout"    component={CreateWorkoutScreen} />
        <CoachStack.Screen name="ExerciseGallery"  component={ExerciseGalleryScreen} />
        <CoachStack.Screen name="ExerciseDetail"   component={ExerciseDetailScreen} />
        <CoachStack.Screen name="AddExercise"      component={AddExerciseScreen} />
        <CoachStack.Screen name="AllWorkouts"      component={AllWorkoutsScreen} />
        <CoachStack.Screen name="CheckupBuilder"  component={CheckupBuilderScreen} />
        <CoachStack.Screen name="CheckupReview"   component={CheckupReviewScreen} />
        <CoachStack.Screen name="ClassQuest"      component={ClassQuestScreen} />
      </CoachStack.Navigator>
    </CoachProvider>
  );
}

function AdminNavigator() {
  return (
    <AdminStack.Navigator screenOptions={{ headerShown: false }}>
      <AdminStack.Screen name="AdminDashboard"  component={AdminDashboard} />
      <AdminStack.Screen name="ExerciseGallery" component={ExerciseGalleryScreen} />
      <AdminStack.Screen name="ExerciseDetail"  component={ExerciseDetailScreen} />
      <AdminStack.Screen name="AddExercise"     component={AddExerciseScreen} />
    </AdminStack.Navigator>
  );
}

function StudentApp() {
  return (
    <Tab.Navigator
      initialRouteName="Home"
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: C.navBg,
          borderTopColor: C.cardBorder,
          borderTopWidth: 1,
          height: 64,
          paddingBottom: 10,
          paddingTop: 8,
        },
        tabBarActiveTintColor: C.iceGlow,
        tabBarInactiveTintColor: C.textMuted,
        tabBarLabelStyle: {
          fontFamily: F.body,
          fontSize: 10,
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
        name="Chat"
        component={ChatScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon label="Chat" focused={focused} /> }}
      />
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          tabBarIcon: ({ focused }) => (
            <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.4 }}>⚔</Text>
          ),
        }}
      />
      <Tab.Screen
        name="Workouts"
        component={WorkoutsNavigator}
        options={{ tabBarIcon: ({ focused }) => <TabIcon label="Workouts" focused={focused} /> }}
      />
      <Tab.Screen
        name="Community"
        component={CommunityScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon label="Community" focused={focused} /> }}
      />
    </Tab.Navigator>
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

  // Listen to auth state changes
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) fetchRole(session.user.id);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) fetchRole(session.user.id);
      else         setRole(null);
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
      <NavigationContainer onReady={onReady}>
        <LoginScreen />
      </NavigationContainer>
    );
  }

  // Logged in — route by role (wait for role to load)
  if (!role) {
    return <View style={{ flex: 1, backgroundColor: C.bg }} />;
  }

  return (
    <NavigationContainer onReady={onReady}>
      {role === 'admin'   && <AdminNavigator />}
      {role === 'coach'   && <CoachNavigator />}
      {role === 'student' && <StudentApp />}
    </NavigationContainer>
  );
}
