# Calisthenics App — Project Knowledge

## Stack
- React Native + Expo (JavaScript)
- Supabase (database + auth)

## Roles
Only two roles exist: **`admin`** and **`player`** (the old `coach` and `student`
roles were removed in the 2026-05-22 self-coach refactor; both collapsed into
`player`). New sign-ups default to `player`.
- **Player**: their own coach. Controls their own class, level (via quest
  completion), prestige, daily quests, and workouts.
- **Admin**: oversight + **acting coach**. Roster of all players, the shared
  exercise gallery, challenges, AND full control over any player's account:
  tapping a player on `AdminDashboard` opens `PlayerAdminScreen` (a hub) which
  reuses the self-coach screens scoped to that player — Skills/class/level/quests,
  workouts/schedule, and daily quests. (No more coach *assignment* — admin can act
  on everyone.) See "Admin-as-coach" below.

## Admin-as-coach — CRITICAL
An admin can manage ANY player's account. The mechanism reuses the self-coach
screens two ways, set when the admin taps a player on the roster:
- **CoachContext**: `AdminDashboard` calls `setSelectedStudent(player)` before
  navigating, so the context-scoped screens (`Manage`/StudentDetailScreen,
  AllWorkouts, EliteWorkouts, CreateWorkout, DailyQuest) act on that player with no
  changes — they already read `selectedStudent`.
- **`studentId` route param**: `SkillsScreen`, `QuestTreeScreen` and
  `WorkoutsScreen` are auth-user-scoped by default (a player's own tabs). They now
  accept an optional `studentId` param; when present they target THAT player
  (profile/class/prestige writes + quest toggles for Skills/Quest; the actual dated
  week — per-date overrides, completions, edits — for WorkoutsScreen). No param =
  the signed-in user, unchanged. `PlayerAdminScreen` passes `studentId`;
  SkillsScreen forwards it to QuestTree. The hub's **CURRENT WEEK** button opens
  WorkoutsScreen with the param so the admin sees the player's real week (with their
  changes). (WorkoutsScreen no longer has a ▶ WORKOUT MODE button at all — the live
  session is entered only through HomeScreen's portal, a device-local self-scoped
  flow not meaningful for an admin anyway.)
- These screens are registered in BOTH the player navigators and the `AdminStack`
  (App.js) so they work from either entry.
- **DB REQUIREMENT:** every player-owned table is owner-only RLS
  (`auth.uid() = student_id`), so admin writes are rejected without the
  admin-override policies in
  `supabase/migrations/20260621_admin_manage_players.sql` (additive `is_admin()`
  policies on profiles, student_quest_completions, workouts, exercises,
  weekly_workout_template, workout_override_workouts, daily_quests,
  daily_quest_completions). That migration must be applied to the live Supabase.

## Self-Coach Model — CRITICAL
Every player IS their own coach. There is no separate coach experience. The
former coach screens are reused **scoped to the player's own profile**:
- `App.js` seeds the shared `CoachContext` (`selectedStudent`) with the logged-in
  player's profile via `<SelfStudentSync />`, so screens originally written for a
  coach acting on a student now act on the player themselves with no rewrites.
- **SkillsScreen** (Skills tab) is the class/level hub: assign/change own class,
  prestige (gated per class — see Class & Quest System), and open interactive
  quest trees.
- **QuestTreeScreen** is interactive — tapping a node toggles the player's own
  completion (the only way LVL changes). Same generic `student_quest_completions`
  write as before, with `student_id` = self.
- **WorkoutsScreen → "Manage My Training"** opens `StudentDetailScreen` (the
  self workout/calendar authoring hub), which links to `DailyQuestScreen`
  (`CoachDailyQuestScreen.js`) for self daily-quest management.
- Routing: `admin` → AdminNavigator; everyone else → PlayerApp.

## Class & Quest System
- Each player has a class assignment (self-assigned via SkillsScreen)
- Classes have main quests + side quests → give level-up points (LVL = Σ
  `lvl_reward` of completed quests in the class)
