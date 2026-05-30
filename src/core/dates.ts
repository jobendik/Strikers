/*
 * Local-calendar helpers for the daily/weekly systems (C2 first-match-of-day,
 * E daily/weekly resets). Uses the player's *local* time so "today" matches what
 * they see on the clock. Pure functions; the only impurity is reading the wall
 * clock via `new Date()`, isolated here so everything else stays testable.
 */

/** Today's local date as `YYYY-MM-DD` (the daily-block key). */
export function localDateString(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * ISO-week id as `YYYY-Www` (e.g. `2026-W23`) — the weekly-block key. ISO weeks
 * start on Monday and week 1 contains the year's first Thursday.
 */
export function isoWeekId(date: Date = new Date()): string {
  // copy to UTC midnight so DST never shifts the day count
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7; // Sun=0 -> 7
  d.setUTCDate(d.getUTCDate() + 4 - day); // shift to the week's Thursday
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${`${week}`.padStart(2, '0')}`;
}
