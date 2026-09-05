import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator,
} from 'react-native';
import {
  fetchPlans, fetchPlayerBilling, savePlayerBilling, fetchPlayerContact, fetchPayments,
  addPayment, deletePayment,
  playerMoney, money, bagText, planPrice, todayISO, monthRange,
  STATUSES, CHURN_REASONS, OFFERED_PLANS,
} from '../lib/billing';
import { fetchEngagement } from '../lib/engagement';
import { F } from '../constants/fonts';
import ScreenFrame from '../components/ScreenFrame';
import ScreenHeader from '../components/ScreenHeader';
import PillButton from '../components/PillButton';
import { StatTile, Chip, Field, Choice, SectionTitle, BIZ } from '../components/BizBits';

// ─── Admin — one player's MONEY card ────────────────────────────────────────
// The customer file behind a roster row: when they started, what they pay, how
// long they've been with you, what they've paid you to date, why they left.
// Reached from the BUSINESS screen's customer list.
//
// The price never varies — one plan, one monthly figure, nobody can buy more or
// less — so there is nothing to tally and nothing to chase. The only monthly
// fact worth recording is the binary one: did this month's payment arrive or
// not. THIS MONTH below is that switch, and flipping it writes (or takes back)
// the single ledger row that keeps LIFETIME honest.
//
// The DEAL block is edit-then-SAVE (one upsert on `player_billing`); the paid
// switch writes immediately, since it is an event, not a draft.
//
// Admin-only — every table this touches rejects a player at the RLS level.

