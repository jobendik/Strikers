import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CFG } from '../config/constants';
import { envU } from './env';

/*
 * Goals: accurate frames + a simulated net.
 *
 * Frame: posts and crossbar are CFG.postR tubes centred exactly on the goal line
 * (x = ±halfL, z = ±goalHalf, bar at y = goalH) so what you see is what the sim
 * collides with. Box-net supports (top side bars, back uprights, back bar, ground
 * frame) hold the net out to x = ±(halfL + goalDepth).
 *
 * Net: a position-based (Verlet) cloth. Four panels — back, two sides, roof —
 * share particles along their seams; every panel border is pinned to the frame
 * and the interior hangs with ~4 % slack so it sags and billows like cord, not
 * like a rigid grid. Distance constraints only resist stretching (rope-like).
 *
 *  - `impulse()` kicks the particles around an impact point along the ball's
 *    velocity → the net bulges, the bulge travels outward as a ripple and settles.
 *  - `collideBall()` pushes particles out of the ball's sphere, so a ball resting
 *    in the net visibly holds a pocket in it.
 *  - The solver sleeps when the net is at rest: zero CPU and zero buffer uploads
 *    for the 99 % of frames in which nothing touches it.
 *
 * Cost when awake: ~1.5 k particles, ~5.6 k constraints × N iterations per net.
 */

const SEG_Z = 40; // across the goal width
const SEG_Y = 15; // up the height
const SEG_X = 12; // along the depth
/** Cloth tuning (see docs/RENDERING_DESIGN.md §Goals). */
export const NET = { slack: 1.03, stiff: 0.1, damp: 0.972, kick: 0.7, iterations: 3 };
const SUBSTEP = 1 / 90;
const MAX_SUBSTEPS = 5;

function makeNetTexture(): THREE.CanvasTexture {
  // One tile of a flat-top hexagonal mesh: 3a × √3a.
  const W = 192;
  const H = Math.round((W * Math.sqrt(3)) / 3); // ≈ 111
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, W, H);
  const a = W / 3;
  const hh = H / 2;
  g.strokeStyle = '#ffffff';
  g.lineWidth = 7;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const seg = (x0: number, y0: number, x1: number, y1: number): void => {
    for (let oy = -1; oy <= 1; oy++)
      for (let ox = -1; ox <= 1; ox++) {
        g.beginPath();
        g.moveTo(x0 + ox * W, y0 + oy * H);
        g.lineTo(x1 + ox * W, y1 + oy * H);
        g.stroke();
      }
  };
  // hexagon centred at (a, hh) with side a: vertices at angles 0,60,…
  const hx = (k: number): number => a + a * Math.cos((Math.PI / 3) * k);
  const hy = (k: number): number => hh + a * Math.sin((Math.PI / 3) * k);
  for (let k = 0; k < 6; k++) seg(hx(k), hy(k), hx(k + 1), hy(k + 1));
  // connectors to the neighbouring hexagons (centred at (2.5a, 0) / (2.5a, H))
  seg(hx(0), hy(0), hx(0) + a, hy(0));
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

const NET_VERT = /* glsl */ `
varying vec2 vUv;
varying float vStretch;
attribute float aStretch;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vStretch = aStretch;
  vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const NET_FRAG = /* glsl */ `
