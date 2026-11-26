import * as THREE from 'three';
import { ENV_PARS, ROOF_SHADOW, STADIUM_LIGHT, envU } from './env';
import type { SeatList } from './bowl';
import { CFG } from '../config/constants';

/*
 * The crowd: one instanced draw call of upright impostor quads, one per
 * spectator, each individually coloured and animated entirely in the vertex
 * shader (no per-instance CPU work per frame).
 *
 * Why impostors and not instanced 3-D figures: from the broadcast camera a
 * spectator in the hero stand is ~8×10 px at 720p (12×16 at 1080p); a 2-triangle
 * card with a mip-mapped sprite is both cheaper (≈40 k triangles for ~20 k fans
 * instead of ≈500 k) and *more* stable than tiny geometry, because the sprite's
 * mip chain pre-filters what sub-pixel triangles would alias.
 *
 * Sprite atlas (generated on a canvas at boot): 4 poses × 2 body variants, with
 * channels R = shirt mask, G = skin mask, B = shading, A = coverage. The shader
 * composes shirt / skin / hair+trouser colours per instance from those masks.
 */

const CELL_W = 64;
const CELL_H = 128;
const POSES = 4;
const VARIANTS = 2;
/** World size of the sprite card. */
const CARD_W = 1.0;
const CARD_H = 2.0;

export function makeCrowdAtlas(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = CELL_W * POSES;
  c.height = CELL_H * VARIANTS;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, c.width, c.height);

  // metres → pixels inside a cell (feet at the bottom centre)
  const S = CELL_W / CARD_W;
  const shirt = (sh: number): string => `rgb(255,0,${Math.round(sh * 255)})`;
  const skin = (sh: number): string => `rgb(0,255,${Math.round(sh * 255)})`;
  const dark = (sh: number): string => `rgb(0,0,${Math.round(sh * 255)})`;

  for (let v = 0; v < VARIANTS; v++)
    for (let p = 0; p < POSES; p++) {
      const ox = p * CELL_W + CELL_W / 2;
      const oy = (v + 1) * CELL_H;
      const X = (m: number): number => ox + m * S;
      const Y = (m: number): number => oy - m * S;
      const rrect = (x0: number, y0: number, x1: number, y1: number, r: number, fill: string): void => {
        g.fillStyle = fill;
        g.beginPath();
        const px = X(x0),
          py = Y(y1),
          w = (x1 - x0) * S,
          h = (y1 - y0) * S;
        const rr = Math.min(r * S, w / 2, h / 2);
        g.moveTo(px + rr, py);
        g.arcTo(px + w, py, px + w, py + h, rr);
        g.arcTo(px + w, py + h, px, py + h, rr);
        g.arcTo(px, py + h, px, py, rr);
        g.arcTo(px, py, px + w, py, rr);
        g.fill();
      };
      const limb = (x0: number, y0: number, x1: number, y1: number, w: number, fill: string): void => {
        g.strokeStyle = fill;
        g.lineWidth = w * S;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(X(x0), Y(y0));
        g.lineTo(X(x1), Y(y1));
        g.stroke();
      };
      const disc = (x: number, y: number, r: number, fill: string): void => {
        g.fillStyle = fill;
        g.beginPath();
        g.arc(X(x), Y(y), r * S, 0, Math.PI * 2);
        g.fill();
      };
      const wide = v === 1 ? 1.1 : 1;
      const seated = p === 0;
      const hip = seated ? 0.5 : 0.92;
      const sh = seated ? 0.98 : 1.44; // shoulder line
      const headY = sh + 0.17;

      // legs
      if (seated) {
        rrect(-0.2 * wide, 0.0, 0.2 * wide, 0.5, 0.05, dark(0.16));
        rrect(-0.21 * wide, 0.4, 0.21 * wide, 0.58, 0.06, dark(0.24)); // lap
      } else {
        rrect(-0.19 * wide, 0.0, -0.02, hip + 0.04, 0.05, dark(0.2));
        rrect(0.02, 0.0, 0.19 * wide, hip + 0.04, 0.05, dark(0.16));
      }
      // torso (two-tone for a hint of form)
      rrect(-0.23 * wide, hip, 0.23 * wide, sh + 0.02, 0.09, shirt(0.72));
      rrect(-0.17 * wide, hip + 0.04, 0.2 * wide, sh + 0.02, 0.08, shirt(0.95));
      // arms
      const ax = 0.25 * wide;
      if (p === 0) {
        limb(-ax, sh - 0.05, -ax + 0.02, hip + 0.12, 0.1, shirt(0.7));
        limb(ax, sh - 0.05, ax - 0.02, hip + 0.12, 0.1, shirt(0.8));
        limb(-ax + 0.02, hip + 0.1, -0.06, hip + 0.06, 0.08, skin(0.8));
        limb(ax - 0.02, hip + 0.1, 0.06, hip + 0.06, 0.08, skin(0.9));
      } else if (p === 1) {
        // hands together in front (clapping)
        limb(-ax, sh - 0.05, -ax + 0.04, sh - 0.3, 0.1, shirt(0.7));
        limb(ax, sh - 0.05, ax - 0.04, sh - 0.3, 0.1, shirt(0.8));
        limb(-ax + 0.04, sh - 0.3, -0.03, sh - 0.18, 0.08, skin(0.85));
        limb(ax - 0.04, sh - 0.3, 0.03, sh - 0.18, 0.08, skin(0.95));
      } else if (p === 2) {
        // arms up in a V
        limb(-ax, sh - 0.04, -ax - 0.1, sh + 0.24, 0.1, shirt(0.75));
        limb(ax, sh - 0.04, ax + 0.1, sh + 0.24, 0.1, shirt(0.85));
        limb(-ax - 0.1, sh + 0.24, -ax - 0.14, sh + 0.5, 0.08, skin(0.9));
        limb(ax + 0.1, sh + 0.24, ax + 0.14, sh + 0.5, 0.08, skin(1.0));
        if (v === 1) limb(-ax - 0.14, sh + 0.5, ax + 0.14, sh + 0.5, 0.09, shirt(1.0)); // scarf held aloft
      } else {
        // arms straight up, fists together
        limb(-ax, sh - 0.04, -0.12, sh + 0.28, 0.1, shirt(0.75));
        limb(ax, sh - 0.04, 0.12, sh + 0.28, 0.1, shirt(0.85));
        limb(-0.12, sh + 0.28, -0.05, sh + 0.52, 0.08, skin(0.9));
        limb(0.12, sh + 0.28, 0.05, sh + 0.52, 0.08, skin(1.0));
        if (v === 1) limb(-0.2, sh + 0.54, 0.2, sh + 0.54, 0.09, shirt(1.0));
      }
      // neck + head + hair
      rrect(-0.05, sh, 0.05, sh + 0.08, 0.02, skin(0.7));
      disc(0, headY, 0.115, skin(0.95));
      // hair / cap: the top of the head
      g.save();
      g.beginPath();
      g.rect(X(-0.2), Y(headY + 0.2), 0.4 * S, 0.165 * S);
      g.clip();
      disc(0, headY + 0.012, 0.125, v === 1 && p % 2 === 0 ? shirt(0.8) : dark(0.3));
      g.restore();
    }

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace; // masks, not colour
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.premultiplyAlpha = false;
  t.anisotropy = 4;
  return t;
}

