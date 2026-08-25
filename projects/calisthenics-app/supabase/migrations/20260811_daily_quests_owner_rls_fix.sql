-- Fix: players can't soft-delete (or edit) legacy daily quests
-- ─────────────────────────────────────────────────────────────────────────────
-- Symptom: quests created BEFORE the 2026-05-22 self-coach refactor (e.g.
-- "GTG", "12,000 steps") could be SEEN but not removed — pressing ✕ did nothing
-- and no error surfaced. Quests the player added AFTER the refactor deleted fine.
--
-- Cause: the live `daily_quests` owner UPDATE/DELETE policy is keyed on
-- `coach_id = auth.uid()` (the pre-refactor "the coach manages the student's
-- quests" rule). Post-refactor the app writes `coach_id = student_id` (self-
-- authored), so new rows pass. Legacy rows still carry the OLD coach's id, so:
--   • the SELECT policy (student_id = auth.uid()) still shows them → they render;
--   • the UPDATE policy (coach_id = auth.uid()) rejects them → 0 rows updated,
--     NO error → the soft-delete silently no-ops.
--
-- Fix, two parts:
--   1. Additive OWNER policies keyed on `student_id` (permissive policies are
--      OR'd, so these GRANT access to your own rows regardless of any stale
--      coach_id-based policy that may still exist — nothing is restricted).
--   2. A one-time backfill so legacy rows are self-consistent (coach_id =
--      student_id, matching the self-coach model). Runs with the service role,
--      which bypasses RLS.
--
-- Safe to re-run: policies are dropped-if-exists first; the backfill is idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Owner policies keyed on student_id (the player owns their own quests) ───────
drop policy if exists "owner select daily quests" on daily_quests;
create policy "owner select daily quests"
  on daily_quests for select to authenticated
  using ( auth.uid() = student_id );

drop policy if exists "owner insert daily quests" on daily_quests;
create policy "owner insert daily quests"
  on daily_quests for insert to authenticated
  with check ( auth.uid() = student_id );

drop policy if exists "owner update daily quests" on daily_quests;
create policy "owner update daily quests"
  on daily_quests for update to authenticated
  using ( auth.uid() = student_id )
  with check ( auth.uid() = student_id );

drop policy if exists "owner delete daily quests" on daily_quests;
create policy "owner delete daily quests"
  on daily_quests for delete to authenticated
  using ( auth.uid() = student_id );

-- 2. Backfill: legacy rows self-authored by the player (coach_id := student_id) ──
update daily_quests
   set coach_id = student_id
 where coach_id is distinct from student_id;
