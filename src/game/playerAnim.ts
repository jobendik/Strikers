import * as THREE from 'three';
import { clamp } from '../core/math';
import { ACT, FLAG, PF } from './snapshot';
import type { AnimName } from '../rendering/playerLoader';

/*
 * Character animation: pose = f(snapshot).
 *
 * Nothing here free-runs off the wall clock except idle breathing. Locomotion
 * clips are *scrubbed* by the stride phase the simulation integrates from real
 * ground speed (so feet match distance covered, at any speed, in slow motion and
 * in reverse); action clips are scrubbed by the action's own clock so the boot
 * meets the ball on the exact tick the simulation launches it.
 *
 * Layers per player
 *   locomotion blend space   idle ⇄ run ⇄ sprint, weighted by speed, phase-locked
 *   action layer             kick / dive / celebrate cross-faded over locomotion
 *   procedural layer         lean into acceleration and turns, slide and
 *                            getting-up poses, header hop, stumble — applied to
 *                            the model root on top of the skeletal pose
 */

interface Av {
  mixer: THREE.AnimationMixer;
  model: THREE.Object3D;
  acts: Record<AnimName, THREE.AnimationAction>;
  /** current blend weights (smoothed) */
  w: Record<AnimName, number>;
  idleT: number;
  celebT: number;
  /** smoothed procedural values */
  lean: number;
  bank: number;
  pvx: number;
  pvz: number;
  drop: number;
  pitch: number;
  roll: number;
  hop: number;
  lastAct: number;
  /** yaw the body is frozen at during a dive */
  baseY: number;
}

const NAMES: AnimName[] = ['idle', 'run', 'sprint', 'kick', 'gkDiveLeft', 'gkDiveRight', 'celebrate'];

/** Where in each clip the interesting moment sits (fractions of clip duration). */
export const CLIP_CAL = {
  /** boot-meets-ball frame of the kick clip */
  kickContact: 0.4,
  /** flight segment of the keeper dive clips: take-off → full stretch → landing */
  diveStart: 0.2,
  diveEnd: 0.5,
  /** phase offsets so run and sprint plant the same foot at stride phase 0 */
  runPhase: 0,
  sprintPhase: 0,
};

function getAv(mesh: THREE.Group): Av | null {
  const ud = mesh.userData as { av?: Av; mixer?: THREE.AnimationMixer; clips?: Record<AnimName, THREE.AnimationClip>; model?: THREE.Object3D };
  if (ud.av) return ud.av;
  if (!ud.mixer || !ud.clips) return null;
  const mixer = ud.mixer;
  mixer.stopAllAction();
  const acts = {} as Record<AnimName, THREE.AnimationAction>;
  const w = {} as Record<AnimName, number>;
  for (const n of NAMES) {
    const a = mixer.clipAction(ud.clips[n]);
    a.setLoop(THREE.LoopRepeat, Infinity);
    a.clampWhenFinished = false;
    a.timeScale = 0; // we scrub `time` ourselves
    a.enabled = true;
    a.setEffectiveWeight(n === 'idle' ? 1 : 0);
    a.play();
    acts[n] = a;
    w[n] = n === 'idle' ? 1 : 0;
  }
  const model = ud.model ?? mesh.children[0];
  const av: Av = { mixer, model, acts, w, idleT: Math.random() * 2, celebT: 0, lean: 0, bank: 0, pvx: 0, pvz: 0, drop: 0, pitch: 0, roll: 0, hop: 0, lastAct: 0, baseY: 0 };
  ud.av = av;
  return av;
}

const frac = (x: number): number => x - Math.floor(x);
const sm = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

const target: Record<AnimName, number> = { idle: 0, run: 0, sprint: 0, kick: 0, gkDiveLeft: 0, gkDiveRight: 0, celebrate: 0 };

/**
 * Pose one player from his snapshot block.
 * @param v     the snapshot view
 * @param o     offset of this player's block
 * @param dt    animation seconds to advance (already scaled for slow-mo / replay; may be negative when scrubbing back)
 * @param runV  the player's cruising run speed (m/s) — the idle/run/sprint blend is relative to it
 */
