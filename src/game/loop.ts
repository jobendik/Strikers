import * as THREE from 'three';
import { CFG } from '../config/constants';
import { advanceTime } from '../core/time';
import { Audio } from '../core/audio';
import { camera, renderer, scene } from '../rendering/scene';
import { ball, match, setReceiver, teamIndex } from './state';
import { pollInput } from './input';
import { resolveControl, resolveSlides, updateGkHold, updatePressure } from './control';
import { movePlayers, selectUserPlayer } from './movement';
import { updateBall } from './physics';
import { kickOff, tickClock } from './flow';
import { updateShootout } from './penalty';
import { hasReplay, isReplaying, recordFrame, startReplay, updateReplay } from './replay';
import { syncMeshes, updateCamera } from './render';
import { updateHUD, updateToast } from '../ui/hud';

const clock = new THREE.Clock();

function frame(): void {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);

  // ease the global time-scale back toward normal (goal slow-motion recovers here)
  if (match.timeScale < 1) match.timeScale = Math.min(1, match.timeScale + CFG.slowmoRecover * dt);
  const sdt = dt * match.timeScale; // simulation step (dilated); rendering still uses real dt
  pollInput();

  // paused: freeze the simulation but keep presenting the (static) scene
  if (match.paused) {
    renderer.render(scene, camera);
    return;
  }
  advanceTime(sdt);

  if (match.state === 'play') {
    tickClock(dt); // the match clock runs in real time, not slow-mo
    if (match.controlTeam) match.stats.possession[teamIndex(match.controlTeam)] += dt;
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
    recordFrame(); // capture transforms for a possible goal replay
  } else if (match.state === 'celebrate') {
    if (match.celebrateBallT > 0) {
      // let the ball keep flying into the net in slow motion for a cinematic beat
      match.celebrateBallT -= dt;
      updateBall(sdt);
      match.celebrateT -= dt;
    } else if (hasReplay()) {
      // then roll an instant replay of the goal before kicking off
      if (!isReplaying()) startReplay(match.scoredBy);
      if (updateReplay(dt)) kickOff(match.teams[1 - match.scoredBy]);
    } else {
      match.celebrateT -= dt;
      if (match.celebrateT <= 0) kickOff(match.teams[1 - match.scoredBy]);
    }
  } else if (match.state === 'shootout') {
    updateShootout(sdt);
  }

  const replaying = match.state === 'celebrate' && isReplaying();

  // crowd ambience swells as the ball approaches either goal
  if (match.state === 'play' || match.state === 'celebrate') {
    const prox = Math.min(1, Math.abs(ball.position.x) / CFG.halfL);
    Audio.setCrowd(0.18 + prox * prox * 0.82);
  } else if (match.state === 'shootout') {
    Audio.setCrowd(0.5); // a tense shootout hum
  } else {
    Audio.setCrowd(0.12);
  }

  updateToast(dt);
  if (!replaying) {
    // the replay drives the meshes + camera itself from recorded transforms
    syncMeshes(dt);
    updateCamera(dt);
  }
  updateHUD();
  renderer.render(scene, camera);
}

/** Starts the render/simulation loop. */
export function startLoop(): void {
  frame();
}
