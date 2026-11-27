import * as THREE from 'three';
import { CFG } from '../config/constants';
import { sim, SIM_HZ } from '../core/time';
import { onAny, pulse, type SimEvent } from '../core/bus';
import { rngSeed } from '../core/rng';
import { scene, renderer } from '../rendering/scene';
import { ball, match } from '../game/state';
import { ballTrajectory, interceptPoint } from '../game/predict';
import { loopCtl, stepTicks } from '../game/loop';
import { Steer } from '../entities/Player';
import { PC_NX, PC_NZ, control, pcVersion } from '../ai/pitchControl';
import { chooseBestPass, keepValue, makePassOption } from '../ai/passing';

/*
 * Football Development Lab — an optional in-game overlay for understanding the
 * simulation. Toggle with F2 (or load with ?lab). It draws, in the 3-D scene:
 *
 *   · the ball's predicted flight (the real integrator's look-ahead)
 *   · where each player is trying to go (steering target) coloured by role
 *   · the earliest interception point for the nearest player of each team
 *   · the pass-request lane, the keeper's set position
 *
 * and shows a panel with timings (frame / sim ms, ticks per frame), renderer
 * counts, the match seed, team state, the controlled player's action, the last
 * events on the bus, and the match pulse.
 *
 * Keys while the lab is open:  [ / ]  slower / faster sim   ·   \  pause-step mode
 *                               .      advance one tick (in pause-step mode)
 *
 * It only reads the simulation; it never changes outcomes (other than the dev
 * speed/step controls, which a player has no access to).
 */

let on = false;
let panel: HTMLDivElement | null = null;
let traj: THREE.Line | null = null;
let intents: THREE.LineSegments | null = null;
let marks: THREE.Points | null = null;
let pcMesh: THREE.Mesh | null = null;
let pcTex: THREE.DataTexture | null = null;
let pcSeen = -1;
let showPc = true;
const _opt = makePassOption();
const events: string[] = [];
const MAXP = 64;

const ROLE_COL: Record<string, [number, number, number]> = {
  CARRIER: [1, 0.85, 0.2],
  SUPPORT: [0.3, 1, 0.5],
  RECEIVE: [0.3, 0.9, 1],
  CHASER: [1, 0.35, 0.3],
  POSITION: [0.75, 0.75, 0.85],
  GK: [1, 0.5, 1],
};

function build(): void {
  panel = document.createElement('div');
  panel.id = 'devlab';
  panel.style.cssText =
    'position:fixed;left:10px;top:110px;z-index:50;font:11px/1.35 ui-monospace,Menlo,Consolas,monospace;color:#d7f7df;' +
    'background:rgba(4,10,8,.78);border:1px solid rgba(120,255,160,.25);border-radius:8px;padding:8px 10px;white-space:pre;pointer-events:none;max-width:330px';
  document.body.appendChild(panel);

  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(128 * 3), 3));
  traj = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.95, depthTest: false }));
  traj.frustumCulled = false;
  traj.renderOrder = 20;
  scene.add(traj);

  const ig = new THREE.BufferGeometry();
  ig.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXP * 2 * 3), 3));
  ig.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAXP * 2 * 3), 3));
  intents = new THREE.LineSegments(ig, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthTest: false }));
  intents.frustumCulled = false;
  intents.renderOrder = 20;
  scene.add(intents);

  const mg = new THREE.BufferGeometry();
  mg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(16 * 3), 3));
  mg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(16 * 3), 3));
  marks = new THREE.Points(mg, new THREE.PointsMaterial({ size: 10, sizeAttenuation: false, vertexColors: true, depthTest: false }));
  marks.frustumCulled = false;
  marks.renderOrder = 21;
  scene.add(marks);

  // pitch control: one texel per grid cell, bilinear-filtered over the whole pitch
  pcTex = new THREE.DataTexture(new Uint8Array(PC_NX * PC_NZ * 4), PC_NX, PC_NZ, THREE.RGBAFormat);
  pcTex.magFilter = THREE.LinearFilter;
  pcTex.minFilter = THREE.LinearFilter;
  pcTex.colorSpace = THREE.SRGBColorSpace;
  pcMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2 * CFG.halfL, 2 * CFG.halfW),
    new THREE.MeshBasicMaterial({ map: pcTex, transparent: true, depthWrite: false, depthTest: false, toneMapped: false }),
  );
  pcMesh.rotation.x = -Math.PI / 2;
  pcMesh.position.y = 0.04;
  pcMesh.renderOrder = 15;
  pcMesh.frustumCulled = false;
  scene.add(pcMesh);

  onAny((e: SimEvent) => {
    if (!on || e.t === 'toast') return;
    if (e.t === 'kick' && e.kind === 'touch') return;
    let s: string = e.t;
    if (e.t === 'kick') s += `:${e.kind} ${e.power.toFixed(0)}m/s`;
    else if (e.t === 'shot') s += ` xG ${e.xg.toFixed(2)}`;
    else if (e.t === 'firstTouch') s += ` q${e.quality.toFixed(2)}`;
    else if (e.t === 'save') s += e.parry ? ' parry' : ' catch';
    else if (e.t === 'post') s += e.bar ? ' bar' : ' post';
    events.push(`${sim.elapsed.toFixed(1).padStart(6)} ${s}`);
    if (events.length > 7) events.shift();
  });

  addEventListener('keydown', (e) => {
    if (!on) return;
    if (e.code === 'BracketLeft') loopCtl.speed = Math.max(0.05, loopCtl.speed / 2);
    else if (e.code === 'BracketRight') loopCtl.speed = Math.min(8, loopCtl.speed * 2);
    else if (e.code === 'Backslash') loopCtl.manual = !loopCtl.manual;
    else if (e.code === 'Period' && loopCtl.manual) stepTicks(1);
    else if (e.code === 'KeyG') showPc = !showPc;
  });
}

