import React, { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
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

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function CheckupScreen({ route, navigation }) {
  const { checkup } = route.params;

  const [questions,   setQuestions]   = useState([]);
  const [answers,     setAnswers]     = useState({});   // { [question_id]: string }
  const [exercises,   setExercises]   = useState([]);
  const [uploads,     setUploads]     = useState({});   // { [checkup_exercise_id]: video_url }
  const [uploadIds,   setUploadIds]   = useState({});   // { [checkup_exercise_id]: upload_row_id }
  const [loading,     setLoading]     = useState(true);
  const [submitting,  setSubmitting]  = useState(false);
  const [uploading,   setUploading]   = useState({});   // { [checkup_exercise_id]: bool }

  const fetchData = useCallback(async () => {
    try {
      const [qRes, aRes, exRes, upRes] = await Promise.all([
        supabase.from('checkup_questions').select('*').eq('checkup_id', checkup.id).order('order_index'),
        supabase.from('checkup_answers').select('*').eq('checkup_id', checkup.id),
        supabase.from('checkup_exercises').select('*').eq('checkup_id', checkup.id).order('order_index'),
        supabase.from('checkup_uploads').select('*').eq('checkup_id', checkup.id),
      ]);

      setQuestions(qRes.data ?? []);

      const aMap = {};
      for (const a of (aRes.data ?? [])) aMap[a.question_id] = a.answer;
      setAnswers(aMap);

      setExercises(exRes.data ?? []);

      const upMap = {};
      const idMap = {};
      for (const u of (upRes.data ?? [])) {
        upMap[u.checkup_exercise_id] = u.video_url;
        idMap[u.checkup_exercise_id] = u.id;
      }
      setUploads(upMap);
      setUploadIds(idMap);
    } catch (e) {
      console.error('[CheckupScreen] fetchData:', e);
    }
    setLoading(false);
  }, [checkup.id]);

  useFocusEffect(useCallback(() => { fetchData(); }, [fetchData]));

  // ── Video upload ───────────────────────────────────────────────────────────

  async function handleUploadVideo(exercise) {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow access to your photo library.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['video'],
      quality: 1,
    });

    if (result.canceled) return;

    const asset = result.assets[0];
    setUploading(prev => ({ ...prev, [exercise.id]: true }));

    try {
      const ext      = asset.uri.split('.').pop() ?? 'mp4';
      const path     = `${checkup.id}/${exercise.id}/${Date.now()}.${ext}`;
      const response = await fetch(asset.uri);
      const blob     = await response.blob();

      const { error: uploadError } = await supabase.storage
        .from('checkup-videos')
        .upload(path, blob, { upsert: true, contentType: 'video/mp4' });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('checkup-videos').getPublicUrl(path);
      const publicUrl = urlData.publicUrl;

      const existingId = uploadIds[exercise.id];
      if (existingId) {
        await supabase.from('checkup_uploads').update({ video_url: publicUrl, uploaded_at: new Date().toISOString() }).eq('id', existingId);
      } else {
        const { data: newRow } = await supabase.from('checkup_uploads').insert({
          checkup_id: checkup.id,
          checkup_exercise_id: exercise.id,
          video_url: publicUrl,
        }).select().single();
        setUploadIds(prev => ({ ...prev, [exercise.id]: newRow?.id }));
      }

      setUploads(prev => ({ ...prev, [exercise.id]: publicUrl }));
    } catch (e) {
      Alert.alert('Upload failed', e.message ?? 'Something went wrong.');
    }
    setUploading(prev => ({ ...prev, [exercise.id]: false }));
  }

  // ── Submit ─────────────────────────────────────────────────────────────────

  async function handleSubmit() {
    setSubmitting(true);
    try {
      // Delete all existing answers then re-insert fresh
      await supabase.from('checkup_answers').delete().eq('checkup_id', checkup.id);

      if (questions.length > 0) {
        const rows = questions.map(q => ({
          checkup_id:  checkup.id,
          question_id: q.id,
          answer:      answers[q.id] ?? '',
        }));
        const { error } = await supabase.from('checkup_answers').insert(rows);
        if (error) throw error;
      }

      const { error: statusError } = await supabase
        .from('checkups')
        .update({ status: 'submitted' })
        .eq('id', checkup.id);
      if (statusError) throw statusError;

      navigation.navigate('WorkoutsList');
    } catch (e) {
      Alert.alert('Submit failed', e.message ?? 'Something went wrong.');
    }
    setSubmitting(false);
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
        <Text style={styles.title}>CHECKUP</Text>
        <Text style={styles.subtitle}>{fmtDate(checkup.scheduled_date)}</Text>
        <View style={styles.divider} />
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">

        {/* ── Questions section ── */}
        {questions.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>QUESTIONS</Text>
            {questions.map((q, i) => (
              <View key={q.id} style={styles.card}>
                <Corner pos="TL" /><Corner pos="BR" />
                <Text style={styles.questionNum}>Q{i + 1}</Text>
                <Text style={styles.questionText}>{q.question}</Text>
                <TextInput
                  style={styles.answerInput}
                  placeholder="Your answer..."
                  placeholderTextColor={SL.muted}
                  multiline
                  value={answers[q.id] ?? ''}
                  onChangeText={v => setAnswers(prev => ({ ...prev, [q.id]: v }))}
                />
              </View>
            ))}
          </>
        )}

        {/* ── Execution section ── */}
        {exercises.length > 0 && (
          <>
            <Text style={[styles.sectionLabel, { marginTop: 20 }]}>EXECUTION</Text>
            {exercises.map((ex, i) => {
              const videoUrl   = uploads[ex.id];
              const isUploading = uploading[ex.id];
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
                    <View style={styles.uploadedRow}>
                      <Text style={styles.uploadedText}>✓ VIDEO UPLOADED</Text>
                      <TouchableOpacity
                        style={styles.replaceBtn}
                        onPress={() => handleUploadVideo(ex)}
                        disabled={isUploading}
                      >
                        {isUploading
                          ? <ActivityIndicator color={SL.accent} size="small" />
                          : <Text style={styles.replaceBtnText}>REPLACE</Text>
                        }
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={[styles.uploadBtn, isUploading && { opacity: 0.5 }]}
                      onPress={() => handleUploadVideo(ex)}
                      disabled={isUploading}
                      activeOpacity={0.8}
                    >
                      {isUploading
                        ? <ActivityIndicator color={SL.accent} size="small" />
                        : <Text style={styles.uploadBtnText}>📹 UPLOAD VIDEO</Text>
                      }
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </>
        )}

        {questions.length === 0 && exercises.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>NO CONTENT IN THIS CHECKUP</Text>
          </View>
        )}

        {/* Submit */}
        <TouchableOpacity
          style={[styles.submitBtn, submitting && { opacity: 0.6 }]}
          onPress={handleSubmit}
          disabled={submitting}
          activeOpacity={0.85}
        >
          {submitting
            ? <ActivityIndicator color={SL.bg} />
            : <Text style={styles.submitBtnText}>SUBMIT CHECKUP</Text>
          }
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
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
    letterSpacing: 1,
    textAlign: 'center',
    marginTop: 6,
  },
  divider: {
    height: 1,
    backgroundColor: SL.accent,
    opacity: 0.3,
    marginTop: 20,
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
  answerInput: {
    backgroundColor: SL.bg,
    borderWidth: 1.5,
    borderColor: SL.border,
    borderRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontFamily: F.body,
    fontSize: 15,
    color: SL.text,
    minHeight: 80,
    textAlignVertical: 'top',
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

  uploadedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  uploadedText: {
    fontFamily: F.bodyMed,
    fontSize: 14,
    color: SL.green,
    letterSpacing: 1.5,
  },
  replaceBtn: {
    borderWidth: 1,
    borderColor: SL.muted,
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    minWidth: 80,
    alignItems: 'center',
  },
  replaceBtnText: {
    fontFamily: F.bodyMed,
    fontSize: 13,
    color: SL.muted,
    letterSpacing: 1.5,
  },

  uploadBtn: {
    height: 40,
    borderWidth: 1.5,
    borderColor: SL.accent,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  uploadBtnText: {
    fontFamily: F.bodyMed,
    fontSize: 15,
    color: SL.accent,
    letterSpacing: 1,
  },

  empty: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: F.heading,
    fontSize: 18,
    color: SL.muted,
    letterSpacing: 2,
  },

  submitBtn: {
    height: 50,
    backgroundColor: SL.accent,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 24,
  },
  submitBtnText: {
    fontFamily: F.heading,
    fontSize: 18,
    color: SL.bg,
    letterSpacing: 3,
  },
});
