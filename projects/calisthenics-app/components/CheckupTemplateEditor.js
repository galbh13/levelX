import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, Modal, ActivityIndicator, ScrollView,
} from 'react-native';
import { F } from '../constants/fonts';
import { C } from '../constants/colors';
import PillButton from './PillButton';
import {
  CHECKUP_PART, splitTemplateParts, fetchClassTemplateItems, fetchPlayerTemplateItems,
  addTemplateItem, updateTemplateItem, deleteTemplateItem,
} from '../lib/checkups';

const PROMPT_MAX = 200;
const DESC_MAX   = 600;

// ─── Admin check-up template editor ─────────────────────────────────────────────
// Reusable authoring surface for a template's items, used two ways:
//   • class-standard  → scope={ classId }   (AdminCheckupTemplateScreen)
//   • per-player       → scope={ playerId }  (AdminCheckupScreen customize)
// Part 1 = plain QUESTIONS (text prompt). Part 2 = EXERCISES — a single free-text
// description of what the admin wants to see, kept in `prompt`; the row's legacy
// video_url/description columns are always written null.
// Only the admin reaches this — writes need admin RLS.
export default function CheckupTemplateEditor({ scope, onCountChange }) {
  const [items,   setItems]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId,  setBusyId]  = useState(null);

  // Item form modal
  const [form, setForm] = useState(null); // { part, editing, prompt }
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState('');

  const load = useCallback(async () => {
    try {
      const rows = scope?.playerId
        ? await fetchPlayerTemplateItems(scope.playerId)
        : await fetchClassTemplateItems(scope?.classId);
      setItems(rows);
      onCountChange?.(rows.length);
    } catch (e) {
      console.error('[CheckupTemplateEditor] load:', e);
    }
    setLoading(false);
  }, [scope?.classId, scope?.playerId, onCountChange]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  const { questions, exercises } = splitTemplateParts(items);

  function openAdd(part) {
    setFormErr('');
    setForm({ part, editing: null, prompt: '' });
  }
  function openEdit(it) {
    setFormErr('');
    setForm({ part: it.part, editing: it, prompt: it.prompt ?? '' });
  }

  async function saveForm() {
    if (!form) return;
    if (!form.prompt.trim()) { setFormErr(form.part === CHECKUP_PART.EXERCISE ? 'Add a description.' : 'Add a question.'); return; }
    setSaving(true);
    setFormErr('');
    try {
      const payload = { prompt: form.prompt.trim(), video_url: null, description: null };
      if (form.editing) {
        await updateTemplateItem(form.editing.id, payload);
      } else {
        // Append after the last item of the SAME part.
        const samer = items.filter(i => i.part === form.part);
        const nextOrder = samer.length ? Math.max(...samer.map(i => i.order_index ?? 0)) + 1 : 0;
        await addTemplateItem(scope, { part: form.part, ...payload, order_index: nextOrder });
      }
      setForm(null);
      await load();
    } catch (e) {
      setFormErr(e.message ?? 'Could not save.');
    }
    setSaving(false);
  }

  async function remove(it) {
    setBusyId(it.id);
    try {
      await deleteTemplateItem(it.id);
      await load();
    } catch (e) {
      console.error('[CheckupTemplateEditor] remove:', e);
    }
    setBusyId(null);
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={C.iceGlow} /></View>;
  }

  return (
    <View>
      {/* Part 1 — Questions */}
      <PartHead n={1} label="QUESTIONS" hint="Diet, sleep, how the week felt — plain text answers." />
      {questions.map(q => (
        <View key={q.id} style={styles.itemCard}>
          <View style={styles.itemMain}>
            <Text style={styles.itemPrompt}>{q.prompt}</Text>
          </View>
          <RowActions busy={busyId === q.id} onEdit={() => openEdit(q)} onDelete={() => remove(q)} />
        </View>
      ))}
      {questions.length === 0 && <Text style={styles.emptyLine}>No questions yet.</Text>}
      <PillButton label="＋  ADD QUESTION" onPress={() => openAdd(CHECKUP_PART.QUESTION)} size="sm" style={styles.addBtn} />

      {/* Part 2 — Exercises */}
      <View style={{ height: 26 }} />
      <PartHead n={2} label="EXERCISES" hint="Describe what you want to see; the player records their own clip." />
      {exercises.map(ex => (
        <View key={ex.id} style={styles.itemCard}>
          <View style={styles.itemMain}>
            <Text style={styles.itemPrompt}>{ex.prompt}</Text>
          </View>
          <RowActions busy={busyId === ex.id} onEdit={() => openEdit(ex)} onDelete={() => remove(ex)} />
        </View>
      ))}
      {exercises.length === 0 && <Text style={styles.emptyLine}>No exercises yet.</Text>}
      <PillButton label="＋  ADD EXERCISE" onPress={() => openAdd(CHECKUP_PART.EXERCISE)} size="sm" style={styles.addBtn} />

      {/* Item form */}
      <Modal visible={!!form} transparent animationType="fade" onRequestClose={() => setForm(null)}>
        <View style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.modalTitle}>
                {form?.editing ? 'EDIT' : 'ADD'} {form?.part === CHECKUP_PART.EXERCISE ? 'EXERCISE' : 'QUESTION'}
              </Text>

              {/* One field for both parts: the question, or — for an exercise —
                  the single description of what the admin wants to see. */}
              <Text style={styles.fieldLabel}>
                {form?.part === CHECKUP_PART.EXERCISE ? 'DESCRIPTION' : 'QUESTION'}
              </Text>
              <TextInput
                style={[styles.input, form?.part === CHECKUP_PART.EXERCISE && styles.multiline]}
                placeholder={
                  form?.part === CHECKUP_PART.EXERCISE
                    ? 'What you want to see — the exercise, cues, what to focus on…'
                    : 'e.g. How did you sleep this week?'
                }
                placeholderTextColor={C.textMuted}
                value={form?.prompt}
                onChangeText={t => setForm(f => ({ ...f, prompt: t }))}
                maxLength={form?.part === CHECKUP_PART.EXERCISE ? DESC_MAX : PROMPT_MAX}
                multiline
                textAlignVertical="top"
              />

              {!!formErr && <Text style={styles.formErr}>⚠  {formErr}</Text>}

              <View style={styles.modalBtns}>
                <PillButton label="CANCEL" onPress={() => setForm(null)} tone="muted" size="md" style={{ flex: 1 }} />
                <PillButton
                  label={saving ? 'SAVING…' : 'SAVE'}
                  onPress={saveForm}
                  loading={saving}
                  variant="solid"
                  tone="accent"
                  size="md"
                  style={{ flex: 1 }}
                />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function PartHead({ n, label, hint }) {
  return (
    <View style={styles.partHead}>
      <View style={styles.partChip}><Text style={styles.partChipText}>PART {n}</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.partLabel}>{label}</Text>
        <Text style={styles.partHint}>{hint}</Text>
      </View>
    </View>
  );
}

