import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { F } from '../constants/fonts';
import { C } from '../constants/colors';
import { supabase } from '../lib/supabase';
import ScreenFrame from '../components/ScreenFrame';
import ScreenHeader from '../components/ScreenHeader';
import PillButton from '../components/PillButton';
import {
  WEEK_FIELDS, emptyPlan, fetchPlan, saveWeek, isWeekEmpty, planHasContent,
  fetchPlanStart, setPlanStart, clearPlanStart,
  planProgress, weekState, weekDates, formatDay, addDays, DAYS_PER_WEEK,
} from '../lib/fourWeekPlan';
import { israelToday } from '../lib/israelDate';

// ─── THE 4-WEEK PLAN ────────────────────────────────────────────────────────────
// The special node on the PROFILE tab, and the coach's onboarding runway. Why it
// exists and how it's stored: supabase/migrations/20260919_four_week_plan.sql.
//
// ONE SCREEN, TWO JOBS — the same split PersonalScreen makes, for the same
// reason. The player READS their four weeks; the coach WRITES them, and writes
// them from inside the player's own page (AdminDashboard → player → PROFILE →
// 4-WEEK PLAN) so the plan is authored in the exact layout it will be read in.
// `studentId` in the route params is what tells the two apart: the player's own
// tab passes nothing and the screen resolves the signed-in user.
//
// EMBER, not the house ice. Every other node on PROFILE is a cold colour; this
// one is the single warm thing on the tab because it is the only node that is
// ADDRESSED to the player — four weeks somebody wrote for them by name. It is
// also the one node whose content is finite and ends: after week 4 the weekly
// check-up cycle (checkup_goals) takes over and the plan becomes a record.
//
// The weeks are FIXED at four and all four render, written or not. A plan that
// showed only the weeks the coach had filled in would leave the player unable to
// tell "week 3 is a rest week" from "week 3 isn't written yet".
//
// THE CLOCK (2026-09-19). The coach STARTS the plan — today or tomorrow, on a
// button — and from that one date the screen derives everything: which week the
// player is in, which day of it, how many days are left, and the calendar dates
// each week covers. All of that maths is in lib/fourWeekPlan.js (planProgress /
// weekState / weekDates), pure and shared, so the player's card and the coach's
// editor can never disagree about what day it is. The clock is OPTIONAL: an
// un-started plan renders exactly as it did before there was one (weekState
// returns 'none'), because a plan handed to a player who isn't starting it yet
// is still a plan.
const EMBER      = '#FF8A3D';   // the plan's accent — rails, week numbers, titles
const EMBER_EDGE = '#5c3312';   // card borders — ember dimmed, not a bright rim
const EMBER_DIM  = '#a06534';   // field labels inside a card
const PANEL      = '#0a0f1a';   // card ground, a touch warmer than the app's #070d1a
const MUTED      = '#4a6a8a';   // the house muted text

