import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator,
} from 'react-native';
import { F } from '../constants/fonts';
import { C } from '../constants/colors';
import { CARD_H, CARD_W } from '../constants/layout';
import ScreenFrame from '../components/ScreenFrame';
import ScreenHeader from '../components/ScreenHeader';
import { supabase } from '../lib/supabase';
import { latestCoachMessage } from '../lib/community';
import { useTourTarget } from '../lib/tourTargets';

// The System accent — purple.
const SYSTEM_PURPLE = '#A66BFF';
// Coach accent — emerald jade. A cool 'guide/mentor' green.
const COACH_JADE = '#1FD79A';

// ─── Personal tab (player) ──────────────────────────────────────────────────
// The player's private space: a direct line to the coach, and The System
// (placeholder until that feature lands). The community/groups idea was dropped
// (2026-08-23) — that conversation happens outside the app.
export default function PersonalScreen({ navigation }) {
  const [meId, setMeId] = useState(null);
  const [coachPreview, setCoachPreview] = useState(null); // newest coach-chat message (or null)
  const [loading, setLoading] = useState(true);
  const loadedRef = useRef(false);
  // Elements the guided tour measures + points its arrow at.
  const tourCoachRef  = useTourTarget('personal.coach');
  const tourSystemRef = useTourTarget('personal.system');

  const load = useCallback(async () => {
    if (!loadedRef.current) setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const me = user?.id ?? null;
      setMeId(me);
      setCoachPreview(me ? await latestCoachMessage(me) : null);
    } catch (e) {
      console.error('[PersonalScreen] load:', e);
    }
    loadedRef.current = true;
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => {
    if (loadedRef.current) load();
  }, [load]));

  return (
    <ScreenFrame maxWidth={CARD_W} ready={!loading}>
      <View style={styles.card}>
        <ScreenHeader title="PERSONAL" subtitle="YOUR SPACE" />

        <View style={styles.body}>
          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={C.deepBlue} />
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
              {/* The coach is pinned at the top — the direct line, always there. */}
              <View ref={tourCoachRef}>
                <CoachCard
                  preview={coachPreview}
                  meId={meId}
                  onPress={() => navigation.navigate('CoachChat')}
                />
              </View>

              {/* The System — purple accent. Placeholder page for now. */}
              <Pressable
                ref={tourSystemRef}
                style={styles.systemCard}
                onPress={() => navigation.navigate('System')}
              >
                <View style={styles.systemHandle} />
                <View style={styles.cardText}>
                  <Text style={styles.systemName}>THE SYSTEM</Text>
                  <Text style={styles.systemHint} numberOfLines={1}>Coming soon</Text>
                </View>
                <Text style={styles.systemChevron}>›</Text>
              </Pressable>
            </ScrollView>
          )}
        </View>
      </View>
    </ScreenFrame>
  );
}

// ─── Coach card ─────────────────────────────────────────────────────────────
// Shows a preview of the newest message (or a prompt when the chat is empty).
function CoachCard({ preview, meId, onPress }) {
  const previewText = preview
    ? `${preview.sender_id === meId ? 'You' : 'COACH'}: ${preview.body}`
    : 'Message your coach directly.';
  return (
    <Pressable onPress={onPress} style={styles.coachCard}>
      <View style={styles.coachHandle} />
      <View style={styles.cardText}>
        <Text style={styles.coachName}>COACH</Text>
        <Text style={styles.coachPreview} numberOfLines={1}>{previewText}</Text>
      </View>
      <Text style={styles.coachChevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { height: CARD_H },
  body: { flex: 1, paddingHorizontal: 24, paddingTop: 18, paddingBottom: 26 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 14 },

  // Coach card — emerald-jade accent, pinned at the top of the list.
  coachCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(31,215,154,0.45)',
    backgroundColor: C.surface,
    paddingVertical: 20,
    paddingLeft: 20,
    paddingRight: 18,
    gap: 18,
    marginBottom: 14,
    shadowColor: COACH_JADE, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.22, shadowRadius: 12,
  },
  coachHandle: {
    width: 4, height: 40, borderRadius: 2,
    backgroundColor: COACH_JADE,
    shadowColor: COACH_JADE, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 8,
  },
  coachName: {
    fontFamily: F.heading, fontSize: 22, color: COACH_JADE,
    letterSpacing: 2, textTransform: 'uppercase',
    textShadowColor: 'rgba(31,215,154,0.45)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 12,
  },
  coachPreview: {
    fontFamily: F.bodyMed, fontSize: 14, color: '#5a7a9a', letterSpacing: 0.4,
  },
  coachChevron: { fontFamily: F.heading, fontSize: 28, color: COACH_JADE, marginLeft: 2 },

  // The System card — purple accent. Placeholder for now.
  systemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(166,107,255,0.45)',
    backgroundColor: C.surface,
    paddingVertical: 20,
    paddingLeft: 20,
    paddingRight: 18,
    gap: 18,
    marginBottom: 14,
    shadowColor: SYSTEM_PURPLE, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.2, shadowRadius: 12,
  },
  systemHandle: {
    width: 4, height: 40, borderRadius: 2,
    backgroundColor: SYSTEM_PURPLE,
    shadowColor: SYSTEM_PURPLE, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.75, shadowRadius: 8,
  },
  systemName: {
    fontFamily: F.heading, fontSize: 22, color: SYSTEM_PURPLE,
    letterSpacing: 2, textTransform: 'uppercase',
    textShadowColor: 'rgba(166,107,255,0.4)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 12,
  },
  systemHint: {
    fontFamily: F.bodyMed, fontSize: 14, color: '#8a7ab0', letterSpacing: 0.4,
  },
  systemChevron: { fontFamily: F.heading, fontSize: 28, color: SYSTEM_PURPLE, marginLeft: 2 },

  cardText: { flex: 1, gap: 6 },
});
