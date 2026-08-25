-- Community — group RAIDS + leaderboard read access
-- ─────────────────────────────────────────────────────────────────────────────
-- Two additions to the community system:
--
-- 1. RAIDS — a group-wide shared goal the whole group fills TOGETHER. The admin
--    authors a raid with a numeric TARGET and a UNIT (e.g. "1000 pushups").
--    Every member logs the amount THEY did; all contributions sum into one
--    collective progress bar. Unlike a challenge (a per-member checkbox), a raid
--    is a single pooled counter — the "raid boss" the squad chips down together.
--
-- 2. LEADERBOARD read access — the player group screen ranks members by class
--    tier then LVL. LVL is computed from `student_quest_completions`, which is
--    owner-only RLS, so a member cannot read a co-member's completions to rank
--    them. This adds an ADDITIVE select policy letting group co-members read each
--    other's completions (same shape as the existing `read co-member profiles`
--    policy from 20260717_community.sql).
--
-- Additive to 20260717_community.sql + 20260718_community_challenge_completions.sql
-- (both must already be applied — this reuses their is_group_member /
-- shares_group_with / is_admin helpers).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── community_raids — one shared, pooled goal for a group ────────────────────
create table if not exists public.community_raids (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.community_groups(id) on delete cascade,
  title       text not null,
  unit        text,                                   -- e.g. 'pushups', 'reps', 'km' (nullable)
  target      integer not null check (target > 0),    -- the collective goal
  description text,
  created_at  timestamptz not null default now()
);
create index if not exists community_raids_group_idx on public.community_raids (group_id);

-- ── community_raid_contributions — append-only log of "I did N toward it" ────
-- Each row is one increment a member logged. Progress = sum(amount) over a raid;
-- a member's personal share = sum(amount) filtered to that player. Append-only
-- (never updated) so the group can see each drop of effort as it lands.
create table if not exists public.community_raid_contributions (
  id         uuid primary key default gen_random_uuid(),
  raid_id    uuid not null references public.community_raids(id) on delete cascade,
  player_id  uuid not null references public.profiles(id)        on delete cascade,
  amount     integer not null check (amount > 0),
  created_at timestamptz not null default now()
);
create index if not exists community_raid_contrib_raid_idx   on public.community_raid_contributions (raid_id);
create index if not exists community_raid_contrib_player_idx on public.community_raid_contributions (player_id);

-- ── RLS — admin authors; members read their group's raids + log their own ────
alter table public.community_raids               enable row level security;
alter table public.community_raid_contributions  enable row level security;

-- raids: admin full CRUD; a member may read the raids of groups they belong to.
drop policy if exists "admin all community raids" on public.community_raids;
create policy "admin all community raids"
  on public.community_raids for all to authenticated
  using ( public.is_admin() ) with check ( public.is_admin() );

drop policy if exists "member read community raids" on public.community_raids;
create policy "member read community raids"
  on public.community_raids for select to authenticated
  using ( public.is_group_member(group_id) );

-- contributions: a member of the raid's group may READ every contribution (so the
-- whole squad's pooled progress + per-member breakdown is visible). The raid's
-- group_id is looked up via subquery; is_group_member is SECURITY DEFINER so it
-- doesn't recurse through membership RLS.
drop policy if exists "member read raid contributions" on public.community_raid_contributions;
create policy "member read raid contributions"
  on public.community_raid_contributions for select to authenticated
  using (
    public.is_group_member(
      (select r.group_id from public.community_raids r where r.id = raid_id)
    )
  );

-- A player may only log their OWN contribution, and only into a raid of a group
-- they belong to.
drop policy if exists "member log own raid contributions" on public.community_raid_contributions;
create policy "member log own raid contributions"
  on public.community_raid_contributions for all to authenticated
  using ( auth.uid() = player_id )
  with check (
    auth.uid() = player_id
    and public.is_group_member(
      (select r.group_id from public.community_raids r where r.id = raid_id)
    )
  );

-- Admins may read/manage all contributions (oversight).
drop policy if exists "admin all raid contributions" on public.community_raid_contributions;
create policy "admin all raid contributions"
  on public.community_raid_contributions for all to authenticated
  using ( public.is_admin() ) with check ( public.is_admin() );

-- ── Leaderboard — let group co-members read each other's quest completions ───
-- `student_quest_completions` base RLS is owner-only (`auth.uid() = student_id`)
-- plus an admin override. The group leaderboard computes every member's LVL from
-- these rows, so a member needs to read co-members' completions. ADDITIVE select
-- policy (permissive policies are OR'd — owners/admins keep their access), gated
-- by the same shares_group_with helper the co-member profile policy uses.
drop policy if exists "read co-member quest completions" on public.student_quest_completions;
create policy "read co-member quest completions"
  on public.student_quest_completions for select to authenticated
  using ( public.shares_group_with(student_id) );
