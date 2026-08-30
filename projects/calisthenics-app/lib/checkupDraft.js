// Unsent check-up TEXT, stored LOCALLY only (AsyncStorage) — the same idea as a
// live workout session (see lib/workoutSession.js). The uploaded clips already
// live on the server the moment they're picked, but the typed text (Part 1
// answers + the per-exercise notes) only reaches Supabase on SUBMIT. Without
// this, closing the app mid-fill lost every word while the videos stayed.
//
// Draft shape: { answers: { [questionItemId]: text },
//                notes:   { [exerciseItemId]: text },
//                prompts: { [itemId]: prompt },   // ← see remapDraftKeys
//                updatedAt: ISO }
//
// Cleared on submit (and on START NEW). A stale draft older than the check-up
// TTL is dropped on load so an abandoned week never resurfaces.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { CHECKUP_TTL_DAYS, normalizePrompt } from './checkups';

const PREFIX = 'checkup_draft:';

export function checkupDraftKey(userId) {
  return `${PREFIX}${userId}`;
}

function isEmpty(map) {
  return !map || Object.values(map).every(t => !t || !String(t).trim());
}

export async function loadCheckupDraft(userId) {
  if (!userId) return null;
  try {
    const raw = await AsyncStorage.getItem(checkupDraftKey(userId));
    if (!raw) return null;
    const draft = JSON.parse(raw);
    const age = Date.now() - new Date(draft?.updatedAt ?? 0).getTime();
    if (!(age < CHECKUP_TTL_DAYS * 24 * 60 * 60 * 1000)) {
      await clearCheckupDraft(userId);
      return null;
    }
    return {
      answers: draft.answers ?? {}, notes: draft.notes ?? {},
      prompts: draft.prompts ?? {}, updatedAt: draft.updatedAt,
    };
  } catch (e) {
    console.error('[checkupDraft] load:', e);
    return null;
  }
}

export async function saveCheckupDraft(userId, { answers, notes, prompts }) {
  if (!userId) return;
  try {
    // Nothing typed anywhere → drop the key instead of storing an empty draft.
    if (isEmpty(answers) && isEmpty(notes)) {
      await AsyncStorage.removeItem(checkupDraftKey(userId));
      return;
    }
    await AsyncStorage.setItem(
      checkupDraftKey(userId),
      JSON.stringify({
        answers: answers ?? {}, notes: notes ?? {}, prompts: prompts ?? {},
        updatedAt: new Date().toISOString(),
      }),
    );
  } catch (e) {
    console.error('[checkupDraft] save:', e);
  }
}

// Re-key a draft onto the CURRENT template items.
//
// The draft is keyed by template item id, and those ids are not forever: the coach
// personalising a player's check-up COPIES the class items onto them (new rows,
// new ids), and re-authoring a class does the same. Without this, everything the
// player had typed but not sent went silently blank the next time they opened the
// screen. Each key's prompt is stored alongside (`prompts`), so a key that no
// longer exists is matched to the item with the same text — the same name-first
// identity the clips use (see bindVideosToExercises).
export function remapDraftKeys(draft, items = []) {
  if (!draft) return draft;
  const ids = new Set(items.map(i => i.id));
  const byName = new Map();
  for (const i of items) {
    const k = normalizePrompt(i.prompt);
    if (k && !byName.has(k)) byName.set(k, i.id);
  }
  const fix = (map = {}) => {
    const out = {};
    for (const [key, text] of Object.entries(map)) {
      if (ids.has(key)) { out[key] = text; continue; }          // still a live item
      const moved = byName.get(normalizePrompt(draft.prompts?.[key] ?? ''));
      out[moved ?? key] = text;   // moved to its new id, or kept (harmless) if gone
    }
    return out;
  };
  return { ...draft, answers: fix(draft.answers), notes: fix(draft.notes) };
}

export async function clearCheckupDraft(userId) {
  if (!userId) return;
  try {
    await AsyncStorage.removeItem(checkupDraftKey(userId));
  } catch (e) {
    console.error('[checkupDraft] clear:', e);
  }
}
