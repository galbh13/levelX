# Calisthenics App — Database Reference

> Upload this file to your project knowledge so Claude Code always has full DB context.

---

## Schema Source Provenance

Only three tables have `CREATE TABLE` statements in the repo:

- `profiles`, `workouts`, `exercises` — defined in [lib/schema.sql](lib/schema.sql).

> **Quest upgrades (2026-08-24):** a main quest can now have a harder version
> behind it — clear every node and a gold UPGRADE gate rises at the foot of the
> tree, swapping the quest for its upgrade (with a version switch back). New
> table `student_quest_upgrades` (`migrations/20260824_quest_upgrades.sql`); the
> pairing itself is client-side in `lib/questUpgrades.js`. No quest rows moved.
> See `student_quest_upgrades` below.

Everything else (`classes`, `class_quests`, `student_quest_completions`,
`exercises_gallery`, `workout_override_workouts`,
`daily_quests`, `daily_quest_completions`)
was created directly in the Supabase dashboard with no migration file. The
extended `profiles` columns (`current_lvl`, `prestige_count`, `class_id`) were
also added via dashboard. (`total_exp` was dropped 2026-06-05 when EXP was
removed from the app — see `migrations/20260605_drop_total_exp.sql`.)

> **Weekly check-ups (2026-07-14):** the Profile tab was replaced by a check-up
> flow — new tables `checkups` + `checkup_videos` and the `checkup-videos` storage
> bucket (`migrations/20260714_checkups.sql`), which also dropped the profile
> vanity columns (`nickname`/`bio`/`avatar_url`). See the `checkups` table below.
> This is unrelated to the older, larger checkup system removed in 2026-05-22.

