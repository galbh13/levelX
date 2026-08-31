import React, { useState, useRef, useLayoutEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { F } from '../constants/fonts';
import { C } from '../constants/colors';
import ScreenFrame from '../components/ScreenFrame';
import VideoPlayer from '../components/VideoPlayer';

function getYouTubeEmbedUrl(url) {
  if (!url) return null;
  const shortsMatch = url.match(/youtube\.com\/shorts\/([a-zA-Z0-9_-]+)/);
  const watchMatch  = url.match(/[?&]v=([a-zA-Z0-9_-]+)/);
  const id = shortsMatch?.[1] || watchMatch?.[1];
  return id ? `https://www.youtube.com/embed/${id}` : null;
}

// Largest {w,h} for a given ratio that fits inside a box — no letterbox bars.
function fitWithin(boxW, boxH, ratio) {
  let w = boxW;
  let h = w / ratio;
  if (h > boxH) { h = boxH; w = h * ratio; }
  return { w, h };
}

function SectionTitle({ children }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

// ─── Video renderer ───────────────────────────────────────────────────────────
// Priority: storage video (video_url) > YouTube embed (youtube_url) > placeholder

function VideoSection({ exercise, ratio, width, height, onRatio }) {
  const storageUrl = exercise.video_url;
  const embedUrl   = getYouTubeEmbedUrl(exercise.youtube_url);

  // Storage video — uploaded to Supabase. Both platforms go through the shared
  // VideoPlayer: it never autoplays, pauses when the screen loses focus, and
  // reports the clip's real aspect ratio on native as well as web (the old
  // native branch pointed a WebView at the bare .mp4, which reports no metadata
  // — every portrait phone clip sat letterboxed inside a default 16:9 box).
  if (storageUrl) {
    return (
      <VideoPlayer
        url={storageUrl}
        width={width}
        height={height}
        onRatio={onRatio}
        // Both pages mount up front — buffer now so the clip is ready the
        // instant the user swipes over to it.
        preload="auto"
      />
    );
  }

  // YouTube embed
  if (embedUrl) {
    if (Platform.OS === 'web') {
      return (
        <iframe
          src={embedUrl}
          style={{ width, height, border: 'none', display: 'block' }}
          allowFullScreen
          title="exercise video"
        />
      );
    }
    return (
      <WebView
        source={{ uri: embedUrl }}
        style={{ width, height }}
        allowsFullscreenVideo
        javaScriptEnabled
      />
    );
  }

  // No video
  return (
    <View style={[styles.noVideo, { width, height }]}>
      <Text style={styles.noVideoIcon}>▶</Text>
      <Text style={styles.noVideoText}>No video added yet</Text>
    </View>
  );
}

// ─── Coaching cues ────────────────────────────────────────────────────────────
// Cues are often written per VARIATION of the same movement — every line carries
// the variation it belongs to ("1. lean forward", "2 feet go backwards"). We strip
// that marker and tint the cue by its variation, so it reads as two sets of cues
// instead of one long list. The tints sit close on the hue wheel on purpose: a
// grouping signal, not a traffic light.
const CUE_TINTS = [
  { chip: '#4A9EBF', bg: 'rgba(74,158,191,0.14)', text: '#E8F4FF' },   // deep ice
  { chip: '#AFE3F2', bg: 'rgba(175,227,242,0.12)', text: '#F4FCFF' },  // white ice
  { chip: '#6E93D6', bg: 'rgba(110,147,214,0.14)', text: '#E6ECFF' },  // periwinkle
];

// "1. text" / "2.text" / "3 text" → { variation, text }.
const CUE_PREFIX = /^(\d{1,2})(?:[.):\-]\s*|\s+)/;

function parseCues(raw) {
  if (!raw) return [];
  const lines = raw.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const parsed = lines.map((line) => {
    const m = line.match(CUE_PREFIX);
    const body = m ? line.slice(m[0].length).trim() : line;
    // A bare number with nothing after it isn't a variation marker.
    if (!m || !body) return { variation: null, text: line };
    return { variation: Number(m[1]), text: body };
  });
  // Only read the numbers as variation markers when at least two lines carry one
  // — a single stray "3 sec hold" shouldn't repaint the whole list.
  if (parsed.filter(c => c.variation != null).length < 2) {
    return lines.map(text => ({ variation: null, text }));
  }
  return parsed;
}

// ─── Description ──────────────────────────────────────────────────────────────
// A description is free text, but the coach writes it in a recognisable shape:
// running sentences, "label - explanation" definitions, and the odd "important
// note:". Rendered as ONE wrapped paragraph they all look identical, and a
// wrapped continuation is indistinguishable from a new thought — which is what
// makes a long description feel like a wall. So we read that shape back out and
// give each kind its own block. Nothing about how it's typed changes.

// "back to wall - easier, we can stack reps" → { label, value }. The label is
// kept SHORT on purpose: a dash mid-sentence is punctuation, not a definition.
const DESC_PAIR = /^([^\-–—:]{2,26}?)\s*[-–—]\s+(\S.*)$/;
const DESC_NOTE = /^(important note|important|note|tip|warning)\s*[:\-]\s*(\S.*)$/i;

function parseDescription(raw) {
  if (!raw) return [];
  const lines = raw.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const blocks = [];
  for (const line of lines) {
    const note = line.match(DESC_NOTE);
    if (note) { blocks.push({ kind: 'note', tag: note[1], text: note[2] }); continue; }

    const pair = line.match(DESC_PAIR);
    if (pair) {
      const item = { label: pair[1].trim(), value: pair[2].trim() };
      const last = blocks[blocks.length - 1];
      // Consecutive definitions read as one list, not four loose lines.
      if (last?.kind === 'pairs') last.items.push(item);
      else blocks.push({ kind: 'pairs', items: [item] });
      continue;
    }

    const last = blocks[blocks.length - 1];
    if (last?.kind === 'text') last.lines.push(line);
    else blocks.push({ kind: 'text', lines: [line] });
  }
  return blocks;
}

// A definition whose whole value is a number ("back cues - 1") is the coach
// naming a VARIATION — the same number the cues below are tagged with. Tint it
// to match, and the description stops being prose and starts being a legend.
function variationOf(value) {
  const m = value.match(/^(\d{1,2})[.)]?$/);
  return m ? Number(m[1]) : null;
}

