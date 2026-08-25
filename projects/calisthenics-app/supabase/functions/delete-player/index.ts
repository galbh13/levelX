// delete-player — the coach's "this account should never have existed" button.
//
// Called from PlayerAdminScreen's DANGER ZONE with the signed-in admin's JWT. It:
//   1. verifies the caller is a real, logged-in `role = 'admin'` profile,
//   2. refuses to delete the caller themselves or any other admin,
//   3. deletes the AUTH user — which cascades the whole player away.
//
// Deleting the auth user is enough on purpose. `profiles.id` references
// `auth.users(id) on delete cascade`, and every player-scoped table
// (checkups, checkup_answers, checkup_videos, coach_messages, community_*,
//  weekly_accessories, accessory_completions, workouts, player_billing,
//  payments, …) references `profiles(id) on delete cascade` in turn. So one
// call leaves nothing behind — which is the entire point: a tester or a
// blow-in who signed up and left must not keep skewing the BUSINESS numbers.
//
// That same cascade is why this is dangerous: deleting a REAL player erases
// their payment history with them. The app makes the admin type DELETE first.
//
// It needs the service-role key (only the admin API can delete an auth user),
// which is why it lives here and not in the bundle. Same auth model, same
// secrets and same deploy as `invite-player` — see supabase/functions/README.md.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

  // ── 1. Authorise: the caller must be a signed-in admin ────────────────────
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Not signed in.' }, 401);

  const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user: caller }, error: callerErr } = await asCaller.auth.getUser();
  if (callerErr || !caller) return json({ error: 'Not signed in.' }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  const { data: callerProfile } = await admin
    .from('profiles')
    .select('role')
    .eq('id', caller.id)
    .single();

  if (callerProfile?.role !== 'admin') {
    return json({ error: 'Admins only.' }, 403);
  }

  // ── 2. Validate the target ────────────────────────────────────────────────
  let body: { user_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Bad request body.' }, 400);
  }

  const userId = String(body.user_id ?? '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(userId)) {
    return json({ error: 'A player id is required.' }, 400);
  }

  // Deleting yourself would take the coach account (and every RLS override that
  // depends on it) down with it. Never, not even on purpose.
  if (userId === caller.id) {
    return json({ error: 'You cannot delete your own account.' }, 400);
  }

  const { data: target } = await admin
    .from('profiles')
    .select('id, email, full_name, role')
    .eq('id', userId)
    .maybeSingle();

  if (!target) return json({ error: 'No such player.' }, 404);
  if (target.role === 'admin') {
    return json({ error: 'Admin accounts cannot be deleted from the app.' }, 403);
  }

  // ── 3. Delete — the cascade does the rest ─────────────────────────────────
  const { error: delErr } = await admin.auth.admin.deleteUser(userId);
  if (delErr) return json({ error: delErr.message }, 400);

  return json({
    ok: true,
    user_id: userId,
    email: target.email ?? null,
    full_name: target.full_name ?? null,
  });
});
