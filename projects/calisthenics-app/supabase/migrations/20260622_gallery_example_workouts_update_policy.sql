-- Fix: editing an example workout silently saved nothing.
-- ─────────────────────────────────────────────────────────────────────────────
-- gallery_example_workouts shipped with SELECT / INSERT / DELETE policies but NO
-- UPDATE policy (see 20260604_gallery_example_workouts.sql). With RLS enabled and
-- no UPDATE policy, an admin's UPDATE matches 0 rows and returns NO error — so the
-- editor's "SAVE CHANGES" appeared to work (it navigated back) but never persisted.
--
-- Add the missing admin UPDATE policy, gated by the same `public.is_admin()`
-- SECURITY DEFINER helper the INSERT/DELETE policies use.
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists "Admin update example workouts" on gallery_example_workouts;
create policy "Admin update example workouts"
  on gallery_example_workouts for update to authenticated
  using ( public.is_admin() )
  with check ( public.is_admin() );
