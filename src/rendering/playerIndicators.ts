/**
 * playerIndicators.ts — the "you control this player" marker and the
 * "this team-mate is calling for a pass" cue.
 *
 * Both follow the same recipe so they read at a glance from the broadcast camera:
 *   - a ground decal under the player (bright core, dark keyline so it holds on
 *     light AND dark turf stripes), and
 *   - a camera-facing marker floating above the head, drawn on top of everything,
 *     that never shrinks below a minimum on-screen size.
 *
 * Contract with the game (game/render.ts):
 *   ring — a Mesh; the game toggles `.visible`. The overhead chevron is a CHILD of
 *          the ring, so hiding the ring hides the whole indicator.
 *   call — a Mesh; the game toggles `.visible`, calls `.scale.setScalar(s)` and
 *          writes `.material.opacity`. Its overhead marker is a child and copies
 *          the opacity each frame.
 * Textures, geometry and materials are shared; nothing allocates per frame.
 */

import * as THREE from 'three';
import { colorDistance } from '../config/kits';

/** Candidate marker colours; the one furthest from the player's shirt is used. */
const RING_COLORS = ['#ffe23d', '#ffffff', '#3df2ff'] as const;
const CALL_COLOR = '#b8ff3a';

const RING_SIZE = 2.1; // m, outer extent of the ground decal
const CALL_SIZE = 2.7;
const HEAD_Y = 2.28; // m above the turf for the overhead marker
/** Overhead markers never get smaller than this fraction of the viewport height. */
const MIN_SCREEN_FRAC = 0.03;

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!];
}

function toTexture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Selected-player decal: a segmented ring, a soft inner glow and a facing tick. */
function drawRingTexture(): THREE.CanvasTexture {
  const S = 256;
  const [c, x] = canvas(S);
  const m = S / 2;
  // soft pool of light under the player
  const g = x.createRadialGradient(m, m, S * 0.1, m, m, S * 0.4);
  g.addColorStop(0, 'rgba(255,255,255,0.0)');
  g.addColorStop(0.75, 'rgba(255,255,255,0.14)');
  g.addColorStop(1, 'rgba(255,255,255,0.0)');
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);

  const arc = (r: number, w: number, style: string): void => {
    x.strokeStyle = style;
    x.lineWidth = w;
    x.lineCap = 'butt';
    // three segments with gaps; the gap at the bottom (= the player's front) holds the tick
    const gap = 0.2;
    for (let k = 0; k < 3; k++) {
      const a0 = Math.PI / 2 + gap + (k * Math.PI * 2) / 3;
      const a1 = Math.PI / 2 - gap + ((k + 1) * Math.PI * 2) / 3;
      x.beginPath();
      x.arc(m, m, r, a0, a1);
      x.stroke();
    }
  };
  arc(S * 0.385, S * 0.105, 'rgba(6,10,16,0.62)'); // keyline
  arc(S * 0.385, S * 0.062, '#ffffff'); // core

  // facing tick: a small arrowhead in the front gap (canvas bottom = model +Z)
  const tick = (grow: number, style: string): void => {
    x.fillStyle = style;
    x.beginPath();
    x.moveTo(m, S * 0.985 + grow * 0.4);
    x.lineTo(m - S * 0.075 - grow, S * 0.845 - grow);
    x.lineTo(m + S * 0.075 + grow, S * 0.845 - grow);
    x.closePath();
    x.fill();
  };
  tick(5, 'rgba(6,10,16,0.62)');
  tick(0, '#ffffff');
  return toTexture(c);
}

/** Pass-call decal: a thin double ring that the game pulses outward. */
function drawCallTexture(): THREE.CanvasTexture {
  const S = 256;
  const [c, x] = canvas(S);
  const m = S / 2;
  const ring = (r: number, w: number, style: string, dash: number[]): void => {
    x.strokeStyle = style;
    x.lineWidth = w;
    x.setLineDash(dash);
    x.beginPath();
    x.arc(m, m, r, 0, Math.PI * 2);
    x.stroke();
  };
  ring(S * 0.43, S * 0.07, 'rgba(6,10,16,0.5)', []);
  ring(S * 0.43, S * 0.04, '#ffffff', []);
  ring(S * 0.33, S * 0.022, 'rgba(255,255,255,0.85)', [S * 0.05, S * 0.045]);
  return toTexture(c);
}

/** Overhead marker: a solid downward chevron with a dark keyline. */
function drawChevronTexture(double: boolean): THREE.CanvasTexture {
  const S = 128;
  const [c, x] = canvas(S);
  const tri = (y0: number, y1: number, half: number): void => {
    x.beginPath();
    x.moveTo(S / 2 - half, y0);
    x.lineTo(S / 2 + half, y0);
    x.lineTo(S / 2, y1);
    x.closePath();
  };
  x.lineJoin = 'round';
  const draw = (y0: number, y1: number, half: number): void => {
    tri(y0, y1, half);
    x.strokeStyle = 'rgba(6,10,16,0.85)';
    x.lineWidth = S * 0.13;
    x.stroke();
    tri(y0, y1, half);
    x.fillStyle = '#ffffff';
    x.fill();
  };
  if (double) {
    draw(S * 0.14, S * 0.5, S * 0.3);
    draw(S * 0.52, S * 0.88, S * 0.3);
  } else {
    draw(S * 0.2, S * 0.84, S * 0.36);
  }
  return toTexture(c);
}

