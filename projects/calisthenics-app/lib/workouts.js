import { supabase } from './supabase';
import { normName } from './exerciseGuide';

// The workout "type" buckets — shared by the gallery example builder, Create /
// Edit Workout, the My Workouts label, and the Accessories picker. Mirrors
// gallery_example_workouts.category. Each carries its signature glow `color`.
export const WORKOUT_CATEGORIES = [
  { k: 'main',      l: 'MAIN QUEST',  color: '#4A9EBF' }, // ice
  { k: 'side',      l: 'SIDE QUEST',  color: '#A98BE0' }, // violet
  { k: 'handstand', l: 'HANDSTAND',   color: '#E27BA6' }, // rose
  { k: 'accessory', l: 'ACCESSORIES', color: '#D9B65A' }, // gold
  { k: 'legs',      l: 'LEGS',        color: '#5FC79A' }, // green
];

// Catch-all for legacy / untyped workouts.
export const UNTYPED_CATEGORY = { k: '__none', l: 'UNTYPED', color: '#5a7794' };

// Full meta ({k,l,color}) for a stored category value — falls back to UNTYPED.
export function categoryMeta(cat) {
  return WORKOUT_CATEGORIES.find(c => c.k === cat) ?? UNTYPED_CATEGORY;
}

// Human label for a stored category value (null/unknown → null = no label).
export function categoryLabel(cat) {
  return WORKOUT_CATEGORIES.find(c => c.k === cat)?.l ?? null;
}

// Insert workout exercise rows, tolerating a live DB that predates the
// `gallery_id` column (schema drift — the 20260701 migration may not be applied).
// If Supabase rejects the insert because `gallery_id` isn't in its schema cache,
// we retry once with that column stripped from every row. `gallery_id` only drives
// Workout Mode's how-to card (which already falls back to name matching), so
// dropping it degrades gracefully instead of failing the whole save.
export async function insertExercises(rows) {
  let { error } = await supabase.from('exercises').insert(rows);
  if (error && /gallery_id/.test(error.message ?? '')) {
    const stripped = rows.map(({ gallery_id, ...rest }) => rest);
    ({ error } = await supabase.from('exercises').insert(stripped));
  }
  return { error };
}


// ── Renaming a catalog exercise ──────────────────────────────────────────────
// A workout row COPIES the movement's name at the moment it's added, so renaming
// the catalog entry used to leave every workout already carrying it on the old
// name — unlike the video, which is resolved live from the catalog on every read
// and therefore updates for everyone the moment it's uploaded. This closes that
// gap by rewriting the copies, so the rename behaves the way the coach expects
// the whole card to behave.
//
// Three places hold a copy, and each is matched the strictest way it can be:
//   1. `exercises` linked by `gallery_id` — an exact link, renamed whatever it
//      currently says;
//   2. `exercises` with NO link still carrying the OLD name exactly — the legacy
//      / free-typed rows, which the how-to card already resolves by name;
//   3. `gallery_example_workouts.exercises` — inline JSONB, matched on the
//      normalized name and rewritten row by row.
// A copy a coach has deliberately typed differently for one player never matches
// any of the three, so per-player wording survives the rename.
//
// Never throws: the rename itself is already saved by the time this runs, and
// failing to update a copy must not read as "the rename failed". Returns what it
// managed to change plus the first `error` it hit.
export async function renameExerciseEverywhere({ galleryId, oldName, newName }) {
  const from = String(oldName ?? '').trim();
  const to   = String(newName ?? '').trim();
  const result = { workouts: 0, templates: 0, error: null };
  if (!from || !to || from === to) return result;

  const fail = (e) => { if (e && !result.error) result.error = e; };

  // 1 — exact catalog links.
  if (galleryId) {
    const { data, error } = await supabase
      .from('exercises').update({ name: to }).eq('gallery_id', galleryId).select('id');
    // A live DB predating the `gallery_id` column has no links to fix; that is
    // not a failure, step 2 covers those rows by name.
    if (error && !/gallery_id/.test(error.message ?? '')) fail(error);
    result.workouts += data?.length ?? 0;
  }

  // 2 — unlinked rows still on the old name. Case-insensitive, but still an
  // EXACT name: `ilike` with the LIKE wildcards escaped, never a contains match.
  const pattern = from.replace(/[\\%_]/g, m => `\\${m}`);
  let { data: byName, error: nameErr } = await supabase
    .from('exercises')
    .update({ name: to })
    .is('gallery_id', null)
    .ilike('name', pattern)
    .select('id');
  // Same schema-drift guard as step 1: with no `gallery_id` column, EVERY row
  // carrying the old name is an unlinked one.
  if (nameErr && /gallery_id/.test(nameErr.message ?? '')) {
    ({ data: byName, error: nameErr } = await supabase
      .from('exercises').update({ name: to }).ilike('name', pattern).select('id'));
  }
  if (nameErr) fail(nameErr); else result.workouts += byName?.length ?? 0;

  // 3 — library templates (exercises live inline as JSONB, so this is a
  // read-modify-write; the table is small enough to scan).
  const target = normName(from);
  const { data: templates, error: tErr } = await supabase
    .from('gallery_example_workouts').select('id, exercises');
  if (tErr) { fail(tErr); return result; }

  for (const t of templates ?? []) {
    let touched = false;
    const next = (t.exercises ?? []).map(e => {
      if (normName(e?.name) !== target) return e;
      touched = true;
      return { ...e, name: to };
    });
    if (!touched) continue;
    const { error } = await supabase
      .from('gallery_example_workouts').update({ exercises: next }).eq('id', t.id);
    if (error) fail(error); else result.templates += 1;
  }

  return result;
}

