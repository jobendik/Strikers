/*
 * Match reward pipeline (C2) — the spine of "every match grants visible progress".
 *
 * Called once when a match is decided (from `modes.presentResult`, which is the
 * result-screen owner and is stubbed out of the headless balance harness — so the
 * pipeline never runs during balance sims). Computes XP/coins from the result and
 * performance, applies the first-match-of-day bonus, rolls the account level/title
 * (C2/C3), updates lifetime stats, persists the save, and returns a structured
 * {@link MatchRewards} for the result screen (D) to reveal in order.
 *
 * Reward reveal order (retention §25.3) is the caller's job; this just produces the
 * data. Daily orders / chest / season / achievements (E/F/G) will extend the same
 * pipeline here as those systems land.
 */
import { getPlayerData, savePlayerData } from '../core/playerData';
import { grantXp, titleForLevel } from '../core/progression';
import { localDateString } from '../core/dates';
import { isoWeekId } from '../core/dates';
import {
  ensureToday, progressDaily, remainingOrders, orderLabel, CHEST_MAX, type MatchFacts,
  ensureThisWeek, progressWeekly, remainingWeeklyOrders, weeklyOrderLabel,
  WEEKLY_ACTIVITY_TARGET, type WeeklyProgress,
} from './quests';

/** What happened in the match, from the *user team's* perspective. */
export interface MatchOutcome {
  win: boolean;
  draw: boolean;
  loss: boolean;
  goalsFor: number;
  goalsAgainst: number;
}

/** Itemised XP grant (for the result screen's breakdown). */
export interface XpBreakdown {
  base: number;
  firstMatch: number;
  goals: number;
  cleanSheet: number;
  margin: number;
  firstWin: number;
  total: number;
}

/** A daily-order line for the result screen. */
export interface OrderProgress {
  label: string;
  progress: number;
  target: number;
  done: boolean;
}

/** Daily-systems progress this match (E2/E3). */
export interface DailyRewards {
  orders: OrderProgress[];
  /** Labels of orders completed this match. */
  completed: string[];
  /** 0–100 chest meter before this match (for the result-screen fill animation). */
  chestBefore: number;
  /** 0–100 chest meter after this match. */
  chestPoints: number;
  chestMax: number;
  /** The chest filled this match. */
  chestAwarded: boolean;
  /** A concise "next best action" nudge (or empty). */
  nextBest: string;
}

/** A weekly order line for the result screen. */
export interface WeeklyOrderProgress {
  label: string;
  progress: number;
  target: number;
  done: boolean;
}

/** Weekly-systems progress this match (E4). */
export interface WeeklyRewards {
  orders: WeeklyOrderProgress[];
  /** Labels of weekly orders completed this match. */
  completed: string[];
  /** Distinct active days this week (1–7). */
  activeDays: number;
  /** The activity target for the bonus. */
  activityTarget: number;
  /** The weekly activity bonus was awarded this match. */
  activityBonusAwarded: boolean;
}

/** Everything the result screen needs to reveal after a match. */
export interface MatchRewards {
  result: 'win' | 'draw' | 'loss';
  goalsFor: number;
  goalsAgainst: number;
  cleanSheet: boolean;
  xp: XpBreakdown;
  coins: number;
  // post-grant account standing:
  level: number;
  xpIntoLevel: number;
  xpForNext: number;
  levelsGained: number;
  newTitle: string | null;
  firstMatchOfDay: boolean;
  firstWinOfDay: boolean;
  daily: DailyRewards;
  weekly: WeeklyRewards;
}

// --- tunables (retention §3.1) ----------------------------------------------
const XP_WIN = 140;
const XP_DRAW = 90;
const XP_LOSS = 60; // a loss still pays
const XP_FIRST_MATCH = 100; // once per local day
const XP_PER_GOAL = 30;
const XP_GOALS_CAP = 120;
const XP_CLEAN_SHEET = 80;
const XP_BIG_WIN = 50; // win by 3+
const BIG_WIN_MARGIN = 3;

const XP_FIRST_WIN = 60; // first win of the local day (E)
const COINS_WIN = 50;
const COINS_DRAW = 25;
const COINS_LOSS = 12;
const COINS_PER_GOAL = 5;
const COINS_FIRST_MATCH = 25;
const COINS_FIRST_WIN = 40;

/**
 * Run the reward pipeline for a decided match and persist the result. Mutates the
 * live player save; returns the breakdown for the UI.
 */
