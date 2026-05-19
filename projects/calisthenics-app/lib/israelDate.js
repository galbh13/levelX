// YYYY-MM-DD for "today" in Asia/Jerusalem time.
// Used by daily quests so the midnight reset matches the user's local day.
export function israelToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
}
