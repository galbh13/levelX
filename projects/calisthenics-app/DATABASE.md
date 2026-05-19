# Calisthenics App — Database Reference

> Upload this file to your project knowledge so Claude Code always has full DB context.

---

## Schema Source Provenance

Only three tables have `CREATE TABLE` statements in the repo:

- `profiles`, `workouts`, `exercises` — defined in [lib/schema.sql](lib/schema.sql).

Everything else (`classes`, `class_quests`, `student_quest_completions`,
`exercises_gallery`, `workout_override_workouts`, `checkups`,
`checkup_questions`, `checkup_answers`, `checkup_exercises`, `checkup_uploads`,
`daily_quests`, `daily_quest_completions`)
was created directly in the Supabase dashboard with no migration file. The
extended `profiles` columns (`current_lvl`, `total_exp`, `prestige_count`,
`class_id`) were also added via dashboard.

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
  then fetches `profiles.role` to route the user to the correct navigator
  (`admin` → AdminNavigator, `coach` → CoachNavigator, `student` → StudentApp)
- **New user trigger:** A Postgres function `handle_new_user()` auto-inserts a
  row into `profiles` whenever a new `auth.users` row is created (trigger:
  `on_auth_user_created`). It copies `id` and `email`. All other fields
  (full_name, role, coach_id, etc.) must be set manually after sign-up.

---

## Row Level Security (RLS)

RLS is **enabled** on all tables. The base policies defined in `lib/schema.sql`
are conservative starting points — the app often bypasses them in practice by
using service-role or by relying on coach/admin flows that were built before
full RLS hardening. Key policies:

| Table       | Policy | Rule |
|-------------|--------|------|
| `profiles`  | Users can view own profile | `auth.uid() = id` |
| `workouts`  | Students see own workouts | `auth.uid() = assigned_to` |
| `workouts`  | Coaches see workouts they created | `auth.uid() = created_by` |
| `exercises` | Visible with parent workout | workout's `assigned_to` or `created_by` = `auth.uid()` |

> **Note:** Many newer tables (checkups, class_quests, etc.) were added via
> migrations and may have broader or no RLS policies. Always check before
> adding queries that touch sensitive data.

---

## Tables

### `profiles`
The central user table. One row per auth user.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | References `auth.users(id)` |
| `email` | text | Copied from auth on sign-up |
| `full_name` | text | Set manually |
| `role` | text | `'admin'`, `'coach'`, or `'student'` |
| `coach_id` | uuid | FK → `profiles(id)`. NULL = unassigned |
| `current_lvl` | integer | Player's current level (0–100) |
| `total_exp` | integer | Total EXP earned (used for display) |
| `prestige_count` | integer | How many times the player has prestiged |
| `class_id` | uuid | FK → `classes(id)`. NULL = no class assigned |
| `guiding_phrase` | text | Coach-authored motivational sentence shown on the student's Workouts screen. NULL = none set |
| `created_at` | timestamptz | Auto |

**Used by:** Every screen. AdminDashboard reads all profiles to build roster.
Coach reads student profiles. Player reads own profile for HUD.

---

### `classes`
Defines the class tiers (Class I, Class II, etc.). Dynamic — never hardcode count.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `name` | text | e.g. `'Class I'`, `'Class II'` |
| `order_index` | integer | 0 = first class, 1 = second, etc. |
| `description` | text | Flavor text for the class |

**Used by:** ClassQuestScreen, SkillsScreen, CoachSideQuestScreen,
QuestTreeScreen. Always fetched dynamically — never hardcode class names or count.

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

**Used by:** CoachQuestTreeScreen, QuestTreeScreen (player view), ClassQuestScreen,
CoachSideQuestScreen, SkillsScreen.

---

### `student_quest_completions`
Junction table — records which quests each student has completed.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `student_id` | uuid | FK → `profiles(id)` |
| `quest_id` | uuid | FK → `class_quests(id)` |
| `completed_at` | timestamptz | Auto (presumably) |

**Written by:** Coach screens (ClassQuestScreen, CoachQuestTreeScreen,
CoachSideQuestScreen) when toggling quest completion. Also updates
`profiles.current_lvl` in the same operation.

