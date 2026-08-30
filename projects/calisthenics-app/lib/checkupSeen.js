// Has the player READ the coach's latest feedback yet? Stored LOCALLY only
// (AsyncStorage, like lib/checkupDraft) — one stamp per user: the `feedback_at`
// of the newest reply they have actually opened. The coach writes feedback at
// most once a week and the player reads it on their own device, so this needs no
// column and no migration; a fresh install simply shows the dot once more.
//
// Drives the CHECKUP tab's "new feedback" dot (see CheckupNotifyContext) and is
// stamped by CheckupScreen the moment the feedback card is on screen.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchLatestFeedback } from './checkups';

const PREFIX = 'checkup_feedback_seen:';

export function feedbackSeenKey(userId) {
  return `${PREFIX}${userId}`;
}

export async function getFeedbackSeenAt(userId) {
  if (!userId) return null;
  try {
    return await AsyncStorage.getItem(feedbackSeenKey(userId));
  } catch (e) {
    console.error('[checkupSeen] get:', e);
    return null;
  }
}

// Remember a reply as read. Only ever moves FORWARD in time, so an older card
// re-rendering can't un-see a newer reply.
export async function markFeedbackSeen(userId, feedbackAt) {
  if (!userId || !feedbackAt) return;
  try {
    const prev = await getFeedbackSeenAt(userId);
    if (prev && new Date(prev) >= new Date(feedbackAt)) return;
    await AsyncStorage.setItem(feedbackSeenKey(userId), new Date(feedbackAt).toISOString());
  } catch (e) {
    console.error('[checkupSeen] mark:', e);
  }
}

// Is there a reply the player hasn't opened? One read of their newest feedback
// (the current check-up's, or the keepsake left by an earlier one) against the
// local stamp.
export async function hasUnseenFeedback(userId) {
  if (!userId) return false;
  try {
    const latest = await fetchLatestFeedback(userId);
    if (!latest?.feedback_at) return false;
    if (!latest.feedback_note && !latest.feedback_url) return false;   // empty reply → nothing to read
    const seen = await getFeedbackSeenAt(userId);
    return !seen || new Date(latest.feedback_at) > new Date(seen);
  } catch (e) {
    console.error('[checkupSeen] hasUnseenFeedback:', e);
    return false;
  }
}