export function toggleLab(v?: boolean): void {
  on = v ?? !on;
  if (on && !panel) build();
  if (panel) panel.style.display = on ? 'block' : 'none';
  if (traj) traj.visible = on;
  if (intents) intents.visible = on;
  if (marks) marks.visible = on;
  if (pcMesh) pcMesh.visible = on && showPc;
  if (!on) {
    loopCtl.speed = 1;
    loopCtl.manual = false;
  }
}

export function labActive(): boolean {
  return on;
}

/** Refresh the overlay. Call once per rendered frame. */
export function updateLab(): void {
  if (!on || !panel || !traj || !intents || !marks) return;

  // --- pitch control (home = blue, away = red; stronger colour = firmer control) ---
  if (pcMesh && pcTex) {
    pcMesh.visible = showPc && (match.state === 'play' || match.state === 'celebrate');
    if (pcMesh.visible && pcSeen !== pcVersion) {
      pcSeen = pcVersion;
      const d = pcTex.image.data as unknown as Uint8Array;
      for (let iz = 0; iz < PC_NZ; iz++)
        for (let ix = 0; ix < PC_NX; ix++) {
          const c = control[iz * PC_NX + ix];
          // the plane's v axis runs toward −Z after the −90° X rotation, so flip rows
          const o = ((PC_NZ - 1 - iz) * PC_NX + ix) * 4;
          const k = Math.abs(c - 0.5) * 2;
          d[o] = c < 0.5 ? 255 : 40;
          d[o + 1] = c < 0.5 ? 70 : 130;
          d[o + 2] = c < 0.5 ? 60 : 255;
          d[o + 3] = Math.round(150 * k * k);
        }
      pcTex.needsUpdate = true;
    }
  }

  // --- predicted ball flight ---
  const tp = traj.geometry.getAttribute('position') as THREE.BufferAttribute;
  let n = 0;
  if (!match.controlPlayer && (match.state === 'play' || match.state === 'celebrate')) {
    const tr = ballTrajectory();
    n = Math.min(tr.n, 128);
    for (let i = 0; i < n; i++) tp.setXYZ(i, tr.x[i], tr.y[i], tr.z[i]);
  }
  traj.geometry.setDrawRange(0, n);
  tp.needsUpdate = true;

  // --- intents ---
  const ip = intents.geometry.getAttribute('position') as THREE.BufferAttribute;
  const ic = intents.geometry.getAttribute('color') as THREE.BufferAttribute;
  const mp = marks.geometry.getAttribute('position') as THREE.BufferAttribute;
  const mc = marks.geometry.getAttribute('color') as THREE.BufferAttribute;
  let k = 0;
  let m = 0;
  for (const t of match.teams) {
    let bestT = Infinity;
    let bx = 0;
    let bz = 0;
    for (const p of t.players) {
      if (p.sentOff) continue;
      const c = ROLE_COL[p.role] ?? ROLE_COL.POSITION;
      let tx = p.position.x;
      let tz = p.position.z;
      if (p.steer === Steer.Arrive || p.steer === Steer.Seek) {
        tx = p.steerTarget.x;
        tz = p.steerTarget.z;
      } else if (p.steer === Steer.Intercept) {
        tx = ball.position.x;
        tz = ball.position.z;
      }
      if (k < MAXP) {
        ip.setXYZ(k * 2, p.position.x, 0.08, p.position.z);
        ip.setXYZ(k * 2 + 1, tx, 0.08, tz);
        ic.setXYZ(k * 2, c[0], c[1], c[2]);
        ic.setXYZ(k * 2 + 1, c[0] * 0.4, c[1] * 0.4, c[2] * 0.4);
        k++;
      }
      if (!match.controlPlayer && p.roleType !== 'GK') {
        const hit = interceptPoint(p.position.x, p.position.z, p.ath.sprint * 0.95, 0.1, CFG.chestHeight);
        if (hit && hit.t < bestT) {
          bestT = hit.t;
          bx = hit.x;
          bz = hit.z;
        }
      }
    }
    if (bestT < Infinity && m < 16) {
      mp.setXYZ(m, bx, 0.12, bz);
      const col = t === match.teams[0] ? [0.3, 0.6, 1] : [1, 0.4, 0.3];
      mc.setXYZ(m, col[0], col[1], col[2]);
      m++;
    }
  }
  // pass-request lane
  if (match.callingPlayer && match.callTarget && k < MAXP) {
    ip.setXYZ(k * 2, ball.position.x, 0.1, ball.position.z);
    ip.setXYZ(k * 2 + 1, match.callTarget.x, 0.1, match.callTarget.z);
    ic.setXYZ(k * 2, 0.2, 1, 0.1);
    ic.setXYZ(k * 2 + 1, 0.2, 1, 0.1);
    k++;
  }
  intents.geometry.setDrawRange(0, k * 2);
  ip.needsUpdate = true;
  ic.needsUpdate = true;
  marks.geometry.setDrawRange(0, m);
  mp.needsUpdate = true;
  mc.needsUpdate = true;

  // --- panel ---
  const u = match.userPlayer;
  const c = match.controlPlayer;
  const ri = renderer.info.render;
  const s = match.stats;
  const roles = (i: number): string => match.teams[i].players.map((p) => p.role[0] + (p.act !== 'none' ? `(${p.act[0]})` : '')).join(' ');
  panel.textContent =
    `DEV LAB  F2 hide · [ ] speed · \\ step-mode · . tick · G pitch control\n` +
    `frame ${loopCtl.frameMs.toFixed(1)} ms   sim ${loopCtl.simMs.toFixed(2)} ms   ticks/frame ${loopCtl.steps}   ${SIM_HZ} Hz\n` +
    `speed ×${loopCtl.speed}${loopCtl.manual ? '  [STEP MODE]' : ''}   tick ${sim.tick}   seed ${rngSeed()}\n` +
    `draw calls ${ri.calls}   tris ${(ri.triangles / 1000).toFixed(0)}k\n` +
    `state ${match.state}${match.restart ? ` · dead ball → ${match.restart.kind}` : ''}   timeScale ${match.timeScale.toFixed(2)}\n` +
    `ball  v ${pulse.ballSpeed.toFixed(1)} m/s  y ${ball.position.y.toFixed(2)}  ω(${ball.w.x.toFixed(0)},${ball.w.y.toFixed(0)},${ball.w.z.toFixed(0)})${ball.shot ? '  SHOT' : ''}\n` +
    `on ball ${c ? `${c.team.short} ${c.name}` : '—'}   threat ${pulse.threat[0].toFixed(2)} / ${pulse.threat[1].toFixed(2)}\n` +
    `${match.teams[0].short} ${roles(0)}\n${match.teams[1].short} ${roles(1)}\n` +
    decisionLine() +
    (u ? `you  ${u.name}  v ${u.getSpeed().toFixed(1)}  sta ${(u.stamina * 100).toFixed(0)}%  act ${u.act}${u.queued ? ' +queued ' + u.queued.kind : ''}\n` : '') +
    `xG ${s.xg[0].toFixed(2)}–${s.xg[1].toFixed(2)}  shots ${s.shots[0]}–${s.shots[1]}  pass ${s.passesDone[0]}/${s.passes[0]}–${s.passesDone[1]}/${s.passes[1]}\n` +
    events.join('\n');
}

/** The carrier's live keep-vs-pass utility (the same numbers the AI decides on). */
function decisionLine(): string {
  const c = match.controlPlayer;
  if (!c || c.roleType === 'GK' || match.state !== 'play') return '';
  const opp = match.teams[0] === c.team ? match.teams[1] : match.teams[0];
  const keep = keepValue(c);
  if (!chooseBestPass(c, opp, _opt)) return `keep ${keep.toFixed(2)}   pass —\n`;
  return `keep ${keep.toFixed(2)}   best pass ${_opt.utility.toFixed(2)} → ${_opt.receiver.name}${_opt.space ? ' (into space)' : ''}\n`;
}
