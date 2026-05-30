import * as THREE from 'three';
import { CFG } from '../config/constants';
import { camera } from '../rendering/scene';
import { ball, match } from './state';
import { clearTrail } from './render';
import { showReplayUI } from '../ui/hud';
import type { Player } from '../entities/Player';

/*
 * Instant goal replay. Every frame of live play we push the ball + player
 * transforms into a ring buffer; when a goal is scored we freeze the last few
 * seconds into a clip and play it back from a dramatic low camera during the
 * celebration, with a SKIP control. Pure presentation — it never touches the
 * simulation, and it lifts straight from the recorded transforms so it is exact.
 */

const RECORD_SECONDS = 3.4; // how much lead-up to keep
const CAP = Math.round(RECORD_SECONDS * 60); // ring capacity in frames (≈60fps)
const PLAYBACK = 0.7; // slow-motion playback rate

let players: Player[] = [];
let stride = 0;
let ring: Float32Array | null = null;
let head = 0;
let count = 0;

let clip: Float32Array | null = null;
let clipFrames = 0;
let cursor = 0;
let active = false;
let scoredBy = 0;
let enabled = true;

const _v = new THREE.Vector3();

/** Toggle goal replays from settings (the lower quality tier turns them off). */
export function setReplayEnabled(v: boolean): void {
  enabled = v;
}

function ensure(): void {
  if (ring) return;
  players = [...match.teams[0].players, ...match.teams[1].players];
  stride = 3 + players.length * 3; // ball xyz + (x,z,heading) per player
  ring = new Float32Array(CAP * stride);
}

/** Record the current transforms into the ring buffer. Call once per live frame. */
export function recordFrame(): void {
  if (!enabled) return;
  ensure();
  if (!ring) return;
  let o = head * stride;
  ring[o++] = ball.position.x;
  ring[o++] = ball.position.y;
  ring[o++] = ball.position.z;
  for (const p of players) {
    ring[o++] = p.position.x;
    ring[o++] = p.position.z;
    ring[o++] = p.heading;
  }
  head = (head + 1) % CAP;
  count = Math.min(count + 1, CAP);
}

/** Drop the recorded history (called at kickoff so replays don't span restarts). */
export function resetReplayBuffer(): void {
  head = 0;
  count = 0;
}

/** Is there a goal worth replaying? */
export function hasReplay(): boolean {
  return enabled && count > 20;
}

export function isReplaying(): boolean {
  return active;
}

/** Freeze the buffered lead-up into a clip and start playing it back. */
export function startReplay(scorer: number): void {
  ensure();
  if (!ring) return;
  scoredBy = scorer;
  clipFrames = count;
  clip = new Float32Array(clipFrames * stride);
  const start = (head - count + CAP) % CAP;
  for (let i = 0; i < clipFrames; i++) {
    const src = ((start + i) % CAP) * stride;
    clip.set(ring.subarray(src, src + stride), i * stride);
  }
  cursor = 0;
  active = true;
  clearTrail(); // don't leave a frozen streak across the replay
  showReplayUI(true);
}

/** Tear down playback once it has finished. */
function finish(): void {
  active = false;
  clip = null;
  showReplayUI(false);
}

/**
 * SKIP — fast-forward to the end. We keep `active` true (so the loop doesn't
 * restart the clip) and let {@link updateReplay} run the natural teardown.
 */
export function skipReplay(): void {
  if (active) cursor = clipFrames;
}

/**
 * Drive the meshes + camera from the clip. Returns true when playback is done so
 * the loop can resume to kickoff. While replaying, the loop skips its normal
 * mesh/camera sync.
 */
export function updateReplay(dt: number): boolean {
  if (!active || !clip) return true;
  const f = Math.min(clipFrames - 1, Math.floor(cursor));
  let o = f * stride;
  const bx = clip[o++];
  const by = clip[o++];
  const bz = clip[o++];
  ball.mesh.position.set(bx, Math.max(CFG.ballR, by), bz);
  for (const p of players) {
    const x = clip[o++];
    const z = clip[o++];
    const h = clip[o++];
    p.mesh.position.set(x, 0, z);
    p.mesh.rotation.set(0, h, 0);
    (p.mesh.userData.ring as THREE.Mesh).visible = false;
  }

  // dramatic low camera by the goal that was breached, easing in toward the ball
  const gx = scoredBy === 0 ? CFG.halfL : -CFG.halfL;
  const prog = clipFrames > 1 ? cursor / clipFrames : 1;
  _v.set(gx * (0.5 + prog * 0.28), 5.5 - prog * 1.2, 16 - prog * 5);
  camera.position.lerp(_v, Math.min(1, 3 * dt));
  camera.lookAt(bx, Math.max(CFG.ballR, by) + 0.5, bz);

  cursor += dt * 60 * PLAYBACK;
  if (cursor >= clipFrames) {
    finish();
    return true;
  }
  return false;
}
