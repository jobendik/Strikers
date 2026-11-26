/**
 * playerRig.ts — turns the raw Mixamo FBX into a lean, shareable player rig.
 *
 * What the FBX gives us (football_player.fbx, Mixamo "Ch38"):
 *   - seven SkinnedMeshes (Shirt, Shorts, Socks, Shoes, Body, Hair, Eyelashes),
 *     non-indexed, ≈80k vertices in total;
 *   - FBXLoader builds ONE Skeleton PER MESH. Because all seven share the same
 *     65 joints it creates 7 Bone objects per joint and nests the copies as
 *     identity children of each other (Hips > Hips > Hips > …): 455 Bones, seven
 *     skeletons, seven bone textures — per player.
 *
 * What we build instead:
 *   - one welded, indexed BufferGeometry for the whole character with a per-vertex
 *     `aPart` id (shirt / shorts / socks / boots / skin / eyes), shared by every
 *     player → one draw call per player (plus one in the shadow pass);
 *   - the duplicate bones removed, so the hierarchy has exactly 65 joints;
 *   - per player: a clone of that 65-bone hierarchy and ONE Skeleton that reuses
 *     the template's inverse bind matrices.
 *
 * Hair cards + eyelashes (6.2k triangles of alpha-blended strands that contribute
 * a few pixels in a close-up and nothing at match distance) are dropped; the
 * scalp is shaded by the player shader instead.
 */

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Per-vertex part ids written to the `aPart` attribute (mirrored in the shader). */
export const PART = { shirt: 0, shorts: 1, socks: 2, boots: 3, skin: 4, eyes: 5 } as const;

/** FBX mesh name → part id. Meshes not listed here are dropped. */
const MESH_PART: Record<string, number> = {
  Ch38_Shirt: PART.shirt,
  Ch38_Shorts: PART.shorts,
  Ch38_Socks: PART.socks,
  Ch38_Shoes: PART.boots,
  Ch38_Body: PART.skin,
};

export interface RigStats {
  sourceMeshes: number;
  sourceBones: number;
  sourceVertices: number;
  sourceTriangles: number;
  bones: number;
  vertices: number;
  triangles: number;
  droppedTriangles: number;
}

export interface PlayerRigTemplate {
  /** Scaled root holding ONLY the bone hierarchy (no meshes). Never added to the scene. */
  root: THREE.Group;
  /** Merged + welded character geometry (model units = centimetres), shared by all players. */
  geometry: THREE.BufferGeometry;
  /** Joint names, in skeleton order. */
  boneNames: string[];
  /** Inverse bind matrices, shared (read-only) by every player's Skeleton. */
  boneInverses: THREE.Matrix4[];
  /** The model's embedded 512² base-colour atlas (used for skin + eyes only). */
  bodyMap: THREE.Texture | null;
  stats: RigStats;
}

export interface PlayerRig {
  /** Root to parent under the player's Group. Also the AnimationMixer root. */
  root: THREE.Group;
  mesh: THREE.SkinnedMesh;
  skeleton: THREE.Skeleton;
}

const _identity = new THREE.Matrix4();

/** True if `b` is one of FBXLoader's nested duplicate bones (same-named child of a bone). */
function isDuplicateBone(b: THREE.Object3D): boolean {
  const p = b.parent;
  return !!p && (p as THREE.Bone).isBone === true && p.name === b.name;
}

/** The eye / inner-mouth islands of the body atlas (texture used as-is, not re-tinted as skin). */
function isEyeUv(u: number, v: number): boolean {
  return (u > 0.74 && v > 0.455 && v < 0.6) || (u > 0.95 && v > 0.95);
}

/**
 * Build the shared rig template from the loaded FBX group.
 * Mutates `fbx` (removes its meshes and duplicate bones) and returns it as `root`.
 *
 * @param targetHeight world-space height the character should stand at
 */
