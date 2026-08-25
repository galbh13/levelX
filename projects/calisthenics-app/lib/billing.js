// Business layer — data access + all the money math.
// ─────────────────────────────────────────────────────────────────────────────
// Backed by `supabase/migrations/20260825_business_billing.sql`:
// `billing_plans`, `player_billing`, `payments`, `billing_settings`. All four are
// ADMIN-ONLY at the RLS level — every function here throws for a player.
//
// Two rules the rest of the app depends on:
//
//   1. Money is never derived from a plan price. `payments` is the truth of what
//      arrived; the plan only says what SHOULD arrive. Every "collected" number
//      comes from the ledger, every "expected" number from the plan, and the gap
//      between them is what you chase.
//   2. Currencies are never summed together. There is no FX rate in this app, so
//      every total is a `{ ILS, USD }` bag (see `emptyBag`). A coach with one
//      overseas client sees two lines, not one wrong number.

import { supabase } from './supabase';

// ─── Vocabulary ──────────────────────────────────────────────────────────────

export const CURRENCIES = [
  { key: 'ILS', symbol: '₪' },
  { key: 'USD', symbol: '$' },
];

export const SYMBOL = { ILS: '₪', USD: '$' };

// The DB check constraint still allows 'trial' so legacy rows keep working, but
// there is no trial in the offer any more, so it is not offered here. 'churned'
// stays the stored key for FINISHED — relabelling costs nothing, renaming the
// key would mean a migration and rewriting every old row.
export const STATUSES = [
  { key: 'active',  label: 'ACTIVE',   desc: 'Paying customer' },
  { key: 'paused',  label: 'PAUSED',   desc: 'Frozen — army / injury / travel. Not billed, not finished' },
  { key: 'churned', label: 'FINISHED', desc: 'No longer with you' },
];

// One plan, two price tags — not an FX conversion. The currency chosen on the
// player picks the line they pay.
export const PRICING = { ILS: 600, USD: 200 };

// What you sell today. Retired plan rows may still sit in `billing_plans` (and
// must, so historic players keep their link) — this is what the card offers now.
export const OFFERED_PLANS = ['STANDARD', 'FAMILY'];

// Where the customer came from. The single most useful analytics field here:
// after a dozen customers this tells you which channel produces the ones who stay.
// Four channels, because that is all there are: a person sent them (gym, friend,
// family, word of mouth all collapse to REFERRAL) or a feed did. Old rows may
// still hold retired keys — `labelOf` falls back to the raw key.
export const SOURCES = [
  { key: 'referral',  label: 'REFERRAL' },
  { key: 'instagram', label: 'INSTAGRAM' },
  { key: 'tiktok',    label: 'TIKTOK' },
  { key: 'youtube',   label: 'YOUTUBE' },
];

export const METHODS = [
  { key: 'bit',      label: 'BIT' },
  { key: 'paybox',   label: 'PAYBOX' },
  { key: 'cash',     label: 'CASH' },
  { key: 'transfer', label: 'TRANSFER' },
  { key: 'card',     label: 'CARD' },
  { key: 'paypal',   label: 'PAYPAL' },
  { key: 'other',    label: 'OTHER' },
];

// Coded, not free text — a code aggregates into "3 left over price", a paragraph
// aggregates into nothing.
export const CHURN_REASONS = [
  { key: 'price',        label: 'TOO EXPENSIVE' },
  { key: 'time',         label: 'NO TIME' },
  { key: 'injury',       label: 'INJURY' },
  { key: 'moved',        label: 'MOVED / TRAVEL' },
  { key: 'results',      label: 'UNHAPPY WITH RESULTS' },
  { key: 'ghosted',      label: 'GHOSTED' },
  { key: 'goal_reached', label: 'GOAL REACHED' },
  { key: 'other',        label: 'OTHER' },
];

// Everything is rolling monthly today. Kept for the day a 3/6/12-month
// commitment buys a discount — `termEnd` below already does that math.
export const TERMS = [
  { key: 1,  label: 'MONTHLY' },
  { key: 3,  label: '3 MONTHS' },
  { key: 6,  label: '6 MONTHS' },
  { key: 12, label: '12 MONTHS' },
];

export const labelOf = (list, key, fallback = '—') =>
  list.find((x) => String(x.key) === String(key))?.label ?? fallback;

