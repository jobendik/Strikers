import * as THREE from 'three';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { CFG } from '../config/constants';
import { rand } from '../core/math';
import { world } from './scene';
import { getPlayerModelData, type AnimName, type PlayerAnimState } from './playerLoader';

/** Builds a stylised player avatar (body, shorts, head, facing chip, active ring). */
export function makePlayerMesh(jersey: string): THREE.Group {
  const g = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.42, 0.85, 6, 14),
    new THREE.MeshStandardMaterial({ color: jersey, roughness: 0.55, metalness: 0.05 }),
  );
  body.position.y = 0.84;
  body.castShadow = true;
  g.add(body);

  const shorts = new THREE.Mesh(
    new THREE.CylinderGeometry(0.43, 0.4, 0.5, 12),
    new THREE.MeshStandardMaterial({ color: '#101820', roughness: 0.7 }),
  );
  shorts.position.y = 0.5;
  shorts.castShadow = true;
  g.add(shorts);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 16, 12),
    new THREE.MeshStandardMaterial({ color: '#e8b48a', roughness: 0.8 }),
  );
  head.position.y = 1.62;
  head.castShadow = true;
  g.add(head);

  // facing chip (front = +z local)
  const face = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.06), new THREE.MeshStandardMaterial({ color: '#1a1a1a' }));
  face.position.set(0, 1.62, 0.27);
  g.add(face);

  // contact shadow
  const cs = new THREE.Mesh(
    new THREE.CircleGeometry(0.6, 18),
    new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.32 }),
  );
  cs.rotation.x = -Math.PI / 2;
  cs.position.y = 0.02;
  g.add(cs);

  // active ring (hidden by default)
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.62, 0.82, 28),
    new THREE.MeshBasicMaterial({ color: '#ffce2e', transparent: true, opacity: 0.95, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  ring.visible = false;
  g.add(ring);

  // pass-request cue: a pulsing lane ring around a teammate actively calling
  // for the ball. Kept as geometry so it stays readable on mobile screens.
  const call = new THREE.Mesh(
    new THREE.RingGeometry(0.95, 1.08, 30),
    new THREE.MeshBasicMaterial({ color: '#39ff14', transparent: true, opacity: 0.0, side: THREE.DoubleSide }),
  );
  call.rotation.x = -Math.PI / 2;
  call.position.y = 0.075;
  call.visible = false;
  g.add(call);

  g.userData.ring = ring;
  g.userData.call = call;
  g.userData.body = body;
  world.add(g);
  return g;
}

/** Builds the soccer ball with a procedurally painted pentagon texture. */
export function makeBallMesh(): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  x.fillStyle = '#f4f7fb';
  x.fillRect(0, 0, 128, 128);
  x.fillStyle = '#10151c';
  for (let i = 0; i < 7; i++) {
    x.save();
    x.translate(rand(10, 118), rand(10, 118));
    x.rotate(rand(0, 6.28));
    x.beginPath();
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * 6.283;
      const r = rand(7, 11);
      x.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    x.closePath();
    x.fill();
    x.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(CFG.ballR, 22, 16),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, metalness: 0.05 }),
  );
  m.castShadow = true;

  // a fake contact shadow that shrinks as the ball lifts off the turf — sells height
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(CFG.ballR * 1.15, 18),
    new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.34 }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  world.add(shadow);
  m.userData.shadow = shadow;

  world.add(m);
  return m;
}

/* ------------------------------------------------------------------ 3-D model mesh */

/**
 * Build a player mesh from the pre-loaded Mixamo FBX model.
 * Each call clones the template with an independent skeleton (via SkeletonUtils)
 * so every player animates separately.
 *
 * The returned Group keeps the same userData interface as the stub mesh:
 *   .ring  — yellow indicator ring (visible for the user-controlled player)
 *   .call  — green pass-request ring
 *   .body  — proxy whose .material.color.set() tints the jersey
 *   .mixer — THREE.AnimationMixer for this player
 *   .clips — shared Record<AnimName, THREE.AnimationClip>
 *   .animState — PlayerAnimState bookkeeping
 */
export function makeModelPlayerMesh(jerseyColor: string): THREE.Group {
  const { template, clips } = getPlayerModelData();

  const g = new THREE.Group();

  // SkeletonUtils.clone gives each player a fully independent skeleton.
  const modelClone = skeletonClone(template) as THREE.Group;
  g.add(modelClone);

  // ----- body color proxy (matches the interface Player.applyIdentity() uses) -----
  g.userData.body = {
    material: {
      color: {
        set(c: string): void {
          modelClone.traverse((obj) => {
            if (obj instanceof THREE.SkinnedMesh || obj instanceof THREE.Mesh) {
              const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
              for (const m of mats) {
                if (
                  (m instanceof THREE.MeshStandardMaterial || m instanceof THREE.MeshPhongMaterial) &&
                  !m.transparent
                ) {
                  (m as THREE.MeshStandardMaterial).color.set(c);
                }
              }
            }
          });
        },
      },
    },
  };
  // Apply the initial jersey colour immediately.
  (g.userData.body as { material: { color: { set(c: string): void } } }).material.color.set(jerseyColor);

  // ----- overlay elements (game-unit scale — unaffected by the 1.7 m model scale) -----

  // Active-player indicator ring
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.62, 0.82, 28),
    new THREE.MeshBasicMaterial({ color: '#ffce2e', transparent: true, opacity: 0.95, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  ring.visible = false;
  g.add(ring);

  // Pass-request cue ring
  const call = new THREE.Mesh(
    new THREE.RingGeometry(0.95, 1.08, 30),
    new THREE.MeshBasicMaterial({ color: '#39ff14', transparent: true, opacity: 0.0, side: THREE.DoubleSide }),
  );
  call.rotation.x = -Math.PI / 2;
  call.position.y = 0.075;
  call.visible = false;
  g.add(call);

  // Contact shadow blob
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.55, 18),
    new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.28 }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  g.add(shadow);

  g.userData.ring = ring;
  g.userData.call = call;

  // ----- animation mixer -----
  const mixer = new THREE.AnimationMixer(modelClone);
  const idleAction = mixer.clipAction(clips.idle);
  idleAction.setLoop(THREE.LoopRepeat, Infinity).play();

  const animState: PlayerAnimState = {
    current: 'idle',
    action: idleAction,
    prevKickCd: 0,
  };

  g.userData.mixer = mixer;
  g.userData.clips = clips as Record<AnimName, THREE.AnimationClip>;
  g.userData.animState = animState;

  world.add(g);
  return g;
}
