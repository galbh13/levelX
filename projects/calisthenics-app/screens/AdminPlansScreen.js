import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Switch } from 'react-native';
import {
  fetchPlans, savePlan, deletePlan, fetchSettings, saveSettings,
  money, CURRENCIES,
} from '../lib/billing';
import { F } from '../constants/fonts';
import { CARD_W } from '../constants/layout';
import ScreenFrame from '../components/ScreenFrame';
import ScreenHeader from '../components/ScreenHeader';
import PillButton from '../components/PillButton';
import { Field, Choice, Chip, SectionTitle, BIZ } from '../components/BizBits';

// ─── Admin — PLANS & BILLING SETTINGS ───────────────────────────────────────
// The price list, defined once and pointed at from every player. Editing a plan
// changes what future charges SHOULD be — it never rewrites the ledger, so past
// months keep the money they actually earned.
//
// FREE is a switch, not a price of 0: a family/comped plan is excluded from ARPU,
// never chased for payment and never locked out, which a zero price alone cannot
// express.

export default function AdminPlansScreen({ navigation }) {
  const [loading, setLoading] = useState(true);
  const [plans, setPlans] = useState([]);
  const [settings, setSettings] = useState(null);
  const [editing, setEditing] = useState(null);     // plan draft being edited/created
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [pl, st] = await Promise.all([fetchPlans(), fetchSettings()]);
      setPlans(pl);
      setSettings(st);
    } catch (e) {
      console.error('[AdminPlans] load:', e);
      setError(e?.message ?? 'Could not load plans.');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function commitPlan() {
    if (!editing?.name?.trim() || busy) return;
    setBusy(true);
    try {
      const row = {
        ...(editing.id ? { id: editing.id } : {}),
        name: editing.name.trim().toUpperCase(),
        price: Number(String(editing.price ?? 0).replace(/[^0-9.]/g, '')) || 0,
        currency: editing.currency ?? settings?.default_currency ?? 'ILS',
        is_free: !!editing.is_free,
        sessions_per_week: editing.sessions_per_week ? Number(editing.sessions_per_week) : null,
        description: editing.description?.trim() || null,
        active: editing.active !== false,
        order_index: Number(editing.order_index ?? plans.length + 1),
      };
      await savePlan(row);
      setEditing(null);
      await load();
    } catch (e) {
      console.error('[AdminPlans] savePlan:', e);
      setError(e?.message ?? 'Could not save the plan.');
    }
    setBusy(false);
  }

  async function removePlan(p) {
    try {
      await deletePlan(p.id);
      setPlans((prev) => prev.filter((x) => x.id !== p.id));
    } catch (e) {
      // A plan in use is protected by the FK (on delete set null) — but keep the
      // message honest rather than pretending it worked.
      console.error('[AdminPlans] deletePlan:', e);
      setError(e?.message ?? 'Could not delete the plan.');
    }
  }

  async function patchSettings(patch) {
    const next = { ...settings, ...patch };
    setSettings(next);
    try {
      const { id, updated_at, ...rest } = next;
      await saveSettings(rest);
    } catch (e) {
      console.error('[AdminPlans] saveSettings:', e);
      setError(e?.message ?? 'Could not save settings.');
    }
  }

  return (
    <ScreenFrame fill maxWidth={CARD_W} ready={!loading}>
      <View style={styles.card}>
        <ScreenHeader
          title="PLANS"
          subtitle="Price list & billing settings"
          onBack={() => navigation.goBack()}
          right={
            <PillButton
              label="＋ NEW PLAN"
              size="sm"
              tone="jade"
              onPress={() => setEditing({ name: '', price: '', currency: settings?.default_currency ?? 'ILS', is_free: false, active: true })}
            />
          }
        />

        {loading ? (
          <View style={styles.center}><ActivityIndicator size="large" color={BIZ.accent} /></View>
        ) : (
          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} showsVerticalScrollIndicator={false}>
            {error ? <Text style={styles.error}>{error}</Text> : null}

            {editing ? (
              <View style={styles.editBox}>
                <View style={styles.fieldRow}>
                  <Field label="NAME" value={editing.name} onChangeText={(t) => setEditing({ ...editing, name: t })} placeholder="STANDARD" />
                  <Field
                    label="PRICE / MONTH"
                    value={String(editing.price ?? '')}
                    onChangeText={(t) => setEditing({ ...editing, price: t })}
                    placeholder="400"
                    keyboardType="numeric"
                  />
                </View>
                <Choice
                  label="CURRENCY"
                  options={CURRENCIES.map((c) => ({ key: c.key, label: `${c.symbol} ${c.key}` }))}
                  value={editing.currency}
                  onSelect={(k) => setEditing({ ...editing, currency: k ?? editing.currency })}
                />
                <View style={styles.fieldRow}>
                  <Field
                    label="SESSIONS / WEEK"
                    value={editing.sessions_per_week == null ? '' : String(editing.sessions_per_week)}
                    onChangeText={(t) => setEditing({ ...editing, sessions_per_week: t.replace(/[^0-9]/g, '') })}
                    placeholder="—"
                    keyboardType="numeric"
                  />
                  <Field label="DESCRIPTION" value={editing.description} onChangeText={(t) => setEditing({ ...editing, description: t })} placeholder="Monthly coaching" />
                </View>

                <View style={styles.toggleRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.toggleLabel}>FREE PLAN</Text>
                    <Text style={styles.toggleHint}>
                      Family, staff, comped. Never billed, never chased, never locked out, and left out of ARPU.
                    </Text>
                  </View>
                  <Switch
                    value={!!editing.is_free}
                    onValueChange={(v) => setEditing({ ...editing, is_free: v })}
                    trackColor={{ false: '#12283f', true: 'rgba(31,215,154,0.5)' }}
                    thumbColor={editing.is_free ? BIZ.jade : '#4a6a8a'}
                  />
                </View>

                <View style={styles.editActions}>
                  <PillButton label="SAVE PLAN" tone="gold" loading={busy} disabled={!editing.name?.trim()} onPress={commitPlan} />
                  <PillButton label="CANCEL" tone="muted" onPress={() => setEditing(null)} />
                </View>
              </View>
            ) : null}

            {plans.length === 0 ? (
              <Text style={styles.empty}>No plans yet — create your price list.</Text>
            ) : (
              plans.map((p) => (
                <View key={p.id} style={styles.planRow}>
                  <View style={styles.planMain}>
                    <View style={styles.planTitleRow}>
                      <Text style={styles.planName} numberOfLines={1}>{p.name}</Text>
                      {p.is_free ? <Chip label="FREE" color={BIZ.muted} /> : null}
                      {p.active === false ? <Chip label="RETIRED" color={BIZ.gold} /> : null}
                    </View>
                    {p.description ? <Text style={styles.planDesc} numberOfLines={1}>{p.description}</Text> : null}
                  </View>
                  <Text style={styles.planPrice}>{p.is_free ? '—' : `${money(p.price, p.currency)}/mo`}</Text>
                  <PillButton label="EDIT" size="sm" onPress={() => setEditing({ ...p })} />
                  <Pressable onPress={() => removePlan(p)} hitSlop={10}><Text style={styles.del}>✕</Text></Pressable>
                </View>
              ))
            )}

            {/* ── General settings ── */}
            <SectionTitle>GENERAL</SectionTitle>
            <Field
              label="BUSINESS NAME"
              value={settings?.business_name}
              onChangeText={(t) => setSettings({ ...settings, business_name: t })}
              placeholder="Your coaching business"
            />
            <View style={styles.fieldRow}>
              <Field
                label="GRACE DAYS BEFORE LOCK"
                value={String(settings?.grace_days ?? 7)}
                onChangeText={(t) => setSettings({ ...settings, grace_days: Number(t.replace(/[^0-9]/g, '')) || 0 })}
                placeholder="7"
                keyboardType="numeric"
              />
              <Choice
                label="DEFAULT CURRENCY"
                options={CURRENCIES.map((c) => ({ key: c.key, label: `${c.symbol} ${c.key}` }))}
                value={settings?.default_currency}
                onSelect={(k) => patchSettings({ default_currency: k ?? settings?.default_currency })}
              />
            </View>

            <View style={styles.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.toggleLabel}>LOCK THE APP WHEN OVERDUE</Text>
                <Text style={styles.toggleHint}>
                  When a charge sits unpaid past the grace window, that player's account reports as locked.
                  Free plans, trials and frozen players are never affected. Leave this OFF until payments
                  arrive automatically — with an empty ledger it would lock people who have paid you in cash.
                </Text>
              </View>
              <Switch
                value={!!settings?.lock_on_overdue}
                onValueChange={(v) => patchSettings({ lock_on_overdue: v })}
                trackColor={{ false: '#12283f', true: 'rgba(225,29,72,0.5)' }}
                thumbColor={settings?.lock_on_overdue ? BIZ.alert : '#4a6a8a'}
              />
            </View>

            <View style={styles.saveBar}>
              <PillButton
                label="SAVE SETTINGS"
                tone="gold"
                onPress={() => patchSettings({})}
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
  bodyContent: { paddingHorizontal: 22, paddingTop: 6, paddingBottom: 44 },

  fieldRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },

  editBox: {
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.35)', borderRadius: 14,
    backgroundColor: 'rgba(255,215,0,0.05)', padding: 16, marginBottom: 16,
  },
  editActions: { flexDirection: 'row', gap: 12, marginTop: 8 },

  planRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, borderColor: BIZ.border, borderRadius: 12,
    backgroundColor: BIZ.panel, paddingVertical: 14, paddingHorizontal: 16, marginBottom: 10,
  },
  planMain: { flex: 1, minWidth: 0 },
  planTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  planName: { fontFamily: F.heading, fontSize: 17, color: BIZ.text, letterSpacing: 1.6 },
  planDesc: { fontFamily: F.bodyMed, fontSize: 12, color: BIZ.muted, marginTop: 4 },
  planPrice: { fontFamily: F.body, fontSize: 16, color: BIZ.gold },
  del: { fontFamily: F.heading, fontSize: 16, color: '#3a5a7a', paddingHorizontal: 4 },

  toggleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderWidth: 1, borderColor: BIZ.border, borderRadius: 12,
    backgroundColor: BIZ.panel, padding: 14, marginTop: 4, marginBottom: 12,
  },
  toggleLabel: { fontFamily: F.heading, fontSize: 13, letterSpacing: 2, color: BIZ.text },
  toggleHint: { fontFamily: F.bodyMed, fontSize: 12, color: BIZ.muted, marginTop: 4, lineHeight: 17 },

  empty: { fontFamily: F.bodyMed, fontSize: 14, color: BIZ.muted, paddingVertical: 12 },
  error: {
    fontFamily: F.body, fontSize: 13, color: '#FF6B85',
    borderWidth: 1, borderColor: 'rgba(225,29,72,0.4)', borderRadius: 10,
    padding: 12, marginBottom: 12, backgroundColor: 'rgba(225,29,72,0.08)',
  },
  saveBar: { marginTop: 20, alignItems: 'center' },
});
