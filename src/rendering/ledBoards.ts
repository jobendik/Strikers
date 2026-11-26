import * as THREE from 'three';
import { CFG } from '../config/constants';
import { ENV_PARS, envU } from './env';
import { GeoBuilder, v3, type P3 } from './geo';
import { LAYOUT, SECTIONS, roofY, type Section } from './layout';

/*
 * LED surfaces: the perimeter advertising boards, the ribbon display on the
 * fascia between the tiers, and the two end scoreboards.
 *
 * All advertising content is ORIGINAL and fictional, drawn on a canvas at boot
 * (one atlas, 8 strips). The boards are a single merged mesh whose shader scrolls
 * the active strip, cross-wipes to the next brand every few seconds (all boards
 * in sync, like a real perimeter system), draws the LED pixel structure when the
 * camera is close enough to resolve it, and takes over with a team-coloured
 * "GOAL" animation on the goal event.
 */

const ROWS = 8;
const BRAND_ROWS = 6;
const ROW_RIBBON = 6;
const ROW_GOAL = 7;

interface Brand {
  name: string;
  tag: string;
  bg0: string;
  bg1: string;
  fg: string;
  accent: string;
  mark: 'bolt' | 'ring' | 'chevrons' | 'drop' | 'pixels' | 'wing';
}

/** Fictional sponsors — invented for this game; no real marks or logos. */
const BRANDS: Brand[] = [
  { name: "STRIKERS '26", tag: 'WORLD CHAMPIONSHIP', bg0: '#04130a', bg1: '#0a2a14', fg: '#5dff3a', accent: '#ffffff', mark: 'bolt' },
  { name: 'VELOQA', tag: 'ELECTRIC MOTION', bg0: '#0b2fbf', bg1: '#1247ff', fg: '#ffffff', accent: '#7fe3ff', mark: 'chevrons' },
  { name: 'BRIZZO', tag: 'SPARKLING CITRUS', bg0: '#ffd21a', bg1: '#ffb300', fg: '#1a1400', accent: '#e8380d', mark: 'drop' },
  { name: 'TELLURA', tag: 'POWER FROM THE WIND', bg0: '#046b62', bg1: '#0aa392', fg: '#ffffff', accent: '#c8ff5e', mark: 'ring' },
  { name: 'PYXEL PLAY', tag: 'GAME ON · EVERYWHERE', bg0: '#5a12b8', bg1: '#b0189e', fg: '#ffffff', accent: '#ffe14a', mark: 'pixels' },
  { name: 'ZEPHRA', tag: 'AIRWAYS OF THE NORTH', bg0: '#c4121f', bg1: '#ef2b2b', fg: '#ffffff', accent: '#ffd9d9', mark: 'wing' },
];

const FONT = '"Arial Black", "Helvetica Neue", Impact, Arial, sans-serif';

function drawMark(g: CanvasRenderingContext2D, kind: Brand['mark'], x: number, cy: number, s: number, col: string, accent: string): void {
  g.save();
  g.translate(x, cy);
  g.fillStyle = col;
  g.strokeStyle = col;
  g.lineWidth = s * 0.14;
  g.lineJoin = 'round';
  switch (kind) {
    case 'bolt':
      g.beginPath();
      g.moveTo(s * 0.15, -s * 0.5);
      g.lineTo(-s * 0.3, s * 0.08);
      g.lineTo(-s * 0.02, s * 0.08);
      g.lineTo(-s * 0.18, s * 0.5);
      g.lineTo(s * 0.32, -s * 0.12);
      g.lineTo(s * 0.04, -s * 0.12);
      g.closePath();
      g.fill();
      break;
    case 'ring':
      g.beginPath();
      g.arc(0, 0, s * 0.36, 0.5, Math.PI * 2 - 0.5);
      g.stroke();
      g.fillStyle = accent;
      g.beginPath();
      g.arc(s * 0.36, 0, s * 0.11, 0, Math.PI * 2);
      g.fill();
      break;
    case 'chevrons':
      for (let i = 0; i < 3; i++) {
        g.globalAlpha = 0.45 + i * 0.27;
        g.beginPath();
        g.moveTo(-s * 0.4 + i * s * 0.26, -s * 0.36);
        g.lineTo(-s * 0.1 + i * s * 0.26, 0);
        g.lineTo(-s * 0.4 + i * s * 0.26, s * 0.36);
        g.stroke();
      }
      break;
    case 'drop':
      g.beginPath();
      g.moveTo(0, -s * 0.48);
      g.bezierCurveTo(s * 0.5, s * 0.05, s * 0.3, s * 0.48, 0, s * 0.48);
      g.bezierCurveTo(-s * 0.3, s * 0.48, -s * 0.5, s * 0.05, 0, -s * 0.48);
      g.fill();
      g.fillStyle = accent;
      g.beginPath();
      g.arc(s * 0.02, s * 0.16, s * 0.12, 0, Math.PI * 2);
      g.fill();
      break;
    case 'pixels':
      for (let iy = 0; iy < 3; iy++)
        for (let ix = 0; ix < 3; ix++) {
          if ((ix + iy) % 2 === 1 && !(ix === 1 && iy === 1)) continue;
          g.fillStyle = ix === 1 && iy === 1 ? accent : col;
          g.fillRect(-s * 0.42 + ix * s * 0.29, -s * 0.42 + iy * s * 0.29, s * 0.25, s * 0.25);
        }
      break;
    case 'wing':
      for (let i = 0; i < 3; i++) {
        g.beginPath();
        g.moveTo(-s * 0.45, s * 0.3 - i * s * 0.26);
        g.quadraticCurveTo(0, s * 0.1 - i * s * 0.3, s * 0.48, -s * 0.36 + i * s * 0.1);
        g.stroke();
      }
      break;
  }
  g.restore();
}

