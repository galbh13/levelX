# Calisthenics App — Database Reference

> Upload this file to your project knowledge so Claude Code always has full DB context.

---

## Schema Source Provenance

Only three tables have `CREATE TABLE` statements in the repo:

- `profiles`, `workouts`, `exercises` — defined in [lib/schema.sql](lib/schema.sql).

Everything else (`classes`, `class_quests`, `student_quest_completions`,
`exercises_gallery`, `workout_override_workouts`,
`daily_quests`, `daily_quest_completions`)
was created directly in the Supabase dashboard with no migration file. The
extended `profiles` columns (`current_lvl`, `prestige_count`, `class_id`) were
also added via dashboard. (`total_exp` was dropped 2026-06-05 when EXP was
removed from the app — see `migrations/20260605_drop_total_exp.sql`.)

> **Self-coach refactor (2026-05-22):** the `coach` and `student` roles were
> collapsed into a single `player` role, and the entire Checkup system
> (`checkups`, `checkup_questions`, `checkup_answers`, `checkup_exercises`,
> `checkup_uploads` + the `checkup-videos` storage bucket) was dropped. See
> [supabase/migrations/20260522_self_coach_refactor.sql](supabase/migrations/20260522_self_coach_refactor.sql).
> Each player now authors their own content, so `workouts.created_by`,
> `daily_quests.coach_id`, and `workout_override_workouts.coach_id` all equal the
> player's own id. `profiles.coach_id` is kept but unused (always NULL).

The [supabase/migrations/](supabase/migrations/) folder only contains
`class_quests` data/structure fixes — it is **not** a complete schema history.
**This file (DATABASE.md) is the source of truth for table structure.** When
you change the schema in the dashboard, update this file in the same task
(see CLAUDE.md "Database Documentation Rule").

**Confirmed legacy / dead tables** — exist in the Supabase dashboard but are
no longer used by the app. Safe to delete manually from the dashboard:

- `workout_overrides`
- `weekly_templates`
- `weekly_template_workouts`

---

## Auth & Connection

- **Provider:** Supabase Auth (email/password)
- **Client:** `lib/supabase.js` — imported as `supabase` across all screens
- **Session routing:** `App.js` reads `supabase.auth.getSession()` on mount,
  then fetches `profiles.role` to route the user (`admin` → AdminNavigator;
  everyone else → PlayerApp, the self-coaching app).
- **New user trigger:** A Postgres function `handle_new_user()` auto-inserts a
  row into `profiles` whenever a new `auth.users` row is created (trigger:
  `on_auth_user_created`). It sets `id`, `email`, and `role = 'player'`.
  `full_name` / `class_id` are set later in-app.

---

## Row Level Security (RLS)

RLS is **enabled** on all tables. The base policies defined in `lib/schema.sql`
are conservative starting points — the app often bypasses them in practice by
using service-role or by relying on flows built before full RLS hardening.
Since the self-coach refactor, `assigned_to` and `created_by` are the same
player, so both workout policies resolve to "the player sees their own work."
Key policies:

| Table       | Policy | Rule |
|-------------|--------|------|
| `profiles`  | Users can view own profile | `auth.uid() = id` |
| `workouts`  | Players see workouts assigned to them | `auth.uid() = assigned_to` |
| `workouts`  | Players see workouts they created | `auth.uid() = created_by` |
| `exercises` | Visible with parent workout | workout's `assigned_to` or `created_by` = `auth.uid()` |

> **Note:** Many newer tables (class_quests, daily_quests, etc.) were added via
> migrations and may have broader or no RLS policies. Always check before
> adding queries that touch sensitive data.

> **Admin-as-coach override (2026-06-21).** `migrations/20260621_admin_manage_players.sql`
> adds ADDITIVE `public.is_admin()` policies so admins can manage any player's
> data (the roster taps through to `PlayerAdminScreen` → the self-coach screens).
> Permissive policies are OR'd, so each player keeps owner-only access; these only
> grant admins extra access. Tables covered: `profiles` (admin select + update),
> `student_quest_completions`, `workouts`, `exercises`, `weekly_workout_template`,
> `workout_override_workouts`, `daily_quests`, `daily_quest_completions` (all
> `FOR ALL` via `is_admin()`). **Must be applied to the live Supabase** or admin
> edits silently fail against the owner-only base policies.

