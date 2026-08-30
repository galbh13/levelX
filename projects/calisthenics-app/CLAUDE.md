# Calisthenics App — Project Knowledge

## Stack
- React Native + Expo (JavaScript)
- Supabase (database + auth)

## Roles
Only two roles exist: **`admin`** and **`player`** (the old `coach` and `student`
roles were removed in the 2026-05-22 self-coach refactor; both collapsed into
`player`). New sign-ups default to `player`. **There is no self-serve sign-up** —
the admin creates every account from the dashboard (see "Player onboarding" below);
`LoginScreen` is sign-in only.
- **Player**: their own coach for TRAINING — controls their own level (via quest
  completion), daily quests, and workouts. **Class movement is NOT self-serve
  (2026-08-12):** a player can no longer assign/change their class OR prestige
  themselves — those are **coach-controlled** (admin only). The player still SEES
  their class, prestige-requirements checklist, and a "requirements met — your coach
  will advance you" banner, but the CHANGE/ASSIGN CLASS picker and the PRESTIGE NOW
  action render only in admin-as-coach view.
- **Admin**: oversight + **acting coach**. Roster of all players, the shared
  exercise gallery, challenges, AND full control over any player's account:
  tapping a player on `AdminDashboard` opens `PlayerAdminScreen` (a hub) which
  reuses the self-coach screens scoped to that player — Skills/class/level/quests,
  workouts/schedule, and daily quests. (No more coach *assignment* — admin can act
  on everyone.) See "Admin-as-coach" below.

## Player onboarding — invite + welcome email (2026-08-25)
A new disciple joins in one action: the coach taps **＋ NEW PLAYER** on the
AdminDashboard top bar, types their **email + full name + phone + birthday**, and
the account exists and has been emailed its credentials. No self-serve sign-up
exists.
- **PHONE + BIRTHDAY are GLOBAL, and they live on `profiles` (2026-08-25).** One
  number and one date per player, typed at invite time — the one moment the coach
  has them in front of them — and shown everywhere they're needed. **The phone is
  required and it is for WhatsApp**: it is the coach's line to the player, and
  the success card repeats it back under the starter password. (Joining the
  WhatsApp groups is no longer manual — see THE COMMUNITY below.) **The
  birthday is optional**
  (`YYYY-MM-DD`) — it can be filled in later on the business card.
  · Stored normalized on `profiles.phone`: a leading `+` if typed, then digits
    only — the form WhatsApp wants pasted into a contact. Validation is
    deliberately loose (7–15 digits, any separators); the birthday must be a real
    `YYYY-MM-DD` or empty. Both are checked client- AND server-side —
    `normalizePhone` / `isValidPhone` / `isValidBirthday` in
    [lib/invites.js](lib/invites.js). **Parse dates as UTC** (`T00:00:00Z`) when
    round-tripping through `toISOString`, or a local-midnight parse rejects every
    valid birthday east of Greenwich.
  · **The BUSINESS card edits the same two values.** `player_billing.phone` /
    `player_billing.birthday` are now LEGACY: `fetchPlayerBilling()` merges the
    profile values over the billing row and `savePlayerBilling()` peels
    `phone`/`birthday` out of the patch and writes them to `profiles` instead
    (`fetchPlayerContact` / `savePlayerContact` in [lib/billing.js](lib/billing.js),
    both error-swallowing so a drifted live schema can't break the card).
    `PlayerBillingScreen` needs no changes beyond seeding its no-billing-row draft
    from the profile.
  · Migration `migrations/20260825_profile_contact.sql` — **must be run on the
    live Supabase**. It adds both columns, backfills them from any values already
    typed into the business card, and rewrites `handle_new_user()` to carry both
    across (casting the birthday inside its own exception block, so a bad date
    can't become Auth's useless "Database error creating new user"). The edge
    function ALSO writes both right after the create, so a stale live trigger
    can't silently drop them.
- **All the privileged work is in a Supabase edge function**,
  `supabase/functions/invite-player`. It needs the **service-role key** (to create
  an auth user) and the **Gmail app password** (to send the mail); neither may ever
  ship in the app bundle, which carries only the anon key. The function verifies
  the caller is a `role='admin'` profile — a valid player token is not enough —
  then `auth.admin.createUser({ email_confirm: true })` and sends the mail.
  **Setup, secrets and deploy: `supabase/functions/README.md`.** The client half is
  [lib/invites.js](lib/invites.js) (`invitePlayer` / `isValidEmail` /
  `STARTER_PASSWORD` / `clearMustChangePassword`).
- **The profile row comes from the trigger, not a second write.** `full_name`,
  `phone`, `birthday` and `must_change_password` ride in on the auth user's `user_metadata`, and
  `handle_new_user()` reads them off `raw_user_meta_data` — so the invite is ONE
  atomic call with nothing to race the trigger. `role` = `'player'` and `job` =
  `'handstand'` (the column default) come for free, which is why the invite form
  asks for nothing else beyond the phone and birthday.
- **The starter password is SHARED (`PASSWORD`) and must not survive first
  contact.** Every invited account is flagged `profiles.must_change_password`, and
  `App.js` renders **`SetPasswordScreen`** instead of the app while it's true —
  bare, no navigator, no skip; the only other way out is SIGN OUT. Setting a
  password (`auth.updateUser`, min 8 chars) clears the flag. Keep
  `STARTER_PASSWORD` in sync between `lib/invites.js` and the edge function.
- **App.js reads the flag in its OWN query**, separate from the role lookup, on
  purpose: the live DB has drifted from migrations before, and folding a newer
  column into the role select would let a missing column brick routing for
  everyone including the admin. Alone, it fails safe (no forced change).
- **Email delivery is Gmail SMTP** (`smtp.gmail.com:465` via `denomailer`) as the
  business account, using a Google **App Password** — so the mail genuinely comes
  from `the.handstand.system@gmail.com` and lands in its Sent folder. No domain
  needed (which rules out Resend/SendGrid free tiers, whose senders must be a
  verified domain).
- **A failed email does NOT roll back the account.** The function returns
  `{ ok: true, emailed: false, warning }` and the modal shows the starter password
  so the coach can pass it on by hand — deleting a live account over a transient
  SMTP blip would be worse than an un-emailed one.
- Migration: `migrations/20260825_invite_player.sql` (adds the column, rewrites the
  trigger) — **must be run on the live Supabase.**
- **Testing the invite/email path uses Gmail `+` aliases**, not extra mailboxes:
  `gal1.benhamo+t1@gmail.com` is a separate account to Supabase and still lands in
  the admin's own inbox. Invite it, read the mail, then delete it (below).

## Deleting a player (2026-08-25)
The mirror of the invite, and the app's only destructive action:
**PlayerAdminScreen → DANGER ZONE → DELETE PLAYER**, behind a modal that requires
the word `DELETE` typed out.
- Server side is `supabase/functions/delete-player` — same admin-only auth check
  as `invite-player`, plus two refusals it will not budge on: **you cannot delete
  yourself, and you cannot delete another admin.** It needs the service-role key,
  which is the whole reason it isn't a client call.
- **It deletes the AUTH user and lets the cascade do everything else.**
  `profiles.id → auth.users(id) on delete cascade`, and every player-scoped table
  (checkups, checkup_answers/videos, coach_messages, community_*, weekly_accessories,
  accessory_completions, workouts, player_billing, payments) is
  `references profiles(id) on delete cascade`. One call, nothing orphaned — which
  is the point: a tester or a blow-in stops distorting the **BUSINESS** screen.
- **That cascade takes payment history with it.** Deleting a genuine paying player
  erases their revenue from the business numbers too. That is why the typed
  confirmation exists; there is no undo and no soft-delete.
- **Uploads are NOT cascaded** — avatars in Supabase storage and check-up videos on
  Cloudinary outlive the row and need clearing by hand if they matter.
- Client half: `deletePlayer` in [lib/invites.js](lib/invites.js). No migration —
  the cascades already existed; deploy the function and that's it.
- **The roster shows each player's email** under their name (and the manage hub
  shows it under the hero), so "which account is which" is answerable in the app.
  `AdminDashboard` also refetches the roster on focus so a just-deleted player
  doesn't linger behind the screen you deleted them from.

## Admin-as-coach — CRITICAL
An admin can manage ANY player's account. The mechanism reuses the self-coach
screens two ways, set when the admin taps a player on the roster:
- **CoachContext**: `AdminDashboard` calls `setSelectedStudent(player)` before
  navigating, so the context-scoped screens (`Manage`/StudentDetailScreen,
  AllWorkouts, EliteWorkouts, DailyQuest) act on that player with no
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
  session is entered only through HomeScreen's quest gate, a device-local self-scoped
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
- **SkillsScreen** (Skills tab) is the class/level hub: open interactive quest
  trees (the player's own level control), view class + prestige status. **Assigning/
  changing class and prestige are COACH-ONLY** — those controls are gated on
  admin-as-coach view (`isCoachView = studentId param present`); a player's own tab
  shows status but not the actions (see Roles → Player).
- **QuestTreeScreen** is interactive — tapping a node toggles the player's own
  completion (the only way LVL changes). Same generic `student_quest_completions`
  write as before, with `student_id` = self.
- **WorkoutsScreen → "Manage My Training"** opens `StudentDetailScreen` (the
  self workout/calendar authoring hub), which links to `DailyQuestScreen`
  (`CoachDailyQuestScreen.js`) for self daily-quest management.
- Routing: `admin` → AdminNavigator; everyone else → PlayerApp.

## Class & Quest System
- **Jobs (2026-07-14) — parallel class ladders.** A `job` (`profiles.job`,
  `classes.job`) is a self-contained progression: its own `classes` + `class_quests`.
  `'static'` = the original all-skills ladder (Class I/II/III), the default for
  every class and player. `'handstand'` = the handstand job, currently EMPTY (one
  class `Handstand I`, no quests → Skills shows one class, no main/side quests).
  Each job's `order_index` restarts at 0, so LVL/prestige/stars are per job:
  `PRESTIGE_REQUIREMENTS` in [lib/prestige.js](lib/prestige.js) is keyed
  `[job][order_index]` (no block / no entry → level-only), and any query LISTING a
  player's classes (picker / class-count for stars) must filter by `job`.
  The **admin switches a player's job on PlayerAdminScreen** (writes `profiles.job`
  + re-points `class_id` at the target job's first class; completions preserved so
  switching back restores progress). Exercise-library / example-workout class
  pickers stay pinned to `job='static'`. **New players default to the `handstand` job**
  (`DEFAULT_JOB` in [lib/jobs.js](lib/jobs.js) + the `profiles.job` DB default).
  See DATABASE.md "Jobs" for the full model.
- Each player has a class assignment, set by their **coach (admin)** via
  admin-as-coach SkillsScreen — no longer self-assigned (2026-08-12; see Roles)
- Classes have main quests + side quests → give level-up points (LVL = Σ
  `lvl_reward` of completed quests in the class)
