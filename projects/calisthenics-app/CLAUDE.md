# Calisthenics App — Project Knowledge

## Stack
- React Native + Expo (JavaScript)
- Supabase (database + auth)

## Roles
- Admin: assigns players to coaches
- Coach: creates workouts, builds checkups, sets player class/level
- Player: views workouts, submits checkups (questions + video records)

## Class & Quest System
- Each player has a class assignment
- Classes have main quests + side quests → give level-up points (cap 100)
- At 80 points, player can prestige → advance to next class, points reset to 0
- Class count is DYNAMIC — currently 2, more coming. Never hardcode the number.
- TIERS (Class III+): a tier is an intentional MAIN-quest concept. The in-tree
  "TIER II" divider renders ONLY for main quests; side-quest trees never show it
  (their multi-branch merges look identical but are NOT tier crossings). Side
  quests instead express tiers across CHAINS — a chain is Tier 2 when any of its
  quests has a prerequisite in a different chain; ClassQuestScreen groups the
  side-quest list into Tier I / Tier II accordingly. No `tier` column exists;
  tiers are derived structurally from `is_convergence` + cross-branch/cross-chain
  `prerequisites`.

## Checkups
- Weekly (frequency configurable)
- Player answers questions + uploads training video records
- Coach reviews and adjusts training

## Design System — CRITICAL
- Colors: import from `constants/colors.js` as `C` — never hardcode hex values
- Fonts: import from `constants/fonts.js` as `F` — never hardcode font names
- Theme: dark navy/blue + ice-glow accents (Solo Leveling-inspired)

## Folder Structure
- `screens/` — all screen components
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