let _shared: {
  ringGeo: THREE.PlaneGeometry;
  callGeo: THREE.PlaneGeometry;
  ringTex: THREE.CanvasTexture;
  chevTex: THREE.CanvasTexture;
  ringMats: Map<string, THREE.MeshBasicMaterial>;
  chevMats: Map<string, THREE.SpriteMaterial>;
  callMat: THREE.MeshBasicMaterial;
  callChevMat: THREE.SpriteMaterial;
} | null = null;

function shared(): NonNullable<typeof _shared> {
  if (_shared) return _shared;
  const ringTex = drawRingTexture();
  const chevTex = drawChevronTexture(false);
  const ringMats = new Map<string, THREE.MeshBasicMaterial>();
  const chevMats = new Map<string, THREE.SpriteMaterial>();
  for (const col of RING_COLORS) {
    ringMats.set(
      col,
      new THREE.MeshBasicMaterial({ map: ringTex, color: col, transparent: true, depthWrite: false, toneMapped: false, fog: false }),
    );
    chevMats.set(
      col,
      new THREE.SpriteMaterial({ map: chevTex, color: col, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false }),
    );
  }
  _shared = {
    ringGeo: new THREE.PlaneGeometry(RING_SIZE, RING_SIZE),
    callGeo: new THREE.PlaneGeometry(CALL_SIZE, CALL_SIZE),
    ringTex,
    chevTex,
    ringMats,
    chevMats,
    callMat: new THREE.MeshBasicMaterial({
      map: drawCallTexture(),
      color: CALL_COLOR,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    }),
    callChevMat: new THREE.SpriteMaterial({
      map: drawChevronTexture(true),
      color: CALL_COLOR,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    }),
  };
  return _shared;
}

const _wp = new THREE.Vector3();

/**
 * An overhead, camera-facing marker. Parented to a ground decal that lies flat
 * (rotated −90° about X), so the decal's local +Z is world up.
 */
function makeOverhead(mat: THREE.SpriteMaterial, worldSize: number, bob: number, follow?: THREE.Material): THREE.Sprite {
  const s = new THREE.Sprite(mat);
  s.position.set(0, 0, HEAD_Y);
  s.scale.setScalar(worldSize);
  s.renderOrder = 20;
  s.onBeforeRender = (_r, _s, camera) => {
    // keep a minimum on-screen size (takes effect next frame — imperceptible)
    const cam = camera as THREE.PerspectiveCamera;
    _wp.setFromMatrixPosition(s.matrixWorld);
    const d = _wp.distanceTo(cam.position);
    const minWorld = cam.isPerspectiveCamera ? 2 * d * Math.tan((cam.fov * Math.PI) / 360) * MIN_SCREEN_FRAC : 0;
    const parentScale = s.parent ? s.parent.scale.x || 1 : 1;
    s.scale.setScalar(Math.max(worldSize, minWorld) / parentScale);
    s.position.z = (HEAD_Y + Math.sin(performance.now() * 0.006) * bob) / parentScale;
    if (follow) mat.opacity = Math.min(1, follow.opacity * 1.25);
  };
  return s;
}

export interface PlayerIndicators {
  ring: THREE.Mesh;
  call: THREE.Mesh;
  /** Re-pick the selected-player colour so it contrasts with this player's shirt. */
  setKitColor(shirt: string): void;
}

export function makePlayerIndicators(): PlayerIndicators {
  const sh = shared();

  const ring = new THREE.Mesh(sh.ringGeo, sh.ringMats.get(RING_COLORS[0])!);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.035;
  ring.renderOrder = 3;
  ring.visible = false;
  const chevron = makeOverhead(sh.chevMats.get(RING_COLORS[0])!, 0.5, 0.06);
  ring.add(chevron);

  const call = new THREE.Mesh(sh.callGeo, sh.callMat);
  call.rotation.x = -Math.PI / 2;
  call.position.y = 0.045;
  call.renderOrder = 2;
  call.visible = false;
  call.add(makeOverhead(sh.callChevMat, 0.46, 0.1, sh.callMat));

  return {
    ring,
    call,
    setKitColor(shirt: string): void {
      let best: string = RING_COLORS[0];
      let bestD = -1;
      for (const c of RING_COLORS) {
        // mild bias toward the signature gold so it only changes on a real clash
        const d = colorDistance(c, shirt) + (c === RING_COLORS[0] ? 0.12 : 0);
        if (d > bestD) {
          bestD = d;
          best = c;
        }
      }
      ring.material = sh.ringMats.get(best)!;
      chevron.material = sh.chevMats.get(best)!;
    },
  };
}
