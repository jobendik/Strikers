/*
 * Shared headless match runner.
 *
 * Plays a full AI-vs-AI match by calling the *same* `stepSimulation` the rendered
 * game calls — there is no second copy of the match loop. Used by the balance
 * harness (`simtest/harness.ts`) and available to the game for resolving fixtures.
 *
 * A match is a pure function of (teams, options, seed): the same seed always
 * produces the same match, tick for tick.
 */
import { SIM_HZ } from '../core/time';
import { CFG } from '../config/constants';
import { setBusMuted } from '../core/bus';
import { createGameState, match, ball } from './state';
import { startMatch, startSecondHalf } from './flow';
import { stepSimulation } from './step';
import { pcVersion } from '../ai/pitchControl';

const finite = (x: number): boolean => Number.isFinite(x);

/** Tunables for a single simulated match. */
export interface SimOptions {
  /** Difficulty (0 Easy … 4 World Class) — sets `CFG.diff` for the match. */
  diff?: number;
  /** Seconds per half. Defaults to the current `CFG.matchSeconds`. */
  secondsPerHalf?: number;
  /** Pin both teams to balanced mentality (isolates the away-adaptation bias). */
  freeze?: boolean;
  /** RNG seed (default 1). Same seed ⇒ identical match. */
  seed?: number;
  /** Keep the event bus live during the run (default: muted). */
  events?: boolean;
  /** Called after every tick (diagnostics). */
  onTick?: () => void;
}

/** Outcome + balance/correctness metrics for one simulated match. */
export interface SimResult {
  score: [number, number];
  shots: [number, number];
  onTarget: [number, number];
  passes: [number, number];
  tackles: [number, number];
  saves: [number, number];
  xg: [number, number];
  /** Possession measured as seconds in control. */
  possession: [number, number];
  /** 0 = home, 1 = away, or null on a draw (this runner never settles draws). */
  winner: 0 | 1 | null;
  // --- QA / balance instrumentation ---
  /** Passes that reached an intended team-mate. */
  completed: number;
  /** Passes the opponent intercepted. */
  intercepted: number;
  /** Worst out-of-bounds excursion of the ball while in play (m beyond the line). */
  maxOOB: number;
  /** A non-finite ball/player state was seen (a bug). */
  nan: boolean;
  /** Ticks where the ball sat dead and uncontrolled in open play (>1.5 s spells). */
  stuckFrames: number;
  /** The hard tick cap was hit before full time (a hang). */
  guardHit: boolean;
  /** Restarts by kind. */
  throwIns: number;
  corners: number;
  goalKicks: number;
  fouls: number;
  /** Mean distance covered per outfield player (m). */
  distance: number;
  /** How many times the pitch-control grid was refreshed during the match. */
  pcUpdates: number;
  /** Seconds each team tactic was active, summed over both sides. */
  tactics: Record<string, number>;
  /** A cheap hash of the final state — equal for equal seeds (determinism check). */
  hash: number;
  ticks: number;
}

/**
 * Play one full AI-vs-AI match between two team keys and return the result.
 *
 * Resets and takes over the global game state (`createGameState`). Draws stand —
 * knockout tie-breaking is the caller's job.
 */
export function simulateMatch(homeKey: string, awayKey: string, opts: SimOptions = {}): SimResult {
  CFG.diff = opts.diff ?? CFG.diff;
  if (opts.secondsPerHalf !== undefined) CFG.matchSeconds = opts.secondsPerHalf;
  const freeze = opts.freeze ?? false;

  createGameState();
  match.teams[0].setIdentity(homeKey);
  match.teams[1].setIdentity(awayKey);
  match.simRules = false;
  match.settleDraws = false;
  match.teams[0].isUser = false; // nobody is human in a headless match

  let maxOOB = 0;
  let nan = false;
  let stuck = 0;
  let idleStreak = 0;
  let throwIns = 0;
  let corners = 0;
  let goalKicks = 0;
  let fouls = 0;
  let lastRestart: unknown = null;
  const tactics: Record<string, number> = {};

  if (!opts.events) setBusMuted(true);
  const pc0 = pcVersion;
  startMatch(opts.seed ?? 1);
  let guard = 0;
  const MAXT = SIM_HZ * 60 * 14; // 14 simulated minutes hard cap
  while (match.state !== 'fulltime' && guard < MAXT) {
    if (match.state === 'halftime') startSecondHalf();
    if (freeze) {
      match.teams[0].mentality = 1;
      match.teams[1].mentality = 1;
    }
    stepSimulation({ human: false });
    opts.onTick?.();
    guard++;

    if (match.state === 'play') {
      for (const t of match.teams) tactics[t.tactic] = (tactics[t.tactic] ?? 0) + 1 / SIM_HZ;
      const bp = ball.position;
      const bv = ball.velocity;
      if (!finite(bp.x) || !finite(bp.y) || !finite(bp.z) || !finite(bv.x) || !finite(bv.y) || !finite(bv.z)) nan = true;
      if (!match.restart) {
        maxOOB = Math.max(maxOOB, Math.abs(bp.x) - CFG.halfL, Math.abs(bp.z) - CFG.halfW);
        const idle = !match.controlPlayer && Math.hypot(bv.x, bv.z) < 0.3;
        idleStreak = idle ? idleStreak + 1 : 0;
        if (idleStreak > SIM_HZ * 1.5) stuck++;
      } else if (match.restart !== lastRestart) {
        const k = match.restart.kind;
        if (k === 'throw') throwIns++;
        else if (k === 'corner') corners++;
        else if (k === 'goalkick') goalKicks++;
        else fouls++;
      }
      lastRestart = match.restart;
    }
  }
  setBusMuted(false);

  let dist = 0;
  let n = 0;
  let hash = (match.score[0] * 31 + match.score[1]) | 0;
  for (const t of match.teams)
    for (const p of t.players) {
      if (!finite(p.position.x) || !finite(p.position.z)) nan = true;
      hash = (Math.imul(hash, 16777619) ^ Math.round(p.position.x * 1000) ^ (Math.round(p.position.z * 1000) << 8)) | 0;
      if (p.roleType !== 'GK') {
        dist += p.statDist;
        n++;
      }
    }
  hash = (Math.imul(hash, 16777619) ^ Math.round(ball.position.x * 1000) ^ match.stats.passes[0] ^ (match.stats.passes[1] << 10)) | 0;

  const score: [number, number] = [match.score[0], match.score[1]];
  const winner: 0 | 1 | null = score[0] > score[1] ? 0 : score[1] > score[0] ? 1 : null;
  const s = match.stats;
  return {
    score,
    shots: [s.shots[0], s.shots[1]],
    onTarget: [s.onTarget[0], s.onTarget[1]],
    passes: [s.passes[0], s.passes[1]],
    tackles: [s.tackles[0], s.tackles[1]],
    saves: [s.saves[0], s.saves[1]],
    xg: [s.xg[0], s.xg[1]],
    possession: [s.possession[0], s.possession[1]],
    winner,
    completed: s.passesDone[0] + s.passesDone[1],
    intercepted: s.interceptions[0] + s.interceptions[1],
    maxOOB,
    nan,
    stuckFrames: stuck,
    guardHit: guard >= MAXT,
    throwIns,
    corners,
    goalKicks,
    fouls,
    distance: n ? dist / n : 0,
    tactics,
    pcUpdates: pcVersion - pc0,
    hash,
    ticks: guard,
  };
}