// ── Deleting a catalog exercise ──────────────────────────────────────────────
// Deleting a movement from the library used to leave it standing in every
// workout already carrying it — a copy of a movement that no longer exists,
// with its how-to card gone (the `gallery_id` link is SET NULL by the FK, and
// the name fallback now matches nothing), and no sign anything happened. These
// helpers find those copies and take them out along with the catalog entry.
//
// Copies are matched exactly the way `renameExerciseEverywhere` matches them —
// catalog link first, then unlinked rows carrying the exact name — so a
// movement a coach deliberately typed differently for one player is never
// caught by a delete either.

// Every workout `exercises` row that is a copy of this catalog movement.
// Returns `{ rows: [{ id, workout_id }], error }`; never throws.
async function findWorkoutCopies({ galleryId, name }) {
  const out = { rows: [], error: null };
  const seen = new Set();
  const fail = (e) => { if (e && !out.error) out.error = e; };
  const add = (list) => {
    for (const r of list ?? []) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.rows.push(r);
    }
  };

  // 1 — exact catalog links. A live DB predating `gallery_id` has none; that is
  // not a failure, step 2 covers those rows by name.
  if (galleryId) {
    const { data, error } = await supabase
      .from('exercises').select('id, workout_id').eq('gallery_id', galleryId);
    if (error && !/gallery_id/.test(error.message ?? '')) fail(error);
    else add(data);
  }

  // 2 — unlinked rows still carrying the exact name (LIKE wildcards escaped, so
  // this is an exact case-insensitive match, never a contains match).
  const from = String(name ?? '').trim();
  if (from) {
    const pattern = from.replace(/[\\%_]/g, m => `\\${m}`);
    let { data, error } = await supabase
      .from('exercises').select('id, workout_id').is('gallery_id', null).ilike('name', pattern);
    if (error && /gallery_id/.test(error.message ?? '')) {
      ({ data, error } = await supabase
        .from('exercises').select('id, workout_id').ilike('name', pattern));
    }
    if (error) fail(error); else add(data);
  }

  return out;
}

// True when a library template's inline exercise entry is a copy of this movement.
function templateEntryMatches(entry, { galleryId, target }) {
  if (galleryId && entry?.gallery_id === galleryId) return true;
  return Boolean(target) && normName(entry?.name) === target;
}

// How many places a catalog movement is currently used — asked BEFORE the
// delete, so the confirmation can say what is about to come out of players'
// workouts instead of it happening silently. Never throws.
export async function findExerciseUsage({ galleryId, name }) {
  const result = { workouts: 0, exercises: 0, templates: 0, error: null };
  const fail = (e) => { if (e && !result.error) result.error = e; };

  const { rows, error } = await findWorkoutCopies({ galleryId, name });
  if (error) fail(error);
  result.exercises = rows.length;
  result.workouts  = new Set(rows.map(r => r.workout_id).filter(Boolean)).size;

  const target = normName(name);
  const { data: templates, error: tErr } = await supabase
    .from('gallery_example_workouts').select('id, exercises');
  if (tErr) { fail(tErr); return result; }
  result.templates = (templates ?? []).filter(t =>
    (t.exercises ?? []).some(e => templateEntryMatches(e, { galleryId, target }))
  ).length;

  return result;
}

