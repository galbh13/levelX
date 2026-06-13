// One-shot latch for the post-login "hologram build" entrance. App arms it the
// moment a session is established; the first ScreenFrame to mount after that
// consumes it (and disarms), so only the landing card plays the build — not the
// login card, and not subsequent tab switches.
let armed = false;

export function armHoloEntry() {
  armed = true;
}

export function consumeHoloEntry() {
  if (!armed) return false;
  armed = false;
  return true;
}
