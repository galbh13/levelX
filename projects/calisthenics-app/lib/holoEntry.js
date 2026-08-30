// One-shot latch for the post-login "hologram build" entrance. App arms it the
// moment a session is established; the first ScreenFrame to mount after that
// consumes it (and disarms), so only the landing card plays the build — not the
// login card, and not subsequent tab switches.
let armed = false;
// Consumed, but the build hasn't visibly started yet (HoloBuild holds until the
// card's size settles). Still "a build is coming" for anything syncing to it.
let pending = false;

export function armHoloEntry() {
  armed = true;
}

export function consumeHoloEntry() {
  if (!armed) return false;
  armed = false;
  pending = true;
  return true;
}

// "Is a build about to play?" — true from the moment App arms it until the
// build actually starts. Anything that must animate WITH the build (the player
// tab bar, which sits outside the card and would otherwise just pop into place)
// asks this at mount to decide whether to start hidden.
export function isHoloComing() {
  return armed || pending;
}

// HoloBuild announces the exact frame the build starts, so companions outside
// the card move on the same beat instead of guessing at a delay.
const listeners = new Set();

export function onHoloStart(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function notifyHoloStart() {
  pending = false;
  for (const cb of [...listeners]) {
    try { cb(); } catch { /* a bad listener must not break the entrance */ }
  }
}
