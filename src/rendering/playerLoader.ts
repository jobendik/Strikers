/**
 * playerLoader.ts — async FBX loader for the Mixamo football player model and
 * its animation clips. Call loadPlayerModels() once at boot (before any Player
 * instances are created), then getPlayerModelData() for synchronous access.
 */

import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { buildPlayerRigTemplate, type PlayerRigTemplate } from './playerRig';

// Vite resolves these to hashed URLs at build time thanks to assetsInclude: ['**/*.fbx']
import modelUrl from '../../3dmodels/players/football_player.fbx?url';
import idleUrl from '../../3dmodels/animations/idle.fbx?url';
import runUrl from '../../3dmodels/animations/run.fbx?url';
import sprintUrl from '../../3dmodels/animations/sprint.fbx?url';
import kickUrl from '../../3dmodels/animations/kick.fbx?url';
import diveLeftUrl from '../../3dmodels/animations/GK_dive_left.fbx?url';
import diveRightUrl from '../../3dmodels/animations/GK_dive_right.fbx?url';
import celebrateUrl from '../../3dmodels/animations/goal_celebration.fbx?url';

/** Keys for every animation clip used in the game. */
export type AnimName = 'idle' | 'run' | 'sprint' | 'kick' | 'gkDiveLeft' | 'gkDiveRight' | 'celebrate';

/**
 * Rendered height of a player in world units. The pitch/ball are modelled at
 * real-world scale (ball Ø ~0.84 m) so the character should be ~1.85 m — a hair
 * above average to read clearly from the broadcast camera without looking like a
 * giant next to the ball. (Was 2.4 m, which dwarfed the ball and the goals.)
 */
export const MODEL_HEIGHT = 1.85;

export interface PlayerModelData {
  /**
   * The shared rig: one merged + welded character geometry, a 65-joint template
   * hierarchy and the inverse bind matrices. Use `instantiatePlayerRig()` (see
   * playerRig.ts) to stamp out a player — never add the template to the scene.
   */
  rig: PlayerRigTemplate;
  clips: Record<AnimName, THREE.AnimationClip>;
}

/** Per-player animation bookkeeping stored in mesh.userData.animState. */
export interface PlayerAnimState {
  current: AnimName | null;
  action: THREE.AnimationAction | null;
  /** kickCooldown value from the previous frame — used to detect rising-edge kicks. */
  prevKickCd: number;
  /** Unspent dt accumulated while a distant player's mixer was throttled. */
  accum: number;
}

let _data: PlayerModelData | null = null;

export function getPlayerModelData(): PlayerModelData {
  if (!_data) throw new Error('Player model not loaded — call loadPlayerModels() first');
  return _data;
}

export function isPlayerModelReady(): boolean {
  return _data !== null;
}

/* ------------------------------------------------------------------ loader */

const _fbxLoader = new FBXLoader();

function loadFBX(url: string): Promise<THREE.Group> {
  return new Promise((resolve, reject) => _fbxLoader.load(url, resolve, undefined, reject));
}

/**
 * Remove horizontal root motion from a clip.
 *
 * The simulation owns where a player is; a clip must only pose him. These Mixamo
 * clips move the body two ways: a position track on the hips, and one on the
 * `Armature` node above the skeleton (the keeper dives travel ~2.5 m sideways on
 * it; even the "in place" sprint wanders ~0.5 m). Hips translation is dropped
 * entirely. On the armature track the horizontal components are pinned to their
 * first key and only the *vertical* motion is kept — so a dive still drops to the
 * turf and a stride still bobs, but the body can never drift off its simulated
 * position.
 */
function stripRootMotion(clip: THREE.AnimationClip): THREE.AnimationClip {
  clip.tracks = clip.tracks.filter((t) => !(t.name.toLowerCase().includes('hips') && t.name.endsWith('.position')));
  for (const t of clip.tracks) {
    if (!t.name.endsWith('.position')) continue;
    const v = t.values;
    if (v.length < 3) continue;
    const x0 = v[0];
    const z0 = v[2];
    for (let i = 0; i < v.length; i += 3) {
      v[i] = x0;
      v[i + 2] = z0;
    }
  }
  return clip;
}

/**
 * Load and prepare the Mixamo player model + all animation clips.
 * Must complete before any Player instances are constructed.
 */
export async function loadPlayerModels(): Promise<void> {
  const [base, idleFbx, runFbx, sprintFbx, kickFbx, diveLeftFbx, diveRightFbx, celebFbx] =
    await Promise.all([
      loadFBX(modelUrl),
      loadFBX(idleUrl),
      loadFBX(runUrl),
      loadFBX(sprintUrl),
      loadFBX(kickUrl),
      loadFBX(diveLeftUrl),
      loadFBX(diveRightUrl),
      loadFBX(celebrateUrl),
    ]);

  // Collapse the FBX's seven skinned meshes / seven duplicate skeletons into one
  // welded mesh on one 65-joint skeleton, scaled so the character stands
  // MODEL_HEIGHT tall with feet at y = 0. Materials are replaced wholesale by the
  // procedural player shader (kitMaterials.ts), so the FBX's Phong materials are
  // discarded here.
  const fbxMaterials = new Set<THREE.Material>();
  base.traverse((obj) => {
    const m = (obj as THREE.Mesh).material;
    if (m) for (const one of Array.isArray(m) ? m : [m]) fbxMaterials.add(one);
  });
  const rig = buildPlayerRigTemplate(base, MODEL_HEIGHT);
  for (const m of fbxMaterials) {
    // free every FBX texture except the body atlas the player shader still samples
    for (const v of Object.values(m)) {
      if (v && (v as THREE.Texture).isTexture && v !== rig.bodyMap) (v as THREE.Texture).dispose();
    }
    m.dispose();
  }

  // Build and name the clip map; strip root motion from every clip.
  const rawClips: [AnimName, THREE.AnimationClip][] = [
    ['idle', idleFbx.animations[0]],
    ['run', runFbx.animations[0]],
    ['sprint', sprintFbx.animations[0]],
    ['kick', kickFbx.animations[0]],
    ['gkDiveLeft', diveLeftFbx.animations[0]],
    ['gkDiveRight', diveRightFbx.animations[0]],
    ['celebrate', celebFbx.animations[0]],
  ];

  const clips = {} as Record<AnimName, THREE.AnimationClip>;
  for (const [name, clip] of rawClips) {
    clip.name = name;
    clips[name] = stripRootMotion(clip);
  }

  _data = { rig, clips };
}