**Read by:** QuestTreeScreen, SkillsScreen (player view) to show node states.

---

### `workouts`
Workout templates created by coaches and assigned to players.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `title` | text | e.g. `'PULL DAY A'` |
| `purpose` | text | Optional goal description |
| `assigned_to` | uuid | FK → `profiles(id)` — the student |
| `created_by` | uuid | FK → `profiles(id)` — the coach |
| `scheduled_date` | date | Original scheduled date (mostly legacy) |
| `created_at` | timestamptz | Auto |

**Used by:** WorkoutsScreen, WorkoutDetailScreen, WorkoutEditScreen,
CreateWorkoutScreen, StudentDetailScreen, CoachDashboard.

---

### `exercises`
Individual exercises belonging to a workout.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `workout_id` | uuid | FK → `workouts(id)` ON DELETE CASCADE |
| `letter` | text | Display order letter, e.g. `'A'`, `'B'`, `'C'` |
| `name` | text | Exercise name |
| `sets` | integer | |
| `reps` | text | String because can be `'8-12'` or `'MAX'` etc. |
| `notes` | text | Coach notes for the exercise |

**Used by:** WorkoutDetailScreen (fetches via `workout_id`), WorkoutEditScreen,
CreateWorkoutScreen.

---

### `exercises_gallery`
Master library of all exercises. Used as the source when coaches build workouts
or checkups.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `name` | text | Exercise name |
| `movement_type` | text | `'Strength'`, `'Skill'`, `'Mobility'`, `'Conditioning'` |
| `youtube_url` | text | Full YouTube URL (optional) |
| `description` | text | Optional description |
| `coaching_cues` | text | Newline-separated coaching cues |
| `created_by` | uuid | FK → `profiles(id)` |

**Used by:** ExerciseGalleryScreen, ExerciseDetailScreen, AddExerciseScreen,
WorkoutEditScreen, CheckupBuilderScreen, WorkoutDetailScreen (for YouTube links).

---

### `workout_override_workouts`
The scheduling layer. Instead of using `workouts.scheduled_date` directly,
the coach assigns workouts to specific calendar dates for a specific student here.
This is what drives the weekly calendar view.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `student_id` | uuid | FK → `profiles(id)` |
| `workout_id` | uuid | FK → `workouts(id)` |
| `specific_date` | date | The actual date this workout is scheduled |
| `completed` | boolean | Student has marked this done |
| `coach_feedback` | text | Coach's text feedback on this specific session |
| `feedback_is_read` | boolean | Player has read the feedback |
| `created_at` | timestamptz | Auto |

