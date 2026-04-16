import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { F } from '../constants/fonts';
import { C } from '../constants/colors';

const skills = [
  { id: 'planche',           name: 'Planche Mastery',            locked: false, progress: 3, total: 8 },
  { id: 'front-lever',       name: 'Front Lever Mastery',        locked: false, progress: 5, total: 8 },
  { id: 'handstand',         name: 'Handstand Mastery',          locked: false, progress: 2, total: 7 },
  { id: 'one-arm-handstand', name: 'One Arm Handstand Mastery',  locked: true,  progress: 0, total: 9 },
  { id: 'handstand-pushup',  name: 'Handstand Push-Up Mastery',  locked: true,  progress: 0, total: 6 },
  { id: 'one-arm-pullup',    name: 'One Arm Pull-Up Mastery',    locked: true,  progress: 0, total: 8 },
];

export default function SkillsScreen({ navigation }) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Skills</Text>
        <Text style={styles.subtitle}>Choose your path</Text>
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        {skills.map((skill) => (
          <TouchableOpacity
            key={skill.id}
            style={[styles.card, skill.locked && styles.cardLocked]}
            onPress={() => !skill.locked && navigation.navigate('SkillTree', { skill })}
            activeOpacity={skill.locked ? 1 : 0.7}
          >
            <View style={styles.cardLeft}>
              <Text style={[styles.lockIcon, skill.locked && styles.lockIconDim]}>
                {skill.locked ? '🔒' : '⚡'}
              </Text>
            </View>

            <View style={styles.cardBody}>
              <Text style={[styles.skillName, skill.locked && styles.skillNameDim]}>
                {skill.name}
              </Text>
              <View style={styles.progressRow}>
                <View style={styles.progressBarBg}>
                  <View
                    style={[
                      styles.progressBarFill,
                      { width: skill.locked ? 0 : `${(skill.progress / skill.total) * 100}%` },
                    ]}
                  />
                </View>
                <Text style={[styles.progressText, skill.locked && styles.progressTextDim]}>
                  {skill.progress}/{skill.total} steps
                </Text>
              </View>
            </View>

            {!skill.locked && <Text style={styles.chevron}>›</Text>}
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 56,
    paddingBottom: 20,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: C.cardBorder,
  },
  title: {
    fontFamily: F.heading,
    fontSize: 28,
    color: C.iceGlow,
    letterSpacing: 4,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: F.bodyMed,
    fontSize: 12,
    color: C.textMuted,
    letterSpacing: 3,
    marginTop: 4,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  list: {
    padding: 16,
    gap: 12,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.deepBlue,
    borderRadius: 8,
    padding: 16,
    gap: 14,
  },
  cardLocked: {
    backgroundColor: C.lockedBg,
    borderColor: C.lockedBorder,
    opacity: 0.6,
  },
  cardLeft: {
    width: 36,
    alignItems: 'center',
  },
  lockIcon: {
    fontSize: 22,
  },
  lockIconDim: {
    opacity: 0.4,
  },
  cardBody: {
    flex: 1,
    gap: 8,
  },
  skillName: {
    fontFamily: F.heading,
    fontSize: 13,
    color: C.text,
    letterSpacing: 1.5,
    textAlign: 'center',
  },
  skillNameDim: {
    color: C.textMuted,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  progressBarBg: {
    flex: 1,
    height: 3,
    backgroundColor: C.lockedBg,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: C.iceGlow,
    borderRadius: 2,
  },
  progressText: {
    fontFamily: F.body,
    fontSize: 11,
    color: C.iceGlow,
    letterSpacing: 0.5,
  },
  progressTextDim: {
    color: C.textMuted,
  },
  chevron: {
    fontSize: 24,
    color: C.iceGlow,
  },
});
