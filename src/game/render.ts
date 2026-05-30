import * as THREE from 'three';
import { CFG } from '../config/constants';
import { clamp } from '../core/math';
import { ball, match } from './state';
import { camera, scene, sun } from '../rendering/scene';

/** Push simulation state onto the Three.js meshes each frame. */
export function syncMeshes(dt: number): void {
  for (const t of match.teams)
    for (const p of t.players) {
      p.mesh.position.set(p.position.x, 0, p.position.z);
      const cur = p.mesh.rotation.y;
      let diff = p.heading - cur;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      p.mesh.rotation.y = cur + diff * Math.min(1, 12 * dt);
      // a diving keeper pitches forward and goes full-stretch toward the ball;
      // sliding tacklers lean too. Ease the lean in and back out smoothly.
      const leanTo = p.dive > 0 ? 1.25 : p.slide > 0 ? 0.7 : 0;
      p.mesh.rotation.x += (leanTo - p.mesh.rotation.x) * Math.min(1, 14 * dt);
      (p.mesh.userData.ring as THREE.Mesh).visible = p === match.userPlayer && match.state !== 'menu';
    }
  ball.mesh.position.set(ball.position.x, Math.max(CFG.ballR, ball.position.y), ball.position.z);
  const sp = Math.hypot(ball.velocity.x, ball.velocity.z);
  if (sp > 0.1) {
    const ax = new THREE.Vector3(ball.velocity.z, 0, -ball.velocity.x).normalize();
    ball.mesh.rotateOnWorldAxis(ax, (sp * dt) / CFG.ballR);
  }
  // ground shadow shrinks as the ball climbs, selling the height
  const shadow = ball.mesh.userData.shadow as THREE.Mesh | undefined;
  if (shadow) {
    shadow.position.set(ball.position.x, 0.02, ball.position.z);
    const h = Math.max(0, ball.position.y - CFG.ballR);
    const s = clamp(1 - h * 0.07, 0.4, 1);
    shadow.scale.set(s, s, s);
    (shadow.material as THREE.MeshBasicMaterial).opacity = 0.34 * s;
  }
  updateTrail(sp);
}

/* ----------------------------- camera shake ------------------------------ */

let shake = 0;
/** Add an impulse of screen-shake; decays over the next few frames. */
export function addShake(amount: number): void {
  shake = Math.min(1.4, shake + amount);
}

const _camTarget = new THREE.Vector3();
const _look = new THREE.Vector3();

/** Broadcast-style camera that tracks the ball, zooms for goals and shakes on impacts. */
export function updateCamera(dt: number): void {
  const live = match.state === 'play' || match.state === 'celebrate';
  const fx = live ? clamp(ball.position.x * 0.6, -14, 14) : Math.sin(performance.now() * 0.00018) * 12;

  if (match.state === 'shootout') {
    // a tight, dramatic angle behind the spot looking at the goal (always +X)
    _camTarget.set(CFG.halfL - 20, 12, 17);
    _look.set(CFG.halfL - 2, 1.3, ball.position.z * 0.4);
  } else if (match.state === 'celebrate') {
    // cinematic push-in toward the goal that was just breached
    const gx = match.scoredBy === 0 ? CFG.halfL : -CFG.halfL;
    _camTarget.set(gx * 0.62, 17, 26);
    _look.set(gx * 0.8, 1.4, ball.position.z * 0.2);
  } else {
    _camTarget.set(fx, 26, 38);
    _look.set(fx * 0.7, 0, live ? -2 + ball.position.z * 0.12 : 0);
  }

  camera.position.lerp(_camTarget, Math.min(1, (match.state === 'celebrate' ? 3.4 : 2.6) * dt));

  if (shake > 0.001) {
    const s = shake * shake; // ease the falloff so it punches then settles
    camera.position.x += (Math.random() - 0.5) * s * 2.4;
    camera.position.y += (Math.random() - 0.5) * s * 1.6;
    camera.position.z += (Math.random() - 0.5) * s * 2.4;
    shake = Math.max(0, shake - dt * 3.2);
  }

  camera.lookAt(_look);
  sun.target.position.set(ball.position.x * 0.3, 0, 0);
}

/* ------------------------------ ball trail ------------------------------- */

const TRAIL_N = 16;
let trail: THREE.Line | null = null;
let trailPos: Float32Array;
let trailActive = false;
const _p = new THREE.Vector3();

function ensureTrail(): void {
  if (trail) return;
  trailPos = new Float32Array(TRAIL_N * 3);
  const colors = new Float32Array(TRAIL_N * 3);
  for (let i = 0; i < TRAIL_N; i++) {
    const t = i / (TRAIL_N - 1); // head (latest) = 1 → bright, tail = 0 → dark (fades under additive blending)
    colors[i * 3] = 0.65 * t;
    colors[i * 3 + 1] = 0.85 * t;
    colors[i * 3 + 2] = 1.0 * t;
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

/** A glowing streak behind a fast or airborne ball — pure arcade juice. */
function updateTrail(speed: number): void {
  ensureTrail();
  if (!trail) return;
  const airborne = ball.position.y > CFG.ballR + 0.05;
  const live = (match.state === 'play' || match.state === 'celebrate') && (speed > 14 || airborne);
  trail.visible = live;
  if (!live) {
    trailActive = false;
    return;
  }

  _p.set(ball.position.x, Math.max(CFG.ballR, ball.position.y), ball.position.z);
  if (!trailActive) {
    // first frame visible: collapse the whole streak onto the ball so it grows out cleanly
    for (let i = 0; i < TRAIL_N; i++) {
      trailPos[i * 3] = _p.x;
      trailPos[i * 3 + 1] = _p.y;
      trailPos[i * 3 + 2] = _p.z;
    }
    trailActive = true;
  } else {
    // shift history down one slot, then write the newest sample at the head
    for (let i = 0; i < TRAIL_N - 1; i++) {
      trailPos[i * 3] = trailPos[(i + 1) * 3];
      trailPos[i * 3 + 1] = trailPos[(i + 1) * 3 + 1];
      trailPos[i * 3 + 2] = trailPos[(i + 1) * 3 + 2];
    }
    trailPos[(TRAIL_N - 1) * 3] = _p.x;
    trailPos[(TRAIL_N - 1) * 3 + 1] = _p.y;
    trailPos[(TRAIL_N - 1) * 3 + 2] = _p.z;
  }
  (trail.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  (trail.material as THREE.LineBasicMaterial).opacity = clamp(speed / 30, 0.25, 0.9);
}

/** Reset the trail history so it doesn't streak across a restart/kickoff. */
export function clearTrail(): void {
  trailActive = false;
  if (trail) trail.visible = false;
}