export function buildPlayerRigTemplate(fbx: THREE.Group, targetHeight: number): PlayerRigTemplate {
  fbx.updateMatrixWorld(true);

  const meshes: THREE.SkinnedMesh[] = [];
  let sourceBones = 0;
  fbx.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh);
    if ((o as THREE.Bone).isBone) sourceBones++;
  });
  if (meshes.length === 0) throw new Error('player model has no skinned meshes');

  // ---- canonical skeleton: the real joints are the top of each duplicate chain
  const primaryByName = new Map<string, THREE.Bone>();
  fbx.traverse((o) => {
    if ((o as THREE.Bone).isBone && !isDuplicateBone(o) && !primaryByName.has(o.name)) {
      primaryByName.set(o.name, o as THREE.Bone);
    }
  });
  const refSkeleton = meshes[0].skeleton;
  const boneNames = refSkeleton.bones.map((b) => b.name);
  const boneInverses = refSkeleton.boneInverses.map((m) => m.clone());
  const canonIndex = new Map<string, number>();
  boneNames.forEach((n, i) => canonIndex.set(n, i));

  // ---- gather garment geometries, remapped onto the canonical joint order
  const parts: THREE.BufferGeometry[] = [];
  let bodyMap: THREE.Texture | null = null;
  let sourceVertices = 0;
  let sourceTriangles = 0;
  let droppedTriangles = 0;

  for (const mesh of meshes) {
    const src = mesh.geometry;
    const count = src.attributes.position.count;
    const tris = (src.index ? src.index.count : count) / 3;
    sourceVertices += count;
    sourceTriangles += tris;
    const part = MESH_PART[mesh.name];
    if (part === undefined) {
      droppedTriangles += tris;
      continue;
    }
    if (mesh.bindMatrix.elements.some((v, i) => Math.abs(v - _identity.elements[i]) > 1e-4)) {
      console.warn(`[playerRig] ${mesh.name}: non-identity bind matrix — skinning may be offset`);
    }

    const g = src.index ? src.toNonIndexed() : src.clone();
    for (const name of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'uv', 'skinIndex', 'skinWeight'].includes(name)) g.deleteAttribute(name);
    }
    g.morphAttributes = {};
    g.clearGroups();

    // skinIndex: this mesh's skeleton order → canonical order (identical in the
    // shipped asset, but we do not rely on it)
    const remap = mesh.skeleton.bones.map((b) => canonIndex.get(b.name) ?? 0);
    const si = g.attributes.skinIndex as THREE.BufferAttribute;
    const sw = g.attributes.skinWeight as THREE.BufferAttribute;
    for (let i = 0; i < si.count; i++) {
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(i, k);
        si.setComponent(i, k, w > 0 ? remap[si.getComponent(i, k)] : 0);
      }
    }

    // per-vertex part id (constant per triangle; eyes are split off the body by UV island)
    const partArr = new Float32Array(count).fill(part);
    if (part === PART.skin) {
      const uv = g.attributes.uv as THREE.BufferAttribute;
      for (let t = 0; t < count; t += 3) {
        const u = (uv.getX(t) + uv.getX(t + 1) + uv.getX(t + 2)) / 3;
        const v = (uv.getY(t) + uv.getY(t + 1) + uv.getY(t + 2)) / 3;
        if (isEyeUv(u, v)) partArr[t] = partArr[t + 1] = partArr[t + 2] = PART.eyes;
      }
      const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshPhongMaterial;
      bodyMap = mat.map ?? null;
    }
    g.setAttribute('aPart', new THREE.BufferAttribute(partArr, 1));
    parts.push(g);
  }

  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error('player model: garment geometries could not be merged');
  // Weld exact duplicates only: mergeVertices hashes EVERY attribute (position,
  // normal, uv, skin indices/weights, part id), so two vertices are merged only
  // when they would skin and shade identically.
  const geometry = mergeVertices(merged, 1e-4);
  for (const p of parts) p.dispose();
  merged.dispose();
  geometry.name = 'player-merged';

  // Static, generous bounds. A skinned mesh's true bounds change every frame;
  // recomputing them is expensive and three's one-off estimate (bind pose) clips
  // dives and celebrations. Centimetre model units.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 95, 0), 175);
  geometry.boundingBox = new THREE.Box3(new THREE.Vector3(-175, -80, -175), new THREE.Vector3(175, 270, 175));

  // ---- strip the meshes and FBXLoader's duplicate bones out of the hierarchy
  for (const mesh of meshes) {
    mesh.removeFromParent();
    mesh.geometry.dispose();
  }
  const dupes: THREE.Object3D[] = [];
  fbx.traverse((o) => {
    if ((o as THREE.Bone).isBone && isDuplicateBone(o) && !isDuplicateBone(o.parent!)) dupes.push(o);
  });
  for (const d of dupes) d.removeFromParent();

  // ---- normalise scale: bind-pose height → targetHeight, feet on y = 0
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  // The dropped hair cards stood ~2 cm proud of the skull; keep the old overall
  // proportions by measuring to the same crown height.
  const rawHeight = maxY + 2.2 - minY;
  const s = targetHeight / rawHeight;
  fbx.scale.setScalar(s);
  fbx.position.y = -minY * s;
  fbx.updateMatrixWorld(true);

  if (bodyMap) {
    bodyMap.colorSpace = THREE.SRGBColorSpace;
    bodyMap.anisotropy = 4;
  }

  let bones = 0;
  fbx.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones++;
  });

  return {
    root: fbx,
    geometry,
    boneNames,
    boneInverses,
    bodyMap,
    stats: {
      sourceMeshes: meshes.length,
      sourceBones,
      sourceVertices,
      sourceTriangles,
      bones,
      vertices: geometry.attributes.position.count,
      triangles: geometry.index ? geometry.index.count / 3 : 0,
      droppedTriangles,
    },
  };
}

/**
 * Instantiate one player from the template: a private copy of the 65-joint
 * hierarchy, ONE Skeleton, ONE SkinnedMesh. Geometry and inverse bind matrices are
 * shared with every other player.
 */
export function instantiatePlayerRig(tpl: PlayerRigTemplate, material: THREE.Material): PlayerRig {
  const root = tpl.root.clone(true) as THREE.Group;

  const byName = new Map<string, THREE.Bone>();
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone && !byName.has(o.name)) byName.set(o.name, o as THREE.Bone);
  });
  const bones = tpl.boneNames.map((n) => {
    const b = byName.get(n);
    if (!b) throw new Error(`player rig: joint "${n}" missing from cloned hierarchy`);
    return b;
  });

  const skeleton = new THREE.Skeleton(bones, tpl.boneInverses);
  const mesh = new THREE.SkinnedMesh(tpl.geometry, material);
  mesh.name = 'player-body';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  root.add(mesh);
  root.updateMatrixWorld(true);
  mesh.bind(skeleton, _identity);
  // SkinnedMesh keeps its own bounds (it ignores the geometry's for culling).
  mesh.boundingSphere = tpl.geometry.boundingSphere!.clone();
  mesh.boundingBox = tpl.geometry.boundingBox!.clone();

  return { root, mesh, skeleton };
}