export function posePlayer(mesh: THREE.Group, v: Float32Array, o: number, dt: number, runV: number): void {
  const av = getAv(mesh);
  const flags = v[o + PF.Flags];
  mesh.visible = !(flags & FLAG.hidden);
  if (!mesh.visible) return;
  const vx = v[o + PF.Vx];
  const vz = v[o + PF.Vz];
  const speed = Math.hypot(vx, vz);
  const act = v[o + PF.Act];
  const actT = v[o + PF.ActT];
  const actK = v[o + PF.ActK];
  const heading = v[o + PF.Heading];
  const adt = Math.abs(dt);

  mesh.position.set(v[o + PF.X], 0, v[o + PF.Z]);

  if (!av) {
    mesh.rotation.set(0, heading, 0);
    return;
  }

  // ---------- blend targets ----------
  for (const n of NAMES) target[n] = 0;
  let fade = 9; // 1/s — how fast weights chase their targets
  const sprintW = sm(runV * 1.02, runV * 1.28, speed);
  const moveW = sm(0.35, 1.7, speed);
  target.idle = 1 - moveW;
  target.run = moveW * (1 - sprintW);
  target.sprint = moveW * sprintW;

  let dropT = 0;
  let pitchT = 0;
  let rollT = 0;
  let hopT = 0;
  let yaw = heading;

  if (flags & FLAG.celebrate && act === ACT.none && speed < 1.2) {
    target.idle = target.run = target.sprint = 0;
    target.celebrate = 1;
    fade = 5;
  }

  const A = av.acts;
  if (act === ACT.kick || act === ACT.tackle) {
    // scrub so the contact frame lands exactly on the simulation's contact tick
    const dur = A.kick.getClip().duration;
    const tc = dur * CLIP_CAL.kickContact;
    const pre = Math.max(0.02, actK);
    const rate = Math.min(tc / pre, 2.4);
    const t = clamp(tc + (actT - actK) * (actT < actK ? rate : 1.15), 0, dur - 0.01);
    A.kick.time = t;
    const w = act === ACT.tackle ? 0.75 : 1;
    target.kick = w;
    target.idle *= 1 - w;
    target.run *= 1 - w * 0.8;
    target.sprint *= 1 - w * 0.8;
    fade = 26;
    if (act === ACT.tackle) pitchT = 0.18;
  } else if (act === ACT.dive) {
    const left = (flags & FLAG.left) !== 0;
    const name: AnimName = left ? 'gkDiveLeft' : 'gkDiveRight';
    const clip = A[name].getClip();
    const k = clamp(actT / Math.max(0.05, actK), 0, 1);
    A[name].time = clip.duration * (CLIP_CAL.diveStart + (CLIP_CAL.diveEnd - CLIP_CAL.diveStart) * k);
    target.idle = target.run = target.sprint = 0;
    target[name] = 1;
    fade = 30;
    yaw = av.baseY; // body stays square to play while he flies
  } else if (act === ACT.slide) {
    // no slide clip: lay the body back, leading leg out (kick clip at full extension)
    const dur = A.kick.getClip().duration;
    A.kick.time = dur * (CLIP_CAL.kickContact + 0.06);
    target.idle = target.run = target.sprint = 0;
    target.kick = 1;
    fade = 22;
    pitchT = -1.2;
    dropT = 0.52;
    yaw = heading;
  } else if (act === ACT.recover) {
    // getting up: from the floor back to standing over the action
    const k = clamp(actT / Math.max(0.05, actK), 0, 1);
    const down = 1 - sm(0.25, 1, k);
    if (flags & FLAG.fromDive) {
      rollT = 0;
      dropT = 0.35 * down;
      pitchT = 0.9 * down;
    } else {
      pitchT = -1.1 * down;
      dropT = 0.5 * down;
    }
    fade = 7;
  } else if (act === ACT.stumble) {
    pitchT = 0.32;
    fade = 14;
  } else if (act === ACT.header) {
    const k = clamp(actT / 0.3, 0, 1);
    hopT = Math.sin(k * Math.PI) * 0.42;
    pitchT = k < 0.35 ? -0.22 : 0.3;
    fade = 18;
  }
  if (act !== ACT.dive) av.baseY = heading;

  // ---------- scrub locomotion by stride phase ----------
  const steps = v[o + PF.Stride];
  const ph = frac(steps * 0.5); // one clip cycle = two steps
  A.run.time = frac(ph + CLIP_CAL.runPhase) * A.run.getClip().duration;
  A.sprint.time = frac(ph + CLIP_CAL.sprintPhase) * A.sprint.getClip().duration;
  av.idleT += dt;
  A.idle.time = frac(Math.abs(av.idleT) / A.idle.getClip().duration) * A.idle.getClip().duration;
  if (target.celebrate > 0) {
    av.celebT += dt;
    const cd = A.celebrate.getClip().duration;
    A.celebrate.time = clamp(av.celebT, 0, cd - 0.05);
  } else if (av.w.celebrate < 0.02) av.celebT = 0;

  // ---------- chase weights, normalise, apply ----------
  const k = adt <= 0 ? 1 : Math.min(1, fade * adt);
  let sum = 0;
  for (const n of NAMES) {
    av.w[n] += (target[n] - av.w[n]) * k;
    if (av.w[n] < 0.001) av.w[n] = 0;
    sum += av.w[n];
  }
  if (sum < 1e-4) {
    av.w.idle = 1;
    sum = 1;
  }
  for (const n of NAMES) A[n].setEffectiveWeight(av.w[n] / sum);
  av.mixer.update(0);

  // ---------- procedural layer on the model root ----------
  // lean into acceleration (pitch) and bank into turns (roll), from velocity change
  if (adt > 1e-5) {
    const ax = (vx - av.pvx) / adt;
    const az = (vz - av.pvz) / adt;
    const hx = Math.sin(heading);
    const hz = Math.cos(heading);
    const fwd = clamp(ax * hx + az * hz, -30, 30);
    const lat = clamp(-ax * hz + az * hx, -30, 30); // + = accelerating to his left
    const s = Math.min(1, 7 * adt);
    av.lean += (clamp(fwd * 0.012, -0.16, 0.2) + Math.min(0.11, speed * 0.012) - av.lean) * s;
    av.bank += (clamp(lat * 0.014, -0.22, 0.22) - av.bank) * s;
  }
  av.pvx = vx;
  av.pvz = vz;
  const s2 = adt <= 0 ? 1 : Math.min(1, 16 * adt);
  av.drop += (dropT - av.drop) * s2;
  av.pitch += (pitchT - av.pitch) * s2;
  av.roll += (rollT - av.roll) * s2;
  av.hop += (hopT - av.hop) * Math.min(1, 30 * adt);

  mesh.rotation.set(0, yaw, 0);
  // model root: pitch about X (forward lean +), roll about Z; keep the loader's base offset
  const m = av.model;
  const ud = m.userData as { baseY?: number };
  if (ud.baseY === undefined) ud.baseY = m.position.y;
  const upright = act === ACT.slide || act === ACT.recover || act === ACT.dive ? 0 : 1;
  m.rotation.x = av.pitch + av.lean * upright;
  m.rotation.z = av.roll - av.bank * upright;
  m.position.y = ud.baseY - av.drop + av.hop;
  av.lastAct = act;
}