- **Prestige gating** is declarative, per class, in [lib/prestige.js](lib/prestige.js)
  (`PRESTIGE_REQUIREMENTS` keyed by class `order_index`; pure `evaluatePrestige()`).
  Four kinds of gate, ALL must pass (a class uses the ones it declares):
  1. **Level** — reach `classes.prestige_at` (85 / 100 / 160 for Class I/II/III;
     still the single DB-stored level number, drives the bar marker too).
  2. **Main quests** — `'all'` (Class I) or specific chains + named nodes
     (Class II: `Freestanding 30 sec` (handstand) + `2 HSPU` + `2 OAPU`;
     Class III: the five front_lever/planche nodes).
  3. **1 Tier II skill** (`requireTier2Side`) — fully complete ≥1 Tier-2 SIDE
     chain (detected structurally, same rule as the tier grouping below).
  4. **1 side quest** (`requireAnySide`) — fully complete ≥1 side chain of ANY
     tier. Used by Handstand III, whose side quests (SEVEN / MEXICAN HANDSTAND /
     TIGERBAND) have no cross-chain gate, so there is no Tier 2 to ask for.
  Handstand III (`handstand[2]`, LVL 90) names two of its main nodes on UPGRADE
  chains — `pike_press` (One Pike Press) and `extreme_combo` (the 2-rounds node)
  — plus SHAPES' final `6 Tuck + 6 Straddle`. Upgrade rows are seeded
  `quest_type = 'side'` but read as MAIN quests here (and never satisfy a side
  gate); see [lib/questUpgrades.js](lib/questUpgrades.js).
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
  quests has a prerequisite in a different chain; SkillsScreen renders a top-level
  **SIDE QUESTS** header (same style as MAIN QUESTS) with **Tier I / Tier II** as
  subordinate sub-headers nested beneath it. No `tier` column exists;
  tiers are derived structurally from `is_convergence` + cross-branch/cross-chain
  `prerequisites`. **Exception — the `handstand` JOB does NOT gate tiers on class
  order.** Its classes are 0/1/2 but most main quests are faithful single-tier
  copies of static quests, so `QuestTreeScreen` makes tiers opt-in per quest there:
  only chains in `HANDSTAND_TIERED_CHAINS` render a divider; the rest
  (`push`/`foundation`/`balance`/`hspu`/`shapes`) stay un-tiered even at
  `order_index >= 2`. **`HANDSTAND_TIERED_CHAINS` is currently empty** — `push`
  used to carry the power/mobility TIER II, but that was split out into its own
  flat **`foundation`** main quest (migration
  `20260716_handstand_push_tier2_to_foundation.sql`: the POWER + MOBILITY branches
  were re-homed to `chain='foundation'` and their cross-tier convergence severed,
  so they now stand as two independent branch roots). (The tier-2 set is still detected
  structurally from the cross-branch convergence; this only decides whether the
  divider is allowed to show.)

- **HIDDEN CHALLENGES (2026-08-24).** `class_quests.is_hidden` marks a bonus node
  that does NOT exist for the player until every id in its `prerequisites` is
  completed — filtered out of the tree, its node count AND the Skills chain
  counter (an "8/9 unlocked" with nothing visible in the tree would give it away).
  One rule, shared: `visibleQuests()` in [lib/hiddenQuests.js](lib/hiddenQuests.js),
  used by QuestTreeScreen + SkillsScreen. Once revealed it is a normal node
  (already unlocked, since its prereqs are met by definition) wearing the GOLD
  treasure palette — a `GOLD` ShimmerFrame plus an "✦ HIDDEN CHALLENGE ✦" banner
  in place of its branch label (a CLASS GATE wears the same gold and outranks it
  when a node is somehow both). It is NOT
  hidden from the LVL ceiling: `computeClassMax` counts it like any other quest.
  First one: handstand Class I FOUNDATION → **Wall Walk 5 reps** (`branch =
  'challenge'`, +10 LVL), gated on the tips of BOTH branches (POWER + MOBILITY) —
  `migrations/20260824_hidden_challenges.sql`.
  Second one: handstand **BALANCE** → **HS Scale** (Handstand Scale; `branch =
  'challenge'`, +10 LVL), gated on the chain tip **Freestanding 30 sec** —
  `migrations/20260824_balance_hidden_challenge_hs_scale.sql`. It carries
  `is_convergence = true` despite its single prerequisite on purpose: that routes
  it through the convergence path of `computeLayout`, which centres it directly
  under its parent instead of reserving a whole column for the 'challenge' branch.
  **DONE never repaints a node that owns a palette.** The ice-blue "done" card /
  title / chip apply only via `isDonePlain` (done AND not a challenge AND not a
  mirror). A completed hidden challenge stays GOLD and a completed mirrored
  requirement stays VIOLET — each has its own brighter "earned" variant
  (`questCardChallengeDone` / `questCardMirrorDone`) in the same hue.
  **The reveal is a beat, not a pop-in:** the tap that completes the last
  prerequisite keeps its own gold burst, then after `REVEAL_DELAY` (620ms) the
  challenge punches in (back-eased from 0.3 scale) under two expanding gold
  shockwave rings, its banner drops in behind it, and a second haptic lands.
  `revealId` drives it and is cleared on every refetch, so discovery fires ONCE;
  the connectors into the node are held back (`linksArmed`) so two lit lines
  never point at empty space first. `spaceOutHiddenNodes()` pushes the node an
  extra `HIDDEN_GAP` (110px) below its topological rank — it hangs off the
  bottom of the tree, so it reads as separate instead of crowding the tips.

## Mirrored requirements — a node another quest owns (2026-08-24)
A quest node with **`class_quests.mirror_quest_id`** set is a **read-only mirror**
of a node in a DIFFERENT main quest of the same class. Rule (shared by
QuestTreeScreen + SkillsScreen): [lib/mirrorQuests.js](lib/mirrorQuests.js).
- **Done is inherited.** Nothing is ever written to `student_quest_completions`
  for a mirror node; `withMirrorCompletions()` folds it into the completion set
  when the node it points at is complete, so it unlocks its children normally.
  Its `lvl_reward` is **0** — the LVL is paid once, by the real node.
- **Not tappable where it's shown.** `toggleQuest` refuses it and the confirm
  modal is replaced by an "OUTSIDE REQUIREMENT" card naming the quest that owns
  it. Visually: dashed violet frame + a "⇥ BALANCE" tag instead of the padlock.
- **The one in the app:** handstand **HSPU** main quest — its whole `requirement`
  branch is now ONE node mirroring **BALANCE → "Freestanding 20 sec"** (it
  replaced "HS Hold 20 sec" + "HS Hold 20 sec x3 in a row"; the MAIN convergence
  was rewired onto it). Migration
  `migrations/20260824_hspu_requirement_mirror_freestanding.sql` — **must be run
  on the live Supabase**; it also adds the column.

## Coach-approved nodes — the coach's box, not the player's (2026-08-25)
A quest node with **`class_quests.coach_approved = true`** is an ordinary quest —
own completion row, own `lvl_reward`, gates its children — with ONE difference:
only the coach may check it. Rule: [lib/coachQuests.js](lib/coachQuests.js).
- **Who may toggle** is decided by `useCoach().isAdmin` (the AdminNavigator's
  provider), so the same tree is read-only for the player and live for the coach
  viewing them via SkillsList → QuestTree (`studentId` route param).
- **The player's tap** opens a "COACH APPROVAL" card ("show them the skill and
  they will approve it from their side") instead of the confirm dialog — the same
  shape as a mirror node's OUTSIDE REQUIREMENT card, for the other reason: a
  mirror lives in another QUEST, this lives with another PERSON.
- **The node is a sentence, not a title.** A coach node doesn't render
  `quest.name` — it says **"Coach certification needed"** until it's signed
  off, then **"Coach Approved"**, and it wears NO chip at all (no ✓ DONE, no
  +LVL). `questNodeLabel()` picks the text; `questLayoutLabel()` feeds the layout
  the longer of the two so approving one can't reshuffle the tree's row heights.
