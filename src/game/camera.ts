import * as THREE from 'three';
import { CFG } from '../config/constants';
import { clamp } from '../core/math';
import { camera, sun } from '../rendering/scene';
import { pulse } from '../core/bus';
import { match } from './state';

/*
 * Broadcast camera system.
 *
 * Gameplay cameras are tele lenses on the +Z side of the pitch that track a
 * *predicted* focus point (ball + a little of its velocity, biased toward the
 * direction of play), so the action being played into is on screen before it
 * happens. They move on critically-damped springs: no lurches, no shake during
 * open play beyond a small impact kick.
 */

export type CameraMode = 'broadcast' | 'tele' | 'tactical' | 'dynamic';
export const CAMERA_MODES: CameraMode[] = ['broadcast', 'tele', 'tactical', 'dynamic'];

interface Rig {
  /** camera height, distance behind the near touchline, vertical fov */
  h: number;
  d: number;
  fov: number;
  /** how much of the ball's lateral (z) position the camera follows */
  followZ: number;
  /** fraction of ball x the camera body tracks */
  followX: number;
}
const RIGS: Record<CameraMode, Rig> = {
  broadcast: { h: 17, d: 23, fov: 30, followZ: 0.34, followX: 0.84 },
  tele: { h: 12.5, d: 25, fov: 24, followZ: 0.42, followX: 0.9 },
  tactical: { h: 34, d: 16, fov: 40, followZ: 0.25, followX: 0.6 },
  dynamic: { h: 9.5, d: 14, fov: 38, followZ: 0.7, followX: 0.96 },
};

let mode: CameraMode = 'broadcast';
export function setCameraMode(m: CameraMode): void {
  mode = m;
}
export function getCameraMode(): CameraMode {
  return mode;
}
export function cycleCameraMode(): CameraMode {
  mode = CAMERA_MODES[(CAMERA_MODES.indexOf(mode) + 1) % CAMERA_MODES.length];
  return mode;
}

let shake = 0;
/** Add an impulse of screen-shake (kept deliberately small during open play). */
export function addShake(amount: number): void {
  shake = Math.min(1.2, shake + amount);
}

const pos = new THREE.Vector3(0, 26, 44);
const look = new THREE.Vector3(0, 0, 0);
const _p = new THREE.Vector3();
const _l = new THREE.Vector3();
let fov = 30;
let focusX = 0;
let focusZ = 0;
let lastBallX = 0;
let lastBallZ = 0;
let velX = 0;
let velZ = 0;
let snapNext = true;

/** Jump straight to the target framing on the next update (after a cut). */
export function snapCamera(): void {
  snapNext = true;
}

function damp(cur: number, target: number, rate: number, dt: number): number {
  return cur + (target - cur) * (1 - Math.exp(-rate * dt));
}

/** Aspect-aware FOV: narrow/portrait screens need a wider lens to keep the same width of pitch in view. */
function fitFov(base: number): number {
  const aspect = camera.aspect;
  if (aspect >= 1.6) return base;
  const hfov = 2 * Math.atan(Math.tan((base * Math.PI) / 360) * 1.6);
  return clamp((2 * Math.atan(Math.tan(hfov / 2) / aspect) * 180) / Math.PI, base, 62);
}

/**
 * Frame the action. `bx/by/bz` is the (interpolated) ball position being drawn.
 * `dt` is real seconds.
 */