> **Structured check-up templates (2026-07-22):** the check-up became an
> ADMIN-AUTHORED structured form instead of a free-form submission — new table
> `checkup_template_items` (class-standard XOR per-player override) + `checkup_answers`
> (the player's Part-1 text answers), and `checkup_videos` gained `item_id` /
> `prompt` / `answer_text` / `order_index` to tie each clip to a Part-2 exercise.
> `migrations/20260722_checkup_templates.sql`. `checkups.note` is now legacy
> (unwritten). See `checkup_template_items` / `checkup_answers` below.

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
| `full_name` | text | Set at invite time (the admin types it on the ＋ NEW PLAYER form; carried in via the auth user's `raw_user_meta_data`). Never editable afterwards — see Player Card. |
| `phone` | text | **The player's WhatsApp number**, captured on the ＋ NEW PLAYER form (required there) and carried in via the auth user's `raw_user_meta_data` like `full_name`. Stored normalized — a leading `+` if one was typed, then digits only — because that is what gets pasted into a WhatsApp contact when the coach adds them to the community. **This is the GLOBAL phone number**: `PlayerBillingScreen`'s PHONE field reads and writes it (see the note below). Added in `migrations/20260825_profile_contact.sql`. |
| `birthday` | date | The player's birthday, optional, captured on the ＋ NEW PLAYER form as `YYYY-MM-DD` and carried in on `raw_user_meta_data`. **The GLOBAL birthday** — same field the business card edits. Added in `migrations/20260825_profile_contact.sql`. |
| `role` | text | `'admin'` or `'player'` (default `'player'`). Coach/student roles removed in self-coach refactor. |
| `coach_id` | uuid | FK → `profiles(id)`. **Legacy / unused** since self-coach refactor — always NULL. |
| `current_lvl` | integer | **Legacy / unused** — LVL is computed from completions, not stored (see [lib/computeLvl.js](lib/computeLvl.js)) |
| `prestige_count` | integer | How many times the player has prestiged |
| `class_id` | uuid | FK → `classes(id)`. NULL = no class assigned |
| `job` | text | **Which class ladder the player progresses through** (`'static'` = the original all-skills ladder; `'handstand'` = the handstand job). `NOT NULL DEFAULT 'handstand'` — the app is specialised for handstand learners, so new signups land there (`migrations/20260824_default_job_handstand.sql`; was `'static'`). Set by the admin on `PlayerAdminScreen`; switching a job also re-points `class_id` at that job's first class. Added in `migrations/20260714_jobs.sql`. See "Jobs" below. |
| `checkup_day` | smallint | **Recurring weekly check-up day** (0=Sun…6=Sat). `NULL` = unscheduled. Set by the admin on `AdminCheckupScreen`; the player sees the next due date (with a one-day grace) on `CheckupScreen`. Added in `migrations/20260719_checkup_schedule.sql`. Schedule helper `checkupSchedule()` in [lib/checkups.js](lib/checkups.js). |
| `avatar_url` | text | **Hunter Status portrait** — public URL of the profile picture (bucket `profile-media`). `NULL` = show initials. Re-added in `migrations/20260723_player_profiles.sql`. |
| `avatar_path` | text | Storage path of the portrait inside `profile-media` — kept so a REPLACE upload can delete the previous file (these are permanent, so uploads replace instead of accumulate). |
| `signature_video_url` | text | **Signature-move clip** — H.264 delivery URL of the player's one showcase video, **hosted on Cloudinary** (NOT Supabase). `NULL` = none. Cloudinary transcodes the phone's HEVC recording to H.264 so it plays on desktop browsers too. |
| `signature_video_path` | text | The clip's **Cloudinary `public_id`** (e.g. `signatures/abc123`). Legacy rows (pre-Cloudinary) instead hold a Supabase `profile-media` path (`<uid>/signature-…`). |
| `must_change_password` | boolean | **The invited player is still on the shared starter password.** `NOT NULL DEFAULT false`; set `true` for every account created by the `invite-player` edge function. While it's true, `App.js` renders `SetPasswordScreen` instead of the app (no skip, no navigator); setting a password clears it. Added in `migrations/20260825_invite_player.sql`. See "Player invites" below. |
| `created_at` | timestamptz | Auto |

> **Player invites — `invite-player` edge function (2026-08-25).** New players are
> created by the admin from the **＋ NEW PLAYER** button on `AdminDashboard`: email
> + full name + phone → `supabase/functions/invite-player` creates the auth user with the
> shared starter password (`email_confirm: true`, so they can sign in at once) and
> emails them their credentials from the business Gmail over SMTP. The function
> holds the service-role key and the Gmail app password as Supabase secrets —
> neither may ever reach the app bundle. It verifies the caller is a `role='admin'`
> profile before doing anything. Client half: [lib/invites.js](lib/invites.js).
> Setup + deploy: `supabase/functions/README.md`.
>
> **The trigger does the profile insert.** `handle_new_user()` was extended to read
> `full_name`, `phone`, `birthday` and `must_change_password` off the new auth
> user's `raw_user_meta_data`, so the invite is ONE `auth.admin.createUser` call —
> no follow-up profile write that could race the trigger. `job` still comes from
> the column default (`'handstand'`), and `role` from the trigger (`'player'`).
> The edge function does write `phone` + `birthday` a second time straight after
> the create (`migrations/20260825_profile_contact.sql` adds both columns AND
> rewrites the trigger) — a deliberate belt-and-braces, because this project's
> live schema has drifted from migrations before and a stale trigger would
> silently drop them. The trigger casts `birthday` inside its own
> `begin…exception` block for the same reason: a bad date must not turn into
> Auth's useless "Database error creating new user".

> **PHONE + BIRTHDAY are GLOBAL, and they live on `profiles` (2026-08-25).** One
> number and one date per player, typed once on ＋ NEW PLAYER and shown wherever
> they're needed. **`player_billing.phone` / `player_billing.birthday` are now
> LEGACY** — nothing writes them; the migration backfilled whatever was already
> typed into the business card onto `profiles` (filling blanks only, profile
> wins). The MONEY & MEMBERSHIP card still shows both fields, but
> `fetchPlayerBilling()` merges the profile values over the billing row and
> `savePlayerBilling()` peels `phone`/`birthday` out of the patch and writes them
> to `profiles` instead (`fetchPlayerContact` / `savePlayerContact` in
> [lib/billing.js](lib/billing.js)). Editing the business card therefore updates
> the same value the invite set. Both contact helpers **swallow their errors** —
> a missing column on a drifted live database must not be able to take the whole
> business card down.

> **Profile screen removed (2026-07-14)** — the Profile tab was replaced by the
> weekly check-up (see `checkups` below). Its three vanity columns
> `nickname`, `bio`, and `avatar_url` were **dropped** in
> `migrations/20260714_checkups.sql`; the admin roster and manage hero now fall
> back to initials, and the `avatar` storage bucket is orphaned (delete manually).
> (`nickname`/`bio`/`avatar_url` had been added in `20260607_profile_fields.sql`,
> `bio` itself replacing the earlier `guiding_phrase`.)

> **Hunter Status re-adds a profile surface (2026-07-23).** A new player profile
> screen (`HunterStatusScreen`) brought back ONLY a portrait + one signature
> video — the columns `avatar_url` / `avatar_path` / `signature_video_url` /
> `signature_video_path` above (migration `20260723_player_profiles.sql`). The
> rest of the card (name · LVL · class · prestige stars) is DERIVED, nothing new
> stored. `nickname` / `bio` were **not** restored; the NAME (`full_name`) is
> shown read-only (unchangeable). Owner writes ride an idempotent `Users can
> update own profile` policy (re-created by the migration); group co-members read
> the row (incl. these columns) via the existing `shares_group_with` policy — so
> **no new read policy** was needed. Helpers in [lib/profile.js](lib/profile.js)
> (`fetchHunterProfile` / `uploadAvatar` / `uploadSignatureVideo` /
> `removeSignatureVideo`).
>
> **Portraits — Supabase Storage bucket `profile-media`** (PUBLIC, 50 MB limit;
> created/seeded by the migration). Holds the AVATAR only, keyed by user folder:
> `<user_id>/avatar-<ts>.<ext>`. Storage RLS: public read; a signed-in player may
> insert/update/delete only inside their OWN folder. Permanent (no purge); each
> avatar upload deletes the previous file (via `avatar_path`).
>
> **Signature videos — Cloudinary (NOT Supabase).** Phones record HEVC/H.265,
> which desktop browsers can't decode (audio plays, frame is black). So signature
> clips upload to **Cloudinary** (cloud `lwfbixc6`, unsigned preset
> `levelx_signatures`, folder `signatures/`), which transcodes them; the app stores
> the **H.264 delivery URL** (`f_mp4,vc_h264,q_auto`) in `signature_video_url` and
> the `public_id` in `signature_video_path`. The unsigned preset means no API
> secret in the client. Old Cloudinary assets aren't deleted from the client
> (needs a signed call) — small, acceptable. See [lib/profile.js](lib/profile.js)
> `uploadSignatureVideo`.

**Used by:** Every screen. AdminDashboard reads all `player` profiles for the
read-only roster. Each player reads/writes their own profile (class_id,
prestige_count) for the HUD and self class management.

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
| `job` | text | **Which job's ladder this class belongs to** (`'static'` / `'handstand'`). `NOT NULL DEFAULT 'static'`. Each job's `order_index` restarts at 0. Added in `migrations/20260714_jobs.sql`. See "Jobs" below. |

**Used by:** SkillsScreen, QuestTreeScreen, HomeScreen. Always fetched
dynamically — never hardcode class names or count. **Filter by `job`** whenever
listing a player's classes (their picker / class count) — a job is a
self-contained ladder. The progress bar scales each class to its own max
(Σ `lvl_reward`) and draws the prestige marker at `prestige_at`.

---

### Jobs — parallel class ladders (2026-07-14)

A **job** (`profiles.job`, `classes.job`; migration `20260714_jobs.sql`) is a
self-contained progression: its own `classes` and, through them, its own
`class_quests`. The original ladder is the `'static'` job (all-skills, Class
I/II/III); every existing class and player defaults to it, so the change is
transparent. The `'handstand'` job is optimized for leveling the handstand fast;
it has three classes. **`Handstand III`** (`order_index 2`) has two main quests:
`chain = 'shapes'` — a faithful copy of the static Class III `hs_beginners` SIDE
quest (COMBOS/STRADDLE/TUCK + MIXED convergence) retyped as `main` and renamed
(`migrations/20260716_handstand_shapes_class3.sql`, which also creates the class);
and `chain = 'straight_arm_presses'` — a brand-new linear 7-node quest
(`migrations/20260716_handstand_straight_arm_presses_class3.sql`).
**`Handstand II`** (`order_index 1`) has two main quests — `chain = 'balance'`
(a single `main` column copied from the static Class II handstand BALANCE branch;
`migrations/20260716_handstand_balance_class2.sql` also creates the class) and
`chain = 'hspu'` (copied from the static Class II HSPU main quest;
`migrations/20260716_handstand_hspu_class2.sql`) — plus SIDE quests copied from
static Class II (all Tier I chains + the `crow to handstand` / `l-sit to handstand`
Tier II chains, excluding `straight legs muscle up`;
`migrations/20260716_handstand_class2_sidequests.sql`).
**`Handstand I`** (`order_index 0`) has a single main quest
(`chain = 'push'`) built up by two DB-side copy migrations (idempotent,
re-runnable; they clone the LIVE trees — which drift from the migration files —
remapping prerequisite ids):
- `20260715_handstand_push_from_static.sql` — **TIER I**: clones the static PUSH
  chain (push-ups → pike-push-ups branch + dips branch).
- `20260715_handstand_power_mobility_tier2.sql` — **TIER II**: clones the static
  Class II handstand POWER + MOBILITY branches and converges each branch root from
  the two TIER I leaves (16 dips + 10 pike push-ups) as an `is_convergence` node.
  The cross-branch (pike + dips) merge is what the app detects as the TIER II
  boundary. In the handstand job tiers are opt-in per quest (`HANDSTAND_TIERED_CHAINS`
  in `QuestTreeScreen`, currently just `push`), so the other handstand main quests
  (`balance`/`hspu`/`shapes`) stay un-tiered like their sources.

Handstand I also carries SIDE quests copied from static Class I — `chain = 'frog'`
(`migrations/20260716_handstand_frog_sidequest_class1.sql`) plus `chain = 'l-sit'`
and `chain = 'headstand'`
(`migrations/20260824_handstand_class1_lsit_headstand_sidequests.sql`). All three
render under **TIER I**: each chain is copied on its own id map, so the static
`headstand` chain's cross-chain convergence gates (which make it Tier II there)
are dropped and its branch roots stop being convergence nodes.
More handstand content is added on top from there.

- Each job's `classes.order_index` restarts at 0, so LVL, prestige, and stars are
  all scoped per job. `lib/prestige.js` `PRESTIGE_REQUIREMENTS` is keyed
  `[job][order_index]`; a job with no block, or a class with no entry, gates on
  **level only**. The handstand job has blocks for Class I and Class II:
  `Handstand II` gates on LVL 90 (`20260825_handstand_class2_prestige_at_90.sql`)
  + the BALANCE hidden challenge "HS Scale" + HSPU's "2 HSPU" + 1 Tier-2 side
  chain. `evaluatePrestige` / `requiredMainQuestIds` take an
  optional `job` (default `'static'`).
- **Admin switches a player's job** on `PlayerAdminScreen`. The switch writes
  `profiles.job` AND re-points `class_id` at the target job's first class (their
  old class belongs to the other ladder). Quest completions are keyed per quest,
  so switching back restores that job's progress untouched.
- `SkillsScreen` (class picker + count) and `HomeScreen`/`AdminDashboard` (class
  count for stars) filter classes by the player's job. The exercise-library /
  example-workout class pickers (`ExerciseGalleryScreen`, `AddExampleWorkoutScreen`,
  `AddExerciseScreen`, `EliteWorkoutsScreen`) are pinned to `job='static'` so the
  empty handstand class never appears as an exercise target.
- **New players default to `'handstand'`** (`profiles.job` DB default + the
  `handle_new_user` signup trigger, `migrations/20260824_default_job_handstand.sql`).
  Existing `'static'` players were NOT backfilled — the admin moves them with the
  JOB switch. `classes.job` keeps its `'static'` default (every seeded class sets
  it explicitly).
- Canonical job list for the UI: [lib/jobs.js](lib/jobs.js) (`JOBS`, `DEFAULT_JOB`
  = `'handstand'`; handstand is listed first so it leads the JOB switch).

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
| `mirror_quest_id` | uuid | **Cross-quest requirement** (nullable, FK → `class_quests(id)`, `migrations/20260824_hspu_requirement_mirror_freestanding.sql`). The node is a read-only MIRROR of another quest (normally in another chain of the same class): it counts as done when the referenced quest is completed, is never written to `student_quest_completions`, can't be toggled where it's shown, and carries `lvl_reward = 0`. Rule: [lib/mirrorQuests.js](lib/mirrorQuests.js). |
| `coach_approved` | boolean | **Coach-gated node** (`NOT NULL DEFAULT false`, `migrations/20260825_handstand_class3_mexican_sidequest.sql`). An ordinary quest in every way (own `student_quest_completions` row, own `lvl_reward`, gates its children) EXCEPT that only the coach may complete it, from the admin flow. The player's tap opens a "your coach checks this one" card instead of the confirm. Rendered GREEN. Rule: [lib/coachQuests.js](lib/coachQuests.js). |
| `is_hidden` | boolean | **Hidden challenge** (`NOT NULL DEFAULT false`, `migrations/20260824_hidden_challenges.sql`). The node is filtered OUT of the app — tree, node count, Skills chain progress — until EVERY id in its `prerequisites` is completed, then it appears already unlocked as a bonus node. Reveal rule: [lib/hiddenQuests.js](lib/hiddenQuests.js). |

**Quest tree logic:**
- A node is **unlocked** when all IDs in `prerequisites` are in the player's completions.
- A node is **done** when its ID exists in `student_quest_completions` for that player.
- Convergence nodes (`is_convergence = true`) require ALL prerequisite branches to be done.
- **Mirrored requirements** (`mirror_quest_id` set) are a requirement one main
  quest borrows from another. The only live one: the handstand job's **HSPU**
  main quest, whose whole `requirement` branch is a single node mirroring the
  **BALANCE** main quest's *Freestanding 20 sec* (it replaced HSPU's own
  "HS Hold 20 sec" + "HS Hold 20 sec x3 in a row"). Confirming Freestanding
  20 sec in BALANCE unlocks it — and the HSPU convergence below it — on its own;
  tapping it in HSPU only says where it's earned.
