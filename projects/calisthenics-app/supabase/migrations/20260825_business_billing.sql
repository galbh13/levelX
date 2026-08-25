-- Business layer — plans, per-player billing lifecycle, and the money ledger
-- ─────────────────────────────────────────────────────────────────────────────
-- The app had no commercial data at all: `profiles` is pure training. This adds
-- the coach's BUSINESS side, and it is **admin-only** — no player may read any of
-- it (the one exception is `public.my_access_state()` at the bottom, which tells a
-- player whether their account is locked WITHOUT leaking a single number).
--
-- Four tables:
--   billing_plans    — the price list (Standard / Family-free)
--   player_billing   — one row per player: dates, plan, acquisition, churn
--   payments         — the LEDGER. Every shekel/dollar in or out, one row each.
--   billing_settings — one-row global config (grace days, lock switch, currency)
--
-- Money is NEVER derived from the plan price. The plan says what SHOULD arrive;
-- `payments` says what DID. Reporting is the gap between the two — that's what
-- keeps "how much did I make in June" answerable after a price change.
--
-- Safe to re-run: create-if-not-exists + drop-policy-if-exists throughout.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── billing_plans ────────────────────────────────────────────────────────────
create table if not exists public.billing_plans (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  price          numeric(10,2) not null default 0,
  -- Both currencies live side by side: an Israeli client is billed in ILS, an
  -- overseas one in USD. Aggregates are always reported PER CURRENCY (never
  -- summed across) since there is no FX rate anywhere in the app.
  currency       text not null default 'ILS' check (currency in ('ILS','USD')),
  -- `is_free` is a first-class flag, not price = 0: family/comped players must be
  -- excluded from ARPU, never chased for money and never locked out — which a
  -- plain zero price cannot express.
  is_free        boolean not null default false,
  sessions_per_week smallint,
  description    text,
  active         boolean not null default true,
  order_index    integer not null default 0,
  created_at     timestamptz not null default now()
);