const VERT = /* glsl */ `
${ENV_PARS}
attribute vec3 aPos;
attribute vec4 aInfo; // yaw, team (0 home / 1 away), depth, seed
uniform vec3 uHome;
uniform vec3 uAway;
uniform vec2 uExcite;
uniform vec2 uGoalT;
uniform float uGoalX;
uniform float uBase;
uniform float uFlash;
varying vec2 vUv;
varying float vY;
varying vec3 vLight;
varying vec3 vShirt;
varying vec3 vSkin;
varying vec3 vDark;
varying float vFlash;
#include <fog_pars_vertex>
${ROOF_SHADOW}
${STADIUM_LIGHT}

void main() {
  float seed = aInfo.w;
  float r1 = fract( seed * 13.371 );
  float r2 = fract( seed * 71.137 );
  float r3 = fract( seed * 191.73 );
  float team = aInfo.y;

  // --- mood: baseline + own-team excitement + goal eruption wave ---
  float ex = mix( uExcite.x, uExcite.y, team );
  float tg = uTime - mix( uGoalT.x, uGoalT.y, team );
  vec2 goalPos = vec2( mix( uGoalX, -uGoalX, team ), 0.0 );
  float delay = length( aPos.xz - goalPos ) * 0.007 + r1 * 0.3;
  float tt = max( tg - delay, 0.0 );
  float e = smoothstep( 0.0, 0.25, tt ) * exp( -tt * 0.16 ) * step( 0.0, tg - delay );
  float mood = uBase + ex * 0.85 + e * 1.7 + ( r2 - 0.5 ) * 0.5;

  float standing = step( 0.46, mood );
  float cheering = step( 0.98, mood );
  float alt = step( 0.5, fract( uTime * ( 1.3 + r3 ) + r1 ) );
  float pose = mix( standing, 2.0 + alt, cheering );
  float variant = step( 0.5, r3 );

  // --- motion: idle sway, bounce while standing, big hops on a goal ---
  float amp = standing * ( 0.025 + 0.11 * ex + 0.30 * e );
  float hop = abs( sin( uTime * ( 4.2 + r3 * 2.6 ) + r1 * 6.283 ) ) * amp;
  float sway = sin( uTime * ( 0.7 + r2 * 0.9 ) + r1 * 6.283 ) * ( 0.012 + 0.03 * ex + 0.03 * e );
  float size = 0.93 + 0.14 * r2;

  vec2 q = position.xy; // x in [-0.5, 0.5], y in [0, 1]
  vec3 local = vec3( q.x * ${CARD_W.toFixed(2)} * size + sway * q.y, q.y * ${CARD_H.toFixed(2)} * size + hop, 0.0 );
  float cy = cos( aInfo.x );
  float sy = sin( aInfo.x );
  vec3 wp = aPos + vec3( local.x * cy, local.y, -local.x * sy );

  float mirror = step( 0.5, r1 ) * 2.0 - 1.0;
  vUv = ( vec2( pose, variant ) + vec2( 0.5 + q.x * mirror, q.y ) ) / vec2( ${POSES}.0, ${VARIANTS}.0 );
  vY = q.y;

  // --- colour ---
  vec3 teamCol = mix( uHome, uAway, team );
  vec3 pal = 0.32 + 0.28 * cos( 6.283 * ( r1 + vec3( 0.0, 0.33, 0.67 ) ) );
  vec3 neutral = mix( pal, vec3( 0.04 + 0.6 * r3 * r3 ), 0.55 );
  float fan = step( r2, 0.6 );
  vec3 fanCol = teamCol * ( 0.55 + 0.7 * r3 );
  fanCol = mix( fanCol, vec3( dot( fanCol, vec3( 0.33 ) ) ), 0.25 * r1 );
  fanCol = mix( fanCol, vec3( 0.8 ), step( 0.84, r1 ) * 0.85 ); // the odd white shirt / scarf
  vShirt = mix( neutral, fanCol, fan );
  vSkin = mix( vec3( 0.80, 0.56, 0.42 ), vec3( 0.20, 0.11, 0.07 ), r3 * r3 );
  vDark = mix( vec3( 0.02, 0.022, 0.03 ), vec3( 0.12, 0.10, 0.08 ), r1 );

  // --- light: per spectator (stand normal tilted up), roof shadow included ---
  vec3 n = normalize( vec3( sy * 0.72, 0.7, cy * 0.72 ) );
  vLight = stadiumLight( aPos + vec3( 0.0, 1.1, 0.0 ), n );
  // camera flashes: a few random fans pop white for a frame
  float fl = step( 0.9975, fract( seed * 37.7 + floor( uTime * 14.0 ) * 0.6180339 ) );
  vFlash = fl * uFlash;

  vec4 mvPosition = viewMatrix * vec4( wp, 1.0 );
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uAtlas;
varying vec2 vUv;
varying float vY;
varying vec3 vLight;
varying vec3 vShirt;
varying vec3 vSkin;
varying vec3 vDark;
varying float vFlash;
#include <fog_pars_fragment>
void main() {
  vec4 t = texture2D( uAtlas, vUv );
  float a = clamp( ( t.a - 0.5 ) / max( fwidth( t.a ), 1e-4 ) + 0.5, 0.0, 1.0 );
  if ( a < 0.25 ) discard;
  float inv = 1.0 / max( t.a, 1e-3 );
  float ms = min( 1.0, t.r * inv );
  float mk = min( 1.0, t.g * inv );
  float shade = min( 1.0, t.b * inv );
  float md = clamp( 1.0 - ms - mk, 0.0, 1.0 );
  vec3 base = ( vShirt * ms + vSkin * mk ) * shade + vDark * md * ( 0.4 + 2.0 * shade );
  // rows occlude each other: darken toward the feet
  base *= mix( 0.5, 1.0, smoothstep( 0.05, 0.55, vY ) );
  vec3 col = base * vLight + vec3( 1.6, 1.7, 1.9 ) * vFlash * smoothstep( 0.45, 0.8, vY );
  gl_FragColor = vec4( col, a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export class Crowd {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private mat: THREE.ShaderMaterial;
  private total: number;
  private atlas: THREE.CanvasTexture;
  /** Smoothed per-team excitement fed to the shader. */
  private excite = new THREE.Vector2(0, 0);

  constructor(seats: SeatList, density: number) {
    this.total = seats.count;
    // Shuffle (deterministically) so any prefix of the instance list is a uniform
    // subsample — density LOD is then just `instanceCount`.
    const order = new Uint32Array(seats.count);
    for (let i = 0; i < order.length; i++) order[i] = i;
    let s = 0x9e3779b9;
    const rnd = (): number => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return (s >>> 0) / 4294967296;
    };
    for (let i = order.length - 1; i > 0; i--) {
      const j = (rnd() * (i + 1)) | 0;
      const t = order[i];
      order[i] = order[j];
      order[j] = t;
    }
    const pos = new Float32Array(seats.count * 3);
    const info = new Float32Array(seats.count * 4);
    for (let i = 0; i < seats.count; i++) {
      const k = order[i];
      pos[i * 3] = seats.pos[k * 3];
      pos[i * 3 + 1] = seats.pos[k * 3 + 1];
      pos[i * 3 + 2] = seats.pos[k * 3 + 2];
      info[i * 4] = seats.data[k * 4];
      info[i * 4 + 1] = rnd() < seats.data[k * 4 + 1] ? 1 : 0;
      info[i * 4 + 2] = seats.data[k * 4 + 2];
      info[i * 4 + 3] = rnd();
    }

    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.setAttribute('aPos', new THREE.InstancedBufferAttribute(pos, 3));
    g.setAttribute('aInfo', new THREE.InstancedBufferAttribute(info, 4));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 10, 0), 120);
    this.geo = g;

    this.atlas = makeCrowdAtlas();
    this.mat = new THREE.ShaderMaterial({
      name: 'Crowd',
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        ...envU,
        uAtlas: { value: this.atlas },
        uHome: { value: new THREE.Color('#d8232a') },
        uAway: { value: new THREE.Color('#1e63d8') },
        uExcite: { value: this.excite },
        uGoalT: { value: new THREE.Vector2(-1000, -1000) },
        uGoalX: { value: CFG.halfL },
        uBase: { value: 0.12 },
        uFlash: { value: 0 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.DoubleSide,
      fog: true,
      alphaToCoverage: true,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.setDensity(density);
  }

  get count(): number {
    return this.geo.instanceCount;
  }
  get capacity(): number {
    return this.total;
  }

  setDensity(density: number): void {
    this.geo.instanceCount = Math.max(1, Math.floor(this.total * THREE.MathUtils.clamp(density, 0, 1)));
  }

  setAnisotropy(a: number): void {
    this.atlas.anisotropy = a;
    this.atlas.needsUpdate = true;
  }

  setColors(home: THREE.ColorRepresentation, away: THREE.ColorRepresentation): void {
    (this.mat.uniforms.uHome.value as THREE.Color).set(home);
    (this.mat.uniforms.uAway.value as THREE.Color).set(away);
  }

  /** A goal for `team` (0 home, 1 away): its fans erupt in a wave from that goal. */
  goal(team: 0 | 1): void {
    const v = this.mat.uniforms.uGoalT.value as THREE.Vector2;
    if (team === 0) v.x = envU.uTime.value;
    else v.y = envU.uTime.value;
    this.flash = 1;
  }

  private flash = 0;

  /**
   * @param threatHome  0..1 how dangerous the home attack is right now
   * @param threatAway  same for the away team
   * @param baseline    resting fraction of fans on their feet (0 menu … ~0.2 live)
   */
  update(dt: number, threatHome: number, threatAway: number, baseline: number): void {
    // fast attack, slow release — a crowd rises quickly and settles slowly
    const k = (cur: number, target: number): number => cur + (target - cur) * Math.min(1, dt * (target > cur ? 3.2 : 0.7));
    this.excite.x = k(this.excite.x, threatHome);
    this.excite.y = k(this.excite.y, threatAway);
    const u = this.mat.uniforms;
    u.uBase.value += (baseline - u.uBase.value) * Math.min(1, dt * 1.5);
    this.flash = Math.max(0, this.flash - dt * 0.18);
    u.uFlash.value = this.flash * envU.uFloodOn.value;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
    this.atlas.dispose();
  }
}
