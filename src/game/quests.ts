/*
 * Daily orders + daily chest (E2/E3) and weekly orders + activity meter (E4) —
 * the short-loop and medium-loop "one more match" engines.
 *
 * Pure logic over the daily/weekly blocks of the player save: rolls a fresh set
 * of orders each local day / ISO week, scores them from a finished match's facts,
 * runs the daily-chest meter, and supports a single reroll per period. No
 * storage/DOM/render — the reward pipeline (`game/rewards.ts`) owns persistence
 * and calls in here. All rewards are earned in-game (retention.md §5), no
 * deception, nothing gated.
 */
import type { DailyState, WeeklyState, QuestState } from '../core/playerData';
import { localDateString, isoWeekId } from '../core/dates';

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

// ---- weekly orders (E4) -----------------------------------------------------

/** Bigger, more aspirational weekly orders (reset each ISO week). */
const WEEKLY_ORDER_DEFS: OrderDef[] = [
  { id: 'w_win5', label: 'Win 5 matches', target: 5, reward: 200, inc: (f) => (f.win ? 1 : 0) },
  { id: 'w_win3', label: 'Win 3 matches', target: 3, reward: 130, inc: (f) => (f.win ? 1 : 0) },
  { id: 'w_score10', label: 'Score 10 goals', target: 10, reward: 180, inc: (f) => f.goalsFor },
  { id: 'w_score15', label: 'Score 15 goals', target: 15, reward: 250, inc: (f) => f.goalsFor },
  { id: 'w_clean3', label: 'Keep 3 clean sheets', target: 3, reward: 200, inc: (f) => (f.cleanSheet ? 1 : 0) },
  { id: 'w_clean2', label: 'Keep 2 clean sheets', target: 2, reward: 140, inc: (f) => (f.cleanSheet ? 1 : 0) },
  { id: 'w_bigwin2', label: 'Win by 3+ twice', target: 2, reward: 200, inc: (f) => (f.win && f.goalsFor - f.goalsAgainst >= 3 ? 1 : 0) },
  { id: 'w_tonil2', label: 'Win to nil twice', target: 2, reward: 220, inc: (f) => (f.win && f.cleanSheet ? 1 : 0) },
  { id: 'w_play7', label: 'Play 7 matches', target: 7, reward: 150, inc: () => 1 },
  { id: 'w_play5', label: 'Play 5 matches', target: 5, reward: 110, inc: () => 1 },
];

/** Default number of weekly orders. */
export const WEEKLY_ORDER_COUNT = 3;

/**
 * Forgiving weekly activity target: play on this many distinct local days this
 * week to earn the activity bonus (retention.md §3 — no punishment on miss).
 */
export const WEEKLY_ACTIVITY_TARGET = 3;
/** XP bonus for reaching the weekly activity target. */
export const WEEKLY_ACTIVITY_BONUS_XP = 200;
/** Coin bonus for reaching the weekly activity target. */
export const WEEKLY_ACTIVITY_BONUS_COINS = 150;

const weeklyDef = (id: string): OrderDef | undefined => WEEKLY_ORDER_DEFS.find((o) => o.id === id);