---

## Tables

### `profiles`
The central user table. One row per auth user.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | References `auth.users(id)` |
| `email` | text | Copied from auth on sign-up |
| `full_name` | text | Set manually |
| `role` | text | `'admin'` or `'player'` (default `'player'`). Coach/student roles removed in self-coach refactor. |
| `coach_id` | uuid | FK → `profiles(id)`. **Legacy / unused** since self-coach refactor — always NULL. |
| `current_lvl` | integer | **Legacy / unused** — LVL is computed from completions, not stored (see [lib/computeLvl.js](lib/computeLvl.js)) |
| `prestige_count` | integer | How many times the player has prestiged |
| `class_id` | uuid | FK → `classes(id)`. NULL = no class assigned |
| `nickname` | text | Short display handle, separate from `full_name`. Set on the Profile tab. NULL = none. Added in `migrations/20260607_profile_fields.sql`. |
| `bio` | text | One-sentence profile tagline. Set on the Profile tab. NULL = none. Added in `migrations/20260607_profile_fields.sql`. (Replaced the removed `guiding_phrase` column.) |
| `avatar_url` | text | Public URL of the player's uploaded profile picture (in the `avatar` storage bucket). NULL = none. Added in `migrations/20260607_profile_fields.sql`. |
| `created_at` | timestamptz | Auto |

> **`guiding_phrase` removed (2026-06-07)** in `migrations/20260607_profile_fields.sql`.
> The profile "sentence" now lives in the new `bio` column, edited on the Profile tab.

**Used by:** Every screen. AdminDashboard reads all `player` profiles for the
read-only roster. Each player reads/writes their own profile (class_id,
prestige_count) for the HUD and self class management. ProfileScreen (Profile
tab) reads/writes the player's own `full_name`, `nickname`, `bio`, `avatar_url`.

---

### `classes`
Defines the class tiers (Class I, Class II, etc.). Dynamic — never hardcode count.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `name` | text | e.g. `'Class I'`, `'Class II'` |
| `order_index` | integer | 0 = first class, 1 = second, etc. |
| `description` | text | Flavor text for the class |
| `prestige_at` | integer | LVL gate for prestige (85/100/160 for Class I/II/III; default 80 for any class predating the value). This is ONLY the level gate — the full prestige check (main quests + 1 Tier II skill) lives in [lib/prestige.js](lib/prestige.js), not the DB. The bar's MAX is **derived** — sum of all `lvl_reward` in the class — so only this threshold is stored. |

**Used by:** SkillsScreen, QuestTreeScreen, HomeScreen. Always fetched
dynamically — never hardcode class names or count. The progress bar scales each
class to its own max (Σ `lvl_reward`) and draws the prestige marker at
`prestige_at`.

---

### `class_quests`
Every quest node in the quest tree (both main and side quests) for every class.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `class_id` | uuid | FK → `classes(id)` |
| `quest_type` | text | `'main'` or `'side'` |
| `chain` | text | Groups quests into a skill chain, e.g. `'oapu'`, `'handstand'`, `'hspu'` |
| `branch` | text | Sub-path within a chain, e.g. `'negative'`, `'active_hold'`, `'band'`, `'power'`, `'balance'`, `'mobility'`, `'freestanding'` |
| `order_index` | integer | Position within a branch |
| `name` | text | Quest display name |
| `lvl_reward` | integer | Level points awarded on completion |
| `is_convergence` | boolean | True = node where multiple branches merge |
| `prerequisites` | uuid[] | Array of quest IDs that must be completed first |
| `requirement_text` | text | Optional human-readable prerequisite description |