// Take a catalog movement out of every workout and library template holding a
// copy of it. Call this BEFORE deleting the `exercises_gallery` row — once that
// row is gone the FK has already nulled every `gallery_id`, leaving only the
// weaker name match to find the copies.
//
// Each touched workout is re-lettered so it still reads A, B, C with no hole
// where the movement was, and a superset left with a single member is unpaired
// (a "parallel" group of one is just a normal exercise).
//
// Never throws: returns what it managed to remove plus the first `error` hit.
export async function deleteExerciseEverywhere({ galleryId, name }) {
  const result = { workouts: 0, exercises: 0, templates: 0, error: null };
  const fail = (e) => { if (e && !result.error) result.error = e; };

  const { rows, error } = await findWorkoutCopies({ galleryId, name });
  if (error) fail(error);

  const ids        = rows.map(r => r.id);
  const workoutIds = [...new Set(rows.map(r => r.workout_id).filter(Boolean))];

  // Chunked so a movement used in hundreds of workouts can't blow the URL length.
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const { error: delErr } = await supabase.from('exercises').delete().in('id', chunk);
    if (delErr) fail(delErr); else result.exercises += chunk.length;
  }

  // Tidy every workout the delete left a gap in.
  for (const wid of workoutIds) {
    const { data: left, error: lErr } = await supabase
      .from('exercises')
      .select('id, letter, superset_group')
      .eq('workout_id', wid)
      .order('letter', { ascending: true });
    if (lErr) { fail(lErr); continue; }
    result.workouts += 1;

    const groupCounts = new Map();
    for (const r of left ?? []) {
      if (r.superset_group == null) continue;
      groupCounts.set(r.superset_group, (groupCounts.get(r.superset_group) ?? 0) + 1);
    }

    for (let i = 0; i < (left ?? []).length; i++) {
      const row   = left[i];
      const patch = {};
      // Letters only ever shrink here, so writing them in ascending order can
      // never collide with a row that hasn't been renumbered yet.
      const letter = String.fromCharCode(65 + i);
      if (row.letter !== letter) patch.letter = letter;
      if (row.superset_group != null && groupCounts.get(row.superset_group) === 1) {
        patch.superset_group = null;
      }
      if (!Object.keys(patch).length) continue;
      const { error: uErr } = await supabase.from('exercises').update(patch).eq('id', row.id);
      if (uErr) fail(uErr);
    }
  }

  // Library templates hold their exercises inline as JSONB — read-modify-write,
  // same as the rename does.
  const target = normName(name);
  const { data: templates, error: tErr } = await supabase
    .from('gallery_example_workouts').select('id, exercises');
  if (tErr) { fail(tErr); return result; }

  for (const t of templates ?? []) {
    const before = t.exercises ?? [];
    const next   = before.filter(e => !templateEntryMatches(e, { galleryId, target }));
    if (next.length === before.length) continue;
    const { error: uErr } = await supabase
      .from('gallery_example_workouts').update({ exercises: next }).eq('id', t.id);
    if (uErr) fail(uErr); else result.templates += 1;
  }

  return result;
}

// The `workouts` columns added by 20260830_workout_template_link.sql. The live
// DB has historically lagged the migrations, and PostgREST fails the WHOLE
// write when it sees a column it doesn't know — which would break saving a
// workout entirely. Same defensive shape as insertExercises above: retry once
// with these stripped, so an unmigrated DB just loses "return to normal"
// instead of losing the ability to edit workouts.
const TEMPLATE_LINK_COLS = ['source_template_id', 'customized_at'];

// Run a `workouts` write, retrying once without the template-link columns if the
// live DB doesn't know them yet. `run(payload)` builds the Supabase query, so the
// same fallback serves an insert and an update. Returns the Supabase result.
async function writeWorkoutTolerant(run, payload) {
  const res = await run(payload);
  const msg = res.error?.message ?? '';
  if (!TEMPLATE_LINK_COLS.some(c => msg.includes(c))) return res;

  const stripped = { ...payload };
  for (const c of TEMPLATE_LINK_COLS) delete stripped[c];
  return run(stripped);
}

