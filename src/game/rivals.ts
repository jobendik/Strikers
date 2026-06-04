/*
 * Simulated rivals, leaderboard, activity feed and region goals (K1/K2/K4).
 *
 * There is no real backend here (the CrazyGames leaderboard API would slot in on
 * platform), so everything is a *clearly-labelled local simulation*: fictional
 * rival names, deterministic per-week scores, a fiction-framed community goal.
 * Honest by construction (retention §3) — the UI labels it "Simulated", nothing
 * implies real people or real aggregate data, and the player's own numbers are real.
 *
 * Pure/deterministic (date + save → result). Reached via the result-screen owner
 * (weekly-score bump) and the live UI, both outside the headless sim.
 */
import type { PlayerData } from '../core/playerData';
import { isoWeekId } from '../core/dates';
import { teamMeta } from '../config/players';

/** A fictional rival (no real likenesses — names are invented). */
interface Rival {
  name: string;
  nation: string;
}

const RIVALS: Rival[] = [
  { name: 'A. Stormgaard', nation: 'NORWAY' },
  { name: 'L. Márquez', nation: 'MEXICO' },
  { name: 'K. Tanaka', nation: 'JAPAN' },
  { name: 'D. Okafor', nation: 'SENEGAL' },
  { name: 'R. da Silva', nation: 'BRAZIL' },
  { name: 'M. Rossi', nation: 'ITALY' },
  { name: 'T. Becker', nation: 'GERMANY' },
  { name: 'J. Carter', nation: 'USA' },
  { name: 'P. Dubois', nation: 'FRANCE' },
  { name: 'S. Kovač', nation: 'CROATIA' },
  { name: 'O. El Amrani', nation: 'MOROCCO' },
  { name: 'V. Ferreira', nation: 'PORTUGAL' },
];

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A compact numeric stamp for an ISO week (e.g. 2026-W23 → 202623). */
function weekStamp(weekId: string = isoWeekId()): number {
  const m = /^(\d+)-W(\d+)$/.exec(weekId);
  return m ? Number(m[1]) * 100 + Number(m[2]) : hashStr(weekId) % 1_000_000;
}

/**
 * Add weekly leaderboard points to the player, resetting the tally on a new ISO
 * week (so the board is genuinely weekly). Mutates the save; caller persists.
 */
export function bumpWeeklyScore(data: PlayerData, points: number): void {
  const stamp = weekStamp();
  if (data.records.weekStamp !== stamp) {
    data.records.weekStamp = stamp;
    data.records.weeklyScore = 0;
  }
  data.records.weeklyScore = (data.records.weeklyScore ?? 0) + points;
}

export interface LeaderRow {
  name: string;
  nation: string;
  score: number;
  you: boolean;
}

export interface Leaderboard {
  rows: LeaderRow[];
  rank: number;
  total: number;
  /** Participation tier from rank ("Top 10%", etc.) — everyone places (K1). */
  tier: string;
}

/**
 * This week's simulated leaderboard with the player slotted in by their real
 * weekly score. Rival scores are deterministic per week (stable all week, fresh
 * next week). Honest: clearly a local simulation, the player's number is real.
 */
export function weeklyLeaderboard(data: PlayerData): Leaderboard {
  const rnd = mulberry32(hashStr(`lb:${weekStamp()}`));
  const youScore = data.records.weekStamp === weekStamp() ? (data.records.weeklyScore ?? 0) : 0;
  const rows: LeaderRow[] = RIVALS.map((r) => ({
    name: r.name,
    nation: r.nation,
    score: 8 + Math.floor(rnd() * 46), // 8–53 weekly points
    you: false,
  }));
  rows.push({ name: data.name || 'YOU', nation: data.flag, score: youScore, you: true });
  rows.sort((a, b) => b.score - a.score);
  const rank = rows.findIndex((r) => r.you) + 1;
  const total = rows.length;
  const pctile = rank / total;
  const tier = pctile <= 0.1 ? 'Top 10%' : pctile <= 0.25 ? 'Top 25%' : pctile <= 0.5 ? 'Top half' : 'Participant';
  return { rows, rank, total, tier };
}

export interface FeedItem {
  text: string;
  tone: 'win' | 'milestone' | 'info';
}

/** A deterministic "Simulation Feed" of recent rival activity (labelled in the UI). */
export function activityFeed(seed: string = isoWeekId()): FeedItem[] {
  const rnd = mulberry32(hashStr(`feed:${seed}`));
  const items: FeedItem[] = [];
  for (let i = 0; i < 8; i++) {
    const r = RIVALS[Math.floor(rnd() * RIVALS.length)];
    const who = `${r.name} (${teamMeta(r.nation).name})`;
    const kind = rnd();
    if (kind < 0.45) items.push({ text: `${who} won ${1 + Math.floor(rnd() * 4)}–${Math.floor(rnd() * 2)}`, tone: 'win' });
    else if (kind < 0.7) items.push({ text: `${who} reached Season Tier ${2 + Math.floor(rnd() * 24)}`, tone: 'milestone' });
    else if (kind < 0.88) items.push({ text: `${who} is on a ${3 + Math.floor(rnd() * 6)}-win streak`, tone: 'milestone' });
    else items.push({ text: `${who} won the World Cup 🏆`, tone: 'win' });
  }
  return items;
}

export interface RegionGoal {
  region: string;
  label: string;
  target: number;
  progress: number;
  yourContribution: number;
  pct: number;
}

/** A fiction-framed community goal for the player's region (clearly labelled in UI). */
export function regionGoal(data: PlayerData): RegionGoal {
  const REGIONS: Record<string, string> = {
    USA: 'North America', MEXICO: 'North America',
    BRAZIL: 'South America', ARGENTINA: 'South America',
    NORWAY: 'Europe', FRANCE: 'Europe', ENGLAND: 'Europe', SPAIN: 'Europe', GERMANY: 'Europe',
    PORTUGAL: 'Europe', NETHERLANDS: 'Europe', ITALY: 'Europe', CROATIA: 'Europe',
    JAPAN: 'Asia', MOROCCO: 'Africa', SENEGAL: 'Africa',
  };
  const region = REGIONS[data.flag] ?? 'World';
  const rnd = mulberry32(hashStr(`region:${region}:${weekStamp()}`));
  const target = 1_000_000;
  const base = Math.floor(target * (0.35 + rnd() * 0.5)); // 35–85% simulated community progress
  const yourContribution = data.stats.goals; // the player's real career goals count toward it
  const progress = Math.min(target, base + yourContribution);
  return { region, label: `${region} — score ${target.toLocaleString()} goals together`, target, progress, yourContribution, pct: progress / target };
}