- **Third node palette.** GOLD = hidden challenge / prestige gate, VIOLET =
  mirrored requirement, **GREEN = coach approval** (`SL.approve` #3BE87A). The
  green is the whole marker — the node carries NO tag or glyph of its own. Like the other two it owns its palette in every
  state, so `isDonePlain` excludes it and approval brightens the green instead of
  repainting the node ice blue.
- **The one in the app:** handstand **Class III** side quest **MEXICAN HANDSTAND**
  — two one-node branches, `bridge` ("Bridge 10 sec") and `coach` ("Coach
  Approved", coach-gated), merging into the convergence "Mexican 10 sec". Both
  feeders pay **0 LVL**; the whole +10 lands on the merge.
  Migration `migrations/20260825_handstand_class3_mexican_sidequest.sql` — **must
  be run on the live Supabase**; it also adds the column.

## Checkups — admin-authored template + player submission + coach feedback
A **check-up** is now an **admin-authored structured form** the player fills in
(was a free-form clips+reflection submission until 2026-07-22). It has **two parts**:
- **Part 1 — QUESTIONS** (`part='question'`): plain text questions the admin writes
  (diet, sleep, how the week felt). The player answers each with a text field →
  `checkup_answers`.
- **Part 2 — EXERCISES** (`part='exercise'`): exercises the admin picks, each with a
  **reference `video_url`** (the coach's demo clip) + a **`description`** (cues /
  what to look for). The player watches it, records **their own** clip(s) — they can
  upload **as many clips as they want per exercise** (＋ ADD ANOTHER VIDEO); each is
  uploaded to the `checkup-videos` bucket (**50 MB/clip** cap client- + server-side)
  as its own `checkup_videos` row (extended with `item_id` / `prompt` /
  `answer_text`), plus **one note per exercise**. Multiple clips per exercise needs
  NO schema change — clips are just multiple rows sharing an `item_id`; the note is
  **mirrored onto every clip row** of that exercise at submit. Both the player's
  submitted view and the admin review **group clips by `item_id`** via
  `groupCheckupVideos()` in [lib/checkups.js](lib/checkups.js) (one card per
  exercise, all its clips, note shown once).

The admin still reviews the submission and replies with a **feedback video URL** +
optional note (kept from the old flow). The check-up remains the replacement for the
old Profile tab (its vanity fields `avatar_url`/`nickname`/`bio` were deleted).
(NOTE: an even earlier, different checkup system was removed in the 2026-05-22
self-coach refactor — don't confuse the three.)

### Templates — class-standard, inherited, per-player override (2026-07-22)
Templates are **class-standard**: the admin authors one per class (Class I /
Handstand / Class II / Class III …) and **every player in that class inherits it**.
The admin can **override a single player** (trim an exercise a player has already
mastered, add a player-specific question, etc.).
- **Resolution** (`resolvePlayerTemplate(playerId, classId)` in
  [lib/checkups.js](lib/checkups.js)) → `{ source, items }`: a player's **own**
  (`player_id`) items if any exist, **else** their **class's** (`class_id`) items,
  else `source:'none'`. `splitTemplateParts(items)` → `{ questions, exercises }`.
- **Customizing a player = EDIT IN PLACE, fork on first write (2026-08-29).**
  `AdminCheckupScreen` always shows the ONE list that player fills in (their own
  items, else the class standard they inherit) — there is no "customize" step and
  no second structure on the page. The first add/edit/delete calls
  `materializePlayerTemplate(playerId, classId)` under the hood (it COPIES the
  class items onto the player), then applies that change to THEIR copy, so the
  class standard is never edited by accident. `CheckupTemplateEditor` owns this
  (`inherited` + `ensureOwnItems` + `mirrorOf`, which maps an inherited row to its
  fresh copy by part + prompt) and reports `'player'|'class'|'none'` up through
  `onSourceChange`. `resetPlayerTemplate(playerId)` deletes
  the player rows so they fall back to the class standard. Item CRUD:
  `addTemplateItem(scope, item)` / `updateTemplateItem` / `deleteTemplateItem`
  (`scope = { classId }` or `{ playerId }`).
- Template items are the **standing definition** — NOT subject to the
  submission purge (only `checkups`/`checkup_answers`/`checkup_videos` are).
- **Item ids are NOT stable, and three things key off them.** Forking a player's
  template (and re-authoring a class) DELETES rows and inserts new ones, so
  anything holding an item id has to survive the swap by NAME:
  · uploaded clips — `bindVideosToExercises` + `repairVideoLinks` (rebinds and
    writes the new link back);
  · the player's UNSENT draft text — `remapDraftKeys` in
    [lib/checkupDraft.js](lib/checkupDraft.js). The draft stores a `prompts`
    map ({itemId: prompt}) beside the text, and `CheckupScreen` re-keys the draft
    onto the freshly resolved items on every load. Without it, personalising a
    player's check-up silently blanked everything they had typed but not sent.
  · submitted answers — safe by construction: `checkup_answers` /
    `checkup_videos` snapshot the `prompt` at submit, and the FK is
    ON DELETE SET NULL.

### Screens
- **`AdminCheckupTemplateScreen`** (new) — the **class-standard builder**, reached
  from the **CHECKUP EDITOR** button on the AdminDashboard top bar (renamed from
  "CHECKUP" 2026-08-25, to distinguish it from the CHECK-UP INBOX beside it). Pick a class (across
  jobs) → author its Part-1 questions + Part-2 exercises. Uses the shared
  `components/CheckupTemplateEditor` (scope `{ classId }`). Registered in `AdminStack`
  as `CheckupTemplates`.
- **`CheckupScreen`** (player, the 4th tab **CHECKUP**) — resolves the player's
  template and renders it: a text field per Part-1 question, and per Part-2 exercise
  the coach's reference video + description + the player's own `＋ ADD YOUR VIDEO`
  upload + a note. **SUBMIT** writes `checkup_answers` (snapshotting each question's
  prompt) + attaches notes to the exercise clips + stamps `submitted_at`; then
  read-only ("awaiting feedback" → "feedback in" with `▶ WATCH FEEDBACK VIDEO`).
  **Editable after submit (while awaiting feedback):** the submitted view ALWAYS
  shows the edit button — `✎ EDIT MY CHECK-UP` while awaiting feedback, but once the
  coach replies (`feedback_at`) it becomes a disabled `COACH REVIEWED · EDIT NOT
  AVAILABLE` (muted) instead of disappearing. `editSubmission()` pours the saved
  answers/clips/notes back into the
  compose maps and flips to compose mode; SUBMIT re-writes the SAME `checkups` row
  (`ensureDraft` returns the existing row, answers are delete-and-reinsert, notes
  re-attached, `submitted_at` re-stamped). Compose then shows SAVE CHANGES + a
  ✕ CANCEL EDIT (re-`fetchCheckup` back to read-only). NOTE clip add/remove in edit
  mode hits the DB immediately (like drafts), so CANCEL only discards unsaved
  answer/note text — dropped clips stay dropped.
  If the player's class has no template → a **"NO CHECK-UP YET"** empty state (can't
  submit). Draft row created **lazily** (first clip / submit). Recurring check-up-day
  status bar kept; the purge is now replace-on-submit (see SPACE POLICY).
- **`AdminCheckupScreen`** (per-player, from the **CHECK-UP** tile on
  `PlayerAdminScreen`) — three jobs on one screen: (1) the **CHECK-UP DAY** picker;
  (2) **review** the latest submitted check-up (THEIR ANSWERS + THEIR EXERCISES with
  clips/notes) and write `feedback_url` (+ `feedback_note`) → `SEND FEEDBACK`; (3)
  **THIS PLAYER'S CHECK-UP** — the same `CheckupTemplateEditor`, scoped
  `{ playerId, classId }`, showing the list that player actually fills in, always,
  edited in place; a `CLASS STANDARD`/`PERSONAL` chip says which it currently is
  and flips to PERSONAL on the first change. `↺ BACK TO CLASS STANDARD` (confirmed
  via `SystemConfirm`) appears only once it IS personal.
  **The section is READ-ONLY until the coach taps EDIT (2026-08-30).** He screen-
  records himself walking a player through their check-up, so the per-row EDIT/✕,
  the ADD buttons, the explainer and the reset button are all hidden behind the
  editor's `editable` prop (a plain EDIT / green DONE `PillButton` beside the
  chip); the clean view is a numbered list and nothing else, and it is what the
  screen opens in every time. `AdminCheckupTemplateScreen` leaves `editable`
  at its default `true` — authoring is its whole purpose. Needs the admin-override RLS in
  `migrations/20260714_checkups.sql` + `20260722_checkup_templates.sql`.
- **Shared `components/CheckupTemplateEditor`** — the admin authoring surface used by
  BOTH admin screens: lists Part-1 questions + Part-2 exercises with add/edit/delete
  (a modal form; exercises also take a video URL + description). Scope-driven
  (`{ classId }`, or `{ playerId, classId }` — which resolves the inherited list
  and forks it onto the player on the first write).
- **Recurring check-up DAY (2026-07-19).** The check-up is on a **systematic weekly
  pattern**: the admin pins the player to a weekday (e.g. "every Tuesday") via the
  **CHECK-UP DAY** Sun–Sat pill picker at the top of `AdminCheckupScreen` (always
  editable, even before the first submission; tap the lit day again to clear it).
  Stored on `profiles.checkup_day` (0=Sun…6=Sat, NULL=unset — rides the existing
  profiles RLS incl. the `is_admin()` admin-override). The **player** sees a
  read-only status bar at the top of `CheckupScreen`: which weekday, the next due
  date, and a **one-day grace** ("life happens" — submitting the day after still
  counts). The pure resolver is `checkupSchedule(checkupDay, now)` in
  [lib/checkups.js](lib/checkups.js) → status `today` | `grace` | `upcoming`
  (`WEEKDAYS`/`WEEKDAYS_SHORT` live there too).
  **Player status line + tab dot (2026-08-23).** The old filled status BOX on
  `CheckupScreen` is now a quiet one-LINE readout over a hairline rule —
  `[tick] SATURDAY … [chip]` (day name + chip both large) — where the
  chip/accent is `SENT` (green) / `TODAY` (ice) / `LATE` (red, the grace day) /
  a plain countdown `N DAYS` (muted).
  A matching **dot on the CHECKUP bottom-tab** marks "this week's check-up is
  still owed". `checkupDueState(checkupDay, submittedAt)` → `'none'` |
  `'due'` (the check-up day → ICE dot) | `'late'` (the grace day → **RED** dot);
  it's owed only while nothing was submitted since `checkupCycleStart()` (local
  midnight of the most recent check-up day). Driven by
  `context/CheckupNotifyContext.js` (`CheckupNotifyProvider` wraps the player
  root; `PlayerTabBar` reads `state`), refreshed on mount + a 60s poll, and
  `CheckupScreen` calls the context's `refresh()` right after a successful submit
  so the dot **vanishes the moment the check-up is sent**.
  The same tab dot also carries **NEW FEEDBACK (2026-08-29)** — a **GOLD** dot when
  the coach has replied and the player hasn't opened it yet. The context exposes
  `feedbackUnseen` beside `state`; the dot's priority is LATE (red) → new feedback
  (gold) → due (ice). "Read" is a LOCAL stamp — the `feedback_at` of the newest
  reply the player has opened, in AsyncStorage
  ([lib/checkupSeen.js](lib/checkupSeen.js): `hasUnseenFeedback` /
  `markFeedbackSeen`) — so it needs no column; `CheckupScreen` stamps it on load,
  because the feedback card is on that screen in every state. Migration
  `migrations/20260719_checkup_schedule.sql`. The screen's header is the shared
  `ScreenHeader` (title `WEEKLY CHECK-UP`), like every other player screen — the
  old bespoke ◆-flanked kicker and the "fill this in" intro blurb were removed
  (the edit-mode explainer stays).
- **SPACE POLICY — ONE check-up per player, ever (2026-08-24).** The rule is
  **replace-on-submit**: the moment a player SUBMITS a new check-up,
  `purgePreviousCheckups(studentId, keepId)` in [lib/checkups.js](lib/checkups.js)
  wipes every EARLIER check-up of theirs — clips, notes and answers. There is no
  history; the current check-up lives exactly until the next one replaces it.
  **The coach's LATEST feedback is the one exception (2026-08-29):** that row is
  EMPTIED (`stripCheckupContent` — clips + answers go, the feedback columns stay)
  instead of deleted, and is exempt from the 14-day purge, so a player always has
  their coach's last note + video link on screen — including while a newly sent
  check-up waits for its own reply. `fetchLatestFeedback(studentId)` reads it;
  `CheckupScreen` renders it as a standing COACH FEEDBACK card at the top of the
  screen whenever the current check-up isn't itself the answered one. Called from `CheckupScreen`'s `handleSubmit` right after
  `submitted_at` is stamped. Re-submitting an EDITED check-up reuses the same row,
  so it's a no-op there (the current check-up can never delete itself).
  The **14-day `purgeExpiredCheckups()`** (run on load of both check-up screens) is
  kept as a **BACKSTOP only**, for what replace-on-submit can't reach: an abandoned
  draft with clips in it, or the last check-up of a player who left the app.
  Both go through the shared `deleteCheckups(ids)`, which removes the storage FILES
  first (via `checkup_videos.storage_path`) and only then the rows — CASCADE drops
  `checkup_videos`/`checkup_answers` rows but never the files.
  **Code-only policy — no migration, no schema change.**
- Tables `checkups` + `checkup_videos`, bucket `checkup-videos` (public, 50 MB file
  limit) — see DATABASE.md. Shared clip player: [components/VideoPlayer.js](components/VideoPlayer.js).

## THE COMMUNITY — WhatsApp invite links (2026-08-26)
**"The community" means WhatsApp, and it means exactly two groups.** When the
coach says *the community*, *the announcement group* / *the official one* (the
one only he talks in), or *the open group* / *the open community*, these are the
two entries in `WHATSAPP_GROUPS`:

| Coach's words | Constant `label` | Colour | Link |
|---|---|---|---|
| official · announcements · the one only I talk in | `ANNOUNCEMENTS` | gold `#FFD700` | `chat.whatsapp.com/Bbo0pdkFc1lL0474MyYOQm` |
| open group · open community · where everyone talks | `THE OPEN GROUP` | jade `#1FD79A` | `chat.whatsapp.com/Bt3ISJjjJAA9tEZNbb8iIg` |

Both live in ONE place: `WHATSAPP_GROUPS` at the top of
[supabase/functions/invite-player/index.ts](supabase/functions/invite-player/index.ts).
Nothing else in the repo references them.