export default function FourWeekPlanScreen({ navigation, route }) {
  // Same convention as PersonalScreen: a `studentId` param means the coach is
  // looking at (and editing) somebody else's plan.
  const viewedId  = route?.params?.studentId ?? route?.params?.player?.id ?? null;
  const adminView = !!viewedId;

  const [playerId, setPlayerId] = useState(viewedId);
  const [playerName, setPlayerName] = useState(route?.params?.player?.full_name ?? null);
  const [weeks, setWeeks] = useState(emptyPlan);
  const [startedOn, setStartedOn] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // Today, once per mount. Read from a state initializer rather than at every
  // render: a screen left open across midnight should not have its week silently
  // change under a player who is mid-scroll — they get the new day on the next
  // open, which is also when the rest of the app rolls over.
  const [today] = useState(israelToday);

  // WHERE THEY ARE. One derived object, read by the header strip, by every week
  // card, and by the coach's START block.
  const progress = useMemo(() => planProgress(startedOn, today), [startedOn, today]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        let id = viewedId;
        if (!id) {
          const { data: { user } } = await supabase.auth.getUser();
          id = user?.id ?? null;
        }
        if (!alive) return;
        setPlayerId(id);
        if (!id) { setLoading(false); return; }
        // The coach's copy names the player in the header — they arrived here
        // from a roster of many.
        if (adminView) {
          const { data: p } = await supabase
            .from('profiles').select('full_name').eq('id', id).maybeSingle();
          if (alive && p?.full_name) setPlayerName(p.full_name);
        }
        const [rows, start] = await Promise.all([fetchPlan(id), fetchPlanStart(id)]);
        if (alive) { setWeeks(rows); setStartedOn(start); }
      } catch (e) {
        console.error('[FourWeekPlanScreen] load:', e);
        if (alive) setLoadError('Could not load the plan.');
      }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [viewedId, adminView]);

  // A week the coach saved replaces its slot in place, so the card's "saved"
  // baseline moves with it and nothing else on screen re-renders from scratch.
  const onWeekSaved = useCallback((weekIndex, values, id) => {
    setWeeks(prev => prev.map(w => (
      w.week_index === weekIndex ? { ...w, ...values, id: id ?? w.id } : w
    )));
  }, []);

  const written = useMemo(() => planHasContent(weeks), [weeks]);

  return (
    <ScreenFrame fill ready={!loading}>
      <View style={styles.card}>
        <ScreenHeader
          title="4-WEEK PLAN"
          subtitle={adminView ? (playerName || undefined) : undefined}
          onBack={() => navigation.goBack()}
          titleStyle={styles.headerTitle}
          subtitleStyle={styles.headerSubtitle}
        />

        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {loading ? (
            <View style={styles.center}><ActivityIndicator size="large" color={EMBER} /></View>
          ) : (
            <ScrollView
              contentContainerStyle={styles.body}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {/* The brief — the COACH's only. The player used to get one too
                  ("four weeks, your coach wrote them for you…") and it was cut on
                  2026-09-18: the title says 4-WEEK PLAN and the cards are numbered
                  01–04, so a paragraph explaining that it is four weeks written by
                  their coach told them nothing the screen wasn't already saying.
                  The coach's line is an instruction, not a description — it names
                  the per-week save — so it stays. */}
              {adminView && (
                <Text style={styles.brief}>
                  Four weeks that carry this player from their first day to their first
                  check-up cycle. Write a week, save it — they see it the moment you do.
                </Text>
              )}

              {loadError ? <Text style={styles.error}>{loadError}</Text> : null}

              {/* The clock. The coach gets the control; the player gets what it
                  reads. Both sit above the weeks, because "which week am I in"
                  is the question you arrive on this screen holding. */}
              {adminView ? (
                <StartBlock
                  startedOn={startedOn}
                  progress={progress}
                  today={today}
                  playerId={playerId}
                  onChange={setStartedOn}
                />
              ) : (
                <ProgressStrip progress={progress} />
              )}

              {!adminView && !written ? (
                // The player's empty state. It says WHO owes them the plan, so an
                // empty node never reads as a broken screen. One sentence and no
                // heading over it: a NOT WRITTEN YET label above a line that says
                // the same thing was the label reading the body out loud.
                <View style={styles.pendingCard}>
                  <View style={styles.pendingRail} />
                  <Text style={styles.pendingBody}>
                    Your coach hasn{'’'}t drawn up your four weeks yet. It will appear
                    here the moment they do.
                  </Text>
                </View>
              ) : (
                weeks.map(week => (
                  <WeekCard
                    key={week.week_index}
                    week={week}
                    adminView={adminView}
                    playerId={playerId}
                    onSaved={onWeekSaved}
                    state={weekState(progress, week.week_index)}
                    dates={weekDates(startedOn, week.week_index)}
                    progress={progress}
                  />
                ))
              )}

              {/* The end of the runway. Only shown once there is a plan to reach
                  the end OF — it is a full stop, not a placeholder. */}
              {(adminView || written) && (
                <Text style={styles.tail}>
                  {adminView
                    ? 'After week 4 the weekly check-up cycle takes over.'
                    : 'After week 4 the weekly check-up takes over. You won’t need the map by then.'}
                </Text>
              )}
            </ScrollView>
          )}
        </KeyboardAvoidingView>
      </View>
    </ScreenFrame>
  );
}

