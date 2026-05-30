/*
 * Daily orders + daily chest (E2/E3) — the short-loop "one more match" engine.
 *
 * Pure logic over the daily block of the player save: it rolls a fresh set of
 * orders each local day, scores them from a finished match's facts, runs the
 * daily-chest meter, and supports a single reroll. No storage/DOM/render — the
 * reward pipeline (`game/rewards.ts`) owns persistence and calls in here. All
 * rewards are earned in-game (retention.md §5), no deception, nothing gated.
 */
import type { DailyState, QuestState } from '../core/playerData';
import { localDateString } from '../core/dates';

/** Match facts an order is scored against (user-team perspective). */
export interface MatchFacts {
  win: boolean;
  draw: boolean;
  loss: boolean;
  goalsFor: number;
  goalsAgainst: number;
  cleanSheet: boolean;
}

interface OrderDef {
  id: string;
  label: string;
  target: number;
  /** Coins paid when the order completes. */
  reward: number;
  /** Progress this match contributes toward the order. */
  inc: (f: MatchFacts) => number;
}

/**
 * The order catalogue. v1 sticks to orders scorable from a match's outcome (the
 * facts the reward pipeline already has). Richer orders (curler, slide tackles,
 * comeback, shootout) join once the in-match medal/event hooks land (G).
 */
const ORDERS: OrderDef[] = [
  { id: 'win', label: 'Win a match', target: 1, reward: 60, inc: (f) => (f.win ? 1 : 0) },
  { id: 'win2', label: 'Win 2 matches', target: 2, reward: 90, inc: (f) => (f.win ? 1 : 0) },
  { id: 'score3', label: 'Score 3 goals', target: 3, reward: 60, inc: (f) => f.goalsFor },
  { id: 'score5', label: 'Score 5 goals', target: 5, reward: 90, inc: (f) => f.goalsFor },
  { id: 'brace', label: 'Score 2+ in a match', target: 1, reward: 60, inc: (f) => (f.goalsFor >= 2 ? 1 : 0) },
  { id: 'clean', label: 'Keep a clean sheet', target: 1, reward: 70, inc: (f) => (f.cleanSheet ? 1 : 0) },
  { id: 'tonil', label: 'Win to nil', target: 1, reward: 80, inc: (f) => (f.win && f.cleanSheet ? 1 : 0) },
  { id: 'bigwin', label: 'Win by 3+ goals', target: 1, reward: 80, inc: (f) => (f.win && f.goalsFor - f.goalsAgainst >= 3 ? 1 : 0) },
  { id: 'play2', label: 'Play 2 matches', target: 2, reward: 50, inc: () => 1 },
];

/** Default number of daily orders. */
export const DAILY_ORDER_COUNT = 3;

// ---- daily-chest tuning (retention.md §5.3) ---------------------------------
export const CHEST_MAX = 100;
const CHEST_PLAY = 40;
const CHEST_WIN = 30;
const CHEST_PER_ORDER = 20;
/** Coins awarded when the daily-chest meter fills (chest contents proper = F5). */
export const CHEST_REWARD_COINS = 120;

const def = (id: string): OrderDef | undefined => ORDERS.find((o) => o.id === id);

/** A human label for an order id (for the UI). */
export function orderLabel(id: string): string {
  return def(id)?.label ?? id;
}

let rng: () => number = Math.random;
/** Override the RNG (deterministic tests). */
export function setQuestRng(fn: () => number): void {
  rng = fn;
}

function pickDistinct(count: number, exclude: string[] = []): OrderDef[] {
  const pool = ORDERS.filter((o) => !exclude.includes(o.id));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

/** A fresh set of daily orders as zeroed quest state. */
export function rollDailyOrders(count = DAILY_ORDER_COUNT): QuestState[] {
  return pickDistinct(count).map((o) => ({ id: o.id, progress: 0, target: o.target, claimed: false }));
}

/** Reset the daily block for a new local day (fresh orders, chest, flags). */
export function resetDaily(daily: DailyState, today = localDateString()): void {
  daily.date = today;
  daily.orders = rollDailyOrders();
  daily.rerollUsed = false;
  daily.chestPoints = 0;
  daily.firstWin = false;
}

/** Lazily ensure the daily block matches today (rolls orders on a new day). */
export function ensureToday(daily: DailyState, today = localDateString()): boolean {
  if (daily.date !== today || daily.orders.length === 0) {
    resetDaily(daily, today);
    return true;
  }
  return false;
}

/**
 * Reroll the order at `index` (once per day) for a different, not-currently-held
 * order. Returns true if the reroll happened.
 */
export function rerollOrder(daily: DailyState, index: number): boolean {
  if (daily.rerollUsed) return false;
  if (index < 0 || index >= daily.orders.length) return false;
  const held = daily.orders.map((o) => o.id);
  const [next] = pickDistinct(1, held);
  if (!next) return false;
  daily.orders[index] = { id: next.id, progress: 0, target: next.target, claimed: false };
  daily.rerollUsed = true;
  return true;
}

/** The outcome of scoring a match against the daily systems. */
export interface DailyProgress {
  /** Labels of orders completed by this match. */
  completed: string[];
  /** Coins from completed orders. */
  orderCoins: number;
  /** Daily-chest meter after this match (0–100). */
  chestPoints: number;
  /** The chest meter filled this match. */
  chestAwarded: boolean;
  /** Coins from a filled chest. */
  chestCoins: number;
}

/**
 * Score a finished match: advance each order, auto-claim completions, then run the
 * daily-chest meter (+play, +win, +per completed order). Mutates `daily`; returns
 * the progress for the result screen. The caller persists the save.
 */
export function progressDaily(daily: DailyState, f: MatchFacts): DailyProgress {
  const completed: string[] = [];
  let orderCoins = 0;

  for (const q of daily.orders) {
    if (q.claimed) continue;
    const d = def(q.id);
    if (!d) continue;
    q.progress = Math.min(q.target, q.progress + d.inc(f));
    if (q.progress >= q.target) {
      q.claimed = true;
      completed.push(d.label);
      orderCoins += d.reward;
    }
  }

  let pts = daily.chestPoints + CHEST_PLAY + (f.win ? CHEST_WIN : 0) + completed.length * CHEST_PER_ORDER;
  let chestAwarded = false;
  let chestCoins = 0;
  if (pts >= CHEST_MAX) {
    chestAwarded = true;
    chestCoins = CHEST_REWARD_COINS;
    pts = pts - CHEST_MAX; // overflow carries toward the next chest
  }
  daily.chestPoints = pts;

  return { completed, orderCoins, chestPoints: daily.chestPoints, chestAwarded, chestCoins };
}

/** Orders still to finish today (for the "next best action" copy). */
export function remainingOrders(daily: DailyState): QuestState[] {
  return daily.orders.filter((q) => !q.claimed);
}
