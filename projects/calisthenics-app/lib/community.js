import { supabase } from './supabase';
import { computeLvlFromData } from './computeLvl';
import { DEFAULT_JOB } from './jobs';

// Local midnight (start of today) as an ISO instant — the cutoff for "today's"
// challenges. A challenge is live ONLY on the calendar day it was created (until
// local midnight 00:00), so player-facing reads filter with `created_at >= this`.
export function startOfTodayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

// Community helpers — groups, membership, and per-group challenges.
// A group is a small set of players; each group has its own challenges that only
// its members see. Admins own the structure (create groups, set members, author
// challenges); players read the groups they belong to. See DATABASE.md
// "community_groups" / "community_group_members" / "community_challenges" and the
// migration 20260717_community.sql.

// ── Player side ──────────────────────────────────────────────────────────────

// The groups the signed-in player belongs to, each annotated with its member +
// challenge counts (for the group cards). RLS scopes reads to the player's own
// groups, so a plain select returns exactly what they may see.
export async function fetchMyGroups() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: memberships } = await supabase
    .from('community_group_members')
    .select('group_id')
    .eq('player_id', user.id);

  const groupIds = (memberships ?? []).map(m => m.group_id);
  if (groupIds.length === 0) return [];

  // Challenge counts are TODAY-only for players — a challenge is live only on its
  // creation day, so the group card should reflect what's actually active now.
  const [groupsRes, membersRes, challengesRes] = await Promise.all([
    supabase.from('community_groups').select('*').in('id', groupIds).order('created_at', { ascending: true }),
    supabase.from('community_group_members').select('group_id').in('group_id', groupIds),
    supabase.from('community_challenges').select('group_id').in('group_id', groupIds).gte('created_at', startOfTodayISO()),
  ]);

  return annotate(groupsRes.data ?? [], membersRes.data ?? [], challengesRes.data ?? []);
}

// ── Admin side ───────────────────────────────────────────────────────────────

// Every group (admin oversight), annotated with member + challenge counts.
export async function fetchAllGroups() {
  const [groupsRes, membersRes, challengesRes] = await Promise.all([
    supabase.from('community_groups').select('*').order('created_at', { ascending: true }),
    supabase.from('community_group_members').select('group_id'),
    supabase.from('community_challenges').select('group_id'),
  ]);
  return annotate(groupsRes.data ?? [], membersRes.data ?? [], challengesRes.data ?? []);
}

export async function createGroup(name, description) {
  const { data, error } = await supabase
    .from('community_groups')
    .insert({ name: name.trim(), description: (description ?? '').trim() || null })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateGroup(groupId, fields) {
  const { error } = await supabase.from('community_groups').update(fields).eq('id', groupId);
  if (error) throw error;
}

export async function deleteGroup(groupId) {
  // Members + challenges cascade-delete with the group.
  const { error } = await supabase.from('community_groups').delete().eq('id', groupId);
  if (error) throw error;
}

// The player_ids currently in a group (used by the admin member picker).
export async function fetchGroupMemberIds(groupId) {
  const { data } = await supabase
    .from('community_group_members')
    .select('player_id')
    .eq('group_id', groupId);
  return (data ?? []).map(m => m.player_id);
}

// The full member profiles of a group (used to display "who's in the group").
export async function fetchGroupMembers(groupId) {
  const { data } = await supabase
    .from('community_group_members')
    .select('player_id, profiles ( id, full_name )')
    .eq('group_id', groupId);
  return (data ?? []).map(r => r.profiles).filter(Boolean);
}

// Add / remove a single player from a group (admin toggles the member picker).
export async function addMember(groupId, playerId) {
  const { error } = await supabase
    .from('community_group_members')
    .insert({ group_id: groupId, player_id: playerId });
  if (error && error.code !== '23505') throw error; // ignore duplicate membership
}

export async function removeMember(groupId, playerId) {
  const { error } = await supabase
    .from('community_group_members')
    .delete()
    .eq('group_id', groupId)
    .eq('player_id', playerId);
  if (error) throw error;
}

// ── Challenges ───────────────────────────────────────────────────────────────

// `todayOnly` restricts to challenges created on the current calendar day (the
// player view — a challenge is only live until midnight). Admin authoring passes
// no flag so it can still see/delete everything.
export async function fetchGroupChallenges(groupId, { todayOnly = false } = {}) {
  let q = supabase.from('community_challenges').select('*').eq('group_id', groupId);
  if (todayOnly) q = q.gte('created_at', startOfTodayISO());
  const { data } = await q.order('created_at', { ascending: false });
  return data ?? [];
}

// The created_at of the newest TODAY challenge across the player's groups (or
// null). Drives the Community tab "new challenge" badge — compared against a
// locally stored last-seen time. Today-only so an expired challenge never badges.
export async function latestChallengeAt() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: memberships } = await supabase
    .from('community_group_members').select('group_id').eq('player_id', user.id);
  const groupIds = (memberships ?? []).map(m => m.group_id);
  if (groupIds.length === 0) return null;
  const { data } = await supabase
    .from('community_challenges')
    .select('created_at')
    .in('group_id', groupIds)
    .gte('created_at', startOfTodayISO())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.created_at ?? null;
}

