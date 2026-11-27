/*
 * Headless AI-vs-AI balance harness. Runs many full matches across a set of
 * scenarios and reports balance + correctness metrics. The match itself is the
 * shipped simulation (`src/game/simulate.ts` → `stepSimulation`), stepped at the
 * same fixed 120 Hz the rendered game uses.
 *
 *   node simtest/dist/harness.mjs [matchesPerScenario] [secondsPerHalf] [--quick]
 *
 * Every match is seeded (scenario index × 1000 + match index), so any line of
 * this report can be reproduced exactly, and the run ends with a determinism
 * check (the same seed must give a bit-identical final state).
 */
import { CFG } from '../src/config/constants';
import { simulateMatch, type SimResult } from '../src/game/simulate';
import { onAny, type SimEvent } from '../src/core/bus';
import { createGameState, ball, match } from '../src/game/state';
import { makeKick, strike } from '../src/game/control';
import { makeBallState, stepBallState } from '../src/game/physics';
import { rollRange, timeBall, rollSpeedFor } from '../src/entities/Ball';
import { seedRng } from '../src/core/rng';
import { sim as simClock } from '../src/core/time';
import { startMatch } from '../src/game/flow';
import { stepSimulation } from '../src/game/step';
import { setBusMuted } from '../src/core/bus';

function mean(rs: SimResult[], f: (r: SimResult) => number): number {
  return rs.reduce((a, r) => a + f(r), 0) / rs.length;
}

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) {
    failures++;
    console.log(`  ✗ ${label}: ${detail}`);
  }
}

/** Totals over every reported scenario — the balance guard at the end reads them. */
const agg = { matches: 0, minutes: 0, goals: 0, shots: 0, onT: 0, passes: 0, comp: 0 };

