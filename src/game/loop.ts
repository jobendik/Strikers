import * as THREE from 'three';
import { CFG } from '../config/constants';
import { advanceTime } from '../core/time';
import { camera, renderer, scene } from '../rendering/scene';
import { match, setReceiver } from './state';
import { pollInput } from './input';
import { resolveControl, resolveSlides, updateGkHold, updatePressure } from './control';
import { movePlayers, selectUserPlayer } from './movement';
import { updateBall } from './physics';
import { fullTime, kickOff } from './flow';
import { syncMeshes, updateCamera } from './render';
import { updateHUD, updateToast } from '../ui/hud';

const clock = new THREE.Clock();

function frame(): void {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);

  // ease the global time-scale back toward normal (goal slow-motion recovers here)
  if (match.timeScale < 1) match.timeScale = Math.min(1, match.timeScale + CFG.slowmoRecover * dt);
  const sdt = dt * match.timeScale; // simulation step (dilated); rendering still uses real dt
  advanceTime(sdt);
  pollInput();

  if (match.state === 'play') {
    match.timeLeft -= dt; // the match clock runs in real time, not slow-mo
    if (match.timeLeft <= 0) {
      match.timeLeft = 0;
      fullTime();
    }
    // lapse the pass-receiver assignment if it's gone unclaimed (Simple Soccer)
    if (match.receivingPlayer) {
      match.receiveTimer -= sdt;
      if (match.receiveTimer <= 0) setReceiver(null);
    }
    resolveControl(sdt);
    updateGkHold(sdt);
    selectUserPlayer(sdt);
    match.teams[0].update(sdt);
    match.teams[1].update(sdt);
    movePlayers(sdt);
    resolveSlides(sdt);
    updatePressure(sdt);
    updateBall(sdt);
  } else if (match.state === 'celebrate') {
    // let the ball keep flying into the net in slow motion for a cinematic beat
    if (match.celebrateBallT > 0) {
      match.celebrateBallT -= dt;
      updateBall(sdt);
    }
    match.celebrateT -= dt;
    if (match.celebrateT <= 0) kickOff(match.teams[1 - match.scoredBy]);
  }

  updateToast(dt);
  syncMeshes(dt);
  updateCamera(dt);
  updateHUD();
  renderer.render(scene, camera);
}

/** Starts the render/simulation loop. */
export function startLoop(): void {
  frame();
}
