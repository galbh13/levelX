-- ─────────────────────────────────────────────────────────────────────────────
-- USD only, and STANDARD costs $350
-- ─────────────────────────────────────────────────────────────────────────────
-- The offer is now two plans and one currency:
--
--   STANDARD  $350 / month
--   FAMILY    free — comped, never billed, never locked
--
-- The old seed priced STANDARD at ₪600 and the app carried a second shekel price
-- tag alongside every dollar one. Shekels are no longer taken, so this migration
-- retires them from everything that sets a FUTURE price — the plan row, the
-- global default, and any per-player currency override.
--
-- What it deliberately does NOT touch: rows in `payments`. Those are history. A
-- payment that arrived as ₪600 arrived as ₪600, and rewriting it to dollars
-- would invent revenue that never existed. The app still renders a shekel
-- payment with a ₪, it just cannot create another one.
--
-- Safe to re-run.

-- ── STANDARD — create it if the live DB never got the seed, price it if it did ─
-- The original seed was guarded by `where not exists (select 1 from billing_plans)`,
-- so a database that already had ANY plan row silently skipped STANDARD. That is
-- why the MONEY card was offering FAMILY alone.
insert into public.billing_plans (name, price, currency, is_free, active, order_index, description)
select 'STANDARD', 350.00, 'USD', false, true, 1, 'Monthly coaching — $350'
where not exists (
  select 1 from public.billing_plans where upper(name) = 'STANDARD'
);

update public.billing_plans
   set price       = 350.00,
       currency    = 'USD',
       is_free     = false,
       active      = true,
       description = 'Monthly coaching — $350'
 where upper(name) = 'STANDARD';

-- FAMILY stays free; it only needs the currency label corrected so a $0 line
-- never renders with a shekel sign.
update public.billing_plans
   set currency = 'USD'
 where upper(name) = 'FAMILY';

-- Anything else on the price list is legacy. Leave the rows (players may still
-- link to them) but stop offering them.
update public.billing_plans
   set active = false
 where upper(name) not in ('STANDARD', 'FAMILY');

-- ── The global default ───────────────────────────────────────────────────────
update public.billing_settings
   set default_currency = 'USD'
 where default_currency is distinct from 'USD';

-- ── Per-player overrides ─────────────────────────────────────────────────────
-- A leftover 'ILS' override would otherwise keep pinning that player to a
-- currency you no longer take. NULL means "use the default", which is now USD.
update public.player_billing
   set currency_override = null
 where currency_override = 'ILS';
