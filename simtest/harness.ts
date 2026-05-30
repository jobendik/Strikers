/*
 * Headless AI-vs-AI balance harness. Runs many full matches across a set of
 * scenarios and reports balance + correctness metrics. The actual match loop now
 * lives in the shipped game code (`src/game/simulate.ts::simulateMatch`) so the
 * harness and the in-game World Cup tournament drive the *same* simulation. This
 * file is just the scenario driver + reporting.
 *
 * Run after `vite build -c simtest/vite.config.ts`:
 *   node simtest/dist/harness.mjs [matchesPerScenario] [secondsPerHalf]
 */
import { sim } from '../src/core/time';

// Point Yuka's wall-clock Regulators (AI decision throttles) at the SIM clock so
// decision cadence is frame-accurate in this fast headless run rather than tied
// to real elapsed time. Must be active before the first Regulator.ready().
const _perf: { now: () => number } = (globalThis as { performance?: { now: () => number } }).performance ?? ({} as { now: () => number });
_perf.now = () => sim.elapsed * 1000;
(globalThis as unknown as { performance: { now: () => number } }).performance = _perf;

import { CFG } from '../src/config/constants';
import { simulateMatch, type SimResult } from '../src/game/simulate';

function runMatch(homeKey: string, awayKey: string, diff: number, freeze = false): SimResult {
  return simulateMatch(homeKey, awayKey, { diff, freeze });
}

function mean(rs: SimResult[], f: (r: SimResult) => number): number {
  return rs.reduce((a, r) => a + f(r), 0) / rs.length;
}

function report(label: string, rs: SimResult[]): void {
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
  const rs: SimResult[] = [];
  for (let i = 0; i < N; i++) rs.push(runMatch(h, a, d, fz));
  report(label, rs);
}
console.log('\n# done');