**Why links and not an automation.** The coach asked for new players to be added
to the groups automatically when he creates them. **That is not possible and the
answer will not change**: the official WhatsApp Cloud API has no group endpoints
at all, and even in the app a player's "who can add me to groups" privacy setting
can refuse it. (Puppeteering libraries like whatsapp-web.js / Baileys can, but
they break WhatsApp's ToS and risk the number.) **An invite link is the whole
mechanism** — the player taps it and joins themselves. Don't re-propose the
auto-add route.

**Where they go: the welcome email, and ONLY the email.** An in-app copy (behind
the SOCIALIZE pillar) was built and then removed on the coach's call — the player
gets the links at the one moment they need them, on the way in. Don't add them
back to the app.

**Editing the email (rebuilt 2026-08-28).** The mail now lives in its OWN file,
`invite-player/welcome-email.ts`, and it is **pure** — no env, no network, no
Deno API, just `buildWelcomeEmail({...}) → { subject, text, html }`. `index.ts`
keeps the account, the config and the SMTP send and calls it. Everything you'd
want to reword is a constant at the top of `welcome-email.ts`: the palette
(lifted from `constants/colors.js`), `STEPS` (the numbered "first four minutes")
and `INSIDE` (the ◆ list of the four tabs).
- **A link or a wording change must be made in BOTH halves.** The plain-text and
  HTML bodies are written out separately, on purpose — text is the fallback every
  client can render and what a screen reader gets.
- **Preview it before anyone real sees it** — that's what the split bought:
  ```bash
  cd projects/calisthenics-app/supabase/functions/invite-player
  node preview.mjs            # → preview.html + preview.txt (both gitignored)
  node preview.mjs --stores    # the future: both store links live
  ```
  Node ≥22 runs the `.ts` import directly (type stripping). No Supabase, no Gmail.
- **Nobody who gets this mail is a stranger.** Every recipient has already been
  on a sales call with the coach and been placed. That is WHY the mail has no
  greeting, no pitch, no "here's what the app does" tour and no "message me"
  section — all of that either duplicates the call or reads like a mailshot. It
  is an access document. Keep it short.
- **What's in it, top to bottom (trimmed hard 2026-08-28):** the `THE SYSTEM`
  wordmark · "Welcome aboard. / You're in." · the username/password panel (both
  at 22px — this is the one block that must survive a squinting read; the
  password is the only gold thing in the mail) · **YOUR FIRST FOUR STEPS** ·
  **SCHEDULE AN ONBOARDING CALL** → `ONBOARDING_URL` · **GET THE APP** with the
  two store buttons · **OUR COMMUNITIES** (the two WhatsApp groups) ·
  **THE AGREEMENT** · `Gal Benhamo`. No footer, no legal line.
- **Three buttons are deliberately DEAD, and each is one secret away from live.**
  `PLAY_URL`, `IOS_URL` and `AGREEMENT_URL` are all unset, so each renders as a
  dashed "· SOON" chip — visible, never a 404. Set the secret, redeploy, done; no
  code change. `AGREEMENT_URL` is the coaching agreement / terms of service, and
  the slot exists so the document can be dropped in without redesigning anything.
- **The browser link was CUT** (2026-08-28, coach's call). `APP_URL` is still
  passed into `buildWelcomeEmail` and deliberately not read — the app comes from
  the stores, and until the listings exist the onboarding call carries anyone who
  lands early. One line to reverse if that turns out to hurt.
- **`ONBOARDING_URL` defaults to the coach's own WhatsApp** with the message
  pre-typed, so the button works today with nothing configured. Point it at a
  booking page when one exists.
- HTML rules that are not negotiable: **tables, not flex** (Outlook renders
  neither grid nor flex), **every style inline** (Gmail strips `<style>`), and
  **nothing loaded from the network** — the whole design is borders, background
  colours and letter-spacing, so it survives blocked images.

Then redeploy, or nothing changes for real:

```bash
cd projects/calisthenics-app
npx supabase functions deploy invite-player
```

Resetting a link in WhatsApp (Group info → Invite via link → Reset) means pasting
the new one into `WHATSAPP_GROUPS` and redeploying. Strip the `?s=cl&p=a&mlu=4`
share-tracking params WhatsApp appends when you copy — the bare link is the
invite. An empty `url` drops that button from the mail rather than sending a
dead one.

## Community — REMOVED FROM THE PLAYER APP (2026-08-23)
The community idea (groups, group challenges, group chat, raids, leaderboard) was
**dropped on the player side** — that social layer lives in WhatsApp instead. What
changed:
- The 5th player tab is now **PERSONAL** (`PersonalNavigator` / `PersonalStack`:
  `PersonalList` = `screens/PersonalScreen.js` → `System`). It holds exactly ONE
  card: **THE SYSTEM** (purple, placeholder) — the COACH card went with the chat
  removal (2026-08-26). No group cards, and the **MY PLAYER CARD** entry was
  removed too (`HunterStatusScreen` still exists and is still reachable from the
  ADMIN stack — the group rosters; the `PlayerAdminScreen` tile went too, see
  "Player Profiles").
- `CommunityScreen.js` is gone (replaced by `PersonalScreen.js`), and
  `CommunityGroup` / `CommunityChat` / `HunterStatus` are no longer registered in
  the player stack.
- The "new challenge" gold tab badge and `context/CommunityNotifyContext.js` were
  **deleted** (nothing polls `latestChallengeAt()` anymore).
- **UPDATE 2026-08-25:** the admin's COMMUNITY button was removed from the
  AdminDashboard too, so the community layer now has **no entry point at all** —
  the screens below are registered but orphaned. See "Admin inbox".
- **The ADMIN side is untouched** — `AdminCommunityScreen` / `AdminGroupScreen` /
  `CommunityGroupScreen` / `CommunityChatScreen`, `lib/community.js` and all the
  `community_*` tables still exist. `lib/community.js` is still needed for the
  coach chat (`coach_messages` helpers live there). Strip the admin community
  screens + tables in a later cleanup if you want them fully gone.
- The guided tour's COMMUNITY phase became a **PERSONAL** phase (two steps: the
  intro + `personal.coach`); the playercard/groups steps are gone.

The rest of this section documents the (still-present, admin-only) community
system as it was built.

### Original design — groups + per-group challenges (2026-07-17)
A **COMMUNITY** is built from **groups**: a small set of players (e.g. friends
training together) who get their own **challenges** to compete on. A player can
belong to MANY groups. **First-cut scope** — create/read groups, membership, and
challenges; deeper mechanics (submissions, scoring, leaderboards) come later.
- **Admin owns the structure.** From the **COMMUNITY** button on the AdminDashboard
  top bar → `AdminCommunityScreen` (create groups, list them) → `AdminGroupScreen`
  (toggle which roster players are in the group via a checklist, author/delete the
  group's challenges, delete the group). Each challenge on `AdminGroupScreen` also
  shows a **read-only completion view** — the group's members with a check + a
  `done/total` tally — so the coach sees who did it. Registered in the `AdminStack`.
- **Player side** — a 5th bottom tab, **COMMUNITY** (`CommunityNavigator`:
  `CommunityScreen` root = the player's groups → `CommunityGroupScreen` = one
  group's members + challenges). Players can't edit the structure, but on each
  challenge every member shows a **check** — a player ticks their OWN off to mark
  they did it (and sees who else has, with a `done/total` tally). Its header keeps
  BACK on its own row so the **centered** group name gets full width (doesn't use
  the shared `ScreenHeader`).
- **Challenges are DAY-SCOPED, per viewer's timezone.** A challenge is live only on
  the calendar day it was created — until **midnight (00:00) in each player's OWN
  device-local timezone**. `startOfTodayISO()` is computed client-side from the
  device clock, so two members of the same group in different timezones each keep a
  challenge until their own local midnight (e.g. Israel loses it hours before a US
  member). Player-facing reads filter `created_at >= startOfTodayISO()` (`todayOnly`
  on `fetchGroupChallenges`, and the group-card `challengeCount` in `fetchMyGroups`);
  after their midnight it just stops showing (rows are NOT deleted). Admin's
  `AdminGroupScreen` is unfiltered — it sees every challenge for oversight.
- **"New challenge" tab badge.** A small **static gold dot** sits on the COMMUNITY
  bottom-tab when today has a challenge the player hasn't seen. Driven by
  `context/CommunityNotifyContext.js` (`CommunityNotifyProvider` wraps `PlayerTabs`;
  `PlayerTabBar` reads `hasNew`): it compares the newest of today's challenges
  (`latestChallengeAt()`) against a locally stored last-seen time
  (AsyncStorage `community:lastSeenChallengeAt`), re-checked on mount + a 60s poll.
  Opening the Community tab calls `markSeen()` → clears the dot.
- **Data:** tables `community_groups`, `community_group_members` (M:N, unique
  `(group_id, player_id)`), `community_challenges`, and
  `community_challenge_completions` (per-member "I did it", owner-write) — see
  DATABASE.md and `migrations/20260717_community.sql` +
  `migrations/20260718_community_challenge_completions.sql`. RLS = additive admin
  CRUD (`is_admin()`) + member-read via the SECURITY DEFINER helper
  `is_group_member(gid)` (avoids RLS recursion on the membership table); a
  `shares_group_with` helper lets co-members read each other's names. Shared
  helpers: [lib/community.js](lib/community.js).

### Community game layer — leaderboard, streak, raids (2026-07-20)
Three systems that make a group a competitive/bonding space instead of a shared
checklist. `CommunityGroupScreen` (player) shows them all; `AdminGroupScreen`
**mirrors the same dashboard** (streak banner + leaderboard read-only) with the
authoring controls layered in (＋ ADD CHALLENGE, ＋ SUMMON RAID, member checklist,
delete). Helpers in [lib/community.js](lib/community.js); migration
`migrations/20260720_community_raids_and_leaderboard.sql`.
- **No emojis (design rule).** The group-streak indicator is a glowing vertical
  bar (ember `#FF8C28`), never a 🔥 glyph — emojis are off-brand for this app.
  The leaderboard's top three use a **podium palette** (`RANK` = gold/silver/
  bronze) tinting a squared rank badge, the row border/glow, and the LVL number.
- **Leaderboard** — `fetchGroupLeaderboard(groupId)` ranks members by CLASS tier
  (class `order_index`) then LVL (`computeLvlFromData`), then name. Needs the
  additive `read co-member quest completions` RLS policy (`shares_group_with`) —
  the base `student_quest_completions` policy is owner-only. NOTE `order_index`
  restarts per JOB, so a cross-job tier compare is only an approximation (fine for v1).
- **Group streak** — `fetchGroupStreak(groupId)` → `{ streak, pending }`, computed
  (NO schema) from challenges + completions. Each challenge the WHOLE group cleared
  = +1, counted LIVE the moment the last member ticks (optimistic). A challenge is
  "settled" 24h after `created_at` — the safe upper bound for the latest local
  midnight across every timezone, so nobody's own local day can still be open and
  no per-member timezone is stored. Settled + anyone missed → streak resets to 0;
  <24h + not all done → PENDING (shown as "+N pending today", neither counts nor
  breaks). Only members present when the challenge was posted (membership
  `created_at <= challenge.created_at`) are required — a new member can't
  retroactively break history. The player screen re-fetches the streak after each
  own tick so the flame reacts live.
- **Raids** — a group-wide POOLED goal (`community_raids` + append-only
  `community_raid_contributions`), distinct from a challenge's per-member checkbox.
  Admin summons a raid with `title` + numeric `target` + `unit`; every member logs
  the amount THEY did (`addRaidContribution`) and all sum into one collective bar
  (`fetchGroupRaids` returns each raid with `total` + `byPlayer`). Cleared at
  `total >= target` (gold state). `createRaid`/`deleteRaid` are admin-only via RLS.

### Community CHAT — ephemeral group chat (2026-07-21)
A **text-only** chat scoped to each group. It lives on its **own full-screen
screen — `CommunityChatScreen`** (WhatsApp-style: an **inverted `FlatList`**, newest
pinned to the bottom, scroll UP for history, composer pinned below via
`<ScreenFrame fill>` + `KeyboardAvoidingView`), NOT inline in the group dashboard —
so history scrolls there and never grows the dashboard endlessly. Table
`community_messages`, migration `20260721_community_chat.sql`; helpers
`fetchGroupMessages` / `sendMessage` / `deleteMessage` / `purgeExpiredMessages` +
`CHAT_RETENTION_DAYS` in [lib/community.js](lib/community.js).
- **One shared screen for both roles** (`isAdmin` route param). Registered in BOTH
  `CommunityStack` (player) and `AdminStack` (admin). Player: post + **unsend own**.
  Admin: posts as **COACH** and may **delete ANY** message (moderation).
- **Opened from the group screen two ways (bar + swipe), bidirectional.** Both
  `CommunityGroupScreen` (player) and `AdminGroupScreen` (admin) show a **CHAT bar**
  with a live last-message **preview**; tapping it OR a **left-swipe on the card**
  navigates to `CommunityChat`. The reverse is symmetric: a **right-swipe on the
  chat screen** goes back to the dashboard. Both use a `PanResponder` that only
  claims clearly-horizontal drags (dx dominates dy), so vertical scrolling (the
  dashboard scroll / the chat's inverted list) passes straight through. The group
  screens keep a light poll ONLY to refresh the bar preview — the real chat lives
  on the chat screen.
- **Both players AND the admin can post.** Players post via the member-send RLS;
  the **admin (coach) posts through the admin-all RLS even though they aren't a
  group member** — their messages render as **COACH** (a non-member sender can only
  be the admin).
- **Ephemeral — 7-day retention** (`CHAT_RETENTION_DAYS`). No long history; the
  table stays tiny. The sweep is **client-side** on chat load (`purgeExpiredMessages`,
  same philosophy as the check-up purge) — an additive RLS policy lets any member
  delete their group's messages older than 7 days, so no cron/service role is needed.
- **Freshness via polling, NOT realtime, and NOT focus-gated.** The app has no
  live DB→device push anywhere — screens re-read on action, which only feels
  instant because each player edits their own data. Chat waits on OTHER people's
  writes, so the chat screen (and the group screens' preview) **poll
  `fetchGroupMessages` every 3s for the whole time the screen is MOUNTED**
  (`CHAT_POLL_MS`), clearing on unmount. CRITICAL: do **not** gate this poll on
  `useIsFocused` — these screens sit inside the material-top-tab pager, where focus
  tracking is unreliable, so a focus gate makes the poll silently never fire
  (symptom: new messages only appear after leaving and re-entering). If 3s ever
  feels laggy, upgrade to a Supabase Realtime subscription — the table/RLS don't
  change, only how the screen listens (verify realtime on Expo web first — see
  [web gotchas]).
- **RLS:** admin all + member-read (`is_group_member`) + member-send-own +
  member-delete-own (unsend) + member-purge-expired. Text capped at 1000 chars
  (DB CHECK + client clamp). See DATABASE.md `community_messages`.

### Coach ⇄ player DIRECT chat — REMOVED (2026-08-26)
The private 1-on-1 coach↔player chat (added 2026-07-22) is **gone from the app**.
That conversation moved to **WhatsApp**, the same way the community layer did.
Removed: `screens/CoachChatScreen.js`, `screens/AdminChatNotesScreen.js`, the
`CoachChat` / `ChatNotes` routes, the COACH card on the PERSONAL tab, the COACH
CHAT tile on `PlayerAdminScreen`, the CHAT NOTES pill + its badge, the five
`*CoachMessage*` helpers in [lib/community.js](lib/community.js) and the whole
chat half of [lib/adminInbox.js](lib/adminInbox.js) (thread list, unread count,
AsyncStorage read-marks).

**The `coach_messages` table was deliberately NOT dropped** — the app no longer
reads or writes it, but the rows (and `migrations/20260722_coach_chat.sql`) are
still there. Drop it only on an explicit call; see DATABASE.md.

### Personal tab cards + accents (2026-08-23, trimmed 2026-08-26)
`PersonalScreen` now holds a single card: **THE SYSTEM** (purple `#A66BFF`, route
`System` → `SystemScreen`, a placeholder empty page for now, registered in
`PersonalStack`). The accent hex lives as the `SYSTEM_PURPLE` const at the top of
`PersonalScreen.js`. The jade COACH card above it was removed with the chat;
PillButton keeps its `jade` tone (used elsewhere). The screen fetches nothing any
more, so it has no loading state.
(Was the COMMUNITY tab, whose MY PLAYER CARD `PLAYER_ICE` card + group cards were
removed — see "Community — REMOVED FROM THE PLAYER APP".)

## Admin inbox — CHECK-UP INBOX (2026-08-25)
The "someone is waiting on you" queue on the AdminDashboard top bar: a pill that
wears a **pulsing count badge** while it isn't empty. It lives in
[lib/adminInbox.js](lib/adminInbox.js); the badge counts come from
`context/AdminNotifyContext.js` (`AdminNotifyProvider` wraps the `AdminStack`
inside `CoachProvider`; mount + 45s poll + a `refresh()` the screens call after
acting, plus a `useFocusEffect` refresh on the dashboard).
- **CHECK-UP INBOX** (red `#E11D48`) → `AdminCheckupInboxScreen` (route
  `CheckupInbox`). Lists every player who **submitted** a check-up the coach hasn't
  answered — `submitted_at IS NOT NULL AND feedback_at IS NULL`, deduped to the
  newest per player. Tapping a row does `setSelectedStudent` + opens
  `PlayerCheckup` (`AdminCheckupScreen`); sending feedback stamps `feedback_at`, so
  the player drops off the list and the dot clears on return. **Pure server state —
  no read-tracking, no migration.**
- **COMMUNITY was removed from the AdminDashboard top bar** to make room. The admin
  community screens/routes (`AdminCommunity`, `AdminGroup`, `CommunityChat`,
  `HunterStatus`) are still registered but now have **no entry point** — the whole
  community layer is unreachable from the UI on both sides (see "Community —
  REMOVED FROM THE PLAYER APP"). Bar order is now **＋ NEW PLAYER** · GALLERY ·
  CHECKUP EDITOR · BUSINESS · CHECK-UP INBOX · SIGN OUT. ＋ NEW PLAYER is the one
  CREATE action on the bar, so it wears the GOLD accent to sit apart from the
  navigation pills (see "Player onboarding").

## Business layer — money, retention & customers (2026-08-25)
The **commercial** side of the roster, admin-only end to end (RLS rejects every
player on all four tables). Schema + full column notes live in DATABASE.md
("Business layer"); migration `20260825_business_billing.sql`.
- **Entry points.** `BUSINESS` on the AdminDashboard top bar (jade — it's a
  different KIND of action from the training pills) → `AdminBusinessScreen`, and
  **MONEY & MEMBERSHIP** on the `PlayerAdmin` hub → `PlayerBillingScreen`. The
  business dashboard's PLANS · SETTINGS header pill → `AdminPlansScreen`.
- **`lib/billing.js` owns every number.** Two invariants the screens rely on:
  money is never derived from a plan price (`billing_plans` = what *should*
  arrive, `payments` = what *did*, the gap = outstanding), and **currencies are
  never summed** — totals are `{ ILS, USD }` bags rendered by `bagText()` because
  there is no FX rate in the app. `playerMoney()` powers the per-player card
  (LTV, avg/month, outstanding, next charge, term end); `businessSummary()`
  powers the dashboard (MRR, collected, ARPU, avg lifespan, 90-day churn, revenue
  by acquisition channel).
- **FREE is a flag, not a price of 0** (`billing_plans.is_free`). Family/comped
  players are excluded from ARPU, never chased, and never locked out. This is the
  whole reason the flag exists — a zero price cannot express it.
- **`lib/engagement.js` predicts churn from TRAINING, not money.** Risk 0–100 from
  the last 28 days of `workout_override_workouts` / `daily_quest_completions` /
  `checkups.submitted_at`. 28 days is not arbitrary: the two per-date tables are
  pruned on a 9-week window, so a longer lookback would read pruned history as
  inactivity. The ledger tells you a customer left; this moves a month earlier.
- **Locking is built but NOT enforced.** `billing_settings.lock_on_overdue`
  defaults `false` and `public.my_access_state()` exists so a future lock screen
  can gate a player without exposing any business table to the client. Nothing in
  `App.js` calls it yet — with a hand-kept ledger it would lock people who paid in
  cash. Turn it on only once payments land automatically from a provider.

## Player Profiles — Player Card (2026-07-23)
A per-player **profile card** (screen file `HunterStatusScreen`; the user-facing
title is **PLAYER CARD**). It's a **two-page swipeable pager — the SAME interaction
as `ExerciseDetailScreen`** (a horizontal `pagingEnabled` ScrollView with page dots
in the top bar), NOT a modal:
- **PAGE 0 — IDENTITY:** portrait, name, and LVL · class · prestige stars (all
  DERIVED, nothing stored for it). A **swipe teaser** at the bottom ("SIGNATURE
  MOVE · swipe left …") both signposts page 1 and is a tap target to `goToPage(1)`.
- **PAGE 1 — SIGNATURE MOVE:** the player's best clip (a single video). This is
  where the **＋ ADD / REPLACE / REMOVE** actions live for your OWN card — i.e. to
  share your signature you swipe left, then add the video. Others' is read-only.
- It's the payoff for the community features — profiles are how members see each
  other. Viewing your OWN card (`userId === signed-in user`) also unlocks
  tap-the-portrait-to-change on page 0. The NAME is never editable.
- **Entry points (2026-08-24: GROUP ROSTERS ONLY).** Route param `{ userId }`;
  `HunterStatus` is registered **only in `AdminStack`**, and the only way in is
  tapping a member on the group leaderboard / roster (`AdminGroupScreen` /
  `CommunityGroupScreen`). The player-side entry (the `MY PLAYER CARD` card atop
  the old Community tab) was removed with the community layer (2026-08-23), and the
  coach-side **PLAYER CARD tile on `PlayerAdminScreen` was removed 2026-08-24** —
  the hub is now COACH CHAT · CHECK-UP · WORKOUTS MANAGEMENT · SKILLS·CLASS·LEVEL.
  The screen is kept for a possible future re-entry. An admin opening a player's card sees it
  **read-only** (`userId !== meId`) — reads ride the admin `profiles` /
  completions RLS.
- Uses `<ScreenFrame fill>`; the pager fills the measured area.
  Do NOT reintroduce the shared `ScreenHeader` here (its flexed side slots squeezed
  the title) or a fullscreen `Modal` for the clip (an earlier attempt — replaced by
  this pager to match the exercise cards).
- **Two modes, one screen** (`route.params.userId`): viewing your OWN status
  (`userId === signed-in user`) unlocks edit affordances — tap the portrait to
  change it, add/replace/remove the signature clip. Anyone else's is **read-only**.
  The **NAME is never editable** (`full_name` is set once and unchangeable — shown
  read-only, no rename UI anywhere).
  (No player-facing entry point exists anymore — see the Entry points bullet above.)
- **Derived identity** — `fetchHunterProfile(userId)` in [lib/profile.js](lib/profile.js)
  mirrors HomeScreen's HUD math (`computeLvl` / `computeClassMax` /
  `evaluatePrestige` / `prestigeStars`), so LVL/class/stars match everywhere. Works
  for co-members because reads of `profiles` / `class_quests` /
  `student_quest_completions` are already allowed by the `shares_group_with` RLS
  the leaderboard uses — **no new read policy**.
- **Media.** PORTRAIT → PUBLIC Supabase bucket `profile-media` (50 MB), permanent,
  replace-on-upload (deletes the previous file via `avatar_path`). SIGNATURE VIDEO
  → **Cloudinary, NOT Supabase**: phones record HEVC/H.265 which desktop browsers
  can't decode (audio plays, frame is BLACK), so `uploadSignatureVideo` posts the
  raw clip to Cloudinary (cloud `lwfbixc6`, unsigned preset `levelx_signatures`),
  which transcodes server-side; we store the **H.264 delivery URL**
  (`f_mp4,vc_h264,q_auto`) in `signature_video_url` + the `public_id` in
  `signature_video_path`. Don't move signature videos back to Supabase Storage —
  that reintroduces the black-on-desktop codec bug. Uses `expo-image-picker`
  (Images w/ 1:1 crop for the portrait, Videos for the clip) and shared
  [components/VideoPlayer.js](components/VideoPlayer.js) (whose web `<video>` has NO
  border-radius — a rounded `<video>` also paints black in Chromium). Helpers:
  [lib/profile.js](lib/profile.js); migration `20260723_player_profiles.sql`. See
  DATABASE.md `profiles` + the storage notes.
- **Future (deferred by design):** a **stat block** (workouts/quests/streak totals)
  and **earnable TITLES** under the name — both intentionally NOT built yet.

## Training Schedule — skeleton + per-date overrides
Two layers, resolved at read time in [lib/schedule.js](lib/schedule.js)
(`resolveDayWorkouts`, `materializeDay`):
- **`weekly_workout_template`** — the recurring weekly SKELETON keyed by
  `day_of_week` (0=Sun…6=Sat). The Manage hub (StudentDetailScreen) — the weekly-
  skeleton view + ELITE WORKOUTS / CREATE WORKOUT / MY WORKOUTS buttons — is
  **ORPHANED as of 2026-08-13** (the Training Forge that opened it was retired; see
  Design System). The admin's Workouts screen is now identical to the player's.
  Assigning a workout to weekday(s) happens in the **My Workouts warehouse**
  (`AllWorkoutsScreen`): each of the player's own workouts has an **ASSIGN** button
  opening a Sun–Sat multi-day picker; SAVE diffs the selection against the live
  template (inserts newly-checked days, deletes unchecked ones) and the card shows
  the weekday chips it's currently on. **DELETE is COACH-ONLY (2026-08-12):** the
  per-card DELETE button renders only in admin-as-coach view (detected as
  `selectedStudent.id !== signed-in uid`, i.e. the coach is managing a DIFFERENT
  player); a player can create/assign but NOT delete their own workouts.
  The warehouse is stocked two ways: **+ CREATE WORKOUT** (author from scratch) and
  **importing an elite workout**. NOTE (2026-08-13): **CREATE WORKOUT is currently
  orphaned** (its only opener was the retired Manage hub); **import IS reachable** —
  the **WORKOUTS LIBRARY** tile on `WorkoutsScreen` opens `EliteWorkoutsScreen`
  directly for both roles. Elite import is a PLAYER-ONLY screen
  (`EliteWorkoutsScreen`) — deliberately NOT the admin gallery: it has no exercise
  browsing and no authoring/editing, only a class filter + a **+ IMPORT TO MY
  WORKOUTS** action per example workout. Import COPIES a `gallery_example_workouts`
  row into the player's own `workouts` + `exercises` via
  [lib/workouts.js](lib/workouts.js) `importGalleryWorkout()` (shared helper). The
  copy is independent (later admin edits don't propagate); the gallery row's
  `category` (the workout TYPE — main/side/accessory/legs) is carried over too, so
  the My Workouts card can label it. The workout TYPE is set when authoring (the
  gallery example builder `AddExampleWorkoutScreen`, or `WorkoutEditScreen` when
  editing an existing one). `WORKOUT_CATEGORIES` + `categoryLabel()` live in
  lib/workouts. (From-scratch authoring, `CreateWorkoutScreen`, was REMOVED
  2026-08-13 — new workouts now come only from a library import.)
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

## Weekly Accessories — REMOVED (2026-08-13)
The off-program weekly-accessory list (`WeeklyAccessoriesScreen`) was **deleted** —
screen + both stack routes are gone. The DB tables `weekly_accessories` +
`accessory_completions` still exist but are now **unused by the app** (drop them in a
migration if you want a full cleanup — see DATABASE.md). NOTE this is unrelated to the
`accessory`/`legs` workout **CATEGORY** (a workout TYPE in `WORKOUT_CATEGORIES`), which
STAYS — accessory/legs workouts are still authored, scheduled and colored everywhere.
The user's replacement flow: import an accessory workout from the **WORKOUTS LIBRARY**
tile → it lands in MY WORKOUTS → schedule it onto weekdays from there.

## Workout Mode — live session (LOCAL only)
"Workout Mode" is where a player actually performs a scheduled workout, logging
each set as they go. Entered **exclusively through the QUEST GATE** on
HomeScreen's today's-missions (tap a mission → the system's alert window opens →
▶ ENTER / ▶ RESUME steps through into the live session via `startWorkoutMode`).
WorkoutsScreen's day panel does NOT offer it anymore — a row there just opens the
workout (no ▶ WORKOUT button, and since 2026-08-30 no DONE either). This keeps the
"entering a session" moment a single, staged flow rather than a plain list button.
- **The launcher is `components/QuestGate.js` (2026-08-28).** The old RED GATE
  portal — the spinning crimson vortex with rotating energy rings — was
  **removed**; `GatePortalFX` and every `portal*`/`gate*` style went with it.
  Its replacement is the SYSTEM's own alert window, in the daily-quest panel's
  voice: ice-blue `ShimmerFrame` border, corner brackets that kick outward as it
  lands, an opening hairline that widens into the panel, and a scan bar that
  sweeps the glass on open and every few seconds after. Header reads **WORKOUT
  ALERT** (**WORKOUT IN PROGRESS** when resuming); body is the mission name, its
  purpose and a category chip; the one hot control is ▶ ENTER / ▶ RESUME over
  WORKOUT MODE, with DISMISS below. An accessory/legs mission tints the whole
  window in its own `accentFor` colour. **Android note:** the ENTER button's
  background is opaque and carries NO `elevation` — an elevation shadow under a
  TRANSLUCENT background paints as a hard rectangle inside the button on Android.
- **Screens:** `WorkoutModeScreen` (the tracker) → `WorkoutSummaryScreen` (the
  end-of-session recap). For the live launcher flow both are registered in **`App.js`'s
  `RootStack`** (`PlayerApp`), ABOVE the tab pager — the gate pushes WorkoutMode
  full-screen over the tabs (no bottom bar during a session). CRITICAL: they must
  NOT be entered by a cross-tab nested navigate into the Workouts tab — swiping the
  pager to Workouts AND mounting the heavy tracker at once desyncs
  react-native-pager-view and lands on the Workouts list instead of the session
  (the bug when Home was moved to the middle of the bar). `startWorkoutMode` just
  does `navigation.navigate('WorkoutMode', { workout })`, which bubbles up to the
  root stack. EXIT/DONE come back down via `goBack()` / `navigate('Tabs', { screen:
  'Home' })`. They stay ALSO registered in the Workouts + Admin stacks for the
  (currently unreached) gallery-preview path, where `getParent()` is the tab
  navigator (see WorkoutSummary DONE / WorkoutMode `exitToHome`).
- **State is LOCAL, never in Supabase** — the live session lives in AsyncStorage
  via [lib/workoutSession.js](lib/workoutSession.js) so the player can exit and
  resume where they left off. It is **cleared the moment the workout is
  finished**; no server-side session history is kept. The only lasting artifact
  is the summary screen, which the player screenshots.
- **Breaks / time log:** a session is a list of `segments` (`{start,end}`). Exiting
  Workout Mode closes the open segment; resuming opens a new one. A **break** is
  the gap between consecutive segments. The summary shows total training time,
  each segment's clock times, break durations, per-set reps, and totals.
  **Pause in place (2026-07-11):** the header's **⏸ BREAK / ▶ RESUME** pill closes/
  reopens the segment without leaving the screen (timer pill goes gold+dashed, meta
  row shows "ON BREAK"). Logging ANY set/skip auto-reopens the clock (and stamps
  `lastActivityAt`), so a forgotten resume can't under-count. **Forgot-to-pause
  healing** — every path that touches the open segment corrects long dead time
  (idle = time since `lastActivityAt`, or since segment start if nothing was logged
  in it):
  · next set/skip after > 10 min idle (`AUTO_BREAK_MS`) retroactively converts the
    gap into a break (`withIdleGapAsBreak`: segment closed back at last activity,
    fresh one opens now; an all-idle segment just slides its start forward);
  · pressing ⏸ or exiting the screen closes at the last activity when the tail is
    idle (`closeTrimmed`);
  · FINISH > 5 min (`IDLE_TRIM_MS`) after last activity closes there instead of
    now (an all-idle final segment is dropped); the summary carries `trimmedIdleMs`
    and shows a "✂ idle not counted" note under the hero time.
  · **Abandonment (2026-07-13):** with the clock RUNNING, 20 min with no
    activity (`ABANDON_MS`, checked live on the timer tick) = the player left
    the widget open and walked away. If anything was ever logged the session
    auto-finishes at the last set (idle-trimmed) and opens the FINAL TIME CHECK
    (below, with an ⚠ auto-finish note) waiting for their return; a completely
    blank session is DISCARDED instead (cleared, nothing marked complete, exit
    to Home). Paused/exited sessions never abandon — a stopped clock is an
    intentional break. Sits ALONGSIDE the 10-min auto-break rule (10–20 min
    idle still heals into a break on the next set).
  Net: walking away for hours without pausing can never inflate training time.
  **Final time check (2026-07-13):** FINISH (manual or abandonment) no longer
  jumps straight to the summary — a modal clock editor opens first: nudge
  STARTED / ENDED by ±1/±5 min ("began before pressing start" / late FINISH;
  edges clamped inside their own segment with ≥1 min left, end ≤ now) and
  ✕ ERASE any break (merges the surrounding segments so the gap counts as
  training). Live TRAINING TIME total updates as you edit. ✔ CONFIRM builds the
  summary + marks complete + clears the session; ↩ KEEP TRAINING closes the
  editor and drops back into the live session (nothing is finalized until
  confirm — the live session is untouched while the editor is open).
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
  Workout Edit + the gallery example builder store `gallery_id` when an exercise is picked from the
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
  Authored in Workout Edit / the gallery example builder via the **FORK** toggle + a COMMON/A/B/**ENDING**
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
  matter. Set in the workout builder (Workout Edit / gallery example builder) via the "⇄ SUPERSET
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
  `<ScreenFrame fill>` (one fixed full-screen card — see "ONE CARD, EVERY SCREEN"
  below; animated ice-glow border + holo-build entrance; pass `ready={!loading}`). Use
  `components/ScreenHeader` for the header (glowing BACK pill + centered glow title
  + optional `subtitle`/`right`) and `components/PillButton` for every action button
  (rounded "ice pill"; `variant` solid|outline, `tone` accent|gold|green|danger|muted,
  `size` sm|md|lg, with `loading`/`disabled`). All the player workout screens
  (WorkoutsScreen, StudentDetailScreen, AllWorkoutsScreen, EliteWorkoutsScreen,
  WorkoutDetailScreen, WorkoutEditScreen, WorkoutModeScreen,
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
- **Workouts screen — IDENTICAL for player and admin-as-coach (2026-08-13):**
  `WorkoutsScreen` renders the SAME layout in both modes — hero (name · LVL ·
  CLASS) + three direct ice-tile buttons **DAILY QUESTS** (→ `DailyQuest`, passed
  the scoped `selectedStudent` from CoachContext), **MY WORKOUTS** (→ `AllWorkouts`)
  and **WORKOUTS LIBRARY** (→ `EliteWorkouts` — import example workouts into the
  scoped player's warehouse) + week strip + day panel (EDIT DAY; the rows are
  read-only — see "The Workouts day panel is a READ-ONLY board"). The
  only admin-mode difference is a **← BACK** pill (returns to the `PlayerAdmin`
  hub). The old admin-only **TRAINING FORGE → Manage page-swipe was RETIRED** here —
  with it went the admin's path to `Manage`/StudentDetailScreen and the
  weekly-skeleton editor it hosted (StudentDetailScreen + `lib/forgeSwipe.js` stay
  in the tree but orphaned). **WORKOUTS LIBRARY** was the one hub tool kept —
  re-added directly as the third Workouts tile. **＋ CREATE WORKOUT**
  (`CreateWorkoutScreen`) and the **ACCESSORIES** feature (`WeeklyAccessoriesScreen`)
  were **DELETED entirely** (2026-08-13, screens + routes removed).
  `lib/forgeSwipe.js` (`forgeP`, `SWIPE_MS`) and the ghost-swipe machinery in
  StudentDetailScreen are dormant. Don't reintroduce the forge swipe unless the hub
  is brought back.
- **A mission card wears its TYPE color in EVERY state (2026-08-30).** On
  HomeScreen's TODAY'S MISSIONS, the type glow (`accentFor`) is no longer just the
  idle card's left rail: the **in-progress** `LiveMissionCard` derives its whole
  palette from it (breathing border, sweep, rail, beacon, title, TAP TO RESUME —
  the bright half via the local `lighten()`/`rgba()` helpers), and a **completed**
  card keeps its type border + checkbox instead of flipping to the ice-blue "done"
  theme. Same rule as the quest-node palettes: a card that owns a color owns it in
  every state — starting or finishing a HANDSTAND mission must never repaint it
  blue. The rows also show the **title only** — a mission's `purpose` is read in
  Workout Mode (and in the quest gate), not on the board.
- **The type color runs the WHOLE length of a workout (2026-08-30).** The rule
  above is no longer HomeScreen's alone — `accentFor` is now `categoryLabel(cat)
  ? categoryMeta(cat).color : null` (EVERY typed category, not just
  accessory/legs) in `WorkoutsScreen`, `WorkoutModeScreen` and
  `WorkoutDetailScreen` too, so one workout is one colour from the week strip's
  accent dot → its row on the day panel → the quest gate → the live session.
  · **Day panel row:** whole frame tinted (`borderColor` at `tc + '66'`, full
    `tc` once complete, `borderLeftColor` + glow always `tc`) + the title in `tc`.
  · **Workout Mode:** title, timer pill, purpose bar, progress fill (a
    `lighten()`-built 4-stop ramp so the sweep still moves), the CURRENT exercise
    card / letter badge / NOW tag / superset bracket, and the tappable exercise
    names. Done = green and skipped = muted are untouched — those are states of
    the EXERCISE, not the workout's identity.
  · **Workout Detail:** purpose bar, letter badges, exercise-name links, the
    SUPERSET chip.
  An untyped/legacy workout returns `null` from `accentFor` and every patch is
  `null` too, so the stylesheet's ice theme stands unchanged.
- **The Workouts day panel is a READ-ONLY board (2026-08-30).** Its rows no
  longer carry DONE / UNDO / a shimmering ✓ COMPLETED badge, and no longer show
  the workout's `purpose` (same reason as the mission rows — the description is
  read in Workout Mode). A row is: title, type colour, an unread-feedback dot,
  and a **small static ✓ in its own colour** with the title struck through at
  half opacity when it's behind you. The whole row is the old VIEW button (taps
  through to `WorkoutDetail`). **Completing a session happens in exactly two
  places — HomeScreen's mission checkbox and finishing Workout Mode** — so the
  week view states what the training IS rather than offering a second, competing
  tick. `handleMarkDone`/`handleUndoDone`, the `marking` state, the `isLocked`
  7-day lock and its 🔒 LOCKED badge went with them.
- **Quest chain cards carry a LEFT ACCENT RAIL (2026-08-24).** Every chain card on
  SkillsScreen (main + both side tiers) uses the app's shared left-rail card
  language (`borderLeftWidth: 4`, as on the Workouts day cards / exercise cards).
  The rail colour IS the state: **ice `SL.accent` = standard**, **amber `UP.hot`
  (#FFC46B) = running its UPGRADED version**, **gold `SL.gold` = MAXED OUT**. The
  amber `UP` palette (top of SkillsScreen.js) is deliberately one step warm of ice
  and one step short of gold so "upgraded" never reads as "finished"; it also tints
  the frame, the progress rail (taller, with a bright leading cap), the chevron
  node, the title ink and the +LVL. Moving shimmer (ShimmerText/ShimmerFrame) stays
  reserved for MAXED. There is no "UPGRADED" text badge — the rail is the tell.
- **The tour can ask a SCREEN to show something (2026-08-26).** A step with an
  `id` publishes it through `TourContext.stepId`, and a screen can render a
  tutorial-only element while that step is up. Two of these exist:
  · HomeScreen's demo mission row (rest day — nothing for "Start a Workout" to
    point at), keyed off `tourOpen`;
  · CheckupScreen's **example coach reply** on the GET FEEDBACK step, keyed off
    `stepId === 'checkup.feedback'` AND no real feedback. It is the real
    `feedbackCard` with a dashed border and an "EXAMPLE" tag, carrying the REAL
    `checkup.feedback` tour tag (the two can never co-exist), so the step
    highlights it and the player sees the WATCH FEEDBACK VIDEO button they will
    get instead of reading about something invisible. It disappears on NEXT.
  The rule for this pattern: the demo must be tagged as the real element, must be
  impossible to mistake for real data, and must not outlive its step — GuidedTour
  publishes `null` on step change AND on unmount.
- **`pad: { top, bottom, x }` on a step** grows its highlight beyond the measured
  element, in canvas units. For when the tagged view is smaller than the thing the
  player reads as one block — the week strip's row versus its day cells. Reach for
  a real target first; this is a tuning knob, not a fix for a mis-measurement.
- **Guided-tour targets: three rules, all learned the hard way (2026-08-26).**
  1. **`collapsable={false}` on every tagged `<View>`.** Android flattens any View
     that carries only layout props, and a ref does NOT keep it alive — the ref
     resolves to the nearest surviving ancestor, so the element measures as its
     PARENT and the highlight lands on the wrong box. ScrollViews and Touchables
     are native already and don't need it.
  2. **Tag EVERY branch that can render the thing.** `home.mission1` was tagged on
     the ordinary mission row but not on `LiveMissionCard`, the in-progress
     variant — so for any player mid-session (the common case) the step fell back
     to drawing a circle in empty space.
  3. **The tour navigates to a tab's ROOT route, never just the tab.** Skills,
     Workouts and Personal are STACKS and a tab remembers where the player left
     it. Open a quest tree once and the SKILLS steps then play over
     `QuestTreeScreen`. Worse, they don't fail loudly: `SkillsScreen` is still
     mounted underneath, so its elements still MEASURE — as hidden views, which
     stranded the highlight in the top-left corner. `TAB_ROOT` in `PlayerTour`
     (App.js) maps each tab to its root route and the nested navigate pops the
     stack back to it.
  When a step points somewhere strange, check these three before touching the
  drawing code — every one of them presents as "the highlight is in the wrong
  place", which looks like a geometry bug and is not.
- **A NaN in an SVG prop is a HARD NATIVE CRASH (2026-08-26).** react-native-svg
  hands numbers straight to the platform path builder, so one non-finite
  coordinate closes the whole app — it is not a JS throw and no error boundary
  can catch it. This is what killed the app on the guided tour's step 7: when a
  step's element can't be measured it falls back to a `{ type: 'circle' }` mark,
  that mark carried only `cx/cy/rad`, and the caption placement reads `mark.y` /
  `mark.h` to find the room above and below — `undefined` → NaN room → NaN
  `capY` → NaN in the connector arrow's path. Rules that keep it dead:
  · **every mark exposes a complete `x/y/w/h` box**, whatever its shape;
  · `fitMark()` rejects non-finite input, clips to the overlay, and returns
    **null** for a degenerate box (draw nothing rather than a zero-size reticle);
  · the arrow is only built if every coordinate in it is finite, and `capY` has a
    final `Number.isFinite` fallback.
  A measurement going non-finite is NORMAL, not exotic — a view that unmounts
  mid-poll measures as `undefined`, and `undefined * scale` is NaN. Guard at the
  boundary, never assume a measured number is a number.
  [components/TourBoundary.js](components/TourBoundary.js) catches the JS-level
  failures on top of that (same pattern as `IntroBoundary`): the tour renders at
  the root, so an uncaught throw there would unmount the entire tree. It closes
  the tutorial instead, and resets on the next step so one bad step doesn't
  poison the session.
- **ANDROID `measureInWindow` LIES ABOUT SIZE — CRITICAL (2026-08-26).**
  `NativeViewHierarchyManager.measureInWindow` reports **position** through the
  ancestor transform (`view.getLocationInWindow()`, which honours ScaledRoot's
  0.72) but **size** as the raw layout box (`view.getWidth()` / `getHeight()`,
  untransformed). So measuring anything in the app tree on Android gives a
  CORRECT top-left and a size ~39% too big. Anchored at that correct corner, the
  guided tour's highlight spilled off the right edge of the card and down over
  the panel BELOW its target (TODAY'S MISSIONS swallowing DAILY QUESTS, YOUR
  CLASS swallowing the LVL line) — and it dragged the connector arrow's endpoint
  out with it. It also silently broke scroll-into-view: `revealTourTarget`
  derives the scale from `box.h / getViewportH()`, which came out 1 instead of
  0.72, so every reveal scroll under-shot by 28%.
  The correction lives at the SOURCE — `M_SCALE` in
  [lib/tourTargets.js](lib/tourTargets.js) multiplies the w/h of every in-app
  measurement, so the highlight and the scroll math share one coordinate space.
  iOS is untouched (`convertRect:toView:` transforms size correctly) and web goes
  through `getBoundingClientRect` (already zoom-aware), hence `Platform.OS ===
  'android'` only. **GuidedTour's own `measureNode` is deliberately NOT
  corrected** — it measures the overlay, which is in the modal's own window with
  no transform above it. `fitMark()` clips every highlight to the overlay as a
  backstop, so a bad measurement can never again paint off-screen.
  Any future feature that measures a view to draw on top of it hits this same
  trap.
- **The GUIDED TOUR renders at the APP ROOT, never inside a tab (2026-08-26).**
  `GuidedTour` used to be a child of `HomeScreen`. On the APK that broke the
  tutorial the first time it changed tabs: Home is one page of the material-top-tab
  pager, React Navigation deactivates an inactive scene (`detachInactiveScreens`),
  and a `<Modal>` inside a detached native screen is torn down with it — the
  overlay vanished on the SKILLS step and the player was stranded mid-tour with no
  way to continue. Web never showed it (no native screens to detach).
  It now lives in **`PlayerTour`** (App.js), a sibling of `RootStack.Navigator`,
  so no tab change can touch it. Two consequences to keep:
  · it is outside every navigator, so it drives the tabs through the
    **`NavigationContainer` ref** (`useNavigationContainerRef` in `App()`, passed
    down as `navRef`) — `navRef.navigate('Tabs', { screen: tab })`, guarded by
    `isReady()`. There is no `useNavigation()` to call from there.
  · **`context/TourContext.js`** is the remaining link to HomeScreen: `openTour`
    for the TUTORIAL pill, and `tourOpen` for the tutorial-only demo mission card
    on a rest day. Its default value is a working no-op, so a screen rendered
    outside the provider just sees "no tour running".
  CLOSING the tour still navigates back to Home FIRST and lifts the overlay 240ms
  later — dismissing the overlay and jumping the pager on one frame desyncs
  react-native-pager-view. Don't collapse those two steps.
  **Do not move the tour back under a screen.** Any future full-app overlay that
  outlives a tab change belongs at the root for the same reason.
- **A <Modal> ESCAPES ScaledRoot — CRITICAL (2026-08-26):** on native, App.js
  lays the whole tree out on an oversized canvas and scales it back by
  `NATIVE_SCALE` (0.72). A React Native `<Modal>` renders in its OWN native
  window, so it does **NOT** inherit that transform — anything drawn inside one
  comes out 1/0.72 ≈ **39% bigger** than the app behind it, and it covers the
  status bar AND the Android nav bar (nothing pads them for you). `GuidedTour`
  hit both: its caption card ate the phone screen and buried the connector
  arrows. The fix pattern, and the one to copy for any new fullscreen modal:
  · a module-level `const S = Platform.OS === 'web' ? 1 : NATIVE_SCALE` +
    `s(n) => n * S`, applied to every fixed px value drawn in the overlay;
  · the card laid out at FULL canvas size and scaled as ONE block
    (`width: capW / S`, `transform: [{ scale: S }]`, `transformOrigin: 'top left'`)
    so nested components (PillButton, fonts, pads) shrink with it — remember its
    `onLayout` height is then LAYOUT height, not visual (visual = capH * S);
  · raw `useSafeAreaInsets()` (NOT `useAppInsets`, which converts to canvas
    units) for the top/bottom limits, since the overlay is measured in device px.
  Web renders the modal inside the zoomed root, so `S` is 1 and nothing changes
  there — which is exactly why this only ever showed up in the APK.
  GuidedTour's caption also **dodges the highlight** now: it measures the real
  room above and below the mark, takes the side the card actually fits on, and
  then pushes the card to the FAR WALL of that side (flush to the top edge, or
  flush to the bottom above the tab bar) — a hugged caption made the connector
  arrow an unreadable stub.
  The old per-step `captionGap` hand-tuning is gone — don't reintroduce it.
- **ONE CARD, EVERY SCREEN — CRITICAL (2026-08-25):** the frame is **full-screen,
  identical on every screen, and never changes size**. `ScreenFrame` owns that
  entirely now: it always fills the viewport minus a constant margin
  (`FRAME_PAD` / `FRAME_PAD_V` = 12 on all four sides) at one width
  (`FRAME_MAX_W` = `CARD_W`, capped by the window). Screens do NOT pass `maxWidth`
  and do NOT set a card height — **`CARD_H` is gone**, and the per-screen widths
  (560 / 640 / 720 / 900 / 920 / 1800) are gone with it. Content that outgrows the
  card scrolls INSIDE it; the frame itself never moves, never resizes with data or
  loading state, and matches the neighbouring screen mid-swipe.
  Two modes, same geometry:
  · **`<ScreenFrame fill>`** — for a screen whose body is one full-height card with
    its own internal scroll region (`<View style={styles.card}>` with
    `card: { flex: 1 }` + a `flex: 1` middle that holds a `ScrollView`/`FlatList`).
    **This is the default choice** — the flex chain reaches the card, so the inner
    scroll region is bounded exactly the way the old fixed `CARD_H` bounded it.
    Weekly Plan, My Workouts, Elite Workouts, Personal, Skills, the admin roster,
    the chats and the check-up screens all work this way.
  · **plain `<ScreenFrame>`** — for a screen that is just a run of content with no
    internal scroll region (Home, System, Login, Set Password, the editors). The
    frame supplies the ScrollView; give the root child `flexGrow: 1` if it should
    stretch to the bottom. NEVER wrap `<ScreenFrame>` in a ScrollView — that lets
    the card shrink to its content, which is the exact bug this rule kills.
  ALWAYS render the full layout and overlay the load spinner (never swap the body
  for a spinner) — that was the other source of load-time size jumps.
  **The frame must not blink out BETWEEN screens either (2026-08-28).** After
  sign-in, App.js waits on the role lookup before it knows which tree to mount,
  and that gap used to render a bare dark `View` — the border vanished for a
  split second and the login → home hand-off read as a reload. `FrameShell` in
  App.js now holds the identical empty card there (`<ScreenFrame fill
  holoEntry={false}>`, inside ScaledRoot). It must NOT consume the holo latch —
  that belongs to the real landing card. Any future "we don't know what to
  render yet" state between two framed screens gets the same treatment.
  **The player TAB BAR unfolds, and the card's bottom edge rides on it
  (2026-08-28).** The bar lives OUTSIDE the card, so the build — which is bounded
  to the card — left it popping into place fully formed. Sliding it up with a
  transform was no better: that was still TWO motions, the card's lower border
  sitting still while the bar travelled past underneath. What has to move is the
  BOUNDARY they share. So the bar animates its own **layout height** from 0 to
  full; the pager above it is `flex: 1`, so the card's bottom edge is pushed up
  by the same pixels on the same frame — one line rising, the bar unfolding
  beneath it. Hence a height animation and **not** a transform (a transform moves
  the bar THROUGH a fixed layout; only a layout change carries the card's border
  with it), which also means it cannot use the native driver — keep it short, it
  re-lays out the card every frame. The bar's contents are pinned to the TOP of
  the growing box (`barBox` clips, `bar` is absolute at `top: 0`) so the labels
  ride up with the boundary instead of being revealed in place.
  The sync is explicit, not a guessed delay — `lib/holoEntry.js` gained
  `onHoloStart` / `notifyHoloStart` (HoloBuild calls it beside
  `playHologram()`) plus `isHoloComing()`, which the bar reads ONCE at mount to
  decide whether to start hidden at all. Two failure modes are already handled,
  keep them: an ordinary mount with no build coming shows the bar immediately,
  and a build that never starts (a screen stuck loading) still reveals the bar
  after `BAR_RISE_FALLBACK_MS`. Anything else that sits outside the card and
  must move with the entrance should hang off `onHoloStart` the same way.

## App identity — "The System" + cold-start intro (2026-08-24)
The app's display name is **The System** (`app.json` `expo.name`), and a 3-second
title sequence plays on every cold start.
- **`components/SystemIntro.js`** renders `assets/intro.mp4` (H.264, 1920×1080,
  30fps, **no audio track**) full-screen via **`expo-video`** (`useVideoPlayer` +
  `<VideoView contentFit="contain">`), then fades out over 320ms and calls
  `onDone`. Tap anywhere to skip.
- **Keep the clip SMALL — it blocks first paint.** The first export was 2.1 MB at
  ~5.8 Mbps, which on web was still buffering when the old fixed watchdog fired, so
  users got a black gap and never saw the animation. **Every new master must be
  re-encoded** with
  `ffmpeg -i <master> -c:v libx264 -crf 24 -preset slow -pix_fmt yuv420p -movflags +faststart -an intro.mp4`.
  The current clip ("Intro 2", 1280×720 30fps 3.0s) went 1.32 MB → **212 kB** that
  way (PSNR 46.6 dB — visually identical). `+faststart` is required so the browser
  can play before the file finishes downloading. Then regenerate the error-fallback
  still: `ffmpeg -sseof -0.1 -i intro.mp4 -frames:v 1 -update 1 -q:v 4 intro-poster.jpg`
  (35 kB). Total intro payload ≈ 247 kB. Delete the raw master afterwards — it is
  fully superseded.
- **Letterbox colour must match the CLIP, not the app.** Sample the new clip's edge
  pixels after every re-export and set **`C.introBg`** to that value — the overlay
  paints its bars with it. (The first cut's background was `#000005` against a
  `C.bg` of `#050912`: two different blacks, which left a visible rectangle framing
  the video. "Intro 2" is `#050911`, near-identical to `C.bg`.) `contentFit` stays
  **`contain`**, never `cover`: the wordmark is ~5:1, so covering a portrait phone
  screen would crop it to two letters. Matching the bars is what makes it read as
  full-bleed on every aspect ratio. Re-sample `introBg` if the clip is re-exported.
- **Timing is gated on READINESS, not a blind timer.** The clip is fetched over
  the network on web, so it is not playable at mount. `play()` is called only on
  `statusChange → 'readyToPlay'`; `READY_MS` (2.2s) caps the wait and **skips the
  intro entirely** if it's missed (better no animation than a black screen), and
  `TAIL_MS` covers a `playToEnd` that never lands. Do NOT go back to a fixed
  mount-time watchdog.
- **It renders ABOVE the real tree, not instead of it** — `App()` builds the app in
  `renderContent()` and overlays `<SystemIntro>` on top, OUTSIDE `ScaledRoot` (so
  the clip fills the true screen, not the zoomed canvas). Two reasons: the login
  card / tabs mount and lay out behind the clip so there's no pop-in at the
  hand-off, and the intro masks the font + session wait. `App` also calls
  `SplashScreen.hideAsync()` on mount so the sequence starts immediately instead of
  sitting behind the static splash.
- **Never let it become a launch failure.** Every exit route (ended / tapped /
  never loaded / errored) funnels through one `finish()` guarded by a ref, and a
  `statusChange` error shows the poster for 700ms instead. On top of that,
  **`components/IntroBoundary.js`** wraps it in App.js: a throw inside the intro
  would otherwise propagate to the React root and unmount the WHOLE app (black
  page, no recovery) — the boundary logs `[SystemIntro] skipped after error:` and
  drops the overlay so the app still loads. `INTRO_ENABLED` at the top of App.js
  is a one-line kill switch. Reduce-motion skips it entirely —
  `AccessibilityInfo.isReduceMotionEnabled` is **undefined on Expo web**, so it is
  optional-called (`?.()?.then`); see the web-gotchas rule.
- **LoginScreen's wordmark** is the `WORDMARK` const (`'The System'`), a plain
  glowing accent `Text` at 46/8 over a hairline rule — the ScreenHeader treatment,
  sized so 10 glyphs fit the card. **The login GLITCHES ARE GONE (2026-08-28):**
  the deviation engine (datamosh overlay, RGB-split ghosts, sharp jitter), the
  brick-shatter login intro and the void drone were deleted along with
  `DeviationOverlay` / `BrickShatter` / `ScatterCollapse` / `FrameShatter`,
  ScreenFrame's `shatter` prop, and the glitch half of `lib/glitchSound.js`
  (renamed **`lib/uiSound.js`**, now just the hologram boot-up chime HoloBuild
  plays). The screen is ordinary app chrome: ScreenFrame card, wordmark + rule,
  a `▍SIGN IN` section head, EMAIL / PASSWORD labels over the standard inputs,
  the shared `PillButton` (solid accent, lg) and the standard red error box.
  Pressing LOGIN now calls `signInWithPassword` immediately — the old button ran
  a ~1.5s collapse animation FIRST and only then signed in, which read as a dead
  tap. Don't reintroduce the glitch layer.
- **The login hands off to the landing card as ONE motion (2026-08-28).**
  `components/HoloDissolve.js` is the exact MIRROR of `HoloBuild`: the same 16
  slices and the same glowing cyan build-front, covering the card from the TOP
  DOWN. Pressing LOGIN plays it (via ScreenFrame's `overlay`), and only when the
  card is fully covered does `signInWithPassword` run — the session flip unmounts
  the screen, so racing it would cut the line off half way down. The card then
  sits as empty space for the round-trip, which is what the landing card's
  `HoloBuild` builds out of (bottom up). A FAILED sign-in runs the dissolve
  backwards and hands the form back with the error. `N` / `STRIP_MS` /
  `STAGGER` must stay in step with HoloBuild's or the two halves stop reading as
  the same line.
- **`slug` and `android.package` were deliberately NOT renamed** (still `levelx` /
  `com.levelx.app`): the slug owns the EAS project + the `levelx.expo.app` deploy
  URL, and changing the package makes it a different app on-device with no upgrade
  path. Only the display name changed.
- **Icons all derive from `assets/official_icon.png`** (1254×1254, the wordmark on
  the dark canvas). It is the MASTER — not referenced by code or config, so it is
  never bundled; keep it to regenerate variants. The logo occupies **93.2% of the
  canvas width at ~3.6:1**, which is too wide to drop into every slot unchanged, so
  each target is padded to its own masking rules (pad colour `#050911`):
  · `icon.png` 1024² — logo at **80%** (iOS/general; only the corners are rounded).
  · `adaptive-icon.png` 1024² — logo at **64%**. Android masks the foreground to a
    circle and only the central ~66% survives; at 93% the "S" and "M" get clipped.
    64% puts the logo's furthest corner at r=341px, exactly the safe radius.
  · `splash-icon.png` 1024² — full bleed (no mask; `resizeMode: contain`).
  · `favicon.png` 256² and `public/logo192|512.png` — full-ish; `logo-maskable-512.png`
    uses the 64% safe-zone treatment like the adaptive icon.
  **Known limitation:** a ~4:1 wordmark is not legible at launcher/tab sizes — at
  16–48px it reads as a blur. A separate monogram (single glyph) icon would fix it;
  the wordmark is only really readable at splash size.

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
  Also `DonePulse` — the idle life of a row that's already cleared: one slow edge
  glow (3.4s, low amplitude) in the row's own colour, no travel. It is the COLD
  end of `LiveMissionCard`'s hot pulse (1.05s + a 1.9s sweep) on purpose —
  **speed is how the board says live vs. done**, read before any word is. Never
  make it faster or brighter than the live card. One shared refcounted clock (the
  `Shimmer.js` pattern) drives every instance, so a board of cleared rows is one
  native loop, all breathing in unison.
  Also `ClearSweep` — the "cleared" beat on a tickable row (HomeScreen's missions
  + daily quests): a bright bar in the row's own colour scanning across it, plus a
  brief wash. It plays ONLY on the false→true flip (a `prev` ref), so a board that
  loads with six finished rows fires nothing; it unmounts itself when the sweep
  ends, so a settled card costs nothing. **Marking something done speaks in the
  system's existing voice — a line running over the thing** (the quest gate's scan
  bar, HoloBuild's build-front, the shimmer sweep), never a new effect; a cleared
  row is then scanned, struck through and dropped to half opacity IN ITS OWN
  COLOUR. Give any new row it clips (`overflow: 'hidden'`) so the bar stays inside
  the corners.
  Also `SystemIntro` — the cold-start "The System" title sequence overlay (see
  "App identity" above); it is the only `expo-video` consumer, distinct from the
  `VideoPlayer` below.
  Also `VideoPlayer` — a minimal clip player (`<video>` on web / `WebView` on
  native) shared by the check-up screens (see Checkups) and modelled on
  ExerciseDetailScreen's video section. And `CheckupTemplateEditor` — the shared
  admin authoring surface for check-up templates (Part-1 questions + Part-2
  exercises; scope `{ classId }` or `{ playerId }`), used by both admin check-up
  screens (see Checkups).
- `constants/` — colors.js, fonts.js, layout.js (`CARD_W` — THE card width for every framed screen; there is no CARD_H, the card is always full height)
- `context/` — React contexts (incl. `TourContext` — the guided tour is owned by
  the app root, not HomeScreen; see the Design System note)
- `lib/` — utilities
- `supabase/` — `migrations/` (the SQL to run on the live project) and
  `functions/` (Deno **edge functions** — server-side code holding secrets the app
  may never see; currently just `invite-player`, see "Player onboarding". Setup and
  deploy steps in `supabase/functions/README.md`). The client itself is
  [lib/supabase.js](lib/supabase.js).
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
