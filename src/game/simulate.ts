/*
 * Shared headless match runner.
 *
 * Drives the *real* simulation loop (the same control / movement / physics / AI
 * the rendered game runs, minus rendering) for a full AI-vs-AI match and returns
 * the result plus balance/correctness metrics. This is the single source of truth
 * for "play a whole match with no human":
 *
 *   - the headless balance harness (`simtest/harness.ts`) calls it to validate
 *     balance over many matches, and
 *   - the in-game World Cup tournament resolves every AI-vs-AI fixture through it.
 *
 * Clock source note: Yuka's `Regulator`s read `performance.now()`. For a frame-
 * burst loop like this to behave deterministically, that clock must follow the
 * SIM clock, not wall time. The harness patches `performance.now` globally before
 * importing anything. An in-game caller running this on the live page must arrange
 * the same for the duration of the burst (see `game/worldcup.ts`); the live render
 * loop is paused while a batch of fixtures is resolved, so a temporary swap is safe.
 */
import { sim, advanceTime } from '../core/time';
import { CFG } from '../config/constants';
import { createGameState, match, ball, teamIndex, setReceiver, setPassRequest } from './state';
import { startMatch, startSecondHalf, kickOff, tickClock } from './flow';
import { resolveControl, updateGkHold, resolveSlides, updatePressure } from './control';
import { movePlayers } from './movement';
import { updateBall } from './physics';

const DT = 1 / 60;
const finite = (x: number): boolean => Number.isFinite(x);

/** Tunables for a single simulated match. */
export interface SimOptions {
  /** Difficulty (0 Easy · 1 Pro · 2 Legend) — sets `CFG.diff` for the match. */
  diff?: number;
  /** Seconds per half. Defaults to the current `CFG.matchSeconds`. */
  secondsPerHalf?: number;
  /** Pin both teams to balanced mentality (isolates the away-adaptation bias). */
  freeze?: boolean;
}

/** Outcome + balance/correctness metrics for one simulated match. */
export interface SimResult {
  score: [number, number];
  shots: [number, number];
  onTarget: [number, number];
  passes: [number, number];
  tackles: [number, number];
  saves: [number, number];
  /** Possession measured as seconds in control. */
  possession: [number, number];
  /** 0 = home, 1 = away, or null on a draw (this runner never settles draws). */
  winner: 0 | 1 | null;
  // --- QA / balance instrumentation ---
  /** Passes that reached an intended team-mate. */
  completed: number;
  /** Passes the opponent intercepted. */
  intercepted: number;
  /** Worst out-of-bounds excursion of the ball (world units beyond the line). */
  maxOOB: number;
  /** A non-finite ball position/velocity was seen (a bug). */
  nan: boolean;
  /** Frames where the ball sat dead and uncontrolled in open play (>1.5s spells). */
  stuckFrames: number;
  /** The hard frame cap was hit before full time (a hang). */
  guardHit: boolean;
}

interface Tracker {
  playFrames: number;
  maxOOB: number;
  nan: boolean;
  completed: number;
  intercepted: number;
  stuckFrames: number;
  // internal trackers
  _lastPass: number;
  _pending: unknown;
  _prevCtrl: unknown;
  _idleStreak: number;
}

let FREEZE = false; // pin both teams to balanced mentality for the current run

function instrument(s: Tracker): void {
  if (!finite(ball.position.x) || !finite(ball.position.z) || !finite(ball.velocity.x) || !finite(ball.velocity.z)) s.nan = true;
  s.maxOOB = Math.max(s.maxOOB, Math.abs(ball.position.x) - CFG.halfL, Math.abs(ball.position.z) - CFG.halfW);

  // pass completion: a 'pass' increments match.stats.passes; watch who next gains control
  const pc = match.stats.passes[0] + match.stats.passes[1];
  if (pc > s._lastPass) {
    s._pending = ball.passer ? ball.passer.team : null;
    s._lastPass = pc;
  }
  const cp = match.controlPlayer;
  if (cp && cp !== s._prevCtrl && s._pending) {
    if (cp.team === s._pending) s.completed++;
    else s.intercepted++;
    s._pending = null;
  }
  s._prevCtrl = cp;

  // "stuck" detection: nobody in control and ball nearly still during open play
  const idle = !match.controlPlayer && Math.hypot(ball.velocity.x, ball.velocity.z) < 0.4;
  s._idleStreak = idle ? s._idleStreak + 1 : 0;
  if (s._idleStreak > 90) s.stuckFrames++; // >1.5s of dead, uncontrolled ball
}

