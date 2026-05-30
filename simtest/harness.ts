/*
 * Headless AI-vs-AI match runner. Drives the real simulation loop (mirrors
 * loop.ts minus rendering) for full matches and reports balance + correctness
 * metrics. No human is assigned, so both teams are fully AI — the cleanest way
 * to measure whether the game is balanced and behaves correctly.
 *
 * Run after `vite build -c simtest/vite.config.ts`:
 *   node simtest/dist/harness.mjs [matchesPerScenario] [secondsPerHalf]
 */
import { sim, advanceTime } from '../src/core/time';

// Point Yuka's wall-clock Regulators (AI decision throttles) at the SIM clock so
// decision cadence is frame-accurate in this fast headless run rather than tied
// to real elapsed time. Must be active before the first Regulator.ready().
const _perf: { now: () => number } = (globalThis as { performance?: { now: () => number } }).performance ?? ({} as { now: () => number });
_perf.now = () => sim.elapsed * 1000;
(globalThis as unknown as { performance: { now: () => number } }).performance = _perf;

import { CFG } from '../src/config/constants';
import { createGameState, match, ball, teamIndex, setReceiver, setPassRequest } from '../src/game/state';
import { startMatch, startSecondHalf, kickOff, tickClock } from '../src/game/flow';
import { resolveControl, updateGkHold, resolveSlides, updatePressure } from '../src/game/control';
import { movePlayers } from '../src/game/movement';
import { updateBall } from '../src/game/physics';

const DT = 1 / 60;
const finite = (x: number): boolean => Number.isFinite(x);
let FREEZE = false; // when true, pin both teams to balanced mentality (isolates the away-adaptation bias)

interface MatchStat {
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

function instrument(s: MatchStat): void {
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

function stepFrame(s: MatchStat): void {
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

interface MatchResult {
  score: number[];
  shots: number[];
  onTarget: number[];
  passes: number[];
  tackles: number[];
  saves: number[];
  possession: number[];
  completed: number;
  intercepted: number;
  maxOOB: number;
  nan: boolean;
  stuckFrames: number;
  guardHit: boolean;
}

function runMatch(homeKey: string, awayKey: string, diff: number, freeze = false): MatchResult {
  CFG.diff = diff;
  FREEZE = freeze;
  createGameState();
  sim.elapsed = 0;
  sim.dt = 0;
  match.teams[0].setIdentity(homeKey);
  match.teams[1].setIdentity(awayKey);
  match.simRules = false;
  match.settleDraws = false;

  const s: MatchStat = {
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
  return {
    score: [...match.score], shots: [...match.stats.shots], onTarget: [...match.stats.onTarget],
    passes: [...match.stats.passes], tackles: [...match.stats.tackles], saves: [...match.stats.saves],
    possession: [...match.stats.possession], completed: s.completed, intercepted: s.intercepted,
    maxOOB: s.maxOOB, nan: s.nan, stuckFrames: s.stuckFrames, guardHit: guard >= MAXF,
  };
}

function mean(rs: MatchResult[], f: (r: MatchResult) => number): number {
  return rs.reduce((a, r) => a + f(r), 0) / rs.length;
}

function report(label: string, rs: MatchResult[]): void {
  const comp = mean(rs, (r) => r.completed);
  const intc = mean(rs, (r) => r.intercepted);
  const possH = mean(rs, (r) => r.possession[0]);
  const possA = mean(rs, (r) => r.possession[1]);
  const line = {
    goals: `${mean(rs, (r) => r.score[0]).toFixed(2)}-${mean(rs, (r) => r.score[1]).toFixed(2)}`,
    shots: `${mean(rs, (r) => r.shots[0]).toFixed(1)}-${mean(rs, (r) => r.shots[1]).toFixed(1)}`,
    onTarget: `${mean(rs, (r) => r.onTarget[0]).toFixed(1)}-${mean(rs, (r) => r.onTarget[1]).toFixed(1)}`,
    passes: `${mean(rs, (r) => r.passes[0]).toFixed(0)}-${mean(rs, (r) => r.passes[1]).toFixed(0)}`,
    passComp: `${((100 * comp) / (comp + intc || 1)).toFixed(0)}%`,
    possH: `${((100 * possH) / (possH + possA || 1)).toFixed(0)}%`,
    saves: `${mean(rs, (r) => r.saves[0]).toFixed(1)}-${mean(rs, (r) => r.saves[1]).toFixed(1)}`,
    maxOOB: Math.max(...rs.map((r) => r.maxOOB)).toFixed(2),
    stuck: rs.reduce((a, r) => a + r.stuckFrames, 0),
    nan: rs.some((r) => r.nan),
    guard: rs.some((r) => r.guardHit),
  };
  console.log(label.padEnd(26), JSON.stringify(line));
}

// ---- run ----
const N = Number(process.argv[2] ?? 6);
const SECS = Number(process.argv[3] ?? 120);
CFG.matchSeconds = SECS;

console.log(`# ${N} matches/scenario, ${SECS}s halves (home-away)\n`);
const scenarios: [string, string, string, number, boolean][] = [
  ['EASY   USA v BRA', 'USA', 'BRAZIL', 0, false],
  ['PRO    USA v BRA', 'USA', 'BRAZIL', 1, false],
  ['LEGEND USA v BRA', 'USA', 'BRAZIL', 2, false],
  ['PRO    BRA v BRA (mirror)', 'BRAZIL', 'BRAZIL', 1, false],
  ['PRO    BRA v BRA (frozen ment.)', 'BRAZIL', 'BRAZIL', 1, true],
  ['PRO    ARG v FRA (elite)', 'ARGENTINA', 'FRANCE', 1, false],
  ['PRO    NOR v SEN (mid)', 'NORWAY', 'SENEGAL', 1, false],
  ['PRO    GER v ENG', 'GERMANY', 'ENGLAND', 1, false],
];
for (const [label, h, a, d, fz] of scenarios) {
  const rs: MatchResult[] = [];
  for (let i = 0; i < N; i++) rs.push(runMatch(h, a, d, fz));
  report(label, rs);
}
console.log('\n# done');