// ─── Dates & money formatting ────────────────────────────────────────────────
// Everything here is plain YYYY-MM-DD strings — the DB columns are `date`, so a
// Date object would only re-introduce timezone drift.

export const todayISO = () => new Date().toISOString().slice(0, 10);

export const monthKey = (iso) => (iso ? String(iso).slice(0, 7) : null);

/** First + last day of the month containing `iso` (defaults to today). */
export function monthRange(iso = todayISO()) {
  const [y, m] = String(iso).split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return { start: `${y}-${mm}-01`, end: `${y}-${mm}-${String(last).padStart(2, '0')}` };
}

export function daysBetween(fromISO, toISO) {
  if (!fromISO || !toISO) return 0;
  const a = Date.parse(`${fromISO}T00:00:00Z`);
  const b = Date.parse(`${toISO}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86400000);
}

export const addDays = (iso, n) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** ₪400 · $50 · ₪1,250.50 — trailing .00 dropped, thousands grouped. */
export function money(amount, currency = 'ILS') {
  const n = Number(amount ?? 0);
  const sym = SYMBOL[currency] ?? '';
  const abs = Math.abs(n);
  const body = abs % 1 === 0
    ? abs.toLocaleString('en-US')
    : abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n < 0 ? '-' : ''}${sym}${body}`;
}

// ─── Currency bags ───────────────────────────────────────────────────────────
// A "bag" is `{ ILS: n, USD: n }`. Never collapse one to a single scalar.

export const emptyBag = () => ({ ILS: 0, USD: 0 });

export function bagAdd(bag, currency, amount) {
  const cur = currency === 'USD' ? 'USD' : 'ILS';
  bag[cur] += Number(amount ?? 0);
  return bag;
}

export const bagIsZero = (bag) => !bag || (!bag.ILS && !bag.USD);

/** "₪1,200 · $50" — only the currencies actually in play. Zero bag → "₪0". */
export function bagText(bag, fallbackCurrency = 'ILS') {
  if (!bag) return money(0, fallbackCurrency);
  const parts = [];
  if (bag.ILS) parts.push(money(bag.ILS, 'ILS'));
  if (bag.USD) parts.push(money(bag.USD, 'USD'));
  return parts.length ? parts.join(' · ') : money(0, fallbackCurrency);
}

// ─── Reads ───────────────────────────────────────────────────────────────────

export async function fetchSettings() {
  const { data, error } = await supabase.from('billing_settings').select('*').limit(1).maybeSingle();
  if (error) throw error;
  return data ?? { id: true, default_currency: 'ILS', grace_days: 7, lock_on_overdue: false };
}

export async function saveSettings(patch) {
  const { error } = await supabase
    .from('billing_settings')
    .upsert({ id: true, ...patch, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export async function fetchPlans({ includeInactive = true } = {}) {
  let q = supabase.from('billing_plans').select('*').order('order_index').order('name');
  if (!includeInactive) q = q.eq('active', true);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function savePlan(plan) {
  const { data, error } = await supabase.from('billing_plans').upsert(plan).select().single();
  if (error) throw error;
  return data;
}

export async function deletePlan(id) {
  const { error } = await supabase.from('billing_plans').delete().eq('id', id);
  if (error) throw error;
}

/** Every player's billing row, keyed by player_id. */
export async function fetchAllBilling() {
  const { data, error } = await supabase.from('player_billing').select('*');
  if (error) throw error;
  const map = {};
  (data ?? []).forEach((r) => { map[r.player_id] = r; });
  return map;
}

// ─── Contact details live on the PROFILE, not on the billing row ─────────────
// PHONE and BIRTHDAY are global: one number, one date per player, typed once on
// the ＋ NEW PLAYER form and shown wherever they're needed — the business card
// included. `player_billing.phone` / `player_billing.birthday` predate that and
// are legacy; nothing writes them anymore, and the migration backfilled whatever
// was already in them onto `profiles`.
//
// The READ swallows its errors on purpose: the live schema has drifted from
// migrations before, and a missing `profiles.birthday` must not be able to take
// the whole MONEY & MEMBERSHIP card down — blank fields are survivable, a screen
// that won't load is not. The WRITE does NOT swallow: a save that silently does
// nothing is worse than an error, because you only find out months later that
// the number you needed was never stored.
const CONTACT_FIELDS = ['phone', 'birthday'];

export async function fetchPlayerContact(playerId) {
  try {
    const { data, error } = await supabase
      .from('profiles').select('phone, birthday').eq('id', playerId).maybeSingle();
    if (error) throw error;
    return { phone: data?.phone ?? null, birthday: data?.birthday ?? null };
  } catch (e) {
    console.warn('[billing] fetchPlayerContact:', e?.message ?? e);
    return {};
  }
}

export async function savePlayerContact(playerId, contact) {
  // `.select()` on the update is the whole point of this call: PostgREST reports
  // an update that matched NO rows as a perfectly happy success, so without it an
  // RLS policy that hides other people's profiles looks identical to a save that
  // worked. Missing columns surface as a real error; a blocked row surfaces as an
  // empty array. Both have to be loud.
  const { data, error } = await supabase
    .from('profiles').update(contact).eq('id', playerId).select('id');
  if (error) {
    throw new Error(`Phone/birthday didn't save — ${error.message}`);
  }
  if (!data?.length) {
    throw new Error(
      "Phone/birthday didn't save — the profile row wasn't writable (row-level security).",
    );
  }
}

export async function fetchPlayerBilling(playerId) {
  const [{ data, error }, contact] = await Promise.all([
    supabase.from('player_billing').select('*').eq('player_id', playerId).maybeSingle(),
    fetchPlayerContact(playerId),
  ]);
  if (error) throw error;
  // The profile wins over whatever the legacy billing columns still hold.
  return data ? { ...data, ...contact } : null;
}

export async function savePlayerBilling(playerId, patch) {
  // Peel the contact details off — they belong to the profile, and the billing
  // row must not end up holding a second, divergent copy.
  const contact = {};
  const billing = { ...patch };
  CONTACT_FIELDS.forEach((k) => {
    if (k in billing) { contact[k] = billing[k]; delete billing[k]; }
  });

  // allSettled, not all: the two writes go to different tables and neither one
  // failing should throw away the other's result. The billing row is reported
  // first because it is the bigger loss.
  const [billed, contacted] = await Promise.allSettled([
    supabase
      .from('player_billing')
      .upsert({ player_id: playerId, ...billing, updated_at: new Date().toISOString() })
      .select()
      .single(),
    Object.keys(contact).length ? savePlayerContact(playerId, contact) : null,
  ]);

  if (billed.status === 'rejected') throw billed.reason;
  const { data, error } = billed.value;
  if (error) throw error;
  if (contacted.status === 'rejected') throw contacted.reason;

  return { ...data, ...contact };
}

/** Ledger rows. Omit `playerId` for the whole business. */
export async function fetchPayments({ playerId = null, since = null } = {}) {
  let q = supabase.from('payments').select('*');
  if (playerId) q = q.eq('player_id', playerId);
  if (since) q = q.or(`paid_at.gte.${since},due_at.gte.${since}`);
  const { data, error } = await q.order('paid_at', { ascending: false, nullsFirst: true });
  if (error) throw error;
  return data ?? [];
}

export async function addPayment(row) {
  const { data, error } = await supabase.from('payments').insert(row).select().single();
  if (error) throw error;
  return data;
}

export async function updatePayment(id, patch) {
  const { error } = await supabase.from('payments').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deletePayment(id) {
  const { error } = await supabase.from('payments').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Mark a pending charge as received. Kept as one helper because "paid" is two
 * facts — the status AND the date it landed — and forgetting the date silently
 * drops the row out of every month report.
 */
export async function markPaid(id, { paid_at = todayISO(), method = null } = {}) {
  const patch = { status: 'paid', paid_at };
  if (method) patch.method = method;
  await updatePayment(id, patch);
}

// ─── Money math ──────────────────────────────────────────────────────────────

/**
 * What this player actually pays per month: their override if set, otherwise
 * their plan. `free` covers family/comped — they are billed nothing, excluded
 * from ARPU, and never locked out.
 */
export function effectivePrice(billing, plan) {
  const free = !!plan?.is_free;
  const currency = billing?.currency_override || plan?.currency || 'ILS';
  // The currency IS the price tag (₪600 / $200) — there is no FX rate here. A
  // stored override still wins, so a special rate agreed in the past survives.
  const price = billing?.price_override != null
    ? Number(billing.price_override)
    : Number(PRICING[currency] ?? plan?.price ?? 0);
  return { price: free ? 0 : price, currency, free };
}

export const isPaused = (billing, today = todayISO()) =>
  billing?.status === 'paused' ||
  (!!billing?.paused_from && billing.paused_from <= today &&
   (!billing.paused_until || billing.paused_until >= today));

/** Counts toward MRR: still with you, not frozen, not comped. */
export const isBillable = (billing, plan, today = todayISO()) =>
  !!billing &&
  billing.status === 'active' &&
  !billing.ended_at &&
  !isPaused(billing, today) &&
  !effectivePrice(billing, plan).free;

/** Days with you — start → end, or start → today for a live customer. */
export function daysWith(billing, today = todayISO()) {
  if (!billing?.started_at) return 0;
  return Math.max(0, daysBetween(billing.started_at, billing.ended_at || today));
}

/** Next charge date from `billing_day`. NULL billing_day → null. */
export function nextBillingDate(billing, today = todayISO()) {
  const day = billing?.billing_day;
  if (!day || billing?.ended_at) return null;
  const [y, m] = today.split('-').map(Number);
  const dd = String(day).padStart(2, '0');
  const thisMonth = `${y}-${String(m).padStart(2, '0')}-${dd}`;
  if (thisMonth >= today) return thisMonth;
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-${dd}`;
}

/** Renewal date of a committed package (3/6/12-month term). */
export function termEnd(billing) {
  const months = Number(billing?.term_months ?? 0);
  const from = billing?.term_started_at || billing?.started_at;
  if (!months || months <= 1 || !from) return null;
  const [y, m, d] = from.split('-').map(Number);
  const total = m - 1 + months;
  const ny = y + Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

const signed = (p) => (p.kind === 'refund' ? -Math.abs(Number(p.amount)) : Number(p.amount));

/**
 * Everything the per-player money card shows, from that player's ledger alone.
 * `lifetime` is LTV — the number that tells you what a customer is really worth
 * and therefore how much a new one is worth acquiring.
 */
export function playerMoney(billing, plan, payments = [], today = todayISO()) {
  const { price, currency, free } = effectivePrice(billing, plan);
  const paid = payments.filter((p) => p.status === 'paid');
  const pending = payments.filter((p) => p.status === 'pending');
  const { start: mStart, end: mEnd } = monthRange(today);

  const lifetime = emptyBag();
  const thisMonth = emptyBag();
  const extras = emptyBag();
  paid.forEach((p) => {
    bagAdd(lifetime, p.currency, signed(p));
    if (p.paid_at && p.paid_at >= mStart && p.paid_at <= mEnd) bagAdd(thisMonth, p.currency, signed(p));
    if (p.kind === 'extra') bagAdd(extras, p.currency, signed(p));
  });

  const outstanding = emptyBag();
  let oldestDue = null;
  pending.forEach((p) => {
    bagAdd(outstanding, p.currency, Number(p.amount));
    if (p.due_at && (!oldestDue || p.due_at < oldestDue)) oldestDue = p.due_at;
  });

  const days = daysWith(billing, today);
  // Months are for a per-month average, so a 40-day customer must not divide by
  // 1.3 and look twice as valuable as they are — round UP to whole months paid.
  const months = Math.max(1, Math.ceil(days / 30.44));
  const avgPerMonth = emptyBag();
  ['ILS', 'USD'].forEach((c) => { avgPerMonth[c] = lifetime[c] / months; });

  const lastPaid = paid
    .filter((p) => p.paid_at)
    .sort((a, b) => (a.paid_at < b.paid_at ? 1 : -1))[0] ?? null;

  return {
    price, currency, free,
    days,
    months,
    lifetime,
    thisMonth,
    extras,
    outstanding,
    oldestDue,
    daysOverdue: oldestDue && oldestDue < today ? daysBetween(oldestDue, today) : 0,
    avgPerMonth,
    lastPaidAt: lastPaid?.paid_at ?? null,
    nextDue: nextBillingDate(billing, today),
    termEndsAt: termEnd(billing),
    mrr: isBillable(billing, plan, today) ? price : 0,
    paidThisMonth: !bagIsZero(thisMonth),
  };
}

/**
 * `ok` | `grace` | `locked` | `free` — the same rule the DB's `my_access_state()`
 * applies, computed client-side so the admin can SEE who would be locked before
 * ever switching enforcement on.
 */
export function accessState(billing, plan, payments, settings, today = todayISO()) {
  if (!billing || effectivePrice(billing, plan).free) return 'free';
  if (isPaused(billing, today) || billing.status === 'trial') return 'free';
  const overdue = payments
    .filter((p) => p.status === 'pending' && p.due_at && p.due_at < today)
    .map((p) => p.due_at)
    .sort()[0];
  if (!overdue) return 'ok';
  return daysBetween(overdue, today) > Number(settings?.grace_days ?? 7) ? 'locked' : 'grace';
}

/**
 * The whole-business roll-up behind the BUSINESS screen.
 *
 * `mrr`        — what SHOULD arrive each month from live paying customers
 * `collected`  — what DID arrive this month (ledger)
 * `outstanding`— pending charges not yet paid
 * `arpu`       — MRR ÷ paying customers
 * `avgLifespan`— mean days of the customers who have already left; the honest
 *                retention number (live customers can only inflate it)
 * `bySource`   — lifetime revenue + average lifespan per acquisition channel.
 *                This is the table that tells you where to spend your next hour.
 */
export function businessSummary({ players = [], billings = {}, plans = [], payments = [], today = todayISO() }) {
  const planById = {};
  plans.forEach((p) => { planById[p.id] = p; });
  const { start: mStart, end: mEnd } = monthRange(today);

  const mrr = emptyBag();
  const collected = emptyBag();
  const outstanding = emptyBag();
  const lifetimeAll = emptyBag();

  let active = 0, paying = 0, trial = 0, paused = 0, churned = 0, comped = 0, unset = 0;
  let churned90 = 0;
  const lifespans = [];
  const bySource = {};

  const payByPlayer = {};
  payments.forEach((p) => { (payByPlayer[p.player_id] ??= []).push(p); });

  payments.forEach((p) => {
    if (p.status === 'paid') {
      bagAdd(lifetimeAll, p.currency, signed(p));
      if (p.paid_at && p.paid_at >= mStart && p.paid_at <= mEnd) bagAdd(collected, p.currency, signed(p));
    } else if (p.status === 'pending') {
      bagAdd(outstanding, p.currency, Number(p.amount));
    }
  });

  players.forEach((pl) => {
    const b = billings[pl.id];
    if (!b) { unset += 1; return; }
    const plan = planById[b.plan_id];
    const { price, currency, free } = effectivePrice(b, plan);

    if (b.status === 'churned' || b.ended_at) {
      churned += 1;
      const span = daysWith(b, today);
      if (span > 0) lifespans.push(span);
      if (b.ended_at && daysBetween(b.ended_at, today) <= 90) churned90 += 1;
    } else if (isPaused(b, today)) {
      paused += 1;
    } else if (b.status === 'trial') {
      trial += 1;
    } else {
      active += 1;
      if (free) comped += 1;
      else { paying += 1; bagAdd(mrr, currency, price); }
    }

    // Revenue by acquisition channel — lifetime money and how long they lasted.
    const src = b.source || 'unknown';
    const bucket = (bySource[src] ??= { source: src, count: 0, revenue: emptyBag(), days: [] });
    bucket.count += 1;
    bucket.days.push(daysWith(b, today));
    (payByPlayer[pl.id] ?? []).forEach((p) => {
      if (p.status === 'paid') bagAdd(bucket.revenue, p.currency, signed(p));
    });
  });

  const arpu = emptyBag();
  if (paying > 0) ['ILS', 'USD'].forEach((c) => { arpu[c] = mrr[c] / paying; });

  const avgLifespan = lifespans.length
    ? Math.round(lifespans.reduce((a, b) => a + b, 0) / lifespans.length)
    : 0;

  // 90-day churn: of everyone who was on the books in the window, how many left.
  const churnRate = active + churned90 > 0
    ? Math.round((churned90 / (active + churned90)) * 100)
    : 0;

  const sources = Object.values(bySource)
    .map((s) => ({
      ...s,
      avgDays: s.days.length ? Math.round(s.days.reduce((a, b) => a + b, 0) / s.days.length) : 0,
    }))
    .sort((a, b) => (b.revenue.ILS + b.revenue.USD) - (a.revenue.ILS + a.revenue.USD));

  return {
    mrr, collected, outstanding, lifetimeAll, arpu,
    active, paying, comped, trial, paused, churned, unset,
    total: players.length,
    avgLifespan, churnRate, churned90,
    sources,
  };
}
