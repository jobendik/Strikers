/**
 * playerLoader.ts — async FBX loader for the Mixamo football player model and
 * its animation clips. Call loadPlayerModels() once at boot (before any Player
 * instances are created), then getPlayerModelData() for synchronous access.
 */

import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

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
   * Normalised template group: scale already adjusted so the character is
   * MODEL_HEIGHT tall with feet at y = 0, and every material pre-tagged as kit
   * (tintable) or skin/boots (not tinted). Never add this directly to the scene —
   * use SkeletonUtils.clone() to produce an independent copy for each player.
   */
  template: THREE.Group;
  clips: Record<AnimName, THREE.AnimationClip>;
}

/** True if a material looks like bare skin (so the team colour must NOT tint it). */
function isSkinMaterial(m: THREE.Material): boolean {
  if (/skin|body|head|face|hand|arm|leg|flesh|eye|hair|teeth|tongue/i.test(m.name)) return true;
  // Fall back to a base-colour sniff: skin sits in a warm mid r>g>b band.
  const col = (m as THREE.MeshStandardMaterial).color;
  if (col) {
    const { r, g, b } = col;
    if (r > 0.35 && r > b && g > b * 0.9 && r - b > 0.08 && r < 0.96) return true;
  }
  return false;
}

/**
 * Tag a material as kit (tintable) or skin, and give it sensible PBR response
 * under the new environment map. Mutates in place; safe to call once per unique
 * material on the template.
 */
function prepareMaterial(m: THREE.Material, index: number): void {
  if (!m.name) m.name = `mat${index}`;
  const std = m as THREE.MeshStandardMaterial;
  const skin = isSkinMaterial(m);
  m.userData.tintable = !skin;
  if (std.isMeshStandardMaterial) {
    std.envMapIntensity = 0.85;
    // Skin is fairly matte; kit fabric a touch glossier so the envMap reads.
    if (std.roughness === undefined || std.roughness === 1) std.roughness = skin ? 0.85 : 0.7;
    std.metalness = 0;
    if (std.map) {
      std.map.colorSpace = THREE.SRGBColorSpace;
      std.map.anisotropy = 4;
    }
  }
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
 * Strip root-bone position tracks from a clip so the character doesn't drift
 * away from its game-driven position during locomotion or action animations.
 */
function stripRootMotion(clip: THREE.AnimationClip): THREE.AnimationClip {
  // Mixamo root bone is always named "mixamorig:Hips"
  clip.tracks = clip.tracks.filter(
    (t) => !(t.name.toLowerCase().includes('hips') && t.name.endsWith('.position')),
  );
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

  // Enable shadows and prepare every material on the base model. Players now also
  // RECEIVE shadows (self-shadowing on the limbs/torso) — flat, doll-like shading
  // was a big part of why the models looked cheap. The cost is small for ~22
  // low-poly characters and the normalBias on the sun tames the resulting acne.
  let matIndex = 0;
  const seen = new Set<THREE.Material>();
  base.traverse((obj) => {
    if (obj instanceof THREE.Mesh || obj instanceof THREE.SkinnedMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        if (!m || seen.has(m)) continue;
        seen.add(m);
        prepareMaterial(m, matIndex++);
      }
    }
  });

  // Normalise scale: make the character exactly MODEL_HEIGHT tall with feet at y = 0.
  const rawBox = new THREE.Box3().setFromObject(base);
  const rawHeight = rawBox.max.y - rawBox.min.y;
  if (rawHeight > 0) {
    base.scale.multiplyScalar(MODEL_HEIGHT / rawHeight);
  }
  const scaledBox = new THREE.Box3().setFromObject(base);
  base.position.y = -scaledBox.min.y; // lift so feet touch y = 0

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

  _data = { template: base, clips };
}