- **Coach-approved nodes** (`coach_approved = true`) are checked off by the COACH,
  not the player — the tree reads `useCoach().isAdmin` to decide who may toggle.
  First one: the handstand Class III side quest **MEXICAN HANDSTAND** → *Coach
  Approved* (`branch = 'coach'`), which merges with *Bridge 10 sec*
  (`branch = 'bridge'`) into the convergence *Mexican 10 sec*.
- **Hidden challenges** (`is_hidden = true`) don't exist for the player until every
  prerequisite is done — nothing on any screen hints at them (see `is_hidden` above).
  First one: the handstand Class I FOUNDATION main quest's **Wall Walk 5 reps**
  (`branch = 'challenge'`), gated on the tips of BOTH branches (POWER + MOBILITY).
  Second: the handstand **BALANCE** main quest's **HS Scale** (Handstand Scale,
  `branch = 'challenge'`), gated on the chain tip *Freestanding 30 sec* —
  `migrations/20260824_balance_hidden_challenge_hs_scale.sql`.
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

### `student_quest_upgrades`
**Quest upgrades** — has this player taken the upgrade on this quest?
(`migrations/20260824_quest_upgrades.sql`.)

Some main quests have a harder version of themselves waiting behind them. Clear
every node of the base quest and a gold UPGRADE gate rises at the foot of the
tree; take it and the quest **becomes** its upgrade — the tree swaps to the
harder nodes and the Skills card shows the upgrade's name and progress in the
base quest's place. Never a one-way door: an upgraded quest carries a version
switch in its header, and the player moves between the two halves freely.
Completions on both sides are untouched by switching *or* by upgrading.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `student_id` | uuid | FK → `profiles(id)` ON DELETE CASCADE |
| `class_id` | uuid | FK → `classes(id)` ON DELETE CASCADE |
| `base_chain` | text | The **base** chain's slug (e.g. `'comboes'`) — never the upgrade's, so the app can ask "is comboes upgraded?" without knowing what it upgrades into. |
| `upgraded_at` | timestamptz | Default `now()` |