function RowActions({ onEdit, onDelete, busy }) {
  return (
    <View style={styles.rowActions}>
      <TouchableOpacity onPress={onEdit} disabled={busy} style={styles.actBtn}>
        <Text style={styles.actEdit}>EDIT</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onDelete} disabled={busy} style={styles.actBtn}>
        {busy ? <ActivityIndicator size="small" color="#FF6B6B" /> : <Text style={styles.actDel}>✕</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { paddingVertical: 40, alignItems: 'center' },

  partHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  partChip: {
    borderWidth: 1.5, borderColor: C.iceGlow, backgroundColor: 'rgba(74,158,191,0.12)',
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4,
  },
  partChipText: { fontFamily: F.heading, fontSize: 12, color: C.iceGlow, letterSpacing: 1.5 },
  partLabel: { fontFamily: F.heading, fontSize: 18, color: C.iceGlow, letterSpacing: 3 },
  partHint: { fontFamily: F.bodyMed, fontSize: 12, color: C.textMuted, letterSpacing: 0.4, marginTop: 2 },

  itemCard: {
    flexDirection: 'row', gap: 12,
    backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.lockedBorder, borderRadius: 14,
    padding: 16, marginBottom: 12,
  },
  itemMain: { flex: 1 },
  itemPrompt: { fontFamily: F.bodyMed, fontSize: 16, color: C.text, lineHeight: 22, letterSpacing: 0.2 },

  rowActions: { alignItems: 'center', gap: 10 },
  actBtn: { paddingHorizontal: 6, paddingVertical: 4, minWidth: 34, alignItems: 'center' },
  actEdit: { fontFamily: F.heading, fontSize: 12, color: C.iceGlow, letterSpacing: 1.5 },
  actDel: { fontFamily: F.heading, fontSize: 16, color: '#FF6B6B' },

  emptyLine: { fontFamily: F.bodyMed, fontSize: 14, color: C.textMuted, letterSpacing: 0.5, marginBottom: 12 },
  addBtn: { alignSelf: 'flex-start' },

  // Modal
  modalWrap: {
    flex: 1, backgroundColor: 'rgba(3,6,14,0.82)',
    justifyContent: 'center', alignItems: 'center', padding: 22,
  },
  modalCard: {
    width: '100%', maxWidth: 460, maxHeight: '86%',
    backgroundColor: C.bg, borderWidth: 1.5, borderColor: C.iceGlow, borderRadius: 18, padding: 22,
    shadowColor: C.iceGlow, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 16,
  },
  modalTitle: { fontFamily: F.heading, fontSize: 20, color: C.iceGlow, letterSpacing: 3, marginBottom: 16 },
  fieldLabel: {
    fontFamily: F.bodyMed, fontSize: 13, color: C.text,
    letterSpacing: 2, textTransform: 'uppercase', marginBottom: 8, marginTop: 14,
  },
  input: {
    backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.cardBorder, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 13, fontFamily: F.body, fontSize: 15, color: C.text,
  },
  multiline: { minHeight: 90, lineHeight: 22 },
  formErr: { fontFamily: F.bodyMed, fontSize: 13, color: '#FF6B6B', letterSpacing: 0.4, marginTop: 14 },
  modalBtns: { flexDirection: 'row', gap: 12, marginTop: 22 },
});
