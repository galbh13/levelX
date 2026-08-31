import { supabase } from './supabase';

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
function templateExerciseRows(template, workoutId) {
  return (template.exercises ?? []).map((e, i) => ({
    workout_id:     workoutId,
    letter:         String.fromCharCode(65 + i),
    name:           e.name,
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