export async function createChallenge(groupId, title, description) {
  const { data, error } = await supabase
    .from('community_challenges')
    .insert({ group_id: groupId, title: title.trim(), description: (description ?? '').trim() || null })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteChallenge(challengeId) {
  const { error } = await supabase.from('community_challenges').delete().eq('id', challengeId);
  if (error) throw error;
}

// ── Challenge completions (per member) ───────────────────────────────────────

// Who has done which challenge — returns { [challenge_id]: [player_id, …] } for
// the given challenge ids. Group members may read every member's completions.
export async function fetchCompletionsByChallenge(challengeIds) {
  if (!challengeIds || challengeIds.length === 0) return {};
  const { data } = await supabase
    .from('community_challenge_completions')
    .select('challenge_id, player_id')
    .in('challenge_id', challengeIds);
  const map = {};
  (data ?? []).forEach(r => {
    (map[r.challenge_id] ??= []).push(r.player_id);
  });
  return map;
}

// Mark / unmark the signed-in player's completion of a challenge. A player may
// only write their OWN completion (RLS enforces `auth.uid() = player_id`).
export async function setChallengeCompletion(challengeId, playerId, done) {
  if (done) {
    const { error } = await supabase
      .from('community_challenge_completions')
      .insert({ challenge_id: challengeId, player_id: playerId });
    if (error && error.code !== '23505') throw error; // ignore already-marked
  } else {
    const { error } = await supabase
      .from('community_challenge_completions')
      .delete()
      .eq('challenge_id', challengeId)
      .eq('player_id', playerId);
    if (error) throw error;
  }
}

// ── Leaderboard (class tier, then LVL) ───────────────────────────────────────

// Rank a group's members for the leaderboard: primarily by CLASS tier (the
// class's `order_index` — how many classes they've climbed), then by LVL (Σ
// `lvl_reward` of completed quests in their class), then name. Reads co-members'
// profiles (class/job) and their quest completions — both allowed by the
// `shares_group_with` policies (see 20260720_community_raids_and_leaderboard.sql).
// NOTE: `order_index` restarts per job, so a raw tier compare across DIFFERENT
// jobs is only an approximation of "who's further" — fine for a first-cut board.
export async function fetchGroupLeaderboard(groupId) {
  const { data: memberRows } = await supabase
    .from('community_group_members')
    .select('profiles ( id, full_name, class_id, job )')
    .eq('group_id', groupId);
  const members = (memberRows ?? []).map(r => r.profiles).filter(Boolean);
  if (members.length === 0) return [];

  const classIds  = [...new Set(members.map(m => m.class_id).filter(Boolean))];
  const memberIds = members.map(m => m.id);

  const [classesRes, questsRes, completionsRes] = await Promise.all([
    classIds.length
      ? supabase.from('classes').select('id, name, order_index, job').in('id', classIds)
      : Promise.resolve({ data: [] }),
    classIds.length
      ? supabase.from('class_quests').select('id, class_id, lvl_reward, chain').in('class_id', classIds)
      : Promise.resolve({ data: [] }),
    supabase.from('student_quest_completions').select('student_id, quest_id').in('student_id', memberIds),
  ]);

  const classById     = new Map((classesRes.data ?? []).map(c => [c.id, c]));
  const questsByClass  = {};
  (questsRes.data ?? []).forEach(q => { (questsByClass[q.class_id] ??= []).push(q); });
  const doneByPlayer   = {};
  (completionsRes.data ?? []).forEach(c => { (doneByPlayer[c.student_id] ??= new Set()).add(c.quest_id); });

  const rows = members.map(m => {
    const cls = classById.get(m.class_id) ?? null;
    return {
      id:         m.id,
      name:       m.full_name || '(no name)',
      className:  cls?.name ?? '—',
      orderIndex: cls?.order_index ?? 0,
      job:        cls?.job ?? m.job ?? DEFAULT_JOB,
      lvl:        computeLvlFromData(questsByClass[m.class_id] ?? [], doneByPlayer[m.id] ?? new Set()),
    };
  });

  rows.sort((a, b) =>
    (b.orderIndex - a.orderIndex) || (b.lvl - a.lvl) || a.name.localeCompare(b.name));
  return rows;
}

// ── Group challenge streak ───────────────────────────────────────────────────

// The group's CHALLENGE streak: each challenge the WHOLE group cleared adds +1;
// a challenge that expired with anyone missing resets it to 0.
//
// A challenge is "settled" 24h after it was created — that's the safe upper bound
// for the LATEST local midnight across every timezone on earth, so every member's
// own day is guaranteed over by then (each member can only tick during their own
// local day; nobody borrows another zone's extra hours). Before 24h a
// not-yet-fully-cleared challenge is PENDING (undecided), not a miss.
//   • CLEARED  — every eligible member completed it  → streak += 1 (counts LIVE,
//                the instant the last member ticks, even within the 24h window)
//   • BROKEN   — settled (≥24h old) and someone missed → streak resets to 0
//   • PENDING  — <24h old and not everyone's done yet → doesn't count or break
// "Eligible" = members who were in the group when the challenge was posted, so a
// newly-added member can't retroactively break old challenges they never saw.
// Returns { streak, pending } (pending = today's in-flight challenges).
const STREAK_SETTLE_MS = 24 * 60 * 60 * 1000;

export async function fetchGroupStreak(groupId) {
  const [membersRes, challengesRes] = await Promise.all([
    supabase.from('community_group_members').select('player_id, created_at').eq('group_id', groupId),
    supabase.from('community_challenges').select('id, created_at').eq('group_id', groupId)
      .order('created_at', { ascending: true }),
  ]);
  const members    = membersRes.data ?? [];
  const challenges = challengesRes.data ?? [];
  if (members.length === 0 || challenges.length === 0) return { streak: 0, pending: 0 };

  const completions = await fetchCompletionsByChallenge(challenges.map(c => c.id));
  const now = Date.now();

  let streak = 0;
  let pending = 0;
  for (const ch of challenges) {
    const created  = new Date(ch.created_at).getTime();
    const eligible = members.filter(m => new Date(m.created_at).getTime() <= created);
    if (eligible.length === 0) continue; // challenge predates every current member

    const doneSet = new Set(completions[ch.id] ?? []);
    const allDone = eligible.every(m => doneSet.has(m.player_id));

    if (allDone)                              streak += 1;   // CLEARED (live)
    else if (now - created >= STREAK_SETTLE_MS) streak = 0;  // BROKEN
    else                                       pending += 1; // PENDING
  }
  return { streak, pending };
}

// ── Raids (a group-wide shared, pooled goal) ─────────────────────────────────

// A group's raids, each annotated with the pooled `total` and a `byPlayer` map
// (player_id → their summed contribution). Newest raid first.
export async function fetchGroupRaids(groupId) {
  const { data: raids } = await supabase
    .from('community_raids').select('*').eq('group_id', groupId)
    .order('created_at', { ascending: false });
  if (!raids || raids.length === 0) return [];

  const { data: contribs } = await supabase
    .from('community_raid_contributions')
    .select('raid_id, player_id, amount')
    .in('raid_id', raids.map(r => r.id));

  const byRaid = {};
  (contribs ?? []).forEach(c => {
    const r = (byRaid[c.raid_id] ??= { total: 0, byPlayer: {} });
    r.total += c.amount;
    r.byPlayer[c.player_id] = (r.byPlayer[c.player_id] ?? 0) + c.amount;
  });

  return raids.map(r => ({
    ...r,
    total:    byRaid[r.id]?.total ?? 0,
    byPlayer: byRaid[r.id]?.byPlayer ?? {},
  }));
}

export async function createRaid(groupId, { title, target, unit, description }) {
  const goal = parseInt(target, 10);
  if (!Number.isFinite(goal) || goal <= 0) throw new Error('Raid target must be a positive number.');
  const { data, error } = await supabase
    .from('community_raids')
    .insert({
      group_id:    groupId,
      title:       title.trim(),
      target:      goal,
      unit:        (unit ?? '').trim() || null,
      description: (description ?? '').trim() || null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteRaid(raidId) {
  // Contributions cascade-delete with the raid.
  const { error } = await supabase.from('community_raids').delete().eq('id', raidId);
  if (error) throw error;
}

// Log an increment toward a raid (the signed-in player's OWN contribution).
export async function addRaidContribution(raidId, playerId, amount) {
  const n = parseInt(amount, 10);
  if (!Number.isFinite(n) || n <= 0) return;
  const { error } = await supabase
    .from('community_raid_contributions')
    .insert({ raid_id: raidId, player_id: playerId, amount: n });
  if (error) throw error;
}

// ── Chat (per-group, ephemeral) ──────────────────────────────────────────────

// Messages are kept only this long, then swept by purgeExpiredMessages(). No
// long history — the table stays tiny (see migration 20260721_community_chat.sql).
export const CHAT_RETENTION_DAYS = 7;

// A group's chat, oldest→newest, capped at the most recent MESSAGE_LIMIT. Cheap
// enough to poll every few seconds while the chat is open (member-read RLS scopes
// it to the caller's groups). Sender names are resolved by the screen from the
// group's member list, so this returns just the raw rows.
const MESSAGE_LIMIT = 100;

export async function fetchGroupMessages(groupId) {
  if (!groupId) return [];
  const { data } = await supabase
    .from('community_messages')
    .select('id, player_id, body, created_at')
    .eq('group_id', groupId)
    .order('created_at', { ascending: false })
    .limit(MESSAGE_LIMIT);
  // Fetched newest-first (so the LIMIT keeps the latest), returned oldest-first
  // for natural top→bottom chat rendering.
  return (data ?? []).reverse();
}

// Post a message as the signed-in player (RLS enforces auth.uid() = player_id and
// group membership). Empty/whitespace bodies are ignored; long ones are clamped
// to the 1000-char DB limit.
export async function sendMessage(groupId, playerId, body) {
  const text = (body ?? '').trim();
  if (!groupId || !playerId || !text) return null;
  const { data, error } = await supabase
    .from('community_messages')
    .insert({ group_id: groupId, player_id: playerId, body: text.slice(0, 1000) })
    .select('id, player_id, body, created_at')
    .single();
  if (error) throw error;
  return data;
}

// Delete a message. A player may unsend their OWN; an admin may delete any (both
// allowed by RLS — the caller decides which to offer).
export async function deleteMessage(messageId) {
  const { error } = await supabase.from('community_messages').delete().eq('id', messageId);
  if (error) throw error;
}

// Sweep messages older than the retention window for a group. Runs client-side on
// chat load (matches the check-up purge philosophy) — the additive "member purge
// expired community messages" policy lets any member delete their group's expired
// rows without a service role. Best-effort: failures are swallowed.
export async function purgeExpiredMessages(groupId) {
  if (!groupId) return;
  const cutoff = new Date(Date.now() - CHAT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  try {
    await supabase
      .from('community_messages')
      .delete()
      .eq('group_id', groupId)
      .lt('created_at', cutoff);
  } catch (e) {
    console.error('[community] purgeExpiredMessages:', e);
  }
}
