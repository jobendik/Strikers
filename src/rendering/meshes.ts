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

/** Builds the soccer ball with a procedurally painted pentagon texture + bump. */
export function makeBallMesh(): THREE.Mesh {
  const SZ = 256;
  // Colour canvas: clean off-white leather with crisp dark pentagons.
  const c = document.createElement('canvas');
  c.width = c.height = SZ;
  const x = c.getContext('2d')!;
  // Bump canvas: mid-grey field with darker seams = subtle panel relief.
  const bc = document.createElement('canvas');
  bc.width = bc.height = SZ;
  const bx = bc.getContext('2d')!;

  x.fillStyle = '#eef2f8';
  x.fillRect(0, 0, SZ, SZ);
  bx.fillStyle = '#808080';
  bx.fillRect(0, 0, SZ, SZ);

  const pentagon = (cx: number, cy: number, r: number, rot: number): Path2D => {
    const p = new Path2D();
    for (let k = 0; k < 5; k++) {
      const a = rot + (k / 5) * Math.PI * 2;
      const px = cx + Math.cos(a) * r;
      const py = cy + Math.sin(a) * r;
      k === 0 ? p.moveTo(px, py) : p.lineTo(px, py);
    }
    p.closePath();
    return p;
  };

  // A tidy scatter of pentagons (a true ball UV is overkill at this size).
  x.lineJoin = bx.lineJoin = 'round';
  for (let i = 0; i < 11; i++) {
    const cx = rand(20, SZ - 20);
    const cy = rand(20, SZ - 20);
    const r = rand(16, 24);
    const rot = rand(0, 6.28);
    const path = pentagon(cx, cy, r, rot);
    x.fillStyle = '#12171f';
    x.fill(path);
    // groove seam in the bump map around every panel
    bx.strokeStyle = '#3a3a3a';
    bx.lineWidth = 4;
    bx.stroke(path);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const bump = new THREE.CanvasTexture(bc);
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(CFG.ballR, 28, 20),
    new THREE.MeshStandardMaterial({
      map: tex,
      bumpMap: bump,
      bumpScale: 0.015,
      roughness: 0.42,
      metalness: 0.0,
      envMapIntensity: 0.6,
    }),
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
 * Shared material sets, keyed by kit colour. THREE's clone (used by
 * SkeletonUtils) copies material *references*, so without this every player would
 * share — and fight over — the template's materials (the last colour applied
 * would win for everyone). We instead clone the template's materials once per
 * distinct colour and hand the same set to every player wearing it. Two upsides:
 *   1) correct, stable per-team colours;
 *   2) far fewer unique materials on screen (≈ colours × slots, not players ×
 *      slots) — a real draw-call/state-change saving on mobile GPUs.
 * Only materials tagged `userData.tintable` (the kit — not skin/boots, see
 * playerLoader.prepareMaterial) receive the team colour.
 */
interface MatSet {
  byName: Map<string, THREE.Material>;
}
const _matSets = new Map<string, MatSet>();

function buildMatSet(color: string): MatSet {
  const { template } = getPlayerModelData();
  const byName = new Map<string, THREE.Material>();
  template.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh || obj instanceof THREE.SkinnedMesh)) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) {
      if (!m || byName.has(m.name)) continue;
      const c = m.clone();
      if (m.userData.tintable && (c as THREE.MeshStandardMaterial).color) {
        (c as THREE.MeshStandardMaterial).color.set(color);
      }
      byName.set(m.name, c);
    }
  });
  return { byName };
}

function getMatSet(color: string): MatSet {
  let s = _matSets.get(color);
  if (!s) {
    s = buildMatSet(color);
    _matSets.set(color, s);
  }
  return s;
}

/** Point every mesh in a clone at the shared material set for `color`. */
function bindColor(modelClone: THREE.Object3D, color: string): void {
  const set = getMatSet(color);
  const pick = (m: THREE.Material): THREE.Material => set.byName.get(m.name) ?? m;
  modelClone.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh || obj instanceof THREE.SkinnedMesh)) return;
    obj.material = Array.isArray(obj.material) ? obj.material.map(pick) : pick(obj.material);
  });
}

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
  // Re-skinning just rebinds the clone to the shared material set for the new
  // colour, so only the kit changes — skin and boots keep their own colours.
  g.userData.body = {
    material: {
      color: {
        set(c: string): void {
          bindColor(modelClone, c);
        },
      },
    },
  };
  // Apply the initial jersey colour immediately.
  bindColor(modelClone, jerseyColor);

  // ----- overlay elements (game-unit scale — unaffected by the model scale) -----

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

  // Contact shadow blob — a cheap fallback that grounds the player in the `lite`
  // tier where real shadows are off. Hidden each frame when the shadow map is
  // enabled (see render.syncMeshes) so we never double up real + fake shadows.
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.5, 18),
    new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.26 }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  g.add(shadow);

  g.userData.ring = ring;
  g.userData.call = call;
  g.userData.blob = shadow;

  // ----- animation mixer -----
  const mixer = new THREE.AnimationMixer(modelClone);
  const idleAction = mixer.clipAction(clips.idle);
  idleAction.setLoop(THREE.LoopRepeat, Infinity).play();

  const animState: PlayerAnimState = {
    current: 'idle',
    action: idleAction,
    prevKickCd: 0,
    accum: 0,
  };

  g.userData.mixer = mixer;
  g.userData.clips = clips as Record<AnimName, THREE.AnimationClip>;
  g.userData.animState = animState;

  world.add(g);
  return g;
}
