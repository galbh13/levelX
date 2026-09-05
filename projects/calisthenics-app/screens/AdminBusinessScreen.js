import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { supabase } from '../lib/supabase';
import { useCoach } from '../context/CoachContext';
import {
  fetchPlans, fetchAllBilling, fetchPayments,
  businessSummary, playerMoney, bagText, money, labelOf, isPaused,
  BUSINESS_NAME, STATUSES, todayISO,
} from '../lib/billing';
import { F } from '../constants/fonts';
import { C } from '../constants/colors';
import ScreenFrame from '../components/ScreenFrame';
import ScreenHeader from '../components/ScreenHeader';
import PillButton from '../components/PillButton';
import { StatTile, Chip, SectionTitle, BIZ } from '../components/BizBits';

// ─── Admin — BUSINESS ───────────────────────────────────────────────────────
// The money view of the roster. Three bands, top to bottom:
//
//   1. KPIs      — MRR (what should arrive), COLLECTED (what did, this month),
//                  lifetime revenue, avg customer lifespan and the roster count.
//   2. CUSTOMERS — one row per player: status, plan, LTV, days with you and
//                  avg/month. Tap through to their money card.
//
// DEBT AND RISK ARE NOT SHOWN HERE, and that is the coach's call (2026-09-04):
// everyone on this roster pays, so an OWES badge marks nobody, and an AT RISK /
// HEALTHY chip is a judgement he doesn't want sitting on a player's name. Both
// chips are gone, and so are the sort keys they explained — the list now reads
// biggest customer first, then alphabetical. `lib/engagement.js` still exists
// and still backs the risk math; this screen simply no longer queries it.
//
// Everything here is admin-only at the RLS level — a player cannot read any of
// these tables (migration 20260825_business_billing.sql).

const STATUS_COLOR = {
  active: BIZ.jade, trial: BIZ.accent, paused: BIZ.gold, churned: BIZ.muted,
};

const FILTERS = [
  { key: 'all',     label: 'ALL' },
  { key: 'active',  label: 'ACTIVE' },
  { key: 'churned', label: 'FINISHED' },
  { key: 'paused',  label: 'PAUSED' },
];

