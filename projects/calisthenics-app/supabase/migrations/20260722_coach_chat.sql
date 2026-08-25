-- Coach ⇄ player DIRECT chat
-- ─────────────────────────────────────────────────────────────────────────────
-- A private 1-on-1 text chat between a single player and the coach (admin). This
-- is NOT the per-group community chat (community_messages) — it is keyed to ONE
-- player: the whole conversation is that player's "channel". Two participants
-- only — the player (`player_id`) and whichever admin replies. `sender_id`
-- records who wrote each line (the player themselves, or an admin acting as the
-- COACH). A message is "from the coach" iff sender_id <> player_id.
--
-- The player reaches it from the top of their Community tab; the coach reaches it
-- from the player's admin dashboard (PlayerAdminScreen).
--
-- EPHEMERAL BY DESIGN — like community_messages, messages are kept only
-- CHAT_RETENTION_DAYS (7 days) then swept client-side on chat load. An additive
-- purge policy lets the player wipe their own channel's expired rows without a
-- cron/service role. Text only.
--
-- Reuses the is_admin() SECURITY DEFINER helper from 20260717_community.sql
-- (that migration must already be applied).
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.coach_messages (
  id         uuid primary key default gen_random_uuid(),
  player_id  uuid not null references public.profiles(id) on delete cascade, -- the channel (which player's coach-chat)
  sender_id  uuid not null references public.profiles(id) on delete cascade, -- author (player, or an admin = COACH)
  body       text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
-- Reads are "this player's channel, oldest→newest" and the purge filters by age.
create index if not exists coach_messages_player_idx      on public.coach_messages (player_id);
create index if not exists coach_messages_player_time_idx on public.coach_messages (player_id, created_at);

alter table public.coach_messages enable row level security;

-- Admin full CRUD — the coach reads/replies to any player's channel and may
-- delete any message (moderation).
drop policy if exists "admin all coach messages" on public.coach_messages;
create policy "admin all coach messages"
  on public.coach_messages for all to authenticated
  using ( public.is_admin() ) with check ( public.is_admin() );

-- A player may READ only their OWN channel.
drop policy if exists "player read own coach messages" on public.coach_messages;
create policy "player read own coach messages"
  on public.coach_messages for select to authenticated
  using ( auth.uid() = player_id );

-- A player may POST only into their OWN channel, as THEMSELVES.
drop policy if exists "player send own coach messages" on public.coach_messages;
create policy "player send own coach messages"
  on public.coach_messages for insert to authenticated
  with check ( auth.uid() = player_id and auth.uid() = sender_id );

-- A player may delete a message they SENT (unsend).
drop policy if exists "player delete own coach messages" on public.coach_messages;
create policy "player delete own coach messages"
  on public.coach_messages for delete to authenticated
  using ( auth.uid() = sender_id );

-- Self-cleaning purge: the player may delete rows in their OWN channel older than
-- the 7-day retention window, so the client-side purge runs without a service
-- role. Bounded to old messages, so it can't wipe live chat.
drop policy if exists "player purge expired coach messages" on public.coach_messages;
create policy "player purge expired coach messages"
  on public.coach_messages for delete to authenticated
  using (
    auth.uid() = player_id
    and created_at < now() - interval '7 days'
  );
