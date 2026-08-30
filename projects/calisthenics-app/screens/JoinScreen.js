import { View, Text, Image, StyleSheet, Linking, Platform } from 'react-native';
import { C } from '../constants/colors';
import { F } from '../constants/fonts';
import ScreenFrame from '../components/ScreenFrame';
import ScreenHeader from '../components/ScreenHeader';
import PillButton from '../components/PillButton';
import VideoPlayer from '../components/VideoPlayer';

// ─── The recruitment page ────────────────────────────────────────────────────
// There is no self-serve sign-up (see CLAUDE.md): the coach creates every
// account. So anyone who finds the app in the store and installs it hits the
// login card with nothing to type. That dead end is the best piece of funnel the
// app has — this screen catches it.
//
// Reached from LoginScreen's "I don't have an account" link; App.js owns the
// toggle, because the logged-out tree renders with NO navigator.
//
// STRUCTURE — modelled on the high-ticket coaching funnel (hero → proof →
// offer → story → mechanism → qualify → ask), compressed to what one coach can
// honestly claim today:
//   hero + CTA → video → what you get → how you get in → is this you → CTA
// The CTA appears three times and is always the same one: Instagram. There is
// never a second competing action, and there is no price anywhere — price is
// for the conversation.

// ═════════════════════════════════════════════════════════════════════════════
//  CONTENT — everything you fill in lives in this block. Nothing below it needs
//  touching. Every slot is null/empty-safe: an unfilled section simply does not
//  render, so the page is never showing a placeholder to a stranger.
// ═════════════════════════════════════════════════════════════════════════════

// BUILD MODE. While true, an unfilled slot renders a dashed "reserved" panel so
// the layout can be reviewed with nothing in it yet. FLIP THIS TO false BEFORE
// THE PAGE IS SHOWN TO ANYONE REAL — at false every unfilled slot disappears
// completely and the page closes up around it.
const PREVIEW_EMPTY_SLOTS = false;

// The pitch video. A direct/streamable URL (Cloudinary mp4, same pipeline as the
// signature clips). Until it is set, the slot renders a "coming soon" panel.
const INTRO_VIDEO_URL = null;

// The proof strip — the honest version of their "4,000+ businesses built" wall.
// Three tiles, no more. Use numbers you can defend out loud.
// e.g. { value: '7', label: 'YEARS UNDER THE BAR' }
//      { value: '12', label: 'SKILLS UNLOCKED' }
//      { value: '60s', label: 'FREESTANDING HANDSTAND' }
const STATS = [];

// Transformation — before/after. Set both URLs and the block renders; leave
// either null and it stays hidden. `caption` is one line under the pair.
const TRANSFORMATIONS = [
  // { name: 'MY OWN', beforeUrl: null, afterUrl: null, caption: 'Where I started and what the system built.' },
];

// The first disciple. One real story beats twelve anonymous ones at this stage.
// { name: 'RON', line: 'What he could not do before', quote: 'His words, in his voice.' }
const FIRST_DISCIPLE = null;

// Contact channels. A null channel doesn't render its button — no dead links.
// How many places are open. Shown on the closing card. Set to null to hide the
// line entirely. Keep it honest and keep it moving down.
const SPOTS_LEFT = null;

const CONTACT = {
  email:     'the.handstand.system@gmail.com',
  whatsapp:  '972533453199',   // digits only, country code, no + or spaces
  instagram: 'galbh.13',       // handle without the @
};

// ═════════════════════════════════════════════════════════════════════════════

const APPLY_WA = 'I would like to apply for The System.';

const PILLARS = [
  ['A personalized system',
    'Customized and adjusted to your level, your schedule and your goals.'],
  ['Detailed feedback',
    'Every week I go through your videos and your answers, and send my feedback back on record.'],
  ['Cheats of the elite',
    'Nutrition, recovery, sleep and mentality. The parts that decide how fast you actually progress.'],
  ['Elites only',
    'A winning environment of athletes who want to be the best.'],
];