/** Advance one fixed 1/60s simulation frame (mirrors loop.ts minus rendering). */
function stepFrame(s: Tracker): void {
  if (match.timeScale < 1) match.timeScale = Math.min(1, match.timeScale + CFG.slowmoRecover * DT);
  const sdt = DT * match.timeScale;
  advanceTime(sdt);

  if (match.state === 'play') {
    if (FREEZE) {
      match.teams[0].mentality = 1;
      match.teams[1].mentality = 1;
    }
    tickClock(DT);
    if (match.controlTeam) match.stats.possession[teamIndex(match.controlTeam)] += DT;
    if (match.receivingPlayer) {
      match.receiveTimer -= sdt;
      if (match.receiveTimer <= 0) setReceiver(null);
    }
    if (match.callingPlayer) {
      match.callTimer -= sdt;
      if (match.callTimer <= 0) setPassRequest(null);
    }
    resolveControl(sdt);
    updateGkHold(sdt);
    // no selectUserPlayer — AI vs AI
    match.teams[0].update(sdt);
    match.teams[1].update(sdt);
    movePlayers(sdt);
    resolveSlides(sdt);
    updatePressure(sdt);
    updateBall(sdt);
    s.playFrames++;
    instrument(s);
  } else if (match.state === 'celebrate') {
    if (match.celebrateBallT > 0) {
      match.celebrateBallT -= DT;
      updateBall(sdt);
      match.celebrateT -= DT;
    } else {
      match.celebrateT -= DT;
      if (match.celebrateT <= 0) kickOff(match.teams[1 - match.scoredBy]);
    }
  }
}

/**
 * Play one full AI-vs-AI match between two team keys and return the result.
 *
 * Resets and takes over the global game state (`createGameState`), so callers
 * that share the live state (the rendered game) must snapshot/restore around a
 * batch of calls. `match.simRules`/`settleDraws` are forced off — this returns the
 * raw scoreline (draws included); knockout tie-breaking is the caller's job.
 */
export function simulateMatch(homeKey: string, awayKey: string, opts: SimOptions = {}): SimResult {
  CFG.diff = opts.diff ?? CFG.diff;
  if (opts.secondsPerHalf !== undefined) CFG.matchSeconds = opts.secondsPerHalf;
  FREEZE = opts.freeze ?? false;

  createGameState();
  sim.elapsed = 0;
  sim.dt = 0;
  match.teams[0].setIdentity(homeKey);
  match.teams[1].setIdentity(awayKey);
  match.simRules = false;
  match.settleDraws = false;

  const s: Tracker = {
    playFrames: 0, maxOOB: 0, nan: false, completed: 0, intercepted: 0, stuckFrames: 0,
    _lastPass: 0, _pending: null, _prevCtrl: null, _idleStreak: 0,
  };
  startMatch();
  let guard = 0;
  const MAXF = 60 * 60 * 14; // 14 min sim hard cap
  while (match.state !== 'fulltime' && guard < MAXF) {
    if (match.state === 'halftime') startSecondHalf();
    stepFrame(s);
    guard++;
  }

  const score: [number, number] = [match.score[0], match.score[1]];
  const winner: 0 | 1 | null = score[0] > score[1] ? 0 : score[1] > score[0] ? 1 : null;
  return {
    score,
    shots: [match.stats.shots[0], match.stats.shots[1]],
    onTarget: [match.stats.onTarget[0], match.stats.onTarget[1]],
    passes: [match.stats.passes[0], match.stats.passes[1]],
    tackles: [match.stats.tackles[0], match.stats.tackles[1]],
    saves: [match.stats.saves[0], match.stats.saves[1]],
    possession: [match.stats.possession[0], match.stats.possession[1]],
    winner,
    completed: s.completed,
    intercepted: s.intercepted,
    maxOOB: s.maxOOB,
    nan: s.nan,
    stuckFrames: s.stuckFrames,
    guardHit: guard >= MAXF,
  };
}
