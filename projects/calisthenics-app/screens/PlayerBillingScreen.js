import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Switch,
} from 'react-native';
import {
  fetchPlans, fetchPlayerBilling, savePlayerBilling, fetchPlayerContact, fetchPayments, fetchSettings,
  addPayment, deletePayment, markPaid,
  playerMoney, accessState, money, bagText, labelOf, todayISO, monthRange,
  STATUSES, SOURCES, METHODS, CHURN_REASONS, CURRENCIES, PRICING, OFFERED_PLANS,
} from '../lib/billing';
import { fetchEngagement, riskScore, RISK_COLORS, RISK_LABELS } from '../lib/engagement';
import { F } from '../constants/fonts';
import ScreenFrame from '../components/ScreenFrame';
import ScreenHeader from '../components/ScreenHeader';
import PillButton from '../components/PillButton';
import { StatTile, Chip, Field, Choice, SectionTitle, BIZ } from '../components/BizBits';

// ─── Admin — one player's MONEY card ────────────────────────────────────────
// The customer file behind a roster row: when they started, what they pay, where
// they came from, what they've paid you to date, what they still owe, why they
// left. Reached from PlayerAdmin → MONEY & MEMBERSHIP, or from the BUSINESS
// screen's customer list.
//
// The DEAL block is edit-then-SAVE (one upsert on `player_billing`); the LEDGER
// writes immediately, since a payment is an event you record the moment it
// happens and never "draft".
//
// Admin-only — every table this touches rejects a player at the RLS level.

const KIND_OPTIONS = [
  { key: 'subscription', label: 'MONTHLY' },
  { key: 'extra',        label: 'EXTRA / ONE-OFF' },
  { key: 'refund',       label: 'REFUND' },
];

const ACCESS_TEXT = {
  ok:     { label: 'ACCESS OPEN',    color: BIZ.jade },
  grace:  { label: 'IN GRACE',       color: BIZ.gold },
  locked: { label: 'WOULD BE LOCKED', color: BIZ.alert },
  free:   { label: 'NEVER BILLED',   color: BIZ.muted },
};

