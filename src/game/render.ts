import * as THREE from 'three';
import { CFG } from '../config/constants';
import { clamp } from '../core/math';
import { ball, match } from './state';
import { camera, sun } from '../rendering/scene';

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
}

/** Broadcast-style camera that tracks the ball and drifts gently in menus. */
export function updateCamera(dt: number): void {
  const live = match.state === 'play' || match.state === 'celebrate';
  const fx = live ? clamp(ball.position.x * 0.6, -14, 14) : Math.sin(performance.now() * 0.00018) * 12;
  camera.position.lerp(new THREE.Vector3(fx, 26, 38), Math.min(1, 2.6 * dt));
  camera.lookAt(new THREE.Vector3(fx * 0.7, 0, live ? -2 + ball.position.z * 0.12 : 0));
  sun.target.position.set(ball.position.x * 0.3, 0, 0);
}
