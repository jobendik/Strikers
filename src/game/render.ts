import * as THREE from 'three';
import { CFG } from '../config/constants';
import { clamp } from '../core/math';
import { ball, match } from './state';
import { renderer, scene } from '../rendering/scene';
import { B_STRIDE, FLAG, PF, P_STRIDE, lerpSnapshot, snapshotPlayers, snapshotSize, writeSnapshot } from './snapshot';
import { calibrateClips, posePlayer } from './playerAnim';
import { addShake, updateCamera } from './camera';

/*
 * The presenter: draws a snapshot.
 *
 * `applyView` is the only code that moves meshes. It is fed either the live
 * interpolation between the last two simulation ticks, or a frame from the
 * replay buffer — the two are indistinguishable to it.
 */

export { addShake };

let prev: Float32Array | null = null;
let cur: Float32Array | null = null;
let view: Float32Array | null = null;
let calibrated = false;

function ensure(): void {
  const n = snapshotSize();
  if (cur && cur.length === n) return;
  prev = new Float32Array(n);
  cur = new Float32Array(n);
  view = new Float32Array(n);
}

/** Record the simulation state after a tick (keeps the previous one for interpolation). */
export function captureSnapshot(): void {
  ensure();
  const t = prev!;
  prev = cur;
  cur = t;
  writeSnapshot(cur);
}

/** The most recent tick's snapshot (the replay recorder copies it). */
export function currentSnapshot(): Float32Array {
  ensure();
  return cur!;
}

/** Draw the live match, interpolated `alpha` (0..1) of the way from the previous tick to the latest. */
export function presentLive(alpha: number, dt: number): void {
  ensure();
  lerpSnapshot(prev!, cur!, clamp(alpha, 0, 1), view!);
  // animation time follows the simulation's time scale (goal slow-motion slows the bodies too)
  applyView(view!, dt * match.timeScale, dt);
  updateCamera(dt, view![0], view![1], view![2]);
}

const _q = new THREE.Quaternion();
const _ax = new THREE.Vector3();

/**
 * Pose every mesh from a snapshot.
 * @param animDt  seconds of animation time to advance (scaled; negative when scrubbing back)
 * @param realDt  real seconds (UI pulses, trail fade)
 */
export function applyView(v: Float32Array, animDt: number, realDt: number): void {
  const ps = snapshotPlayers();
  if (!calibrated && ps.length && ps[0].mesh.userData.mixer) {
    calibrated = true;
    try {
      calibrateClips(ps[0].mesh);
    } catch {
      /* calibration is a nicety — never let it break rendering */
    }
  }
  // the cheap blob shadow only when real shadow mapping is off (lite tier)
  const blobsVisible = !renderer.shadowMap.enabled;
  const pulseT = 0.5 + 0.5 * Math.sin(performance.now() * 0.011);
  let o = B_STRIDE;
  for (const p of ps) {
    posePlayer(p.mesh, v, o, animDt, p.ath.run);
    const flags = v[o + PF.Flags];
    const ud = p.mesh.userData as { ring?: THREE.Object3D; call?: THREE.Mesh; blob?: THREE.Object3D };
    if (ud.ring) ud.ring.visible = (flags & FLAG.user) !== 0;
    if (ud.blob) ud.blob.visible = blobsVisible;
    if (ud.call) {
      const active = (flags & FLAG.calling) !== 0;
      ud.call.visible = active;
      if (active) {
        ud.call.scale.setScalar(0.92 + pulseT * 0.18);
        (ud.call.material as THREE.MeshBasicMaterial).opacity = 0.35 + pulseT * 0.45;
      }
    }
    o += P_STRIDE;
  }

  // ---- ball ----
  const bx = v[0];
  const by = Math.max(CFG.ballR, v[1]);
  const bz = v[2];
  ball.mesh.position.set(bx, by, bz);
  // spin the mesh by the simulated angular velocity (so curl and back-spin are visible)
  const wl = Math.hypot(v[3], v[4], v[5]);
  if (wl > 0.05 && animDt !== 0) {
    _ax.set(v[3] / wl, v[4] / wl, v[5] / wl);
    _q.setFromAxisAngle(_ax, wl * animDt);
    ball.mesh.quaternion.premultiply(_q);
  }
  // ground shadow blob shrinks/fades as the ball climbs — sells the height
  const shadow = ball.mesh.userData.shadow as THREE.Mesh | undefined;
  if (shadow) {
    shadow.position.set(bx, 0.015, bz);
    const h = Math.max(0, by - CFG.ballR);
    const s = clamp(1 + h * 0.18, 1, 2.4);
    shadow.scale.set(s, s, s);
    (shadow.material as THREE.MeshBasicMaterial).opacity = clamp(0.42 - h * 0.05, 0.1, 0.42);
  }
  updateTrail(v[6], bx, by, bz, realDt);
}

/* ------------------------------ ball trail ------------------------------- */

const TRAIL_N = 20;
let trail: THREE.Line | null = null;
let trailPos: Float32Array;
let trailActive = false;
let trailFade = 0;

function ensureTrail(): void {
  if (trail) return;
  trailPos = new Float32Array(TRAIL_N * 3);
  const colors = new Float32Array(TRAIL_N * 3);
  for (let i = 0; i < TRAIL_N; i++) {
    const t = i / (TRAIL_N - 1); // head (latest) = 1 → bright, tail = 0 → dark (fades under additive blending)
    colors[i * 3] = 0.9 * t * t;
    colors[i * 3 + 1] = 0.95 * t * t;
    colors[i * 3 + 2] = 1.0 * t * t;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  trail = new THREE.Line(geo, mat);
  trail.frustumCulled = false;
  trail.visible = false;
  scene.add(trail);
}

/** A faint streak behind a hard-struck ball — only for genuinely fast balls (shots, driven passes). */
function updateTrail(speed: number, x: number, y: number, z: number, dt: number): void {
  ensureTrail();
  if (!trail) return;
  const want = (match.state === 'play' || match.state === 'celebrate') && speed > 19;
  trailFade = clamp(trailFade + (want ? dt * 8 : -dt * 3), 0, 1);
  if (trailFade <= 0) {
    trail.visible = false;
    trailActive = false;
    return;
  }
  trail.visible = true;
  if (!trailActive) {
    for (let i = 0; i < TRAIL_N; i++) {
      trailPos[i * 3] = x;
      trailPos[i * 3 + 1] = y;
      trailPos[i * 3 + 2] = z;
    }
    trailActive = true;
  } else {
    trailPos.copyWithin(0, 3);
    trailPos[(TRAIL_N - 1) * 3] = x;
    trailPos[(TRAIL_N - 1) * 3 + 1] = y;
    trailPos[(TRAIL_N - 1) * 3 + 2] = z;
  }
  (trail.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  (trail.material as THREE.LineBasicMaterial).opacity = clamp((speed - 14) / 22, 0.1, 0.55) * trailFade;
}

/** Reset the trail history so it doesn't streak across a restart/kickoff. */
export function clearTrail(): void {
  trailActive = false;
  trailFade = 0;
  if (trail) trail.visible = false;
}