export function updateCamera(dt: number, bx: number, by: number, bz: number): void {
  // Dev/test hook: `window.__camOverride = { pos:[x,y,z], look:[x,y,z], fov? }` pins the camera.
  const ov = (window as unknown as { __camOverride?: { pos: number[]; look: number[]; fov?: number } }).__camOverride;
  if (ov) {
    camera.position.set(ov.pos[0], ov.pos[1], ov.pos[2]);
    if (ov.fov && camera.fov !== ov.fov) {
      camera.fov = ov.fov;
      camera.updateProjectionMatrix();
    }
    camera.lookAt(ov.look[0], ov.look[1], ov.look[2]);
    snapNext = true;
    return;
  }

  const live = match.state === 'play' || match.state === 'celebrate';
  let rate = 3.2;
  let fovT = 30;

  if (match.state === 'shootout') {
    // behind and to the side of the spot, looking at the goal (always the +X end)
    _p.set(CFG.halfL - 22, 4.2, 9.5);
    _l.set(CFG.halfL - 1, 1.2, bz * 0.5);
    fovT = 34;
    rate = 2.5;
  } else if (match.state === 'celebrate') {
    // push in on the goal that was breached
    const gx = match.scoredBy === 0 ? CFG.halfL : -CFG.halfL;
    _p.set(gx * 0.55, 7.5, 21);
    _l.set(gx * 0.92, 1.2, bz * 0.5);
    fovT = 30;
    rate = 2.2;
  } else if (live) {
    const r = RIGS[mode];
    // ball velocity estimate from what is being drawn (works for interpolation and replays)
    if (dt > 1e-4) {
      const ivx = clamp((bx - lastBallX) / dt, -40, 40);
      const ivz = clamp((bz - lastBallZ) / dt, -40, 40);
      velX = damp(velX, ivx, 6, dt);
      velZ = damp(velZ, ivz, 6, dt);
    }
    // predictive focus: lead the ball, and lean toward the goal being attacked
    const attack = pulse.possession === 0 ? 1 : pulse.possession === 1 ? -1 : 0;
    const leadX = clamp(velX * 0.42, -7, 7) + attack * 2.2;
    const fxT = clamp(bx + leadX, -CFG.halfL + 9, CFG.halfL - 9);
    const fzT = clamp(bz + clamp(velZ * 0.3, -3, 3), -CFG.halfW, CFG.halfW);
    focusX = damp(focusX, fxT, 3.6, dt);
    focusZ = damp(focusZ, fzT, 3.0, dt);
    _p.set(focusX * r.followX, r.h, CFG.halfW + r.d + focusZ * r.followZ * 0.5);
    _l.set(focusX, 0.6 + Math.min(2.5, by * 0.35), focusZ * r.followZ * 1.9 - 1.2);
    // ease the lens slightly wider when the ball is travelling fast / high
    fovT = r.fov + clamp(Math.hypot(velX, velZ) * 0.06 + by * 0.25, 0, 3.5);
    rate = 4.2;
  } else {
    // menu / half-time / full-time: a slow drifting beauty shot of the stadium
    const t = performance.now() * 0.00006;
    _p.set(Math.sin(t) * 26, 15 + Math.sin(t * 1.7) * 3, 46 + Math.cos(t) * 5);
    _l.set(Math.sin(t) * 6, 1, 0);
    fovT = 34;
    rate = 1.2;
  }
  lastBallX = bx;
  lastBallZ = bz;

  if (snapNext) {
    pos.copy(_p);
    look.copy(_l);
    fov = fovT;
    snapNext = false;
  } else {
    const k = 1 - Math.exp(-rate * dt);
    pos.lerp(_p, k);
    look.lerp(_l, k);
    fov = damp(fov, fovT, 2.5, dt);
  }
  camera.position.copy(pos);
  if (shake > 0.001) {
    const s = shake * shake * 0.35;
    camera.position.x += (Math.random() - 0.5) * s;
    camera.position.y += (Math.random() - 0.5) * s * 0.7;
    shake = Math.max(0, shake - dt * 3.4);
  }
  const f = fitFov(fov);
  if (Math.abs(camera.fov - f) > 0.01) {
    camera.fov = f;
    camera.updateProjectionMatrix();
  }
  camera.lookAt(look);
  sun.target.position.set(clamp(bx, -CFG.halfL + 12, CFG.halfL - 12) * 0.85, 0, 0);
}

/** Point the game camera directly (used by replay cameras). */
export function setCameraDirect(px: number, py: number, pz: number, lx: number, ly: number, lz: number, fovDeg: number): void {
  camera.position.set(px, py, pz);
  const f = fitFov(fovDeg);
  if (Math.abs(camera.fov - f) > 0.01) {
    camera.fov = f;
    camera.updateProjectionMatrix();
  }
  camera.lookAt(lx, ly, lz);
  pos.set(px, py, pz);
  look.set(lx, ly, lz);
  fov = fovDeg;
  sun.target.position.set(clamp(lx, -CFG.halfL + 12, CFG.halfL - 12) * 0.85, 0, 0);
}
