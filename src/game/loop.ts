import { SIM_DT } from '../core/time';
import { Audio } from '../core/audio';
import { renderFrame } from '../rendering/scene';
import { updateStadium } from '../rendering/stadium';
import { match } from './state';
import { pollInput } from './input';
import { kickOff } from './flow';
import { stepSimulation } from './step';
import { filmBall, filmCtl, hasReplay, isReplaying, presentFilm, recordFrame, startReplay, updateReplay } from './replay';
import { captureSnapshot, presentLive } from './render';
import { updateCamera } from './camera';
import { updateHUD, updateToast } from '../ui/hud';
import { updateRadar } from '../ui/radar';
import { updateLab } from '../dev/lab';

/*
 * The frame loop: fixed-timestep simulation, interpolated presentation.
 *
 *   real frame time ──► accumulator ──► N × stepSimulation()  (each exactly SIM_DT)
 *                                   └─► alpha = leftover / SIM_DT
 *   presentation renders the state interpolated between the last two ticks.
 *
 * The simulation never sees the display frame rate; a 30 fps phone and a 240 Hz
 * monitor play the same match. Slow motion scales how fast the accumulator fills,
 * not the size of a step.
 */

/** Never try to catch up more than this much real time in one frame (tab was hidden, GC pause…). */
const MAX_FRAME = 0.1;
const MAX_STEPS = 16;

let last = 0;
let acc = 0;
/** Replay already shown for the current goal? */
let replayDone = false;

/** Dev/test controls (see window.__strikers in main.ts). */
export const loopCtl = {
  /** Multiplies real time fed to the simulation (dev lab speed control). */
  speed: 1,
  /** When true the loop does not advance the sim on its own (tests step it manually). */
  manual: false,
  /** Rolling real frame time (ms) for the perf overlay. */
  frameMs: 16.7,
  simMs: 0,
  steps: 0,
};

/** Advance the simulation by `n` ticks right now (dev/test hook; also used by manual mode). */
export function stepTicks(n: number): void {
  for (let i = 0; i < n; i++) {
    if (match.paused) break;
    if (blockedByReplay()) break;
    stepSimulation({ human: true });
    captureSnapshot();
    if (match.state === 'play' || (match.state === 'celebrate' && match.celebrateBallT > 0)) recordFrame();
    if (match.state !== 'celebrate') replayDone = false;
  }
}

/**
 * Dev/test: skip a pending goal replay and kick off at once, so a script that steps
 * the simulation in a tight loop (no frames drawn) is not held at a celebration.
 */
export function skipGoalReplayNow(): boolean {
  if (match.state !== 'celebrate' || !match.holdKickoff) return false;
  replayDone = true;
  match.holdKickoff = false;
  kickOff(match.teams[1 - match.scoredBy]);
  captureSnapshot();
  captureSnapshot();
  return true;
}

/** While a goal replay is (about to be) on screen the match waits for it. */
function blockedByReplay(): boolean {
  if (match.state !== 'celebrate' || match.celebrateBallT > 0 || replayDone) {
    match.holdKickoff = false;
    return false;
  }
  if (!hasReplay()) {
    match.holdKickoff = false;
    return false;
  }
  match.holdKickoff = true;
  return true;
}

function frame(now: number): void {
  requestAnimationFrame(frame);
  const realDt = Math.min(MAX_FRAME, Math.max(0, (now - last) / 1000));
  last = now;
  loopCtl.frameMs += (realDt * 1000 - loopCtl.frameMs) * 0.1;
  pollInput();

  if (match.paused) {
    renderFrame();
    return;
  }

  const t0 = performance.now();
  let steps = 0;
  if (!loopCtl.manual) {
    acc += realDt * match.timeScale * loopCtl.speed;
    while (acc >= SIM_DT && steps < MAX_STEPS) {
      if (blockedByReplay()) {
        acc = 0;
        break;
      }
      stepTicks(1);
      acc -= SIM_DT;
      steps++;
    }
    if (steps >= MAX_STEPS) acc = 0; // can't keep up: drop time rather than spiral
  }
  loopCtl.simMs += (performance.now() - t0 - loopCtl.simMs) * 0.1;
  loopCtl.steps = steps;

  // goal replay: presentation takes over until it finishes, then the sim kicks off
  if (match.state === 'celebrate' && match.holdKickoff) {
    if (!isReplaying()) startReplay(match.scoredBy);
    if (updateReplay(realDt)) {
      replayDone = true;
      match.holdKickoff = false;
      kickOff(match.teams[1 - match.scoredBy]);
      captureSnapshot();
      captureSnapshot();
    }
  } else if (filmCtl.secondsAgo >= 0 && presentFilm(realDt)) {
    // dev film view (window.__strikers.film): a recorded moment, camera follows its ball
    const fb = filmBall();
    if (fb) updateCamera(realDt, fb[0], fb[1], fb[2]);
  } else {
    presentLive(loopCtl.manual ? 1 : acc / SIM_DT, realDt);
  }

  updateToast(realDt);
  updateHUD();
  updateRadar();
  updateStadium(realDt);
  Audio.update(realDt);
  updateLab();
  renderFrame();
}

/** Starts the render/simulation loop. */
export function startLoop(): void {
  last = performance.now();
  captureSnapshot();
  captureSnapshot();
  requestAnimationFrame(frame);
}
