import { supabase } from './supabase';

// Weekly check-up helpers. A check-up is a player's end-of-week submission
// (written reflection + short video clips); the admin replies with a feedback
// video URL. See DATABASE.md "checkups" / "checkup_videos".

export const CHECKUP_BUCKET  = 'checkup-videos';
export const CHECKUP_TTL_DAYS = 14;                    // purged this long after creation
export const MAX_VIDEO_MB     = 50;
export const MAX_VIDEO_BYTES  = MAX_VIDEO_MB * 1024 * 1024;

// ─── Weekly schedule ────────────────────────────────────────────────────────────
// The admin pins a player to a recurring check-up DAY (profiles.checkup_day, 0=Sun
// …6=Sat). It's a systematic pattern — the same weekday every week — but a
// submission the day AFTER still counts (a one-day grace for when life happens).
export const WEEKDAYS       = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const WEEKDAYS_SHORT = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

// Resolve where "today" sits against a player's recurring check-up day. Returns
// null when no day is set; otherwise a status the screens render:
//   • 'today'    — the check-up day itself → due now
//   • 'grace'    — the day after → last chance (life-happens grace day)
//   • 'upcoming' — any other day → `daysUntil` / `nextDate` to the next occurrence
export function checkupSchedule(checkupDay, now = new Date()) {
  if (checkupDay == null) return null;
  const today = now.getDay();
  const dayName = WEEKDAYS[checkupDay];

  if (today === checkupDay) return { status: 'today', checkupDay, dayName };
  if (today === (checkupDay + 1) % 7) return { status: 'grace', checkupDay, dayName };

  const daysUntil = ((checkupDay - today) % 7 + 7) % 7;   // 1..6 days ahead
  const nextDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysUntil);
  return { status: 'upcoming', checkupDay, dayName, daysUntil, nextDate };
}

// Start of the CURRENT check-up cycle: local midnight of the most recent
// occurrence of the player's check-up day (today itself when today IS that day).
// A submission stamped at/after this instant covers this week's check-up.
export function checkupCycleStart(checkupDay, now = new Date()) {
  if (checkupDay == null) return null;
  const back = ((now.getDay() - checkupDay) % 7 + 7) % 7;   // 0 = today is the day
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
}

// Is this week's check-up STILL OWED right now, and how badly? Drives the CHECKUP
// tab dot (and the screen's status row) — it flips off the moment the player
// submits for the current cycle.
//   'none' — nothing owed (not the day, or already sent this cycle)
//   'due'  — the check-up day itself
//   'late' — the day AFTER (the grace day) with still nothing sent → RED dot
export function checkupDueState(checkupDay, submittedAt, now = new Date()) {
  const sched = checkupSchedule(checkupDay, now);
  if (!sched || (sched.status !== 'today' && sched.status !== 'grace')) return 'none';
  if (submittedAt && new Date(submittedAt) >= checkupCycleStart(checkupDay, now)) return 'none';
  return sched.status === 'grace' ? 'late' : 'due';
}

