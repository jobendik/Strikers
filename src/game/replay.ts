import { CFG } from '../config/constants';
import { clamp } from '../core/math';
import { SIM_HZ } from '../core/time';
import { applyView, clearTrail, currentSnapshot } from './render';
import { lerpSnapshot } from './snapshot';
import { setCameraDirect, snapCamera } from './camera';
import { showReplayUI } from '../ui/hud';

/*
 * Instant replay.
 *
 * The recorder keeps the last few seconds of presentation snapshots (the exact
 * frames that were drawn — positions, facing, stride phase, action clocks, ball
 * spin). Playback feeds them back through the same presenter the live game uses,
 * so the replay is what happened, re-animated faithfully, never a re-simulation.
 *
 * A goal is shown as a short broadcast sequence: the build-up from a low
 * touchline camera, then the finish again from behind the goal in slower motion.
 * Playback can be scrubbed and its speed changed (see replayCtl).
 */

const RECORD_SECONDS = 7;
const REC_HZ = 60; // record every 2nd tick
const EVERY = SIM_HZ / REC_HZ;
const CAP = RECORD_SECONDS * REC_HZ;

let ring: Float32Array | null = null;
let stride = 0;
let head = 0;
let count = 0;
let tickN = 0;

let clip: Float32Array | null = null;
let clipFrames = 0;
let view: Float32Array | null = null;
let active = false;
let enabled = true;
let scoredBy = 0;

/** Playback state (also driven by the dev lab / replay UI). */
export const replayCtl = {
  /** current playback position in frames (fractional) */
  cursor: 0,
  /** playback rate multiplier on top of the shot's own speed */
  rate: 1,
  paused: false,
  /** index of the current camera shot */
  shot: 0,
};

interface Shot {
  /** clip range in seconds-from-end (start, end) */
  from: number;
  to: number;
  speed: number;
  cam: 'touchline' | 'behindGoal' | 'high';
}
const SEQUENCE: Shot[] = [
  { from: 4.2, to: 0, speed: 0.75, cam: 'touchline' },
  { from: 1.9, to: 0, speed: 0.4, cam: 'behindGoal' },
];

/** Toggle goal replays from settings (the lite quality tier turns them off). */
export function setReplayEnabled(v: boolean): void {
  enabled = v;
}

/** Record the latest snapshot. Call once per live simulation tick. */
export function recordFrame(): void {
  if (!enabled) return;
  if (tickN++ % EVERY !== 0) return;
  const snap = currentSnapshot();
  if (!ring || stride !== snap.length) {
    stride = snap.length;
    ring = new Float32Array(CAP * stride);
    head = 0;
    count = 0;
  }
  ring.set(snap, head * stride);
  head = (head + 1) % CAP;
  count = Math.min(count + 1, CAP);
}

/** Drop the recorded history (called at kickoff so replays don't span restarts). */
export function resetReplayBuffer(): void {
  head = 0;
  count = 0;
}

/** Is there enough recorded play to be worth showing? */
export function hasReplay(): boolean {
  return enabled && count > REC_HZ * 0.8;
}

export function isReplaying(): boolean {
  return active;
}

function shotStart(i: number): number {
  return Math.max(0, clipFrames - 1 - SEQUENCE[i].from * REC_HZ);
}
function shotEnd(i: number): number {
  return Math.max(0, clipFrames - 1 - SEQUENCE[i].to * REC_HZ);
}

/** Freeze the buffered play into a clip and start the replay sequence. */
export function startReplay(scorer: number): void {
  if (!ring || count < 2) return;
  scoredBy = scorer;
  clipFrames = count;
  clip = new Float32Array(clipFrames * stride);
  view = new Float32Array(stride);
  const start = (head - count + CAP) % CAP;
  for (let i = 0; i < clipFrames; i++) {
    const src = ((start + i) % CAP) * stride;
    clip.set(ring.subarray(src, src + stride), i * stride);
  }
  replayCtl.shot = 0;
  replayCtl.cursor = shotStart(0);
  replayCtl.rate = 1;
  replayCtl.paused = false;
  active = true;
  clearTrail();
  showReplayUI(true);
}

function finish(): void {
  active = false;
  clip = null;
  showReplayUI(false);
  snapCamera();
}

/** SKIP — jump to the end; {@link updateReplay} then tears down normally. */
export function skipReplay(): void {
  if (!active) return;
  replayCtl.shot = SEQUENCE.length - 1;
  replayCtl.cursor = clipFrames;
}

/** Total length of the recorded clip in seconds (for a scrub bar). */
export function replayDuration(): number {
  return clipFrames / REC_HZ;
}

function replayCamera(cam: Shot['cam'], bx: number, by: number, bz: number, prog: number): void {
  const gx = scoredBy === 0 ? CFG.halfL : -CFG.halfL;
  const s = Math.sign(gx);
  if (cam === 'behindGoal') {
    // low, behind and just outside the far post, looking back up the pitch through the net
    const zs = Math.sign(bz || 1);
    setCameraDirect(gx + s * (CFG.goalDepth + 3.2), 1.9, -zs * (CFG.goalHalf + 0.6), bx * 0.55 + gx * 0.45, Math.max(0.6, by * 0.7), bz * 0.7, 46);
  } else if (cam === 'high') {
    setCameraDirect(gx * 0.5, 22, 30, bx, by, bz, 28);
  } else {
    // pitch-side tracking camera, a little ahead of the ball, easing toward the goal
    const cx = clamp(bx + s * 5, -CFG.halfL + 2, CFG.halfL - 2);
    setCameraDirect(cx * (0.9 + 0.1 * prog), 2.6 + 1.2 * (1 - prog), CFG.halfW + 5.5, bx + s * 1.5, 0.9 + by * 0.5, bz, 34);
  }
}

/**
 * Advance and draw the replay. Returns true when it has finished (the loop then
 * kicks off). `dt` is real seconds.
 */
export function updateReplay(dt: number): boolean {
  if (!active || !clip || !view) return true;
  const shot = SEQUENCE[replayCtl.shot];
  const end = shotEnd(replayCtl.shot);
  const start = shotStart(replayCtl.shot);
  const adv = replayCtl.paused ? 0 : dt * REC_HZ * shot.speed * replayCtl.rate;
  replayCtl.cursor = Math.max(0, replayCtl.cursor + adv);

  const c = clamp(replayCtl.cursor, 0, clipFrames - 1);
  const i0 = Math.floor(c);
  const i1 = Math.min(clipFrames - 1, i0 + 1);
  lerpSnapshot(clip.subarray(i0 * stride, i0 * stride + stride), clip.subarray(i1 * stride, i1 * stride + stride), c - i0, view);
  applyView(view, adv / REC_HZ, dt);
  const prog = end > start ? clamp((c - start) / (end - start), 0, 1) : 1;
  replayCamera(shot.cam, view[0], view[1], view[2], prog);

  if (replayCtl.cursor >= end) {
    if (replayCtl.shot < SEQUENCE.length - 1 && replayCtl.cursor < clipFrames) {
      replayCtl.shot++;
      replayCtl.cursor = shotStart(replayCtl.shot);
      clearTrail();
    } else {
      finish();
      return true;
    }
  }
  return false;
}
