import * as THREE from 'three';
import { CFG } from '../config/constants';
import { world } from './scene';
import { getPlayerModelData, type AnimName, type PlayerAnimState } from './playerLoader';
import { instantiatePlayerRig } from './playerRig';
import { createPlayerMaterial } from './kitMaterials';
import { allocNameSlot, getKitAtlas } from './kitAtlas';
import { applyLookState, lookSeed, setPrimaryColor, type LookState, type PlayerLook } from './playerLook';
import { makePlayerIndicators } from './playerIndicators';
import { createBall } from './ballMesh';

export { lookSeed };
export type { PlayerLook };

/* ------------------------------------------------------------------ ball */

/**
 * Builds the match ball (see ballMesh.ts) and adds it to the world.
 * `userData.shadow` is the soft blob shadow the game moves/scales under the ball.
 */
export function makeBallMesh(): THREE.Mesh {
  const { ball, shadow } = createBall(CFG.ballR);
  world.add(shadow);
  ball.userData.shadow = shadow;
  world.add(ball);
  return ball;
}

/* ------------------------------------------------------------------ players */

let _blobGeo: THREE.CircleGeometry | null = null;
let _blobMat: THREE.MeshBasicMaterial | null = null;

/**
 * Build a player from the pre-loaded rig template (see playerRig.ts).
 *
 * Each player is ONE SkinnedMesh on its own 65-joint skeleton, drawn with its own
 * small material (all players share one shader program, geometry and textures).
 *
 * userData contract (consumed by game/render.ts, game/replay.ts, entities/Player.ts):
 *   .ring      — Mesh; "you control this player" indicator, toggled via `.visible`
 *                (the overhead chevron is its child)
 *   .call      — Mesh; pass-request cue: `.visible`, `.scale.setScalar()`, `.material.opacity`
 *   .blob      — Mesh; fallback blob shadow for the tier without shadow maps
 *   .body      — legacy tint proxy: `.material.color.set(hex)` sets the primary kit colour
 *   .mixer     — THREE.AnimationMixer for this player
 *   .clips     — shared Record<AnimName, THREE.AnimationClip>
 *   .animState — PlayerAnimState bookkeeping
 *   .lookState — renderer-private (see applyPlayerLook)
 */
export function makeModelPlayerMesh(jerseyColor: string): THREE.Group {
  const { rig: tpl, clips } = getPlayerModelData();

  const g = new THREE.Group();

  const { material, uniforms } = createPlayerMaterial(tpl.bodyMap, getKitAtlas());
  const rig = instantiatePlayerRig(tpl, material);
  g.add(rig.root);

  // ----- overlays (world-unit scale, unaffected by the model's scale) -----
  const ind = makePlayerIndicators();
  g.add(ind.ring);
  g.add(ind.call);

  // Contact shadow blob — grounds the player in the tier where real shadows are
  // off. render.syncMeshes hides it whenever the shadow map is enabled.
  _blobGeo ??= new THREE.CircleGeometry(0.42, 20);
  _blobMat ??= new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.28, depthWrite: false });
  const blob = new THREE.Mesh(_blobGeo, _blobMat);
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.02;
  g.add(blob);

  const lookState: LookState = {
    uniforms,
    root: rig.root,
    baseScale: tpl.root.scale.y,
    nameSlot: allocNameSlot(),
    look: null,
    onKit: (kit) => ind.setKitColor(kit.shirt),
  };

  g.userData.ring = ind.ring;
  g.userData.call = ind.call;
  g.userData.blob = blob;
  g.userData.lookState = lookState;
  // Legacy tint proxy (pre-applyPlayerLook callers): "set the primary kit colour".
  g.userData.body = {
    material: {
      color: {
        set(c: string): void {
          setPrimaryColor(lookState, c);
        },
      },
    },
  };
  setPrimaryColor(lookState, jerseyColor);

  // ----- animation -----
  const mixer = new THREE.AnimationMixer(rig.root);
  const idleAction = mixer.clipAction(clips.idle);
  idleAction.setLoop(THREE.LoopRepeat, Infinity).play();
  const animState: PlayerAnimState = { current: 'idle', action: idleAction, prevKickCd: 0, accum: 0 };

  g.userData.mixer = mixer;
  g.userData.clips = clips as Record<AnimName, THREE.AnimationClip>;
  g.userData.animState = animState;

  world.add(g);
  return g;
}

/**
 * Dress a player: nation kit (home, or an away strip built around `kitColor` when
 * the game has resolved a clash), keeper strip, squad number + name, and seeded
 * skin / hair / boots variety. Cheap — it only rewrites uniform values — so call
 * it whenever the identity changes.
 */
export function applyPlayerLook(mesh: THREE.Group, look: PlayerLook): void {
  const st = mesh.userData.lookState as LookState | undefined;
  if (st) applyLookState(st, look);
}
