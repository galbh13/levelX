import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, ActivityIndicator, Modal, KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { F } from '../constants/fonts';

// ─── Theme ────────────────────────────────────────────────────────────────────

const SL = {
  bg:     '#050912',
  panel:  '#070d1a',
  border: '#1a3a5c',
  accent: '#4A9EBF',
  text:   '#E8F4FF',
  muted:  '#4a6a8a',
  danger: '#FF4444',
};

function Corner({ pos }) {
  const s = pos === 'TL'
    ? { top: -1, left: -1, borderTopWidth: 1.5, borderLeftWidth: 1.5 }
    : { bottom: -1, right: -1, borderBottomWidth: 1.5, borderRightWidth: 1.5 };
  return <View style={[styles.corner, s]} pointerEvents="none" />;
}

let _uid = 0;
function uid() { return String(++_uid); }

function toDateStr(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function CheckupBuilderScreen({ route, navigation }) {
  const { student, existingCheckup } = route.params ?? {};
  const isEdit = !!existingCheckup;

  const [scheduledDate, setScheduledDate] = useState(
    existingCheckup?.scheduled_date ?? toDateStr(new Date())
  );
  const [questions, setQuestions] = useState([]);   // [{ _uid, question }]
  const [exercises, setExercises] = useState([]);   // [{ _uid, exercise_name, exercise_gallery_id }]
  const [saving,    setSaving]    = useState(false);
  const [loading,   setLoading]   = useState(true);

  // Gallery modal
  const [showGallery,    setShowGallery]    = useState(false);
  const [gallery,        setGallery]        = useState([]);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [gallerySearch,  setGallerySearch]  = useState('');

  // ── Load template from last/existing checkup ──────────────────────────────

  useEffect(() => {
    async function load() {
      try {
        if (isEdit) {
          // Load from existingCheckup
          const [qRes, exRes] = await Promise.all([
            supabase.from('checkup_questions').select('*').eq('checkup_id', existingCheckup.id).order('order_index'),
            supabase.from('checkup_exercises').select('*').eq('checkup_id', existingCheckup.id).order('order_index'),
          ]);
          setQuestions((qRes.data ?? []).map(q => ({ _uid: uid(), question: q.question })));
          setExercises((exRes.data ?? []).map(e => ({ _uid: uid(), exercise_name: e.exercise_name, exercise_gallery_id: e.exercise_gallery_id })));
        } else {
          // Load last checkup as template
          const { data: lastCheckup } = await supabase
            .from('checkups')
            .select('id')
            .eq('student_id', student.id)
            .order('scheduled_date', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (lastCheckup) {
            const [qRes, exRes] = await Promise.all([
              supabase.from('checkup_questions').select('*').eq('checkup_id', lastCheckup.id).order('order_index'),
              supabase.from('checkup_exercises').select('*').eq('checkup_id', lastCheckup.id).order('order_index'),
            ]);
            setQuestions((qRes.data ?? []).map(q => ({ _uid: uid(), question: q.question })));
            setExercises((exRes.data ?? []).map(e => ({ _uid: uid(), exercise_name: e.exercise_name, exercise_gallery_id: e.exercise_gallery_id })));
          }
        }
      } catch (e) {
        console.error('[CheckupBuilder] load:', e);
      }
      setLoading(false);
    }
    load();
  }, []);

  // ── Gallery ────────────────────────────────────────────────────────────────

  async function openGallery() {
    setShowGallery(true);
    setGallerySearch('');
    if (gallery.length > 0) return;
    setGalleryLoading(true);
    try {
      const { data } = await supabase
        .from('exercises_gallery')
        .select('id, name, movement_type')
        .order('name', { ascending: true });
      setGallery(data ?? []);
    } catch (e) {
      console.error('[CheckupBuilder] gallery:', e);
    }
    setGalleryLoading(false);
  }

  function selectFromGallery(item) {
    setExercises(prev => [...prev, { _uid: uid(), exercise_name: item.name, exercise_gallery_id: item.id }]);
    setShowGallery(false);
  }

  const filteredGallery = gallerySearch.trim()
    ? gallery.filter(g => g.name.toLowerCase().includes(gallerySearch.toLowerCase()))
    : gallery;

  // ── Save ───────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!scheduledDate.trim()) { alert('Please set a checkup date.'); return; }
    if (questions.length === 0 && exercises.length === 0) {
      alert('Add at least one question or exercise.'); return;
    }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      let checkupId;
      if (isEdit) {
        const { error } = await supabase
          .from('checkups')
          .update({ scheduled_date: scheduledDate.trim() })
          .eq('id', existingCheckup.id);
        if (error) throw error;
        checkupId = existingCheckup.id;
        // Delete existing questions + exercises then re-insert
        await supabase.from('checkup_questions').delete().eq('checkup_id', checkupId);
        await supabase.from('checkup_exercises').delete().eq('checkup_id', checkupId);
      } else {
        const { data: checkup, error } = await supabase
          .from('checkups')
          .insert({ student_id: student.id, coach_id: user.id, scheduled_date: scheduledDate.trim(), status: 'pending' })
          .select()
          .single();
        if (error) throw error;
        checkupId = checkup.id;
      }

      if (questions.length > 0) {
        const { error } = await supabase.from('checkup_questions').insert(
          questions.map((q, i) => ({ checkup_id: checkupId, order_index: i, question: q.question }))
        );
        if (error) throw error;
      }

      if (exercises.length > 0) {
        const { error } = await supabase.from('checkup_exercises').insert(
          exercises.map((e, i) => ({
            checkup_id: checkupId,
            order_index: i,
            exercise_name: e.exercise_name,
            exercise_gallery_id: e.exercise_gallery_id ?? null,
          }))
        );
        if (error) throw error;
      }

      navigation.goBack();
    } catch (e) {
      alert('Save failed: ' + (e.message ?? 'Unknown error'));
    }
    setSaving(false);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>← BACK</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{isEdit ? 'EDIT CHECKUP' : 'NEW CHECKUP'}</Text>
        <Text style={styles.subtitle}>{student?.full_name?.toUpperCase()}</Text>
        <View style={styles.divider} />
      </View>

      {loading ? (
        <ActivityIndicator color={SL.accent} style={{ marginTop: 48 }} size="large" />
      ) : (
        <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">

          {/* Checkup date */}
          <Text style={styles.label}>CHECKUP DATE</Text>
          <TextInput
            style={styles.input}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={SL.muted}
            value={scheduledDate}
            onChangeText={setScheduledDate}
          />

          {/* Questions */}
          <Text style={styles.label}>QUESTIONS</Text>

          {questions.map((q, i) => (
            <View key={q._uid} style={styles.card}>
              <Corner pos="TL" /><Corner pos="BR" />
              <View style={styles.cardRow}>
                <View style={styles.indexBadge}>
                  <Text style={styles.indexText}>{i + 1}</Text>
                </View>
                <TextInput
                  style={[styles.input, { flex: 1, marginBottom: 0 }]}
                  placeholder="Enter question..."
                  placeholderTextColor={SL.muted}
                  value={q.question}
                  onChangeText={v => setQuestions(prev => prev.map(x => x._uid === q._uid ? { ...x, question: v } : x))}
                  multiline
                />
                <TouchableOpacity
                  style={styles.removeBtn}
                  onPress={() => setQuestions(prev => prev.filter(x => x._uid !== q._uid))}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.removeBtnText}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}

          <TouchableOpacity
            style={styles.addBtn}
            onPress={() => setQuestions(prev => [...prev, { _uid: uid(), question: '' }])}
            activeOpacity={0.8}
          >
            <Text style={styles.addBtnText}>+ ADD QUESTION</Text>
          </TouchableOpacity>

          {/* Exercises */}
          <Text style={[styles.label, { marginTop: 24 }]}>EXECUTION EXERCISES</Text>

          {exercises.map((ex, i) => (
            <View key={ex._uid} style={styles.card}>
              <Corner pos="TL" /><Corner pos="BR" />
              <View style={styles.cardRow}>
                <View style={styles.letterBadge}>
                  <Text style={styles.letterText}>{String.fromCharCode(65 + i)}</Text>
                </View>
                <Text style={styles.exName} numberOfLines={2}>{ex.exercise_name?.toUpperCase()}</Text>
                <TouchableOpacity
                  style={styles.removeBtn}
                  onPress={() => setExercises(prev => prev.filter(x => x._uid !== ex._uid))}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.removeBtnText}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}

          <TouchableOpacity
            style={styles.addBtn}
            onPress={openGallery}
            activeOpacity={0.8}
          >
            <Text style={styles.addBtnText}>+ ADD EXERCISE</Text>
          </TouchableOpacity>

          {/* Save */}
          <TouchableOpacity
            style={[styles.saveBtn, saving && { opacity: 0.6 }]}
            onPress={handleSave}
            disabled={saving}
            activeOpacity={0.85}
          >
            {saving
              ? <ActivityIndicator color={SL.bg} />
              : <Text style={styles.saveBtnText}>SAVE CHECKUP</Text>
            }
          </TouchableOpacity>

          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {/* ── Gallery Modal ── */}
      <Modal visible={showGallery} transparent animationType="slide" onRequestClose={() => setShowGallery(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.gallerySheet}>
            <Text style={styles.galleryTitle}>SELECT EXERCISE</Text>
            <TextInput
              style={styles.gallerySearch}
              placeholder="Search exercises..."
              placeholderTextColor={SL.muted}
              value={gallerySearch}
              onChangeText={setGallerySearch}
            />
            {galleryLoading ? (
              <ActivityIndicator color={SL.accent} style={{ marginTop: 24 }} />
            ) : (
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                {filteredGallery.map(item => (
                  <TouchableOpacity
                    key={item.id}
                    style={styles.galleryItem}
                    onPress={() => selectFromGallery(item)}
                    activeOpacity={0.75}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.galleryItemName}>{item.name?.toUpperCase()}</Text>
                      {item.movement_type ? (
                        <Text style={styles.galleryItemType}>{item.movement_type}</Text>
                      ) : null}
                    </View>
                    <Text style={styles.galleryAdd}>+</Text>
                  </TouchableOpacity>
                ))}
                {filteredGallery.length === 0 && (
                  <Text style={styles.galleryEmpty}>NO EXERCISES FOUND</Text>
                )}
                <View style={{ height: 32 }} />
              </ScrollView>
            )}
            <TouchableOpacity style={styles.galleryClose} onPress={() => setShowGallery(false)}>
              <Text style={styles.galleryCloseText}>CLOSE</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SL.bg },

  corner: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderColor: SL.accent,
    zIndex: 2,
  },

  header: {
    paddingHorizontal: 24,
    paddingTop: 60,
    paddingBottom: 24,
    borderBottomWidth: 1,
    borderBottomColor: SL.border,
  },
  backText: {
    fontFamily: F.bodyMed,
    fontSize: 20,
    color: SL.accent,
    letterSpacing: 2,
    marginBottom: 16,
  },
  title: {
    fontFamily: F.heading,
    fontSize: 32,
    color: SL.accent,
    letterSpacing: 4,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: F.bodyMed,
    fontSize: 16,
    color: SL.muted,
    letterSpacing: 2,
    textAlign: 'center',
    marginTop: 6,
  },
  divider: {
    height: 1,
    backgroundColor: SL.accent,
    opacity: 0.3,
    marginTop: 20,
  },

  form: { padding: 20, gap: 0 },

  label: {
    fontFamily: F.bodyMed,
    fontSize: 12,
    color: SL.muted,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginTop: 8,
    marginBottom: 8,
  },

  input: {
    backgroundColor: SL.panel,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontFamily: F.body,
    fontSize: 16,
    color: SL.text,
    marginBottom: 10,
  },

  card: {
    backgroundColor: SL.panel,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 4,
    overflow: 'visible',
    position: 'relative',
    marginBottom: 10,
    padding: 14,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  indexBadge: {
    width: 32,
    height: 32,
    borderWidth: 1.5,
    borderColor: SL.accent,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(74,158,191,0.08)',
    flexShrink: 0,
  },
  indexText: {
    fontFamily: F.heading,
    fontSize: 16,
    color: SL.accent,
  },
  letterBadge: {
    width: 36,
    height: 36,
    borderWidth: 1.5,
    borderColor: SL.accent,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(74,158,191,0.08)',
    flexShrink: 0,
  },
  letterText: {
    fontFamily: F.heading,
    fontSize: 18,
    color: SL.accent,
  },
  exName: {
    fontFamily: F.heading,
    fontSize: 18,
    color: SL.text,
    letterSpacing: 1,
    flex: 1,
  },

  removeBtn: {
    width: 28,
    height: 28,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: SL.danger,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  removeBtnText: {
    fontFamily: F.body,
    fontSize: 13,
    color: SL.danger,
  },

  addBtn: {
    height: 40,
    borderWidth: 1.5,
    borderColor: SL.accent,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  addBtnText: {
    fontFamily: F.heading,
    fontSize: 15,
    color: SL.accent,
    letterSpacing: 3,
  },

  saveBtn: {
    height: 50,
    backgroundColor: SL.accent,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 20,
  },
  saveBtnText: {
    fontFamily: F.heading,
    fontSize: 18,
    color: SL.bg,
    letterSpacing: 3,
  },

  // Gallery modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  gallerySheet: {
    height: '75%',
    backgroundColor: SL.panel,
    borderTopWidth: 1.5,
    borderTopColor: SL.accent,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    padding: 20,
  },
  galleryTitle: {
    fontFamily: F.heading,
    fontSize: 20,
    color: SL.accent,
    letterSpacing: 3,
    textAlign: 'center',
    marginBottom: 14,
  },
  gallerySearch: {
    height: 40,
    backgroundColor: SL.bg,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 4,
    paddingHorizontal: 12,
    fontFamily: F.body,
    fontSize: 15,
    color: SL.text,
    marginBottom: 12,
  },
  galleryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: SL.border,
    gap: 10,
  },
  galleryItemName: {
    fontFamily: F.heading,
    fontSize: 17,
    color: SL.text,
    letterSpacing: 1,
  },
  galleryItemType: {
    fontFamily: F.bodyMed,
    fontSize: 12,
    color: SL.muted,
    letterSpacing: 1,
    marginTop: 2,
  },
  galleryAdd: {
    fontFamily: F.heading,
    fontSize: 22,
    color: SL.accent,
  },
  galleryEmpty: {
    fontFamily: F.heading,
    fontSize: 16,
    color: SL.muted,
    letterSpacing: 2,
    textAlign: 'center',
    marginTop: 32,
  },
  galleryClose: {
    height: 40,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 12,
  },
  galleryCloseText: {
    fontFamily: F.bodyMed,
    fontSize: 14,
    color: SL.muted,
    letterSpacing: 2,
  },
});
