/*
 * Rotating weekly events (K3) — a themed modifier each ISO week that applies a
 * *real* reward bonus (so the banner is never misleading). Deterministic per week,
 * so everyone sees the same event and it rotates honestly. The reward pipeline
 * reads {@link activeEvent} to scale match XP/coins; the menu shows the banner.
 *
 * Pure (date in → event out). Gameplay-affecting modifiers (tiny goals, one-life)
 * are intentionally left out to keep this sim-safe — only reward-side multipliers,
 * applied in `game/rewards.ts` which is outside the balance bundle.
 */
import { isoWeekId } from '../core/dates';

export interface WeeklyEvent {
  id: string;
  name: string;
  blurb: string;
  /** Match-XP multiplier this week. */
  xpMult: number;
  /** Match-coin multiplier this week. */
  coinMult: number;
  /** Accent emoji for the banner. */
  emoji: string;
}

/** The rotation. Each gives a genuine bonus — no neutral/"fake" weeks. */
export const EVENTS: WeeklyEvent[] = [
  { id: 'double_xp', name: 'Double XP Week', blurb: 'Every match pays double XP.', xpMult: 2, coinMult: 1, emoji: '⚡' },
  { id: 'coin_rush', name: 'Coin Rush', blurb: 'Every match pays double coins.', xpMult: 1, coinMult: 2, emoji: '🪙' },
  { id: 'festival', name: 'Goal Festival', blurb: '+50% XP and coins all week.', xpMult: 1.5, coinMult: 1.5, emoji: '🎉' },
];

/** A small stable hash of a string → uint32. */
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The active event for a given ISO week (defaults to this week). Deterministic. */
export function activeEvent(weekId: string = isoWeekId()): WeeklyEvent {
  return EVENTS[hashStr(`event:${weekId}`) % EVENTS.length];
}