uniform sampler2D uTex;
uniform vec3 uColor;
varying vec2 vUv;
varying float vStretch;
#include <fog_pars_fragment>
void main() {
  float a = texture2D( uTex, vUv ).a;
  // far away the mip chain turns the mesh into a faint veil; keep it readable
  a = clamp( a * 1.9, 0.0, 1.0 );
  if ( a < 0.02 ) discard;
  vec3 col = uColor * ( 0.9 + 0.25 * vStretch );
  gl_FragColor = vec4( col, a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

class NetCloth {
  readonly mesh: THREE.Mesh;
  private n = 0;
  private pos: Float32Array;
  private prev: Float32Array;
  private rest: Float32Array;
  private inv: Float32Array; // inverse mass (0 = pinned)
  private cA: Uint16Array;
  private cB: Uint16Array;
  private cL: Float32Array;
  private map: Uint16Array; // render vertex → particle
  private posAttr: THREE.BufferAttribute;
  private stretchAttr: THREE.BufferAttribute;
  private awake = 0; // seconds of activity left before sleeping
  private acc = 0;
  private min = new THREE.Vector3();
  private max = new THREE.Vector3();

  constructor(
    private side: 1 | -1,
    material: THREE.Material,
  ) {
    const gx = side * CFG.halfL;
    const bx = side * (CFG.halfL + CFG.goalDepth);
    const w = CFG.goalHalf;
    const h = CFG.goalH;

    const key = (i: number, j: number, k: number): number => i * 10000 + j * 100 + k;
    const index = new Map<number, number>();
    const P: number[] = [];
    const pinned: number[] = [];
    const particle = (i: number, j: number, k: number): number => {
      const kk = key(i, j, k);
      const found = index.get(kk);
      if (found !== undefined) return found;
      const x = gx + ((bx - gx) * i) / SEG_X;
      const y = (h * j) / SEG_Y;
      const z = -w + (2 * w * k) / SEG_Z;
      const id = P.length / 3;
      P.push(x, y, z);
      // pinned: front frame, ground pegs, and the supported edges of the box
      const onEdgeX = i === 0 || i === SEG_X;
      const onEdgeY = j === 0 || j === SEG_Y;
      const onEdgeZ = k === 0 || k === SEG_Z;
      const pin = i === 0 || j === 0 || (onEdgeX && onEdgeY) || (onEdgeX && onEdgeZ) || (onEdgeY && onEdgeZ);
      pinned.push(pin ? 1 : 0);
      index.set(kk, id);
      return id;
    };

    const rPos: number[] = [];
    const rUv: number[] = [];
    const rMap: number[] = [];
    const rIdx: number[] = [];
    const cons = new Map<number, [number, number]>();
    const link = (a: number, b: number): void => {
      if (a === b) return;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      cons.set(lo * 65536 + hi, [lo, hi]);
    };
    const tile = 0.2; // metres per texture tile (u); v tile follows the hex aspect
    const tileV = (tile * Math.sqrt(3)) / 3;

    // generic panel: (a, b) grid → lattice (i, j, k) + uv in metres
    const panel = (na: number, nb: number, f: (a: number, b: number) => [number, number, number], lenA: number, lenB: number): void => {
      const base = rMap.length;
      for (let b = 0; b <= nb; b++)
        for (let a = 0; a <= na; a++) {
          const [i, j, k] = f(a, b);
          const id = particle(i, j, k);
          rMap.push(id);
          rPos.push(P[id * 3], P[id * 3 + 1], P[id * 3 + 2]);
          rUv.push(((a / na) * lenA) / tile, ((b / nb) * lenB) / tileV);
        }
      const at = (a: number, b: number): number => base + b * (na + 1) + a;
      for (let b = 0; b < nb; b++)
        for (let a = 0; a < na; a++) {
          rIdx.push(at(a, b), at(a + 1, b), at(a + 1, b + 1), at(a, b), at(a + 1, b + 1), at(a, b + 1));
        }
      for (let b = 0; b <= nb; b++)
        for (let a = 0; a <= na; a++) {
          const p = rMap[at(a, b)];
          if (a < na) link(p, rMap[at(a + 1, b)]);
          if (b < nb) link(p, rMap[at(a, b + 1)]);
          // shear links keep the mesh from collapsing into a line
          if (a < na && b < nb) {
            link(p, rMap[at(a + 1, b + 1)]);
            link(rMap[at(a + 1, b)], rMap[at(a, b + 1)]);
          }
        }
    };
    panel(SEG_Z, SEG_Y, (a, b) => [SEG_X, b, a], 2 * w, h); // back
    panel(SEG_X, SEG_Y, (a, b) => [a, b, 0], CFG.goalDepth, h); // side −z
    panel(SEG_X, SEG_Y, (a, b) => [a, b, SEG_Z], CFG.goalDepth, h); // side +z
    panel(SEG_Z, SEG_X, (a, b) => [b, SEG_Y, a], 2 * w, CFG.goalDepth); // roof

    this.n = P.length / 3;
    this.pos = new Float32Array(P);
    this.prev = new Float32Array(P);
    this.rest = new Float32Array(P);
    this.inv = new Float32Array(this.n);
    for (let i = 0; i < this.n; i++) this.inv[i] = pinned[i] ? 0 : 1;
    const list = [...cons.values()].filter(([a, b]) => !(pinned[a] && pinned[b]));
    this.cA = new Uint16Array(list.length);
    this.cB = new Uint16Array(list.length);
    this.cL = new Float32Array(list.length);
    list.forEach(([a, b], i) => {
      this.cA[i] = a;
      this.cB[i] = b;
      const dx = P[a * 3] - P[b * 3];
      const dy = P[a * 3 + 1] - P[b * 3 + 1];
      const dz = P[a * 3 + 2] - P[b * 3 + 2];
      this.cL[i] = Math.hypot(dx, dy, dz) * NET.slack;
    });
    this.map = new Uint16Array(rMap);

    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(rPos), 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.stretchAttr = new THREE.BufferAttribute(new Float32Array(rMap.length), 1);
    this.stretchAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(rUv, 2));
    geo.setAttribute('aStretch', this.stretchAttr);
    geo.setIndex(rIdx);
    const cx = (gx + bx) / 2;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, h / 2, 0), w + 2.5);
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = 3;
    this.mesh.name = `net${side > 0 ? 'R' : 'L'}`;

    this.min.set(Math.min(gx, bx) - 1.2, -0.2, -w - 1.2);
    this.max.set(Math.max(gx, bx) + 1.2, h + 1.2, w + 1.2);

    // let the slack settle into its hanging shape before the first frame
    this.awake = 1;
    for (let i = 0; i < 160; i++) this.step(NET.iterations);
    this.rest.set(this.pos);
    this.prev.set(this.pos);
    this.upload();
    this.awake = 0;
  }

  get triangles(): number {
    return (this.mesh.geometry.index?.count ?? 0) / 3;
  }

  /** Kick the net around world point (x, y, z) along (dx, dy, dz) at `speed` m/s. */
  impulse(x: number, y: number, z: number, dx: number, dy: number, dz: number, speed: number, radius = 0.95): void {
    const l = Math.hypot(dx, dy, dz);
    if (l < 1e-4) {
      dx = this.side;
      dy = 0;
      dz = 0;
    } else {
      dx /= l;
      dy /= l;
      dz /= l;
    }
    const kick = Math.min(Math.max(speed, 1.5), 36) * NET.kick * SUBSTEP;
    const r2 = radius * radius;
    const { pos, prev, inv } = this;
    for (let i = 0; i < this.n; i++) {
      if (inv[i] === 0) continue;
      const ex = pos[i * 3] - x;
      const ey = pos[i * 3 + 1] - y;
      const ez = pos[i * 3 + 2] - z;
      const d2 = ex * ex + ey * ey + ez * ez;
      if (d2 > r2 * 4) continue;
      const f = Math.exp(-d2 / (r2 * 0.5)) * kick;
      prev[i * 3] -= dx * f;
      prev[i * 3 + 1] -= dy * f;
      prev[i * 3 + 2] -= dz * f;
    }
    this.awake = 3;
  }

  private ballActive = false;
  private bx = 0;
  private by = 0;
  private bz = 0;
  private br = 0;

  /** Report the ball position each frame; near the goal it becomes a collider. */
  setBall(x: number, y: number, z: number, r: number): void {
    const near = x > this.min.x && x < this.max.x && y < this.max.y && z > this.min.z && z < this.max.z;
    this.ballActive = near;
    if (!near) return;
    // only wake when the ball actually moved (a ball at rest in the net lets it sleep)
    if (Math.abs(x - this.bx) + Math.abs(y - this.by) + Math.abs(z - this.bz) > 0.004) this.awake = Math.max(this.awake, 1.2);
    this.bx = x;
    this.by = y;
    this.bz = z;
    this.br = r + 0.035;
  }

  update(dt: number): void {
    if (this.awake <= 0) return;
    this.awake -= dt;
    this.acc = Math.min(this.acc + dt, SUBSTEP * MAX_SUBSTEPS);
    while (this.acc >= SUBSTEP) {
      this.acc -= SUBSTEP;
      this.step(NET.iterations);
    }
    this.upload();
    if (this.awake <= 0) {
      // came to rest: snap velocities to zero so it stays asleep cleanly
      this.prev.set(this.pos);
    }
  }

  private step(iterations: number): void {
    const { pos, prev, inv, cA, cB, cL, n } = this;
    const g = -9.8 * SUBSTEP * SUBSTEP;
    const damp = NET.damp;
    for (let i = 0; i < n; i++) {
      if (inv[i] === 0) continue;
      const o = i * 3;
      const vx = (pos[o] - prev[o]) * damp;
      const vy = (pos[o + 1] - prev[o + 1]) * damp;
      const vz = (pos[o + 2] - prev[o + 2]) * damp;
      prev[o] = pos[o];
      prev[o + 1] = pos[o + 1];
      prev[o + 2] = pos[o + 2];
      pos[o] += vx;
      pos[o + 1] += vy + g;
      pos[o + 2] += vz;
      if (pos[o + 1] < 0.01) pos[o + 1] = 0.01; // the turf
    }
    const m = cA.length;
    for (let it = 0; it < iterations; it++) {
      for (let c = 0; c < m; c++) {
        const a = cA[c] * 3;
        const b = cB[c] * 3;
        const dx = pos[b] - pos[a];
        const dy = pos[b + 1] - pos[a + 1];
        const dz = pos[b + 2] - pos[a + 2];
        const d2 = dx * dx + dy * dy + dz * dz;
        const L = cL[c];
        if (d2 <= L * L) continue; // cord: no resistance to slack
        const d = Math.sqrt(d2);
        const wa = inv[cA[c]];
        const wb = inv[cB[c]];
        const k = ((d - L) / d / (wa + wb)) * NET.stiff;
        pos[a] += dx * k * wa;
        pos[a + 1] += dy * k * wa;
        pos[a + 2] += dz * k * wa;
        pos[b] -= dx * k * wb;
        pos[b + 1] -= dy * k * wb;
        pos[b + 2] -= dz * k * wb;
      }
      if (this.ballActive) {
        const r = this.br;
        const r2 = r * r;
        for (let i = 0; i < n; i++) {
          if (inv[i] === 0) continue;
          const o = i * 3;
          const ex = pos[o] - this.bx;
          const ey = pos[o + 1] - this.by;
          const ez = pos[o + 2] - this.bz;
          const d2 = ex * ex + ey * ey + ez * ez;
          if (d2 >= r2 || d2 < 1e-8) continue;
          const s = r / Math.sqrt(d2);
          pos[o] = this.bx + ex * s;
          pos[o + 1] = this.by + ey * s;
          pos[o + 2] = this.bz + ez * s;
        }
      }
    }
  }

  private upload(): void {
    const arr = this.posAttr.array as Float32Array;
    const st = this.stretchAttr.array as Float32Array;
    const { pos, rest, map } = this;
    for (let v = 0; v < map.length; v++) {
      const p = map[v] * 3;
      arr[v * 3] = pos[p];
      arr[v * 3 + 1] = pos[p + 1];
      arr[v * 3 + 2] = pos[p + 2];
      const dx = pos[p] - rest[p];
      const dy = pos[p + 1] - rest[p + 1];
      const dz = pos[p + 2] - rest[p + 2];
      st[v] = Math.min(1, Math.sqrt(dx * dx + dy * dy + dz * dz) * 2.2);
    }
    this.posAttr.needsUpdate = true;
    this.stretchAttr.needsUpdate = true;
  }
}