// The two reads the due-check needs (the player's day + their newest submission),
// in one call → 'none' | 'due' | 'late'. Used by the tab-dot context.
export async function fetchCheckupDueState(userId) {
  if (!userId) return 'none';
  const { data: prof } = await supabase
    .from('profiles')
    .select('checkup_day')
    .eq('id', userId)
    .maybeSingle();
  if (prof?.checkup_day == null) return 'none';

  const { data: latest } = await supabase
    .from('checkups')
    .select('submitted_at')
    .eq('student_id', userId)
    .not('submitted_at', 'is', null)
    .order('submitted_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return checkupDueState(prof.checkup_day, latest?.submitted_at ?? null);
}

// Delete a set of check-ups outright: the uploaded video FILES first, then the
// rows (CASCADE takes checkup_videos + checkup_answers with them). Storage MUST go
// first — once the rows are gone we no longer know their storage_paths and the
// files would sit in the bucket forever.
async function deleteCheckups(ids = []) {
  if (!ids.length) return;
  const { data: vids } = await supabase
    .from('checkup_videos')
    .select('storage_path')
    .in('checkup_id', ids);
  const paths = (vids ?? []).map(v => v.storage_path).filter(Boolean);
  if (paths.length) await supabase.storage.from(CHECKUP_BUCKET).remove(paths);

  await supabase.from('checkups').delete().in('id', ids);
}

// Empty a check-up of everything BULKY but keep the row: its clips (files + rows)
// and its answers go, the coach's feedback columns stay. This is how a reply
// survives the space policy — the row becomes a small feedback keepsake the
// player can always read (see keepsakeCheckupId / fetchLatestFeedback).
async function stripCheckupContent(id) {
  if (!id) return;
  const { data: vids } = await supabase
    .from('checkup_videos')
    .select('storage_path')
    .eq('checkup_id', id);
  const paths = (vids ?? []).map(v => v.storage_path).filter(Boolean);
  if (paths.length) await supabase.storage.from(CHECKUP_BUCKET).remove(paths);

  await supabase.from('checkup_videos').delete().eq('checkup_id', id);
  await supabase.from('checkup_answers').delete().eq('checkup_id', id);
}

// The one older row a player is allowed to keep: their most recent ANSWERED
// check-up. Nothing else about it is kept — see stripCheckupContent.
async function keepsakeCheckupId(studentId, excludeId) {
  const { data } = await supabase
    .from('checkups')
    .select('id')
    .eq('student_id', studentId)
    .not('feedback_at', 'is', null)
    .order('feedback_at', { ascending: false })
    .limit(excludeId ? 2 : 1);
  const row = (data ?? []).find(r => r.id !== excludeId);
  return row?.id ?? null;
}

// The coach's LATEST reply to this player, wherever it lives — on their current
// check-up, or on the stripped keepsake row an earlier one left behind. The
// player screen shows this at ALL times: sending a new check-up must never take
// the last feedback (note + video link) off their screen while they wait for the
// next reply.
export async function fetchLatestFeedback(studentId) {
  if (!studentId) return null;
  const { data } = await supabase
    .from('checkups')
    .select('id, feedback_url, feedback_note, feedback_at, submitted_at')
    .eq('student_id', studentId)
    .not('feedback_at', 'is', null)
    .order('feedback_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

// Throw away ONE unsubmitted draft check-up (its clips + rows). Used when a player
// starts a new check-up over a submitted one and then backs out — the submitted
// check-up has to become their latest row again. Refuses to touch a submitted row.
export async function discardDraftCheckup(checkupId) {
  if (!checkupId) return;
  try {
    const { data: row } = await supabase
      .from('checkups')
      .select('id, submitted_at')
      .eq('id', checkupId)
      .maybeSingle();
    if (!row || row.submitted_at) return;
    await deleteCheckups([checkupId]);
  } catch (e) {
    console.error('[checkups] discardDraftCheckup:', e);
  }
}

// THE SPACE POLICY — ONE check-up per player, ever. The moment a player SUBMITS a
// new check-up, every earlier check-up of theirs is wiped: clips, notes and
// answers. There is no history — what you see is the current check-up, and it
// lives exactly until the next one replaces it. The ONE thing that survives is
// the coach's most recent FEEDBACK: that row is emptied rather than deleted, so
// the player keeps the last note + video link on screen while the new check-up
// waits for its own reply.
// Called from CheckupScreen right after a successful submit.
export async function purgePreviousCheckups(studentId, keepId) {
  if (!studentId || !keepId) return;
  try {
    // ONE exception to the wipe: the newest check-up the coach actually ANSWERED
    // is EMPTIED instead of deleted, so its feedback (note + video link) stays
    // readable while the player waits for the reply to the new one.
    const keepFeedback = await keepsakeCheckupId(studentId, keepId);
    const { data: older } = await supabase
      .from('checkups')
      .select('id')
      .eq('student_id', studentId)
      .neq('id', keepId);
    const ids = (older ?? []).map(c => c.id);
    await deleteCheckups(ids.filter(id => id !== keepFeedback));
    if (keepFeedback && ids.includes(keepFeedback)) await stripCheckupContent(keepFeedback);
  } catch (e) {
    console.error('[checkups] purgePreviousCheckups:', e);
  }
}

// Long-stop safety net for the check-ups replace-on-submit can never reach: a
// draft a player started, uploaded clips to and abandoned, or the last check-up of
// someone who stopped using the app. Runs on load of both check-up screens.
// This is a BACKSTOP, not the policy — purgePreviousCheckups is the policy.
export async function purgeExpiredCheckups(studentId) {
  if (!studentId) return;
  try {
    const cutoff = new Date(Date.now() - CHECKUP_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data: stale } = await supabase
      .from('checkups')
      .select('id')
      .eq('student_id', studentId)
      .lt('created_at', cutoff);
    // The feedback keepsake outlives the TTL — it holds no clips, only the coach's
    // last reply, and that stays on the player's screen until a newer one replaces it.
    const keepFeedback = await keepsakeCheckupId(studentId, null);
    const staleIds = (stale ?? []).map(c => c.id);
    await deleteCheckups(staleIds.filter(id => id !== keepFeedback));
    if (keepFeedback && staleIds.includes(keepFeedback)) await stripCheckupContent(keepFeedback);
  } catch (e) {
    console.error('[checkups] purgeExpiredCheckups:', e);
  }
}

// Group a flat list of checkup_videos rows by their template exercise (item_id),
// preserving order. A player can upload MANY clips per exercise, so both the
// player's submitted view and the admin review render one card per exercise with
// all its clips. The per-exercise note lives on answer_text (mirrored onto every
// clip of that exercise at submit) — we surface the first non-empty one. Rows with
// no item_id (legacy free-form clips) each stand alone.
export function groupCheckupVideos(videos = []) {
  const groups = [];
  const byItem = new Map();
  for (const v of videos) {
    // The EXERCISE NAME is what groups clips, not item_id: a template can be
    // re-authored (old items deleted, item_id nulled or replaced with fresh ids)
    // while the clips' prompt snapshots survive. Keying on the id split one
    // exercise into several look-alike cards. Name first, id only when unnamed.
    const named = normalizePrompt(v.prompt);
    const key = named ? `__name_${named}` : (v.item_id ?? `__solo_${v.id}`);
    let g = byItem.get(key);
    if (!g) {
      g = { key, item_id: v.item_id ?? null, prompt: v.prompt ?? null, note: null, videos: [] };
      byItem.set(key, g);
      groups.push(g);
    } else if (g.item_id == null && v.item_id) {
      g.item_id = v.item_id;   // keep whichever clip in the group still has a link
    }
    g.videos.push(v);
    if (g.note == null && v.answer_text) g.note = v.answer_text;
  }
  return groups;
}

// ─── Part-2 notes without a clip ────────────────────────────────────────────────
// A player's per-exercise note used to live ONLY mirrored onto that exercise's
// clips (checkup_videos.answer_text), so "couldn't film this one, here's why" was
// silently dropped at submit — the exact case a coach most needs to read.
// Notes are now ALSO written as checkup_answers rows, which exist with or without
// a clip. checkup_answers has no part column, so a Part-2 note is marked by its
// order_index living above EXERCISE_NOTE_BASE (Part 1 order_index is the question
// position, always small). Documented in DATABASE.md.
export const EXERCISE_NOTE_BASE = 1000;

export function isExerciseNote(row) {
  return (row?.order_index ?? 0) >= EXERCISE_NOTE_BASE;
}

// Split stored answer rows into Part 1 (questions) and Part 2 (exercise notes).
export function splitCheckupAnswers(rows = []) {
  const questionRows = [], exerciseNotes = [];
  for (const r of rows) (isExerciseNote(r) ? exerciseNotes : questionRows).push(r);
  return { questionRows, exerciseNotes };
}

// One card per Part-2 exercise for the read-only views: the clips grouped as
// usual, PLUS any exercise that only has a note. The note row is authoritative
// (it is written fresh each submit); the clip mirror is the legacy fallback.
export function buildExerciseCards(videos = [], exerciseNotes = []) {
  const groups = groupCheckupVideos(videos);
  const byName = new Map();
  groups.forEach(g => {
    const k = normalizePrompt(g.prompt);
    if (k && !byName.has(k)) byName.set(k, g);
  });

  const extra = [];
  for (const n of exerciseNotes) {
    const k = normalizePrompt(n.prompt);
    const g = (k && byName.get(k)) || groups.find(x => x.item_id && x.item_id === n.item_id);
    if (g) {
      if (n.answer_text) g.note = n.answer_text;
      continue;
    }
    if (!n.answer_text) continue;      // nothing filmed, nothing written → no card
    const card = {
      key: `__note_${n.id}`, item_id: n.item_id ?? null, prompt: n.prompt ?? null,
      note: n.answer_text, videos: [], order_index: n.order_index ?? 0,
    };
    if (k) byName.set(k, card);
    extra.push(card);
  }
  extra.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
  return [...groups, ...extra];
}

// ─── Clip → exercise binding ────────────────────────────────────────────────────
// checkup_videos.item_id is ON DELETE SET NULL, and re-authoring a template (an
// admin edit, or materializing a per-player override) DELETES the old items and
// inserts new ones with new ids. Either way a player's existing clips lose their
// link, and a check-up re-opened for editing came back with an empty Part 2 while
// the orphaned rows stayed attached — so re-uploading produced duplicate cards.
// The prompt snapshot on each clip is the stable handle, so we re-bind by name.

// Normalized exercise name — the fallback identity of a clip.
export function normalizePrompt(prompt) {
  return (prompt ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Bind a check-up's clips to the CURRENT template exercises.
//   byItem  → exerciseId → clip rows (what the compose form renders)
//   notes   → exerciseId → the player's saved note for it
//   orphans → clips whose exercise no longer exists at all (surfaced in the UI so
//             they can never be invisible-but-submitted)
//   repairs → rows whose item_id should be rewritten to match (see repairVideoLinks)
export function bindVideosToExercises(videos = [], exercises = []) {
  const byId   = new Map(exercises.map(e => [e.id, e]));
  const byName = new Map();
  for (const e of exercises) {
    const k = normalizePrompt(e.prompt);
    if (k && !byName.has(k)) byName.set(k, e);
  }

  const byItem = {}, notes = {}, orphans = [], repairs = [];
  for (const v of videos) {
    let target = v.item_id ? byId.get(v.item_id) : null;
    if (!target) {
      const match = byName.get(normalizePrompt(v.prompt));
      if (match) {
        target = match;
        repairs.push({
          id: v.id, item_id: match.id, prompt: match.prompt,
          order_index: match.order_index ?? 0,
        });
      }
    }
    if (!target) { orphans.push(v); continue; }
    (byItem[target.id] ||= []).push({ ...v, item_id: target.id });
    if (v.answer_text && notes[target.id] == null) notes[target.id] = v.answer_text;
  }
  return { byItem, notes, orphans, repairs };
}

// Write a re-binding back, so the guess happens once and the coach's review sees
// the same grouping the player does. Best-effort: a failure only costs us the
// same re-match on the next load.
export async function repairVideoLinks(repairs = []) {
  if (!repairs.length) return;
  try {
    await Promise.all(repairs.map(r =>
      supabase.from('checkup_videos')
        .update({ item_id: r.item_id, prompt: r.prompt, order_index: r.order_index })
        .eq('id', r.id)));
  } catch (e) {
    console.error('[checkups] repairVideoLinks:', e);
  }
}

// Remove one uploaded clip: its storage file + its DB row (used when a player
// drops a clip from a draft before submitting).
export async function deleteCheckupVideo(video) {
  if (!video?.id) return;
  try {
    if (video.storage_path) await supabase.storage.from(CHECKUP_BUCKET).remove([video.storage_path]);
    await supabase.from('checkup_videos').delete().eq('id', video.id);
  } catch (e) {
    console.error('[checkups] deleteCheckupVideo:', e);
  }
}

// ─── Structured templates (2026-07-22) ──────────────────────────────────────────
// The check-up is an ADMIN-AUTHORED template (see DATABASE.md
// checkup_template_items). An item is a QUESTION (part 'question', Part 1 — a text
// prompt the player answers with text) or an EXERCISE (part 'exercise', Part 2 — a
// prompt/name + reference video_url + description; the player uploads their own
// clip + a note). Items are class-standard (class_id) OR a per-player override
// (player_id). Resolution: a player's own rows if any exist, else their class's.

export const CHECKUP_PART = { QUESTION: 'question', EXERCISE: 'exercise' };

// Split a flat item list into its two parts, each ordered by order_index.
export function splitTemplateParts(items = []) {
  const byOrder = (a, b) => (a.order_index ?? 0) - (b.order_index ?? 0);
  return {
    questions: items.filter(i => i.part === CHECKUP_PART.QUESTION).sort(byOrder),
    exercises: items.filter(i => i.part === CHECKUP_PART.EXERCISE).sort(byOrder),
  };
}

// The class-standard items for a class (the admin builder's working set).
export async function fetchClassTemplateItems(classId) {
  if (!classId) return [];
  const { data } = await supabase
    .from('checkup_template_items')
    .select('*')
    .eq('class_id', classId)
    .order('order_index', { ascending: true });
  return data ?? [];
}

// A single player's override items (empty = they inherit the class standard).
export async function fetchPlayerTemplateItems(playerId) {
  if (!playerId) return [];
  const { data } = await supabase
    .from('checkup_template_items')
    .select('*')
    .eq('player_id', playerId)
    .order('order_index', { ascending: true });
  return data ?? [];
}

// Resolve the template a player actually fills in: their overrides if any exist,
// else their class standard. `source`: 'player' | 'class' | 'none'.
export async function resolvePlayerTemplate(playerId, classId) {
  const own = await fetchPlayerTemplateItems(playerId);
  if (own.length) return { source: 'player', items: own };
  const cls = await fetchClassTemplateItems(classId);
  return { source: cls.length ? 'class' : 'none', items: cls };
}

// ── Admin item CRUD (scope = { classId } for the class standard, or
//    { playerId } for a per-player override). All require admin RLS. ──
export async function addTemplateItem(scope, item) {
  const { data, error } = await supabase
    .from('checkup_template_items')
    .insert({
      class_id:    scope.classId ?? null,
      player_id:   scope.playerId ?? null,
      part:        item.part,
      prompt:      item.prompt,
      video_url:   item.video_url ?? null,
      description: item.description ?? null,
      order_index: item.order_index ?? 0,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateTemplateItem(id, patch) {
  const { data, error } = await supabase
    .from('checkup_template_items')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteTemplateItem(id) {
  const { error } = await supabase.from('checkup_template_items').delete().eq('id', id);
  if (error) throw error;
}

// Copy a class's standard items onto a player so the admin can trim/edit them for
// that player. No-op (returns existing) if the player already has overrides.
export async function materializePlayerTemplate(playerId, classId) {
  const own = await fetchPlayerTemplateItems(playerId);
  if (own.length) return own;
  const cls = await fetchClassTemplateItems(classId);
  if (!cls.length) return [];
  const rows = cls.map(i => ({
    player_id: playerId, class_id: null,
    part: i.part, prompt: i.prompt, video_url: i.video_url,
    description: i.description, order_index: i.order_index,
  }));
  const { data, error } = await supabase.from('checkup_template_items').insert(rows).select();
  if (error) throw error;
  return data ?? [];
}

// Drop a player's overrides → they fall back to the class standard again.
export async function resetPlayerTemplate(playerId) {
  const { error } = await supabase.from('checkup_template_items').delete().eq('player_id', playerId);
  if (error) throw error;
}

// Make one class's Part-1 QUESTIONS the standard for EVERY class (diet/sleep/etc.
// are universal, unlike the per-class exercises). Copies the source class's
// questions into every other class, REPLACING each class's existing questions so
// they all match. Part-2 exercises are left untouched. Returns the class count.
export async function applyQuestionsToAllClasses(sourceClassId) {
  if (!sourceClassId) return 0;
  const src = await fetchClassTemplateItems(sourceClassId);
  const questions = src.filter(i => i.part === CHECKUP_PART.QUESTION);

  const { data: classes } = await supabase.from('classes').select('id');
  const targets = (classes ?? []).map(c => c.id).filter(id => id !== sourceClassId);

  for (const cid of targets) {
    await supabase.from('checkup_template_items')
      .delete().eq('class_id', cid).eq('part', CHECKUP_PART.QUESTION);
    if (questions.length) {
      const rows = questions.map(q => ({
        class_id: cid, player_id: null, part: CHECKUP_PART.QUESTION,
        prompt: q.prompt, video_url: null, description: null, order_index: q.order_index,
      }));
      const { error } = await supabase.from('checkup_template_items').insert(rows);
      if (error) throw error;
    }
  }
  return targets.length;
}