/** A human label for a weekly order id (for the UI). */
export function weeklyOrderLabel(id: string): string {
  return weeklyDef(id)?.label ?? ORDERS.find((o) => o.id === id)?.label ?? id;
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

// ---- weekly order functions (E4) --------------------------------------------

function pickWeeklyDistinct(count: number, exclude: string[] = []): OrderDef[] {
  const pool = WEEKLY_ORDER_DEFS.filter((o) => !exclude.includes(o.id));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

/** A fresh set of weekly orders as zeroed quest state. */
export function rollWeeklyOrders(count = WEEKLY_ORDER_COUNT): QuestState[] {
  return pickWeeklyDistinct(count).map((o) => ({ id: o.id, progress: 0, target: o.target, claimed: false }));
}

/** Reset the weekly block for a new ISO week. */
export function resetWeekly(weekly: WeeklyState, weekId = isoWeekId()): void {
  weekly.weekId = weekId;
  weekly.orders = rollWeeklyOrders();
  weekly.activeDays = [];
}

/** Lazily ensure the weekly block matches this ISO week (rolls orders on a new week). */
export function ensureThisWeek(weekly: WeeklyState, weekId = isoWeekId()): boolean {
  if (weekly.weekId !== weekId || weekly.orders.length === 0) {
    resetWeekly(weekly, weekId);
    return true;
  }
  return false;
}

/**
 * Reroll the weekly order at `index` (once per week) for a different, not-currently-held
 * order. Uses the same `rerollUsed` flag convention on the weekly block. Returns true if
 * the reroll happened.
 *
 * Note: `WeeklyState` does not yet have a `rerollUsed` field — we store it as a sentinel
 * activeDays entry `"__rerolled"` to avoid a schema migration.
 */
export function rerollWeeklyOrder(weekly: WeeklyState, index: number): boolean {
  if (weekly.activeDays.includes('__rerolled')) return false;
  if (index < 0 || index >= weekly.orders.length) return false;
  const held = weekly.orders.map((o) => o.id);
  const [next] = pickWeeklyDistinct(1, held);
  if (!next) return false;
  weekly.orders[index] = { id: next.id, progress: 0, target: next.target, claimed: false };
  weekly.activeDays.push('__rerolled');
  return true;
}

/** True if the weekly reroll has been used this week. */
export function weeklyRerollUsed(weekly: WeeklyState): boolean {
  return weekly.activeDays.includes('__rerolled');
}

/** Orders still to finish this week (for the "next best action" copy). */
export function remainingWeeklyOrders(weekly: WeeklyState): QuestState[] {
  return weekly.orders.filter((q) => !q.claimed);
}

/** The outcome of scoring a match against the weekly systems. */
export interface WeeklyProgress {
  /** Labels of weekly orders completed by this match. */
  completed: string[];
  /** Coins from completed weekly orders. */
  orderCoins: number;
  /** Distinct active days this week after recording today. */
  activeDays: number;
  /** The weekly activity target was hit for the first time this match. */
  activityBonusAwarded: boolean;
  /** XP from the activity bonus (0 if not triggered). */
  activityBonusXp: number;
  /** Coins from the activity bonus (0 if not triggered). */
  activityBonusCoins: number;
}

/**
 * Score a finished match against the weekly systems: advance orders, auto-claim
 * completions, and record today as an active day. Triggers the activity bonus the
 * first time {@link WEEKLY_ACTIVITY_TARGET} distinct days are reached.
 * Mutates `weekly`; the caller persists the save.
 */
export function progressWeekly(weekly: WeeklyState, f: MatchFacts, today = localDateString()): WeeklyProgress {
  const completed: string[] = [];
  let orderCoins = 0;

  for (const q of weekly.orders) {
    if (q.claimed) continue;
    const d = weeklyDef(q.id);
    if (!d) continue;
    q.progress = Math.min(q.target, q.progress + d.inc(f));
    if (q.progress >= q.target) {
      q.claimed = true;
      completed.push(d.label);
      orderCoins += d.reward;
    }
  }

  // record today as an active day (dedup; skip the internal sentinel)
  const real = weekly.activeDays.filter((d) => d !== '__rerolled');
  const alreadyCounted = real.includes(today);
  if (!alreadyCounted) weekly.activeDays.push(today);
  const activeDays = weekly.activeDays.filter((d) => d !== '__rerolled').length;

  // award the activity bonus exactly once per week: when we first hit the target
  const hitTarget = !alreadyCounted && activeDays === WEEKLY_ACTIVITY_TARGET;
  const activityBonusXp = hitTarget ? WEEKLY_ACTIVITY_BONUS_XP : 0;
  const activityBonusCoins = hitTarget ? WEEKLY_ACTIVITY_BONUS_COINS : 0;

  return { completed, orderCoins, activeDays, activityBonusAwarded: hitTarget, activityBonusXp, activityBonusCoins };
}

