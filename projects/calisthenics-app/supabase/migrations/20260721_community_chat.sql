-- Community — per-group CHAT
-- ─────────────────────────────────────────────────────────────────────────────
-- A lightweight text chat scoped to one group: every member can post and read
-- their group's messages (a bonding space alongside challenges/raids/streak).
--
-- EPHEMERAL BY DESIGN — messages are kept only CHAT_RETENTION_DAYS (7 days) and
-- then swept away, so the table never grows unbounded. There is intentionally no
-- long history. The sweep is client-side (run on chat load), the same philosophy
-- as the check-up purge and the 9-week workout window. To make the sweep work
-- WITHOUT a cron/service role, an additive RLS policy lets any group member
-- delete messages in their own group that are older than the window (see
-- "member purge expired messages" below).
--
-- Text only — no images/video (keeps it cheap and free of storage concerns).
--
-- Additive to 20260717_community.sql (reuses its is_group_member / is_admin
-- SECURITY DEFINER helpers — that migration must already be applied).
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.community_messages (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.community_groups(id) on delete cascade,
  player_id  uuid not null references public.profiles(id)         on delete cascade,
  body       text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
-- Reads are "this group's messages, oldest→newest" and the purge filters by age,
-- so index both the group and the clock.
create index if not exists community_messages_group_idx      on public.community_messages (group_id);
create index if not exists community_messages_group_time_idx on public.community_messages (group_id, created_at);

alter table public.community_messages enable row level security;

-- Admin full CRUD (oversight + moderation — can delete any message).
drop policy if exists "admin all community messages" on public.community_messages;
create policy "admin all community messages"
  on public.community_messages for all to authenticated
  using ( public.is_admin() ) with check ( public.is_admin() );

-- A member may READ every message in groups they belong to.
drop policy if exists "member read community messages" on public.community_messages;
create policy "member read community messages"
  on public.community_messages for select to authenticated
  using ( public.is_group_member(group_id) );

-- A member may POST only as THEMSELVES, and only into a group they belong to.
drop policy if exists "member send community messages" on public.community_messages;
create policy "member send community messages"
  on public.community_messages for insert to authenticated
  with check ( auth.uid() = player_id and public.is_group_member(group_id) );

-- A member may delete their OWN message (unsend).
drop policy if exists "member delete own community messages" on public.community_messages;
create policy "member delete own community messages"
  on public.community_messages for delete to authenticated
  using ( auth.uid() = player_id );

-- Self-cleaning purge: any member of the group may delete messages in that group
-- that are older than the 7-day retention window. This lets the client-side
-- purge run without a service role or cron — whoever opens the chat sweeps the
-- expired rows. (Bounded to old messages only, so it can't be used to wipe live
-- chat.)
drop policy if exists "member purge expired community messages" on public.community_messages;
create policy "member purge expired community messages"
  on public.community_messages for delete to authenticated
  using (
    public.is_group_member(group_id)
    and created_at < now() - interval '7 days'
  );
