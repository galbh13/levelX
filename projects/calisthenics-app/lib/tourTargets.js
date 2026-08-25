import { useCallback, useEffect, useRef } from 'react';

// ── Tour target registry ─────────────────────────────────────────────────────
// Screens tag the real elements the guided tour points at (e.g. the LEVEL card,
// the MY WORKOUTS tile) with `ref={useTourTarget('home.level')}`. GuidedTour then
// MEASURES the tagged element at run time and drops its highlight + arrow exactly
// on it — no more guessing screen fractions.
//
// A plain module singleton (not React context) so any screen in any navigator can
// register without extra provider plumbing.

const nodes = {};

export function registerTourTarget(name, node) {
  if (node) nodes[name] = node;
  else delete nodes[name];
}

// Clear a registration ONLY if it's still the node we put there. Two mutually
// exclusive branches of a screen can tag the same name (e.g. the compose form vs
// the read-only view); without this, the OUTGOING branch's unmount would wipe the
// INCOMING one's registration and the tour would lose the element.
function unregisterTourTarget(name, node) {
  if (nodes[name] === node) delete nodes[name];
}

// Measure a registered element in WINDOW (visual) coords. Resolves null if it
// isn't registered / mounted / laid out. GuidedTour measures the overlay the same
// way and works in fractions, so the app's zoom/scale transform cancels out.
export function measureTourTarget(name) {
  return new Promise((resolve) => {
    const node = nodes[name];
    if (!node || typeof node.measureInWindow !== 'function') { resolve(null); return; }
    try {
      node.measureInWindow((x, y, w, h) => {
        if ((w || 0) <= 0 && (h || 0) <= 0) { resolve(null); return; }
        resolve({ x, y, w, h });
      });
    } catch {
      resolve(null);
    }
  });
}

// Callback ref for a screen element: `ref={useTourTarget('home.level')}`.
export function useTourTarget(name) {
  const mine = useRef(null);
  useEffect(() => () => unregisterTourTarget(name, mine.current), [name]);
  return useCallback((node) => {
    if (node) { mine.current = node; registerTourTarget(name, node); }
    else { unregisterTourTarget(name, mine.current); mine.current = null; }
  }, [name]);
}

// ── Scroll-into-view ─────────────────────────────────────────────────────────
// A tagged element is useless to the tour if it's scrolled off the screen — the
// highlight lands on nothing and the arrow points into empty space (the SIDE
// QUESTS step used to do exactly that). So a screen ALSO registers its scroll
// container, keyed by the target-name prefix ('skills.sidelabel' → 'skills'),
// and the tour asks it to bring the element into view before measuring.
//
// The api a screen registers:
//   { box }             a View ref wrapping the scroll container (measurable)
//   scrollTo(y, anim)   scroll the container to that offset (layout px)
//   getOffset()     current scroll offset (layout px)
//   getViewportH()  container height in LAYOUT px (from onLayout)
// The box is measured in WINDOW (visual) px, so its height vs getViewportH()
// gives the app's zoom/scale factor and the two coordinate spaces reconcile.

const scrollers = {};

// Send a registered list back to the TOP (e.g. before a screen's first step, so a
// replayed tutorial doesn't open the screen halfway down where the player left it).
// NOT animated: it happens while the tour card is faded out, so an instant jump is
// invisible — and a smooth one would still be in flight when we measure.
export function scrollTourTop(key) {
  scrollers[key]?.scrollTo?.(0, false);
}

export function registerTourScroller(key, api) {
  if (api) scrollers[key] = api;
  else delete scrollers[key];
}

// `ref={...}`-free hook: pass a MEMOIZED api object.
export function useTourScroller(key, api) {
  useEffect(() => {
    registerTourScroller(key, api);
    return () => registerTourScroller(key, null);
  }, [key, api]);
}

function measureWindow(node) {
  return new Promise((resolve) => {
    if (!node || typeof node.measureInWindow !== 'function') { resolve(null); return; }
    try { node.measureInWindow((x, y, w, h) => resolve({ x, y, w, h })); }
    catch { resolve(null); }
  });
}

// Where a revealed element should sit in its container: a bit below center, so
// the tour caption still has clean dead space above it.
const REVEAL_AT = 0.58;

// Scroll the owning container so `name` is comfortably on screen.
// → 'none'      this screen has no scroller — nothing to reveal, don't wait on it
//   'wait'      there IS a scroller but the element isn't measurable yet (retry)
//   'ok'        already in a good spot — left untouched
//   'scrolled'  a scroll was issued (give it a beat to settle before measuring)
// The none/wait split matters for SPEED: a step on a screen with no scroller must
// return instantly, never sit through the caller's retry loop.
export async function revealTourTarget(name) {
  const key = String(name || '').split('.')[0];
  const sc = scrollers[key];
  if (!sc) return 'none';
  const tg = await measureTourTarget(name);
  const box = await measureWindow(sc.box?.current);
  if (!tg || !box || !(box.h > 0)) return 'wait';

  const layoutH = sc.getViewportH?.() || 0;
  const scale = layoutH > 0 ? box.h / layoutH : 1;
  const center = tg.y + tg.h / 2;
  const want = box.y + box.h * REVEAL_AT;
  // Leave it alone when it's already fully visible in the comfortable band —
  // scrolling a perfectly-placed element would only look twitchy.
  const inBand = tg.y > box.y + box.h * 0.12 && (tg.y + tg.h) < box.y + box.h * 0.88;
  if (inBand && Math.abs(center - want) < box.h * 0.18) return 'ok';

  const next = Math.max(0, (sc.getOffset?.() || 0) + (center - want) / (scale || 1));
  if (Math.abs(next - (sc.getOffset?.() || 0)) < 8) return 'ok';
  sc.scrollTo?.(next, true);
  return 'scrolled';
}
