-- Community — per-member challenge completions
-- ─────────────────────────────────────────────────────────────────────────────
-- Each group member can mark that THEY personally did a challenge. This is the
-- competitive core: on a challenge card every member shows a check, and you can
-- tick your own off. One row per (challenge, player); ticking off deletes it.
--
-- Additive to 20260717_community.sql (which must already be applied).
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.community_challenge_completions (
  id           uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.community_challenges(id) on delete cascade,
  player_id    uuid not null references public.profiles(id)             on delete cascade,
  created_at   timestamptz not null default now(),
  unique (challenge_id, player_id)
);
create index if not exists community_completions_challenge_idx on public.community_challenge_completions (challenge_id);
create index if not exists community_completions_player_idx    on public.community_challenge_completions (player_id);

alter table public.community_challenge_completions enable row level security;

-- Members of the challenge's group may READ every completion (so everyone sees
-- who in the group has done it). Gated by is_group_member on the challenge's
-- group (looked up via subquery — SECURITY DEFINER helper avoids RLS recursion).
drop policy if exists "member read challenge completions" on public.community_challenge_completions;
create policy "member read challenge completions"
  on public.community_challenge_completions for select to authenticated
  using (
    public.is_group_member(
      (select c.group_id from public.community_challenges c where c.id = challenge_id)
    )
  );

-- A player may only create/remove their OWN completion.
drop policy if exists "owner write challenge completions" on public.community_challenge_completions;
create policy "owner write challenge completions"
  on public.community_challenge_completions for all to authenticated
  using ( auth.uid() = player_id )
  with check ( auth.uid() = player_id );

-- Admins may read/manage all (oversight).
drop policy if exists "admin all challenge completions" on public.community_challenge_completions;
create policy "admin all challenge completions"
  on public.community_challenge_completions for all to authenticated
  using ( public.is_admin() ) with check ( public.is_admin() );