function tube(a: THREE.Vector3, b: THREE.Vector3, r: number, radial = 12): THREE.BufferGeometry {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r, r, len, radial, 1, false);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

export class Goals {
  readonly group = new THREE.Group();
  private nets: [NetCloth, NetCloth];
  private netMat: THREE.ShaderMaterial;
  private frameMat: THREE.MeshStandardMaterial;

  constructor() {
    const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
    const w = CFG.goalHalf;
    const h = CFG.goalH;
    const r = CFG.postR;
    const main: THREE.BufferGeometry[] = [];
    for (const side of [-1, 1]) {
      const gx = side * CFG.halfL;
      const bx = side * (CFG.halfL + CFG.goalDepth);
      // posts + crossbar (slightly long so the corners close)
      main.push(tube(V(gx, 0, -w), V(gx, h + r, -w), r, 16));
      main.push(tube(V(gx, 0, w), V(gx, h + r, w), r, 16));
      main.push(tube(V(gx, h, -w - r), V(gx, h, w + r), r, 16));
      // box-net supports
      const s = 0.032;
      for (const z of [-w, w]) {
        main.push(tube(V(gx, h, z), V(bx, h, z), s, 8));
        main.push(tube(V(bx, 0, z), V(bx, h + s, z), s, 8));
        main.push(tube(V(gx, 0.03, z), V(bx, 0.03, z), s, 8));
      }
      main.push(tube(V(bx, h, -w), V(bx, h, w), s * 0.8, 8));
      main.push(tube(V(bx, 0.03, -w), V(bx, 0.03, w), s, 8));
    }
    const frameGeo = mergeGeometries(main, false)!;
    main.forEach((g) => g.dispose());
    this.frameMat = new THREE.MeshStandardMaterial({ color: '#f6f7f8', roughness: 0.32, metalness: 0.0, envMapIntensity: 0.9 });
    this.frameMat.name = 'GoalFrame';
    const frame = new THREE.Mesh(frameGeo, this.frameMat);
    frame.castShadow = true;
    frame.receiveShadow = true;
    frame.matrixAutoUpdate = false;
    frame.name = 'goalFrames';
    this.group.add(frame);

    this.netMat = new THREE.ShaderMaterial({
      name: 'GoalNet',
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        uTex: { value: makeNetTexture() },
        uColor: { value: new THREE.Color(1, 1, 1) },
      },
      vertexShader: NET_VERT,
      fragmentShader: NET_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    });
    this.nets = [new NetCloth(-1, this.netMat), new NetCloth(1, this.netMat)];
    this.group.add(this.nets[0].mesh, this.nets[1].mesh);
  }

  get triangles(): number {
    return this.nets[0].triangles + this.nets[1].triangles;
  }

  /** Net brightness follows the preset (it is drawn unlit). */
  setLight(color: THREE.Color): void {
    (this.netMat.uniforms.uColor.value as THREE.Color).copy(color);
  }

  /** Ball (or anything) hit the net of goal `side` at a world position with a velocity. */
  hit(side: 1 | -1, x: number, y: number, z: number, vx: number, vy: number, vz: number, speed: number): void {
    const net = this.nets[side > 0 ? 1 : 0];
    // keep the impact inside the goal volume so a slightly-late event still lands on the mesh
    const x0 = side * CFG.halfL;
    const x1 = side * (CFG.halfL + CFG.goalDepth);
    const cx = THREE.MathUtils.clamp(x, Math.min(x0, x1), Math.max(x0, x1));
    const cy = THREE.MathUtils.clamp(y, 0, CFG.goalH);
    const cz = THREE.MathUtils.clamp(z, -CFG.goalHalf, CFG.goalHalf);
    net.impulse(cx, cy, cz, vx, vy, vz, speed);
  }

  /** Push the back of the net outward at (y, z). */
  push(side: 1 | -1, y: number, z: number, strength: number): void {
    const net = this.nets[side > 0 ? 1 : 0];
    net.impulse(side * (CFG.halfL + CFG.goalDepth), y, z, side, 0, 0, strength);
  }

  update(dt: number, ballX: number, ballY: number, ballZ: number, ballLive: boolean): void {
    for (const net of this.nets) {
      if (ballLive) net.setBall(ballX, ballY, ballZ, CFG.ballR);
      net.update(dt);
    }
  }
}

/** Approximate radiance of a white, unlit object under the active preset. */
export function unlitWhite(out: THREE.Color): THREE.Color {
  out.copy(envU.uAmbSky.value).multiplyScalar(0.7).add(envU.uSunRad.value.clone().multiplyScalar(0.55)).add(envU.uFlood.value.clone().multiplyScalar(1.6));
  return out;
}