**Quest tree logic:**
- A node is **unlocked** when all IDs in `prerequisites` are in the player's completions.
- A node is **done** when its ID exists in `student_quest_completions` for that player.
- Convergence nodes (`is_convergence = true`) require ALL prerequisite branches to be done.
- Class I quests use `branch = 'main'` and linear sequential prerequisites.
- Class II quests use multi-branch trees with cross-branch convergence nodes.
- Class III (`order_index = 2`) introduces a **tier** concept implemented
  **purely via `prerequisites` — no schema change, no tier column**. Each chain
  (`front_lever`, `planche`) has Tier 1 and Tier 2 branches that share branch
  names (e.g. `hold`, `raises`, `negative`). `order_index` is **continuous
  within a branch across tiers** (Tier 1 = 0..N, Tier 2 = N+1..M). The **first
  node of every Tier 2 branch is a convergence node** (`is_convergence = true`)
  whose `prerequisites` are the **last nodes of every Tier 1 branch in the same
  chain**. Node names collide across chains, so all prereq UPDATEs are scoped by
  `chain` (see `supabase/migrations/20260519_class3_main_quests.sql`).
- Class III **side quests** (`quest_type='side'`) also use tiers, gated
  **cross-chain**: Tier 1 side chains are `vsit` + `hs_beginners`; Tier 2 side
  chains are `isit`, `back_lever`, `hspu_90`. Side quests use **named branches**
  (unlike Class II side quests, which had `branch = NULL`). The first node of
  every Tier 2 side branch is a convergence node whose `prerequisites` = the last
  (max `order_index`) node of every branch of **both** Tier 1 side chains — so a
  Tier 2 side quest unlocks only after ALL Tier 1 side quests are done. No schema
  change; see `supabase/migrations/20260519_class3_side_quests.sql`.
- Class I **side quests** (`quest_type='side'`) use the same cross-chain tier
  pattern. After the 2026-06-30 swap, Tier 1 side chains are `frog`,
  `kick-up muscle-up`, and `l-sit` (branch `main`); Tier 2 side chains are
  `headstand` (branches `disconnection`, `freestanding`), `pull over`,
  `archer pull up`, `archer push up` (branch `main`). NOTE: live `chain` slugs are
  human strings with hyphens/spaces (e.g. `kick-up muscle-up`, `l-sit`), NOT the
  underscore slugs in the older migration files — the swap migration matches them
  by normalized name. Each Tier 2 chain's first node is a convergence whose
  `prerequisites` = the last node of every Tier 1 side branch (3 leaves: Frog
  10 sec + the kick-up muscle-up leaf + the l-sit leaf). All
  `lvl_reward = 0`. See `supabase/migrations/20260522_class1_side_quests.sql`
  (original) and `supabase/migrations/20260630_class1_swap_headstand_kickup_tiers.sql`
  (the headstand↔kick_up_muscle_up tier swap). (Class I MAIN quests still use the
  simple linear `branch = 'main'` pattern.)

**UI convention (all classes):** both main AND side quests render as one chain
card per distinct `chain`, on SkillsScreen. Tapping a card opens `QuestTree` with
`{ classId, chain, questType }`; the tree fetch filters by `class_id` + `chain` +
`quest_type`. Since the self-coach refactor `QuestTreeScreen` is **interactive** —
the player taps a node to toggle their own completion (same generic
`student_quest_completions` write for main and side, `student_id` = self).

**Used by:** QuestTreeScreen + SkillsScreen (both player-facing, self-scoped).

---

### `student_quest_completions`
Junction table — records which quests each student has completed.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `student_id` | uuid | FK → `profiles(id)` |
| `quest_id` | uuid | FK → `class_quests(id)` |
| `completed_at` | timestamptz | Auto (presumably) |

**Written by:** QuestTreeScreen when the player toggles their own quest
completion. LVL is **computed** from these rows per class (see
[lib/computeLvl.js](lib/computeLvl.js)) — `profiles.current_lvl` is no longer
read or written.

**Read by:** QuestTreeScreen, SkillsScreen, HomeScreen, WorkoutsScreen (to
compute and show LVL / node states).

---