// ─── Where you are — the player's strip ─────────────────────────────────────────
// The one line the whole clock exists to print. It answers "which week am I in"
// (which the player should never have to work out from a calendar), and then the
// harder question underneath it: how much of this week is left. "3 DAYS LEFT"
// under a week whose goals aren't met is the nudge — a player who can see they
// are near the end of week 2 can decide to push; a player who is guessing can't.
function ProgressStrip({ progress }) {
  if (progress.state === 'unset') return null;

  if (progress.state === 'pending') {
    const d = progress.startsIn;
    return (
      <View style={styles.strip}>
        <Text style={styles.stripLead}>STARTS {d === 1 ? 'TOMORROW' : `IN ${d} DAYS`}</Text>
        <Text style={styles.stripSub}>Day 1 is {formatDay(progress.startedOn)}.</Text>
      </View>
    );
  }

  if (progress.state === 'done') {
    return (
      <View style={[styles.strip, styles.stripDone]}>
        <Text style={[styles.stripLead, styles.stripLeadDone]}>PLAN COMPLETE</Text>
        <Text style={styles.stripSub}>
          All four weeks are behind you. The weekly check-up carries it from here.
        </Text>
      </View>
    );
  }

  const { currentWeek, dayInWeek, daysLeftInWeek, day } = progress;
  return (
    <View style={styles.strip}>
      <Text style={styles.stripLead}>YOU ARE IN WEEK {currentWeek}</Text>
      <View style={styles.stripRow}>
        <Text style={styles.stripSub}>DAY {dayInWeek} OF {DAYS_PER_WEEK}</Text>
        <Text style={styles.stripDot}>·</Text>
        {/* Counted inclusive of today — see daysLeftInWeek in lib/fourWeekPlan. */}
        <Text style={styles.stripSub}>
          {daysLeftInWeek === 1 ? 'LAST DAY OF THIS WEEK' : `${daysLeftInWeek} DAYS LEFT`}
        </Text>
        <Text style={styles.stripDot}>·</Text>
        <Text style={styles.stripSub}>DAY {day} OF 28</Text>
      </View>
      {/* Four segments, one per week, filling across the one you're in. A week
          the player has finished stays full: the bar is the runway behind and
          ahead of them, not a score. */}
      <View style={styles.bar}>
        {[1, 2, 3, 4].map(i => (
          <View
            key={i}
            style={[
              styles.barSeg,
              i < currentWeek && styles.barSegDone,
              i === currentWeek && styles.barSegNow,
            ]}
          >
            {i === currentWeek && (
              <View style={[styles.barFill, { width: `${(dayInWeek / DAYS_PER_WEEK) * 100}%` }]} />
            )}
          </View>
        ))}
      </View>
    </View>
  );
}