function report(label: string, rs: SimResult[]): void {
  for (const r of rs) {
    agg.matches++;
    agg.minutes += r.ticks / 120 / 60;
    agg.goals += r.score[0] + r.score[1];
    agg.shots += r.shots[0] + r.shots[1];
    agg.onT += r.onTarget[0] + r.onTarget[1];
    agg.passes += r.passes[0] + r.passes[1];
    agg.comp += r.completed;
  }
  const comp = mean(rs, (r) => r.completed);
  const intc = mean(rs, (r) => r.intercepted);
  const passes = mean(rs, (r) => r.passes[0] + r.passes[1]);
  const possH = mean(rs, (r) => r.possession[0]);
  const possA = mean(rs, (r) => r.possession[1]);
  const shots = mean(rs, (r) => r.shots[0] + r.shots[1]);
  const onT = mean(rs, (r) => r.onTarget[0] + r.onTarget[1]);
  const goals = mean(rs, (r) => r.score[0] + r.score[1]);
  const hw = rs.filter((r) => r.winner === 0).length;
  const aw = rs.filter((r) => r.winner === 1).length;
  const line = {
    goals: `${mean(rs, (r) => r.score[0]).toFixed(2)}-${mean(rs, (r) => r.score[1]).toFixed(2)}`,
    xg: `${mean(rs, (r) => r.xg[0]).toFixed(2)}-${mean(rs, (r) => r.xg[1]).toFixed(2)}`,
    shots: `${mean(rs, (r) => r.shots[0]).toFixed(1)}-${mean(rs, (r) => r.shots[1]).toFixed(1)}`,
    onT: `${((100 * onT) / (shots || 1)).toFixed(0)}%`,
    conv: `${((100 * goals) / (shots || 1)).toFixed(0)}%`,
    passes: passes.toFixed(0),
    passAcc: `${((100 * comp) / (passes || 1)).toFixed(0)}%`,
    intc: intc.toFixed(1),
    possH: `${((100 * possH) / (possH + possA || 1)).toFixed(0)}%`,
    tackles: mean(rs, (r) => r.tackles[0] + r.tackles[1]).toFixed(1),
    saves: mean(rs, (r) => r.saves[0] + r.saves[1]).toFixed(1),
    fouls: mean(rs, (r) => r.fouls).toFixed(1),
    thr: mean(rs, (r) => r.throwIns).toFixed(1),
    cor: mean(rs, (r) => r.corners).toFixed(1),
    gk: mean(rs, (r) => r.goalKicks).toFixed(1),
    dist: mean(rs, (r) => r.distance).toFixed(0),
    WDL: `${hw}-${rs.length - hw - aw}-${aw}`,
    stuck: rs.reduce((a, r) => a + r.stuckFrames, 0),
  };
  console.log(label.padEnd(24), JSON.stringify(line).replace(/"/g, ''));
  check(label, !rs.some((r) => r.nan), 'non-finite state');
  check(label, !rs.some((r) => r.guardHit), 'match failed to finish');
  check(label, Math.max(...rs.map((r) => r.maxOOB)) < 1.2, `ball ${Math.max(...rs.map((r) => r.maxOOB)).toFixed(2)} m out of play`);
  check(label, onT <= shots, 'on-target exceeds shots');
  // shared AI state must be live in *every* match of a run (a module-level regulator once
  // froze the pitch-control grid after the first match — this guards against that class of bug)
  const minPc = Math.min(...rs.map((r) => r.pcUpdates / (r.ticks / 120)));
  check(label, minPc > 5, `pitch control refreshed only ${minPc.toFixed(1)}×/s in some match`);
}

/** `--diag`: play a few matches with the event bus live and print what actually happens. */
function diag(n: number): void {
  const counts: Record<string, number> = {};
  const kinds: Record<string, number> = {};
  const shotPow: number[] = [];
  const shotXg: number[] = [];
  const ftq: number[] = [];
  const toasts: Record<string, number> = {};
  const off = onAny((e: SimEvent) => {
    counts[e.t] = (counts[e.t] ?? 0) + 1;
    if (e.t === 'kick') kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
    if (e.t === 'shot') {
      shotPow.push(e.power);
      shotXg.push(e.xg);
      xgBins[lastBin] += e.xg;
    }
    if (e.t === 'firstTouch') ftq.push(e.quality);
    if (e.t === 'toast') toasts[e.text] = (toasts[e.text] ?? 0) + 1;
  });
  let shown = 0;
  let lastShotD = 0;
  let lastShotInfo = '';
  let lastGk: { act: string; position: { x: number; z: number }; diveCd: number; shotReact: number; shotSeenT: number } | null = null;
  let printed = 0;
  const shotBins = [0, 0, 0, 0, 0, 0];
  const goalBins = [0, 0, 0, 0, 0, 0];
  const xgBins = [0, 0, 0, 0, 0, 0];
  const ctx = [0, 1, 2, 3, 4, 5].map(() => ({ near: 0, cone: 0, gkOut: 0, gkD: 0, head: 0, err: 0, free: 0 }));
  const outcomeBins = [0, 1, 2, 3, 4, 5].map(() => ({ save: 0, block: 0, post: 0 }));
  let lastShotTick = -1;
  let lastBin = 0;
  const offO = onAny((e: SimEvent) => {
    if (simClock.tick - lastShotTick > 240 || lastShotTick < 0) return;
    if (e.t === 'save') { outcomeBins[lastBin].save++; lastShotTick = -1; }
    else if (e.t === 'block') { outcomeBins[lastBin].block++; lastShotTick = -1; }
    else if (e.t === 'post') { outcomeBins[lastBin].post++; lastShotTick = -1; }
    else if (e.t === 'goal') lastShotTick = -1;
  });
  const offG = onAny((e: SimEvent) => {
    if (e.t === 'goal') {
      goalBins[Math.min(5, Math.floor(lastShotD / 5))]++;
      if (lastShotD > 9 && lastShotD < 16 && printed++ < 12 && lastGk) console.log(`   GOAL ${lastShotInfo} || at goal: gk(${lastGk.position.x.toFixed(1)},${lastGk.position.z.toFixed(1)}) act=${lastGk.act} diveCd=${lastGk.diveCd.toFixed(2)} react=${lastGk.shotReact.toFixed(2)} || ${gkMissInfo}`);
    }
  });
  (globalThis as unknown as { __shotDbg: unknown }).__shotDbg = (p: { name: string; position: { x: number; z: number }; team: { side: number } }, sp: { kind: string; tx: number; ty: number; tz: number; speed: number; err: number; curl: number }) => {
    lastShotD = Math.hypot(CFG.halfL - Math.abs(ball.position.x), ball.position.z);
    {
      const gk = match.teams[p.team.side > 0 ? 1 : 0].gk;
      const hit0 = flyTo(gk.position.x);
      lastShotInfo = `d=${lastShotD.toFixed(1)} from(${ball.position.x.toFixed(1)},${ball.position.z.toFixed(1)}) ${sp.kind} v=${sp.speed.toFixed(0)} aim(y${sp.ty.toFixed(1)},z${sp.tz.toFixed(1)}) | gk(${gk.position.x.toFixed(1)},${gk.position.z.toFixed(1)}) act=${gk.act} steer=${gk.steer} v=(${gk.velocity.x.toFixed(1)},${gk.velocity.z.toFixed(1)}) seenAgo=${gk.shotSeenT < 0 ? 'none' : (simClock.elapsed - gk.shotSeenT).toFixed(2)} | passes gk plane at z=${hit0.z.toFixed(2)} y=${hit0.y.toFixed(2)} t=${hit0.t.toFixed(2)}`;
      lastGk = gk;
    }
    const b = Math.min(5, Math.floor(lastShotD / 5));
    shotBins[b]++;
    {
      // how was this chance made? the shooting side's last real kick before it
      const mine = lastKickTeam === (p.team.side > 0 ? 0 : 1);
      const ago = simClock.elapsed - lastKickT;
      const held = simClock.elapsed - (p as unknown as { gotBallT: number }).gotBallT;
      const firstTime = match.controlPlayer !== (p as unknown);
      let how: string;
      if (sp.kind === 'header') how = mine && ago < 3 ? `header from ${lastKickKind}` : 'header (loose)';
      else if (!mine && ago < 2.5) how = 'rebound / loose ball';
      else if (mine && ago < 4) how = `${lastKickKind}${firstTime ? ' → first-time' : held > 2.2 ? ' → carry' : ' → touch + shot'}`;
      else how = 'solo carry';
      shotHow[how] = (shotHow[how] ?? 0) + 1;
      shotHowTotal++;
    }
    if (b === 0 && process.argv.includes('--close')) {
      const q = p as unknown as { gotBallT: number; name: string; roleType: string };
      const defT = match.teams[p.team.side > 0 ? 1 : 0];
      const pos = defT.players.map((d) => `${d.roleType[0]}(${(d.position.x * p.team.side).toFixed(0)},${d.position.z.toFixed(0)})`).join(' ');
      console.log(`   CLOSE ${sp.kind} t=${simClock.elapsed.toFixed(1)} ${q.roleType} held ${(simClock.elapsed - q.gotBallT).toFixed(2)}s at (${(ball.position.x * p.team.side).toFixed(1)},${ball.position.z.toFixed(1)}) lastKick=${lastKickKind} ${(simClock.elapsed - lastKickT).toFixed(1)}s ago from (${(lastKickX * p.team.side).toFixed(0)},${lastKickZ.toFixed(0)}) sameTeam=${lastKickTeam === (p.team.side > 0 ? 0 : 1)} defTactic=${(defT as unknown as { tactic: string }).tactic} def: ${pos}`);
    }
    lastBin = b;
    lastShotTick = simClock.tick;
    gkMiss = 99;
    gkMissInfo = '';
    {
      const def = match.teams[p.team.side > 0 ? 1 : 0];
      const gk = def.gk;
      const gxx = p.team.side * CFG.halfL;
      let near = 99;
      let cone = 0;
      for (const q of def.players) {
        if (q === gk) continue;
        const dq = Math.hypot(q.position.x - ball.position.x, q.position.z - ball.position.z);
        near = Math.min(near, dq);
        // inside the triangle ball → posts?
        const ax = gxx - ball.position.x;
        const fx = (q.position.x - ball.position.x) / (ax || 1);
        if (fx > 0.05 && fx < 1) {
          const zl = ball.position.z + (-CFG.goalHalf - ball.position.z) * fx;
          const zr = ball.position.z + (CFG.goalHalf - ball.position.z) * fx;
          if (q.position.z > zl - 0.4 && q.position.z < zr + 0.4) cone++;
        }
      }
      const c = ctx[b];
      c.near += Math.min(near, 10);
      c.cone += cone;
      c.gkOut += Math.abs(gxx - gk.position.x);
      c.gkD += Math.hypot(gk.position.x - ball.position.x, gk.position.z - ball.position.z);
      c.head += sp.kind === 'header' || sp.kind === 'volley' ? 1 : 0;
      c.err += sp.err;
      c.free += near > 2.5 ? 1 : 0;
    }
    if (shown++ > 0) return;
    const hit = flyTo(sp.tx);
    console.log(`   shot ${sp.kind} by ${p.name} from (${ball.position.x.toFixed(1)},${ball.position.z.toFixed(1)},y${ball.position.y.toFixed(2)}) aim (y${sp.ty.toFixed(2)}, z${sp.tz.toFixed(2)}) v=${sp.speed.toFixed(1)} err=${sp.err.toFixed(2)}° curl=${sp.curl.toFixed(0)} → crosses y=${hit.y.toFixed(2)} z=${hit.z.toFixed(2)} t=${hit.t.toFixed(2)}`);
  };
  let lastKickKind = '';
  let lastKickT = 0;
  let lastKickX = 0;
  let lastKickZ = 0;
  let lastKickTeam = -1;
  const headPrev: Record<string, number> = {};
  const offK = onAny((e: SimEvent) => {
    if (e.t === 'kick' && e.kind === 'header') {
      const k = `${lastKickKind}${simClock.elapsed - lastKickT < 1.5 ? '' : '(old)'} y=${ball.position.y.toFixed(0)}`;
      headPrev[k] = (headPrev[k] ?? 0) + 1;
    }
    if (e.t === 'kick' && e.kind !== 'touch' && e.kind !== 'shot' && e.kind !== 'finesse' && e.kind !== 'chip') {
      lastKickKind = e.kind;
      lastKickT = simClock.elapsed;
      lastKickX = ball.position.x;
      lastKickZ = ball.position.z;
      lastKickTeam = e.team;
    }
  });
  const shotHow: Record<string, number> = {};
  let shotHowTotal = 0;
  let gkMiss = 99;
  let gkMissInfo = '';
  (globalThis as unknown as { __gkDbg: unknown }).__gkDbg = (g: { act: string; actT: number; position: { x: number; z: number } }, miss: number, along: number) => {
    if (miss < gkMiss) {
      gkMiss = miss;
      gkMissInfo = `closest: miss by ${miss.toFixed(2)} m (along ${along.toFixed(2)}) act=${g.act}@${g.actT.toFixed(2)} gk(${g.position.x.toFixed(1)},${g.position.z.toFixed(1)}) ball(${ball.position.x.toFixed(1)},${ball.position.y.toFixed(2)},${ball.position.z.toFixed(1)})`;
    }
  };
  // pass outcomes by kind / length / pressure
  const passT: Record<string, { n: number; ok: number; cut: number; cutNear: number; cutFar: number }> = {};
  let cur: { key: string; x: number; z: number; tx: number; tz: number } | null = null;
  (globalThis as unknown as { __passDbg: unknown }).__passDbg = (ev: string, a: { position: { x: number; z: number }; team: unknown; pressure: number }, b: { kind?: string; tx?: number; tz?: number; position?: { x: number; z: number }; team?: unknown }) => {
    if (ev === 'kick') {
      const d = Math.hypot((b.tx ?? 0) - ball.position.x, (b.tz ?? 0) - ball.position.z);
      const key = `${b.kind} ${d < 8 ? 'short' : d < 16 ? 'mid' : 'long'}${a.pressure > 0.5 ? ' pressed' : ''}`;
      cur = { key, x: ball.position.x, z: ball.position.z, tx: b.tx ?? 0, tz: b.tz ?? 0 };
      (passT[key] ??= { n: 0, ok: 0, cut: 0, cutNear: 0, cutFar: 0 }).n++;
    } else if (cur && b.position) {
      const r = passT[cur.key];
      if (b.team === a.team) r.ok++;
      else {
        r.cut++;
        const fromStart = Math.hypot(b.position.x - cur.x, b.position.z - cur.z);
        const toEnd = Math.hypot(b.position.x - cur.tx, b.position.z - cur.tz);
        if (fromStart < 4) r.cutNear++;
        else if (toEnd < 3.5) r.cutFar++;
      }
      cur = null;
    }
  };
  const nick = { n: 0, heldLt03: 0, heldLt1: 0, sprint: 0, kicking: 0, stumble: 0, cdSum: 0, slow: 0 };
  (globalThis as unknown as { __nickDbg: unknown }).__nickDbg = (c: { gotBallT: number; sprinting: boolean; act: string; velocity: { x: number; z: number }; queued: unknown }, cd: number) => {
    nick.n++;
    const held = simClock.elapsed - c.gotBallT;
    if (held < 0.3) nick.heldLt03++;
    else if (held < 1) nick.heldLt1++;
    if (c.sprinting) nick.sprint++;
    if (c.act === 'kick' || c.queued) nick.kicking++;
    if (c.act === 'stumble') nick.stumble++;
    if (Math.hypot(c.velocity.x, c.velocity.z) < 2) nick.slow++;
    nick.cdSum += cd;
  };
  const rs: SimResult[] = [];
  const di = process.argv.indexOf('--diff');
  const dDiff = di > 0 ? Number(process.argv[di + 1]) : 2;
  // where the side in possession has the ball (thirds of the pitch, toward the goal it attacks)
  const zone = [0, 0, 0, 0, 0, 0];
  let zoneN = 0;
  const lossZone = [0, 0, 0, 0, 0, 0];
  let lastOwner: unknown = null;
  let lastOwnerX = 0;
  // possession spells: how far each one gets and how it ends
  const spell = { team: null as unknown, maxAx: 0, t0: 0, shot: false, entered: 0, lastAx: 0, lastCarrier: '' };
  const spells = { n: 0, mid: 0, final: 0, box: 0, shotFromFinal: 0, shots: 0, durFinal: 0, endFinal: {} as Record<string, number> };
  let shotsSeen = 0;
  const closeSpell = (why: string): void => {
    if (!spell.team) return;
    if (shotsSeen > 0) spell.shot = true;
    spells.n++;
    if (spell.maxAx > 0.5) spells.mid++;
    if (spell.maxAx > 2 / 3) {
      spells.final++;
      spells.durFinal += simClock.elapsed - spell.entered;
      if (spell.shot) spells.shotFromFinal++;
      const k = spell.shot ? 'shot' : why;
      spells.endFinal[k] = (spells.endFinal[k] ?? 0) + 1;
    }
    if (spell.maxAx > 1 - CFG.boxDepth / (2 * CFG.halfL)) spells.box++;
    if (spell.shot) spells.shots++;
    spell.team = null;
  };
  let lastToast = '';
  const offSp = onAny((e: SimEvent) => {
    if (e.t === 'shot') shotsSeen++;
    if (e.t === 'toast') lastToast = e.text;
  });
  const onTick = (): void => {
    if (match.state !== 'play') { closeSpell('whistle'); return; }
    if (match.restart) { closeSpell('out of play / foul'); return; }
    const t = match.controlTeam;
    if (t) {
      const axs = (ball.position.x * t.side + CFG.halfL) / (2 * CFG.halfL);
      if (spell.team !== t) {
        closeSpell(lastToast === 'TACKLE' || lastToast === 'SLIDE TACKLE' || lastToast === 'BALL WON' || lastToast === 'DISPOSSESSED' ? 'tackled' : lastToast === 'INTERCEPTED' ? 'pass cut out' : spell.lastCarrier === '' ? 'loose ball lost' : 'pass cut out / loose');
        spell.team = t; spell.maxAx = axs; spell.t0 = simClock.elapsed; spell.shot = false; spell.entered = axs > 2 / 3 ? simClock.elapsed : 0; shotsSeen = 0; lastToast = '';
      }
      if (axs > 2 / 3 && spell.maxAx <= 2 / 3) spell.entered = simClock.elapsed;
      spell.maxAx = Math.max(spell.maxAx, axs);
      if (shotsSeen > 0) spell.shot = true;
      spell.lastCarrier = match.controlPlayer ? 'c' : '';
    }
    if (t) {
      const ax = (ball.position.x * t.side + CFG.halfL) / (2 * CFG.halfL);
      if (simClock.tick % 12 === 0) {
        zone[Math.min(5, Math.floor(ax * 6))]++;
        zoneN++;
      }
      if (lastOwner && lastOwner !== t) lossZone[Math.min(5, Math.max(0, Math.floor(lastOwnerX * 6)))]++;
      lastOwner = t;
      lastOwnerX = ax;
    }
  };
  for (let i = 0; i < n; i++) rs.push(simulateMatch('ARGENTINA', 'FRANCE', { diff: dDiff, seed: 900 + i, events: true, onTick }));
  console.log('ball position while in possession (own goal → their goal, sixths):', zone.map((v) => `${((100 * v) / zoneN).toFixed(0)}%`).join(' '), ' | possession lost in:', lossZone.map((v) => (v / n).toFixed(1)).join(' '));
  offSp();
  console.log(`possession spells/match ${(spells.n / n).toFixed(0)}: reach their half ${((100 * spells.mid) / spells.n).toFixed(0)}%, final third ${((100 * spells.final) / spells.n).toFixed(0)}% (${(spells.final / n).toFixed(1)}/match, ${(spells.durFinal / Math.max(1, spells.final)).toFixed(1)} s each), box ${((100 * spells.box) / spells.n).toFixed(0)}% (${(spells.box / n).toFixed(1)}/match); final-third entries ending in a shot ${((100 * spells.shotFromFinal) / Math.max(1, spells.final)).toFixed(0)}%`);
  console.log('   final-third entries end:', Object.entries(spells.endFinal).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${((100 * v) / spells.final).toFixed(0)}%`).join('  '));
  offG();
  offO();
  offK();
  console.log('passes (kind length [pressed]): n/match  completed%  intercepted% (at source / at the receiver)');
  for (const [k, r] of Object.entries(passT).sort((x, y) => y[1].n - x[1].n)) {
    if (r.n / n < 1) continue;
    console.log(`   ${k.padEnd(24)} ${(r.n / n).toFixed(1).padStart(5)}  ok ${((100 * r.ok) / r.n).toFixed(0).padStart(3)}%  cut ${((100 * r.cut) / r.n).toFixed(0).padStart(3)}% (${((100 * r.cutNear) / r.n).toFixed(0)}% / ${((100 * r.cutFar) / r.n).toFixed(0)}%)  other ${((100 * (r.n - r.ok - r.cut)) / r.n).toFixed(0)}%`);
  }
  console.log('chances made by:', Object.entries(shotHow).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${((100 * v) / shotHowTotal).toFixed(0)}%`).join('  '));
  console.log('headers after:', Object.entries(headPrev).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${(v / n).toFixed(1)}`).join('  '));
  console.log('shots by distance (0-5,5-10,…,25+ m):', shotBins.join(' '), ' goals:', goalBins.join(' '));
  for (let b = 0; b < 6; b++) {
    const k = shotBins[b];
    if (!k) continue;
    const c = ctx[b];
    const o = outcomeBins[b];
    console.log(`   ${String(b * 5).padStart(2)}-${String(b * 5 + 5).padEnd(2)} m  n=${String(k).padStart(3)} goals ${((100 * goalBins[b]) / k).toFixed(0).padStart(3)}%  xG ${((100 * xgBins[b]) / k).toFixed(0).padStart(3)}%  saved ${((100 * o.save) / k).toFixed(0).padStart(3)}%  blocked ${((100 * o.block) / k).toFixed(0).padStart(3)}%  post ${((100 * o.post) / k).toFixed(0).padStart(2)}% | nearest def ${(c.near / k).toFixed(1)} m, unmarked ${((100 * c.free) / k).toFixed(0)}%, defenders in cone ${(c.cone / k).toFixed(2)}, gk off line ${(c.gkOut / k).toFixed(1)} m / ${(c.gkD / k).toFixed(1)} m from ball, headers ${((100 * c.head) / k).toFixed(0)}%, err ${(c.err / k).toFixed(1)}°`);
  }
  console.log('nicks   ', JSON.stringify(nick), 'avg cd', (nick.cdSum / (nick.n || 1)).toFixed(2));
  off();
  const per = (o: Record<string, number>): string =>
    Object.entries(o)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}:${(v / n).toFixed(1)}`)
      .join('  ');
  const avg = (a: number[]): string => (a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : '-');
  console.log(`# diag: ${n} matches ARG v FRA (difficulty ${dDiff}), per-match averages`);
  console.log('events  ', per(counts));
  console.log('kicks   ', per(kinds));
  console.log('toasts  ', per(toasts));
  console.log(`shots    n=${(shotPow.length / n).toFixed(1)} avgPower=${avg(shotPow)} avgXg=${avg(shotXg)}`);
  console.log(`1stTouch n=${(ftq.length / n).toFixed(1)} avgQuality=${avg(ftq)} poor(<0.4)=${(ftq.filter((q) => q < 0.4).length / n).toFixed(1)}`);
  const tt: Record<string, number> = {};
  let tot = 0;
  for (const r of rs) for (const [k, v] of Object.entries(r.tactics)) { tt[k] = (tt[k] ?? 0) + v; tot += v; }
  console.log('tactics ', Object.entries(tt).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${((100 * v) / tot).toFixed(0)}%`).join('  '));
  report('diag', rs);
}

/** Fly the live ball (free integrator only) until it crosses x = planeX; returns {y,z,t}. */
function flyTo(planeX: number): { y: number; z: number; t: number; maxY: number } {
  const S = makeBallState();
  S.px = ball.position.x; S.py = ball.position.y; S.pz = ball.position.z;
  S.vx = ball.velocity.x; S.vy = ball.velocity.y; S.vz = ball.velocity.z;
  S.wx = ball.w.x; S.wy = ball.w.y; S.wz = ball.w.z; S.grounded = ball.grounded;
  let t = 0;
  let maxY = S.py;
  const h = 1 / 240;
  for (let i = 0; i < 240 * 6; i++) {
    const px = S.px, py = S.py, pz = S.pz;
    stepBallState(S, h);
    t += h;
    maxY = Math.max(maxY, S.py);
    if ((px - planeX) * (S.px - planeX) <= 0 && px !== S.px) {
      const f = (planeX - px) / (S.px - px);
      return { y: py + (S.py - py) * f, z: pz + (S.pz - pz) * f, t, maxY };
    }
  }
  return { y: NaN, z: NaN, t, maxY };
}

type ShotOutcome = 'goal' | 'save' | 'wide' | 'post';

/**
 * Deterministic scenario: one striker shoots at the +X goal from `dist` metres out
 * (lateral offset `z0`), aiming at (aimY, aimZ) in the goal mouth, against the real
 * keeper AI. Everyone else is parked out of the way. Returns what happened.
 */
function scenarioShot(dist: number, z0: number, aimY: number, aimZ: number, speed: number, seed: number, diff: number, err = 0, trace = false): ShotOutcome {
  CFG.diff = diff;
  createGameState();
  match.teams[0].isUser = false;
  setBusMuted(false);
  startMatch(seed);
  let outcome: ShotOutcome | null = null;
  const off = onAny((e: SimEvent) => {
    if (outcome) return;
    if (e.t === 'goal') outcome = 'goal';
    else if (e.t === 'save') outcome = 'save';
    else if (e.t === 'post') outcome = 'post';
  });
  const shooter = match.teams[0].players[3];
  const gk = match.teams[1].gk;
  let i = 0;
  for (const t of match.teams)
    for (const q of t.players) {
      if (q === shooter || q === gk) continue;
      q.position.set(-20 + i * 2, 0, (i % 2 ? 1 : -1) * 18);
      i++;
    }
  const bx = CFG.halfL - dist;
  ball.place(bx, z0);
  shooter.position.set(bx - 0.6, 0, z0);
  shooter.heading = Math.PI / 2;
  match.controlPlayer = shooter;
  match.controlTeam = shooter.team;
  match.setPieceT = 0;
  // let the keeper take up his position against a stationary ball first
  for (let k = 0; k < 45; k++) {
    for (const t of match.teams) for (const q of t.players) if (q !== gk) { q.velocity.set(0, 0, 0); }
    ball.place(bx, z0);
    shooter.position.set(bx - 0.6, 0, z0);
    match.controlPlayer = shooter;
    match.controlTeam = shooter.team;
    match.teams[1].update(1 / 120);
    stepKeeperOnly();
  }
  const spec = makeKick(shooter, 'shot', 'aim', CFG.halfL, aimY, aimZ, speed, { shot: true });
  spec.err = err;
  const gz0 = gk.position.z;
  const gx0 = gk.position.x;
  strike(shooter, spec);
  for (let k = 0; k < 240 && !outcome; k++) {
    stepSimulation({ human: false });
    if (trace && k % 6 === 0) console.log(`     t=${(k / 120).toFixed(2)} ball(${ball.position.x.toFixed(1)},${ball.position.y.toFixed(2)},${ball.position.z.toFixed(2)}) gk(${gk.position.x.toFixed(1)},${gk.position.z.toFixed(2)}) act=${gk.act} seen=${gk.shotSeenT.toFixed(2)}`);
    if (match.restart) { outcome = 'wide'; break; }
  }
  off();
  if (trace) console.log(`     keeper started at (${gx0.toFixed(1)}, ${gz0.toFixed(2)}) → ${outcome}`);
  return outcome ?? 'wide';
}
import { movePlayers } from '../src/game/movement';
function stepKeeperOnly(): void {
  movePlayers(1 / 120);
}

/** `--gk`: keeper save rates by distance / placement / difficulty. */
function gkTests(): void {
  console.log('# keeper scenarios: save% over 40 seeded shots each (aim error 1.2°)');
  const rows: [string, number, number, number, number, number][] = [
    // label, dist, z0, aimY, aimZ, speed
    ['6 m central, low corner', 6, 0, 0.3, 2.6, 26],
    ['11 m central, low corner', 11, 0, 0.3, 2.6, 27],
    ['11 m central, top corner', 11, 0, 2.0, 2.6, 27],
    ['11 m central, at keeper+1m', 11, 0, 0.9, 1.0, 27],
    ['16 m central, low corner', 16, 0, 0.3, 2.6, 28],
    ['16 m central, mid height 1.8m wide', 16, 0, 1.2, 1.8, 28],
    ['22 m central, low corner', 22, 0, 0.3, 2.6, 30],
    ['22 m central, top corner', 22, 0, 2.0, 2.6, 30],
    ['12 m, 8 m wide, far post', 12, 8, 0.4, -2.5, 27],
    ['12 m, 8 m wide, near post', 12, 8, 0.4, 2.5, 27],
  ];
  for (const diff of [0, 2, 4]) {
    console.log(`  difficulty ${diff}`);
    for (const [label, dist, z0, ay, az, sp] of rows) {
      const tally: Record<ShotOutcome, number> = { goal: 0, save: 0, wide: 0, post: 0 };
      for (let i = 0; i < 40; i++) tally[scenarioShot(dist, z0, ay, az, sp, 100 + i, diff, 1.2)]++;
      const on = tally.goal + tally.save;
      console.log(`    ${label.padEnd(38)} goal ${String(tally.goal).padStart(2)}  save ${String(tally.save).padStart(2)}  post ${tally.post}  wide ${String(tally.wide).padStart(2)}   save% of on-target ${on ? ((100 * tally.save) / on).toFixed(0) : '-'}`);
    }
  }
  if (process.argv.includes('--trace')) scenarioShot(11, 0, 0.3, 2.6, 27, 101, 2, 0, true);
}

/** `--physics`: closed-form + solver self-tests (exit 1 on failure). */
function physicsTests(): void {
  console.log('# physics self-tests');
  createGameState();
  seedRng(7);
  const p = match.teams[0].players[3];
  const near = (label: string, got: number, want: number, tol: number): void => {
    const ok = Math.abs(got - want) <= tol;
    console.log(`  ${ok ? '✓' : '✗'} ${label}: got ${got.toFixed(3)}, want ${want.toFixed(3)} ±${tol}`);
    if (!ok) failures++;
  };
  // 1) aimed shots hit their target point (no execution error)
  const cases: [number, number, number, number, number, number, number][] = [
    // bx, bz, ty, tz, speed, curl, backspin
    [14, 0, 0.35, 2.3, 26, 0, 0],
    [14, 0, 1.8, -2.3, 28, 0, 0],
    [8, -5, 0.35, 2.5, 22, 0, 0],
    [12, 4, 1.2, -2.0, 24, 30, 6],
    [10, -3, 0.5, 2.4, 24, -45, 6],
    [20, 6, 1.6, -2.6, 30, 20, -4],
  ];
  for (const [bx, bz, ty, tz, sp, curl, back] of cases) {
    ball.place(CFG.halfL - bx, bz);
    p.position.set(ball.position.x - 0.5, 0, bz);
    p.heading = Math.PI / 2;
    match.controlPlayer = p;
    const spec = makeKick(p, 'shot', 'aim', CFG.halfL, ty, tz, sp, { curl, backspin: back, shot: true });
    spec.err = 0;
    strike(p, spec);
    const hit = flyTo(CFG.halfL);
    near(`aim ${bx}m z${bz}→(${ty},${tz}) @${sp} curl ${curl}: y`, hit.y, ty, 0.12);
    near(`aim ${bx}m z${bz}→(${ty},${tz}) @${sp} curl ${curl}: z`, hit.z, tz, 0.12);
  }
  // 2) lobs land on their target
  for (const [d, apex] of [[12, 3], [22, 5], [30, 7]] as [number, number][]) {
    ball.place(-10, 3);
    p.position.set(-10.5, 0, 3);
    match.controlPlayer = p;
    const spec = makeKick(p, 'lob', 'lob', -10 + d, 0, 3, 0, { apex, pass: true });
    spec.err = 0;
    strike(p, spec);
    const S = makeBallState();
    S.px = ball.position.x; S.py = ball.position.y; S.pz = ball.position.z;
    S.vx = ball.velocity.x; S.vy = ball.velocity.y; S.vz = ball.velocity.z;
    S.wx = ball.w.x; S.wy = ball.w.y; S.wz = ball.w.z; S.grounded = false;
    let mx = 0, land = NaN;
    for (let i = 0; i < 2000; i++) {
      const b = stepBallState(S, 1 / 240);
      mx = Math.max(mx, S.py);
      if (b > 0 || S.grounded) { land = S.px + 10; break; }
    }
    near(`lob ${d}m apex ${apex}: landing distance`, land, d, 0.5);
    near(`lob ${d}m apex ${apex}: apex height`, mx - CFG.ballR, apex, 0.6);
  }
  // 3) rolling closed forms agree with the integrator
  for (const v0 of [8, 14, 22]) {
    const S = makeBallState();
    S.vx = v0; S.grounded = true;
    let t = 0, t10 = NaN;
    for (let i = 0; i < 240 * 30; i++) {
      stepBallState(S, 1 / 240);
      t += 1 / 240;
      if (Number.isNaN(t10) && S.px >= 10) t10 = t;
      if (S.vx === 0) break;
    }
    near(`roll v0=${v0}: range`, S.px, rollRange(v0), 0.25);
    if (!Number.isNaN(t10)) near(`roll v0=${v0}: time to 10 m`, t10, timeBall(v0, 10), 0.03);
  }
  near('rollSpeedFor(15 m, arrive 8) round-trip', timeBall(rollSpeedFor(15, 8), 15) > 0 ? 1 : 0, 1, 0);
  // 4) Magnus: a side-spun shot bends, back-spin floats, top-spin dips
  const fly = (wy: number, back: number): { z: number; y: number } => {
    const S = makeBallState();
    S.py = 0.5; S.vx = 25; S.vy = 4; S.wy = wy; S.wz = back; S.grounded = false;
    for (let i = 0; i < 240; i++) stepBallState(S, 1 / 240);
    return { z: S.pz, y: S.py };
  };
  const straight = fly(0, 0);
  const bent = fly(-60, 0);
  const floaty = fly(0, 40);
  const dippy = fly(0, -40);
  console.log(`  · 1 s of flight at 25 m/s: curl(60 rad/s) bends ${bent.z.toFixed(2)} m; back-spin lifts ${(floaty.y - straight.y).toFixed(2)} m; top-spin dips ${(straight.y - dippy.y).toFixed(2)} m`);
  if (!(Math.abs(bent.z) > 2 && floaty.y > straight.y && dippy.y < straight.y)) {
    failures++;
    console.log('  ✗ Magnus directions wrong');
  }
}

// ---- run ----
const args = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !['--only', '--diff'].includes(all[i - 1] ?? ''));
const N = Number(args[0] ?? 6);
const SECS = Number(args[1] ?? 120);
CFG.matchSeconds = SECS;

if (process.argv.includes('--physics')) {
  physicsTests();
  console.log(failures ? `\n# FAILED: ${failures} check(s)` : '\n# all checks passed');
  process.exit(failures ? 1 : 0);
}
if (process.argv.includes('--gk')) {
  gkTests();
  process.exit(0);
}
if (process.argv.includes('--diag')) {
  diag(N);
  process.exit(0);
}

console.log(`# ${N} matches/scenario, ${SECS}s halves, 120 Hz fixed step (home-away)\n`);
const scenarios: [string, string, string, number, boolean][] = [
  ['EASY   USA v BRA', 'USA', 'BRAZIL', 0, false],
  ['PRO    USA v BRA', 'USA', 'BRAZIL', 1, false],
  ['LEGEND USA v BRA', 'USA', 'BRAZIL', 2, false],
  ['ULTIM  USA v BRA', 'USA', 'BRAZIL', 3, false],
  ['WCLASS USA v BRA', 'USA', 'BRAZIL', 4, false],
  ['PRO    BRA v BRA (mirror)', 'BRAZIL', 'BRAZIL', 1, true],
  ['PRO    ARG v FRA (elite)', 'ARGENTINA', 'FRANCE', 1, false],
  ['PRO    NOR v SEN (mid)', 'NORWAY', 'SENEGAL', 1, false],
  ['LEGEND GER v ENG', 'GERMANY', 'ENGLAND', 2, false],
];
const t0 = Date.now();
let ticks = 0;
const onlyIdx = process.argv.indexOf('--only');
const only = onlyIdx > 0 ? process.argv[onlyIdx + 1] : '';
scenarios.forEach(([label, h, a, d, fz], si) => {
  if (only && !label.includes(only)) return;
  const rs: SimResult[] = [];
  for (let i = 0; i < N; i++) {
    const r = simulateMatch(h, a, { diff: d, freeze: fz, seed: si * 1000 + i + 1 });
    ticks += r.ticks;
    rs.push(r);
  }
  report(label, rs);
});
const secs = (Date.now() - t0) / 1000;
console.log(`\n# ${ticks} ticks in ${secs.toFixed(1)}s = ${(ticks / 120 / secs).toFixed(0)}× real time`);

// ---- balance guard: wide bands around the targets in docs/QUALITY_STANDARD.md, over all
// scenarios together. Not a tuning tool (use --diag) — it exists so that a regression the
// size of "the keeper gives the ball away" or "nobody can complete a pass" fails the run.
if (!only && agg.matches >= 30) {
  const gpm = agg.goals / agg.minutes;
  const conv = agg.goals / (agg.shots || 1);
  const onT = agg.onT / (agg.shots || 1);
  const pacc = agg.comp / (agg.passes || 1);
  const spm = agg.shots / agg.minutes;
  console.log(`# balance over ${agg.matches} matches: ${gpm.toFixed(2)} goals/min, ${spm.toFixed(2)} shots/min, ${(100 * onT).toFixed(0)}% on target, ${(100 * conv).toFixed(0)}% conversion, ${(100 * pacc).toFixed(0)}% pass completion`);
  check('balance: goals per minute', gpm > 0.3 && gpm < 0.95, `${gpm.toFixed(2)} (want 0.3–0.95; target ≈ 0.33–0.67)`);
  check('balance: shots per minute', spm > 1.3 && spm < 3.6, `${spm.toFixed(2)} (want 1.3–3.6; target ≈ 1.7–2.7)`);
  check('balance: on target', onT > 0.36 && onT < 0.62, `${(100 * onT).toFixed(0)}% (want 36–62 %)`);
  check('balance: conversion', conv > 0.16 && conv < 0.38, `${(100 * conv).toFixed(0)}% (want 16–38 %)`);
  check('balance: pass completion', pacc > 0.76 && pacc < 0.94, `${(100 * pacc).toFixed(0)}% (want 76–94 %)`);
}

// ---- determinism: same seed ⇒ identical match ----
const a = simulateMatch('SPAIN', 'ITALY', { diff: 2, seed: 4242 });
const b = simulateMatch('SPAIN', 'ITALY', { diff: 2, seed: 4242 });
const c = simulateMatch('SPAIN', 'ITALY', { diff: 2, seed: 4243 });
const same = a.hash === b.hash && a.score[0] === b.score[0] && a.score[1] === b.score[1] && a.passes[0] === b.passes[0] && a.ticks === b.ticks;
console.log(`# determinism: seed 4242 twice → ${same ? 'IDENTICAL' : 'DIFFERENT'} (hash ${a.hash} / ${b.hash}); seed 4243 → hash ${c.hash}`);
check('determinism', same, 'same seed produced different matches');
check('seed sensitivity', c.hash !== a.hash, 'different seeds produced identical matches');

console.log(failures ? `\n# FAILED: ${failures} check(s)` : '\n# all checks passed');
if (failures) process.exit(1);
