import React, { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, ActivityIndicator, Alert, KeyboardAvoidingView,
  Platform, Linking,
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
  green:  '#4CAF50',
};

function Corner({ pos }) {
  const s = pos === 'TL'
    ? { top: -1, left: -1, borderTopWidth: 1.5, borderLeftWidth: 1.5 }
    : { bottom: -1, right: -1, borderBottomWidth: 1.5, borderRightWidth: 1.5 };
  return <View style={[styles.corner, s]} pointerEvents="none" />;
}

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
}

// Extract storage path from public URL: everything after '/checkup-videos/'
function extractStoragePath(url) {
  if (!url) return null;
  const marker = '/checkup-videos/';
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return url.slice(idx + marker.length);
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function CheckupReviewScreen({ route, navigation }) {
  const { student } = route.params;

  const [checkup,       setCheckup]       = useState(null);
  const [questions,     setQuestions]     = useState([]);
  const [answers,       setAnswers]       = useState({});   // { [question_id]: string }
  const [exercises,     setExercises]     = useState([]);
  const [uploads,       setUploads]       = useState({});   // { [checkup_exercise_id]: video_url }
  const [coachResponse, setCoachResponse] = useState('');
  const [loading,       setLoading]       = useState(true);
  const [saving,        setSaving]        = useState(false);
  const [deleting,      setDeleting]      = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch the most recent submitted checkup for this student
      const { data: checkupData, error: checkupError } = await supabase
        .from('checkups')
        .select('*')
        .eq('student_id', student.id)
        .eq('status', 'submitted')
        .order('scheduled_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (checkupError) { console.error('[CheckupReview] checkup fetch:', checkupError); setLoading(false); return; }
      if (!checkupData) { setCheckup(null); setLoading(false); return; }

      setCheckup(checkupData);
      setCoachResponse(checkupData.coach_response ?? '');

      // Fetch all detail in parallel
      const [qRes, aRes, exRes, upRes] = await Promise.all([
        supabase.from('checkup_questions').select('*').eq('checkup_id', checkupData.id).order('order_index'),
        supabase.from('checkup_answers').select('*').eq('checkup_id', checkupData.id),
        supabase.from('checkup_exercises').select('*').eq('checkup_id', checkupData.id).order('order_index'),
        supabase.from('checkup_uploads').select('*').eq('checkup_id', checkupData.id),
      ]);

      setQuestions(qRes.data ?? []);

      const aMap = {};
      for (const a of (aRes.data ?? [])) aMap[a.question_id] = a.answer;
      setAnswers(aMap);

      setExercises(exRes.data ?? []);

      const upMap = {};
      for (const u of (upRes.data ?? [])) upMap[u.checkup_exercise_id] = u.video_url;
      setUploads(upMap);
    } catch (e) {
      console.error('[CheckupReview] fetchData:', e);
    }
    setLoading(false);
  }, [student.id]);

  useFocusEffect(useCallback(() => { fetchData(); }, [fetchData]));

  // ── Save response ──────────────────────────────────────────────────────────

  async function handleSaveResponse() {
    if (!checkup) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('checkups')
        .update({
          coach_response: coachResponse.trim(),
          responded_at:   new Date().toISOString(),
        })
        .eq('id', checkup.id);

      if (error) throw error;
      Alert.alert('Response saved!', 'Your response has been sent to the student.');
    } catch (e) {
      Alert.alert('Save failed', e.message ?? 'Something went wrong.');
    }
    setSaving(false);
  }

  // ── Delete checkup ─────────────────────────────────────────────────────────

  async function handleDelete() {
    Alert.alert(
      'DELETE CHECKUP?',
      'This will permanently delete the checkup, all answers, and all videos.',
      [
        { text: 'CANCEL', style: 'cancel' },
        {
          text: 'DELETE',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              // Fetch all uploads for this checkup to delete storage files
              const { data: uploadRows } = await supabase
                .from('checkup_uploads')
                .select('video_url')
                .eq('checkup_id', checkup.id);

              if (uploadRows && uploadRows.length > 0) {
                const paths = uploadRows
                  .map(u => extractStoragePath(u.video_url))
                  .filter(Boolean);
                if (paths.length > 0) {
                  await supabase.storage.from('checkup-videos').remove(paths);
                }
              }

              const { error } = await supabase
                .from('checkups')
                .delete()
                .eq('id', checkup.id);

              if (error) throw error;
              navigation.goBack();
            } catch (e) {
              Alert.alert('Delete failed', e.message ?? 'Something went wrong.');
              setDeleting(false);
            }
          },
        },
      ]
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={SL.accent} />
      </View>
    );
  }

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
        <Text style={styles.title}>CHECKUP REVIEW</Text>
        <Text style={styles.subtitle}>{student.full_name?.toUpperCase()}</Text>
        {checkup && (
          <Text style={styles.dateSubtitle}>{fmtDate(checkup.scheduled_date)}</Text>
        )}
        <View style={styles.divider} />
      </View>

      {!checkup ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>NO SUBMITTED CHECKUPS YET</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">

          {/* ── Questions & Answers ── */}
          {questions.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>QUESTIONS & ANSWERS</Text>
              {questions.map((q, i) => (
                <View key={q.id} style={styles.card}>
                  <Corner pos="TL" /><Corner pos="BR" />
                  <Text style={styles.questionNum}>Q{i + 1}</Text>
                  <Text style={styles.questionText}>{q.question}</Text>
                  <Text style={answers[q.id] ? styles.answerText : styles.noAnswer}>
                    {answers[q.id] || 'No answer'}
                  </Text>
                </View>
              ))}
            </>
          )}

          {/* ── Execution Videos ── */}
          {exercises.length > 0 && (
            <>
              <Text style={[styles.sectionLabel, { marginTop: 20 }]}>EXECUTION VIDEOS</Text>
              {exercises.map((ex, i) => {
                const videoUrl = uploads[ex.id];
                return (
                  <View key={ex.id} style={styles.card}>
                    <Corner pos="TL" /><Corner pos="BR" />
                    <View style={styles.exHeader}>
                      <View style={styles.letterBadge}>
                        <Text style={styles.letterText}>{String.fromCharCode(65 + i)}</Text>
                      </View>
                      <Text style={styles.exName}>{ex.exercise_name?.toUpperCase()}</Text>
                    </View>
                    {videoUrl ? (
                      <TouchableOpacity
                        style={styles.videoBtn}
                        onPress={() => Linking.openURL(videoUrl)}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.videoBtnText}>▶ VIEW VIDEO</Text>
                      </TouchableOpacity>
                    ) : (
                      <Text style={styles.noAnswer}>No video submitted</Text>
                    )}
                  </View>
                );
              })}
            </>
          )}

          {/* ── Coach Response ── */}
          <Text style={[styles.sectionLabel, { marginTop: 20 }]}>YOUR RESPONSE</Text>
          <View style={styles.card}>
            <Corner pos="TL" /><Corner pos="BR" />
            <TextInput
              style={styles.responseInput}
              placeholder="Write your feedback for the student..."
              placeholderTextColor={SL.muted}
              multiline
              value={coachResponse}
              onChangeText={setCoachResponse}
            />
          </View>

          {/* Save button */}
          <TouchableOpacity
            style={[styles.saveBtn, saving && { opacity: 0.6 }]}
            onPress={handleSaveResponse}
            disabled={saving}
            activeOpacity={0.85}
          >
            {saving
              ? <ActivityIndicator color={SL.bg} />
              : <Text style={styles.saveBtnText}>SAVE RESPONSE</Text>
            }
          </TouchableOpacity>

          {/* Delete button */}
          <TouchableOpacity
            style={[styles.deleteBtn, deleting && { opacity: 0.6 }]}
            onPress={handleDelete}
            disabled={deleting}
            activeOpacity={0.85}
          >
            {deleting
              ? <ActivityIndicator color={SL.danger} />
              : <Text style={styles.deleteBtnText}>DELETE CHECKUP</Text>
            }
          </TouchableOpacity>

          <View style={{ height: 48 }} />
        </ScrollView>
      )}
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
    fontSize: 18,
    color: SL.text,
    letterSpacing: 2,
    textAlign: 'center',
    marginTop: 6,
  },
  dateSubtitle: {
    fontFamily: F.bodyMed,
    fontSize: 14,
    color: SL.muted,
    letterSpacing: 1,
    textAlign: 'center',
    marginTop: 4,
  },
  divider: {
    height: 1,
    backgroundColor: SL.accent,
    opacity: 0.3,
    marginTop: 20,
  },

  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: F.heading,
    fontSize: 20,
    color: SL.muted,
    letterSpacing: 3,
    textAlign: 'center',
  },

  body: { padding: 20, gap: 0 },

  sectionLabel: {
    fontFamily: F.bodyMed,
    fontSize: 12,
    color: SL.muted,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 10,
  },

  card: {
    backgroundColor: SL.panel,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 4,
    overflow: 'visible',
    position: 'relative',
    padding: 16,
    marginBottom: 12,
    gap: 10,
  },
  questionNum: {
    fontFamily: F.bodyMed,
    fontSize: 11,
    color: SL.accent,
    letterSpacing: 2,
  },
  questionText: {
    fontFamily: F.heading,
    fontSize: 20,
    color: SL.accent,
    letterSpacing: 1,
  },
  answerText: {
    fontFamily: F.body,
    fontSize: 15,
    color: SL.text,
    lineHeight: 22,
  },
  noAnswer: {
    fontFamily: F.bodyMed,
    fontSize: 14,
    color: SL.muted,
    fontStyle: 'italic',
  },

  exHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
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
    fontSize: 20,
    color: SL.text,
    letterSpacing: 1,
    flex: 1,
  },
  videoBtn: {
    height: 40,
    borderWidth: 1.5,
    borderColor: SL.accent,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoBtnText: {
    fontFamily: F.bodyMed,
    fontSize: 15,
    color: SL.accent,
    letterSpacing: 2,
  },

  responseInput: {
    backgroundColor: SL.bg,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontFamily: F.body,
    fontSize: 15,
    color: SL.text,
    minHeight: 120,
    textAlignVertical: 'top',
  },

  saveBtn: {
    height: 50,
    backgroundColor: SL.accent,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 12,
  },
  saveBtnText: {
    fontFamily: F.heading,
    fontSize: 18,
    color: SL.bg,
    letterSpacing: 3,
  },

  deleteBtn: {
    height: 46,
    borderWidth: 1.5,
    borderColor: SL.danger,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteBtnText: {
    fontFamily: F.bodyMed,
    fontSize: 16,
    color: SL.danger,
    letterSpacing: 2,
  },
});