const STEPS = [
  'DM me on Instagram',
  'We see where you are at and how I can help',
  'We build the system that gets you to your goals',
];

const FOR_YOU = [
  'You are obsessed with the handstand. You do not want to try it. You want to own it.',
  'You take responsibility for your own progress and you do not blame circumstances.',
  'You do not settle. You want it fast and you want crazy results.',
];
const NOT_FOR_YOU = [
  'You are not consistent, not serious, and will not take responsibility for your own progress.',
  'You are looking for guaranteed results.',
  'You quit when it gets hard.',
];

function openWhatsApp() {
  Linking.openURL(`https://wa.me/${CONTACT.whatsapp}?text=${encodeURIComponent(APPLY_WA)}`).catch(() => {});
}
function openInstagram() {
  Linking.openURL(`https://instagram.com/${CONTACT.instagram}`).catch(() => {});
}

// The one action on the page. Repeated, never varied — `compact` is the
// mid-page version (single button, no supporting copy) so the full card stays
// reserved for the close at the bottom.
function ApplyCTA({ compact = false }) {
  const primary = (
    <PillButton
      label={`DM ME ON IG @${CONTACT.instagram}`}
      onPress={openInstagram}
      variant="solid" tone="accent" size="lg" style={styles.ctaBtn}
    />
  );

  if (compact) return <View style={styles.ctaCompact}>{primary}</View>;

  return (
    <View style={styles.cta}>
      {SPOTS_LEFT ? (
        <View style={styles.spots}>
          <Text style={styles.spotsText}>{SPOTS_LEFT} SPOTS LEFT</Text>
        </View>
      ) : null}
      <Text style={styles.ctaTitle}>TAKING ACTION</Text>
      <Text style={styles.ctaText}>
        I only coach the best. If you want to be the best, DM me.
      </Text>
      <View style={styles.ctaButtons}>
        {primary}
        {CONTACT.whatsapp ? (
          <PillButton label="OR WHATSAPP" onPress={openWhatsApp} variant="outline" tone="muted" size="md" style={styles.ctaBtn} />
        ) : null}
      </View>
    </View>
  );
}

// A reserved, dashed panel standing in for content that has not been supplied
// yet. Only ever rendered while PREVIEW_EMPTY_SLOTS is true.
function EmptySlot({ title, note, style }) {
  return (
    <View style={[styles.slot, style]}>
      <Text style={styles.slotTitle}>{title}</Text>
      {note ? <Text style={styles.slotNote}>{note}</Text> : null}
    </View>
  );
}

function Section({ label, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label}</Text>
      <View style={styles.rule} />
      {children}
    </View>
  );
}