### `workouts`
Workout templates a player creates for themselves (`assigned_to` = `created_by` = self).

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `title` | text | e.g. `'PULL DAY A'` |
| `purpose` | text | Optional goal description |
| `assigned_to` | uuid | FK → `profiles(id)` — the student |
| `created_by` | uuid | FK → `profiles(id)` — the author (= the player, same as `assigned_to`) |
| `scheduled_date` | date | Original scheduled date (mostly legacy) |
| `category` | text | **Workout type/label.** One of `'main'` / `'side'` / `'accessory'` / `'legs'` (mirrors `gallery_example_workouts.category`); `NULL` = untyped (legacy rows). CHECK `workouts_category_check`. Chosen in Create/Edit Workout, copied from the gallery row on elite import, and shown as a label on the My Workouts card. Added in `migrations/20260630_workout_category.sql`. |
| `branches` | jsonb | **Workout fork.** `NULL` = no fork. Otherwise a 2-element array of `{ "key": "a"|"b", "label": "..." }` defining the two alternative endings (labels shown in Workout Mode's "choose your path" prompt). Lives on the workout — not the exercises — so an *empty* branch (the "end here" option) still has a name. Added in `supabase/migrations/20260613_workout_branching.sql`. |
| `created_at` | timestamptz | Auto |

**Used by:** WorkoutsScreen, WorkoutDetailScreen, WorkoutEditScreen,
CreateWorkoutScreen, StudentDetailScreen (the self Manage hub).

---

### `exercises`
Individual exercises belonging to a workout.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `workout_id` | uuid | FK → `workouts(id)` ON DELETE CASCADE |
| `letter` | text | Display order letter, e.g. `'A'`, `'B'`, `'C'` |
| `name` | text | Exercise name |
| `sets` | text | A count (`'3'`) or a **range** (`'1-2'`). For a range the lower bound is the REQUIRED sets and the extra sets up to the upper bound are OPTIONAL (bonus) — Workout Mode shows the optional sets muted and they don't block completion. Was integer until `migrations/20260622_exercise_sets_text.sql` changed it to text (mirrors `reps`). |
| `reps` | text | String because can be `'8-12'` or `'MAX'` etc. |
| `notes` | text | Coach notes for the exercise |
| `variation` | text | **Per-exercise-instance free-text "variation"** — instructions/focus attached to the exercise INSIDE this workout, editable any time and independent of the library exercise it was picked from (e.g. a focus that changes each cycle). NULL = none. Shown under the name in WorkoutDetail / Workout Mode. Added in `migrations/20260622_exercise_variation.sql`. Gallery example workouts store the same key inline in their `exercises` JSONB. |
| `superset_group` | smallint | **Parallel grouping (supersets).** Exercises in the same workout sharing the same non-null value are done in parallel — in Workout Mode all must be completed but their order doesn't matter. `NULL` = standalone. Grouped exercises are stored consecutively (group runs are contiguous in `letter` order). Set in the workout builder (Create/Edit Workout). Added in `supabase/migrations/20260613_exercise_superset_group.sql`. |
| `branch` | text | **Workout fork (see `workouts.branches`).** `NULL` = trunk (common, done before the split). `'a'` / `'b'` = belongs to that branch (shown only if the player picks it in Workout Mode). **`'merge'`** = post-fork common "ending" — done by everyone AFTER their chosen path rejoins (lets a shared finisher be authored once instead of duplicated in both branches). Run order: trunk → chosen branch → merge. `'a'`/`'b'`/`'merge'` added on top of the original branching in `supabase/migrations/20260613_workout_branching.sql` (no schema change — `branch` is free text). |
| `gallery_id` | uuid | **Catalog link** — FK → `exercises_gallery(id)` ON DELETE SET NULL. The gallery exercise this row was picked from in the builder; drives Workout Mode's **how-to card** (video + coaching cues) by a stable id instead of fragile name matching. NULL for legacy/free-text/imported rows (Workout Mode falls back to a normalized-name match on `exercises_gallery.name`). Set by Create/Edit Workout. Added in `migrations/20260701_exercise_gallery_id.sql`. |

**Used by:** WorkoutDetailScreen (fetches via `workout_id`), WorkoutEditScreen,
CreateWorkoutScreen, WorkoutModeScreen (how-to card via `gallery_id` → name fallback).

---

### `exercises_gallery`
Master library of all exercises. Used as the source when players build workouts.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `name` | text | Exercise name |
| `movement_type` | text | See valid values below. CHECK constraint `exercises_gallery_movement_type_check`. |
| `youtube_url` | text | Full YouTube URL (optional) |
| `description` | text | Optional description |
| `coaching_cues` | text | Newline-separated coaching cues. (Re)added to the live table in migration `20260604_gallery_add_exercise_fixes.sql`. |
| `min_class_order` | integer | Legacy scalar target class: `0`=Class I, `1`=Class II, `2`=Class III, `NULL`=all classes. Added in migration `20260604_gallery_class_field.sql`. Now kept as the **minimum** of `class_orders` for ordering/back-compat; prefer `class_orders`. |
| `class_orders` | integer[] | Full set of class `order_index` values this exercise targets (an exercise can target several). `NULL`/empty = all classes. Added in migration `20260621_multi_target_class.sql`. |
| `video_url` | text | Public URL of a video uploaded to the `exercise-videos` Supabase Storage bucket. Takes priority over `youtube_url` in detail view. Added in migration `20260604_gallery_video_url.sql`. |
| `created_by` | uuid | FK → `profiles(id)` |

**movement_type values (current):** `'Pull'`, `'Push'`, `'Balance'`, `'Legs'`, `'Core'`, `'Mobility'`, `'Flexibility'`, `'Isolated'`
(`'Core'` added in `migrations/20260622_movement_type_core.sql`; `'Isolated'` added in `migrations/20260623_movement_type_isolated.sql`, which also renamed the briefly-used `'Accessories'` value to `'Isolated'`)  
*(Old values `Strength`, `Skill`, `Conditioning` are no longer used in the UI but remain
permitted by the CHECK constraint so legacy rows still validate.)*

**RLS:** INSERT is admin-only via policy `Admin insert exercises`
(`WITH CHECK (public.is_admin())`). `is_admin()` is a `SECURITY DEFINER` helper that
checks `profiles.role = 'admin'` without being blocked by `profiles`' own RLS. Both
the policy and the movement_type constraint were added/corrected in migration
`20260604_gallery_add_exercise_fixes.sql`.

**Storage:** exercise demo videos are stored in the `exercise-videos` Supabase Storage bucket (must be created as **public** in the Supabase dashboard).

**Used by:** ExerciseGalleryScreen, ExerciseDetailScreen, AddExerciseScreen,
WorkoutEditScreen, WorkoutDetailScreen (for YouTube links).

---

### Scheduling model — skeleton + per-date overrides (2026-06-06)
Two layers resolved at read time by [lib/schedule.js](lib/schedule.js):
- **`weekly_workout_template`** — the recurring weekly SKELETON, keyed by
  `day_of_week`. Edited in the Manage hub (StudentDetailScreen). The default plan
  that repeats every week.
- **`workout_override_workouts`** — per-SPECIFIC-DATE rows. An override for a date
  **wins** over the skeleton for that date, and carries the `completed` flag.

**Resolution for a date:** if any `workout_override_workouts` rows exist for that
exact date, use them; otherwise show the `weekly_workout_template` rows for that
weekday (virtual, not stored). The first time a template-derived date is completed
or edited, the day is **materialized** — its weekday template is copied into
`workout_override_workouts` rows for that date — so completion/edits attach to the
date. "Reset to weekly plan" deletes a date's override rows so it follows the
skeleton again. Resolution lives in `resolveDayWorkouts` / `materializeDay`.

### `weekly_workout_template`
The recurring weekly skeleton. Migration:
`migrations/20260606_weekly_workout_template.sql`.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `student_id` | uuid | FK → `profiles(id)` ON DELETE CASCADE (the player) |
| `coach_id` | uuid | FK → `profiles(id)` — equals the player's own id (self) |
| `day_of_week` | smallint | 0=Sun … 6=Sat, CHECK 0..6 |
| `workout_id` | uuid | FK → `workouts(id)` ON DELETE CASCADE |
| `created_at` | timestamptz | Auto |
| UNIQUE (`student_id`, `day_of_week`, `workout_id`) | | no dup per weekday |

**Index:** `(student_id)`. **RLS:** owner CRUD (`auth.uid() = student_id`).

**Used by:** StudentDetailScreen (skeleton editor), WorkoutsScreen + HomeScreen
(read-time resolution), CreateWorkoutScreen (assign a new workout to a weekday).

---

### `workout_override_workouts`
Per-specific-date scheduling — a **date override** on top of the weekly skeleton
(see Scheduling model above). Edited per date on the Workouts screen (EDIT DAY);
also written by `materializeDay` when a template day is first completed/edited.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `student_id` | uuid | FK → `profiles(id)` (the player) |
| `workout_id` | uuid | FK → `workouts(id)` |
| `specific_date` | date | The actual date this workout is scheduled |
| `completed` | boolean | Player has marked this done |
| `coach_feedback` | text | Legacy per-session note (unused since self-coach refactor) |
| `feedback_is_read` | boolean | Legacy read flag (unused) |
| `created_at` | timestamptz | Auto |

**Used by:** WorkoutsScreen (per-date overrides + completion), HomeScreen (today's
missions), WorkoutDetailScreen.

---

> **Checkup tables removed (2026-05-22).** `checkups`, `checkup_questions`,
> `checkup_answers`, `checkup_exercises`, and `checkup_uploads` were dropped in
> the self-coach refactor, along with the `checkup-videos` storage bucket.

### `daily_quests`
Self-authored daily checklist items, one row per quest per player. Soft-deleted
via `active = false` so existing completion history is preserved when the player
removes a quest.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `student_id` | uuid | FK → `profiles(id)` ON DELETE CASCADE (the player) |
| `coach_id` | uuid | FK → `profiles(id)` ON DELETE CASCADE — now equals the player's own id (self-authored) |
| `title` | text | Quest text, CHECK `char_length(title) <= 100` |
| `active` | boolean | Soft-delete flag, default `true` |
| `created_at` | timestamptz | Auto |

**Index:** `(student_id, active)`

**Used by:** HomeScreen (player today's list), DailyQuestScreen
(`CoachDailyQuestScreen.js`, self-manage from the Workouts → Manage hub).

---

### `daily_quest_completions`
One row per (quest, day) the student checks off. Existence of a row for
`completion_date = israelToday()` means the quest is "done today" for the
player. Yesterday's rows stay as history, today starts empty — no cron needed.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `daily_quest_id` | uuid | FK → `daily_quests(id)` ON DELETE CASCADE |
| `student_id` | uuid | FK → `profiles(id)` ON DELETE CASCADE (denormalized for cheap queries) |
| `completion_date` | date | YYYY-MM-DD in Asia/Jerusalem time |
| `completed_at` | timestamptz | Auto |
| UNIQUE (`daily_quest_id`, `completion_date`) | | prevents double-check |

**Index:** `(student_id, completion_date)`

> **EXP removed (2026-06-05).** EXP was deleted from the app — no LEVEL/EXP card,
> no "+1 EXP" daily-quest reward, no EXP stat on Workouts, and the unused
> `profiles.total_exp` column was dropped. Daily-quest completions are still
> recorded (they drive the "done today" state), they just no longer award EXP.

**Timezone:** all `completion_date` values use `israelToday()` from
[lib/israelDate.js](lib/israelDate.js), which is
`new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' })`.
Workout dates still use UTC (`new Date().toISOString().split('T')[0]`) —
these two systems are intentionally separate for now.

> **9-week retention window (2026-06-18).** The two per-date tables —
> `workout_override_workouts` (`specific_date`) and `daily_quest_completions`
> (`completion_date`) — are kept only for a rolling **9-week window**: 4 weeks
> before … 4 weeks after the current week. [WorkoutsScreen](screens/WorkoutsScreen.js)
> clamps its week navigator to that range (so out-of-window rows are never created)
> and, on load, deletes the signed-in player's rows whose date is outside the
> window (`pruneOutOfWindow`). This trims storage; **completion history older than
> 4 weeks is intentionally discarded.** Permanent progress
> (`student_quest_completions`, `workouts`, `weekly_workout_template`) is per-date-free
> and never pruned.

---

### `weekly_accessories`
Self-managed list of EXTRA accessory / legs movements a player hits a target
number of times per week, performed AD HOC (off the dated/fatigue-managed program).
Soft-deleted via `active = false` so completion history survives a removal (mirrors
`daily_quests`). Added in `migrations/20260630_weekly_accessories.sql`.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `student_id` | uuid | FK → `profiles(id)` ON DELETE CASCADE (the player; owner) |
| `name` | text | Accessory name (a copy of the chosen workout's title), CHECK `char_length(name) <= 80`. Kept as a copy so the row survives if the source workout is deleted. |
| `workout_id` | uuid | FK → `workouts(id)` ON DELETE SET NULL. The player's workout this accessory was picked from (My Workouts picker). NULL = legacy free-text accessory or the source workout was deleted. Added in `migrations/20260630_accessory_workout_link.sql`. |
| `target_per_week` | smallint | How many times/week to do it. Default `1`, CHECK `between 1 and 21` |
| `active` | boolean | Soft-delete flag, default `true` |
| `created_at` | timestamptz | Auto |

**Index:** `(student_id, active)`
**RLS:** owner-only (`auth.uid() = student_id`) + additive `admin all accessories`
(`public.is_admin()`).
**Used by:** WeeklyAccessoriesScreen (opened from the Workouts → Manage hub's
top-right ACCESSORIES button).

---

### `accessory_completions`
One row per "I did this accessory once". This week's progress for an accessory =
count of its rows whose `completion_date` falls in the current Sun–Sat week; it
resets automatically next week (old rows just become history). No UNIQUE on
(accessory, date) — the same accessory can be logged multiple times per day.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `accessory_id` | uuid | FK → `weekly_accessories(id)` ON DELETE CASCADE |
| `student_id` | uuid | FK → `profiles(id)` ON DELETE CASCADE (denormalized for cheap queries) |
| `completion_date` | date | YYYY-MM-DD (UTC, via `toDateStr`/`TODAY_STR` in [lib/schedule.js](lib/schedule.js) — same date system as workouts) |
| `completed_at` | timestamptz | Auto |

**Index:** `(student_id, completion_date)`, `(accessory_id)`
**RLS:** owner-only + additive `admin all accessory completions`.

> Not currently swept by the 9-week pruning job (low row volume); revisit if it grows.

---

### `gallery_example_workouts`
Admin-authored example workout templates shown in the gallery's "Example Workouts" tab.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `title` | text | Workout name, stored uppercase |
| `description` | text | Optional one-liner describing the workout's goal |
| `class_order` | integer | Legacy scalar target class: `0`=Class I, `1`=Class II, `2`=Class III. Now kept as the **minimum** of `class_orders` for ordering/back-compat; prefer `class_orders`. |
| `category` | text | Gallery filter bucket: `'main'` (Main Quest), `'side'` (Side Quest), or `'accessory'` (Accessories). `NOT NULL DEFAULT 'main'`, CHECK-constrained. Added in `migrations/20260622_example_workout_category.sql` (existing rows backfilled to `'main'`). The gallery's Example Workouts tab filters by class + this category. |
| `class_orders` | integer[] | Full set of class `order_index` values this workout targets (always ≥ 1). Added in migration `20260621_multi_target_class.sql`. |
| `exercises` | jsonb | Array of `{name, variation, sets, reps, superset_group, branch}` objects (`notes` removed 2026-06-13; `variation`/`superset_group`/`branch` mirror the `exercises` table — see those rows, including `branch: 'merge'` for the post-fork common ending). |
| `branches` | jsonb | **Workout fork** (same shape as `workouts.branches`): `NULL` = no fork, else 2-element array of `{key,label}`. Added in `supabase/migrations/20260613_example_workout_branching.sql`. |
| `created_at` | timestamptz | Auto |

**RLS:** Authenticated users can read; only `admin` role can insert/update/delete.
(The **UPDATE** policy was missing originally — edits silently saved nothing — and
was added in `migrations/20260622_gallery_example_workouts_update_policy.sql` via
`public.is_admin()`.)

**Used by:** ExerciseGalleryScreen (Example Workouts tab — fetch + delete), AddExampleWorkoutScreen (create). Added in migration `20260604_gallery_example_workouts.sql`.

---

### `challenges`
Admin-authored challenges. Added in `migrations/20260607_challenges.sql`.

> **UI REMOVED (2026-06-27):** the Challenges screen and its player nav tab /
> AdminDashboard button were deleted. This table is currently **orphaned** — no
> screen reads or writes it. The table + RLS are kept (no data dropped) in case the
> feature returns; remove the migration/table separately if you want it gone.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | `gen_random_uuid()` |
| `title` | text | Challenge name (required) |
| `description` | text | What the challenge is. NULL = none |
| `reward` | text | Optional reward shown as a gold badge. NULL = none |
| `active` | boolean | Visibility flag, default `true`. Queries filter `active = true` |
| `created_by` | uuid | FK → `profiles(id)` — the admin who posted it |
| `created_at` | timestamptz | Auto |

**RLS:** any authenticated user can `SELECT`; only admins can `INSERT`/`UPDATE`/
`DELETE`, gated by the `public.is_admin()` SECURITY DEFINER helper (same helper the
`exercises_gallery` insert policy uses).

**Used by:** nothing (orphaned — see the UI REMOVED note above).

---

## Key Patterns & Protocols

### Reading current user
```js
const { data: { user } } = await supabase.auth.getUser();
```
Used at the top of nearly every data-fetch function.

### Null checks on DB results
Always use `?? []` or `?? null` — never assume data is present:
```js
setQuests(qRes.data ?? []);
```

### Parallel fetches
All screens use `Promise.all([...])` for parallel queries to avoid waterfalls:
```js
const [qRes, cRes, pRes] = await Promise.all([
  supabase.from('class_quests').select('*')...,
  supabase.from('student_quest_completions').select('quest_id')...,
  supabase.from('profiles').select('class_id, prestige_count')...,
]);
```

### Level update pattern (quest toggle)
The player toggles their own quest in QuestTreeScreen, which only ever
inserts/deletes a row in `student_quest_completions` (`student_id` = self). LVL
is **not stored** — it is recomputed from those rows per class via
[lib/computeLvl.js](lib/computeLvl.js). `profiles.current_lvl` is dead.

### Prestige pattern
Prestige is **gated** by [lib/prestige.js](lib/prestige.js) `evaluatePrestige()` —
ALL of: reach `classes.prestige_at`, complete the class's required main quests,
and fully complete ≥1 Tier-2 side chain (see CLAUDE.md "Class & Quest System").
SkillsScreen shows a live requirements checklist; the PRESTIGE NOW button appears
only once every gate passes. The action itself:
1. Advance `profiles.class_id` to the next class (by `order_index`)
2. Increment `profiles.prestige_count` by 1

Quest completions are **preserved** across prestige (not deleted), so computed
per-class LVL auto-restores if the player returns to a class. No `current_lvl`
write — LVL is always derived from completions for the current class.

### Workout scheduling pattern
Workouts are not scheduled via `workouts.scheduled_date`. Two layers (see
"Scheduling model" above): the Manage hub (StudentDetailScreen) defines the
recurring **`weekly_workout_template`** skeleton (by weekday); WorkoutsScreen and
HomeScreen resolve each real date as **override-if-any-else-skeleton** via
[lib/schedule.js](lib/schedule.js). Per-date edits/completion live in
`workout_override_workouts` (materialized on first touch).

---

## Storage Buckets

- **`avatar`** (public) — player profile pictures. Uploaded from ProfileScreen
  (Profile tab) to path `<user_id>/<timestamp>.<ext>`; the public URL is stored in
  `profiles.avatar_url`. Must be created as **public** in the Supabase dashboard,
  with an INSERT policy for the `authenticated` role (mirror the `exercise-videos`
  bucket). See `migrations/20260607_profile_fields.sql`.
- **`exercise-videos`** (public) — exercise demo videos (`exercises_gallery.video_url`).

---

## SL Theme Object (local alias)

Many screens define a local `SL` object instead of importing `C` from
`constants/colors.js`. This is **legacy inconsistency** — new screens should
always import `C`. The SL values map approximately as:

| SL key | Approximate C equivalent | Hex |
|--------|--------------------------|-----|
| `SL.bg` | `C.bg` | `#050912` |
| `SL.panel` | `C.surface` | `#070d1a` |
| `SL.border` | `C.cardBorder` (lighter) | `#1a3a5c` |
| `SL.accent` | — (teal, not in C) | `#4A9EBF` |
| `SL.text` | `C.text` | `#E8F4FF` |
| `SL.muted` | — (lighter than C.textMuted) | `#4a6a8a` |
| `SL.gold` | — (not in C) | `#FFD700` |
| `SL.green` | — (not in C) | `#4CAF50` |
| `SL.danger` | — (not in C) | `#FF4444` |

> When building new screens, import `C` from `constants/colors.js`. If you
> need gold, green, or danger colors, ask whether to add them to `C` first.