function makeLedAtlas(maxSize: number): THREE.CanvasTexture {
  const W = Math.min(2048, maxSize);
  const H = W / 2;
  const rh = H / ROWS;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.textBaseline = 'middle';

  BRANDS.forEach((b, row) => {
    const y0 = row * rh;
    const bg = g.createLinearGradient(0, y0, 0, y0 + rh);
    bg.addColorStop(0, b.bg1);
    bg.addColorStop(1, b.bg0);
    g.fillStyle = bg;
    g.fillRect(0, y0, W, rh);
    // subtle diagonal sheen bands so a scrolling board visibly moves even between logos
    g.save();
    g.beginPath();
    g.rect(0, y0, W, rh);
    g.clip();
    g.globalAlpha = 0.08;
    g.fillStyle = b.accent;
    for (let x = -rh; x < W + rh; x += W / 16) {
      g.beginPath();
      g.moveTo(x, y0 + rh);
      g.lineTo(x + rh * 0.6, y0);
      g.lineTo(x + rh * 0.6 + W / 64, y0);
      g.lineTo(x + W / 64, y0 + rh);
      g.fill();
    }
    g.restore();
    // two repeats of [mark · NAME · tagline] per strip
    const cy = y0 + rh / 2;
    for (let rep = 0; rep < 2; rep++) {
      const x0 = (rep * W) / 2 + W * 0.02;
      drawMark(g, b.mark, x0 + rh * 0.45, cy, rh * 0.78, b.fg, b.accent);
      g.fillStyle = b.fg;
      g.font = `900 ${Math.round(rh * 0.66)}px ${FONT}`;
      const nameX = x0 + rh * 1.05;
      g.fillText(b.name, nameX, cy + rh * 0.03, W * 0.26);
      const nw = Math.min(g.measureText(b.name).width, W * 0.26);
      g.fillStyle = b.accent;
      g.font = `700 ${Math.round(rh * 0.24)}px ${FONT}`;
      g.fillText(b.tag, nameX + nw + rh * 0.3, cy + rh * 0.06, W * 0.5 - (nameX - x0) - nw - rh * 0.5);
    }
  });

  // ribbon strip
  {
    const y0 = ROW_RIBBON * rh;
    g.fillStyle = '#05070b';
    g.fillRect(0, y0, W, rh);
    g.font = `900 ${Math.round(rh * 0.56)}px ${FONT}`;
    const msg = ["STRIKERS '26", '★', 'WORLD CHAMPIONSHIP', '★', 'MATCHDAY LIVE', '★', 'THE MERIDIAN BOWL', '★'];
    let x = W * 0.01;
    const total = msg.reduce((s, m) => s + g.measureText(m).width, 0);
    const gap = (W - total - W * 0.02) / msg.length;
    msg.forEach((m, i) => {
      g.fillStyle = m === '★' ? '#5dff3a' : i % 4 === 0 ? '#ffffff' : '#ffc93a';
      g.fillText(m, x, y0 + rh * 0.53);
      x += g.measureText(m).width + gap;
    });
  }
  // goal strip (white on black; tinted with the scorer's colour in the shader)
  {
    const y0 = ROW_GOAL * rh;
    g.fillStyle = '#000000';
    g.fillRect(0, y0, W, rh);
    g.fillStyle = '#ffffff';
    g.font = `900 italic ${Math.round(rh * 0.8)}px ${FONT}`;
    const word = 'GOAL!';
    const ww = g.measureText(word).width;
    const n = Math.max(1, Math.floor(W / (ww * 1.35)));
    for (let i = 0; i < n; i++) g.fillText(word, (i + 0.5) * (W / n) - ww / 2, y0 + rh * 0.54);
  }

  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const LED_VERT = /* glsl */ `
varying vec2 vUv;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const LED_FRAG = /* glsl */ `
${ENV_PARS}
uniform sampler2D uAtlas;
uniform float uStrip; // metres of board per atlas width
uniform float uGoal; // 0..1 goal take-over
uniform vec3 uGoalCol;
uniform float uPixels; // LED pixels per board height
varying vec2 vUv;
#include <fog_pars_fragment>

vec3 strip( float row, float u, float v ) {
  float vv = ( row + clamp( v, 0.06, 0.94 ) ) / ${ROWS}.0;
  return texture2D( uAtlas, vec2( u, 1.0 - vv ) ).rgb;
}

void main() {
  float v = 1.0 - vUv.y; // 0 = top of the board
  float u = vUv.x / uStrip;
  vec3 col;
  #ifdef LED_RIBBON
    col = strip( ${ROW_RIBBON}.0, u + uTime * 0.012, v );
  #else
    float slot = uTime / 8.0;
    float idx = floor( slot );
    float ph = fract( slot );
    float cur = mod( idx, ${BRAND_ROWS}.0 );
    float nxt = mod( idx + 1.0, ${BRAND_ROWS}.0 );
    // wipe sweeps along the boards so the change travels round the ground
    float w = smoothstep( 0.9, 1.0, ph ) * 1.2 - fract( vUv.x / 64.0 ) * 0.2;
    float row = ( v < w ) ? nxt : cur;
    col = strip( row, u + uTime * 0.008, v );
  #endif
  // goal take-over: flashing team-coloured GOAL strip racing round the boards
  if ( uGoal > 0.001 ) {
    vec3 gt = strip( ${ROW_GOAL}.0, u * 1.5 - uTime * 0.22, v );
    float pulse = 0.6 + 0.4 * sin( uTime * 14.0 );
    vec3 gc = mix( uGoalCol * 0.55, vec3( 1.0 ), gt.r ) * ( 0.75 + 0.5 * pulse * gt.r );
    gc = mix( gc, uGoalCol, 0.35 * ( 1.0 - gt.r ) );
    col = mix( col, gc, smoothstep( 0.0, 0.15, uGoal ) );
  }
  // LED pixel structure, faded out before it could alias
  vec2 px = vec2( vUv.x * uPixels / ${LAYOUT.boardH.toFixed(2)}, vUv.y * uPixels );
  float fw = max( fwidth( px.x ), fwidth( px.y ) );
  vec2 cell = abs( fract( px ) - 0.5 );
  float dot = smoothstep( 0.5, 0.28, max( cell.x, cell.y ) );
  col *= mix( 0.55 + 0.75 * dot, 1.0, clamp( fw * 1.6, 0.0, 1.0 ) );

  gl_FragColor = vec4( col * uLed + col * 0.04, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

const SCREEN_FRAG = /* glsl */ `
${ENV_PARS}
uniform sampler2D uTex;
varying vec2 vUv;
#include <fog_pars_fragment>
void main() {
  vec3 col = texture2D( uTex, vUv ).rgb;
  vec2 px = vUv * vec2( 256.0, 128.0 );
  float fw = max( fwidth( px.x ), fwidth( px.y ) );
  vec2 cell = abs( fract( px ) - 0.5 );
  float dot = smoothstep( 0.5, 0.25, max( cell.x, cell.y ) );
  col *= mix( 0.55 + 0.75 * dot, 1.0, clamp( fw * 1.6, 0.0, 1.0 ) );
  gl_FragColor = vec4( col * uLed * 0.9 + col * 0.04, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

function ledMaterial(atlas: THREE.Texture, ribbon: boolean, stripMetres: number, pixels: number, goalCol: THREE.Color, goal: { value: number }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: ribbon ? 'LedRibbon' : 'LedBoards',
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      ...envU,
      uAtlas: { value: atlas },
      uStrip: { value: stripMetres },
      uGoal: goal,
      uGoalCol: { value: goalCol },
      uPixels: { value: pixels },
    },
    defines: ribbon ? { LED_RIBBON: '' } : {},
    vertexShader: LED_VERT,
    fragmentShader: LED_FRAG,
    side: THREE.FrontSide,
    fog: true,
  });
}

export class LedBoards {
  readonly meshes: THREE.Mesh[] = [];
  /** Housing geometry (board backs, scoreboard boxes) for the caller's structure material. */
  readonly housing: THREE.BufferGeometry;
  private atlas: THREE.CanvasTexture;
  private goal = { value: 0 };
  private goalCol = new THREE.Color('#ffffff');
  private home = new THREE.Color('#d8232a');
  private away = new THREE.Color('#1e63d8');
  private scoreCanvas: HTMLCanvasElement;
  private scoreTex: THREE.CanvasTexture;
  private lastScore = '';
  private homeName = 'HOME';
  private awayName = 'AWAY';

  constructor(maxTexture: number) {
    this.atlas = makeLedAtlas(maxTexture);
    const dark = new THREE.Color('#0b0d11');
    const frame = new THREE.Color('#2a2e36');
    const H = new GeoBuilder();

    /* ---- perimeter boards ---- */
    const B = new GeoBuilder();
    const xs = CFG.halfL + 1.0;
    const zs = CFG.halfW + LAYOUT.boardSide;
    const xe = CFG.halfL + LAYOUT.boardEnd;
    const ze = CFG.halfW + 0.5;
    // clockwise loop seen from above (text then reads left→right from inside)
    const loop: Array<[number, number, number, number]> = [
      [-xs, -zs, xs, -zs], // far side (hero)
      [xs, -zs, xe, -ze],
      [xe, -ze, xe, ze], // +X end
      [xe, ze, xs, zs],
      [xs, zs, 15, zs], // near side, right of the dugouts
      [-15, zs, -xs, zs], // near side, left of the dugouts
      [-xs, zs, -xe, ze],
      [-xe, ze, -xe, -ze], // −X end
      [-xe, -ze, -xs, -zs],
    ];
    let run = 0;
    const y0 = 0.06;
    const y1 = y0 + LAYOUT.boardH;
    const lean = 0.2;
    for (const [ax, az, bx, bz] of loop) {
      const len = Math.hypot(bx - ax, bz - az);
      // outward = away from the pitch centre
      let nx = bz - az;
      let nz = -(bx - ax);
      const nl = Math.hypot(nx, nz);
      nx /= nl;
      nz /= nl;
      const mx = (ax + bx) / 2;
      const mz = (az + bz) / 2;
      if (nx * mx + nz * mz < 0) {
        nx = -nx;
        nz = -nz;
      }
      const a0 = v3(ax, y0, az);
      const b0 = v3(bx, y0, bz);
      const a1 = v3(ax + nx * lean, y1, az + nz * lean);
      const b1 = v3(bx + nx * lean, y1, bz + nz * lean);
      // LED face (front = toward the pitch). Winding a0→b0→b1→a1 faces inward.
      pushFace(B, a0, b0, b1, a1, run, run + len, -nx, -nz);
      // housing: back + top + ends
      const t = 0.14;
      const off = (p: P3, k: number): P3 => v3(p.x + nx * k, p.y, p.z + nz * k);
      H.quad(off(b0, t + 0.12), off(a0, t + 0.12), off(a1, t), off(b1, t), dark, { col2: frame });
      H.quad(a1, b1, off(b1, t), off(a1, t), frame);
      H.quad(a0, a1, off(a1, t), off(a0, t + 0.12), frame);
      H.quad(b1, b0, off(b0, t + 0.12), off(b1, t), frame);
      // support feet every ~3 m
      const n = Math.max(1, Math.round(len / 3));
      for (let i = 0; i <= n; i++) {
        const f = i / n;
        const px = ax + (bx - ax) * f + nx * 0.45;
        const pz = az + (bz - az) * f + nz * 0.45;
        H.box(v3(px, 0.25, pz), 0.04, 0.25, 0.22, frame, Math.atan2(nx, nz));
      }
      run += len;
    }
    const boardMat = ledMaterial(this.atlas, false, 17, 62, this.goalCol, this.goal);
    const boards = new THREE.Mesh(B.build(), boardMat);
    boards.name = 'ledBoards';

    /* ---- fascia ribbon (horseshoe) ---- */
    const R = new GeoBuilder();
    const fy0 = LAYOUT.upperY0 - 1.2 + 0.45;
    const fy1 = fy0 + 1.15;
    const chain: Array<[string, boolean]> = [
      ['SE', true],
      ['E', true],
      ['NE', true],
      ['N', false],
      ['NW', true],
      ['W', true],
      ['SW', true],
    ];
    let s = 0;
    const d = LAYOUT.upperD0 - 0.07;
    const pa = v3(0, 0, 0),
      pb = v3(0, 0, 0),
      pc = v3(0, 0, 0),
      pd = v3(0, 0, 0);
    const nrm = { x: 0, z: 0 };
    for (const [id, rev] of chain) {
      const sec = SECTIONS.find((q) => q.id === id) as Section;
      const len = sec.length(d);
      const segs = sec.corner ? 12 : 1;
      for (let i = 0; i < segs; i++) {
        const t0 = i / segs;
        const t1 = (i + 1) / segs;
        const u0 = rev ? 1 - t0 : t0;
        const u1 = rev ? 1 - t1 : t1;
        sec.point(u0, d, fy0, pa);
        sec.point(u1, d, fy0, pb);
        sec.point(u1, d, fy1, pc);
        sec.point(u0, d, fy1, pd);
        sec.normal((u0 + u1) / 2, nrm);
        // chain runs right→left for a viewer inside, so u decreases along it
        pushFace(R, { ...pb }, { ...pa }, { ...pd }, { ...pc }, -(s + t1 * len), -(s + t0 * len), -nrm.x, -nrm.z);
      }
      s += len;
    }
    const ribbonMat = ledMaterial(this.atlas, true, 30, 72, this.goalCol, this.goal);
    const ribbon = new THREE.Mesh(R.build(), ribbonMat);
    ribbon.name = 'ledRibbon';

    /* ---- scoreboards under the roof edge at both ends ---- */
    this.scoreCanvas = document.createElement('canvas');
    this.scoreCanvas.width = 512;
    this.scoreCanvas.height = 256;
    this.scoreTex = new THREE.CanvasTexture(this.scoreCanvas);
    this.scoreTex.colorSpace = THREE.SRGBColorSpace;
    this.scoreTex.anisotropy = 4;
    const SB = new GeoBuilder();
    for (const id of ['E', 'W']) {
      const sec = SECTIONS.find((q) => q.id === id) as Section;
      const dd = LAYOUT.roofInnerD + 0.8;
      const half = 6.4 / sec.length(dd);
      const top = roofY(dd) - 0.7;
      const bot = top - 6.4;
      // E's u runs −z→+z; a viewer inside looking +X has +z on the right → u0 is left.
      // W's u runs +z→−z; looking −X, −z is on the right → u0 is left as well.
      sec.point(0.5 - half, dd, bot, pa);
      sec.point(0.5 + half, dd, bot, pb);
      sec.point(0.5 + half, dd, top, pc);
      sec.point(0.5 - half, dd, top, pd);
      sec.normal(0.5, nrm);
      pushFace(SB, { ...pa }, { ...pb }, { ...pc }, { ...pd }, 0, 1, -nrm.x, -nrm.z);
      // housing box behind + hangers
      const back = (p: P3, k: number): P3 => v3(p.x + nrm.x * k, p.y, p.z + nrm.z * k);
      const e = 0.35;
      const A = v3(pa.x, pa.y - e, pa.z),
        Bq = v3(pb.x, pb.y - e, pb.z),
        Cq = v3(pc.x, pc.y + e, pc.z),
        Dq = v3(pd.x, pd.y + e, pd.z);
      H.quad(back(Bq, 0.7), back(A, 0.7), back(Dq, 0.7), back(Cq, 0.7), dark);
      H.quad(back(A, -0.02), back(Bq, -0.02), back(Bq, 0.7), back(A, 0.7), frame);
      H.quad(back(Dq, 0.7), back(Cq, 0.7), back(Cq, -0.02), back(Dq, -0.02), frame);
      H.quad(back(A, 0.7), back(Dq, 0.7), back(Dq, -0.02), back(A, -0.02), frame);
      H.quad(back(Bq, -0.02), back(Cq, -0.02), back(Cq, 0.7), back(Bq, 0.7), frame);
    }
    const screenMat = new THREE.ShaderMaterial({
      name: 'Scoreboard',
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...envU, uTex: { value: this.scoreTex } },
      vertexShader: LED_VERT,
      fragmentShader: SCREEN_FRAG,
      fog: true,
    });
    const screens = new THREE.Mesh(SB.build(), screenMat);
    screens.name = 'scoreboards';

    this.housing = H.build();
    for (const m of [boards, ribbon, screens]) {
      m.matrixAutoUpdate = false;
      m.frustumCulled = false;
      this.meshes.push(m);
    }
    this.drawScore(0, 0);
  }

  setAnisotropy(a: number): void {
    this.atlas.anisotropy = a;
    this.atlas.needsUpdate = true;
  }

  setTeams(home: THREE.ColorRepresentation, away: THREE.ColorRepresentation, homeName?: string, awayName?: string): void {
    this.home.set(home);
    this.away.set(away);
    if (homeName) this.homeName = homeName;
    if (awayName) this.awayName = awayName;
    this.lastScore = '';
  }

  goalFlash(team: 0 | 1): void {
    this.goalCol.copy(team === 0 ? this.home : this.away);
    // keep the take-over colour vivid even for very dark kits
    const hsl = { h: 0, s: 0, l: 0 };
    this.goalCol.getHSL(hsl);
    this.goalCol.setHSL(hsl.h, Math.min(1, hsl.s * 1.1), Math.max(0.42, hsl.l));
    this.goal.value = 1;
  }

  update(dt: number, scoreHome: number, scoreAway: number): void {
    if (this.goal.value > 0) this.goal.value = Math.max(0, this.goal.value - dt / 6.5);
    const key = `${scoreHome}-${scoreAway}`;
    if (key !== this.lastScore) {
      this.lastScore = key;
      this.drawScore(scoreHome, scoreAway);
    }
  }

  private drawScore(h: number, a: number): void {
    const c = this.scoreCanvas;
    const g = c.getContext('2d')!;
    const W = c.width;
    const Hh = c.height;
    g.fillStyle = '#04060a';
    g.fillRect(0, 0, W, Hh);
    // header
    g.fillStyle = '#0d1420';
    g.fillRect(0, 0, W, 46);
    g.fillStyle = '#5dff3a';
    g.font = `900 26px ${FONT}`;
    g.textBaseline = 'middle';
    g.textAlign = 'center';
    g.fillText("STRIKERS '26", W / 2, 25);
    // team colour panels
    const hs = `#${this.home.getHexString()}`;
    const as = `#${this.away.getHexString()}`;
    g.fillStyle = hs;
    g.fillRect(14, 60, 150, 132);
    g.fillStyle = as;
    g.fillRect(W - 164, 60, 150, 132);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(14, 150, 150, 42);
    g.fillRect(W - 164, 150, 150, 42);
    g.fillStyle = '#ffffff';
    g.font = `900 24px ${FONT}`;
    g.fillText(this.homeName.slice(0, 9), 89, 172, 140);
    g.fillText(this.awayName.slice(0, 9), W - 89, 172, 140);
    // score
    g.font = `900 124px ${FONT}`;
    g.fillStyle = '#ffffff';
    g.fillText(String(h), W / 2 - 62, 132);
    g.fillText(String(a), W / 2 + 62, 132);
    g.fillStyle = '#ffc93a';
    g.fillRect(W / 2 - 9, 122, 18, 9);
    // footer ticker bar
    g.fillStyle = '#0d1420';
    g.fillRect(0, Hh - 40, W, 40);
    g.fillStyle = '#ffc93a';
    g.font = `700 20px ${FONT}`;
    g.fillText('THE MERIDIAN BOWL', W / 2, Hh - 19);
    this.scoreTex.needsUpdate = true;
  }
}

function pushFace(b: GeoBuilder, a: P3, bb: P3, c: P3, d: P3, u0: number, u1: number, nx: number, nz: number): void {
  const n = v3(nx, 0, nz);
  b.quad(a, bb, c, d, WHITE, { uv: [u0, 0, u1, 1], normals: [n, n, n, n] });
}
const WHITE = new THREE.Color(1, 1, 1);