export function applyMatchRewards(o: MatchOutcome): MatchRewards {
  const data = getPlayerData();
  const today = localDateString();
  const thisWeek = isoWeekId();
  const result: 'win' | 'draw' | 'loss' = o.win ? 'win' : o.loss ? 'loss' : 'draw';
  const cleanSheet = o.goalsAgainst === 0;

  // first match of a new local day (drives the first-match bonus + daily reset)
  const firstMatchOfDay = data.daily.date !== today;
  ensureToday(data.daily, today); // roll fresh daily orders / chest on a new day (E2/E3)

  // ensure weekly block is current (rolls fresh weekly orders on a new ISO week) (E4)
  ensureThisWeek(data.weekly, thisWeek);

  // first *win* of the day (E first-win bonus)
  const firstWinOfDay = o.win && !data.daily.firstWin;
  if (firstWinOfDay) data.daily.firstWin = true;

  // --- XP ---
  const base = o.win ? XP_WIN : o.draw ? XP_DRAW : XP_LOSS;
  const firstMatch = firstMatchOfDay ? XP_FIRST_MATCH : 0;
  const goalsXp = Math.min(XP_GOALS_CAP, o.goalsFor * XP_PER_GOAL);
  const cleanSheetXp = cleanSheet && !o.loss ? XP_CLEAN_SHEET : 0;
  const marginXp = o.win && o.goalsFor - o.goalsAgainst >= BIG_WIN_MARGIN ? XP_BIG_WIN : 0;
  const firstWinXp = firstWinOfDay ? XP_FIRST_WIN : 0;

  // --- daily orders + chest (E2/E3) ---
  const facts: MatchFacts = {
    win: o.win,
    draw: o.draw,
    loss: o.loss,
    goalsFor: o.goalsFor,
    goalsAgainst: o.goalsAgainst,
    cleanSheet,
  };
  const chestBefore = data.daily.chestPoints; // captured before progressDaily mutates it
  const dp = progressDaily(data.daily, facts);

  // --- weekly orders + activity meter (E4) ---
  const wp: WeeklyProgress = progressWeekly(data.weekly, facts, today);

  const totalXp = base + firstMatch + goalsXp + cleanSheetXp + marginXp + firstWinXp + wp.activityBonusXp;

  const xp: XpBreakdown = {
    base,
    firstMatch,
    goals: goalsXp,
    cleanSheet: cleanSheetXp,
    margin: marginXp,
    firstWin: firstWinXp,
    total: totalXp,
  };

  // --- coins ---
  const coins =
    (o.win ? COINS_WIN : o.draw ? COINS_DRAW : COINS_LOSS) +
    o.goalsFor * COINS_PER_GOAL +
    (firstMatchOfDay ? COINS_FIRST_MATCH : 0) +
    (firstWinOfDay ? COINS_FIRST_WIN : 0) +
    dp.orderCoins +
    dp.chestCoins +
    wp.orderCoins +
    wp.activityBonusCoins;

  // --- apply to the save ---
  const out = grantXp(data.level, data.xp, totalXp);
  data.level = out.level;
  data.xp = out.xpIntoLevel;
  data.title = titleForLevel(out.level);
  data.coins += coins;

  data.stats.played++;
  if (o.win) data.stats.wins++;
  else if (o.draw) data.stats.draws++;
  else data.stats.losses++;
  data.stats.goals += o.goalsFor;
  data.stats.conceded += o.goalsAgainst;
  if (cleanSheet) data.stats.cleanSheets++;

  savePlayerData();

  // "next best action" copy (honest, no pressure) — chest first, then an order
  const chestLeft = CHEST_MAX - data.daily.chestPoints;
  const remaining = remainingOrders(data.daily);
  const weeklyRemaining = remainingWeeklyOrders(data.weekly);
  let nextBest = '';
  if (dp.chestAwarded) nextBest = 'Daily chest claimed! The meter resets — keep going.';
  else if (chestLeft <= 40) nextBest = 'One more match fills your daily chest.';
  else if (remaining.length) nextBest = `Daily order: ${orderLabel(remaining[0].id)} — ${remaining[0].progress}/${remaining[0].target}.`;
  else if (weeklyRemaining.length) nextBest = `Weekly: ${weeklyOrderLabel(weeklyRemaining[0].id)} — ${weeklyRemaining[0].progress}/${weeklyRemaining[0].target}.`;

  const daily: DailyRewards = {
    orders: data.daily.orders.map((q) => ({ label: orderLabel(q.id), progress: q.progress, target: q.target, done: q.claimed })),
    completed: dp.completed,
    chestBefore,
    chestPoints: data.daily.chestPoints,
    chestMax: CHEST_MAX,
    chestAwarded: dp.chestAwarded,
    nextBest,
  };

  const weekly: WeeklyRewards = {
    orders: data.weekly.orders.map((q) => ({ label: weeklyOrderLabel(q.id), progress: q.progress, target: q.target, done: q.claimed })),
    completed: wp.completed,
    activeDays: wp.activeDays,
    activityTarget: WEEKLY_ACTIVITY_TARGET,
    activityBonusAwarded: wp.activityBonusAwarded,
  };

  return {
    result,
    goalsFor: o.goalsFor,
    goalsAgainst: o.goalsAgainst,
    cleanSheet,
    xp,
    coins,
    level: out.level,
    xpIntoLevel: out.xpIntoLevel,
    xpForNext: out.xpForNext,
    levelsGained: out.levelsGained,
    newTitle: out.newTitle,
    firstMatchOfDay,
    firstWinOfDay,
    daily,
    weekly,
  };
}
