/*
 * Account progression math (C2/C3) — pure, side-effect-free, headlessly testable.
 *
 * Owns the XP curve, the level/title ladder and how an XP grant rolls a player up
 * through levels. Knows nothing about matches, storage or the DOM: it just takes
 * numbers and returns numbers, so it can be unit-tested and reused by the reward
 * pipeline (`game/rewards.ts`), the profile card (C4) and the result screen (D).
 */

/**
 * XP required to advance *out of* a given level. Tuned to the retention.md §3.1
 * cadence against typical match grants (~250–400 XP/match):
 *   L1–5 ≈ one level per match · L6–15 every 2–3 · L16–30 every 4–6 · L31+ slow.
 */
export function xpToNext(level: number): number {
  if (level <= 5) return 250;
  if (level <= 15) return 600;
  if (level <= 30) return 1200;
  return 2200;
}

/** The football-flavoured title ladder (C3), with the level each tier unlocks at. */
export const TITLES: { title: string; minLevel: number }[] = [
  { title: 'Rookie', minLevel: 1 },
  { title: 'Pro', minLevel: 5 },
  { title: 'Star', minLevel: 10 },
  { title: 'Captain', minLevel: 17 },
  { title: 'Maestro', minLevel: 25 },
  { title: 'Icon', minLevel: 35 },
  { title: 'Legend', minLevel: 50 },
];

/** The title earned at a given account level. */
export function titleForLevel(level: number): string {
  let title = TITLES[0].title;
  for (const t of TITLES) if (level >= t.minLevel) title = t.title;
  return title;
}

/** The result of granting XP: where the player ended up and what changed. */
export interface XpOutcome {
  level: number;
  /** XP accrued into the *current* level (the bar numerator). */
  xpIntoLevel: number;
  /** XP still needed to reach the next level (the bar denominator). */
  xpForNext: number;
  /** Levels gained by this grant (0 if none). */
  levelsGained: number;
  /** New title if it changed, else null. */
  newTitle: string | null;
}

/**
 * Apply an XP grant on top of a current (level, xpIntoLevel) and roll up through
 * as many levels as the grant covers. Pure — returns the new standing; the caller
 * writes it back to the save. `amount` is clamped to ≥0.
 */
export function grantXp(level: number, xpIntoLevel: number, amount: number): XpOutcome {
  const startTitle = titleForLevel(level);
  let lvl = Math.max(1, Math.floor(level));
  let xp = Math.max(0, xpIntoLevel) + Math.max(0, amount);
  let gained = 0;

  // guard against a runaway loop on absurd inputs while still handling big grants
  while (xp >= xpToNext(lvl) && gained < 10000) {
    xp -= xpToNext(lvl);
    lvl++;
    gained++;
  }

  const endTitle = titleForLevel(lvl);
  return {
    level: lvl,
    xpIntoLevel: xp,
    xpForNext: xpToNext(lvl),
    levelsGained: gained,
    newTitle: endTitle !== startTitle ? endTitle : null,
  };
}