`UNIQUE (student_id, base_chain)` — one upgrade per base chain per player, which
is also the upsert's conflict target.

**The pairing itself is NOT in the DB.** It's a client-side map keyed by chain
slug in [lib/questUpgrades.js](lib/questUpgrades.js) — chain slugs are stable
across the live DB's drift from the migration files, the same reasoning
[lib/prestige.js](lib/prestige.js) uses. Currently, on Handstand III:

| base chain (main) | upgrades into |
|---|---|
| `comboes` | `extreme_combo` |
| `straight_arm_presses` | `pike_press` |

**No quest rows moved.** `extreme_combo` and `pike_press` keep the
`quest_type = 'side'` they were seeded with; the app lifts them out of the SIDE
QUESTS section and shows them **only** as their base chain's upgraded face
(`isUpgradeChain` filters them from every side list). That leaves Handstand III
with exactly one real side quest, `SEVEN` — and with no Tier II left, SkillsScreen
drops the TIER I / TIER II sub-headers and puts the chains straight under
SIDE QUESTS.

**RLS:** self-scoped (`auth.uid() = student_id`) for ALL, plus an additive admin
policy via `public.is_admin()` so admin-as-coach sees a player's upgrade state.

**Undo — destructive.** The upgraded tree carries a muted **▼ DOWNGRADE** button
at its foot: UPGRADE's opposite, and the fix for one taken by accident. It
deletes the row *and* **wipes the upgrade quest** — every
`student_quest_completions` row for that chain's nodes goes with it, so re-taking
the upgrade starts the harder quest from zero rather than resuming it half-done.
The LVL those nodes paid goes too (LVL is computed from completions —
[lib/computeLvl.js](lib/computeLvl.js)), so QuestTreeScreen confirms first,
naming the LVL and node count at stake. The **base** chain's completions are
never in the delete set, so it stays cleared and the gold gate re-arms
immediately.

Distinct from the header's version switch, which only changes which half you're
*looking at* — that touches nothing at all. Upgrading is likewise non-destructive;
only DOWNGRADE removes anything.

**Written by:** QuestTreeScreen (`takeUpgrade` → upsert, `undoUpgrade` → delete).
**Read by:** QuestTreeScreen (gate + version switch), SkillsScreen (which face
each main-quest card shows).

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
| `category` | text | **Workout type/label.** One of `'main'` / `'side'` / `'handstand'` / `'accessory'` / `'legs'` (mirrors `gallery_example_workouts.category`); `NULL` = untyped (legacy rows). CHECK `workouts_category_check`. Chosen in Create/Edit Workout, copied from the gallery row on elite import, and shown as a label on the My Workouts card. Added in `migrations/20260630_workout_category.sql`; `'handstand'` added in `migrations/20260716_handstand_category.sql`. |
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

### `checkups`
A player's **weekly check-up** — their end-of-week submission (video clips +
written reflection) and the admin's video-URL feedback. One row per submission.
Added in `migrations/20260714_checkups.sql`. (Replaces the old Profile tab; NOT
related to the different, larger checkup system removed in the 2026-05-22
self-coach refactor.)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | `gen_random_uuid()` |
| `student_id` | uuid | FK → `profiles(id)` ON DELETE CASCADE (the player; owner) |
| `note` | text | **LEGACY** — the old single free-form reflection. Replaced by Part-1 `checkup_answers` (2026-07-22); no longer written. NULL |
| `submitted_at` | timestamptz | When the player submitted. **NULL = still a draft** the player is composing (created lazily on first video-add / submit) |
| `feedback_url` | text | Admin's feedback video URL (a clip recorded in another app). NULL = no feedback yet |
| `feedback_note` | text | Optional admin text feedback. NULL = none |
| `feedback_at` | timestamptz | When the admin replied. NULL = awaiting feedback |
| `created_at` | timestamptz | Auto — the **purge clock** (see retention below) |

**Index:** `(student_id)`, `(created_at)`.
**RLS:** owner-only (`auth.uid() = student_id`) + additive `admin all checkups`
(`public.is_admin()`) so the admin can review + write feedback.

### `checkup_videos`
The player's uploaded clips for a check-up (in the `checkup-videos` bucket).

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | `gen_random_uuid()` |
| `checkup_id` | uuid | FK → `checkups(id)` ON DELETE CASCADE |
| `student_id` | uuid | FK → `profiles(id)` ON DELETE CASCADE (denormalized for RLS + cheap purge) |
| `storage_path` | text | Path inside the `checkup-videos` bucket (`<user>/<checkup>/<ts>.<ext>`). **Needed to delete the file on purge** — CASCADE only removes this row, not the storage object |
| `video_url` | text | Public URL for playback |
| `item_id` | uuid | FK → `checkup_template_items(id)` ON DELETE SET NULL — the **Part-2 exercise** this clip answers (added 2026-07-22). NULL = legacy / unattached clip |
| `prompt` | text | Snapshot of the exercise name at upload (survives template edits). NULL = legacy |
| `answer_text` | text | The player's written note about this exercise. NULL = none |
| `order_index` | int | Position within the check-up (mirrors the exercise item order) |
| `created_at` | timestamptz | Auto |

