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

// THE SPACE POLICY — ONE check-up per player, ever. The moment a player SUBMITS a
// new check-up, every earlier check-up of theirs is wiped: clips, notes, answers
// and the coach's feedback on it. There is no history — what you see is the
// current check-up, and it lives exactly until the next one replaces it.
// Called from CheckupScreen right after a successful submit.
export async function purgePreviousCheckups(studentId, keepId) {
  if (!studentId || !keepId) return;
  try {
    const { data: older } = await supabase
      .from('checkups')
      .select('id')
      .eq('student_id', studentId)
      .neq('id', keepId);
    await deleteCheckups((older ?? []).map(c => c.id));
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
    await deleteCheckups((stale ?? []).map(c => c.id));
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
    const key = v.item_id ?? `__solo_${v.id}`;
    let g = byItem.get(key);
    if (!g) {
      g = { key, item_id: v.item_id ?? null, prompt: v.prompt ?? null, note: null, videos: [] };
      byItem.set(key, g);
      groups.push(g);
    }
    g.videos.push(v);
    if (g.note == null && v.answer_text) g.note = v.answer_text;
  }
  return groups;
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

// Persist a new order for a set of items (writes each row's order_index).
export async function reorderTemplateItems(items = []) {
  await Promise.all(
    items.map((it, i) =>
      supabase.from('checkup_template_items').update({ order_index: i }).eq('id', it.id))
  );
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