export default function JoinScreen({ onBack }) {
  const transformations = TRANSFORMATIONS.filter((t) => t?.beforeUrl && t?.afterUrl);

  return (
    <ScreenFrame holoEntry={false}>
      {/* ScreenHeader's side slots are equal-flex, but only a slot WITH content
         reserves pill width — so a lone BACK pill grows the left slot and nudges
         the title right of centre. An invisible mirror of the pill on the right
         makes the two slots exactly the same width, so the title sits dead
         centre. Non-interactive, and no change to the shared header. */}
      <ScreenHeader
        title="THE SYSTEM"
        onBack={onBack}
        right={
          <View pointerEvents="none" style={styles.headerMirror}>
            <PillButton label="← BACK" size="sm" />
          </View>
        }
      />

      <View style={styles.body}>

        {/* ── 1. Hero ── */}
        <Text style={styles.heroLine}>Exclusive to</Text>
        <Text style={styles.heroLine2}>Gal's disciples.</Text>
        <Text style={styles.heroSub}>
          One-on-one handstand coaching on a proven formula that gets you there
          fast, and builds the wrists, shoulders and mobility to keep you out of
          injury.
        </Text>
        <ApplyCTA compact />

        {/* ── 2. Proof strip ── */}
        {STATS.length ? (
          <View style={styles.stats}>
            {STATS.slice(0, 3).map((s) => (
              <View key={s.label} style={styles.statTile}>
                <Text style={styles.statValue}>{s.value}</Text>
                <Text style={styles.statLabel}>{s.label}</Text>
              </View>
            ))}
          </View>
        ) : PREVIEW_EMPTY_SLOTS ? (
          <View style={styles.stats}>
            {[1, 2, 3].map((i) => (
              <View key={i} style={[styles.statTile, styles.statTileEmpty]}>
                <Text style={styles.statValueEmpty}>00</Text>
                <Text style={styles.statLabelEmpty}>YOUR{'\n'}NUMBER {i}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* ── 3. Video ── */}
        <View style={styles.videoWrap}>
          {INTRO_VIDEO_URL ? (
            <VideoPlayer url={INTRO_VIDEO_URL} height={260} style={{ borderRadius: 14 }} />
          ) : (
            <View style={styles.videoStub}>
              <Text style={styles.videoStubIcon}>▶</Text>
              <Text style={styles.videoStubTitle}>WATCH THIS FIRST</Text>
              <Text style={styles.videoStubText}>
                Two minutes on what this is and who it is for. Coming shortly.
              </Text>
            </View>
          )}
        </View>

        {/* ── 4. What you get ── */}
        <Section label="WHAT YOU GET">
          {PILLARS.map(([title, text]) => (
            <View key={title} style={styles.getRow}>
              <Text style={styles.getMark}>◆</Text>
              <View style={styles.getBody}>
                <Text style={styles.getTitle}>{title}</Text>
                <Text style={styles.getText}>{text}</Text>
              </View>
            </View>
          ))}
        </Section>

        {/* ── 5. Transformation ── */}
        {transformations.length ? (
          <Section label="WHAT IT BUILDS">
            {transformations.map((t) => (
              <View key={t.name} style={styles.transform}>
                <Text style={styles.transformName}>{t.name}</Text>
                <View style={styles.transformPair}>
                  <View style={styles.transformCell}>
                    <Image source={{ uri: t.beforeUrl }} style={styles.transformImg} resizeMode="cover" />
                    <Text style={styles.transformTag}>BEFORE</Text>
                  </View>
                  <View style={styles.transformCell}>
                    <Image source={{ uri: t.afterUrl }} style={styles.transformImg} resizeMode="cover" />
                    <Text style={[styles.transformTag, styles.transformTagAfter]}>AFTER</Text>
                  </View>
                </View>
                {t.caption ? <Text style={styles.transformCaption}>{t.caption}</Text> : null}
              </View>
            ))}
            <ApplyCTA compact />
          </Section>
        ) : PREVIEW_EMPTY_SLOTS ? (
          <Section label="WHAT IT BUILDS">
            <View style={styles.transformPair}>
              <EmptySlot title="BEFORE" note="Photo" style={styles.slotHalf} />
              <EmptySlot title="AFTER" note="Photo" style={styles.slotHalf} />
            </View>
            <Text style={styles.slotHint}>Your transformation — two photos, same angle, plus one line of caption.</Text>
            <ApplyCTA compact />
          </Section>
        ) : null}

        {/* ── 6. First disciple ── */}
        {FIRST_DISCIPLE?.quote ? (
          <Section label="THE FIRST DISCIPLE">
            <View style={styles.quoteCard}>
              <Text style={styles.quoteMark}>“</Text>
              <Text style={styles.quoteText}>{FIRST_DISCIPLE.quote}</Text>
              <Text style={styles.quoteName}>— {FIRST_DISCIPLE.name}</Text>
              {FIRST_DISCIPLE.line ? <Text style={styles.quoteLine}>{FIRST_DISCIPLE.line}</Text> : null}
            </View>
          </Section>
        ) : PREVIEW_EMPTY_SLOTS ? (
          <Section label="THE FIRST DISCIPLE">
            <EmptySlot title="QUOTE" note="Your brother, in his own words — what he couldn't do before, what he can do now." />
          </Section>
        ) : null}

        {/* ── 7. How you get in ── */}
        <Section label="HOW YOU GET IN">
          {STEPS.map((title, i) => (
            <View key={title} style={styles.step}>
              <View style={styles.stepNum}><Text style={styles.stepNumText}>{i + 1}</Text></View>
              <Text style={styles.stepTitle}>{title}</Text>
            </View>
          ))}
          <Text style={styles.stepsFoot}>That's really all it takes...</Text>
        </Section>

        {/* ── 8. Qualify ── */}
        <Section label="IS THIS YOU?">
          <View style={styles.fitBlock}>
            <Text style={[styles.fitHead, styles.fitHeadYes]}>THIS IS FOR YOU IF</Text>
            {FOR_YOU.map((t) => (
              <View key={t} style={styles.fitRow}>
                <Text style={[styles.fitMark, styles.fitMarkYes]}>✓</Text>
                <Text style={styles.fitText}>{t}</Text>
              </View>
            ))}
          </View>
          <View style={styles.fitBlock}>
            <Text style={[styles.fitHead, styles.fitHeadNo]}>DO NOT APPLY IF</Text>
            {NOT_FOR_YOU.map((t) => (
              <View key={t} style={styles.fitRow}>
                <Text style={[styles.fitMark, styles.fitMarkNo]}>✕</Text>
                <Text style={styles.fitText}>{t}</Text>
              </View>
            ))}
          </View>
        </Section>

        {/* ── 9. The close ── */}
        <ApplyCTA />

        <View style={styles.footerBtn}>
          <PillButton label="← BACK TO LOGIN" onPress={onBack} variant="outline" tone="muted" size="md" />
        </View>
      </View>
    </ScreenFrame>
  );
}

const ACCENT = C.iceGlow;
const DIM = '#8fb3cc';

const styles = StyleSheet.create({
  body: { paddingHorizontal: 30, paddingBottom: 46 },

  // Invisible spacer twin of the BACK pill — see the header comment above.
  headerMirror: { opacity: 0 },

  // ── Hero ──
  eyebrow: {
    fontFamily: F.heading, fontSize: 14, color: C.textMuted,
    letterSpacing: 5, textTransform: 'uppercase', textAlign: 'center', marginTop: 10,
  },
  heroLine: {
    fontFamily: F.heading, fontSize: 40, color: ACCENT, textAlign: 'center', letterSpacing: 1,
    marginTop: 26,
    textShadowColor: 'rgba(74,158,191,0.32)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 14,
  },
  heroLine2: {
    fontFamily: F.heading, fontSize: 40, color: C.text, textAlign: 'center', letterSpacing: 1, marginTop: 2,
  },
  heroSub: {
    fontFamily: F.bodyMed, fontSize: 20, lineHeight: 30, color: DIM,
    textAlign: 'center', marginTop: 20,
  },

  // ── Proof strip ──
  stats: { flexDirection: 'row', gap: 12, marginTop: 34 },
  statTile: {
    flex: 1, borderWidth: 1.5, borderColor: C.cardBorder, borderRadius: 14,
    backgroundColor: C.surface, paddingVertical: 20, paddingHorizontal: 8, alignItems: 'center',
  },
  statValue: {
    fontFamily: F.heading, fontSize: 34, color: ACCENT,
    textShadowColor: 'rgba(74,158,191,0.5)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 16,
  },
  statLabel: {
    fontFamily: F.heading, fontSize: 12, color: C.textMuted, letterSpacing: 2,
    textTransform: 'uppercase', textAlign: 'center', marginTop: 8, lineHeight: 17,
  },

  // Preview-only: an unfilled tile still holds its shape so the strip can be
  // judged empty. Muted and dashed so it can never read as a real claim.
  statTileEmpty: { borderStyle: 'dashed', borderColor: '#1a3050', backgroundColor: 'transparent' },
  statValueEmpty: { fontFamily: F.heading, fontSize: 34, color: '#1a3050' },
  statLabelEmpty: {
    fontFamily: F.heading, fontSize: 12, color: '#1a3050', letterSpacing: 2,
    textTransform: 'uppercase', textAlign: 'center', marginTop: 8, lineHeight: 17,
  },

  // ── Reserved slots (preview only) ──
  slot: {
    borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#1a3050', borderRadius: 14,
    paddingVertical: 34, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center',
  },
  slotHalf: { flex: 1, aspectRatio: 3 / 4, paddingVertical: 12 },
  slotTitle: {
    fontFamily: F.heading, fontSize: 15, color: '#2a4a6a', letterSpacing: 4, textTransform: 'uppercase',
  },
  slotNote: {
    fontFamily: F.bodyMed, fontSize: 15, lineHeight: 23, color: '#1a3050',
    textAlign: 'center', marginTop: 8,
  },
  slotHint: {
    fontFamily: F.bodyMed, fontSize: 16, lineHeight: 24, color: C.textMuted,
    textAlign: 'center', marginTop: 14,
  },

  // ── Video ──
  videoWrap: {
    marginTop: 34, borderRadius: 14, overflow: 'hidden',
    borderWidth: 1.5, borderColor: C.cardBorder, backgroundColor: C.surface,
  },
  videoStub: { paddingVertical: 46, paddingHorizontal: 28, alignItems: 'center' },
  videoStubIcon: { fontFamily: F.heading, fontSize: 34, color: ACCENT, marginBottom: 12 },
  videoStubTitle: {
    fontFamily: F.heading, fontSize: 20, color: ACCENT, letterSpacing: 5, textTransform: 'uppercase',
  },
  videoStubText: {
    fontFamily: F.bodyMed, fontSize: 17, lineHeight: 26, color: C.textMuted,
    textAlign: 'center', marginTop: 10,
  },

  // ── Sections ──
  section: { marginTop: 42 },
  sectionLabel: {
    fontFamily: F.heading, fontSize: 19, color: ACCENT, letterSpacing: 5, textTransform: 'uppercase',
    textShadowColor: 'rgba(74,158,191,0.4)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 14,
  },
  rule: { height: 1.5, backgroundColor: C.cardBorder, marginTop: 12, marginBottom: 20 },

  // ── Pillars ──
  getRow: { flexDirection: 'row', gap: 14, marginBottom: 20 },
  getMark: { fontFamily: F.body, fontSize: 16, color: ACCENT, marginTop: 4 },
  getBody: { flex: 1 },
  getTitle: { fontFamily: F.body, fontSize: 19, color: C.text, marginBottom: 3 },
  getText: { fontFamily: F.bodyMed, fontSize: 18, lineHeight: 27, color: DIM },

  // ── Transformation ──
  transform: { marginBottom: 24 },
  transformName: {
    fontFamily: F.heading, fontSize: 17, color: C.text, letterSpacing: 3,
    textTransform: 'uppercase', marginBottom: 12,
  },
  transformPair: { flexDirection: 'row', gap: 12 },
  transformCell: {
    flex: 1, borderRadius: 14, overflow: 'hidden',
    borderWidth: 1.5, borderColor: C.cardBorder, backgroundColor: C.surface,
  },
  transformImg: { width: '100%', aspectRatio: 3 / 4, backgroundColor: C.lockedBg },
  transformTag: {
    fontFamily: F.heading, fontSize: 13, color: C.textMuted, letterSpacing: 3,
    textTransform: 'uppercase', textAlign: 'center', paddingVertical: 9,
  },
  transformTagAfter: { color: ACCENT },
  transformCaption: {
    fontFamily: F.bodyMed, fontSize: 17, lineHeight: 26, color: DIM,
    textAlign: 'center', marginTop: 12,
  },

  // ── Quote ──
  quoteCard: {
    borderWidth: 1.5, borderColor: C.cardBorder, borderRadius: 14,
    backgroundColor: C.surface, padding: 24,
  },
  quoteMark: { fontFamily: F.display, fontSize: 42, color: ACCENT, lineHeight: 44, marginBottom: -6 },
  quoteText: { fontFamily: F.bodyMed, fontSize: 19, lineHeight: 30, color: C.text, fontStyle: 'italic' },
  quoteName: {
    fontFamily: F.heading, fontSize: 16, color: ACCENT, letterSpacing: 3,
    textTransform: 'uppercase', marginTop: 16,
  },
  quoteLine: { fontFamily: F.bodyMed, fontSize: 16, lineHeight: 24, color: C.textMuted, marginTop: 4 },

  // ── Steps ──
  step: { flexDirection: 'row', gap: 16, marginBottom: 18, alignItems: 'center' },
  stepNum: {
    width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: ACCENT,
    backgroundColor: 'rgba(74,158,191,0.10)', justifyContent: 'center', alignItems: 'center',
    shadowColor: ACCENT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.45, shadowRadius: 10,
  },
  stepsFoot: {
    fontFamily: F.bodyMed, fontSize: 19, lineHeight: 28, color: ACCENT,
    marginTop: 6, marginLeft: 60,
  },
  stepNumText: { fontFamily: F.heading, fontSize: 20, color: ACCENT },
  stepTitle: {
    flex: 1, fontFamily: F.heading, fontSize: 20, color: C.text, letterSpacing: 2,
    textTransform: 'uppercase', lineHeight: 28,
  },

  // ── Qualify ──
  fitBlock: {
    borderWidth: 1.5, borderColor: C.cardBorder, borderRadius: 14, backgroundColor: C.surface,
    padding: 20, marginBottom: 16,
  },
  fitHead: { fontFamily: F.heading, fontSize: 16, letterSpacing: 4, textTransform: 'uppercase', marginBottom: 14 },
  fitHeadYes: { color: '#1FD79A' },
  fitHeadNo:  { color: C.alarmRed },
  fitRow: { flexDirection: 'row', gap: 12, marginBottom: 10 },
  fitMark: { fontFamily: F.body, fontSize: 18, marginTop: 1 },
  fitMarkYes: { color: '#1FD79A' },
  fitMarkNo:  { color: C.alarmRed },
  fitText: { flex: 1, fontFamily: F.bodyMed, fontSize: 18, lineHeight: 27, color: C.text },

  // ── CTA ──
  ctaCompact: { marginTop: 26 },
  spots: {
    borderWidth: 1.5, borderColor: C.alarmRed, borderRadius: 999,
    paddingHorizontal: 16, paddingVertical: 7, marginBottom: 16,
    backgroundColor: 'rgba(255,77,79,0.10)',
  },
  spotsText: {
    fontFamily: F.heading, fontSize: 14, color: C.alarmRed, letterSpacing: 3,
  },
  cta: {
    marginTop: 44, borderWidth: 1.5, borderColor: ACCENT, borderRadius: 18,
    backgroundColor: 'rgba(74,158,191,0.07)', padding: 28, alignItems: 'center',
    shadowColor: ACCENT, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.35, shadowRadius: 20,
  },
  ctaTitle: {
    fontFamily: F.heading, fontSize: 26, color: ACCENT, letterSpacing: 5, textTransform: 'uppercase',
    textAlign: 'center',
    textShadowColor: 'rgba(74,158,191,0.55)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 20,
  },
  ctaText: {
    fontFamily: F.bodyMed, fontSize: 19, lineHeight: 29, color: C.text,
    textAlign: 'center', marginTop: 12,
  },
  ctaButtons: { width: '100%', marginTop: 24, gap: 14 },
  ctaBtn: { width: '100%' },
  ctaFine: {
    fontFamily: F.bodyMed, fontSize: 16, color: C.textMuted, marginTop: 18, textAlign: 'center',
    ...(Platform.OS === 'web' ? { userSelect: 'text' } : null),
  },

  footer: {
    fontFamily: F.bodyMed, fontSize: 17, lineHeight: 26, color: C.textMuted,
    textAlign: 'center', marginTop: 36,
  },
  footerBtn: { alignItems: 'center', marginTop: 34 },
});