-- ── player_billing ───────────────────────────────────────────────────────────
-- One row per player. No row = never commercially onboarded (roster shows UNSET).
create table if not exists public.player_billing (
  player_id      uuid primary key references public.profiles(id) on delete cascade,

  -- Lifecycle. `started_at` is when they started TRAINING with you — not
  -- profiles.created_at, since the account can predate the deal or follow it.
  started_at     date,
  ended_at       date,                       -- NULL = still with you
  status         text not null default 'trial'
                 check (status in ('trial','active','paused','churned')),

  -- Freeze window. A paused player is not churned and owes nothing for the
  -- window — without this a 6-week army/injury freeze reads as a lost customer
  -- and every retention number lies.
  paused_from    date,
  paused_until   date,

  -- Money
  plan_id        uuid references public.billing_plans(id) on delete set null,
  price_override numeric(10,2),              -- this player pays a special rate
  currency_override text check (currency_override in ('ILS','USD')),
  billing_day    smallint check (billing_day between 1 and 28),  -- 28 max: every month has it
  term_months    smallint,                   -- NULL/1 = rolling monthly, 3/6/12 = package
  term_started_at date,

  -- Auto-pay / provider linkage. Filled in once a real payment provider is
  -- connected; its webhook then writes `payments` rows keyed by provider_ref.
  auto_pay       boolean not null default false,
  provider       text,
  provider_customer_id     text,
  provider_subscription_id text,

  -- Acquisition — the highest-value analytics field here. Which channel produces
  -- the customers who STAY is only knowable if it was recorded on day one.
  source         text,                       -- instagram / referral / gym / friend / other
  referred_by    uuid references public.profiles(id) on delete set null,

  -- Relationship
  goal           text,                       -- why they came — drives the upsell conversation
  phone          text,
  birthday       date,
  medical_notes  text,

  -- Exit. Coded reason (not free text) so it aggregates; the note is the colour.
  churn_reason   text check (churn_reason in
                   ('price','time','injury','moved','results','ghosted','goal_reached','other')),
  churn_note     text,

  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists player_billing_status_idx on public.player_billing (status);

-- ── payments ─────────────────────────────────────────────────────────────────
-- The ledger. One row per money event.
--   status 'pending' + due_at  = an expected charge that hasn't landed — this is
--                                what drives OUTSTANDING and the lock gate
--   status 'paid'    + paid_at = money actually received
--   kind   'extra'             = one-off (session, program, gear) — the upsell track
--   kind   'refund'            = negative amount
create table if not exists public.payments (
  id             uuid primary key default gen_random_uuid(),
  player_id      uuid not null references public.profiles(id) on delete cascade,
  amount         numeric(10,2) not null,
  currency       text not null default 'ILS' check (currency in ('ILS','USD')),
  kind           text not null default 'subscription'
                 check (kind in ('subscription','extra','refund')),
  label          text,                       -- for extras: "1-on-1 session"
  status         text not null default 'paid'
                 check (status in ('paid','pending','failed','refunded')),
  paid_at        date,
  due_at         date,
  -- Which month this covers. Kept separate from paid_at: a late payment belongs
  -- to the month it BUYS, not the day it happened to arrive.
  period_start   date,
  period_end     date,
  method         text,                       -- cash / bit / paybox / transfer / card
  provider       text,
  provider_ref   text,                       -- provider's txn id — webhook idempotency
  auto           boolean not null default false,   -- true = machine-recorded, not typed by hand
  note           text,
  created_at     timestamptz not null default now()
);

create index if not exists payments_player_idx  on public.payments (player_id);
create index if not exists payments_paid_at_idx on public.payments (paid_at);
create index if not exists payments_status_idx  on public.payments (status);
-- A provider may retry a webhook; the same transaction must never book twice.
create unique index if not exists payments_provider_ref_uidx
  on public.payments (provider, provider_ref)
  where provider_ref is not null;

-- ── billing_settings ─────────────────────────────────────────────────────────
-- Exactly one row, forced by the `id` check constraint.
create table if not exists public.billing_settings (
  id               boolean primary key default true check (id),
  default_currency text not null default 'ILS' check (default_currency in ('ILS','USD')),
  grace_days       smallint not null default 7,     -- how long a due charge may sit unpaid
  lock_on_overdue  boolean not null default false,  -- OFF until a provider feeds the ledger
  business_name    text,
  updated_at       timestamptz not null default now()
);

insert into public.billing_settings (id) values (true) on conflict (id) do nothing;

-- Seed the price list only on a virgin install (never clobber real plans).
insert into public.billing_plans (name, price, currency, is_free, order_index, description)
select * from (values
  ('STANDARD', 600.00, 'ILS', false, 1, 'Monthly coaching — ₪600 / $200'),
  ('FAMILY',     0.00, 'ILS', true,  8, 'Family / comped — never billed, never locked')
) as v(name, price, currency, is_free, order_index, description)
where not exists (select 1 from public.billing_plans);

-- ── RLS — admin only, all four tables ────────────────────────────────────────
alter table public.billing_plans    enable row level security;
alter table public.player_billing   enable row level security;
alter table public.payments         enable row level security;
alter table public.billing_settings enable row level security;

drop policy if exists "admin all billing plans" on public.billing_plans;
create policy "admin all billing plans" on public.billing_plans
  for all to authenticated using ( public.is_admin() ) with check ( public.is_admin() );

drop policy if exists "admin all player billing" on public.player_billing;
create policy "admin all player billing" on public.player_billing
  for all to authenticated using ( public.is_admin() ) with check ( public.is_admin() );

drop policy if exists "admin all payments" on public.payments;
create policy "admin all payments" on public.payments
  for all to authenticated using ( public.is_admin() ) with check ( public.is_admin() );

drop policy if exists "admin all billing settings" on public.billing_settings;
create policy "admin all billing settings" on public.billing_settings
  for all to authenticated using ( public.is_admin() ) with check ( public.is_admin() );

-- ── The access gate ──────────────────────────────────────────────────────────
-- The ONLY billing fact a player may learn about themselves: is my account open?
-- SECURITY DEFINER so it can read the admin-only tables, but it returns a bare
-- state string — no price, no dates, no amount owed. The app can gate on this
-- later without ever exposing the business layer to the client bundle.
--
--   'ok'     — nothing overdue (or locking is off, or they're free/paused/trial)
--   'grace'  — a charge is past due but still inside the grace window
--   'locked' — past due beyond grace AND lock_on_overdue is on
create or replace function public.my_access_state()
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_grace  smallint;
  v_lock   boolean;
  v_status text;
  v_free   boolean;
  v_oldest date;
begin
  select grace_days, lock_on_overdue into v_grace, v_lock from billing_settings limit 1;
  if not coalesce(v_lock, false) then return 'ok'; end if;

  select pb.status, coalesce(bp.is_free, false)
    into v_status, v_free
    from player_billing pb
    left join billing_plans bp on bp.id = pb.plan_id
   where pb.player_id = auth.uid();

  -- No billing row, comped, or frozen → never gated.
  if v_status is null or v_free or v_status in ('paused','trial') then return 'ok'; end if;

  select min(due_at) into v_oldest
    from payments
   where player_id = auth.uid() and status = 'pending' and due_at is not null;

  if v_oldest is null then return 'ok'; end if;
  if v_oldest + coalesce(v_grace, 7) < current_date then return 'locked'; end if;
  if v_oldest < current_date then return 'grace'; end if;
  return 'ok';
end;
$fn$;

revoke all on function public.my_access_state() from public;
grant execute on function public.my_access_state() to authenticated;
