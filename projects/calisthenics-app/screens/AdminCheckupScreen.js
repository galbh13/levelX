import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, ScrollView, ActivityIndicator, TouchableOpacity, Linking,
} from 'react-native';
import { F } from '../constants/fonts';
import { C } from '../constants/colors';
import { supabase } from '../lib/supabase';
import ScreenFrame from '../components/ScreenFrame';
import ScreenHeader from '../components/ScreenHeader';
import PillButton from '../components/PillButton';
import VideoPlayer from '../components/VideoPlayer';
import CheckupTemplateEditor from '../components/CheckupTemplateEditor';
import {
  purgeExpiredCheckups, WEEKDAYS_SHORT, groupCheckupVideos,
  fetchPlayerTemplateItems, materializePlayerTemplate, resetPlayerTemplate,
} from '../lib/checkups';

const FB_NOTE_MAX = 500;

function formatDate(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ─── Admin review of a player's weekly check-up ─────────────────────────────────
// Reached from PlayerAdminScreen ("CHECK-UP" tile). Three jobs on one screen:
//   1. Set the player's recurring check-up DAY.
//   2. Review their latest SUBMITTED check-up (Part-1 answers + Part-2 exercise
//      clips/notes) and reply with a feedback video URL + note.
//   3. CUSTOMIZE this player's template — override the class standard (materialize
//      the class items onto the player, then trim/edit) or reset back to standard.
// Writes here need the admin-override RLS in migrations/20260714_checkups.sql +
// 20260722_checkup_templates.sql.
export default function AdminCheckupScreen({ navigation, route }) {
  const player = route.params?.player ?? null;

  const [loading, setLoading]   = useState(true);
  const [checkup, setCheckup]   = useState(null);   // latest SUBMITTED check-up
  const [answers, setAnswers]   = useState([]);
  const [videos,  setVideos]    = useState([]);
  const [fbUrl,   setFbUrl]     = useState('');
  const [fbNote,  setFbNote]    = useState('');
  const [saving,  setSaving]    = useState(false);
  const [savedMsg,setSavedMsg]  = useState(false);
  const [errorMsg,setErrorMsg]  = useState('');
  const [checkupDay, setCheckupDay] = useState(null);
  const [savingDay,  setSavingDay]  = useState(false);

  // Per-player template override
  const [hasOverride, setHasOverride] = useState(false);
  const [editorKey,   setEditorKey]   = useState(0);
  const [busyTpl,     setBusyTpl]     = useState(false);

  const load = useCallback(async () => {
    if (!player?.id) { setLoading(false); return; }
    try {
      const { data: prof } = await supabase
        .from('profiles')
        .select('checkup_day')
        .eq('id', player.id)
        .maybeSingle();
      setCheckupDay(prof?.checkup_day ?? null);

      const own = await fetchPlayerTemplateItems(player.id);
      setHasOverride(own.length > 0);

      await purgeExpiredCheckups(player.id);

      const { data: latest } = await supabase
        .from('checkups')
        .select('*')
        .eq('student_id', player.id)
        .not('submitted_at', 'is', null)
        .order('submitted_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latest) {
        const [{ data: ans }, { data: vids }] = await Promise.all([
          supabase.from('checkup_answers').select('*').eq('checkup_id', latest.id).order('order_index', { ascending: true }),
          supabase.from('checkup_videos').select('*').eq('checkup_id', latest.id).order('order_index', { ascending: true }),
        ]);
        setCheckup(latest);
        setAnswers(ans ?? []);
        setVideos(vids ?? []);
        setFbUrl(latest.feedback_url ?? '');
        setFbNote(latest.feedback_note ?? '');
      } else {
        setCheckup(null);
      }
    } catch (e) {
      console.error('[AdminCheckupScreen] load:', e);
    }
    setLoading(false);
  }, [player]);

  useEffect(() => { load(); }, [load]);

  async function handleSave() {
    setErrorMsg(''); setSavedMsg(false);
    if (!fbUrl.trim() && !fbNote.trim()) {
      setErrorMsg('Add a feedback video URL or a note.');
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase
        .from('checkups')
        .update({
          feedback_url:  fbUrl.trim() || null,
          feedback_note: fbNote.trim() || null,
          feedback_at:   new Date().toISOString(),
        })
        .eq('id', checkup.id)
        .select()
        .single();
      if (error) throw error;
      setCheckup(data);
      setSavedMsg(true);
    } catch (e) {
      setErrorMsg(e.message ?? 'Could not save feedback.');
    }
    setSaving(false);
  }

  async function setDay(day) {
    if (savingDay || !player?.id) return;
    const next = day === checkupDay ? null : day;
    setSavingDay(true);
    setCheckupDay(next);
    try {
      const { error } = await supabase.from('profiles').update({ checkup_day: next }).eq('id', player.id);
      if (error) throw error;
    } catch (e) {
      console.error('[AdminCheckupScreen] setDay:', e);
      setCheckupDay(checkupDay);
    }
    setSavingDay(false);
  }

  async function customize() {
    if (busyTpl || !player?.id) return;
    setBusyTpl(true);
    try {
      await materializePlayerTemplate(player.id, player.class_id ?? null);
      setHasOverride(true);
      setEditorKey(k => k + 1);
    } catch (e) {
      console.error('[AdminCheckupScreen] customize:', e);
    }
    setBusyTpl(false);
  }

  async function resetToStandard() {
    if (busyTpl || !player?.id) return;
    setBusyTpl(true);
    try {
      await resetPlayerTemplate(player.id);
      setHasOverride(false);
      setEditorKey(k => k + 1);
    } catch (e) {
      console.error('[AdminCheckupScreen] resetToStandard:', e);
    }
    setBusyTpl(false);
  }

  const hasFeedback = !!checkup?.feedback_at;

  return (
    <ScreenFrame fill maxWidth={640} ready={!loading}>
      <View style={styles.card}>
        <ScreenHeader
          title="CHECK-UP"
          subtitle={player?.full_name || '(no name)'}
          onBack={() => navigation.goBack()}
        />

        {loading ? (
          <View style={styles.center}><ActivityIndicator size="large" color={C.iceGlow} /></View>
        ) : (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {checkup && (
            <View style={styles.submitBanner}>
              <Text style={styles.submitBannerText}>
                ✓  SUBMITTED {formatDate(checkup.submitted_at).toUpperCase()}
              </Text>
              {hasFeedback && <Text style={styles.submitBannerDone}>★ FEEDBACK SENT</Text>}
            </View>
          )}

          {/* Recurring check-up day */}
          <SectionTitle>CHECK-UP DAY</SectionTitle>
          <View style={styles.dayRow}>
            {WEEKDAYS_SHORT.map((d, i) => {
              const active = i === checkupDay;
              return (
                <TouchableOpacity
                  key={d}
                  disabled={savingDay}
                  onPress={() => setDay(i)}
                  style={[styles.dayPill, active && styles.dayPillActive]}
                >
                  <Text style={[styles.dayPillText, active && styles.dayPillTextActive]}>{d}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* ── Review ── */}
          {!checkup ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyIcon}>◇</Text>
              <Text style={styles.emptyText}>This player hasn't submitted a check-up yet.</Text>
            </View>
          ) : (
            <>
              {answers.length > 0 && (
                <>
                  <SectionTitle>THEIR ANSWERS</SectionTitle>
                  {answers.map(a => (
                    <View key={a.id} style={styles.qBlock}>
                      <Text style={styles.qPrompt}>{a.prompt}</Text>
                      <View style={styles.notePanel}>
                        <Text style={styles.notePanelText}>{a.answer_text || '—'}</Text>
                      </View>
                    </View>
                  ))}
                </>
              )}

              {videos.length > 0 && (
                <>
                  <SectionTitle>THEIR EXERCISES</SectionTitle>
                  {groupCheckupVideos(videos).map(g => (
                    <View key={g.key} style={styles.clipCard}>
                      {!!g.prompt && (
                        <Text style={styles.clipName}>
                          {g.prompt}{g.videos.length > 1 ? `  ·  ${g.videos.length} CLIPS` : ''}
                        </Text>
                      )}
                      {g.videos.map((v, i) => (
                        <View key={v.id} style={i > 0 ? { marginTop: 16 } : undefined}>
                          <VideoPlayer url={v.video_url} height={220} style={{ marginTop: 10 }} />
                          <TouchableOpacity onPress={() => Linking.openURL(v.video_url)}>
                            <Text style={styles.openLink}>⤓  OPEN / DOWNLOAD CLIP</Text>
                          </TouchableOpacity>
                        </View>
                      ))}
                      {!!g.note && (
                        <View style={styles.notePanel}>
                          <Text style={styles.notePanelText}>{g.note}</Text>
                        </View>
                      )}
                    </View>
                  ))}
                </>
              )}
              {answers.length === 0 && videos.length === 0 && (
                <Text style={styles.hint}>This check-up has no answers or clips.</Text>
              )}

              {/* Feedback form */}
              <View style={styles.feedbackBlock}>
                <SectionTitle>YOUR FEEDBACK</SectionTitle>

                <Text style={styles.fieldLabel}>FEEDBACK VIDEO URL</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Paste a link to the feedback clip you recorded…"
                  placeholderTextColor={C.textMuted}
                  value={fbUrl}
                  onChangeText={setFbUrl}
                  autoCapitalize="none"
                  autoCorrect={false}
                />

                <View style={styles.labelRow}>
                  <Text style={styles.fieldLabel}>NOTE (OPTIONAL)</Text>
                  <Text style={styles.counter}>{fbNote.length}/{FB_NOTE_MAX}</Text>
                </View>
                <TextInput
                  style={[styles.input, styles.multiline]}
                  placeholder="A few words alongside the video…"
                  placeholderTextColor={C.textMuted}
                  value={fbNote}
                  onChangeText={setFbNote}
                  maxLength={FB_NOTE_MAX}
                  multiline
                  textAlignVertical="top"
                />

                {!!errorMsg && (
                  <View style={styles.errorBox}><Text style={styles.errorText}>⚠  {errorMsg}</Text></View>
                )}
                {savedMsg && (
                  <View style={styles.savedBox}><Text style={styles.savedText}>✓  FEEDBACK SAVED</Text></View>
                )}

                <PillButton
                  label={saving ? 'SAVING…' : hasFeedback ? 'UPDATE FEEDBACK' : 'SEND FEEDBACK'}
                  onPress={handleSave}
                  loading={saving}
                  variant="solid"
                  tone="green"
                  size="lg"
                  style={{ marginTop: 22 }}
                />
              </View>
            </>
          )}

          {/* ── Customize this player's template ── */}
          <View style={styles.customizeBlock}>
            <View style={styles.customizeHead}>
              <SectionTitle>THIS PLAYER'S CHECK-UP</SectionTitle>
              <View style={[styles.scopeChip, hasOverride ? styles.scopeChipCustom : styles.scopeChipStd]}>
                <Text style={[styles.scopeChipText, hasOverride ? styles.scopeChipTextCustom : styles.scopeChipTextStd]}>
                  {hasOverride ? 'CUSTOM' : 'CLASS STANDARD'}
                </Text>
              </View>
            </View>

            {hasOverride ? (
              <>
                <Text style={styles.customizeHint}>
                  This player has a custom check-up. Edit it below, or reset to use their class
                  standard again.
                </Text>
                <CheckupTemplateEditor key={editorKey} scope={{ playerId: player.id }} />
                <PillButton
                  label={busyTpl ? 'RESETTING…' : '↺  RESET TO CLASS STANDARD'}
                  onPress={resetToStandard}
                  loading={busyTpl}
                  tone="danger"
                  size="sm"
                  style={{ alignSelf: 'flex-start', marginTop: 20 }}
                />
              </>
            ) : (
              <>
                <Text style={styles.customizeHint}>
                  This player uses their class-standard check-up. Customize to add or remove
                  questions/exercises just for them (e.g. skip a movement they've already mastered).
                </Text>
                <PillButton
                  label={busyTpl ? 'PREPARING…' : '✎  CUSTOMIZE FOR THIS PLAYER'}
                  onPress={customize}
                  loading={busyTpl}
                  variant="solid"
                  tone="accent"
                  size="md"
                  style={{ alignSelf: 'flex-start', marginTop: 4 }}
                />
              </>
            )}
          </View>
        </ScrollView>
        )}
      </View>
    </ScreenFrame>
  );
}

function SectionTitle({ children }) {
  return (
    <View style={styles.sectionHead}>
      <View style={styles.sectionBar} />
      <Text style={styles.sectionTitle}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1 },
  scroll: { flex: 1 },
  body: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 48 },
  center: { flex: 1, paddingVertical: 80, alignItems: 'center', justifyContent: 'center' },

  emptyBox: { alignItems: 'center', paddingVertical: 50, gap: 16 },
  emptyIcon: { fontSize: 44, color: C.textMuted },
  emptyText: {
    fontFamily: F.bodyMed, fontSize: 16, color: C.textMuted,
    letterSpacing: 1, textAlign: 'center', maxWidth: 300, lineHeight: 24,
  },

  submitBanner: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderWidth: 1.5, borderColor: C.iceGlow, backgroundColor: 'rgba(74,158,191,0.12)',
    borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16, marginBottom: 22,
  },
  submitBannerText: {
    fontFamily: F.heading, fontSize: 15, color: C.iceGlow, letterSpacing: 1.5,
    textShadowColor: 'rgba(74,158,191,0.7)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 10,
  },
  submitBannerDone: { fontFamily: F.heading, fontSize: 13, color: '#7DD88A', letterSpacing: 1.5 },

  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14, marginTop: 8 },
  sectionBar: {
    width: 5, height: 22, borderRadius: 2, backgroundColor: C.iceGlow,
    shadowColor: C.iceGlow, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.9, shadowRadius: 6,
  },
  sectionTitle: { fontFamily: F.heading, fontSize: 19, color: C.iceGlow, letterSpacing: 3 },

  dayRow: { flexDirection: 'row', gap: 6, marginBottom: 20 },
  dayPill: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 12, borderRadius: 999,
    borderWidth: 1.5, borderColor: C.lockedBorder, backgroundColor: C.surface,
  },
  dayPillActive: {
    borderColor: C.iceGlow, backgroundColor: 'rgba(74,158,191,0.16)',
    shadowColor: C.iceGlow, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 8,
  },
  dayPillText: { fontFamily: F.heading, fontSize: 12, color: C.textMuted, letterSpacing: 0.5 },
  dayPillTextActive: {
    color: C.text,
    textShadowColor: 'rgba(74,158,191,0.7)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 8,
  },

  qBlock: { marginBottom: 16 },
  qPrompt: { fontFamily: F.bodyMed, fontSize: 16, color: C.text, lineHeight: 22, letterSpacing: 0.2, marginBottom: 8 },

  clipCard: {
    backgroundColor: C.surface,
    borderWidth: 1.5, borderColor: C.lockedBorder, borderRadius: 14,
    padding: 12, marginBottom: 14,
  },
  clipName: { fontFamily: F.heading, fontSize: 16, color: C.text, letterSpacing: 1 },
  hint: { fontFamily: F.bodyMed, fontSize: 14, color: C.textMuted, letterSpacing: 0.5, marginBottom: 6 },
  openLink: {
    fontFamily: F.heading, fontSize: 13, color: C.iceGlow, letterSpacing: 2,
    marginTop: 12, marginBottom: 2,
  },

  notePanel: {
    backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.lockedBorder, borderRadius: 12,
    padding: 14, marginTop: 8,
  },
  notePanelText: { fontFamily: F.body, fontSize: 15, color: C.text, lineHeight: 22, letterSpacing: 0.3 },

  feedbackBlock: {
    marginTop: 22, paddingTop: 8,
    borderTopWidth: 1, borderTopColor: C.cardBorder,
  },
  fieldLabel: {
    fontFamily: F.bodyMed, fontSize: 14, color: C.text,
    letterSpacing: 2, textTransform: 'uppercase', marginBottom: 9, marginTop: 6,
  },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  counter: { fontFamily: F.bodyMed, fontSize: 13, color: C.textMuted, letterSpacing: 1, marginBottom: 9 },
  input: {
    backgroundColor: C.bg, borderWidth: 1.5, borderColor: C.cardBorder, borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 15, fontFamily: F.body, fontSize: 16, color: C.text,
  },
  multiline: { minHeight: 110, paddingTop: 14, lineHeight: 24 },

  errorBox: {
    marginTop: 18, backgroundColor: 'rgba(255,60,60,0.12)',
    borderWidth: 1.5, borderColor: '#FF4444', borderRadius: 10, padding: 14,
  },
  errorText: { fontFamily: F.bodyMed, fontSize: 14, color: '#FF6B6B', letterSpacing: 0.4, lineHeight: 20 },
  savedBox: {
    marginTop: 18, backgroundColor: 'rgba(76,175,80,0.12)',
    borderWidth: 1.5, borderColor: '#4CAF50', borderRadius: 10, padding: 14, alignItems: 'center',
  },
  savedText: { fontFamily: F.heading, fontSize: 14, color: '#7DD88A', letterSpacing: 2 },

  // Customize block
  customizeBlock: {
    marginTop: 30, paddingTop: 20,
    borderTopWidth: 1, borderTopColor: C.cardBorder,
  },
  customizeHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  scopeChip: { borderWidth: 1.5, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  scopeChipStd: { borderColor: C.lockedBorder, backgroundColor: C.surface },
  scopeChipCustom: { borderColor: '#C79A3A', backgroundColor: 'rgba(199,154,58,0.12)' },
  scopeChipText: { fontFamily: F.heading, fontSize: 11, letterSpacing: 1.5 },
  scopeChipTextStd: { color: C.textMuted },
  scopeChipTextCustom: { color: '#E0B858' },
  customizeHint: {
    fontFamily: F.bodyMed, fontSize: 14, color: C.textMuted,
    letterSpacing: 0.4, lineHeight: 20, marginBottom: 18, marginTop: 6,
  },
});
