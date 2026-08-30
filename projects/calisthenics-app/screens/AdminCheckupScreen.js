import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, ScrollView, ActivityIndicator, TouchableOpacity, Linking,
  Platform,
} from 'react-native';
import { F } from '../constants/fonts';
import { C } from '../constants/colors';
import { supabase } from '../lib/supabase';
import ScreenFrame from '../components/ScreenFrame';
import ScreenHeader from '../components/ScreenHeader';
import PillButton from '../components/PillButton';
import VideoPlayer from '../components/VideoPlayer';
import CheckupTemplateEditor from '../components/CheckupTemplateEditor';
import SystemConfirm from '../components/SystemConfirm';
import {
  purgeExpiredCheckups, WEEKDAYS_SHORT, resetPlayerTemplate,
  splitCheckupAnswers, buildExerciseCards,
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
//   3. THIS PLAYER'S CHECK-UP — the one list they actually fill in, edited in
//      place. It shows the class standard until something is changed here; the
//      first change forks it onto the player (see CheckupTemplateEditor), so a
//      personal tweak is just an edit + save, never a second structure on the page.
// Writes here need the admin-override RLS in migrations/20260714_checkups.sql +
// 20260722_checkup_templates.sql.
export default function AdminCheckupScreen({ navigation, route }) {
  const player = route.params?.player ?? null;

  const [loading, setLoading]   = useState(true);
  const [checkup, setCheckup]   = useState(null);   // latest SUBMITTED check-up
  const [answers, setAnswers]   = useState([]);
  const [exNotes, setExNotes]   = useState([]);   // Part-2 notes, clip or no clip
  const [videos,  setVideos]    = useState([]);
  // One card per exercise: the clips grouped, plus any exercise that only carries
  // a note (the player couldn't film it but explained why).
  const exerciseCards = useMemo(() => buildExerciseCards(videos, exNotes), [videos, exNotes]);

  const [fbUrl,   setFbUrl]     = useState('');
  const [fbNote,  setFbNote]    = useState('');
  const [saving,  setSaving]    = useState(false);
  const [savedMsg,setSavedMsg]  = useState(false);
  const [errorMsg,setErrorMsg]  = useState('');
  const [checkupDay, setCheckupDay] = useState(null);
  const [savingDay,  setSavingDay]  = useState(false);

  // This player's check-up list: 'class' = still the inherited standard,
  // 'player' = personalised for them, 'none' = nothing authored anywhere yet.
  const [tplSource, setTplSource] = useState('class');
  const [classId,   setClassId]   = useState(player?.class_id ?? null);
  const [editorKey, setEditorKey] = useState(0);
  const [busyTpl,   setBusyTpl]   = useState(false);
  const [confirm,   setConfirm]   = useState(null);
  // The template section is READ-ONLY until the coach asks to edit it: he screen-
  // records himself going over a player's check-up, and admin controls in that
  // recording look unprofessional to the player watching it.
  const [tplEditing, setTplEditing] = useState(false);
  const [fbFocus,    setFbFocus]    = useState(null);   // 'url' | 'note' | null
  const onSourceChange = useCallback(src => setTplSource(src), []);
  const hasOverride = tplSource === 'player';

  const load = useCallback(async () => {
    if (!player?.id) { setLoading(false); return; }
    try {
      const { data: prof } = await supabase
        .from('profiles')
        .select('checkup_day, class_id')
        .eq('id', player.id)
        .maybeSingle();
      setCheckupDay(prof?.checkup_day ?? null);
      // The profile is the authority on the class (the roster row can be stale) —
      // the editor needs it to know which standard this player inherits.
      setClassId(prof?.class_id ?? player.class_id ?? null);

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
        {
          // Part-2 notes are stored as answer rows too (see splitCheckupAnswers),
          // so an exercise the player wrote about but couldn't film still reaches
          // the coach.
          const split = splitCheckupAnswers(ans ?? []);
          setAnswers(split.questionRows);
          setExNotes(split.exerciseNotes);
        }
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

  // Drop this player's personal list → they inherit their class standard again.
  // Destructive (their tailored questions/exercises are deleted), so it asks first.
  function askReset() {
    if (busyTpl || !player?.id) return;
    setConfirm({
      title: 'BACK TO CLASS STANDARD',
      message: "This player's personal questions and exercises will be deleted and they'll fill in their class standard again.",
      confirmLabel: '↺  BACK TO STANDARD',
      tone: 'danger',
      onConfirm: resetToStandard,
    });
  }

  async function resetToStandard() {
    if (busyTpl || !player?.id) return;
    setBusyTpl(true);
    try {
      await resetPlayerTemplate(player.id);
      setTplSource('class');
      setEditorKey(k => k + 1);
    } catch (e) {
      console.error('[AdminCheckupScreen] resetToStandard:', e);
    }
    setBusyTpl(false);
  }

  const hasFeedback = !!checkup?.feedback_at;

  return (
    <ScreenFrame fill ready={!loading}>
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

              {exerciseCards.length > 0 && (
                <>
                  <SectionTitle>THEIR EXERCISES</SectionTitle>
                  {exerciseCards.map((g, gi, all) => (
                    <View key={g.key} style={styles.clipCard}>
                      {/* One exercise = one hard-edged card: numbered, accent-railed
                          and spaced, so a wall of clips reads as N exercises. */}
                      <View style={styles.clipHead}>
                        <Text style={styles.clipIndex}>EXERCISE {gi + 1} / {all.length}</Text>
                        {g.videos.length > 1 && (
                          <Text style={styles.clipCount}>{g.videos.length} CLIPS</Text>
                        )}
                        {g.videos.length === 0 && (
                          <Text style={styles.clipNoClip}>NO CLIP · NOTE ONLY</Text>
                        )}
                      </View>
                      {!!g.prompt && <Text style={styles.clipName}>{g.prompt}</Text>}
                      {g.videos.map((v, i) => (
                        <View key={v.id} style={i > 0 ? styles.clipSplit : undefined}>
                          {g.videos.length > 1 && (
                            <Text style={styles.clipTag}>CLIP {i + 1} OF {g.videos.length}</Text>
                          )}
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
              {answers.length === 0 && exerciseCards.length === 0 && (
                <Text style={styles.hint}>This check-up has no answers or clips.</Text>
              )}

              {/* Feedback form */}
              <View style={styles.feedbackBlock}>
                <SectionTitle>YOUR FEEDBACK</SectionTitle>

                <Text style={styles.fieldLabel}>FEEDBACK VIDEO URL</Text>
                <TextInput
                  style={[styles.input, fbFocus === 'url' && styles.inputFocus]}
                  onFocus={() => setFbFocus('url')}
                  onBlur={() => setFbFocus(null)}
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
                  style={[styles.input, styles.multiline, fbFocus === 'note' && styles.inputFocus]}
                  onFocus={() => setFbFocus('note')}
                  onBlur={() => setFbFocus(null)}
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

          {/* ── This player's check-up — ONE list, edited in place ── */}
          <View style={styles.customizeBlock}>
            <View style={styles.customizeHead}>
              <SectionTitle>THIS PLAYER'S CHECK-UP</SectionTitle>
              <View style={styles.headRight}>
                <View style={[styles.scopeChip, hasOverride ? styles.scopeChipCustom : styles.scopeChipStd]}>
                  <Text style={[styles.scopeChipText, hasOverride ? styles.scopeChipTextCustom : styles.scopeChipTextStd]}>
                    {hasOverride ? 'PERSONAL' : 'CLASS STANDARD'}
                  </Text>
                </View>
                <PillButton
                  label={tplEditing ? 'DONE' : 'EDIT'}
                  onPress={() => setTplEditing(v => !v)}
                  variant={tplEditing ? 'solid' : 'outline'}
                  tone={tplEditing ? 'green' : 'accent'}
                  size="sm"
                />
              </View>
            </View>

            {/* The explainer belongs to the editing state — the clean view stays
                clean, so it can be on screen while the coach is recording. */}
            {tplEditing && (
              <Text style={styles.customizeHint}>
                {hasOverride
                  ? 'Tailored to this player. Every change saves to them only — their class standard is untouched.'
                  : "What this player fills in, inherited from their class. Change anything here and it becomes theirs alone — the class standard stays as it is."}
              </Text>
            )}

            <CheckupTemplateEditor
              key={editorKey}
              scope={{ playerId: player.id, classId }}
              onSourceChange={onSourceChange}
              editable={tplEditing}
            />

            {tplEditing && hasOverride && (
              <PillButton
                label={busyTpl ? 'RESETTING…' : '↺  BACK TO CLASS STANDARD'}
                onPress={askReset}
                loading={busyTpl}
                tone="danger"
                size="sm"
                style={{ alignSelf: 'flex-start', marginTop: 20 }}
              />
            )}
          </View>

        </ScrollView>
        )}
      </View>

      <SystemConfirm
        visible={!!confirm}
        title={confirm?.title}
        message={confirm?.message}
        confirmLabel={confirm?.confirmLabel}
        tone={confirm?.tone ?? 'accent'}
        onConfirm={() => { const fn = confirm?.onConfirm; setConfirm(null); fn?.(); }}
        onCancel={() => setConfirm(null)}
      />
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
    borderLeftWidth: 5, borderLeftColor: C.iceGlow,
    padding: 14, paddingLeft: 16, marginBottom: 28,
  },
  clipHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderBottomWidth: 1, borderBottomColor: C.lockedBorder,
    paddingBottom: 8, marginBottom: 10,
  },
  clipIndex: { fontFamily: F.heading, fontSize: 12, color: C.iceGlow, letterSpacing: 2.5 },
  clipCount: { fontFamily: F.heading, fontSize: 12, color: C.textMuted, letterSpacing: 2 },
  clipNoClip: { fontFamily: F.heading, fontSize: 12, color: '#B4884A', letterSpacing: 2 },
  clipName: { fontFamily: F.heading, fontSize: 22, color: C.iceGlow, letterSpacing: 1.2, lineHeight: 28 },
  // Second and later clips of the SAME exercise: a soft rule, not a card edge —
  // it must never read as loudly as the gap between two exercises.
  clipSplit: {
    marginTop: 18, paddingTop: 14,
    borderTopWidth: 1, borderTopColor: C.cardBorder,
  },
  clipTag: { fontFamily: F.heading, fontSize: 11, color: C.textMuted, letterSpacing: 2, marginTop: 4 },
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
    // No browser focus ring on web — see CheckupTemplateEditor.
    ...Platform.select({ web: { outlineStyle: 'none', outlineWidth: 0 }, default: {} }),
  },
  inputFocus: { borderColor: C.iceGlow },
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
  // Chip + the EDIT/DONE button, right-aligned against the section title.
  headRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },

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