// Build the exercise rows for a workout from a gallery template's inline
// `exercises` JSON. Shared by the initial import and by the revert, so a
// reverted workout is byte-for-byte what a fresh import would have produced.
// The same rows, but for READING a template instead of importing it — the
// library preview renders a gallery example with the player's own workout
// screen, and that screen expects letters, notes and a stable key on every
// exercise. Built off templateExerciseRows so a preview can never show a
// different workout than the import would produce.
export function templateExercisePreview(template) {
  return templateExerciseRows(template, null).map((row, i) => {
    const { workout_id, ...rest } = row;
    return { ...rest, id: `t${i}` };
  });
}

function templateExerciseRows(template, workoutId) {
  return (template.exercises ?? []).map((e, i) => ({
    workout_id:     workoutId,
    letter:         String.fromCharCode(65 + i),
    name:           e.name,
    // Carried from the template so an imported workout links to the catalog
    // exactly — a later rename reaches it by id, not by name. Older templates
    // have none; `insertExercises` also tolerates a DB without the column.
    gallery_id:     e.gallery_id ?? null,
    variation:      e.variation ?? null,
    sets:           String(e.sets ?? '').trim(),
    reps:           e.reps ?? '',
    notes:          e.notes ?? '',
    superset_group: e.superset_group ?? null,
    branch:         e.branch ?? null,
  }));
}

// Patch a workout's metadata (title / purpose / branches / category, and the
// template-link columns). The one place those columns are written, so the
// missing-column fallback lives here instead of at each call site.
export async function updateWorkoutMeta(workoutId, patch) {
  const { error } = await writeWorkoutTolerant(
    p => supabase.from('workouts').update(p).eq('id', workoutId),
    patch,
  );
  return { error };
}

// Swap a workout's whole exercise list. The ONE copy of the delete-then-insert
// dance (including the pause that lets the delete commit before the insert) —
// both the edit screen's save and the revert go through here, so the timing
// workaround can never drift between them. `stage` names which half failed, so
// callers can keep reporting "Delete failed" vs "Insert failed".
export async function replaceWorkoutExercises(workoutId, rows) {
  const { error: delError } = await supabase
    .from('exercises').delete().eq('workout_id', workoutId);
  if (delError) return { error: delError, stage: 'delete' };

  await new Promise(r => setTimeout(r, 300));

  if (!rows.length) return { error: null };
  const { error: insertError } = await insertExercises(rows);
  return { error: insertError ?? null, stage: insertError ? 'insert' : undefined };
}

// Copy an admin gallery example workout (exercises/branches stored INLINE in the
// gallery_example_workouts row) into a player's OWN workouts + exercises, so it
// shows in their warehouse and can be scheduled/run like a self-authored workout.
// The copy is independent — later admin edits don't propagate, but the copy
// remembers its origin (source_template_id) so a coach can snap it back to the
// current library version later. Returns the new workout id.
export async function importGalleryWorkout({ template, studentId, userId }) {
  const { data: w, error } = await writeWorkoutTolerant(
    p => supabase.from('workouts').insert(p).select().single(),
    {
      title:              template.title,
      purpose:            template.description ?? '',
      assigned_to:        studentId,
      created_by:         userId,
      branches:           template.branches ?? null,
      category:           template.category ?? null,
      source_template_id: template.id ?? null,
    },
  );
  if (error) throw error;

  // Inserted directly, NOT through replaceWorkoutExercises — the row is brand
  // new, so there is nothing to delete and no commit to wait on.
  const rows = templateExerciseRows(template, w.id);
  if (rows.length) {
    const { error: exErr } = await insertExercises(rows);
    if (exErr) throw exErr;
  }
  return w.id;
}

// True when this workout is a library copy that a coach has since edited for
// this player — i.e. "return to normal" has something to undo. A workout with
// no template link (authored from scratch) has no "normal" to go back to.
export function isCustomizedCopy(workout) {
  return Boolean(workout?.source_template_id && workout?.customized_at);
}