- **Prestige gating** is declarative, per class, in [lib/prestige.js](lib/prestige.js)
  (`PRESTIGE_REQUIREMENTS` keyed by class `order_index`; pure `evaluatePrestige()`).
  Three kinds of gate, ALL must pass:
  1. **Level** — reach `classes.prestige_at` (85 / 100 / 160 for Class I/II/III;
     still the single DB-stored level number, drives the bar marker too).
  2. **Main quests** — `'all'` (Class I) or specific chains + named nodes
     (Class II: `Freestanding 30 sec` (handstand) + `2 HSPU` + `2 OAPU`;
     Class III: the five front_lever/planche nodes).
  3. **1 Tier II skill** — fully complete ≥1 Tier-2 SIDE chain (detected
     structurally, same rule as the tier grouping below).
  Requirements reference quests by **(chain, name)**, never by id or `lvl_reward`
  (the live DB's rewards drift from migrations; names are stable). SkillsScreen
  shows a live requirements checklist until all gates pass, then the prestige
  banner. Prestige advances `class_id` to the next `order_index` (blocked on the
  final class — no class to advance into); completions are preserved.
- **Prestige stars** displayed (Home/Skills/Admin roster) are DERIVED from classes
  overcome via `prestigeStars()` in [lib/prestige.js](lib/prestige.js): base =
  current class `order_index`, plus 1 if you're in the final class and meet all its
  requirements. NOT the raw `profiles.prestige_count` column (legacy/history only —
  it could exceed the class count). Never render `prestige_count` directly.
- Class count is DYNAMIC — currently 3, more coming. Never hardcode the number.
  A class with no `PRESTIGE_REQUIREMENTS` entry gates on level only.
- TIERS (Class III+): a tier is an intentional MAIN-quest concept. The in-tree
  "TIER II" divider renders ONLY for main quests; side-quest trees never show it
  (their multi-branch merges look identical but are NOT tier crossings). Side
  quests instead express tiers across CHAINS — a chain is Tier 2 when any of its
  quests has a prerequisite in a different chain; SkillsScreen groups the
  side-quest list into Tier I / Tier II accordingly. No `tier` column exists;
  tiers are derived structurally from `is_convergence` + cross-branch/cross-chain
  `prerequisites`.

## Checkups — REMOVED
The entire checkup system (tables, screens, and the `checkup-videos` storage
bucket) was deleted in the 2026-05-22 self-coach refactor. There is no checkup
flow anymore. Do not reintroduce it without an explicit request.

## Training Schedule — skeleton + per-date overrides
Two layers, resolved at read time in [lib/schedule.js](lib/schedule.js)
(`resolveDayWorkouts`, `materializeDay`):
- **`weekly_workout_template`** — the recurring weekly SKELETON keyed by
  `day_of_week` (0=Sun…6=Sat). The Manage hub (StudentDetailScreen) is now a
  read-only Sun–Sat plan VIEW (it shows each weekday's workouts and lets you
  remove one), plus action buttons: **⚔ ELITE WORKOUTS** (→ `EliteWorkoutsScreen`),
  **+ CREATE WORKOUT**, and **MY WORKOUTS** (→ `AllWorkoutsScreen`). It no longer
  assigns workouts to days.
  Assigning a workout to weekday(s) now happens in the **My Workouts warehouse**
  (`AllWorkoutsScreen`): each of the player's own workouts has an **ASSIGN** button
  opening a Sun–Sat multi-day picker; SAVE diffs the selection against the live
  template (inserts newly-checked days, deletes unchecked ones) and the card shows
  the weekday chips it's currently on.
  The warehouse is stocked two ways: **+ CREATE WORKOUT** (author from scratch) and
  **importing an elite workout**. Elite import is a PLAYER-ONLY screen
  (`EliteWorkoutsScreen`) — deliberately NOT the admin gallery: it has no exercise
  browsing and no authoring/editing, only a class filter + a **+ IMPORT TO MY
  WORKOUTS** action per example workout. Import COPIES a `gallery_example_workouts`
  row into the player's own `workouts` + `exercises` via
  [lib/workouts.js](lib/workouts.js) `importGalleryWorkout()` (shared helper). The
  copy is independent (later admin edits don't propagate); the gallery row's
  `category` (the workout TYPE — main/side/accessory/legs) is carried over too, so
  the My Workouts card can label it. From-scratch workouts pick the type in
  Create/Edit Workout. `WORKOUT_CATEGORIES` + `categoryLabel()` live in lib/workouts.
  Gallery example workouts store exercises/branches INLINE (JSONB). (The admin gallery `ExerciseGalleryScreen`
  is the AUTHORING tool — exercises tab + example-workout create/edit/delete — and is
  not where players import from.)
- **`workout_override_workouts`** — per-specific-date overrides that **win** over
  the skeleton for that date and carry `completed`. Edited per date on
  WorkoutsScreen (EDIT DAY / RESET TO WEEKLY PLAN).
Rule: a date shows its override rows if any exist, else the weekday's template
(virtual). First completion/edit of a template day **materializes** it (copies the
weekday template into override rows for that date). HomeScreen & WorkoutsScreen
read via this resolution; never query one table alone for "what's on a day". EXP
was removed (2026-06-05) — completing a workout/quest awards nothing now.

**9-week retention window (2026-06-18).** WorkoutsScreen's week ruler only travels
4 weeks back … 4 weeks forward (9 weeks total); the nav arrows are clamped to that
range. On load it prunes the player's per-date rows outside that window
(`workout_override_workouts`, `daily_quest_completions`) to keep the DB small —
older completion history is intentionally discarded. See DATABASE.md. **Day
"accomplished" rule** (the shining ice-blue day cell): a workout day glows when all
its workouts are completed; a **REST day** (no workouts) glows when all active
**daily quests** are checked off for that date.

## Weekly Accessories — off-program extra work
A self-managed list of accessory / legs movements the player wants to hit a
**target number of times per week**, performed AD HOC (whenever — deliberately OFF
the dated, fatigue-managed schedule, so they never add managed-program load). Lives
on `WeeklyAccessoriesScreen`, opened from the **top-right ACCESSORIES** (gold) pill
on the Manage hub (StudentDetailScreen). Each accessory shows a row of tappable rep
cells; tap one each time you finish a rep — progress is `count / target` counted
within the current **Sun–Sat week** (reuses `getWeekDays(0)` from lib/schedule) and
resets automatically next week. Cells past the target glow gold (bonus). Player
adds an accessory by **picking one of their own ACCESSORIES/LEGS-typed workouts**
(the add/edit modal's MY WORKOUTS picker filters to `category` `accessory`/`legs`
only — main/side quests are the dated program and excluded; workouts already added
are disabled to avoid dupes);
the chosen workout's title becomes the accessory name and `weekly_accessories.workout_id`
links back to it (the name is also copied so the row survives if the workout is
deleted). The card shows the linked workout's TYPE chip. Player can
edit (re-pick workout + times-per-week stepper) / soft-remove items.
**Optional scheduling (2026-06-30):** an accessory can also be pinned to weekday(s)
of the player's REAL routine — each card has an ADD TO ROUTINE / IN ROUTINE day
strip that toggles `weekly_workout_template` rows for the accessory's `workout_id`
(the same schedule Home/Workouts read), and the screen shows a weekly RULER marking
which days have accessories. Scheduling is opt-in — most accessories stay ad-hoc.
Scheduled accessories render in their TYPE color (gold = accessory, green = legs,
via `categoryMeta` in lib/workouts) everywhere they appear: the Accessories ruler,
the Workouts week ruler (accent dots) + day panel (colored card + TYPE tag), and
HomeScreen's today's missions (colored accent). Backed by
`weekly_accessories` + `accessory_completions` (see DATABASE.md), owner-RLS + admin
override, so it's scoped to the CoachContext player (admin-as-coach manages a
player's list, same as the rest of the Manage hub). Registered in BOTH the Workouts
and Admin stacks.

## Workout Mode — live session (LOCAL only)
"Workout Mode" is where a player actually performs a scheduled workout, logging
each set as they go. Entered **exclusively through the RED GATE portal** on
HomeScreen's today's-missions (tap a mission → the gate opens → ▶ ENTER / ▶ RESUME
steps through into the live session via `startWorkoutMode`). WorkoutsScreen's day
panel does NOT offer it anymore — its rows are VIEW / MARK DONE only (no
▶ WORKOUT button). This keeps the "entering a session" moment a single, dramatic
portal flow rather than a plain list button.
- **Screens:** `WorkoutModeScreen` (the tracker) → `WorkoutSummaryScreen` (the
  end-of-session recap). Both registered in `App.js`'s `WorkoutsNavigator`.
- **State is LOCAL, never in Supabase** — the live session lives in AsyncStorage
  via [lib/workoutSession.js](lib/workoutSession.js) so the player can exit and
  resume where they left off. It is **cleared the moment the workout is
  finished**; no server-side session history is kept. The only lasting artifact
  is the summary screen, which the player screenshots.
- **Breaks / time log:** a session is a list of `segments` (`{start,end}`). Exiting
  Workout Mode closes the open segment; resuming opens a new one. A **break** is
  the gap between consecutive segments. The summary shows total training time,
  each segment's clock times, break durations, per-set reps, and totals.
- **Per-set log:** check + reps-done (numeric). Target reps (`exercises.reps`,
  which may be text like `8-12`/`MAX`) is shown only as a placeholder hint.
- **How-to card (forgot the exercise?):** the exercise NAME on EVERY tracker card is a
  button (ice-glow + ⓘ) that opens `ExerciseDetail` (video + coaching cues). The rich
  data lives in the shared `exercises_gallery` catalog; the tracker resolves it in
  three tiers: (1) exact `exercises.gallery_id` link (set by the builders — see
  DATABASE.md), (2) normalized-name match (`normName`: lowercased, punctuation/
  whitespace stripped) for legacy/free-text rows, (3) a name-only fallback card ("no
  video added yet") so the title is ALWAYS tappable. Prefer the `gallery_id` link —
  name matching is fragile (imported/free-typed workout names drift from the catalog).
  Both Create/Edit Workout store `gallery_id` when an exercise is picked from the
  library, so any workout authored/re-saved after 2026-07-01 links exactly.
- **Set ranges:** `exercises.sets` is TEXT and may be a range like `'1-2'`. The
  lower bound is the REQUIRED set count; extra sets up to the upper bound are
  OPTIONAL. Workout Mode shows all rows but renders the optional ones muted
  ("· OPTIONAL"), and completion / progress count only the required sets (optional
  sets are bonus and never block finishing). Single values (`'3'`) = all required.
  `parseSets()` in WorkoutModeScreen does the parsing. (`sets` became text in
  `migrations/20260622_exercise_sets_text.sql`.)
- **Finishing** marks the workout done in `workout_override_workouts` (same
  materialize-then-complete path as WorkoutsScreen's MARK DONE) and clears the
  local session.
- **Gallery preview (`gallery: true` route param):** WorkoutModeScreen can also run
  a `gallery_example_workouts` row as a one-off preview (exercises/branches read
  INLINE from the route param — synthesizing each exercise's `id`/`letter` — rather
  than querying Supabase; dateless, session key `gallery:<id>`, **writes no
  completion**). NOTE (2026-06-15): no UI launches this anymore — the admin gallery's
  example-workout cards are now create/edit/delete ONLY (admins don't train, so the
  ⚔ ELITE WORKOUT preview-run button was removed), and players don't browse the
  gallery (they use `EliteWorkoutsScreen`, which only IMPORTS). The gallery-preview
  code path is kept but currently unreached. WorkoutMode + WorkoutSummary are
  registered in BOTH the Workouts
  and Admin stacks so the preview works from either entry into the gallery.
- **Fork / branching (+ merge):** a workout can split once into two named paths
  (`workouts.branches` JSONB = `[{key,label},{key,label}]`). Each exercise's
  `exercises.branch` is one of: `NULL`=trunk (pre-fork common), `'a'`/`'b'`=fork
  path, or **`'merge'`=post-fork common "ending"** (done by everyone once the paths
  rejoin — so a shared finisher is built ONCE instead of duplicated in both paths).
  Authored in Create/Edit Workout via the **FORK** toggle + a COMMON/A/B/**ENDING**
  tag per exercise; in the gallery example builder (AddExampleWorkoutScreen) the
  ENDING is its own **COMMON ENDING** section below the two path panels. In Workout
  Mode the run order is **trunk (COMMON) → CHOOSE YOUR PATH → chosen branch →
  merge (COMMON ENDING)**; the picked path is stored in the local session as
  `chosenBranch` (resume keeps it; ↺ CHANGE re-picks). An empty branch with no merge
  = "end here". The summary/progress count trunk + chosen branch + merge, and the
  recap shows a PATH chip. Save order is trunk→a→b→merge. See DATABASE.md
  (`workouts.branches`, `exercises.branch`).
- **Supersets / parallel exercises:** `exercises.superset_group` (smallint, see
  DATABASE.md) groups exercises done in parallel — complete all, order doesn't
  matter. Set in the workout builder (Create/Edit Workout) via the "⇄ SUPERSET
  WITH ABOVE" toggle, which links an exercise to the one above it; contiguous
  linked runs get a shared group number at save (singletons → NULL). Workout
  Mode brackets a group as one block (its "current" highlight and completion
  span all members); WorkoutDetail shows a ⇄ SUPERSET chip. Grouped exercises
  are always stored consecutively in `letter` order so the run stays contiguous.

## Design System — CRITICAL
- Colors: import from `constants/colors.js` as `C` — never hardcode hex values
- Fonts: import from `constants/fonts.js` as `F` — never hardcode font names
- Theme: dark navy/blue + ice-glow accents (Solo Leveling-inspired)
- **Framed "gallery" look** (the standard for player screens): wrap the screen in
  `<ScreenFrame>` (hug mode — the frame wraps its content and centers; animated
  ice-glow border + holo-build entrance; pass `ready={!loading}`). Use
  `components/ScreenHeader` for the header (glowing BACK pill + centered glow title
  + optional `subtitle`/`right`) and `components/PillButton` for every action button
  (rounded "ice pill"; `variant` solid|outline, `tone` accent|gold|green|danger|muted,
  `size` sm|md|lg, with `loading`/`disabled`). All the player workout screens
  (WorkoutsScreen, StudentDetailScreen, AllWorkoutsScreen, EliteWorkoutsScreen,
  WorkoutDetailScreen, CreateWorkoutScreen, WorkoutEditScreen, WorkoutModeScreen,
  WorkoutSummaryScreen) follow this; match it for new screens instead of
  hand-rolling headers/buttons. Cards/inputs/modals use rounded corners (≈12–18)
  and chips are pills (radius 999).
- **Tab swiping & entrance animations (2026-07-02):** the 4 player tabs are a
  swipeable pager (`@react-navigation/material-top-tabs` + `react-native-pager-view`,
  `tabBarPosition="bottom"`, custom `PlayerTabBar` whose glow indicator tracks the
  pager `position` live). All tabs are pre-mounted (`lazy:false`) and pre-fetch at
  app start; focus refetches are SILENT (no spinner) on Home/Profile. Because the
  neighbouring page is VISIBLE mid-drag, the rule is **each screen's entrance plays
  once per app session, on its first appearance — never on later swipes**:
  - **Home** (initial route) animates on mount = app open / sign-in (`introPlayed`
    ref, guarded once-per-mount). Swiping back does NOT replay it (not even the
    bar) — the tree stays mounted so the guard is already tripped.
  - **Skills** is pre-mounted AND its body stays mounted from app start (data
    preloaded on mount; focus refetches are silent — no `setLoading(true)`). Its
    entrance is split by WHERE the element sits:
      · **Above the fold** (`LvlNumber`, `LevelGauge` — the LVL count-up + gauge
        grow) play once on the first swipe-in via a `play={introKey}` token: they
        sit at rest (LVL 0 / empty bar) while `introKey === 0` and animate when it
        flips to 1.
      · **Below the fold** (the gold **quest cards** + their maxed gleam) can't use
        that — they're off-screen at swipe time — so they fire on **first scroll-
        into-view**, ONCE per card (not on every re-exposure). `QuestCard` uses
        `useInViewport()` (measures itself vs the scroll content, watches the
        ScrollView's offset/height via `ScrollVizContext`) → a `shown` flag that
        flips 0→1 the first time it enters the viewport, then unsubscribes; the
        card's rise/fade and the `GateGleam` shine (via `CardVizContext`) play once
        on that flip. Gated by `isActive()` (=`introKey>0`) so nothing fires while
        pre-mounted off-screen. Measurement has a reveal fallback so a card can
        never get stuck invisible. NOTE the react-native-web `measureLayout`
        callback-swap: pass the same handler to both success+fail slots or it never
        measures on web.
    `introKey` is bumped once, at the **50% swipe mark** (not on
    focus, which lands late — after the settle — and felt delayed): Skills reads the
    shared pager position via `useTabAnimation()` and fires when `position ≤ 0.5`
    (Skills is the leftmost tab, index 0), so the entrance lands in sync with the
    bottom-bar label flip. `useFocusEffect` is a fallback trigger for the admin
    stack (SkillsScreen is also registered there — no pager, `useTabAnimation()`
    throws, so it's read in a try/catch) and for tab taps. NOTE: do NOT defer the
    bump with `InteractionManager.runAfterInteractions` — Skills' looping
    pulse/shimmer animations keep interaction handles open forever, so its callback
    never runs and the screen stays stuck at LVL 0. CRITICAL: also do NOT go back to
    mounting the body at first focus to get this entrance — mounting that heavy
    SVG/Animated tree at swipe-commit starves the pager (whose page-slide and the
    bottom-bar indicator share one animated value) → the indicator desyncs from the
    page and the swipe stutters. The play-token replays the entrance without a
    mount. (Explicit class-change / prestige DO set loading→true, so those
    intentionally reboot the whole screen.)
  - **Workouts/Profile have NO entrance** (Animated.Values idle at 1 — don't
    reintroduce boot/stagger intros there).
  All tab screens preload on mount + refetch SILENTLY on focus (a `loadedRef`
  gates `setLoading(true)` to the first load only). ScreenFrame's holo-entry latch
  is focus-gated (only the focused screen may consume it) since all tabs mount
  together.
- **Constant card size — CRITICAL:** the framed cards must NOT resize with their
  data or loading state. Wrap the screen's content in a fixed-height card
  (`height: CARD_H` from [constants/layout.js](constants/layout.js)) and let the
  variable middle region (`flex: 1` + an internal `ScrollView`) absorb the slack;
  ALWAYS render the full layout (show the spinner *inside* the fixed region, never
  swap the whole body for a spinner — that causes the load-time resize jump). The
  Weekly Plan, Elite Workouts, Create Workout, My Workouts, **and HomeScreen**
  cards share `CARD_H` (Home wraps its body in `styles.card` = `height: CARD_H`) so
  they're identically sized, full-screen, and never resize with data/loading. Tune
  them together via `CARD_H`. (Home's content is top-aligned; any slack is dead
  space at the bottom, same as the Workouts card.) **SkillsScreen** is too tall to
  fit without scrolling, so it uses `<ScreenFrame fill>` (frame fixed to the
  viewport, its own inner `ScrollView` scrolls the quest sections) — same animated
  ice-glow border as the others (its old static 1.5px border was removed); the
  frame renders in every state (loading spinner too) so the border shows even
  mid-swipe. The body is mounted eagerly (not gated on focus) for swipe smoothness;
  its first-swipe entrance is driven by a `play` token, not a mount — see the
  entrance-animation bullets above.
  (Home used to be a hug-mode exception with no fixed height; that was dropped so
  its frame is now constant full-screen like the rest.) It still avoids the load
  jump by ALWAYS rendering the full layout and overlaying the load spinner (never
  swapping the body for a spinner).

## Folder Structure
- `screens/` — all screen components
- `components/` — shared reusable UI. `ScreenFrame` (centered max-width animated
  ice-glow frame + holo entrance), `ScreenHeader` (glowing BACK pill + centered
  glow title + optional subtitle/right action), `PillButton` (the shared glowing
  ice-pill action button) — these three define the standard player-screen chrome.
  Also `Shimmer` — live color-cycling
  `ShimmerText`/`ShimmerFill`/`ShimmerFrame`, `colors`-selectable: GOLD on the LVL
  number + gauge + the prestige banner (title + PRESTIGE NOW glow) when prestige
  is ready, BLUE on fully-completed skill names in SkillsScreen. `ShimmerFrame`
  frames the **CLASS-GATE** nodes in QuestTreeScreen (the main-quest prestige
  requirements for the next class) with a GOLD sweep clockwise around the border —
  a segmented perimeter, same moving sweep as the LVL gauge fill; no moving dot;
  required ids via `requiredMainQuestIds` in lib/prestige. Those nodes also carry a
  floating "✦ CLASS GATE ✦" gold crown ribbon above them + a breathing gold halo
  (the `gate` clock in QuestNode), so they read as prestige milestones rather than
  ordinary nodes. One shared refcounted clock.)
- `constants/` — colors.js, fonts.js, layout.js (`CARD_H` — shared fixed card height)
- `context/` — React contexts
- `lib/` — utilities
- `supabase/` — Supabase client and queries
- `assets/` — images, icons

## Working Rules
1. Never hardcode colors, fonts, or class counts.
2. Respect role permissions in every feature.
3. After changes, list every file touched and what changed in each.

## Database Documentation Rule
Whenever you modify the Supabase schema (add/remove/rename a table, column,
index, or policy), you MUST update DATABASE.md in the project root to reflect
the change. Do this in the same task, not as a separate step. Never finish a
schema-related task without confirming DATABASE.md is up to date.

## CLAUDE.MD Documentation Rule
Whenever you modify the things worth mentioned and are critical in the CLAUDE.md(Class & Quest System, Checkups, Design System, Folder Structure)
you MUST update CLAUDE.md in the project root to reflect changes.
Do this in the same task, not as a separate step.