**Used by:** WorkoutsScreen (player's weekly calendar), HomeScreen (today's missions),
StudentDetailScreen (coach's view of student calendar), WorkoutDetailScreen.

---

### `checkups`
One checkup per student per cycle. Created by coach, submitted by student,
reviewed by coach.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `student_id` | uuid | FK → `profiles(id)` |
| `coach_id` | uuid | FK → `profiles(id)` |
| `scheduled_date` | date | When the checkup is due |
| `status` | text | `'pending'` → `'submitted'` → (reviewed) |
| `coach_response` | text | Coach's written response after review |
| `responded_at` | timestamptz | When coach submitted their response |
| `response_is_read` | boolean | Player has read the coach response |
| `coach_read` | boolean | Coach has opened the submitted checkup |
| `is_read` | boolean | General read flag (legacy/redundant with coach_read) |
| `created_at` | timestamptz | Auto |

**Business rules:**
- Max 2 checkups per student at any time (enforced in CheckupBuilderScreen).
- Checkup expires 10 days after `created_at` (shown as countdown in CheckupReviewScreen).
- When coach opens a submitted checkup, `coach_read` is set to `true`.
- When player reads coach response, `response_is_read` is set to `true`.

**Used by:** CheckupBuilderScreen, CheckupReviewScreen, CheckupScreen,
StudentDetailScreen, HomeScreen, WorkoutsScreen.

---

### `checkup_questions`
The questions the coach defines for a checkup.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `checkup_id` | uuid | FK → `checkups(id)` |
| `order_index` | integer | Display order |
| `question` | text | The question text |

---

### `checkup_answers`
Player's answers to each question.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `checkup_id` | uuid | FK → `checkups(id)` |
| `question_id` | uuid | FK → `checkup_questions(id)` |
| `answer` | text | Player's free-text answer |

---

### `checkup_exercises`
The exercises the coach wants the player to record video for.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `checkup_id` | uuid | FK → `checkups(id)` |
| `order_index` | integer | Display order |
| `exercise_name` | text | Display name |
| `exercise_gallery_id` | uuid | FK → `exercises_gallery(id)` (nullable) |

---

### `checkup_uploads`
Video uploads linked to a specific checkup exercise.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `checkup_id` | uuid | FK → `checkups(id)` |
| `checkup_exercise_id` | uuid | FK → `checkup_exercises(id)` |
| `video_url` | text | Public URL from Supabase Storage |
| `uploaded_at` | timestamptz | Auto or set on upload |

**Storage bucket:** `checkup-videos`
Path pattern: `{checkup_id}/{exercise_id}/{timestamp}.{ext}`
Uploaded via `supabase.storage.from('checkup-videos').upload(...)` with `upsert: true`.

---

### `daily_quests`
Coach-authored daily checklist items, one row per quest per student. Soft-deleted
via `active = false` so existing completion history (and the EXP it represents)
is preserved when a coach removes a quest.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `student_id` | uuid | FK → `profiles(id)` ON DELETE CASCADE |
| `coach_id` | uuid | FK → `profiles(id)` ON DELETE CASCADE |
| `title` | text | Quest text, CHECK `char_length(title) <= 100` |
| `active` | boolean | Soft-delete flag, default `true` |
| `created_at` | timestamptz | Auto |

**Index:** `(student_id, active)`

**Used by:** HomeScreen (player today's list), CoachDailyQuestScreen (manage).

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

**Player EXP rule:** each completed workout = +5 EXP, each daily-quest
completion row = +1 EXP. These are the only two sources of EXP. Every EXP
display (HomeScreen, WorkoutsScreen, CoachDashboard student cards) uses the
same formula:
`completed_workouts_count * 5 + daily_quest_completions_lifetime_count`.
There is no separate EXP column — counts are derived on read.

**Timezone:** all `completion_date` values use `israelToday()` from
[lib/israelDate.js](lib/israelDate.js), which is
`new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' })`.
Workout dates still use UTC (`new Date().toISOString().split('T')[0]`) —
these two systems are intentionally separate for now.

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
  supabase.from('profiles').select('current_lvl')...,
]);
```

### Level update pattern (quest toggle)
When completing/un-completing a quest, two writes always happen together:
1. Insert/delete from `student_quest_completions`
2. Update `profiles.current_lvl` by adding/subtracting `quest.lvl_reward`
Level is clamped to minimum 0: `Math.max(0, currentLvl - reward)`

### Prestige pattern
When coach triggers prestige on a student:
1. Advance `profiles.class_id` to the next class (by `order_index`)
2. Reset `profiles.current_lvl` to 0
3. Increment `profiles.prestige_count` by 1
4. Delete all rows from `student_quest_completions` for that student

### Checkup flow
```
Coach creates checkup (status: 'pending')
  → Player sees alert on HomeScreen/WorkoutsScreen
  → Player fills answers + uploads videos in CheckupScreen
  → Player submits → status: 'submitted'
  → Coach sees badge on StudentDetailScreen
  → Coach opens CheckupReviewScreen → coach_read: true
  → Coach writes response → coach_response saved, responded_at set
  → Player sees alert → reads it → response_is_read: true
```

### Workout scheduling pattern
Workouts are not scheduled via `workouts.scheduled_date`.
The coach uses `workout_override_workouts` to pin a workout to a specific
date for a specific student. The weekly calendar in WorkoutsScreen and
StudentDetailScreen queries this table filtered by `student_id`.

---

## Storage Buckets

| Bucket | Used for | Path pattern |
|--------|----------|--------------|
| `checkup-videos` | Player video uploads in checkups | `{checkup_id}/{exercise_id}/{timestamp}.ext` |

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