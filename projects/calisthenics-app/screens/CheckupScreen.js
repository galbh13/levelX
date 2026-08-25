import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, ActivityIndicator, Linking, AppState,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { F } from '../constants/fonts';
import { C } from '../constants/colors';
import { supabase } from '../lib/supabase';
import ScreenFrame from '../components/ScreenFrame';
import ScreenHeader from '../components/ScreenHeader';
import { useTourTarget, useTourScroller } from '../lib/tourTargets';
import PillButton from '../components/PillButton';
import VideoPlayer from '../components/VideoPlayer';
import {
  CHECKUP_BUCKET, MAX_VIDEO_BYTES, MAX_VIDEO_MB, purgeExpiredCheckups,
  purgePreviousCheckups, deleteCheckupVideo,
  checkupSchedule, checkupCycleStart, resolvePlayerTemplate, splitTemplateParts, groupCheckupVideos,
} from '../lib/checkups';
import { useCheckupNotify } from '../context/CheckupNotifyContext';
import { loadCheckupDraft, saveCheckupDraft, clearCheckupDraft } from '../lib/checkupDraft';

const NOTE_MAX = 600;

function formatTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatDate(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function formatDayStamp(d) {
  if (!d) return '';
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}
// Status-row accent: red = late (the grace day, nothing sent).
const LATE_RED   = '#E11D48';

// ─── Player's weekly check-up ───────────────────────────────────────────────────
// The check-up is now an ADMIN-AUTHORED template the player FILLS IN, not a
// free-form submission. Part 1 = text questions (diet/sleep). Part 2 = exercises
// the coach picked (reference video + description) that the player performs and
// uploads their own clip + a note for. The template is resolved per player
// (their overrides if any, else their class standard — see lib/checkups). After
// submit it's read-only, and the coach replies with a feedback video. No history:
// a check-up is purged 14 days after creation.
export default function CheckupScreen() {
  // Elements the guided tour measures + points its arrow at.
  const tourStatusRef   = useTourTarget('checkup.status');
  const tourFormRef     = useTourTarget('checkup.form');
  // The two the tour has to SCROLL to — SUBMIT sits under the whole form, and the
  // coach's feedback card only exists once they've replied.
  const tourSubmitRef   = useTourTarget('checkup.submit');
  // The read-only (already submitted) view has no form and no SUBMIT button, so the
  // tour points at the submitted answers instead — see targetNames in GuidedTour.
  const tourAnswersRef  = useTourTarget('checkup.answers');
  const tourFeedbackRef = useTourTarget('checkup.feedback');
  // This screen is a long form, so the tour drives its scroll (see useTourScroller):
  // it brings a step's element into view before highlighting it instead of pointing
  // an arrow at something below the fold.
  const tourScrollRef = useRef(null);
  const tourBoxRef    = useRef(null);
  const tourViewport  = useRef({ scrollY: 0, viewportH: 0 });
  const tourScroller = useMemo(() => ({
    box: tourBoxRef,
    scrollTo: (y, animated = true) => tourScrollRef.current?.scrollTo({ y, animated }),
    getOffset: () => tourViewport.current.scrollY,
    getViewportH: () => tourViewport.current.viewportH,
  }), []);
  useTourScroller('checkup', tourScroller);
  // Clears/re-arms the CHECKUP tab dot as soon as this screen changes the state.
  const { refresh: refreshCheckupDot } = useCheckupNotify();
  const [loading,   setLoading]   = useState(true);
  const [checkup,   setCheckup]   = useState(null);
  const [composing, setComposing] = useState(true);
  const [checkupDay,setCheckupDay]= useState(null);

  // Resolved template (while composing)
  const [templateSource, setTemplateSource] = useState('none'); // 'player' | 'class' | 'none'
  const [questions, setQuestions] = useState([]);
  const [exercises, setExercises] = useState([]);

  // Player input (composing)
  const [answers, setAnswers]   = useState({});  // questionItemId → text
  const [exVideos, setExVideos] = useState({});  // exerciseItemId → checkup_videos row[] (many clips per exercise)
  const [exNotes, setExNotes]   = useState({});  // exerciseItemId → text

  // Submitted (read-only)
  const [subAnswers, setSubAnswers] = useState([]);
  const [subVideos,  setSubVideos]  = useState([]);

  const [savedAt,   setSavedAt]   = useState(null);   // when the draft text last hit the device
  const [saveState, setSaveState] = useState('idle'); // 'idle' | 'saving' | 'saved' | 'empty' (button feedback)

  const [uploadingId, setUploadingId] = useState(null);
  const [submitting,  setSubmitting]  = useState(false);
  const [errorMsg,    setErrorMsg]    = useState('');

  const loadedRef = useRef(false);
  // Local (device) autosave of the typed text — see lib/checkupDraft. Clips reach
  // Supabase the moment they're picked, but the text only lands on SUBMIT, so
  // without this it died with the app.
  const userIdRef    = useRef(null);
  const draftRef     = useRef({ answers: {}, notes: {} });  // newest text, for the flush
  const hydratedRef  = useRef(false);                       // don't save before the load fills state
  const saveTimerRef = useRef(null);
  const savedFlashRef = useRef(null);   // reverts the SAVE button out of its ✓ state

  const fetchCheckup = useCallback(async () => {
    if (!loadedRef.current) setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      userIdRef.current = user.id;
      const localDraft = await loadCheckupDraft(user.id);
      setSavedAt(localDraft?.updatedAt ?? null);

      const { data: prof } = await supabase
        .from('profiles')
        .select('checkup_day, class_id')
        .eq('id', user.id)
        .maybeSingle();
      setCheckupDay(prof?.checkup_day ?? null);

      // Resolve the admin-authored template for this player.
      const tpl = await resolvePlayerTemplate(user.id, prof?.class_id ?? null);
      const { questions: qs, exercises: exs } = splitTemplateParts(tpl.items);
      setTemplateSource(tpl.source);
      setQuestions(qs);
      setExercises(exs);

      await purgeExpiredCheckups(user.id);

      const { data: latest } = await supabase
        .from('checkups')
        .select('*')
        .eq('student_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latest) {
        const { data: vids } = await supabase
          .from('checkup_videos')
          .select('*')
          .eq('checkup_id', latest.id)
          .order('order_index', { ascending: true });
        setCheckup(latest);

        if (latest.submitted_at) {
          const { data: ans } = await supabase
            .from('checkup_answers')
            .select('*')
            .eq('checkup_id', latest.id)
            .order('order_index', { ascending: true });
          setSubAnswers(ans ?? []);
          setSubVideos(vids ?? []);
          setComposing(false);
        } else {
          // Restore a draft's uploaded clips + notes into the compose maps.
          // Many clips per exercise → group into an array keyed by item_id.
          const vmap = {}, nmap = {};
          (vids ?? []).forEach(v => {
            if (!v.item_id) return;
            (vmap[v.item_id] ||= []).push(v);
            if (v.answer_text && nmap[v.item_id] == null) nmap[v.item_id] = v.answer_text;
          });
          setExVideos(vmap);
          // Locally-saved text wins over anything mirrored onto the clips — it is
          // the newest thing the player typed.
          setExNotes({ ...nmap, ...(localDraft?.notes ?? {}) });
          setAnswers(localDraft?.answers ?? {});
          setComposing(true);
        }
      } else {
        setCheckup(null);
        setAnswers(localDraft?.answers ?? {});
        setExNotes(localDraft?.notes ?? {});
        setComposing(true);
      }
    } catch (e) {
      console.error('[CheckupScreen] fetchCheckup:', e);
    }
    loadedRef.current = true;
    hydratedRef.current = true;
    setLoading(false);
  }, []);

  useEffect(() => { fetchCheckup(); }, [fetchCheckup]);

  // Has the player actually typed anything? Drives whether SAVE has work to do.
  const hasDraftText = useMemo(
    () => [...Object.values(answers), ...Object.values(exNotes)]
      .some(t => t && String(t).trim()),
    [answers, exNotes],
  );

  // ── Draft text autosave ──────────────────────────────────────────────────────
  // Every keystroke lands on the device within a beat, so leaving the screen,
  // backgrounding the app or killing it entirely resumes exactly where it left.
  const persistDraft = useCallback(async () => {
    if (!hydratedRef.current || !userIdRef.current) return;
    await saveCheckupDraft(userIdRef.current, draftRef.current);
    setSavedAt(new Date().toISOString());
  }, []);

  const flushDraft = useCallback(async () => {
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    await persistDraft();
  }, [persistDraft]);

  // The explicit SAVE — same write as the autosave, but it says so out loud, so
  // the player can put the phone down knowing the words are kept.
  async function handleSaveDraft() {
    setErrorMsg('');
    if (savedFlashRef.current) clearTimeout(savedFlashRef.current);
    if (!hasDraftText) {
      // Nothing typed anywhere — say so instead of flashing SAVED over a no-op.
      setSaveState('empty');
      savedFlashRef.current = setTimeout(() => setSaveState('idle'), 2200);
      return;
    }
    setSaveState('saving');
    await flushDraft();
    setSaveState('saved');
    savedFlashRef.current = setTimeout(() => setSaveState('idle'), 2200);
  }

  useEffect(() => () => { if (savedFlashRef.current) clearTimeout(savedFlashRef.current); }, []);

  useEffect(() => {
    draftRef.current = { answers, notes: exNotes };
    if (!hydratedRef.current || !userIdRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      persistDraft();
    }, 400);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [answers, exNotes, persistDraft]);

  // The app going to the background is the exact moment the text would have been
  // lost before — write it out there too, not just on the debounce.
  useEffect(() => {
    const sub = AppState.addEventListener('change', st => {
      if (st !== 'active') flushDraft();
    });
    return () => sub?.remove?.();
  }, [flushDraft]);

  // On focus: write out anything still pending, then re-read. On blur (the
  // cleanup): flush, so tab-switching mid-sentence keeps the sentence.
  useFocusEffect(useCallback(() => {
    if (loadedRef.current) flushDraft().then(fetchCheckup);
    return () => { flushDraft(); };
  }, [fetchCheckup, flushDraft]));

  // Lazily create the draft check-up row (born on first clip-add / submit).
  async function ensureDraft() {
    if (checkup) return checkup;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not signed in.');
    const { data, error } = await supabase
      .from('checkups')
      .insert({ student_id: user.id })
      .select()
      .single();
    if (error) throw error;
    setCheckup(data);
    return data;
  }

  async function handleAddVideo(item) {
    setErrorMsg('');
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setErrorMsg('Media library permission is required to add a video.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      quality: 0.7,
    });
    if (result.canceled) return;
    const asset = result.assets[0];

    setUploadingId(item.id);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in.');

      const response = await fetch(asset.uri);
      const blob = await response.blob();
      if (blob.size > MAX_VIDEO_BYTES) {
        throw new Error(`That clip is ${(blob.size / 1024 / 1024).toFixed(0)} MB. Max is ${MAX_VIDEO_MB} MB — lower the recording quality on your phone and try again.`);
      }

      const draft = await ensureDraft();
      const ext = (asset.uri.split('.').pop() ?? 'mp4').toLowerCase().split('?')[0];
      const path = `${user.id}/${draft.id}/${item.id}-${Date.now()}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from(CHECKUP_BUCKET)
        .upload(path, blob, { contentType: blob.type || `video/${ext}`, upsert: true });
      if (upErr) throw upErr;

      const { data: { publicUrl } } = supabase.storage.from(CHECKUP_BUCKET).getPublicUrl(path);

      // Many clips per exercise — APPEND this one (don't replace prior clips).
      const { data: row, error: insErr } = await supabase
        .from('checkup_videos')
        .insert({
          checkup_id: draft.id, student_id: user.id, item_id: item.id,
          prompt: item.prompt, storage_path: path, video_url: publicUrl,
          order_index: item.order_index ?? 0,
        })
        .select()
        .single();
      if (insErr) throw insErr;

      setExVideos(m => ({ ...m, [item.id]: [ ...(m[item.id] ?? []), row ] }));
    } catch (e) {
      setErrorMsg(e.message ?? 'Video upload failed.');
    }
    setUploadingId(null);
  }

  async function handleRemoveVideo(item, video) {
    if (!video) return;
    setExVideos(m => ({ ...m, [item.id]: (m[item.id] ?? []).filter(x => x.id !== video.id) }));
    await deleteCheckupVideo(video);
  }

  async function handleSubmit() {
    setErrorMsg('');
    const anyAnswer = Object.values(answers).some(t => t && t.trim());
    const anyVideo = Object.values(exVideos).some(arr => arr && arr.length > 0);
    if (!anyAnswer && !anyVideo) {
      setErrorMsg('Answer at least one question or add an exercise video before submitting.');
      return;
    }
    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in.');
      const draft = await ensureDraft();

      // Part 1 — write a snapshot answer row per question (fresh each submit).
      await supabase.from('checkup_answers').delete().eq('checkup_id', draft.id);
      if (questions.length) {
        const rows = questions.map((q, i) => ({
          checkup_id: draft.id, student_id: user.id, item_id: q.id,
          prompt: q.prompt, answer_text: (answers[q.id] ?? '').trim() || null, order_index: i,
        }));
        const { error: ansErr } = await supabase.from('checkup_answers').insert(rows);
        if (ansErr) throw ansErr;
      }

      // Part 2 — attach the player's per-exercise note to every clip of that
      // exercise (mirrored so it survives if any single clip is later removed).
      await Promise.all(
        Object.entries(exVideos).flatMap(([itemId, arr]) =>
          (arr ?? []).map(v =>
            supabase.from('checkup_videos')
              .update({ answer_text: (exNotes[itemId] ?? '').trim() || null })
              .eq('id', v.id)))
      );

      const { data, error } = await supabase
        .from('checkups')
        .update({ submitted_at: new Date().toISOString() })
        .eq('id', draft.id)
        .select()
        .single();
      if (error) throw error;

      // THE SPACE POLICY — this check-up is now the only one. Every earlier one
      // (clips, notes, answers, old feedback) is wiped right here, so a player
      // never holds more than one check-up's worth of storage. Re-submitting an
      // edited check-up reuses the same row, so this is a no-op in that case.
      await purgePreviousCheckups(user.id, draft.id);

      // Sent — the local draft has served its purpose.
      if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
      await clearCheckupDraft(user.id);
      setSavedAt(null);

      // Reload submitted view from what we just wrote.
      await fetchCheckup();
      setCheckup(data);
      draftRef.current = { answers: {}, notes: {} };   // nothing left to autosave
      setAnswers({});
      setExNotes({});
      refreshCheckupDot();   // this week's check-up is in → drop the tab dot
    } catch (e) {
      setErrorMsg(e.message ?? 'Could not submit. Please try again.');
    }
    setSubmitting(false);
  }

  function startNew() {
    setErrorMsg('');
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    clearCheckupDraft(userIdRef.current);
    setSavedAt(null);
    setCheckup(null);
    setAnswers({});
    setExVideos({});
    setExNotes({});
    setSubAnswers([]);
    setSubVideos([]);
    setComposing(true);
  }

  // Re-open the SUBMITTED check-up for editing (same row): pour its saved answers,
  // clips and notes back into the compose maps, then flip to compose mode. SUBMIT
  // re-writes the same checkup (ensureDraft returns the existing row). Allowed only
  // while awaiting feedback — once the coach has replied, editing is closed.
  function editSubmission() {
    setErrorMsg('');
    const amap = {}, nmap = {};
    subAnswers.forEach(a => { if (a.item_id) amap[a.item_id] = a.answer_text ?? ''; });
    const vmap = {};
    groupCheckupVideos(subVideos).forEach(g => {
      if (g.item_id == null) return;
      vmap[g.item_id] = g.videos;
      if (g.note != null) nmap[g.item_id] = g.note;
    });
    setAnswers(amap);
    setExVideos(vmap);
    setExNotes(nmap);
    setComposing(true);
  }

  const reviewed = !composing && !!checkup?.feedback_at;
  const editing  = composing && !!checkup?.submitted_at;   // re-opening a submitted check-up
  const hasTemplate = templateSource !== 'none' && (questions.length + exercises.length) > 0;
  // Has a submission landed inside the CURRENT weekly cycle? (Same rule as the
  // tab dot — see checkupDueState in lib/checkups.)
  const cycleStart = checkupCycleStart(checkupDay);
  const sentThisCycle = !!checkup?.submitted_at && !!cycleStart
    && new Date(checkup.submitted_at) >= cycleStart;

  return (
    <ScreenFrame fill maxWidth={640} ready={!loading}>
      <View style={styles.card}>
        <ScreenHeader title="WEEKLY CHECK-UP" />

        <View ref={tourBoxRef} collapsable={false} style={styles.scrollBox}>
        <ScrollView
          ref={tourScrollRef}
          style={styles.scroll}
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          scrollEventThrottle={16}
          onScroll={e => { tourViewport.current.scrollY = e.nativeEvent.contentOffset.y; }}
          onLayout={e => { tourViewport.current.viewportH = e.nativeEvent.layout.height; }}
        >
          {!loading && (
            <View ref={tourStatusRef}>
              <ScheduleBar checkupDay={checkupDay} sent={sentThisCycle} reviewed={reviewed} />
            </View>
          )}

          {loading ? (
            <View style={styles.center}><ActivityIndicator size="large" color={C.iceGlow} /></View>
          ) : composing && !hasTemplate ? (
            <View ref={tourFormRef} style={styles.emptyBox}>
              <Text style={styles.emptyIcon}>◇</Text>
              <Text style={styles.emptyTitle}>NO CHECK-UP YET</Text>
              <Text style={styles.emptyText}>
                Your coach hasn't set up your check-up yet. Once they do, your questions and
                exercises will appear here.
              </Text>
            </View>
          ) : composing ? (
            <>
              {/* Only the EDIT state still explains itself — the plain "fill this
                  in" blurb was noise above a form that speaks for itself. */}
              {editing && (
                <Text style={styles.intro}>
                  Editing your submitted check-up — change any answer, add or remove clips,
                  then re-submit. Your coach sees the updated version.
                </Text>
              )}

              {/* Part 1 — questions */}
              {questions.length > 0 && (
                <>
                  <View ref={tourFormRef}><PartTitle n={1} label="QUESTIONS" /></View>
                  {questions.map(q => (
                    <View key={q.id} style={styles.qBlock}>
                      <Text style={styles.qPrompt}>{q.prompt}</Text>
                      <TextInput
                        style={styles.answerInput}
                        placeholder="Your answer…"
                        placeholderTextColor={C.textMuted}
                        value={answers[q.id] ?? ''}
                        onChangeText={t => setAnswers(m => ({ ...m, [q.id]: t }))}
                        multiline
                        textAlignVertical="top"
                      />
                    </View>
                  ))}
                </>
              )}

              {/* Part 2 — exercises */}
              {exercises.length > 0 && (
                <>
                  <View style={{ height: 10 }} />
                  <PartTitle n={2} label="EXERCISES" />
                  {exercises.map(ex => {
                    const vids = exVideos[ex.id] ?? [];
                    return (
                      <View key={ex.id} style={styles.exCard}>
                        <Text style={styles.exName}>{ex.prompt}</Text>
                        {!!ex.description && <Text style={styles.exDesc}>{ex.description}</Text>}
                        {!!ex.video_url && (
                          <View style={styles.refBlock}>
                            <Text style={styles.refLabel}>COACH'S REFERENCE</Text>
                            <VideoPlayer url={ex.video_url} height={190} />
                          </View>
                        )}

                        <Text style={styles.yourClipLabel}>
                          {vids.length > 1 ? `YOUR VIDEOS · ${vids.length}` : 'YOUR VIDEO'}
                        </Text>
                        {vids.map((v, i) => (
                          <View key={v.id} style={[styles.clipCard, i > 0 && { marginTop: 12 }]}>
                            <VideoPlayer url={v.video_url} height={190} />
                            <View style={styles.clipActions}>
                              <TouchableOpacity onPress={() => Linking.openURL(v.video_url)}>
                                <Text style={styles.openLink}>⤓  OPEN</Text>
                              </TouchableOpacity>
                              <TouchableOpacity style={styles.removeBtn} onPress={() => handleRemoveVideo(ex, v)}>
                                <Text style={styles.removeBtnText}>✕  REMOVE</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        ))}
                        <PillButton
                          label={uploadingId === ex.id
                            ? 'UPLOADING…'
                            : vids.length ? '＋  ADD ANOTHER VIDEO' : '＋  ADD YOUR VIDEO'}
                          onPress={() => handleAddVideo(ex)}
                          loading={uploadingId === ex.id}
                          tone="accent"
                          size="sm"
                          style={[styles.addBtn, vids.length > 0 && { marginTop: 12 }]}
                        />

                        <TextInput
                          style={[styles.answerInput, { marginTop: 12 }]}
                          placeholder="A few words about how it felt…"
                          placeholderTextColor={C.textMuted}
                          value={exNotes[ex.id] ?? ''}
                          onChangeText={t => setExNotes(m => ({ ...m, [ex.id]: t }))}
                          maxLength={NOTE_MAX}
                          multiline
                          textAlignVertical="top"
                        />
                      </View>
                    );
                  })}
                </>
              )}

              {!!errorMsg && <ErrorBox msg={errorMsg} />}

              {/* SAVE keeps the check-up open — the words are kept on this device
                  so life can interrupt and the player picks it back up later.
                  SUBMIT is the one that sends it to the coach. */}
              {!editing && (
                <>
                  <PillButton
                    label={
                      saveState === 'saving' ? 'SAVING…'
                      : saveState === 'saved' ? '✓  SAVED'
                      : saveState === 'empty' ? 'NOTHING TO SAVE YET'
                      : 'SAVE PROGRESS'
                    }
                    onPress={handleSaveDraft}
                    loading={saveState === 'saving'}
                    disabled={submitting || !!uploadingId}
                    tone={saveState === 'saved' ? 'jade' : saveState === 'empty' ? 'muted' : 'accent'}
                    variant="outline"
                    size="md"
                    style={styles.saveBtn}
                  />
                  {!!savedAt && hasDraftText && (
                    <Text style={styles.saveHint}>Saved {formatTime(savedAt)}</Text>
                  )}
                </>
              )}

              <View ref={tourSubmitRef}>
                <PillButton
                  label={submitting ? (editing ? 'SAVING…' : 'SUBMITTING…') : editing ? 'SAVE CHANGES' : 'SUBMIT CHECK-UP'}
                  onPress={handleSubmit}
                  loading={submitting}
                  disabled={!!uploadingId}
                  variant="solid"
                  tone="accent"
                  size="lg"
                  style={styles.submitBtn}
                />
              </View>
              {editing && (
                <PillButton
                  label="✕  CANCEL EDIT"
                  onPress={() => { setErrorMsg(''); fetchCheckup(); }}
                  disabled={submitting || !!uploadingId}
                  tone="muted"
                  variant="outline"
                  size="md"
                  style={{ marginTop: 12 }}
                />
              )}
            </>
          ) : (
            <>
              {/* Status banner — one line: what happened, then when. */}
              <View style={styles.banner}>
                <Text style={styles.bannerText}>
                  {reviewed ? 'CURRENT FEEDBACK TIME' : 'SENT — AWAITING FEEDBACK'}
                </Text>
                {!!checkup?.submitted_at && (
                  <Text style={styles.bannerSub}>
                    {'·  ' + formatDate(checkup.submitted_at) + (reviewed ? '' : ' · still editable')}
                  </Text>
                )}
              </View>

              {/* Coach feedback */}
              {reviewed && (
                <View ref={tourFeedbackRef} style={styles.feedbackCard}>
                  <SectionTitle>COACH FEEDBACK</SectionTitle>
                  {!!checkup.feedback_note && <Text style={styles.feedbackNote}>{checkup.feedback_note}</Text>}
                  {!!checkup.feedback_url && (
                    <PillButton
                      label="▶  WATCH FEEDBACK VIDEO"
                      onPress={() => Linking.openURL(checkup.feedback_url)}
                      variant="solid"
                      tone="accent"
                      style={{ marginTop: 14 }}
                    />
                  )}
                </View>
              )}

              {/* Their submission (read-only) */}
              {subAnswers.length > 0 && (
                <>
                  <View ref={tourAnswersRef}><SectionTitle>YOUR ANSWERS</SectionTitle></View>
                  {subAnswers.map(a => (
                    <View key={a.id} style={styles.qBlock}>
                      <Text style={styles.qPrompt}>{a.prompt}</Text>
                      <View style={styles.notePanel}>
                        <Text style={styles.notePanelText}>{a.answer_text || '—'}</Text>
                      </View>
                    </View>
                  ))}
                </>
              )}
              {subVideos.length > 0 && (
                <>
                  <SectionTitle>YOUR EXERCISES</SectionTitle>
                  {groupCheckupVideos(subVideos).map(g => (
                    <View key={g.key} style={styles.exCard}>
                      {!!g.prompt && (
                        <Text style={styles.exName}>
                          {g.prompt}{g.videos.length > 1 ? `  ·  ${g.videos.length} CLIPS` : ''}
                        </Text>
                      )}
                      {g.videos.map((v, i) => (
                        <View key={v.id} style={i > 0 ? { marginTop: 14 } : undefined}>
                          <VideoPlayer url={v.video_url} height={190} style={{ marginTop: 10 }} />
                          <TouchableOpacity onPress={() => Linking.openURL(v.video_url)}>
                            <Text style={styles.openLink}>⤓  OPEN</Text>
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

              {/* Edit is always shown, but locked once the coach has reviewed. */}
              <PillButton
                label={reviewed ? 'COACH REVIEWED · EDIT NOT AVAILABLE' : '✎  EDIT MY CHECK-UP'}
                onPress={editSubmission}
                disabled={reviewed}
                variant="solid"
                tone={reviewed ? 'muted' : 'accent'}
                size="lg"
                style={styles.submitBtn}
              />
              <PillButton
                label="＋  START NEW CHECK-UP"
                onPress={startNew}
                tone={reviewed ? 'accent' : 'muted'}
                variant={reviewed ? 'solid' : 'outline'}
                size="lg"
                style={{ marginTop: 14 }}
              />
            </>
          )}
        </ScrollView>
        </View>
      </View>
    </ScreenFrame>
  );
}

// One quiet status LINE for the coach-set weekly check-up day: an accent tick,
// the day, and a state chip on the right. Deliberately not a filled box — it's a
// system readout above the form, not an alert.
//   · no day set → muted
//   · coach has replied → this cycle is CLOSED, so the line looks ahead: the next
//     check-up's date + a countdown chip
//   · sent, still waiting on the coach → ice SENT
//   · check-up day → ice TODAY   · grace day → red LATE
//   · otherwise → muted countdown
function ScheduleBar({ checkupDay, sent, reviewed }) {
  const sched = checkupSchedule(checkupDay);
  if (!sched) {
    return (
      <View style={styles.schedRow}>
        <View style={[styles.schedTick, { backgroundColor: C.lockedBorder, shadowOpacity: 0 }]} />
        <Text style={[styles.schedLabel, styles.schedLabelMuted]}>NO CHECK-UP DAY SET</Text>
      </View>
    );
  }

  // Days to the NEXT check-up. checkupSchedule only carries this for 'upcoming';
  // on the day itself the next one is a full week out, and on the grace day it's 6.
  const daysToNext = sched.status === 'upcoming' ? sched.daysUntil
    : sched.status === 'today' ? 7 : 6;

  // WHICH occurrence of that weekday the line is about. Once the coach has replied
  // this cycle is done, so it points at the NEXT one; otherwise at the current cycle.
  const now = new Date();
  const stampDate = (reviewed || sched.status === 'upcoming')
    ? new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysToNext)
    : checkupCycleStart(checkupDay);

  let tone = C.textMuted, chip = null;
  if (reviewed) {
    // Feedback is in — nothing owed, so count down to the next check-up.
    tone = C.iceGlow;
    chip = `${daysToNext} DAY${daysToNext === 1 ? '' : 'S'}`;
  } else if (sent) {
    tone = C.iceGlow;
    chip = 'SENT';
  } else if (sched.status === 'today') {
    tone = C.iceGlow;
    chip = 'TODAY';
  } else if (sched.status === 'grace') {
    // Past the day itself and still nothing sent — say it plainly.
    tone = LATE_RED;
    chip = 'LATE';
  } else {
    // Countdown to the next check-up day.
    chip = `${sched.daysUntil} DAY${sched.daysUntil === 1 ? '' : 'S'}`;
  }

  return (
    <View style={styles.schedRow}>
      <View style={[styles.schedTick, { backgroundColor: tone, shadowColor: tone }]} />
      <Text style={styles.schedLabel}>{sched.dayName.toUpperCase()}</Text>
      {!!stampDate && <Text style={styles.schedDate}>{formatDayStamp(stampDate)}</Text>}
      <View style={styles.schedSpacer} />
      <Text style={[styles.schedChip, { color: tone, borderColor: tone }]}>{chip}</Text>
    </View>
  );
}

function PartTitle({ n, label }) {
  return (
    <View style={styles.partHead}>
      <View style={styles.partChip}><Text style={styles.partChipText}>PART {n}</Text></View>
      <Text style={styles.sectionTitle}>{label}</Text>
    </View>
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

function ErrorBox({ msg }) {
  return (
    <View style={styles.errorBox}>
      <Text style={styles.errorText}>⚠  {msg}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1 },
  scrollBox: { flex: 1 },
  scroll: { flex: 1 },
  body: { paddingHorizontal: 24, paddingTop: 22, paddingBottom: 40 },

  // Status LINE (not a box): tick · day · state chip, over a hairline rule.
  schedRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingBottom: 14, marginBottom: 20,
    borderBottomWidth: 1, borderBottomColor: C.cardBorder,
  },
  schedTick: {
    width: 3, height: 22, borderRadius: 2,
    shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.9, shadowRadius: 6,
  },
  schedSpacer: { flex: 1 },
  schedLabel: { fontFamily: F.heading, fontSize: 20, color: C.text, letterSpacing: 3 },
  schedLabelMuted: { color: C.textMuted },
  schedDate: { fontFamily: F.heading, fontSize: 17, color: C.iceGlow, opacity: 0.7, letterSpacing: 1.5 },
  schedChip: {
    fontFamily: F.heading, fontSize: 15, letterSpacing: 2,
    borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 5,
  },
  center: { paddingVertical: 80, alignItems: 'center', justifyContent: 'center' },

  intro: {
    fontFamily: F.body, fontSize: 16, color: C.text, opacity: 0.85,
    lineHeight: 24, letterSpacing: 0.3, marginBottom: 26,
  },

  emptyBox: { alignItems: 'center', paddingVertical: 60, gap: 14 },
  emptyIcon: { fontSize: 44, color: C.textMuted },
  emptyTitle: { fontFamily: F.heading, fontSize: 20, color: C.iceGlow, letterSpacing: 3 },
  emptyText: {
    fontFamily: F.bodyMed, fontSize: 15, color: C.textMuted,
    letterSpacing: 0.5, textAlign: 'center', maxWidth: 320, lineHeight: 22,
  },

  // Part header — PART n chip + label
  partHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16, marginTop: 6 },
  partChip: {
    borderWidth: 1.5, borderColor: C.iceGlow, backgroundColor: 'rgba(74,158,191,0.12)',
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4,
  },
  partChipText: { fontFamily: F.heading, fontSize: 12, color: C.iceGlow, letterSpacing: 1.5 },

  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14, marginTop: 6 },
  sectionBar: {
    width: 5, height: 22, borderRadius: 2, backgroundColor: C.iceGlow,
    shadowColor: C.iceGlow, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.9, shadowRadius: 6,
  },
  sectionTitle: { fontFamily: F.heading, fontSize: 19, color: C.iceGlow, letterSpacing: 3 },

  // Question block
  qBlock: { marginBottom: 18 },
  qPrompt: { fontFamily: F.bodyMed, fontSize: 16, color: C.text, lineHeight: 22, letterSpacing: 0.2, marginBottom: 10 },
  answerInput: {
    backgroundColor: C.bg, borderWidth: 1.5, borderColor: C.cardBorder, borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 14, minHeight: 80,
    fontFamily: F.body, fontSize: 16, color: C.text, lineHeight: 23,
  },

  // Exercise card
  exCard: {
    backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.lockedBorder, borderRadius: 16,
    padding: 16, marginBottom: 16,
  },
  exName: { fontFamily: F.heading, fontSize: 17, color: C.text, letterSpacing: 1 },
  exDesc: { fontFamily: F.body, fontSize: 15, color: C.textMuted, lineHeight: 21, marginTop: 8 },
  refBlock: { marginTop: 14, gap: 8 },
  refLabel: { fontFamily: F.heading, fontSize: 12, color: C.iceGlow, letterSpacing: 2 },
  yourClipLabel: { fontFamily: F.heading, fontSize: 12, color: C.textMuted, letterSpacing: 2, marginTop: 16, marginBottom: 10 },

  clipCard: {
    backgroundColor: C.bg, borderWidth: 1.5, borderColor: C.lockedBorder, borderRadius: 14,
    padding: 12, gap: 12,
  },
  clipActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  openLink: { fontFamily: F.heading, fontSize: 13, color: C.iceGlow, letterSpacing: 2, paddingVertical: 6 },
  removeBtn: {
    paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 999, borderWidth: 1.5, borderColor: '#FF4444',
    backgroundColor: 'rgba(255,68,68,0.10)',
  },
  removeBtnText: { fontFamily: F.heading, fontSize: 13, color: '#FF6B6B', letterSpacing: 2 },
  addBtn: { alignSelf: 'flex-start' },

  submitBtn: { marginTop: 14 },
  saveBtn:   { marginTop: 28 },
  saveHint:  {
    fontFamily: F.body, fontSize: 14.5, color: C.textMuted,
    textAlign: 'center', marginTop: 8, letterSpacing: 0.4,
  },

  // Submitted / reviewed view
  banner: {
    flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'center',
    columnGap: 10, rowGap: 2,
    borderWidth: 1.5, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 20,
    borderColor: C.iceGlow, backgroundColor: 'rgba(74,158,191,0.10)',
    marginBottom: 24,
  },
  bannerText:   { fontFamily: F.heading, fontSize: 18, color: C.iceGlow, letterSpacing: 2 },
  bannerSub:    { fontFamily: F.heading, fontSize: 17, color: C.iceGlow, opacity: 0.75, letterSpacing: 1.5 },

  feedbackCard: {
    backgroundColor: C.surface,
    borderWidth: 1.5, borderColor: 'rgba(74,158,191,0.35)', borderLeftWidth: 4, borderLeftColor: C.iceGlow,
    borderRadius: 14, padding: 18, marginBottom: 26,
  },
  feedbackNote: {
    fontFamily: F.body, fontSize: 16, color: C.text, lineHeight: 24, marginTop: 10, letterSpacing: 0.3,
  },

  notePanel: {
    backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.lockedBorder, borderRadius: 12,
    padding: 14, marginTop: 8,
  },
  notePanelText: { fontFamily: F.body, fontSize: 15, color: C.text, lineHeight: 22, letterSpacing: 0.3 },

  errorBox: {
    marginTop: 20, backgroundColor: 'rgba(255,60,60,0.12)',
    borderWidth: 1.5, borderColor: '#FF4444', borderRadius: 10, padding: 14,
  },
  errorText: { fontFamily: F.bodyMed, fontSize: 14, color: '#FF6B6B', letterSpacing: 0.4, lineHeight: 20 },
});
