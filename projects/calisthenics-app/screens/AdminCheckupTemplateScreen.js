import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { F } from '../constants/fonts';
import { C } from '../constants/colors';
import { CARD_W } from '../constants/layout';
import { supabase } from '../lib/supabase';
import { jobLabel } from '../lib/jobs';
import ScreenFrame from '../components/ScreenFrame';
import ScreenHeader from '../components/ScreenHeader';
import PillButton from '../components/PillButton';
import CheckupTemplateEditor from '../components/CheckupTemplateEditor';
import { applyQuestionsToAllClasses } from '../lib/checkups';

// ─── Admin — class-standard check-up template builder ───────────────────────────
// Reached from the CHECKUP button on the AdminDashboard top bar. The admin picks a
// class (across every job) and authors that class's STANDARD check-up: Part 1
// questions + Part 2 exercises. Every player in the class inherits it; per-player
// tweaks happen on AdminCheckupScreen. Writes need the admin RLS in
// `migrations/20260722_checkup_templates.sql`.
export default function AdminCheckupTemplateScreen({ navigation }) {
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [classId, setClassId] = useState(null);
  const [applying, setApplying] = useState(false);
  const [appliedMsg, setAppliedMsg] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase
          .from('classes')
          .select('id, name, order_index, job')
          .order('job', { ascending: true })
          .order('order_index', { ascending: true });
        const rows = data ?? [];
        setClasses(rows);
        setClassId(prev => prev ?? rows[0]?.id ?? null);
      } catch (e) {
        console.error('[AdminCheckupTemplateScreen] load classes:', e);
      }
      setLoading(false);
    })();
  }, []);

  const selected = useMemo(() => classes.find(c => c.id === classId), [classes, classId]);

  async function applyToAll() {
    if (applying || !classId) return;
    setApplying(true);
    setAppliedMsg('');
    try {
      const n = await applyQuestionsToAllClasses(classId);
      setAppliedMsg(`Questions applied to ${n} other class${n === 1 ? '' : 'es'}.`);
    } catch (e) {
      console.error('[AdminCheckupTemplateScreen] applyToAll:', e);
      setAppliedMsg('Could not apply — try again.');
    }
    setApplying(false);
  }

  return (
    <ScreenFrame fill maxWidth={CARD_W} ready={!loading}>
      <View style={styles.card}>
        <ScreenHeader title="CHECK-UP TEMPLATES" onBack={() => navigation.goBack()} />

        {loading ? (
          <View style={styles.center}><ActivityIndicator size="large" color={C.iceGlow} /></View>
        ) : (
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.body}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.intro}>
              Build the standard check-up each class fills in. Every player in a class inherits
              it — tweak a single player from their Manage · Check-up screen.
            </Text>

            {/* Class picker */}
            <Text style={styles.pickerLabel}>CLASS</Text>
            <View style={styles.pickerRow}>
              {classes.map(c => {
                const active = c.id === classId;
                return (
                  <TouchableOpacity
                    key={c.id}
                    onPress={() => { setClassId(c.id); setAppliedMsg(''); }}
                    style={[styles.classPill, active && styles.classPillActive]}
                  >
                    <Text style={[styles.classJob, active && styles.classJobActive]}>{jobLabel(c.job)}</Text>
                    <Text style={[styles.className, active && styles.classNameActive]}>{c.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {classes.length === 0 ? (
              <Text style={styles.emptyLine}>No classes found.</Text>
            ) : (
              <View style={styles.editorWrap}>
                <Text style={styles.editingFor}>
                  EDITING · {jobLabel(selected?.job)} · {selected?.name}
                </Text>
                {/* key forces a fresh editor (reload + closed form) per class */}
                <CheckupTemplateEditor key={classId} scope={{ classId }} />

                {/* Questions are universal — make this class's Part-1 the default
                    every class starts with (exercises stay per-class). */}
                {classes.length > 1 && (
                  <View style={styles.applyBlock}>
                    <Text style={styles.applyHint}>
                      Use these PART 1 questions as the default for every class (each class keeps
                      its own exercises; per-player tweaks stay).
                    </Text>
                    <PillButton
                      label={applying ? 'APPLYING…' : '★  SET QUESTIONS AS DEFAULT FOR ALL CLASSES'}
                      onPress={applyToAll}
                      loading={applying}
                      tone="gold"
                      size="sm"
                      style={{ alignSelf: 'flex-start' }}
                    />
                    {!!appliedMsg && <Text style={styles.appliedMsg}>✓  {appliedMsg}</Text>}
                  </View>
                )}
              </View>
            )}
          </ScrollView>
        )}
      </View>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 80 },
  scroll: { flex: 1 },
  body: { paddingHorizontal: 22, paddingTop: 12, paddingBottom: 48 },

  intro: {
    fontFamily: F.body, fontSize: 15, color: C.text, opacity: 0.85,
    lineHeight: 22, letterSpacing: 0.3, marginBottom: 22,
  },

  pickerLabel: {
    fontFamily: F.bodyMed, fontSize: 13, color: C.textMuted,
    letterSpacing: 2.5, textTransform: 'uppercase', marginBottom: 10,
  },
  pickerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 24 },
  classPill: {
    borderWidth: 1.5, borderColor: C.lockedBorder, backgroundColor: C.surface,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8, minWidth: 96,
  },
  classPillActive: {
    borderColor: C.iceGlow, backgroundColor: 'rgba(74,158,191,0.14)',
    shadowColor: C.iceGlow, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 8,
  },
  classJob: { fontFamily: F.heading, fontSize: 10, color: C.textMuted, letterSpacing: 1.5 },
  classJobActive: { color: C.iceGlow },
  className: { fontFamily: F.heading, fontSize: 15, color: C.textMuted, letterSpacing: 1, marginTop: 2 },
  classNameActive: { color: C.text },

  editorWrap: {
    borderTopWidth: 1, borderTopColor: C.cardBorder, paddingTop: 20,
  },
  editingFor: {
    fontFamily: F.heading, fontSize: 13, color: C.iceGlow, letterSpacing: 2, marginBottom: 18,
  },

  applyBlock: {
    marginTop: 28, paddingTop: 20,
    borderTopWidth: 1, borderTopColor: C.cardBorder, gap: 14,
  },
  applyHint: {
    fontFamily: F.bodyMed, fontSize: 13, color: C.textMuted,
    letterSpacing: 0.4, lineHeight: 19,
  },
  appliedMsg: { fontFamily: F.heading, fontSize: 13, color: '#E0B858', letterSpacing: 1 },
  emptyLine: { fontFamily: F.bodyMed, fontSize: 14, color: C.textMuted, letterSpacing: 0.5 },
});
