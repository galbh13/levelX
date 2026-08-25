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

// Copy an admin gallery example workout (exercises/branches stored INLINE in the
// gallery_example_workouts row) into a player's OWN workouts + exercises, so it
// shows in their warehouse and can be scheduled/run like a self-authored workout.
// The copy is independent — later admin edits don't propagate. Returns the new
// workout id.
export async function importGalleryWorkout({ template, studentId, userId }) {
  const { data: w, error } = await supabase
    .from('workouts')
    .insert({
      title:       template.title,
      purpose:     template.description ?? '',
      assigned_to: studentId,
      created_by:  userId,
      branches:    template.branches ?? null,
      category:    template.category ?? null,
    })
    .select()
    .single();
  if (error) throw error;

  const rows = (template.exercises ?? []).map((e, i) => ({
    workout_id:     w.id,
    letter:         String.fromCharCode(65 + i),
    name:           e.name,
    variation:      e.variation ?? null,
    sets:           String(e.sets ?? '').trim(),
    reps:           e.reps ?? '',
    notes:          e.notes ?? '',
    superset_group: e.superset_group ?? null,
    branch:         e.branch ?? null,
  }));
  if (rows.length) {
    const { error: exErr } = await supabase.from('exercises').insert(rows);
    if (exErr) throw exErr;
  }
  return w.id;
}