// ─── Start the clock — the coach's control ──────────────────────────────────────
// TODAY or TOMORROW, which is the whole decision: the coach is either handing the
// plan over in front of the player or setting them up for the morning. Anything
// richer (a date picker, a "start on Monday") is a calendar for a choice that is
// always one of two, and the coach can re-start any day they like anyway.
//
// RE-START is the same button. The player this feature is for is either brand new
// or stuck, and the stuck one gets these four weeks pointed at them again from
// today — so a started plan keeps both buttons live and just says what the clock
// currently reads.
function StartBlock({ startedOn, progress, today, playerId, onChange }) {
  const [busy, setBusy] = useState('');       // which button is mid-write
  const [error, setError] = useState('');

  async function start(when) {
    if (busy) return;
    setBusy(when);
    setError('');
    try {
      const date = when === 'today' ? today : addDays(today, 1);
      await setPlanStart(playerId, date);
      onChange(date);
    } catch (e) {
      console.error('[FourWeekPlanScreen] setPlanStart:', e);
      setError(e?.message || 'Could not set the start date.');
    }
    setBusy('');
  }

  async function clear() {
    if (busy) return;
    setBusy('clear');
    setError('');
    try {
      await clearPlanStart(playerId);
      onChange(null);
    } catch (e) {
      console.error('[FourWeekPlanScreen] clearPlanStart:', e);
      setError(e?.message || 'Could not clear the start date.');
    }
    setBusy('');
  }

  // What the clock currently reads, in the coach's words — they need to know
  // where the player is before deciding whether to re-start them.
  let status;
  if (progress.state === 'unset') {
    status = 'Not started. The player sees the four weeks with no dates on them.';
  } else if (progress.state === 'pending') {
    status = `Starts ${formatDay(startedOn)} — ${progress.startsIn === 1 ? 'tomorrow' : `in ${progress.startsIn} days`}.`;
  } else if (progress.state === 'done') {
    status = `Ran from ${formatDay(startedOn)}. Finished ${progress.endedDaysAgo === 1 ? 'yesterday' : `${progress.endedDaysAgo} days ago`}.`;
  } else {
    status = `Started ${formatDay(startedOn)} — now on week ${progress.currentWeek}, day ${progress.dayInWeek} of ${DAYS_PER_WEEK}.`;
  }

  const started = progress.state !== 'unset';

  return (
    <View style={styles.startBlock}>
      <Text style={styles.startLabel}>{started ? 'THE CLOCK' : 'START THE CLOCK'}</Text>
      <Text style={styles.startStatus}>{status}</Text>

      <View style={styles.startRow}>
        <PillButton
          label={busy === 'today' ? '…' : started ? 'RE-START TODAY' : 'START TODAY'}
          onPress={() => start('today')}
          tone="gold" size="sm" loading={busy === 'today'} disabled={!!busy}
        />
        <PillButton
          label={busy === 'tomorrow' ? '…' : started ? 'RE-START TOMORROW' : 'START TOMORROW'}
          onPress={() => start('tomorrow')}
          tone="gold" size="sm" loading={busy === 'tomorrow'} disabled={!!busy}
        />
        {started && (
          <PillButton
            label={busy === 'clear' ? '…' : 'CLEAR'}
            onPress={clear}
            tone="muted" size="sm" loading={busy === 'clear'} disabled={!!busy}
          />
        )}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

// ─── One week ───────────────────────────────────────────────────────────────────
// Reader and editor in one component, because the two must not drift: the coach
// is writing the thing the player reads, and the moment the labels or the order
// differ between them the coach is authoring blind. Both walk WEEK_FIELDS.
//
// The editor holds its OWN draft and its own SAVE. Per-week saving (rather than
// one SAVE under four forms) is deliberate: a coach writes a plan a week at a
// time, and a single form that can only be committed whole turns a half-finished
// thought into something you must either finish now or throw away.
// `state` is where this week stands against today ('past' | 'current' |
// 'upcoming' | 'none'); `dates` is the calendar range it covers. Both come from
// the shared clock — the card does no date arithmetic of its own.
function WeekCard({ week, adminView, playerId, onSaved, state = 'none', dates, progress }) {
  const weekIndex = week.week_index;
  // THE WEEK YOU ARE IN IS READ, the other three are referred to. So on the
  // player's side the current card is physically bigger — number, title, body
  // and spacing all step up — while past and upcoming weeks stay the size they
  // were. Four identical cards make the reader find their week before they can
  // read it; one big one means the screen opens on the answer.
  // Not in the editor: the coach is writing all four and a form that changes
  // size depending on the date is a worse form.
  const big = !adminView && state === 'current';

  // The coach's draft — seeded from the saved row, and re-seeded whenever that
  // row changes underneath it (a save, or the initial load landing).
  const [draft, setDraft] = useState(() => pickFields(week));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => { setDraft(pickFields(week)); }, [week]);

  const dirty = useMemo(
    () => WEEK_FIELDS.some(f => (draft[f.key] ?? '') !== (week[f.key] ?? '')),
    [draft, week],
  );

  function edit(key, value) {
    setDraft(d => ({ ...d, [key]: value }));
    setJustSaved(false);
    setSaveError('');
  }

  async function save() {
    if (saving || !dirty) return;
    setSaving(true);
    setSaveError('');
    try {
      const id = await saveWeek(playerId, weekIndex, draft);
      // Normalize the draft the way the DB just did (trimmed), so a trailing
      // newline the coach typed doesn't leave the card dirty forever.
      const saved = {};
      for (const f of WEEK_FIELDS) saved[f.key] = (draft[f.key] ?? '').trim();
      setDraft(saved);
      onSaved(weekIndex, saved, id);
      setJustSaved(true);
    } catch (e) {
      console.error('[FourWeekPlanScreen] saveWeek:', e);
      setSaveError(e?.message || 'Could not save this week.');
    }
    setSaving(false);
  }

  const empty = isWeekEmpty(week);
  const range = dates?.from ? `${formatDay(dates.from)} – ${formatDay(dates.to)}` : null;

  return (
    <View style={[
      styles.week,
      big && styles.weekBig,
      empty && !adminView && styles.weekEmpty,
      // THE WEEK YOU ARE IN is the only lit card: full ember border and a
      // stronger glow, so it is findable at a glance in a scrolling list of
      // four near-identical boxes. Past weeks recede rather than disappear —
      // a player who is behind needs to be able to go back and read week 2.
      state === 'current'  && styles.weekCurrent,
      state === 'past'     && styles.weekPast,
      state === 'upcoming' && styles.weekUpcoming,
    ]}>
      {/* The week's spine — a full-height ember rail down the left edge, so the
          four cards read as four stops on one runway, not four loose boxes. */}
      <View style={[styles.weekRail, big && styles.weekRailBig]} />

      <View style={styles.weekHead}>
        <Text style={[styles.weekNum, big && styles.weekNumBig]}>
          {String(weekIndex).padStart(2, '0')}
        </Text>
        <View style={styles.weekHeadText}>
          <View style={styles.weekLabelRow}>
            <Text style={[styles.weekLabel, big && styles.weekLabelBig]}>WEEK {weekIndex}</Text>
            {/* The badge says where this week sits relative to today; the range
                says which actual days it is. Neither renders without a clock. */}
            {state === 'current' && (
              <Text style={[styles.badgeNow, big && styles.badgeNowBig]}>NOW</Text>
            )}
            {state === 'past'    && <Text style={styles.badgeDone}>DONE</Text>}
          </View>
          {range ? <Text style={[styles.weekRange, big && styles.weekRangeBig]}>{range}</Text> : null}
          {/* WHICH DAY OF IT, on the card itself. The strip at the top of the
              screen says the same thing, but it scrolls away — and this is the
              card the player is actually reading when they ask. */}
          {big && progress?.state === 'active' && (
            <Text style={styles.weekDay}>
              {`DAY ${progress.dayInWeek} OF ${DAYS_PER_WEEK}`}
              <Text style={styles.weekDayRest}>
                {progress.daysLeftInWeek === 1
                  ? '   ·   LAST DAY'
                  : `   ·   ${progress.daysLeftInWeek} DAYS LEFT`}
              </Text>
            </Text>
          )}
          {/* GOAL is the week's headline, so the reader promotes it out of the
              field list and prints it right under the number. */}
          {!adminView && !!week.goal && (
            <Text style={[styles.weekGoal, big && styles.weekGoalBig]}>{week.goal}</Text>
          )}
        </View>
      </View>

      {adminView ? (
        <View style={styles.form}>
          {WEEK_FIELDS.map(f => (
            <View key={f.key} style={styles.field}>
              <Text style={styles.fieldLabel}>{f.label}</Text>
              <TextInput
                style={[styles.input, f.lines > 2 && styles.inputTall]}
                value={draft[f.key] ?? ''}
                onChangeText={t => edit(f.key, t)}
                placeholder={f.hint}
                placeholderTextColor="#3a5a7a"
                multiline
                maxLength={f.max}
                numberOfLines={f.lines}
                textAlignVertical="top"
                editable={!saving}
              />
            </View>
          ))}

          <View style={styles.saveRow}>
            <PillButton
              label={saving ? 'SAVING…' : dirty ? `SAVE WEEK ${weekIndex}` : 'SAVED'}
              onPress={save}
              tone="gold"
              size="sm"
              loading={saving}
              disabled={!dirty || saving}
            />
            {justSaved && !dirty ? <Text style={styles.savedFlag}>✓ SAVED</Text> : null}
          </View>
          {saveError ? <Text style={styles.error}>{saveError}</Text> : null}
        </View>
      ) : empty ? (
        // A week inside a plan the coach hasn't reached yet. It still renders —
        // see the note at the top of the file.
        <Text style={styles.weekPending}>
          Your coach hasn{'’'}t written this week yet.
        </Text>
      ) : (
        <View style={[styles.readout, big && styles.readoutBig]}>
          {WEEK_FIELDS.filter(f => f.key !== 'goal').map(f => {
            const value = (week[f.key] ?? '').trim();
            if (!value) return null;   // the reader prints what exists, nothing more
            return (
              <View key={f.key} style={styles.field}>
                <Text style={[styles.fieldLabel, big && styles.fieldLabelBig]}>{f.label}</Text>
                <Text style={[styles.fieldValue, big && styles.fieldValueBig]}>{value}</Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

// The week row reduced to just its four editable fields, as plain strings.
function pickFields(week) {
  const out = {};
  for (const f of WEEK_FIELDS) out[f.key] = week?.[f.key] ?? '';
  return out;
}

const styles = StyleSheet.create({
  card: { flex: 1 },
  flex: { flex: 1 },
  center: { paddingVertical: 60, alignItems: 'center' },
  body: { paddingHorizontal: 22, paddingTop: 4, paddingBottom: 40, gap: 18 },

  // The header wears the plan's ember rather than the house ice — this screen is
  // the one warm room on the PROFILE tab (see the note up top).
  headerTitle: {
    color: EMBER,
    textShadowColor: 'rgba(255,138,61,0.45)',
  },
  headerSubtitle: { color: EMBER_DIM },

  brief: {
    fontFamily: F.bodyMed, fontSize: 14, lineHeight: 21,
    color: '#8fb3cc', letterSpacing: 0.3,
  },


  // ── The clock: the player's strip ──
  // A panel, not a banner: it is the first thing on the screen and it has to
  // outrank the week cards under it without being a different visual language.
  strip: {
    backgroundColor: PANEL,
    borderWidth: 1.5, borderColor: EMBER_EDGE, borderRadius: 12,
    paddingVertical: 14, paddingHorizontal: 16, gap: 8,
    shadowColor: EMBER, shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.22, shadowRadius: 14,
  },
  stripDone: { borderColor: '#25344a', shadowOpacity: 0 },
  stripLead: {
    fontFamily: F.heading, fontSize: 21, color: EMBER, letterSpacing: 2,
    textShadowColor: 'rgba(255,138,61,0.35)',
    textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 12,
  },
  stripLeadDone: { color: '#8fb3cc', textShadowColor: 'transparent' },
  // Wraps rather than truncates: on a narrow phone the three facts stack, and
  // all three matter (which day of the week, what's left, where in the 28).
  stripRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  stripSub: {
    fontFamily: F.heading, fontSize: 12, color: EMBER_DIM, letterSpacing: 2,
  },
  stripDot: { fontFamily: F.heading, fontSize: 12, color: '#3d4a5c' },

  // Four segments, one per week — the runway seen from above.
  bar: { flexDirection: 'row', gap: 4, marginTop: 4 },
  barSeg: {
    flex: 1, height: 5, borderRadius: 3,
    backgroundColor: '#1b2333', overflow: 'hidden',
  },
  barSegDone: { backgroundColor: EMBER_EDGE },
  barSegNow:  { backgroundColor: '#20293a' },
  barFill: {
    height: '100%', borderRadius: 3, backgroundColor: EMBER,
    shadowColor: EMBER, shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9, shadowRadius: 6,
  },

  // ── The clock: the coach's control ──
  startBlock: {
    backgroundColor: PANEL,
    borderWidth: 1.5, borderColor: EMBER_EDGE, borderRadius: 12,
    paddingVertical: 14, paddingHorizontal: 16, gap: 10,
  },
  startLabel: {
    fontFamily: F.heading, fontSize: 13, color: EMBER_DIM, letterSpacing: 3,
  },
  startStatus: {
    fontFamily: F.bodyMed, fontSize: 14, lineHeight: 21,
    color: C.text, letterSpacing: 0.2,
  },
  // Wraps: three pills do not fit one phone row, and a squashed row of buttons
  // reads worse than two clean ones.
  startRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 2 },

  // ── Week card states ──
  // Only three things change: border, glow, opacity. The card's layout is
  // identical in every state, so nothing jumps as the weeks roll over.
  weekCurrent: {
    borderColor: EMBER, borderWidth: 2,
    shadowOpacity: 0.4, shadowRadius: 22,
  },
  weekPast:     { opacity: 0.62 },
  weekUpcoming: { opacity: 0.82 },

  // ── The week you are in, at reading size (player view only) ──
  // Every value below is the same style one step up. Nothing is restyled — the
  // current week is not a DIFFERENT card, it is the same card at the size you
  // read a thing you are actually doing this week.
  weekBig: {
    paddingVertical: 24, paddingRight: 20, paddingLeft: 26,
    borderRadius: 14,
  },
  weekRailBig:   { width: 6 },
  weekNumBig:    { fontSize: 58, lineHeight: 62, opacity: 1 },
  weekLabelBig:  { fontSize: 17, color: EMBER, letterSpacing: 3.4 },
  weekRangeBig:  { fontSize: 14, color: EMBER_DIM, letterSpacing: 1.4, marginTop: 3 },
  weekGoalBig:   { fontSize: 25, lineHeight: 33, marginTop: 8, letterSpacing: 0.4 },
  badgeNowBig:   { fontSize: 12, letterSpacing: 2, paddingHorizontal: 9, paddingVertical: 3 },
  readoutBig:    { marginTop: 22, gap: 18 },
  fieldLabelBig: { fontSize: 13, letterSpacing: 2.6 },
  fieldValueBig: { fontSize: 17, lineHeight: 27 },

  // Which day of the seven — on the card, not only in the strip up top.
  weekDay: {
    fontFamily: F.heading, fontSize: 13, color: EMBER,
    letterSpacing: 2, marginTop: 8,
  },
  weekDayRest: { color: EMBER_DIM, letterSpacing: 1.6 },

  weekLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  weekRange: {
    fontFamily: F.bodyMed, fontSize: 12, color: MUTED,
    letterSpacing: 1.2, marginTop: 2,
  },
  badgeNow: {
    fontFamily: F.heading, fontSize: 10, color: '#0a0f1a', letterSpacing: 1.6,
    backgroundColor: EMBER, borderRadius: 4,
    paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden',
  },
  badgeDone: {
    fontFamily: F.heading, fontSize: 10, color: MUTED, letterSpacing: 1.6,
    borderWidth: 1, borderColor: '#25344a', borderRadius: 4,
    paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden',
  },

  // ── A week ──
  // The four cards are identical on purpose: a week is not more important than
  // the week beside it, and the number is enough to tell them apart.
  week: {
    backgroundColor: PANEL,
    borderWidth: 1.5, borderColor: EMBER_EDGE, borderRadius: 12,
    paddingVertical: 16, paddingRight: 16, paddingLeft: 20,
    overflow: 'hidden',
    shadowColor: EMBER, shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.16, shadowRadius: 16,
  },
  // An unwritten week in an otherwise-written plan steps back rather than
  // disappearing — it is a gap in the map, and the player should see the gap.
  weekEmpty: { opacity: 0.55 },
  weekRail: {
    position: 'absolute', left: 0, top: 0, bottom: 0, width: 4,
    backgroundColor: EMBER,
    shadowColor: EMBER, shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8, shadowRadius: 8,
  },

  weekHead: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  // The big number is the card's anchor — it is how the player finds "which week
  // am I on" while scrolling, so it outweighs everything else in the header.
  weekNum: {
    fontFamily: F.heading, fontSize: 40, lineHeight: 44, color: EMBER,
    letterSpacing: 1, opacity: 0.9,
    textShadowColor: 'rgba(255,138,61,0.35)',
    textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 14,
  },
  weekHeadText: { flex: 1 },
  weekLabel: {
    fontFamily: F.heading, fontSize: 15, color: EMBER_DIM, letterSpacing: 3,
  },
  weekGoal: {
    fontFamily: F.heading, fontSize: 19, color: '#FFFFFF', letterSpacing: 0.8,
    marginTop: 4, lineHeight: 25,
  },

  // ── Reader ──
  readout: { marginTop: 16, gap: 14 },
  field: { gap: 6 },
  fieldLabel: {
    fontFamily: F.heading, fontSize: 12, color: EMBER_DIM, letterSpacing: 2.4,
  },
  fieldValue: {
    fontFamily: F.bodyMed, fontSize: 15, lineHeight: 23,
    color: C.text, letterSpacing: 0.2,
  },
  weekPending: {
    fontFamily: F.bodyMed, fontSize: 13, color: MUTED,
    letterSpacing: 0.3, marginTop: 12, fontStyle: 'italic',
  },

  // ── Editor ──
  form: { marginTop: 16, gap: 14 },
  input: {
    borderWidth: 1, borderColor: 'rgba(255,138,61,0.30)', borderRadius: 10,
    backgroundColor: '#0a1424',
    paddingHorizontal: 13, paddingTop: 11, paddingBottom: 11,
    fontFamily: F.bodyMed, fontSize: 15, lineHeight: 22,
    color: C.text, letterSpacing: 0.2,
    minHeight: 46,
  },
  inputTall: { minHeight: 104 },
  saveRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 2 },
  savedFlag: {
    fontFamily: F.heading, fontSize: 12, color: '#1FD79A', letterSpacing: 2,
  },

  // ── The player's "no plan at all" state ──
  pendingCard: {
    backgroundColor: PANEL,
    borderWidth: 1.5, borderColor: '#25344a', borderRadius: 12,
    paddingVertical: 22, paddingRight: 18, paddingLeft: 22,
    overflow: 'hidden', gap: 10,
  },
  // Grey, not ember: there is nothing lit up about a plan that doesn't exist yet.
  pendingRail: {
    position: 'absolute', left: 0, top: 0, bottom: 0, width: 4,
    backgroundColor: '#25344a',
  },
  pendingBody: {
    fontFamily: F.bodyMed, fontSize: 14, lineHeight: 21, color: MUTED,
    letterSpacing: 0.3,
  },

  tail: {
    fontFamily: F.bodyMed, fontSize: 13, color: MUTED,
    letterSpacing: 0.4, textAlign: 'center', marginTop: 4, lineHeight: 20,
  },

  error: {
    fontFamily: F.bodyMed, fontSize: 13, color: C.alarmRed,
    letterSpacing: 0.3, lineHeight: 19,
  },
});
