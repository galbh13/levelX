-- Community — groups + per-group challenges
-- ─────────────────────────────────────────────────────────────────────────────
-- A COMMUNITY is built from GROUPS. A group is a small set of players (e.g. three
-- friends training together). Each group has its own CHALLENGES that only that
-- group's members see and compete on. A player can belong to MANY groups
-- (many-to-many via community_group_members).
--
-- The ADMIN owns the structure: they create groups, decide which players go in
-- each group (from the AdminDashboard → COMMUNITY), and author each group's
-- challenges. Players get a read-only COMMUNITY tab showing the groups they're in
-- and the challenges inside them.
--
-- First-cut scope: create/read groups, membership, and challenges. Deeper
-- mechanics (submissions, scoring, leaderboards) come later.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── community_groups — one row per group ────────────────────────────────────
create table if not exists public.community_groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  created_at  timestamptz not null default now()
);

-- ── community_group_members — a player's membership in a group (M:N) ─────────
create table if not exists public.community_group_members (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.community_groups(id) on delete cascade,
  player_id  uuid not null references public.profiles(id)         on delete cascade,
  created_at timestamptz not null default now(),
  unique (group_id, player_id)
);
create index if not exists community_members_group_idx  on public.community_group_members (group_id);
create index if not exists community_members_player_idx on public.community_group_members (player_id);

-- ── community_challenges — a challenge scoped to one group ───────────────────
create table if not exists public.community_challenges (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.community_groups(id) on delete cascade,
  title       text not null,
  description text,
  created_at  timestamptz not null default now()
);
create index if not exists community_challenges_group_idx on public.community_challenges (group_id);

-- ── Membership helper (SECURITY DEFINER, avoids RLS recursion) ───────────────
-- "Is the current user a member of this group?" — used by the member-read
-- policies. SECURITY DEFINER so it reads community_group_members without tripping
-- that table's own RLS (which would recurse).
create or replace function public.is_group_member(gid uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1
    from public.community_group_members m
    where m.group_id = gid
      and m.player_id = auth.uid()
  );
$$;

-- ── RLS — admin manages everything; members read their own groups ────────────
alter table public.community_groups        enable row level security;
alter table public.community_group_members enable row level security;
alter table public.community_challenges     enable row level security;

-- groups: admin full CRUD; a member may read the groups they belong to.
drop policy if exists "admin all community groups" on public.community_groups;
create policy "admin all community groups"
  on public.community_groups for all to authenticated
  using ( public.is_admin() ) with check ( public.is_admin() );

drop policy if exists "member read community groups" on public.community_groups;
create policy "member read community groups"
  on public.community_groups for select to authenticated
  using ( public.is_group_member(id) );

-- membership: admin full CRUD; a member may read all membership rows of any group
-- they belong to (so they can see who their fellow members are).
drop policy if exists "admin all community members" on public.community_group_members;
create policy "admin all community members"
  on public.community_group_members for all to authenticated
  using ( public.is_admin() ) with check ( public.is_admin() );

drop policy if exists "member read community members" on public.community_group_members;
create policy "member read community members"
  on public.community_group_members for select to authenticated
  using ( public.is_group_member(group_id) );

-- challenges: admin full CRUD; a member may read the challenges of their groups.
drop policy if exists "admin all community challenges" on public.community_challenges;
create policy "admin all community challenges"
  on public.community_challenges for all to authenticated
  using ( public.is_admin() ) with check ( public.is_admin() );

drop policy if exists "member read community challenges" on public.community_challenges;
create policy "member read community challenges"
  on public.community_challenges for select to authenticated
  using ( public.is_group_member(group_id) );

-- ── Let group members read each other's profile (name) ──────────────────────
-- profiles' base policy is owner-only (`auth.uid() = id`), so a player could not
-- read a co-member's name to display in the group. This ADDITIVE policy grants a
-- player SELECT on the profile rows of anyone they share a group with. The
-- SECURITY DEFINER helper checks the shared-group link without recursing through
-- community_group_members' own RLS. (Permissive policies are OR'd, so nobody
-- loses access — admins + owners keep theirs.)
create or replace function public.shares_group_with(other uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1
    from public.community_group_members a
    join public.community_group_members b on a.group_id = b.group_id
    where a.player_id = auth.uid()
      and b.player_id = other
  );
$$;

drop policy if exists "read co-member profiles" on public.profiles;
create policy "read co-member profiles"
  on public.profiles for select to authenticated
  using ( public.shares_group_with(id) );