export default function AdminBusinessScreen({ navigation }) {
  const { setSelectedStudent } = useCoach();
  const [loading, setLoading] = useState(true);
  const [players, setPlayers] = useState([]);
  const [billings, setBillings] = useState({});
  const [plans, setPlans] = useState([]);
  const [payments, setPayments] = useState([]);
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState(null);

  const today = todayISO();

  const load = useCallback(async () => {
    try {
      setError(null);
      const { data: roster, error: rErr } = await supabase
        .from('profiles')
        .select('id, full_name, email, job, created_at')
        .eq('role', 'player')
        .order('full_name');
      if (rErr) throw rErr;
      const list = roster ?? [];

      const [b, pl, pay] = await Promise.all([
        fetchAllBilling(),
        fetchPlans(),
        fetchPayments(),
      ]);
      setPlayers(list);
      setBillings(b);
      setPlans(pl);
      setPayments(pay);
    } catch (e) {
      console.error('[AdminBusiness] load:', e);
      // The most likely cause by far is the migration not being applied yet.
      setError(e?.message ?? 'Could not load business data.');
    }
    setLoading(false);
  }, [today]);

  useEffect(() => { load(); }, [load]);
  // Coming back from a player's money card should show the payment just logged.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const planById = useMemo(() => {
    const m = {};
    plans.forEach((p) => { m[p.id] = p; });
    return m;
  }, [plans]);

  const payByPlayer = useMemo(() => {
    const m = {};
    payments.forEach((p) => { (m[p.player_id] ??= []).push(p); });
    return m;
  }, [payments]);

  const summary = useMemo(
    () => businessSummary({ players, billings, plans, payments, today }),
    [players, billings, plans, payments, today],
  );

  // One derived row per player — money only, ready to sort and filter.
  const rows = useMemo(() => {
    return players.map((p) => {
      const b = billings[p.id] ?? null;
      const plan = b?.plan_id ? planById[b.plan_id] : null;
      const pays = payByPlayer[p.id] ?? [];
      return { player: p, billing: b, plan, money: playerMoney(b, plan, pays, today) };
    });
  }, [players, billings, planById, payByPlayer, today]);

  const filtered = useMemo(() => {
    const churnedRow = (r) => r.billing?.status === 'churned' || !!r.billing?.ended_at;
    let list = rows;
    if (filter === 'active')  list = rows.filter((r) => r.billing && !churnedRow(r));
    if (filter === 'churned') list = rows.filter(churnedRow);
    if (filter === 'paused')  list = rows.filter((r) => isPaused(r.billing, today));
    // Biggest customer first, then alphabetical. The list used to lead on WHO
    // OWES and then on churn risk — neither is shown any more (see the header
    // note), and an ordering nothing on screen explains is just a mystery.
    return [...list].sort((a, b) => {
      const ltv = (r) => r.money.lifetime.ILS + r.money.lifetime.USD;
      if (ltv(b) !== ltv(a)) return ltv(b) - ltv(a);
      return (a.player.full_name ?? '').localeCompare(b.player.full_name ?? '');
    });
  }, [rows, filter, today]);

  function openPlayer(row) {
    setSelectedStudent(row.player);
    navigation.navigate('PlayerBilling', { player: row.player });
  }

  return (
    <ScreenFrame fill ready={!loading}>
      <View style={styles.card}>
        <ScreenHeader
          title="BUSINESS"
          subtitle={BUSINESS_NAME}
          onBack={() => navigation.goBack()}
          right={
            <PillButton
              label="PLANS"
              size="sm"
              onPress={() => navigation.navigate('BillingPlans')}
            />
          }
        />

        {loading ? (
          <View style={styles.center}><ActivityIndicator size="large" color={BIZ.accent} /></View>
        ) : (
          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}
          >
            {error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
                <Text style={styles.errorHint}>
                  If this is the first run, apply supabase/migrations/20260825_business_billing.sql.
                </Text>
              </View>
            ) : null}

            {/* ── KPIs ── */}
            <View style={styles.grid}>
              <StatTile
                label="MRR"
                value={bagText(summary.mrr)}
                sub={`${summary.paying} paying · ${summary.comped} free`}
                tone="jade"
              />
              <StatTile
                label="COLLECTED THIS MONTH"
                value={bagText(summary.collected)}
                sub={monthName(today)}
                tone="gold"
              />
            </View>

            <View style={styles.grid}>
              <StatTile
                label="LIFETIME REVENUE"
                value={bagText(summary.lifetimeAll)}
                sub="all time, all customers"
                tone="gold"
              />
              <StatTile
                label="AVG LIFESPAN"
                value={summary.avgLifespan ? `${summary.avgLifespan}d` : '—'}
                sub={summary.churned ? `${summary.churned} left so far` : 'no one has left yet'}
              />
              <StatTile
                label="ROSTER"
                value={String(summary.total)}
                sub={`${summary.active} active · ${summary.paused} paused · ${summary.churned} finished`}
              />
            </View>

            {/* ── Customers ── */}
            <SectionTitle>CUSTOMERS</SectionTitle>
            <View style={styles.filterRow}>
              {FILTERS.map((f) => {
                const on = f.key === filter;
                return (
                  <Pressable key={f.key} onPress={() => setFilter(f.key)} style={[styles.filterPill, on && styles.filterPillOn]}>
                    <Text style={[styles.filterText, on && styles.filterTextOn]}>{f.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            {filtered.length === 0 ? (
              <Text style={styles.empty}>No players in this view.</Text>
            ) : (
              filtered.map((row) => (
                <CustomerRow key={row.player.id} row={row} onPress={() => openPlayer(row)} />
              ))
            )}

          </ScrollView>
        )}
      </View>
    </ScreenFrame>
  );
}

// ─── One customer row ────────────────────────────────────────────────────────
function CustomerRow({ row, onPress }) {
  const { player, billing, plan, money: m } = row;
  const churned = billing?.status === 'churned' || !!billing?.ended_at;

  return (
    <Pressable onPress={onPress} style={[styles.row, churned && styles.rowDim]}>
      <View style={styles.rowTop}>
        <View style={styles.rowMain}>
          <Text style={styles.rowName} numberOfLines={1}>{player.full_name || player.email || '(no name)'}</Text>
          <View style={styles.rowChips}>
            {billing ? (
              <Chip
                label={labelOf(STATUSES, billing.status, billing.status)}
                color={STATUS_COLOR[billing.status] ?? BIZ.muted}
              />
            ) : (
              <Chip label="NOT SET UP" color={BIZ.muted} />
            )}
            {plan ? <Chip label={plan.name} color={m.free ? BIZ.muted : BIZ.accent} /> : null}
          </View>
        </View>
        <Text style={styles.chevron}>›</Text>
      </View>

      <View style={styles.rowStats}>
        <RowStat label="PRICE" value={m.free ? 'FREE' : money(m.price, m.currency)} tone={m.free ? 'muted' : 'text'} />
        <RowStat label="LTV" value={bagText(m.lifetime)} tone="gold" />
        <RowStat label="DAYS" value={billing?.started_at ? String(m.days) : '—'} />
        <RowStat label="AVG/MO" value={bagText(m.avgPerMonth)} />
      </View>
    </Pressable>
  );
}

const RowStat = ({ label, value, tone = 'text' }) => (
  <View style={styles.rowStat}>
    <Text style={styles.rowStatLabel}>{label}</Text>
    <Text
      style={[styles.rowStatValue, tone === 'gold' && { color: BIZ.gold }, tone === 'muted' && { color: BIZ.muted }]}
      numberOfLines={1}
    >
      {value}
    </Text>
  </View>
);

function monthName(iso) {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

const styles = StyleSheet.create({
  card: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, width: '100%' },
  bodyContent: { paddingHorizontal: 22, paddingTop: 6, paddingBottom: 40 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 12 },

  errorBox: {
    borderWidth: 1, borderColor: 'rgba(225,29,72,0.5)', borderRadius: 12,
    backgroundColor: 'rgba(225,29,72,0.08)', padding: 14, marginBottom: 16,
  },
  errorText: { fontFamily: F.body, fontSize: 14, color: '#FF6B85' },
  errorHint: { fontFamily: F.bodyMed, fontSize: 12, color: BIZ.muted, marginTop: 6 },

  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  filterPill: {
    borderRadius: 999, borderWidth: 1, borderColor: 'rgba(74,158,191,0.25)',
    backgroundColor: C.surface, paddingVertical: 7, paddingHorizontal: 14,
  },
  filterPillOn: { borderColor: BIZ.accent, backgroundColor: 'rgba(74,158,191,0.18)' },
  filterText: { fontFamily: F.heading, fontSize: 12, letterSpacing: 1.6, color: BIZ.muted },
  filterTextOn: { color: BIZ.text },

  // The card stacks: identity + chevron on top, the four stats on their own
  // full-width line beneath. Side by side never fit on a phone — four stats each
  // with a minWidth pushed AVG/MO past the card edge and under the chevron.
  row: {
    borderWidth: 1, borderColor: BIZ.border, borderRadius: 14,
    backgroundColor: BIZ.panel,
    paddingVertical: 14, paddingHorizontal: 16, marginBottom: 10,
  },
  rowDim: { opacity: 0.55 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowMain: { flex: 1, minWidth: 0, gap: 8 },
  rowName: {
    fontFamily: F.heading, fontSize: 17, color: BIZ.text,
    letterSpacing: 1.2, textTransform: 'uppercase',
  },
  rowChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },

  rowStats: {
    flexDirection: 'row', gap: 8, marginTop: 12,
    paddingTop: 12, borderTopWidth: 1, borderTopColor: BIZ.border,
  },
  // minWidth:0 + flexShrink lets a long value squeeze instead of overflowing.
  rowStat: { flex: 1, minWidth: 0, flexShrink: 1 },
  rowStatLabel: { fontFamily: F.heading, fontSize: 10, letterSpacing: 1.4, color: BIZ.muted },
  rowStatValue: { fontFamily: F.body, fontSize: 15, color: BIZ.text, marginTop: 3 },

  chevron: { fontFamily: F.heading, fontSize: 24, color: BIZ.accent },

  empty: {
    fontFamily: F.bodyMed, fontSize: 14, color: BIZ.muted,
    paddingVertical: 14, letterSpacing: 0.4,
  },
});
