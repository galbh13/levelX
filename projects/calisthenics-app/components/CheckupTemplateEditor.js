import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, Modal, ActivityIndicator, ScrollView,
  Platform,
} from 'react-native';
import { F } from '../constants/fonts';
import { C } from '../constants/colors';
import PillButton from './PillButton';
import {
  CHECKUP_PART, splitTemplateParts, fetchClassTemplateItems, resolvePlayerTemplate,
  addTemplateItem, updateTemplateItem, deleteTemplateItem, materializePlayerTemplate,
  normalizePrompt,
} from '../lib/checkups';

const PROMPT_MAX = 200;
const DESC_MAX   = 600;

// ─── Admin check-up template editor ─────────────────────────────────────────────
// Reusable authoring surface for a template's items, used two ways:
//   • class-standard  → scope={ classId }            (AdminCheckupTemplateScreen)
//   • per-player      → scope={ playerId, classId }  (AdminCheckupScreen)
// Part 1 = plain QUESTIONS (text prompt). Part 2 = EXERCISES — a single free-text
// description of what the admin wants to see, kept in `prompt`; the row's legacy
// video_url/description columns are always written null.
// Only the admin reaches this — writes need admin RLS.
//
// PLAYER SCOPE — ONE list, edited in place (2026-08-29). It always shows the
// check-up that player actually fills in: their own items if they have any, else
// the class standard they inherit. There is no separate "customize" step and no
// second structure on the page — the FIRST edit (add / edit / delete) silently
// forks the class standard onto the player (materializePlayerTemplate) and applies
// the change to their copy, so the class standard is never touched by accident and
// the coach simply edits the player's check-up and saves. The parent is told which
// of the two it is through onSourceChange.
//
// `editable` (default true) is the AUTHORING chrome — the per-row EDIT / ✕ and the
// ADD buttons. AdminCheckupScreen turns it OFF by default so the coach can screen-
// record himself walking a player through their check-up without admin controls in
// the frame; he flips it on only while actually changing something.
//
// `wide` (default false) is the DESKTOP layout, passed down by a screen that has
// already decided the canvas is desktop-sized (`useDesktopLayout`): the two parts
// sit SIDE BY SIDE instead of stacked, and the rows step up a size. It is a prop
// rather than its own breakpoint read so the editor can never disagree with the
// screen hosting it.
export default function CheckupTemplateEditor({ scope, onCountChange, onSourceChange, editable = true, wide = false }) {
  const [items,   setItems]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId,  setBusyId]  = useState(null);
  // 'player' = these rows belong to the player · 'class' = inherited, still the
  // class standard · 'none' = nothing authored anywhere yet.
  const [source,  setSource]  = useState('class');

  // Item form modal
  const [form, setForm] = useState(null); // { part, editing, prompt }
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [focused, setFocused] = useState(false);   // the field's own focus ring

  const load = useCallback(async () => {
    try {
      let rows, src;
      if (scope?.playerId) {
        const res = await resolvePlayerTemplate(scope.playerId, scope.classId ?? null);
        rows = res.items; src = res.source;
      } else {
        rows = await fetchClassTemplateItems(scope?.classId); src = 'class';
      }
      setItems(rows);
      setSource(src);
      onSourceChange?.(src);
      onCountChange?.(rows.length);
    } catch (e) {
      console.error('[CheckupTemplateEditor] load:', e);
    }
    setLoading(false);
  }, [scope?.classId, scope?.playerId, onCountChange, onSourceChange]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  const { questions, exercises } = splitTemplateParts(items);

  // Where a write goes. Exactly ONE of class_id / player_id may be set (DB CHECK).
  const writeScope = scope?.playerId ? { playerId: scope.playerId } : { classId: scope?.classId };
  // Editing an INHERITED list has to fork it onto the player first.
  const inherited = !!scope?.playerId && source !== 'player';

  // Fork the class standard onto this player and hand back their fresh copies.
  async function ensureOwnItems() {
    const rows = await materializePlayerTemplate(scope.playerId, scope.classId ?? null);
    setItems(rows);
    setSource(rows.length ? 'player' : 'none');
    onSourceChange?.(rows.length ? 'player' : 'none');
    return rows;
  }

  // The player's copy OF an inherited row: same part, same text (the copy is
  // exact), position as the fallback.
  function mirrorOf(rows, it) {
    const k = normalizePrompt(it.prompt);
    return rows.find(r => r.part === it.part && normalizePrompt(r.prompt) === k)
      ?? rows.find(r => r.part === it.part && (r.order_index ?? 0) === (it.order_index ?? 0))
      ?? null;
  }

  function openAdd(part) {
    setFormErr('');
    setFocused(false);
    setForm({ part, editing: null, prompt: '' });
  }
  function openEdit(it) {
    setFormErr('');
    setFocused(false);
    setForm({ part: it.part, editing: it, prompt: it.prompt ?? '' });
  }

  async function saveForm() {
    if (!form) return;
    if (!form.prompt.trim()) { setFormErr(form.part === CHECKUP_PART.EXERCISE ? 'Add a description.' : 'Add a question.'); return; }
    setSaving(true);
    setFormErr('');
    try {
      const payload = { prompt: form.prompt.trim(), video_url: null, description: null };
      // First edit of an inherited list → fork it onto the player, then work on
      // THEIR copy. The class standard is left exactly as it was.
      const rows = inherited ? await ensureOwnItems() : items;
      const appendOrder = part => {
        const samer = rows.filter(i => i.part === part);
        return samer.length ? Math.max(...samer.map(i => i.order_index ?? 0)) + 1 : 0;
      };
      if (form.editing) {
        const target = inherited ? mirrorOf(rows, form.editing) : form.editing;
        if (target) {
          await updateTemplateItem(target.id, payload);
        } else {
          // The fork produced no twin (nothing was inherited) — write it as new.
          await addTemplateItem(writeScope, { part: form.part, ...payload, order_index: appendOrder(form.part) });
        }
      } else {
        // Append after the last item of the SAME part.
        await addTemplateItem(writeScope, { part: form.part, ...payload, order_index: appendOrder(form.part) });
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
      // Removing an inherited item drops it for THIS PLAYER only — fork first,
      // then delete their copy.
      const target = inherited ? mirrorOf(await ensureOwnItems(), it) : it;
      if (target) await deleteTemplateItem(target.id);
      await load();
    } catch (e) {
      console.error('[CheckupTemplateEditor] remove:', e);
    }
    setBusyId(null);
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={C.iceGlow} /></View>;
  }

  const itemRow = (it, i) => (
    <View key={it.id} style={[styles.itemCard, wide && W.itemCard]}>
      <Text style={[styles.itemNum, wide && W.itemNum]}>{i + 1}</Text>
      <View style={styles.itemMain}>
        <Text style={[styles.itemPrompt, wide && W.itemPrompt]}>{it.prompt}</Text>
      </View>
      {editable && (
        <RowActions busy={busyId === it.id} onEdit={() => openEdit(it)} onDelete={() => remove(it)} wide={wide} />
      )}
    </View>
  );

  return (
    <View>
    {/* On a desktop canvas the two parts are columns, not a 600px-long scroll —
        the whole check-up is then one screenful the coach can talk over. The
        modal stays OUTSIDE this row: a <Modal> is a flex child like any other
        on react-native-web, and inside a row it would be laid out as a third
        column. */}
    <View style={wide ? W.columns : null}>
      {/* Part 1 — Questions */}
      <View style={wide ? W.column : null}>
        <PartHead n={1} label="QUESTIONS" hint="Diet, sleep, how the week felt — plain text answers." wide={wide} />
        {questions.map(itemRow)}
        {questions.length === 0 && <Text style={[styles.emptyLine, wide && W.emptyLine]}>No questions yet.</Text>}
        {editable && (
          <PillButton label="＋  ADD QUESTION" onPress={() => openAdd(CHECKUP_PART.QUESTION)} size={wide ? 'md' : 'sm'} style={styles.addBtn} />
        )}
      </View>

      {/* Part 2 — Exercises */}
      <View style={wide ? W.column : null}>
        {!wide && <View style={{ height: 26 }} />}
        <PartHead n={2} label="EXERCISES" hint="Describe what you want to see; the player records their own clip." wide={wide} />
        {exercises.map(itemRow)}
        {exercises.length === 0 && <Text style={[styles.emptyLine, wide && W.emptyLine]}>No exercises yet.</Text>}
        {editable && (
          <PillButton label="＋  ADD EXERCISE" onPress={() => openAdd(CHECKUP_PART.EXERCISE)} size={wide ? 'md' : 'sm'} style={styles.addBtn} />
        )}
      </View>
    </View>

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
                style={[
                  styles.input,
                  form?.part === CHECKUP_PART.EXERCISE && styles.multiline,
                  focused && styles.inputFocus,
                ]}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
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

function PartHead({ n, label, hint, wide = false }) {
  return (
    <View style={[styles.partHead, wide && W.partHead]}>
      <View style={[styles.partChip, wide && W.partChip]}><Text style={[styles.partChipText, wide && W.partChipText]}>PART {n}</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.partLabel, wide && W.partLabel]}>{label}</Text>
        <Text style={[styles.partHint, wide && W.partHint]}>{hint}</Text>
      </View>
    </View>
  );
}

function RowActions({ onEdit, onDelete, busy, wide = false }) {
  return (
    <View style={styles.rowActions}>
      <TouchableOpacity onPress={onEdit} disabled={busy} style={styles.actBtn}>
        <Text style={[styles.actEdit, wide && W.actEdit]}>EDIT</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onDelete} disabled={busy} style={styles.actBtn}>
        {busy ? <ActivityIndicator size="small" color="#FF6B6B" /> : <Text style={[styles.actDel, wide && W.actDel]}>✕</Text>}
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
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.lockedBorder, borderRadius: 14,
    padding: 16, marginBottom: 12,
  },
  itemMain: { flex: 1 },
  // The position number — what carries the list when the EDIT/✕ chrome is hidden.
  itemNum: {
    fontFamily: F.heading, fontSize: 13, color: C.iceGlow, opacity: 0.75,
    letterSpacing: 1, minWidth: 16, paddingTop: 3,
  },
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
    // react-native-web paints the BROWSER's focus ring on top of the field — a
    // white rectangle that has nothing to do with this UI. Kill it; the border
    // below is the app's own focus state.
    ...Platform.select({ web: { outlineStyle: 'none', outlineWidth: 0 }, default: {} }),
  },
  inputFocus: { borderColor: C.iceGlow },
  multiline: { minHeight: 90, lineHeight: 22 },
  formErr: { fontFamily: F.bodyMed, fontSize: 13, color: '#FF6B6B', letterSpacing: 0.4, marginTop: 14 },
  modalBtns: { flexDirection: 'row', gap: 12, marginTop: 22 },
});

// ─── THE DESKTOP OVERRIDES ──────────────────────────────────────────────────
// Layered on top of `styles` when the host screen passes `wide` (see the prop
// note on the component). Same rule as AdminCheckupScreen's sheet: these only
// ever ADD to a phone style, so the phone layout above stays the one real
// layout and can't be moved by a desktop tweak.
const W = StyleSheet.create({
  columns: { flexDirection: 'row', gap: 40, alignItems: 'flex-start' },
  column:  { flex: 1 },

  partHead: { gap: 16, marginBottom: 20 },
  partChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10 },
  partChipText: { fontSize: 15, letterSpacing: 2 },
  partLabel: { fontSize: 24, letterSpacing: 4 },
  partHint: { fontSize: 16, marginTop: 5 },

  itemCard: { padding: 22, gap: 16, borderRadius: 18, marginBottom: 16 },
  itemNum: { fontSize: 17, minWidth: 22, paddingTop: 4 },
  itemPrompt: { fontSize: 21, lineHeight: 30 },

  actEdit: { fontSize: 15, letterSpacing: 2 },
  actDel: { fontSize: 21 },

  emptyLine: { fontSize: 18, marginBottom: 16 },
});
