import * as THREE from 'three';
import { advanceTime } from '../core/time';
import { camera, renderer, scene } from '../rendering/scene';
import { match } from './state';
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
  advanceTime(dt);
  pollInput();

  if (match.state === 'play') {
    match.timeLeft -= dt;
    if (match.timeLeft <= 0) {
      match.timeLeft = 0;
      fullTime();
    }
    resolveControl(dt);
    updateGkHold(dt);
    selectUserPlayer(dt);
    match.teams[0].update(dt);
    match.teams[1].update(dt);
    movePlayers(dt);
    resolveSlides(dt);
    updatePressure(dt);
    updateBall(dt);
  } else if (match.state === 'celebrate') {
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
