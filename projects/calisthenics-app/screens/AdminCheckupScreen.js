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
import { useDesktopLayout } from '../constants/layout';
import {
  purgeExpiredCheckups, WEEKDAYS_SHORT, resetPlayerTemplate,
  splitCheckupAnswers, buildExerciseCards,
  resolvePlayerTemplate, splitTemplateParts,
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
//      clips/notes) and reply — either a feedback video URL + note, or, for a
//      shallow submission, a written note on its own (NOTE ONLY).
//   3. THIS PLAYER'S CHECK-UP — the one list they actually fill in, edited in
//      place. It shows the class standard until something is changed here; the
//      first change forks it onto the player (see CheckupTemplateEditor), so a
//      personal tweak is just an edit + save, never a second structure on the page.
// Writes here need the admin-override RLS in migrations/20260714_checkups.sql +
// 20260722_checkup_templates.sql.
//
// TWO LAYOUTS, ONE SCREEN (2026-09-11). The coach does this review on a COMPUTER
// while screen-recording it for the player, so on a desktop-sized canvas
// (`useDesktopLayout`) the card widens past CARD_W, the answers and the exercise
// cards go TWO-UP, the clips get a taller frame and every label/field steps up a
// size — a phone-width column on a 1920 monitor reads as an unfinished app in a
// recording. On a phone nothing changes: `wide` is false and every desktop style
// drops out. The rule for editing this screen is that `wide` only ever ADDS an
// override on top of the phone style, never replaces the phone layout.
export default function AdminCheckupScreen({ navigation, route }) {
  const player = route.params?.player ?? null;
  const { wide, cardW } = useDesktopLayout();

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
  // How this reply goes out. A shallow check-up (a few written words, nothing
  // filmed) doesn't need a recorded video back — NOTE ONLY drops the URL field
  // and makes the written note the whole reply.
  const [fbMode,  setFbMode]    = useState('video');   // 'video' | 'note'
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
  // The template section is CLOSED until the coach asks for it (2026-09-11), and
  // then READ-ONLY until he asks to edit: he screen-records himself going over a
  // player's submitted check-up, and the authoring list hanging open under the
  // review is a second page of content in that recording that the player has no
  // reason to see. Two steps, deliberately — OPEN gives the clean numbered list
  // (which IS worth recording, hence it survived), EDIT adds the admin chrome.
  const [tplOpen,    setTplOpen]    = useState(false);
  const [tplEditing, setTplEditing] = useState(false);
  // What the closed row reports. The editor is unmounted while the section is
  // shut, so it cannot be the one to answer "personal or standard, and how many
  // of each" — the screen resolves that itself, on load and on every close.
  const [tplCounts,  setTplCounts]  = useState({ questions: 0, exercises: 0 });
  const [fbFocus,    setFbFocus]    = useState(null);   // 'url' | 'note' | null
  const onSourceChange = useCallback(src => setTplSource(src), []);
  const hasOverride = tplSource === 'player';

  // Resolve the list this player fills in WITHOUT mounting the editor — the
  // chip ('PERSONAL' / 'CLASS STANDARD') and the closed row's tally have to be
  // right before anything is opened.
  const loadTplSummary = useCallback(async (cls) => {
    if (!player?.id) return;
    try {
      const res = await resolvePlayerTemplate(player.id, cls ?? null);
      const { questions, exercises } = splitTemplateParts(res.items);
      setTplSource(res.source);
      setTplCounts({ questions: questions.length, exercises: exercises.length });
    } catch (e) {
      console.error('[AdminCheckupScreen] loadTplSummary:', e);
    }
  }, [player?.id]);

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
      await loadTplSummary(prof?.class_id ?? player.class_id ?? null);

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
        // A reply already sent as note-only reopens in note-only mode.
        setFbMode(latest.feedback_at && !latest.feedback_url ? 'note' : 'video');
      } else {
        setCheckup(null);
      }
    } catch (e) {
      console.error('[AdminCheckupScreen] load:', e);
    }
    setLoading(false);
  }, [player, loadTplSummary]);

  useEffect(() => { load(); }, [load]);

  async function handleSave() {
    setErrorMsg(''); setSavedMsg(false);
    const noteOnly = fbMode === 'note';
    if (noteOnly && !fbNote.trim()) {
      setErrorMsg('Write a note — in note-only mode that IS the reply.');
      return;
    }
    if (!noteOnly && !fbUrl.trim() && !fbNote.trim()) {
      setErrorMsg('Add a feedback video URL or a note.');
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase
        .from('checkups')
        .update({
          // Note-only CLEARS the link, so flipping an already-sent reply to
          // note-only never leaves a stale video button on the player's screen.
          feedback_url:  noteOnly ? null : (fbUrl.trim() || null),
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
      await loadTplSummary(classId);
    } catch (e) {
      console.error('[AdminCheckupScreen] resetToStandard:', e);
    }
    setBusyTpl(false);
  }

  const hasFeedback = !!checkup?.feedback_at;

  // Closing also leaves edit mode, so the section always REOPENS on the clean
  // read-only list — the state the coach records in — and never on whatever
  // chrome he left showing last time. Re-resolving on close keeps the collapsed
  // row's tally honest after an add or a delete.
  function toggleTpl() {
    if (tplOpen) {
      setTplEditing(false);
      setTplOpen(false);
      loadTplSummary(classId);
    } else {
      setTplOpen(true);
    }
  }

  return (
    <ScreenFrame fill ready={!loading} maxWidth={cardW}>
      <View style={styles.card}>
        <ScreenHeader
          title="CHECK-UP"
          subtitle={player?.full_name || '(no name)'}
          onBack={() => navigation.goBack()}
        />

        {loading ? (
          <View style={styles.center}><ActivityIndicator size="large" color={C.iceGlow} /></View>
        ) : (
        <ScrollView style={styles.scroll} contentContainerStyle={[styles.body, wide && W.body]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {checkup && (
            <View style={[styles.submitBanner, wide && W.submitBanner]}>
              <Text style={[styles.submitBannerText, wide && W.submitBannerText]}>
                ✓  SUBMITTED {formatDate(checkup.submitted_at).toUpperCase()}
              </Text>
              {hasFeedback && <Text style={[styles.submitBannerDone, wide && W.submitBannerDone]}>★ FEEDBACK SENT</Text>}
            </View>
          )}

          {/* Recurring check-up day */}
          <SectionTitle wide={wide}>CHECK-UP DAY</SectionTitle>
          <View style={[styles.dayRow, wide && W.dayRow]}>
            {WEEKDAYS_SHORT.map((d, i) => {
              const active = i === checkupDay;
              return (
                <TouchableOpacity
                  key={d}
                  disabled={savingDay}
                  onPress={() => setDay(i)}
                  style={[styles.dayPill, wide && W.dayPill, active && styles.dayPillActive]}
                >
                  <Text style={[styles.dayPillText, wide && W.dayPillText, active && styles.dayPillTextActive]}>{d}</Text>
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
                  <SectionTitle wide={wide}>THEIR ANSWERS</SectionTitle>
                  {/* Two-up on a desktop canvas. The cells are wrappers, not the
                      blocks themselves, so the phone styles keep their own
                      margins untouched. */}
                  <View style={wide ? W.grid : null}>
                    {answers.map(a => (
                      <View key={a.id} style={wide ? W.gridCell : null}>
                        <View style={styles.qBlock}>
                          <Text style={[styles.qPrompt, wide && W.qPrompt]}>{a.prompt}</Text>
                          <View style={[styles.notePanel, wide && W.notePanel]}>
                            <Text style={[styles.notePanelText, wide && W.notePanelText]}>{a.answer_text || '—'}</Text>
                          </View>
                        </View>
                      </View>
                    ))}
                  </View>
                </>
              )}

              {exerciseCards.length > 0 && (
                <>
                  <SectionTitle wide={wide}>THEIR EXERCISES</SectionTitle>
                  <View style={wide ? W.grid : null}>
                  {exerciseCards.map((g, gi, all) => (
                    <View key={g.key} style={wide ? W.gridCell : null}>
                    <View style={[styles.clipCard, wide && W.clipCard]}>
                      {/* One exercise = one hard-edged card: numbered, accent-railed
                          and spaced, so a wall of clips reads as N exercises. */}
                      <View style={[styles.clipHead, wide && W.clipHead]}>
                        <Text style={[styles.clipIndex, wide && W.clipMeta]}>EXERCISE {gi + 1} / {all.length}</Text>
                        {g.videos.length > 1 && (
                          <Text style={[styles.clipCount, wide && W.clipMeta]}>{g.videos.length} CLIPS</Text>
                        )}
                        {g.videos.length === 0 && (
                          <Text style={[styles.clipNoClip, wide && W.clipMeta]}>NO CLIP · NOTE ONLY</Text>
                        )}
                      </View>
                      {!!g.prompt && <Text style={[styles.clipName, wide && W.clipName]}>{g.prompt}</Text>}
                      {g.videos.map((v, i) => (
                        <View key={v.id} style={i > 0 ? styles.clipSplit : undefined}>
                          {g.videos.length > 1 && (
                            <Text style={[styles.clipTag, wide && W.clipTag]}>CLIP {i + 1} OF {g.videos.length}</Text>
                          )}
                          <ReviewClip url={v.video_url} wide={wide} />
                          <TouchableOpacity onPress={() => Linking.openURL(v.video_url)}>
                            <Text style={[styles.openLink, wide && W.openLink]}>⤓  OPEN / DOWNLOAD CLIP</Text>
                          </TouchableOpacity>
                        </View>
                      ))}
                      {!!g.note && (
                        <View style={[styles.notePanel, wide && W.notePanel]}>
                          <Text style={[styles.notePanelText, wide && W.notePanelText]}>{g.note}</Text>
                        </View>
                      )}
                    </View>
                    </View>
                  ))}
                  </View>
                </>
              )}
              {answers.length === 0 && exerciseCards.length === 0 && (
                <Text style={styles.hint}>This check-up has no answers or clips.</Text>
              )}

              {/* Feedback form */}
              <View style={[styles.feedbackBlock, wide && W.feedbackBlock]}>
                <SectionTitle wide={wide}>YOUR FEEDBACK</SectionTitle>

                {/* Two ways to reply. NOTE ONLY is for the shallow check-up — a
                    few written words, nothing filmed — where recording a video
                    back is more than the submission asked for. */}
                <View style={[styles.modeRow, wide && W.modeRow]}>
                  {[
                    { key: 'video', label: 'VIDEO + NOTE' },
                    { key: 'note',  label: 'NOTE ONLY' },
                  ].map(m => {
                    const active = fbMode === m.key;
                    return (
                      <TouchableOpacity
                        key={m.key}
                        onPress={() => setFbMode(m.key)}
                        style={[styles.modePill, wide && W.modePill, active && styles.modePillActive]}
                      >
                        <Text style={[styles.modePillText, wide && W.modePillText, active && styles.modePillTextActive]}>
                          {m.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {fbMode === 'video' && (
                  <>
                    <Text style={[styles.fieldLabel, wide && W.fieldLabel]}>FEEDBACK VIDEO URL</Text>
                    <TextInput
                      style={[styles.input, wide && W.input, fbFocus === 'url' && styles.inputFocus]}
                      onFocus={() => setFbFocus('url')}
                      onBlur={() => setFbFocus(null)}
                      placeholder="Paste a link to the feedback clip you recorded…"
                      placeholderTextColor={C.textMuted}
                      value={fbUrl}
                      onChangeText={setFbUrl}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </>
                )}

                <View style={styles.labelRow}>
                  <Text style={[styles.fieldLabel, wide && W.fieldLabel]}>
                    {fbMode === 'note' ? 'NOTE' : 'NOTE (OPTIONAL)'}
                  </Text>
                  <Text style={[styles.counter, wide && W.counter]}>{fbNote.length}/{FB_NOTE_MAX}</Text>
                </View>
                <TextInput
                  style={[styles.input, styles.multiline, wide && W.input, wide && W.multiline, fbFocus === 'note' && styles.inputFocus]}
                  onFocus={() => setFbFocus('note')}
                  onBlur={() => setFbFocus(null)}
                  placeholder={fbMode === 'note'
                    ? 'Your whole reply — no video this time…'
                    : 'A few words alongside the video…'}
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
                  label={saving ? 'SAVING…'
                    : hasFeedback ? 'UPDATE FEEDBACK'
                    : fbMode === 'note' ? 'SEND NOTE' : 'SEND FEEDBACK'}
                  onPress={handleSave}
                  loading={saving}
                  variant="solid"
                  tone="green"
                  size="lg"
                  style={[{ marginTop: 22 }, wide && W.sendBtn]}
                />
              </View>
            </>
          )}

          {/* ── This player's check-up — ONE list, edited in place ── */}
          <View style={[styles.customizeBlock, wide && W.customizeBlock]}>
            <View style={styles.customizeHead}>
              <SectionTitle wide={wide}>THIS PLAYER'S CHECK-UP</SectionTitle>
              <View style={styles.headRight}>
                <View style={[styles.scopeChip, wide && W.scopeChip, hasOverride ? styles.scopeChipCustom : styles.scopeChipStd]}>
                  <Text style={[styles.scopeChipText, wide && W.scopeChipText, hasOverride ? styles.scopeChipTextCustom : styles.scopeChipTextStd]}>
                    {hasOverride ? 'PERSONAL' : 'CLASS STANDARD'}
                  </Text>
                </View>
                {/* EDIT only exists once the section is open — it acts on a list
                    that isn't on screen otherwise. */}
                {tplOpen && (
                  <PillButton
                    label={tplEditing ? 'DONE' : 'EDIT'}
                    onPress={() => setTplEditing(v => !v)}
                    variant={tplEditing ? 'solid' : 'outline'}
                    tone={tplEditing ? 'green' : 'accent'}
                    size={wide ? 'md' : 'sm'}
                  />
                )}
                <PillButton
                  label={tplOpen ? '▲  CLOSE' : '▼  OPEN'}
                  onPress={toggleTpl}
                  variant="outline"
                  tone={tplOpen ? 'muted' : 'accent'}
                  size={wide ? 'md' : 'sm'}
                />
              </View>
            </View>

            {/* Closed: one line saying what is in there, so the section still
                reports itself without putting the whole list on screen. */}
            {!tplOpen && (
              <Text style={[styles.customizeClosed, wide && W.customizeClosed]}>
                {tplCounts.questions + tplCounts.exercises === 0
                  ? 'Nothing authored yet — open to build this player’s check-up.'
                  : `${tplCounts.questions} question${tplCounts.questions === 1 ? '' : 's'} · ${tplCounts.exercises} exercise${tplCounts.exercises === 1 ? '' : 's'}`}
              </Text>
            )}

            {tplOpen && (
              <>
                {/* The explainer belongs to the editing state — the clean view
                    stays clean, so it can be on screen while the coach is
                    recording. */}
                {tplEditing && (
                  <Text style={[styles.customizeHint, wide && W.customizeHint]}>
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
                  wide={wide}
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
              </>
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

// The player's clip inside the review card.
//
// On a PHONE it is the fixed 220-high row it has always been. On DESKTOP the box
// is shaped to the CLIP instead: the coach films these on a phone, so most are
// portrait, and a portrait clip dropped into a ~1100-wide fixed-height box is a
// stamp between two grey slabs — which is most of what the wasted space on that
// monitor was actually made of. `VideoPlayer.onRatio` reports the real aspect as
// soon as the metadata lands, and until then the neutral box below holds the
// layout so nothing jumps.
function ReviewClip({ url, wide }) {
  const [ratio, setRatio] = useState(null);
  const [boxW,  setBoxW]  = useState(0);

  if (!wide) return <VideoPlayer url={url} height={220} style={{ marginTop: 10 }} />;

  // Height from the clip, floored so a wide clip is still watchable and capped
  // so a tall one can't push the next exercise off the screen.
  const h = ratio && boxW ? Math.max(260, Math.min(boxW / ratio, 620)) : 420;
  // …and then the width follows the height for anything narrower than the cell,
  // so a portrait clip is a portrait player, centred.
  const w = ratio ? Math.min(boxW || 0, h * ratio) || undefined : undefined;

  return (
    <View style={W.clipBox} onLayout={e => setBoxW(e.nativeEvent.layout.width)}>
      <VideoPlayer url={url} width={w} height={h} onRatio={setRatio} style={{ marginTop: 10 }} />
    </View>
  );
}

function SectionTitle({ children, wide = false }) {
  return (
    <View style={[styles.sectionHead, wide && W.sectionHead]}>
      <View style={[styles.sectionBar, wide && W.sectionBar]} />
      <Text style={[styles.sectionTitle, wide && W.sectionTitle]}>{children}</Text>
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

  // VIDEO + NOTE / NOTE ONLY switch, same pill language as the day row.
  modeRow: { flexDirection: 'row', gap: 8, marginTop: 12, marginBottom: 4 },
  modePill: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 11, borderRadius: 999,
    borderWidth: 1.5, borderColor: C.lockedBorder, backgroundColor: C.surface,
  },
  modePillActive: {
    borderColor: C.iceGlow, backgroundColor: 'rgba(74,158,191,0.16)',
    shadowColor: C.iceGlow, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 8,
  },
  modePillText: { fontFamily: F.heading, fontSize: 12, color: C.textMuted, letterSpacing: 1.5 },
  modePillTextActive: {
    color: C.text,
    textShadowColor: 'rgba(74,158,191,0.7)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 8,
  },

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
  // The one line the section shows while it's shut.
  customizeClosed: {
    fontFamily: F.bodyMed, fontSize: 14, color: C.textMuted,
    letterSpacing: 1, lineHeight: 20, marginTop: 6,
  },
});

// ─── THE DESKTOP OVERRIDES ──────────────────────────────────────────────────
// Applied ON TOP of `styles` (never instead of them) whenever the canvas is
// desktop-sized — see the `wide` note on the component. Keeping them in their
// own sheet rather than threading a scale factor through every number means the
// phone layout above stays readable as the one real layout, and a desktop tweak
// can never accidentally move the phone.
//
// The measure: at DESKTOP_CARD_W the card is ~2400 canvas units, so a two-up
// grid cell is ~1160 — the reason the type steps up rather than the lines just
// running longer. A one-column body at this width would set 200-character
// lines, which is worse than the dead space it replaced.
const W = StyleSheet.create({
  body: { paddingHorizontal: 44, paddingTop: 14, paddingBottom: 70 },

  // Two-up. The cells carry the gutter (via the row's negative margin) so the
  // blocks inside keep their own phone margins unchanged.
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -14 },
  gridCell: { width: '50%', paddingHorizontal: 14 },

  submitBanner: { paddingVertical: 18, paddingHorizontal: 24, borderRadius: 14, marginBottom: 30 },
  submitBannerText: { fontSize: 20, letterSpacing: 2 },
  submitBannerDone: { fontSize: 17, letterSpacing: 2 },

  sectionHead: { gap: 16, marginBottom: 20, marginTop: 16 },
  sectionBar: { width: 7, height: 30 },
  sectionTitle: { fontSize: 27, letterSpacing: 4 },

  dayRow: { gap: 10, marginBottom: 30 },
  dayPill: { paddingVertical: 18 },
  dayPillText: { fontSize: 16, letterSpacing: 1.5 },

  qPrompt: { fontSize: 21, lineHeight: 29, marginBottom: 12 },
  notePanel: { padding: 20, borderRadius: 14, marginTop: 10 },
  notePanelText: { fontSize: 20, lineHeight: 30 },

  clipCard: { padding: 20, paddingLeft: 24, borderRadius: 18, borderLeftWidth: 7, marginBottom: 34 },
  clipHead: { paddingBottom: 12, marginBottom: 14 },
  clipMeta: { fontSize: 15, letterSpacing: 3 },
  clipName: { fontSize: 30, lineHeight: 38, letterSpacing: 1.5 },
  clipTag: { fontSize: 14, letterSpacing: 2.5, marginTop: 6 },
  clipBox: { alignItems: 'center' },
  openLink: { fontSize: 17, letterSpacing: 2.5, marginTop: 16 },

  feedbackBlock: { marginTop: 34, paddingTop: 14 },
  modeRow: { gap: 12, marginTop: 18 },
  modePill: { paddingVertical: 16 },
  modePillText: { fontSize: 16, letterSpacing: 2 },
  fieldLabel: { fontSize: 18, letterSpacing: 2.5, marginBottom: 12, marginTop: 14 },
  counter: { fontSize: 16, marginBottom: 12 },
  input: { fontSize: 20, paddingHorizontal: 22, paddingVertical: 20, borderRadius: 14 },
  multiline: { minHeight: 190, lineHeight: 30, paddingTop: 18 },
  // A full-bleed SEND across the whole card would be a 2000px button; it stays
  // the size of its job and sits where the eye already is.
  sendBtn: { alignSelf: 'flex-start', minWidth: 380, marginTop: 30 },

  customizeBlock: { marginTop: 44, paddingTop: 28 },
  scopeChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10 },
  scopeChipText: { fontSize: 14, letterSpacing: 2 },
  customizeHint: { fontSize: 18, lineHeight: 27, marginBottom: 24, marginTop: 10 },
  customizeClosed: { fontSize: 18, lineHeight: 27, marginTop: 10 },
});