export default function PlayerBillingScreen({ navigation, route }) {
  const player = route.params?.player ?? null;
  const today = todayISO();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [marking, setMarking] = useState(false);
  const [error, setError] = useState(null);
  const [plans, setPlans] = useState([]);
  const [payments, setPayments] = useState([]);
  const [engagement, setEngagement] = useState(null);
  const [form, setForm] = useState(null);      // the editable player_billing row
  const [dirty, setDirty] = useState(false);

  const set = (patch) => { setForm((f) => ({ ...f, ...patch })); setDirty(true); };

  const load = useCallback(async () => {
    if (!player?.id) return;
    try {
      setError(null);
      const [pl, b, contact, pay, eng] = await Promise.all([
        fetchPlans(),
        fetchPlayerBilling(player.id),
        fetchPlayerContact(player.id),   // for the no-row seed below
        fetchPayments({ playerId: player.id }),
        fetchEngagement([player.id], { today }),
      ]);
      setPlans(pl);
      setPayments(pay);
      setEngagement(eng[player.id]);
      // No row yet → seed a sensible new-customer draft rather than a blank form.
      // PHONE and BIRTHDAY come from the profile either way (they were typed on
      // the ＋ NEW PLAYER form), so they show here before any billing row exists.
      setForm(b ?? {
        player_id: player.id,
        phone: contact.phone ?? '',
        birthday: contact.birthday ?? '',
        status: 'active',
        started_at: today,
        billing_day: Number(today.slice(8, 10)) > 28 ? 28 : Number(today.slice(8, 10)),
      });
      setDirty(!b);
    } catch (e) {
      console.error('[PlayerBilling] load:', e);
      setError(e?.message ?? 'Could not load billing.');
    }
    setLoading(false);
  }, [player?.id, today]);

  useEffect(() => { load(); }, [load]);

  const plan = useMemo(
    () => plans.find((p) => p.id === form?.plan_id) ?? null,
    [plans, form?.plan_id],
  );
  // Retired plans stay in the table for the players still linked to them; the
  // picker only offers what you sell now — falling back to every active plan if
  // the names ever drift, so this can never leave you with no plan to pick.
  const planOptions = useMemo(() => {
    const live = plans.filter((p) => p.active !== false);
    const offered = live.filter((p) => OFFERED_PLANS.includes(String(p.name).toUpperCase()));
    return (offered.length ? offered : live).map((p) => ({
      key: p.id,
      label: `${p.name} · ${p.is_free ? 'FREE' : money(planPrice(p))}`,
    }));
  }, [plans]);
  const m = useMemo(
    () => playerMoney(form, plan, payments, today),
    [form, plan, payments, today],
  );

  // The rows that make up this month — held so the switch can take them back off
  // again when it gets flipped by mistake.
  const { start: mStart, end: mEnd } = useMemo(() => monthRange(today), [today]);
  const thisMonthRows = useMemo(
    () => payments.filter(
      (p) => p.status === 'paid' && p.paid_at && p.paid_at >= mStart && p.paid_at <= mEnd,
    ),
    [payments, mStart, mEnd],
  );
  const paidThisMonth = thisMonthRows.length > 0;

  // Phone and birthday are typed on the ＋ NEW PLAYER form and arrive here
  // already filled in. Required means required: they are how you actually reach
  // a customer, so the card will not save with either one blank.
  const missingContact = !String(form?.phone ?? '').trim() || !String(form?.birthday ?? '').trim();

  async function save() {
    if (!form || saving) return;
    if (missingContact) {
      setError('Phone and birthday are both required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { player_id, created_at, updated_at, ...patch } = form;
      // Empty strings must go back as NULL — a `date` column rejects '' and a
      // blank text field should clear the value, not store whitespace.
      Object.keys(patch).forEach((k) => {
        if (patch[k] === '') patch[k] = null;
      });
      const saved = await savePlayerBilling(player.id, patch);
      setForm(saved);
      setDirty(false);
    } catch (e) {
      console.error('[PlayerBilling] save:', e);
      setError(e?.message ?? 'Could not save.');
    }
    setSaving(false);
  }

  /** Flip this month between PAID and NOT PAID — one ledger row either way. */
  async function togglePaid() {
    if (marking || m.free) return;
    setMarking(true);
    setError(null);
    try {
      if (paidThisMonth) {
        await Promise.all(thisMonthRows.map((p) => deletePayment(p.id)));
        const gone = new Set(thisMonthRows.map((p) => p.id));
        setPayments((prev) => prev.filter((p) => !gone.has(p.id)));
      } else {
        const created = await addPayment({
          player_id: player.id,
          amount: m.price,
          currency: m.currency,
          kind: 'subscription',
          status: 'paid',
          paid_at: today,
          period_start: mStart,
          period_end: mEnd,
        });
        setPayments((prev) => [created, ...prev]);
      }
    } catch (e) {
      console.error('[PlayerBilling] togglePaid:', e);
      setError(e?.message ?? 'Could not update this month.');
    }
    setMarking(false);
  }

  const churnedish = form?.status === 'churned' || !!form?.ended_at;

  return (
    <ScreenFrame fill ready={!loading}>
      <View style={styles.card}>
        <ScreenHeader
          title="MONEY"
          subtitle={player?.full_name || player?.email || 'PLAYER'}
          onBack={() => navigation.goBack()}
          right={
            <PillButton
              label={dirty ? 'SAVE' : 'SAVED'}
              tone={dirty ? 'gold' : 'muted'}
              size="sm"
              loading={saving}
              disabled={!dirty}
              onPress={save}
            />
          }
        />

        {loading || !form ? (
          <View style={styles.center}><ActivityIndicator size="large" color={BIZ.accent} /></View>
        ) : (
          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} showsVerticalScrollIndicator={false}>
            {error ? <Text style={styles.error}>{error}</Text> : null}

            {/* ── The numbers ── Two, because two is all that moves: what they
                 have been worth so far, and when the next charge lands. */}
            <View style={styles.grid}>
              <StatTile
                label="LIFETIME"
                value={bagText(m.lifetime)}
                sub={`${m.months} month${m.months === 1 ? '' : 's'} · avg ${bagText(m.avgPerMonth)}`}
                tone="gold"
              />
              <StatTile
                label="NEXT CHARGE"
                value={m.nextDue ?? '—'}
                sub={form.billing_day ? `day ${form.billing_day} each month` : 'no billing day set'}
              />
            </View>

            <View style={styles.chipRow}>
              {form.started_at ? <Chip label={`${m.days} DAYS WITH ME`} color={BIZ.muted} /> : null}
              {engagement?.lastActive ? <Chip label={`LAST ACTIVE ${engagement.lastActive}`} color={BIZ.muted} /> : null}
            </View>

            {/* ── This month ── The only payment question there is. */}
            <SectionTitle>THIS MONTH</SectionTitle>
            <View style={[styles.paidBox, paidThisMonth && styles.paidBoxOn]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.paidState, paidThisMonth && styles.paidStateOn]}>
                  {m.free ? 'NOTHING TO COLLECT' : paidThisMonth ? 'PAID' : 'NOT PAID YET'}
                </Text>
                <Text style={styles.paidHint}>
                  {m.free
                    ? 'This plan is free — there is no monthly charge.'
                    : `${money(m.price, m.currency)} for ${mStart.slice(0, 7)}${paidThisMonth ? ' · received' : ''}`}
                </Text>
              </View>
              {m.free ? null : (
                <PillButton
                  label={paidThisMonth ? 'UNDO' : 'MARK PAID'}
                  size="sm"
                  tone={paidThisMonth ? 'muted' : 'jade'}
                  loading={marking}
                  onPress={togglePaid}
                />
              )}
            </View>

            {/* ── The deal ── */}
            <SectionTitle>THE DEAL</SectionTitle>
            <Choice
              label="STATUS"
              options={STATUSES}
              value={form.status}
              onSelect={(k) => set({ status: k, ended_at: k === 'churned' ? (form.ended_at ?? today) : null })}
            />
            {/* No currency picker: everything is billed in USD. */}
            <Choice
              label="PLAN"
              options={planOptions}
              value={form.plan_id}
              onSelect={(k) => set({ plan_id: k })}
              allowClear
            />
            <View style={styles.fieldRow}>
              <Field
                label="BILLING DAY (1–28)"
                value={form.billing_day == null ? '' : String(form.billing_day)}
                onChangeText={(t) => {
                  const n = Number(t.replace(/[^0-9]/g, ''));
                  set({ billing_day: t === '' ? null : Math.max(1, Math.min(28, n || 1)) });
                }}
                placeholder="1"
                keyboardType="numeric"
              />
              <Field label="STARTED (YYYY-MM-DD)" value={form.started_at} onChangeText={(t) => set({ started_at: t })} placeholder={today} />
            </View>
            {/* The freeze window only matters while they are actually frozen. */}
            {form.status === 'paused' ? (
              <View style={styles.fieldRow}>
                <Field label="FROZEN FROM" value={form.paused_from} onChangeText={(t) => set({ paused_from: t })} placeholder="—" />
                <Field label="FROZEN UNTIL" value={form.paused_until} onChangeText={(t) => set({ paused_until: t })} placeholder="—" />
              </View>
            ) : null}

            {/* ── The customer ── */}
            <SectionTitle>THE CUSTOMER</SectionTitle>
            <View style={styles.fieldRow}>
              <Field
                label="PHONE · REQUIRED"
                value={form.phone}
                onChangeText={(t) => set({ phone: t })}
                placeholder="05X-XXXXXXX"
                keyboardType="phone-pad"
              />
              <Field
                label="BIRTHDAY · REQUIRED"
                value={form.birthday}
                onChangeText={(t) => set({ birthday: t })}
                placeholder="YYYY-MM-DD"
              />
            </View>
            {missingContact ? (
              <Text style={styles.required}>
                Both arrive filled in from the ＋ NEW PLAYER form. Fill the blank one before saving.
              </Text>
            ) : null}

            {/* ── Exit ── */}
            {churnedish ? (
              <>
                <SectionTitle>WHY THEY LEFT</SectionTitle>
                <Choice label="REASON" options={CHURN_REASONS} value={form.churn_reason} onSelect={(k) => set({ churn_reason: k })} allowClear />
                <View style={styles.fieldRow}>
                  <Field label="ENDED (YYYY-MM-DD)" value={form.ended_at} onChangeText={(t) => set({ ended_at: t })} placeholder={today} />
                </View>
              </>
            ) : null}

            <View style={styles.saveBar}>
              <PillButton
                label={dirty ? 'SAVE CHANGES' : 'ALL SAVED'}
                tone={dirty ? 'gold' : 'muted'}
                disabled={!dirty}
                loading={saving}
                onPress={save}
              />
            </View>
          </ScrollView>
        )}
      </View>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, width: '100%' },
  bodyContent: { paddingHorizontal: 22, paddingTop: 6, paddingBottom: 48 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 12 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },

  fieldRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },

  paidBox: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderWidth: 1, borderColor: BIZ.border, borderRadius: 12,
    backgroundColor: BIZ.panel, padding: 14, marginTop: 4,
  },
  paidBoxOn: { borderColor: 'rgba(31,215,154,0.45)', backgroundColor: 'rgba(31,215,154,0.06)' },
  paidState: { fontFamily: F.heading, fontSize: 15, letterSpacing: 2, color: BIZ.text },
  paidStateOn: { color: BIZ.jade },
  paidHint: { fontFamily: F.bodyMed, fontSize: 12, color: BIZ.muted, marginTop: 4, lineHeight: 17 },

  required: { fontFamily: F.bodyMed, fontSize: 12, color: BIZ.gold, marginTop: 6 },

  error: {
    fontFamily: F.body, fontSize: 13, color: '#FF6B85',
    borderWidth: 1, borderColor: 'rgba(225,29,72,0.4)', borderRadius: 10,
    padding: 12, marginBottom: 12, backgroundColor: 'rgba(225,29,72,0.08)',
  },
  saveBar: { marginTop: 26, alignItems: 'center' },
});
