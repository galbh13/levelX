-- Structured check-up templates — admin-authored, class-standard, per-player override
-- ─────────────────────────────────────────────────────────────────────────────
-- The check-up is no longer a free-form player submission. The ADMIN authors a
-- structured template, and the player fills it in. A template is an ordered list
-- of ITEMS in two parts:
--   • Part 1 — QUESTIONS  (part='question'): a plain text prompt (diet, sleep …).
--                          The player answers with text  → checkup_answers.
--   • Part 2 — EXERCISES  (part='exercise'): a prompt (exercise name) + a
--                          reference video_url + a description/explanation. The
--                          player performs it and uploads their OWN clip + a note
--                          → checkup_videos (extended below).
--
-- Templates are CLASS-STANDARD (class_id): every player in that class inherits it.
-- The admin can OVERRIDE a single player (player_id): the class items are copied
-- onto the player and edited/trimmed there. Resolution (lib/checkups.js
-- resolvePlayerTemplate): a player's OWN (player_id) rows if any exist, else the
-- rows of their class. "Reset to standard" deletes the player's rows.
--
-- Submissions (checkups / checkup_videos / checkup_answers) still ride the 14-day
-- purge; the TEMPLATE items are the standing definition and are NOT purged.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── checkup_template_items — the admin-authored template (class XOR player) ───
create table if not exists public.checkup_template_items (
  id           uuid primary key default gen_random_uuid(),
  class_id     uuid references public.classes(id)  on delete cascade,   -- class-standard row
  player_id    uuid references public.profiles(id) on delete cascade,   -- per-player override row
  part         text not null check (part in ('question', 'exercise')),
  prompt       text not null,            -- the question text, or the exercise name
  video_url    text,                     -- reference/demo clip (exercise only)
  description  text,                     -- explanation words (exercise only)
  order_index  int  not null default 0,
  created_at   timestamptz not null default now(),
  -- exactly one scope: a class-standard row XOR a per-player override row
  constraint checkup_item_scope check ((class_id is not null) <> (player_id is not null))
);
create index if not exists checkup_template_items_class_idx  on public.checkup_template_items (class_id);
create index if not exists checkup_template_items_player_idx on public.checkup_template_items (player_id);

alter table public.checkup_template_items enable row level security;

-- Admin authors everything (both class-standard and per-player rows).
drop policy if exists "admin all checkup template items" on public.checkup_template_items;
create policy "admin all checkup template items"
  on public.checkup_template_items for all to authenticated
  using ( public.is_admin() ) with check ( public.is_admin() );

-- Players read the class-standard items (harmless, not sensitive) + their own
-- overrides. Read-only — only the admin modifies templates.
drop policy if exists "read checkup template items" on public.checkup_template_items;
create policy "read checkup template items"
  on public.checkup_template_items for select to authenticated
  using ( class_id is not null or player_id = auth.uid() );

-- ── checkup_answers — the player's Part-1 text answers (one row per question) ──
-- prompt is a SNAPSHOT of the question at submit time so the admin's review stays
-- readable even if the template item is later edited or deleted (item_id → NULL).
create table if not exists public.checkup_answers (
  id           uuid primary key default gen_random_uuid(),
  checkup_id   uuid not null references public.checkups(id)               on delete cascade,
  student_id   uuid not null references public.profiles(id)               on delete cascade,  -- owner (RLS)
  item_id      uuid references public.checkup_template_items(id)          on delete set null, -- the question answered
  prompt       text not null,            -- snapshot of the question text
  answer_text  text,                     -- the player's written answer
  order_index  int  not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists checkup_answers_checkup_idx on public.checkup_answers (checkup_id);
create index if not exists checkup_answers_student_idx on public.checkup_answers (student_id);

alter table public.checkup_answers enable row level security;

drop policy if exists "owner all checkup answers" on public.checkup_answers;
create policy "owner all checkup answers"
  on public.checkup_answers for all to authenticated
  using ( auth.uid() = student_id ) with check ( auth.uid() = student_id );

drop policy if exists "admin all checkup answers" on public.checkup_answers;
create policy "admin all checkup answers"
  on public.checkup_answers for all to authenticated
  using ( public.is_admin() ) with check ( public.is_admin() );

-- ── Extend checkup_videos — tie a clip to the Part-2 exercise it answers ──────
-- A Part-2 response is a video (the anchor) + an optional note. prompt snapshots
-- the exercise name so the admin's review survives template edits/deletes.
alter table public.checkup_videos add column if not exists item_id     uuid
  references public.checkup_template_items(id) on delete set null;
alter table public.checkup_videos add column if not exists prompt      text;  -- exercise name snapshot
alter table public.checkup_videos add column if not exists answer_text text;  -- the player's words about it
alter table public.checkup_videos add column if not exists order_index int not null default 0;
create index if not exists checkup_videos_item_idx on public.checkup_videos (item_id);

-- NOTE: checkups.note (the old single free-form reflection) is now LEGACY — Part 1
-- questions replace it. The column is kept (nullable) but no longer written.