/**
 * Measure where each locomotion clip plants the left foot, so run and sprint can
 * be phase-locked to the same stride clock (they are authored independently).
 * Runs once on the first player mesh that has a mixer.
 */
export function calibrateClips(mesh: THREE.Group): void {
  const av = getAv(mesh);
  if (!av) return;
  let lf: THREE.Object3D | null = null;
  let rf: THREE.Object3D | null = null;
  mesh.traverse((ob) => {
    if (!lf && /LeftFoot$/.test(ob.name)) lf = ob;
    if (!rf && /RightFoot$/.test(ob.name)) rf = ob;
  });
  if (!lf || !rf) return;
  const L = lf as THREE.Object3D;
  const R = rf as THREE.Object3D;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const N = 24;
  const measure = (name: AnimName): number => {
    for (const n of NAMES) av.acts[n].setEffectiveWeight(n === name ? 1 : 0);
    let best = 0;
    let bestV = Infinity;
    const dur = av.acts[name].getClip().duration;
    for (let i = 0; i < N; i++) {
      av.acts[name].time = (i / N) * dur;
      av.mixer.update(0);
      mesh.updateMatrixWorld(true);
      L.getWorldPosition(a);
      R.getWorldPosition(b);
      // left foot planted & right foot highest ⇒ mid-stance on the left
      const val = a.y - b.y;
      if (val < bestV) {
        bestV = val;
        best = i / N;
      }
    }
    return best;
  };
  const pr = measure('run');
  const ps = measure('sprint');
  CLIP_CAL.runPhase = pr;
  CLIP_CAL.sprintPhase = ps;
  for (const n of NAMES) av.acts[n].setEffectiveWeight(av.w[n]);
}