// "RETURN TO NORMAL" — throw away this player's customizations and rebuild the
// workout from the CURRENT library version of its template.
//
// Deliberately reuses the same workouts row instead of delete-and-reimport, so
// the player's weekly_workout_template scheduling (and anything else keyed on
// workout_id) survives the revert. Only the contents are swapped.
export async function revertWorkoutToTemplate(workout) {
  if (!workout?.source_template_id) {
    throw new Error('This workout was built from scratch — there is no library version to return to.');
  }

  // Fetched BEFORE anything is destroyed: a missing template must abort the
  // revert with the player's custom version still intact.
  const { data: template, error: tErr } = await supabase
    .from('gallery_example_workouts')
    .select('id, title, description, exercises, branches, category')
    .eq('id', workout.source_template_id)
    .maybeSingle();
  if (tErr) throw tErr;
  if (!template) {
    throw new Error('The library program this was copied from no longer exists.');
  }

  const { error: wErr } = await updateWorkoutMeta(workout.id, {
    title:         template.title,
    purpose:       template.description ?? '',
    branches:      template.branches ?? null,
    category:      template.category ?? null,
    customized_at: null,               // back in sync with the library
  });
  if (wErr) throw wErr;

  const { error: exErr } = await replaceWorkoutExercises(
    workout.id, templateExerciseRows(template, workout.id),
  );
  if (exErr) throw exErr;
}


// ── Set counts: fixed, range, or ACCUMULATE ─────────────────────────────────
// A workout's `sets` field carries three shapes, all authored as plain text:
//   "3"    fixed — three sets, all required
//   "1-2"  range — one required, a second offered as bonus
//   "???"  ACCUMULATE — no set count at all. The player owes a TOTAL number of
//          reps (the `reps` field) and splits it however the day allows:
//          50 = 20/20/10 or 20/15/15 or ten sets of 5. Rows appear one at a
//          time as they're filled, up to MAX_ACCUM_SETS.
export const ACCUM_TOKEN     = '???';
export const MAX_ACCUM_SETS  = 12;

// One, two or three question marks all read as accumulate — "?" is what a
// player types on a phone keyboard, "???" is what the coach means.
export function isAccumulate(sets) {
  return /^\?{1,3}$/.test(String(sets ?? '').trim());
}

// The rep TOTAL an accumulate exercise owes: the first number in `reps`
// ("50", "50 total", "50 each side" → 50). 0 = no numeric target, in which
// case the exercise falls back to "one logged set finishes it".
export function accumTarget(reps) {
  const m = String(reps ?? '').match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

// `required` = must-do sets, `total` = rows to render (upper bound). For an
// accumulate exercise both are 1 — the row count is driven by what the player
// logs, not by the field — and `accumulate` is the flag every caller branches on.
export function parseSets(sets) {
  const s = String(sets ?? '').trim();
  if (isAccumulate(s)) return { required: 1, total: 1, accumulate: true };
  const m = s.match(/^(\d+)\s*[-–]\s*(\d+)$/);
  if (m) {
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    if (a >= 1 && b >= a) return { required: a, total: b, accumulate: false };
  }
  const n = parseInt(s, 10);
  const c = Number.isFinite(n) && n > 0 ? n : 1;
  return { required: c, total: c, accumulate: false };
}

// Reps banked so far on an accumulate exercise = the sum of every set the
// player has actually CHECKED. A number typed but not checked isn't done yet.
export function accumDone(setLog) {
  return (setLog ?? []).reduce(
    (a, s) => a + (s.done ? (parseInt(s.reps, 10) || 0) : 0), 0);
}

// How many rows an accumulate exercise should show: everything up to the LAST
// row carrying something, plus one empty row to spam into — clamped to
// [1, MAX_ACCUM_SETS].
//
// Keyed on the last filled INDEX, not on a count, so the ladder retracts as
// cleanly as it grows: unchecking sets 12 and 11 drops row 12, unchecking down
// to 8 drops 9-12. Only trailing EMPTY rows are ever dropped — a hole in the
// middle (set 5 unchecked while 9 is still logged) holds every row below it,
// because that hole is a set the player might still come back and fill.
export function accumRows(setLog) {
  const rows = setLog ?? [];
  let last = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]?.done || String(rows[i]?.reps ?? '').trim()) last = i;
  }
  return Math.max(1, Math.min(MAX_ACCUM_SETS, last + 2));
}