**Index:** `(checkup_id)`, `(student_id)`, `(item_id)`.
**RLS:** owner-only + additive `admin all checkup videos`.

> **Retention — ONE check-up per player, ever (space policy, 2026-08-24).** The
> rule is **replace-on-submit**: when a player SUBMITS a new check-up,
> `purgePreviousCheckups(studentId, keepId)` in [lib/checkups.js](lib/checkups.js)
> deletes every EARLIER check-up of theirs — rows, video FILES, answers and the
> coach's feedback. Called from `CheckupScreen`'s `handleSubmit` right after
> `submitted_at` is stamped. Re-submitting an edited check-up reuses the same row,
> so nothing is lost there. There is intentionally **no** history: the current
> check-up lives exactly until the next one replaces it.
> The **14-day `purgeExpiredCheckups()`** (on load of `CheckupScreen` /
> `AdminCheckupScreen`) is now only a **BACKSTOP** for what replace-on-submit can't
> reach — an abandoned draft that already has clips in it, or the last check-up of a
> player who stopped opening the app.
> Both go through the shared `deleteCheckups(ids)`, which removes the storage
> objects (via `checkup_videos.storage_path`) **before** deleting the `checkups`
> rows, so nothing is orphaned in storage. **No schema change — client-side policy
> only, no migration.** Each clip is capped at **50 MB** (checked client-side in the
> uploader AND server-side by the bucket's `file_size_limit`).

**Used by:** `CheckupScreen` (player self — fill the template/upload/submit + view
feedback), `AdminCheckupScreen` (admin review + feedback + per-player customize,
opened from `PlayerAdminScreen`).

### `checkup_template_items`
The **admin-authored check-up template** (2026-07-22). An ordered list of items in
two parts the player fills in: **Part 1 QUESTIONS** (`part='question'` — a text
prompt about diet/sleep etc., answered with text) and **Part 2 EXERCISES**
(`part='exercise'` — an exercise `prompt` + reference `video_url` + `description`;
the player performs it and uploads their own clip + a note). Each row is scoped to
**either a class** (`class_id` — the class-standard, inherited by every player in
that class) **or a single player** (`player_id` — an override). Added in
`migrations/20260722_checkup_templates.sql`.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | `gen_random_uuid()` |
| `class_id` | uuid | FK → `classes(id)` ON DELETE CASCADE. Set on class-standard rows |
| `player_id` | uuid | FK → `profiles(id)` ON DELETE CASCADE. Set on per-player override rows |
| `part` | text | `'question'` (Part 1) or `'exercise'` (Part 2). CHECK-constrained |
| `prompt` | text | The question text, or the exercise name |
| `video_url` | text | Reference/demo clip — exercises only. NULL for questions |
| `description` | text | Explanation words — exercises only. NULL for questions |
| `order_index` | int | Position within its part |
| `created_at` | timestamptz | Auto |

**CHECK `checkup_item_scope`:** exactly one of `class_id` / `player_id` is set
(`(class_id is not null) <> (player_id is not null)`).
**Index:** `(class_id)`, `(player_id)`.
**RLS:** `admin all checkup template items` (`public.is_admin()`, full CRUD) +
`read checkup template items` (any authenticated player may SELECT class-standard
rows OR their own `player_id` rows — read-only; only the admin modifies).

> **Resolution (`resolvePlayerTemplate` in [lib/checkups.js](lib/checkups.js)):** a
> player's effective template is their OWN (`player_id`) rows if any exist, else the
> rows of their `class_id`. The admin "customizes" a player by **materializing** —
> copying the class rows onto `player_id` rows (`materializePlayerTemplate`) — then
> edits/trims those; **reset to standard** deletes the player's rows
> (`resetPlayerTemplate`). Template items are the standing definition and are **NOT**
> subject to the submission purge.

**Used by:** `AdminCheckupTemplateScreen` (class-standard authoring, from the ADMIN
dashboard), `AdminCheckupScreen` (per-player customize), `CheckupScreen` (player
renders the resolved template).

### `checkup_answers`
The player's **Part-1 text answers** — one row per question (2026-07-22). `prompt`
is a SNAPSHOT of the question at submit so the admin's review stays readable even
if the template item is later edited/deleted. Added in
`migrations/20260722_checkup_templates.sql`.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | `gen_random_uuid()` |
| `checkup_id` | uuid | FK → `checkups(id)` ON DELETE CASCADE |
| `student_id` | uuid | FK → `profiles(id)` ON DELETE CASCADE (owner; RLS) |
| `item_id` | uuid | FK → `checkup_template_items(id)` ON DELETE SET NULL — the question answered |
| `prompt` | text | Snapshot of the question text |
| `answer_text` | text | The player's written answer. NULL = left blank |
| `order_index` | int | Mirrors the question item order |
| `created_at` | timestamptz | Auto |

**Index:** `(checkup_id)`, `(student_id)`.
**RLS:** owner-only (`auth.uid() = student_id`) + additive `admin all checkup answers`.
Purged with its `checkups` row (CASCADE) under the one-check-up space policy.

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

> **Owner RLS keyed on `student_id` (`migrations/20260811_daily_quests_owner_rls_fix.sql`).**
> The original live policy gated writes on `coach_id = auth.uid()` (pre-refactor
> coach model). After the self-coach refactor the app writes `coach_id =
> student_id`, but quests authored under the OLD coach kept the old coach's
> `coach_id`, so players could SEE them (SELECT is `student_id`-keyed) but not
> soft-delete/edit them — the UPDATE returned 0 rows and no error, a silent
> no-op. The migration adds additive owner policies keyed on `auth.uid() =
> student_id` (permissive → OR'd, so they grant self-access regardless of any
> stale coach_id policy) and backfills `coach_id = student_id` on legacy rows.
> `removeQuest`/`saveEdit` now `.select()` the affected row and alert if 0 rows
> came back, so an RLS mismatch can't fail silently again.

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
**UNUSED as of 2026-08-13** — the Weekly Accessories feature/screen was deleted from
the app (this table + `accessory_completions` are no longer read or written). Kept
in the DB for now; drop both in a migration for a full cleanup. Description below is
historical.

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
| `category` | text | Gallery filter bucket: `'main'` (Main Quest), `'side'` (Side Quest), `'handstand'` (Handstand), `'accessory'` (Accessories), or `'legs'` (Legs). `NOT NULL DEFAULT 'main'`, CHECK-constrained. Added in `migrations/20260622_example_workout_category.sql` (existing rows backfilled to `'main'`); `'legs'` added in `20260628_legs_category.sql`, `'handstand'` in `20260716_handstand_category.sql`. The gallery's Example Workouts tab filters by class + this category. |
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

### Community — `community_groups` / `community_group_members` / `community_challenges`
The **Community** feature (2026-07-17). A group is a small set of players; each
group has its own challenges only its members see. A player can belong to MANY
groups. The **admin owns the structure** (creates groups, sets members, authors
challenges); players get a read-only COMMUNITY tab. Added in
`migrations/20260717_community.sql`. Helpers in [lib/community.js](lib/community.js).
(Distinct from the orphaned `challenges` table above — that is a different,
removed feature.)

**`community_groups`** — one row per group.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | `gen_random_uuid()` |
| `name` | text | Group name (required) |
| `description` | text | Optional blurb. NULL = none |
| `created_at` | timestamptz | Auto |

**`community_group_members`** — a player's membership in a group (M:N).

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | `gen_random_uuid()` |
| `group_id` | uuid | FK → `community_groups(id)` ON DELETE CASCADE |
| `player_id` | uuid | FK → `profiles(id)` ON DELETE CASCADE |
| `created_at` | timestamptz | Auto |

**Unique:** `(group_id, player_id)` — no duplicate membership.
**Index:** `(group_id)`, `(player_id)`.

**`community_challenges`** — a challenge scoped to one group.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | `gen_random_uuid()` |
| `group_id` | uuid | FK → `community_groups(id)` ON DELETE CASCADE |
| `title` | text | Challenge name (required) |
| `description` | text | What it is. NULL = none |
| `created_at` | timestamptz | Auto — also the **day-scope clock** (see below) |

**Index:** `(group_id)`.
**Day-scoped (player view):** a challenge is live only on the calendar day it was
created — player reads filter `created_at >= startOfTodayISO()` (`lib/community.js`),
so after local midnight it stops showing. Rows are **not** deleted; admin authoring
(`AdminGroupScreen`) sees all.

**`community_challenge_completions`** — a member's personal "I did it" mark on a
challenge (the competitive core). Added in
`migrations/20260718_community_challenge_completions.sql`.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | `gen_random_uuid()` |
| `challenge_id` | uuid | FK → `community_challenges(id)` ON DELETE CASCADE |
| `player_id` | uuid | FK → `profiles(id)` ON DELETE CASCADE |
| `created_at` | timestamptz | Auto |

**Unique:** `(challenge_id, player_id)`. **Index:** `(challenge_id)`, `(player_id)`.
**RLS:** additive **admin** all + **member read** (group members read every
completion for their groups' challenges — gated by `is_group_member` on the
challenge's group via subquery) + **owner write** (`auth.uid() = player_id` — a
player marks/unmarks only their OWN completion). Ticking off deletes the row.

**RLS (groups/members/challenges):** additive **admin** full CRUD (`public.is_admin()`) + a
**member read** policy. Members reads are gated by the SECURITY DEFINER helper
`public.is_group_member(gid)` (checks the caller's membership without tripping
`community_group_members`' own RLS — avoids recursion): a member may `SELECT` the
groups they belong to, the membership rows of those groups (to see co-members),
and those groups' challenges. Players never write — only admins mutate.
The migration also adds an additive `read co-member profiles` policy on
`profiles` (helper `public.shares_group_with(other)`) so a player can read the
NAME of anyone they share a group with — otherwise the owner-only `profiles`
policy would hide co-members' names in the group view.

---

### Community RAIDS — `community_raids` / `community_raid_contributions`
Added in `migrations/20260720_community_raids_and_leaderboard.sql`. A **raid** is a
group-wide **pooled** goal the whole squad fills together (unlike a challenge,
which is a per-member checkbox). The admin authors a raid with a numeric `target`
and a `unit`; every member logs the amount THEY did and all contributions sum into
one collective bar. Authored on `AdminGroupScreen` (＋ SUMMON RAID); players see
the bar + per-member breakdown and log their own increments on `CommunityGroupScreen`.

**`community_raids`** — one pooled goal for a group.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | `gen_random_uuid()` |
| `group_id` | uuid | FK → `community_groups(id)` ON DELETE CASCADE |
| `title` | text | e.g. `'Squad Pushup Siege'` |
| `unit` | text | Nullable, e.g. `'pushups'`, `'km'` |
| `target` | integer | The collective goal. CHECK `target > 0` |
| `description` | text | Optional |
| `created_at` | timestamptz | Auto |

**`community_raid_contributions`** — append-only log of increments; progress =
`sum(amount)`, a member's share = `sum(amount)` filtered to them (never updated —
each drop of effort is its own row).

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | `gen_random_uuid()` |
| `raid_id` | uuid | FK → `community_raids(id)` ON DELETE CASCADE |
| `player_id` | uuid | FK → `profiles(id)` ON DELETE CASCADE |
| `amount` | integer | CHECK `amount > 0` |
| `created_at` | timestamptz | Auto |

**Index:** raids `(group_id)`; contributions `(raid_id)`, `(player_id)`.
**RLS:** raids — additive **admin** all + **member read** (`is_group_member(group_id)`).
Contributions — **admin** all + **member read** (`is_group_member` on the raid's
group via subquery) + **member log own** (`auth.uid() = player_id` AND member of
the raid's group). Helpers reused from `20260717_community.sql`.

**Leaderboard read access.** The same migration adds an additive `read co-member
quest completions` SELECT policy on `student_quest_completions`
(`public.shares_group_with(student_id)`), so the group leaderboard
(`fetchGroupLeaderboard`) can compute every member's LVL from their completions —
the base policy is owner-only. Ranked by class `order_index` (tier) then LVL.

**Group streak.** No schema — `fetchGroupStreak` in [lib/community.js](lib/community.js)
computes it from `community_challenges` + `community_challenge_completions`: each
challenge the whole group cleared = +1 (counts LIVE the instant the last member
ticks); a challenge settled ≥24h old with anyone missing resets it to 0. 24h is
the safe upper bound for the latest local midnight across all timezones, so no
per-member timezone is stored. Only members present when a challenge was posted
(`community_group_members.created_at <= challenge.created_at`) are required, so a
new member can't retroactively break old challenges.

**Used by:** `CommunityScreen` + `CommunityGroupScreen` (player, read-only tab),
`AdminCommunityScreen` + `AdminGroupScreen` (admin, opened from the COMMUNITY
button on `AdminDashboard`).

---

### Community CHAT — `community_messages`
Added in `migrations/20260721_community_chat.sql`. A lightweight, **text-only**
group chat: every member of a group can post and read that group's messages (a
bonding space alongside challenges/raids). **Ephemeral by design** — messages are
kept only **7 days** (`CHAT_RETENTION_DAYS` in [lib/community.js](lib/community.js))
then swept, so the table never grows unbounded (same no-history philosophy as
check-ups and the 9-week workout window).

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | `gen_random_uuid()` |
| `group_id` | uuid | FK → `community_groups(id)` ON DELETE CASCADE |
| `player_id` | uuid | FK → `profiles(id)` ON DELETE CASCADE — the sender |
| `body` | text | The message, CHECK `char_length between 1 and 1000` |
| `created_at` | timestamptz | Auto — also the **purge clock** |

**Index:** `(group_id)`, `(group_id, created_at)`.
**RLS:** additive **admin** all (`is_admin()` — oversight + moderation, delete any
message) + **member read** (`is_group_member(group_id)`) + **member send own**
(insert `WITH CHECK auth.uid() = player_id AND is_group_member(group_id)`) +
**member delete own** (`auth.uid() = player_id` — unsend) + **member purge
expired** (delete when `is_group_member(group_id) AND created_at < now() -
interval '7 days'`). That last policy is what lets the **client-side** purge run
with no cron/service role — whoever opens the chat sweeps the group's expired
rows; it's bounded to old messages so it can't wipe live chat.

**Freshness:** there is no realtime subscription — the chat screen (and the group
screens' preview) **poll `fetchGroupMessages` every 3s for the whole time the
screen is MOUNTED** (`CHAT_POLL_MS`), clearing on unmount. NOT focus-gated: these
sit inside the material-top-tab pager where `useIsFocused` is unreliable, so a
focus gate makes the poll silently never fire (new messages only show on re-entry).
See lib/community.js `fetchGroupMessages` / `sendMessage` / `deleteMessage` /
`purgeExpiredMessages`.

**Admin posts too:** the admin isn't a group member, so the member-send policy
blocks them, but the **admin-all** policy lets the coach post; those messages
render as **COACH** (a non-member sender can only be the admin).

**Used by:** `CommunityChatScreen` — the full-screen chat (WhatsApp-style inverted
list), shared by player + admin via an `isAdmin` param and opened from a CHAT bar /
left-swipe on `CommunityGroupScreen` (player: post/unsend) and `AdminGroupScreen`
(admin: post-as-COACH + delete-any). The group screens keep a light poll only for
the bar's last-message preview.

---

### Coach ⇄ player DIRECT chat — `coach_messages`
Added in `migrations/20260722_coach_chat.sql`. A **private 1-on-1** text chat
between ONE player and the coach (admin) — distinct from the per-group
`community_messages`. The conversation is keyed to the player (`player_id` = the
"channel"); `sender_id` records the author. A message is **from the coach** iff
`sender_id <> player_id`. Same **ephemeral 7-day** policy as the group chat
(`CHAT_RETENTION_DAYS`), swept client-side on load.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | `gen_random_uuid()` |
| `player_id` | uuid | FK → `profiles(id)` ON DELETE CASCADE — the channel (whose coach-chat) |
| `sender_id` | uuid | FK → `profiles(id)` ON DELETE CASCADE — the author (player, or an admin = COACH) |
| `body` | text | The message, CHECK `char_length between 1 and 1000` |
| `created_at` | timestamptz | Auto — also the **purge clock** |

**Index:** `(player_id)`, `(player_id, created_at)`.
**RLS:** additive **admin** all (`is_admin()` — coach reads/replies to any
channel, deletes any message) + **player read own** (`auth.uid() = player_id`) +
**player send own** (insert `WITH CHECK auth.uid() = player_id AND auth.uid() =
sender_id` — a player only writes their own channel as themselves) + **player
delete own** (`auth.uid() = sender_id` — unsend) + **player purge expired**
(delete when `auth.uid() = player_id AND created_at < now() - interval '7 days'`).
The purge policy lets the **client-side** sweep run with no cron/service role.

**Used by:** `CoachChatScreen` — the shared full-screen 1-on-1 chat (`isAdmin`
param + optional `player`). The **player** opens it from the gold **COACH card
pinned at the top of the Community tab** (`CommunityScreen`); the **coach** opens
it from the **COACH CHAT tile on `PlayerAdminScreen`**. Helpers in
[lib/community.js](lib/community.js): `fetchCoachMessages` / `latestCoachMessage`
(card preview) / `sendCoachMessage` / `deleteCoachMessage` /
`purgeExpiredCoachMessages`. Freshness via the same 3s mounted-life poll as the
group chat (not focus-gated).

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

## Business layer — `billing_plans` / `player_billing` / `payments` / `billing_settings` (2026-08-25)

The coach's **commercial** side, added in
[migrations/20260825_business_billing.sql](supabase/migrations/20260825_business_billing.sql).
Everything here is **ADMIN-ONLY at the RLS level** — a player cannot read one row
of it. Helpers in [lib/billing.js](lib/billing.js) (data access + all money math)
and [lib/engagement.js](lib/engagement.js) (churn risk from training activity).
Screens: `AdminBusinessScreen` (dashboard), `AdminPlansScreen` (price list +
settings), `PlayerBillingScreen` (one customer's file).

> **The core rule: money is never derived from a plan price.** `billing_plans`
> says what *should* arrive; `payments` records what *did*. Every "collected"
> figure comes from the ledger, every "expected" figure from the plan, and the
> gap between them is the outstanding balance. This is what keeps historical
> months correct after a price change.

> **Currencies are never summed.** ILS and USD live side by side (an Israeli
> client is billed in shekels, an overseas one in dollars) and there is no FX
> rate anywhere in the app. Every total is a `{ ILS, USD }` "bag" — see
> `emptyBag` / `bagAdd` / `bagText` in `lib/billing.js`.

### `billing_plans`
The price list. Pointed at by `player_billing.plan_id`.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `name` | text | `STANDARD` / `ELITE` / `FAMILY` … |
| `price` | numeric(10,2) | Per month |
| `currency` | text | `ILS` or `USD` (checked) |
| `is_free` | boolean | **Family / comped / trial.** A first-class flag, NOT price = 0: free players are excluded from ARPU, never chased for money and never locked out |
| `sessions_per_week` | smallint | Optional |
| `description` | text | |
| `active` | boolean | `false` = retired, kept for history |
| `order_index` | integer | Display order |

Seeded with STANDARD / ELITE / FAMILY / TRIAL **only on a virgin install**
(`where not exists (select 1 from billing_plans)`), so re-running never clobbers
real plans.

### `player_billing`
One row per player — the customer file. **No row = never commercially onboarded**
(the roster shows NOT SET UP).

| Column | Type | Notes |
|--------|------|-------|
| `player_id` | uuid PK | FK → `profiles(id)` ON DELETE CASCADE |
| `started_at` | date | When they started **training with you** — deliberately not `profiles.created_at` |
| `ended_at` | date | NULL = still with you |
| `status` | text | `trial` / `active` / `paused` / `churned` |
| `paused_from` / `paused_until` | date | **Freeze window** (army / injury / travel). Without it a freeze reads as churn and every retention number lies |
| `plan_id` | uuid | FK → `billing_plans(id)` ON DELETE SET NULL |
| `price_override` | numeric | This player pays a special rate (wins over the plan) |
| `currency_override` | text | `ILS`/`USD` — overrides the plan's currency |
| `billing_day` | smallint | 1–28 (28 max: every month has it) |
| `term_months` | smallint | NULL/1 = rolling monthly; 3/6/12 = committed package |
| `term_started_at` | date | Term clock start → `termEnd()` computes the renewal date |
| `auto_pay` | boolean | Their card/subscription charges itself |
| `provider` / `provider_customer_id` / `provider_subscription_id` | text | Payment-provider linkage; empty until one is connected |
| `source` | text | **Acquisition channel** — referral / instagram / gym … The highest-value analytics field here: which channel produces customers who STAY is only knowable if it was recorded on day one |
| `referred_by` | uuid | FK → `profiles(id)` — who sent them |
| `goal` | text | Why they came (drives the upsell conversation) |
| `phone` / `birthday` | text/date | **LEGACY as of 2026-08-25** — the live values live on `profiles.phone` / `profiles.birthday` (global, set at invite time). Nothing writes these anymore; `lib/billing.js` reads and saves the profile columns behind the business card's PHONE / BIRTHDAY fields. Kept only so the backfill in `migrations/20260825_profile_contact.sql` has a source. |
| `medical_notes` | text | Relationship field |
| `churn_reason` | text | **Coded** (`price`/`time`/`injury`/`moved`/`results`/`ghosted`/`goal_reached`/`other`) so it aggregates |
| `churn_note` | text | The colour behind the code |
| `notes` | text | Private admin notes |
| `created_at` / `updated_at` | timestamptz | |

**Index:** `(status)`.

### `payments`
**The ledger** — one row per money event. Source of truth for all revenue.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `player_id` | uuid | FK → `profiles(id)` ON DELETE CASCADE |
| `amount` | numeric(10,2) | Refunds are stored negative |
| `currency` | text | `ILS` / `USD` |
| `kind` | text | `subscription` / `extra` (one-off upsell — session, program, gear) / `refund` |
| `label` | text | For extras: "1-on-1 session" |
| `status` | text | `paid` / `pending` / `failed` / `refunded` |
| `paid_at` | date | Set when status = paid |
| `due_at` | date | Set on `pending` rows — **this is what drives OUTSTANDING and the lock gate** |
| `period_start` / `period_end` | date | Which month the payment BUYS — kept separate from `paid_at` so a late payment lands in the right month |
| `method` | text | cash / bit / paybox / transfer / card |
| `provider` / `provider_ref` | text | Provider txn id |
| `auto` | boolean | `true` = machine-recorded (webhook), not typed by hand |
| `note` | text | |
| `created_at` | timestamptz | |

**Index:** `(player_id)`, `(paid_at)`, `(status)`, plus a **partial UNIQUE**
`(provider, provider_ref) where provider_ref is not null` — a provider may retry
a webhook and the same transaction must never book twice.

### `billing_settings`
Exactly **one row** (`id boolean primary key default true check (id)`).

| Column | Type | Notes |
|--------|------|-------|
| `default_currency` | text | `ILS` / `USD` |
| `grace_days` | smallint | How long a due charge may sit unpaid before lock (default 7) |
| `lock_on_overdue` | boolean | **Default `false`** — leave off until payments arrive automatically, or it locks people who paid you in cash |
| `business_name` | text | Shown as the BUSINESS screen subtitle |

### `public.my_access_state()`
SECURITY DEFINER function, `execute` granted to `authenticated`. The **only**
billing fact a player may learn about themselves: `'ok'` / `'grace'` / `'locked'`
— no price, no dates, no amount. It returns `'ok'` whenever `lock_on_overdue` is
off, or the player is free / trial / paused / has no billing row. Enforcement is
**not wired into `App.js`** — the function exists so a lock screen can be added
later without ever exposing the business tables to the client bundle.

**Churn risk** ([lib/engagement.js](lib/engagement.js)) stores nothing new. It
reads `workout_override_workouts` (completed), `daily_quest_completions` and
`checkups.submitted_at` over a **28-day** window — deliberately inside the 9-week
retention prune on the two per-date tables, so pruned history is never misread as
inactivity. Score = silence (0–50) + missing volume (0–30) + check-up staleness
(0–20); players in their first 10 days are exempt.

---

## Storage Buckets

- **`checkup-videos`** (public, **50 MB `file_size_limit`**) — player check-up
  clips (`checkup_videos.video_url` / `storage_path`, path `<user>/<checkup>/<ts>.<ext>`).
  Created + policied by `migrations/20260714_checkups.sql` (bucket insert + public
  read / authenticated insert+delete on `storage.objects`). Files are removed by
  the check-up purge — replace-on-submit + the 14-day backstop (see `checkups`).
- **`exercise-videos`** (public) — exercise demo videos (`exercises_gallery.video_url`).
- **`avatar`** (public) — **orphaned** since the Profile screen was removed
  (2026-07-14). No code reads/writes it anymore; delete manually if you want the
  old profile pictures gone.

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