export default function PlayerBillingScreen({ navigation, route }) {
  const player = route.params?.player ?? null;
  const today = todayISO();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [plans, setPlans] = useState([]);
  const [settings, setSettings] = useState(null);
  const [payments, setPayments] = useState([]);
  const [engagement, setEngagement] = useState(null);
  const [form, setForm] = useState(null);      // the editable player_billing row
  const [dirty, setDirty] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  const set = (patch) => { setForm((f) => ({ ...f, ...patch })); setDirty(true); };

  const load = useCallback(async () => {
    if (!player?.id) return;
    try {
      setError(null);
      const [pl, b, contact, pay, st, eng] = await Promise.all([
        fetchPlans(),
        fetchPlayerBilling(player.id),
        fetchPlayerContact(player.id),   // for the no-row seed below
        fetchPayments({ playerId: player.id }),
        fetchSettings(),
        fetchEngagement([player.id], { today }),
      ]);
      setPlans(pl);
      setPayments(pay);
      setSettings(st);
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
        auto_pay: false,
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
  const currency = form?.currency_override || 'ILS';
  // Retired plans stay in the table for the players still linked to them; the
  // picker only offers what you sell now — falling back to every active plan if
  // the names ever drift, so this can never leave you with no plan to pick.
  const planOptions = useMemo(() => {
    const live = plans.filter((p) => p.active !== false);
    const offered = live.filter((p) => OFFERED_PLANS.includes(String(p.name).toUpperCase()));
    return (offered.length ? offered : live).map((p) => ({
      key: p.id,
      label: `${p.name} · ${p.is_free ? 'FREE' : money(PRICING[currency] ?? p.price, currency)}`,
    }));
  }, [plans, currency]);
  const m = useMemo(
    () => playerMoney(form, plan, payments, today),
    [form, plan, payments, today],
  );
  const risk = useMemo(
    () => riskScore(engagement, form, today),
    [engagement, form, today],
  );
  const access = accessState(form, plan, payments, settings, today);

  async function save() {
    if (!form || saving) return;
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

  async function logPayment(row) {
    try {
      const created = await addPayment({ ...row, player_id: player.id });
      setPayments((prev) => [created, ...prev]);
      setShowAdd(false);
    } catch (e) {
      console.error('[PlayerBilling] addPayment:', e);
      setError(e?.message ?? 'Could not save the payment.');
    }
  }

  async function receive(p) {
    try {
      await markPaid(p.id);
      setPayments((prev) => prev.map((x) => (x.id === p.id ? { ...x, status: 'paid', paid_at: today } : x)));
    } catch (e) {
      console.error('[PlayerBilling] markPaid:', e);
      setError(e?.message ?? 'Could not update the payment.');
    }
  }

  async function removePayment(p) {
    try {
      await deletePayment(p.id);
      setPayments((prev) => prev.filter((x) => x.id !== p.id));
    } catch (e) {
      console.error('[PlayerBilling] deletePayment:', e);
      setError(e?.message ?? 'Could not delete the payment.');
    }
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

            {/* ── The numbers ── Four that change a decision. Everything else
                 (days, extras, risk detail) rides along as a chip or the ledger. */}
            <View style={styles.grid}>
              <StatTile
                label="LIFETIME"
                value={bagText(m.lifetime)}
                sub={`${m.months} month${m.months === 1 ? '' : 's'} · avg ${bagText(m.avgPerMonth)}`}
                tone="gold"
              />
              <StatTile
                label="THIS MONTH"
                value={bagText(m.thisMonth)}
                sub={m.paidThisMonth ? 'received' : 'nothing yet'}
                tone={m.paidThisMonth ? 'jade' : 'muted'}
              />
              <StatTile
                label="OWES"
                value={bagText(m.outstanding)}
                sub={m.daysOverdue ? `${m.daysOverdue} days overdue` : 'nothing due'}
                tone={m.daysOverdue ? 'alert' : 'muted'}
              />
              <StatTile
                label="NEXT CHARGE"
                value={m.nextDue ?? '—'}
                sub={form.billing_day ? `day ${form.billing_day} each month` : 'no billing day set'}
              />
            </View>

            <View style={styles.chipRow}>
              <Chip label={RISK_LABELS[risk.band]} color={RISK_COLORS[risk.band]} />
              <Chip label={ACCESS_TEXT[access].label} color={ACCESS_TEXT[access].color} />
              {form.started_at ? <Chip label={`${m.days} DAYS WITH ME`} color={BIZ.muted} /> : null}
              {engagement?.lastActive ? <Chip label={`LAST ACTIVE ${engagement.lastActive}`} color={BIZ.muted} /> : null}
            </View>

            {/* ── The deal ── */}
            <SectionTitle>THE DEAL</SectionTitle>
            <Choice
              label="STATUS"
              options={STATUSES}
              value={form.status}
              onSelect={(k) => set({ status: k, ended_at: k === 'churned' ? (form.ended_at ?? today) : null })}
            />
            {/* Currency comes first because it IS the price: the plan pills
                below read ₪600 or $200 off whatever is picked here. */}
            <Choice
              label="CURRENCY"
              options={CURRENCIES.map((c) => ({ key: c.key, label: `${c.symbol} ${c.key}` }))}
              value={currency}
              onSelect={(k) => set({ currency_override: k ?? 'ILS' })}
            />
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
            <View style={styles.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.toggleLabel}>AUTO-PAY</Text>
                <Text style={styles.toggleHint}>
                  Their card/subscription charges on its own — payments arrive from the provider, not typed here.
                </Text>
              </View>
              <Switch
                value={!!form.auto_pay}
                onValueChange={(v) => set({ auto_pay: v })}
                trackColor={{ false: '#12283f', true: 'rgba(31,215,154,0.5)' }}
                thumbColor={form.auto_pay ? BIZ.jade : '#4a6a8a'}
              />
            </View>

            {/* ── The customer ── */}
            <SectionTitle>THE CUSTOMER</SectionTitle>
            <Choice label="CAME FROM" options={SOURCES} value={form.source} onSelect={(k) => set({ source: k })} allowClear />
            <View style={styles.fieldRow}>
              <Field label="PHONE" value={form.phone} onChangeText={(t) => set({ phone: t })} placeholder="—" />
              <Field label="BIRTHDAY (YYYY-MM-DD)" value={form.birthday} onChangeText={(t) => set({ birthday: t })} placeholder="—" />
            </View>

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

            {/* ── Ledger ── */}
            <SectionTitle
              right={
                <PillButton
                  label={showAdd ? 'CLOSE' : '＋ PAYMENT'}
                  size="sm"
                  tone={showAdd ? 'muted' : 'jade'}
                  onPress={() => setShowAdd((v) => !v)}
                />
              }
            >
              PAYMENTS
            </SectionTitle>

            {showAdd ? (
              <AddPaymentForm
                defaultCurrency={m.currency || settings?.default_currency || 'ILS'}
                defaultAmount={m.free ? '' : String(m.price ?? '')}
                today={today}
                onSubmit={logPayment}
              />
            ) : null}

            {payments.length === 0 ? (
              <Text style={styles.empty}>No payments recorded yet.</Text>
            ) : (
              payments.map((p) => (
                <PaymentRow key={p.id} p={p} today={today} onReceive={() => receive(p)} onDelete={() => removePayment(p)} />
              ))
            )}

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

// ─── Add-payment form ────────────────────────────────────────────────────────
// Two shapes in one form: RECEIVED (money in hand — paid_at) and DUE (an expected
// charge — due_at). A DUE row is what makes OUTSTANDING and the lock gate work,
// so it must be as easy to record as a received one.
function AddPaymentForm({ defaultCurrency, defaultAmount, today, onSubmit }) {
  const { start, end } = monthRange(today);
  const [amount, setAmount] = useState(defaultAmount ?? '');
  const [currency, setCurrency] = useState(defaultCurrency);
  const [kind, setKind] = useState('subscription');
  const [received, setReceived] = useState(true);
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState('bit');
  const [label, setLabel] = useState('');
  const [periodStart, setPeriodStart] = useState(start);
  const [periodEnd, setPeriodEnd] = useState(end);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const num = Number(String(amount).replace(/[^0-9.]/g, ''));
  const valid = !Number.isNaN(num) && num > 0;

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    await onSubmit({
      amount: kind === 'refund' ? -Math.abs(num) : num,
      currency,
      kind,
      label: label || null,
      status: received ? 'paid' : 'pending',
      paid_at: received ? date : null,
      due_at: received ? null : date,
      period_start: kind === 'subscription' ? periodStart || null : null,
      period_end: kind === 'subscription' ? periodEnd || null : null,
      method: received ? method : null,
      note: note || null,
    });
    setBusy(false);
  }

  return (
    <View style={styles.addBox}>
      <View style={styles.fieldRow}>
        <Field label="AMOUNT" value={amount} onChangeText={setAmount} placeholder="600" keyboardType="numeric" />
        <Choice
          label="CURRENCY"
          options={CURRENCIES.map((c) => ({ key: c.key, label: `${c.symbol} ${c.key}` }))}
          value={currency}
          onSelect={(k) => setCurrency(k ?? currency)}
        />
      </View>
      <Choice label="TYPE" options={KIND_OPTIONS} value={kind} onSelect={(k) => setKind(k ?? kind)} />
      <Choice
        label="STATE"
        options={[{ key: 'paid', label: 'RECEIVED' }, { key: 'pending', label: 'DUE / UNPAID' }]}
        value={received ? 'paid' : 'pending'}
        onSelect={(k) => setReceived(k === 'paid')}
      />
      <View style={styles.fieldRow}>
        <Field label={received ? 'PAID ON' : 'DUE ON'} value={date} onChangeText={setDate} placeholder={today} />
        {kind === 'extra' ? (
          <Field label="WHAT FOR" value={label} onChangeText={setLabel} placeholder="1-on-1 session" />
        ) : (
          <Field label="NOTE" value={note} onChangeText={setNote} placeholder="—" />
        )}
      </View>
      {kind === 'subscription' ? (
        <View style={styles.fieldRow}>
          <Field label="COVERS FROM" value={periodStart} onChangeText={setPeriodStart} placeholder={start} />
          <Field label="COVERS TO" value={periodEnd} onChangeText={setPeriodEnd} placeholder={end} />
        </View>
      ) : null}
      {received ? <Choice label="METHOD" options={METHODS} value={method} onSelect={(k) => setMethod(k ?? method)} /> : null}
      <PillButton
        label={received ? 'RECORD PAYMENT' : 'RECORD AS DUE'}
        tone="jade"
        disabled={!valid}
        loading={busy}
        onPress={submit}
        style={{ alignSelf: 'flex-start', marginTop: 4 }}
      />
    </View>
  );
}

// ─── One ledger row ──────────────────────────────────────────────────────────
function PaymentRow({ p, today, onReceive, onDelete }) {
  const overdue = p.status === 'pending' && p.due_at && p.due_at < today;
  const color = p.status === 'paid' ? BIZ.jade : overdue ? BIZ.alert : BIZ.gold;
  const when = p.status === 'paid' ? p.paid_at : p.due_at;

  return (
    <View style={[styles.payRow, { borderColor: `${color}44` }]}>
      <View style={styles.payHandle} />
      <View style={styles.payMain}>
        <Text style={[styles.payAmount, { color }]}>{money(p.amount, p.currency)}</Text>
        <Text style={styles.payMeta} numberOfLines={1}>
          {when ?? '—'}
          {p.method ? ` · ${labelOf(METHODS, p.method, p.method)}` : ''}
          {p.kind === 'extra' ? ` · ${p.label || 'EXTRA'}` : ''}
          {p.kind === 'refund' ? ' · REFUND' : ''}
          {p.period_start ? ` · covers ${p.period_start.slice(0, 7)}` : ''}
          {p.auto ? ' · AUTO' : ''}
        </Text>
        {p.note ? <Text style={styles.payNote} numberOfLines={2}>{p.note}</Text> : null}
      </View>
      <Chip label={p.status === 'paid' ? 'PAID' : overdue ? 'OVERDUE' : 'DUE'} color={color} />
      {p.status === 'pending' ? (
        <PillButton label="MARK PAID" size="sm" tone="jade" onPress={onReceive} />
      ) : null}
      <Pressable onPress={onDelete} hitSlop={10}><Text style={styles.del}>✕</Text></Pressable>
    </View>
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

  toggleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderWidth: 1, borderColor: BIZ.border, borderRadius: 12,
    backgroundColor: BIZ.panel, padding: 14, marginTop: 4,
  },
  toggleLabel: { fontFamily: F.heading, fontSize: 13, letterSpacing: 2, color: BIZ.text },
  toggleHint: { fontFamily: F.bodyMed, fontSize: 12, color: BIZ.muted, marginTop: 4, lineHeight: 17 },

  addBox: {
    borderWidth: 1, borderColor: 'rgba(31,215,154,0.35)', borderRadius: 14,
    backgroundColor: 'rgba(31,215,154,0.05)', padding: 16, marginBottom: 14,
  },

  payRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, borderRadius: 12, backgroundColor: BIZ.panel,
    paddingVertical: 12, paddingHorizontal: 14, marginBottom: 8,
  },
  payHandle: { width: 3, height: 30, borderRadius: 2, backgroundColor: 'rgba(74,158,191,0.5)' },
  payMain: { flex: 1, minWidth: 0 },
  payAmount: { fontFamily: F.heading, fontSize: 18, letterSpacing: 0.5 },
  payMeta: { fontFamily: F.bodyMed, fontSize: 12, color: BIZ.muted, marginTop: 3, letterSpacing: 0.3 },
  payNote: { fontFamily: F.bodyMed, fontSize: 12, color: '#5a7a9a', marginTop: 3 },
  del: { fontFamily: F.heading, fontSize: 16, color: '#3a5a7a', paddingHorizontal: 4 },

  empty: { fontFamily: F.bodyMed, fontSize: 14, color: BIZ.muted, paddingVertical: 12 },
  error: {
    fontFamily: F.body, fontSize: 13, color: '#FF6B85',
    borderWidth: 1, borderColor: 'rgba(225,29,72,0.4)', borderRadius: 10,
    padding: 12, marginBottom: 12, backgroundColor: 'rgba(225,29,72,0.08)',
  },
  saveBar: { marginTop: 26, alignItems: 'center' },
});
