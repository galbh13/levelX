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
- **Admin**: lightweight overview — read-only roster of all players + access to
  the shared exercise gallery. (No more coach assignment.)

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
  `day_of_week` (0=Sun…6=Sat). Edited in the Manage hub (StudentDetailScreen),
  which is now a Sun–Sat weekday editor (no dates).
- **`workout_override_workouts`** — per-specific-date overrides that **win** over
  the skeleton for that date and carry `completed`. Edited per date on
  WorkoutsScreen (EDIT DAY / RESET TO WEEKLY PLAN).
Rule: a date shows its override rows if any exist, else the weekday's template
(virtual). First completion/edit of a template day **materializes** it (copies the
weekday template into override rows for that date). HomeScreen & WorkoutsScreen
read via this resolution; never query one table alone for "what's on a day". EXP
was removed (2026-06-05) — completing a workout/quest awards nothing now.

## Design System — CRITICAL
- Colors: import from `constants/colors.js` as `C` — never hardcode hex values
- Fonts: import from `constants/fonts.js` as `F` — never hardcode font names
- Theme: dark navy/blue + ice-glow accents (Solo Leveling-inspired)

## Folder Structure
- `screens/` — all screen components
- `components/` — shared reusable UI (e.g. `Shimmer` — live color-cycling
  `ShimmerText`/`ShimmerFill`/`ShimmerFrame`, `colors`-selectable: GOLD on the LVL
  number + gauge + the prestige banner (title + PRESTIGE NOW glow) when prestige
  is ready, BLUE on fully-completed skill names in SkillsScreen. `ShimmerFrame`
  frames prestige-requirement nodes in QuestTreeScreen (BORDEAUX color sweeps
  clockwise around the border — a segmented perimeter, same moving sweep as the
  LVL gauge fill; no moving dot; required ids via `requiredMainQuestIds` in
  lib/prestige). One shared refcounted clock.)
- `constants/` — colors.js, fonts.js (design tokens)
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