function tintFor(variation) {
  return variation != null
    ? CUE_TINTS[(variation - 1 + CUE_TINTS.length) % CUE_TINTS.length]
    : CUE_TINTS[0];
}

function DescriptionBody({ text }) {
  const blocks = parseDescription(text);
  if (blocks.length === 0) return null;

  return (
    <View style={styles.descBody}>
      {blocks.map((block, bi) => {
        if (block.kind === 'text') {
          return (
            <View key={bi} style={styles.descPara}>
              {block.lines.map((line, i) => (
                <Text key={i} style={styles.descLine}>{line}</Text>
              ))}
            </View>
          );
        }

        if (block.kind === 'note') {
          return (
            <View key={bi} style={styles.noteBox}>
              <Text style={styles.noteTag}>{block.tag.toUpperCase()}</Text>
              <Text style={styles.noteText}>{block.text}</Text>
            </View>
          );
        }

        return (
          <View key={bi} style={styles.pairGroup}>
            {block.items.map((item, i) => {
              const variation = variationOf(item.value);
              const tint = tintFor(variation);
              return (
                <View key={i} style={styles.pairRow}>
                  <View style={[styles.pairRail, { backgroundColor: tint.chip }]} />
                  <View style={styles.pairBody}>
                    <Text style={[styles.pairLabel, { color: tint.chip }]}>
                      {item.label.toUpperCase()}
                    </Text>
                    {variation != null ? (
                      <View style={[styles.pairChip, {
                        borderColor: tint.chip, backgroundColor: tint.bg,
                      }]}>
                        <Text style={[styles.pairChipText, { color: tint.chip }]}>
                          {variation}
                        </Text>
                      </View>
                    ) : (
                      <Text style={styles.pairValue}>{item.value}</Text>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ExerciseDetailScreen({ route, navigation }) {
  const { exercise } = route.params;
  // When opened from the workout-building exercise picker we're just previewing
  // the movement, not authoring the catalog — hide EDIT so it can't be changed there.
  const hideEdit = route.params?.hideEdit ?? false;

  // Default to 16:9 until the real video metadata loads, then snap to its ratio.
  const [ratio, setRatio] = useState(16 / 9);
  // Measured size of the pager area — each page fills exactly this.
  const [size, setSize] = useState(null);
  // 0 = info (left screen), 1 = video (right screen). Land on the video first.
  const [page, setPage] = useState(1);

  const pagerRef = useRef(null);
  const didInit = useRef(false);
  // The pager stays invisible until the initial jump to the video page has been
  // applied — otherwise the info (description) page flashes for a frame first.
  const [jumped, setJumped] = useState(false);

  const cues = parseCues(exercise.coaching_cues);

  // Once we know the page width, jump to the video page (rightmost) without a
  // visible scroll animation. useLayoutEffect so the jump (and the reveal below)
  // happen BEFORE the browser paints — no one-frame flash of the info page.
  useLayoutEffect(() => {
    if (size && pagerRef.current && !didInit.current) {
      didInit.current = true;
      pagerRef.current.scrollTo({ x: size.width, animated: false });
      setJumped(true);
    }
  }, [size]);

  const onLayout = (e) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }));
  };

  const onScroll = (e) => {
    if (!size) return;
    const x = e.nativeEvent.contentOffset.x;
    const p = Math.round(x / size.width);
    if (p !== page) setPage(p);
  };

  const goToPage = (p) => {
    if (size && pagerRef.current) {
      pagerRef.current.scrollTo({ x: p * size.width, animated: true });
    }
    setPage(p);
  };

  // ── The two pages ──────────────────────────────────────────────────────────
  const infoPage = size && (
    <ScrollView
      style={{ width: size.width, height: size.height }}
      contentContainerStyle={styles.infoContent}
      showsVerticalScrollIndicator={false}
    >
      {/* Hero — a bold accent bar anchors the movement name; the type sits as a
          glowing eyebrow above it, and a gradient rule closes the block. */}
      <View style={styles.hero}>
        {!!exercise.movement_type && (
          <View style={styles.typeBadge}>
            <Text style={styles.typeText}>{exercise.movement_type}</Text>
          </View>
        )}
        <View style={styles.titleRow}>
          <View style={styles.titleBar} />
          <Text style={styles.title}>{exercise.name}</Text>
        </View>
        {!!exercise.added_by_name && (
          <Text style={styles.addedBy}>ADDED BY {exercise.added_by_name?.toUpperCase()}</Text>
        )}
      </View>

      <View style={styles.heroRule} />

      {!!exercise.description && (
        <View style={styles.sectionCard}>
          <View style={styles.sectionHead}>
            <View style={styles.sectionIcon}><Text style={styles.sectionIconText}>≡</Text></View>
            <SectionTitle>DESCRIPTION</SectionTitle>
          </View>
          <DescriptionBody text={exercise.description} />
        </View>
      )}

      {cues.length > 0 && (
        <View style={styles.sectionCard}>
          <View style={styles.sectionHead}>
            <View style={styles.sectionIcon}><Text style={styles.sectionIconText}>✓</Text></View>
            <SectionTitle>COACHING CUES</SectionTitle>
          </View>
          <View style={styles.cueList}>
            {cues.map((cue, i) => {
              const tint = cue.variation != null
                ? CUE_TINTS[(cue.variation - 1 + CUE_TINTS.length) % CUE_TINTS.length]
                : CUE_TINTS[0];
              return (
                <View key={i} style={styles.cueRow}>
                  <View style={[styles.cueIndex, {
                    borderColor: tint.chip,
                    backgroundColor: tint.bg,
                    shadowColor: tint.chip,
                  }]}>
                    <Text style={[styles.cueIndexText, { color: tint.chip }]}>
                      {cue.variation != null ? cue.variation : i + 1}
                    </Text>
                  </View>
                  <Text style={[styles.cueText, { color: tint.text }]}>{cue.text}</Text>
                </View>
              );
            })}
          </View>
        </View>
      )}
    </ScrollView>
  );

  const videoPage = size && (() => {
    const { w, h } = fitWithin(size.width - 24, size.height - 24, ratio);
    return (
      <View style={[styles.videoPage, { width: size.width, height: size.height }]}>
        <View style={[styles.videoWrap, { width: w, height: h }]}>
          <VideoSection
            exercise={exercise}
            ratio={ratio}
            width={w}
            height={h}
            onRatio={setRatio}
          />
        </View>
      </View>
    );
  })();

  return (
    <ScreenFrame fill>
      <View style={styles.card}>
        {/* Slim top bar: BACK · page dots · EDIT */}
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.pill}>
            <Text style={styles.pillText}>← BACK</Text>
          </TouchableOpacity>

          <View style={styles.dots}>
            <TouchableOpacity onPress={() => goToPage(0)} hitSlop={8}>
              <View style={[styles.dot, page === 0 && styles.dotActive]} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => goToPage(1)} hitSlop={8}>
              <View style={[styles.dot, page === 1 && styles.dotActive]} />
            </TouchableOpacity>
          </View>

          {hideEdit ? (
            /* Spacer keeps the page dots centered when EDIT is hidden. */
            <View style={styles.pillSpacer} />
          ) : (
            <TouchableOpacity
              onPress={() => navigation.navigate('AddExercise', { exercise })}
              style={styles.pill}
            >
              <Text style={styles.pillText}>✎ EDIT</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Swipeable pager — info (left) ⇄ video (right) */}
        <View style={styles.pagerArea} onLayout={onLayout}>
          {size && (
            <ScrollView
              ref={pagerRef}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onScroll={onScroll}
              scrollEventThrottle={16}
              style={[styles.pager, !jumped && { opacity: 0 }]}
            >
              {infoPage}
              {videoPage}
            </ScrollView>
          )}
        </View>
      </View>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1, backgroundColor: C.bg },

  // ── Top bar ──
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: C.cardBorder,
  },
  // Glowing ice pill (BACK / EDIT).
  pill: {
    paddingHorizontal: 16, paddingVertical: 9,
    borderRadius: 22, borderWidth: 1.5, borderColor: C.iceGlow,
    backgroundColor: 'rgba(74,158,191,0.10)',
    shadowColor: C.iceGlow, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.45, shadowRadius: 10,
  },
  pillText: { fontFamily: F.heading, color: C.iceGlow, fontSize: 14, letterSpacing: 2 },
  // Reserves the EDIT pill's footprint so the page dots stay centered when hidden.
  pillSpacer: { width: 84 },

  dots: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: {
    width: 9, height: 9, borderRadius: 999,
    backgroundColor: 'rgba(74,158,191,0.28)',
  },
  dotActive: {
    backgroundColor: C.iceGlow,
    shadowColor: C.iceGlow, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 8,
  },

  // ── Pager ──
  pagerArea: { flex: 1 },
  pager: { flex: 1 },

  // ── Video page ──
  videoPage: {
    justifyContent: 'center', alignItems: 'center',
    backgroundColor: C.lockedBg,
  },
  videoWrap: {
    backgroundColor: C.lockedBg,
    borderRadius: 14, overflow: 'hidden',
    borderWidth: 1, borderColor: C.cardBorder,
  },
  noVideo: {
    backgroundColor: C.lockedBg, justifyContent: 'center', alignItems: 'center', gap: 10,
  },
  noVideoIcon: { fontSize: 30, color: C.textMuted },
  noVideoText: {
    fontFamily: F.bodyMed, fontSize: 12, color: C.textMuted, letterSpacing: 2,
    textTransform: 'uppercase',
  },

  // ── Info page ──
  // flexGrow lets short content spread down the page instead of clumping at the top.
  infoContent: {
    flexGrow: 1,
    paddingHorizontal: 24, paddingTop: 36, paddingBottom: 48,
    gap: 24,
  },

  // Hero header — left-aligned, editorial. Accent bar + glowing title.
  hero: { gap: 18 },
  titleRow: { flexDirection: 'row', alignItems: 'stretch', gap: 16 },
  // Tall glowing bar beside the title, like a chapter marker.
  titleBar: {
    width: 5, borderRadius: 3, backgroundColor: C.iceGlow,
    shadowColor: C.iceGlow, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.9, shadowRadius: 12,
  },
  title: {
    flex: 1,
    fontFamily: F.heading, fontSize: 34, color: C.text,
    letterSpacing: 2.5, textTransform: 'uppercase', lineHeight: 42,
    textShadowColor: 'rgba(74,158,191,0.45)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 18,
  },

  // Movement-type "eyebrow" above the title.
  typeBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(74,158,191,0.14)',
    borderWidth: 1.5, borderColor: C.iceGlow, borderRadius: 999,
    paddingHorizontal: 18, paddingVertical: 7,
    shadowColor: C.iceGlow, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 8,
  },
  typeText: {
    fontFamily: F.heading, fontSize: 13, color: C.iceGlow,
    letterSpacing: 3, textTransform: 'uppercase',
  },

  addedBy: {
    fontFamily: F.bodyMed, fontSize: 11, color: C.textMuted,
    letterSpacing: 2, marginLeft: 21,
  },

  // Glowing rule that closes the hero and separates it from the content.
  heroRule: {
    height: 2, borderRadius: 2, backgroundColor: C.iceGlow, opacity: 0.35,
    shadowColor: C.iceGlow, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.7, shadowRadius: 8,
  },

  // Content cards — a distinctly lighter navy panel with a glowing left accent
  // rail, so each section reads as its own raised block instead of flat text.
  sectionCard: {
    backgroundColor: C.lockedBg,
    borderWidth: 1, borderColor: C.lockedBorder, borderRadius: 18,
    borderLeftWidth: 4, borderLeftColor: C.iceGlow,
    paddingHorizontal: 22, paddingVertical: 22, gap: 18,
    shadowColor: C.iceGlow, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.14, shadowRadius: 16,
  },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sectionIcon: {
    width: 30, height: 30, borderRadius: 8,
    borderWidth: 1.5, borderColor: C.iceGlow, backgroundColor: 'rgba(74,158,191,0.12)',
    justifyContent: 'center', alignItems: 'center',
    shadowColor: C.iceGlow, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 6,
  },
  sectionIconText: { fontFamily: F.heading, fontSize: 16, color: C.iceGlow, marginTop: -1 },
  sectionTitle: {
    fontFamily: F.heading, fontSize: 15, color: C.iceGlow,
    letterSpacing: 3, textTransform: 'uppercase',
  },
  bodyText: {
    fontFamily: F.body, fontSize: 18, color: C.text, lineHeight: 30, letterSpacing: 0.4,
  },

  // Description blocks. The gap BETWEEN blocks is bigger than the gap between
  // lines inside one — that difference is the whole trick: it tells the eye
  // where a thought ends without adding a single word.
  descBody: { gap: 20 },
  descPara: { gap: 7 },
  descLine: {
    fontFamily: F.body, fontSize: 17, color: C.text, lineHeight: 26, letterSpacing: 0.4,
  },

  // "label - explanation" — the label becomes a heading, so the explanation can
  // wrap without the reader losing which term it belongs to. The rail binds the
  // wrapped lines back to it.
  pairGroup: { gap: 14 },
  pairRow: { flexDirection: 'row', alignItems: 'stretch', gap: 12 },
  pairRail: { width: 3, borderRadius: 2, opacity: 0.7 },
  pairBody: { flex: 1 },
  pairLabel: {
    fontFamily: F.heading, fontSize: 13, letterSpacing: 2.2, marginBottom: 5,
  },
  pairValue: {
    fontFamily: F.body, fontSize: 17, color: C.text, lineHeight: 26, letterSpacing: 0.4,
  },
  // A definition whose value is just a variation number reads as a legend chip,
  // matching the cue chips further down the card.
  pairChip: {
    width: 26, height: 26, borderRadius: 999, borderWidth: 1.5,
    justifyContent: 'center', alignItems: 'center',
  },
  pairChipText: { fontFamily: F.heading, fontSize: 13 },

  noteBox: {
    borderWidth: 1, borderColor: 'rgba(74,158,191,0.35)', borderRadius: 12,
    backgroundColor: 'rgba(74,158,191,0.07)', padding: 14, gap: 6,
  },
  noteTag: {
    fontFamily: F.heading, fontSize: 11, color: C.iceGlow, letterSpacing: 2.4,
  },
  noteText: {
    fontFamily: F.body, fontSize: 17, color: C.text, lineHeight: 26, letterSpacing: 0.4,
  },

  cueList: { gap: 16 },
  cueRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  // Glowing numbered chip per cue.
  cueIndex: {
    width: 26, height: 26, borderRadius: 999,
    borderWidth: 1.5, borderColor: C.iceGlow, backgroundColor: 'rgba(74,158,191,0.14)',
    justifyContent: 'center', alignItems: 'center', marginTop: 2,
    shadowColor: C.iceGlow, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 6,
  },
  cueIndexText: { fontFamily: F.heading, fontSize: 13, color: C.iceGlow },
  cueText: {
    fontFamily: F.body, fontSize: 18, color: C.text,
    lineHeight: 28, flex: 1, letterSpacing: 0.4,
  },
});
