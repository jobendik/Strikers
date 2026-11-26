import * as THREE from 'three';
import { CFG } from '../config/constants';
import { ENV_PARS, ROOF_SHADOW, STADIUM_LIGHT, envU } from './env';
import { GeoBuilder, v3, type P3 } from './geo';
import { LAYOUT } from './layout';

/*
 * Pitch-side furniture: dugouts + technical benches and the players' tunnel on
 * the camera (+Z) side, and the four corner flags. Everything opaque goes into
 * one merged geometry for the shared stadium material; the dugout glazing and
 * the flag cloth are one small draw call each.
 *
 * Height budget on the +Z side: the tallest thing here is the tunnel canopy at
 * 2.5 m (z ≥ 25.2). The broadcast sight line from (x, 16, 46) to the near
 * touchline passes z = 25.2 at y ≈ 3.2, so nothing here can cover the pitch.
 */

const C = (hex: string): THREE.Color => new THREE.Color(hex);

export interface PropsBuild {
  solid: THREE.BufferGeometry;
  glass: THREE.Mesh;
  flags: THREE.Mesh;
}

export function buildProps(): PropsBuild {
  const S = new GeoBuilder();
  const G = new GeoBuilder();
  const white = C('#e9ecef');
  const frame = C('#c9ced6');
  const dark = C('#191c22');
  const seat = C('#1d4390');
  const seatHi = C('#2f5fae');
  const accent = C('#f2c230');

  /* ---- dugouts (two, either side of the tunnel) ---- */
  const zFront = CFG.halfW + 5.4;
  const zBack = CFG.halfW + 7.4;
  for (const cx of [-9, 9]) {
    const half = 4.6;
    // plinth
    S.box(v3(cx, 0.08, (zFront + zBack) / 2 + 0.1), half + 0.15, 0.08, 1.15, dark);
    // two rows of seats
    for (let row = 0; row < 2; row++) {
      const z = zBack - 0.45 - row * 0.85;
      const y = 0.16 + (1 - row) * 0.28;
      S.box(v3(cx, y / 2 + 0.08, z + 0.1), half - 0.1, y / 2, 0.42, dark);
      for (let i = 0; i < 12; i++) {
        const x = cx - half + 0.5 + i * ((2 * half - 1) / 11);
        S.box(v3(x, y + 0.2, z - 0.05), 0.26, 0.06, 0.24, seat, 0, seatHi); // pan
        S.box(v3(x, y + 0.62, z + 0.24), 0.26, 0.38, 0.05, seat, 0, seatHi); // back
        S.box(v3(x, y + 1.06, z + 0.25), 0.16, 0.09, 0.06, white); // headrest
      }
    }
    // curved canopy: ribs + glazing, back wall up and over toward the pitch
    const prof: Array<[number, number]> = [
      [zBack + 0.25, 0.1],
      [zBack + 0.3, 1.2],
      [zBack + 0.1, 1.85],
      [zBack - 0.45, 2.2],
      [zBack - 1.3, 2.32],
      [zFront + 0.15, 2.22],
    ];
    const ribs = 5;
    for (let r = 0; r <= ribs; r++) {
      const x = cx - half + (2 * half * r) / ribs;
      for (let i = 0; i < prof.length - 1; i++) {
        S.beam(v3(x, prof[i][1], prof[i][0]), v3(x, prof[i + 1][1], prof[i + 1][0]), 0.07, 0.07, frame);
      }
    }
    for (let i = 0; i < prof.length - 1; i++) {
      const a = v3(cx - half, prof[i][1], prof[i][0]);
      const b = v3(cx + half, prof[i][1], prof[i][0]);
      const c = v3(cx + half, prof[i + 1][1], prof[i + 1][0]);
      const d = v3(cx - half, prof[i + 1][1], prof[i + 1][0]);
      G.quad(a, b, c, d, white);
    }
    // end panels
    for (const x of [cx - half, cx + half]) {
      for (let i = 0; i < prof.length - 2; i++) {
        G.tri(v3(x, prof[0][1], prof[prof.length - 1][0]), v3(x, prof[i][1], prof[i][0]), v3(x, prof[i + 1][1], prof[i + 1][0]), white);
      }
    }
    // leading edge bar + accent stripe
    const last = prof[prof.length - 1];
    S.beam(v3(cx - half, last[1], last[0]), v3(cx + half, last[1], last[0]), 0.09, 0.09, accent);
  }

  /* ---- players' tunnel: a canopy running out from the wall stand ---- */
  {
    const hw = 2.3;
    const z0 = LAYOUT.hz + 0.2;
    const z1 = CFG.halfW + 5.2;
    const h = 2.5;
    const stripes = 7;
    for (let i = 0; i < stripes; i++) {
      const za = z0 + ((z1 - z0) * i) / stripes;
      const zb = z0 + ((z1 - z0) * (i + 1)) / stripes;
      const col = i % 2 === 0 ? white : accent;
      // roof
      S.quad(v3(-hw, h, za), v3(hw, h, za), v3(hw, h, zb), v3(-hw, h, zb), col);
      // side walls
      S.quad(v3(-hw, 0, zb), v3(-hw, 0, za), v3(-hw, h, za), v3(-hw, h, zb), col);
      S.quad(v3(hw, 0, za), v3(hw, 0, zb), v3(hw, h, zb), v3(hw, h, za), col);
    }
    // mouth frame
    S.beam(v3(-hw, h + 0.1, z1), v3(hw, h + 0.1, z1), 0.14, 0.2, dark);
    S.beam(v3(-hw, 0, z1), v3(-hw, h + 0.1, z1), 0.14, 0.14, dark);
    S.beam(v3(hw, 0, z1), v3(hw, h + 0.1, z1), 0.14, 0.14, dark);
  }

  /* ---- corner flag poles ---- */
  const flagPos: P3[] = [];
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const x = sx * (CFG.halfL - 0.02);
      const z = sz * (CFG.halfW - 0.02);
      S.beam(v3(x, 0, z), v3(x, 1.55, z), 0.035, 0.035, accent);
      flagPos.push(v3(x, 1.55, z));
    }

  /* ---- glazing material (translucent, lit like the rest of the stadium) ---- */
  const glassMat = new THREE.ShaderMaterial({
    name: 'DugoutGlass',
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...envU },
    vertexShader: /* glsl */ `
      varying vec3 vWp;
      varying vec3 vN;
      #include <fog_pars_vertex>
      void main() {
        vec4 wp = modelMatrix * vec4( position, 1.0 );
        vWp = wp.xyz;
        vN = normalize( mat3( modelMatrix ) * normal );
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      ${ENV_PARS}
      varying vec3 vWp;
      varying vec3 vN;
      #include <fog_pars_fragment>
      ${ROOF_SHADOW}
      ${STADIUM_LIGHT}
      void main() {
        vec3 n = normalize( vN );
        if ( ! gl_FrontFacing ) n = -n;
        vec3 v = normalize( cameraPosition - vWp );
        float fres = pow( 1.0 - abs( dot( n, v ) ), 3.0 );
        vec3 col = vec3( 0.55, 0.68, 0.78 ) * stadiumLight( vWp, n ) * 0.55;
        gl_FragColor = vec4( col, 0.26 + 0.5 * fres );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
  });
  const glass = new THREE.Mesh(G.build(), glassMat);
  glass.name = 'dugoutGlass';
  glass.renderOrder = 2;
  glass.matrixAutoUpdate = false;

  /* ---- corner flags: 4 small cloth quads waving in the vertex shader ---- */
  const fp: number[] = [];
  const fu: number[] = [];
  const fi: number[] = [];
  const SEG = 6;
  flagPos.forEach((p, f) => {
    const base = f * (SEG + 1) * 2;
    // flags fly away from the pitch
    const dirX = Math.sign(p.x);
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG;
      for (let j = 0; j < 2; j++) {
        fp.push(p.x + dirX * t * 0.46, p.y - 0.02 - j * 0.34, p.z);
        fu.push(t, j);
      }
    }
    for (let i = 0; i < SEG; i++) {
      const a = base + i * 2;
      fi.push(a, a + 2, a + 3, a, a + 3, a + 1);
    }
  });
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
  fg.setAttribute('uv', new THREE.Float32BufferAttribute(fu, 2));
  fg.setIndex(fi);
  const flagMat = new THREE.ShaderMaterial({
    name: 'CornerFlags',
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...envU },
    vertexShader: /* glsl */ `
      ${ENV_PARS}
      varying vec2 vUv;
      varying vec3 vWp;
      #include <fog_pars_vertex>
      void main() {
        vUv = uv;
        vec3 p = position;
        float ph = uTime * 7.0 + p.x * 0.7 + p.z * 0.9;
        float amp = uv.x * ( 0.06 + 0.05 * uWet );
        p.z += sin( ph - uv.x * 5.0 ) * amp;
        p.y += cos( ph * 0.8 - uv.x * 4.0 ) * amp * 0.4 - uv.x * uv.x * 0.05;
        vWp = p;
        vec4 mvPosition = viewMatrix * vec4( p, 1.0 );
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      ${ENV_PARS}
      varying vec2 vUv;
      varying vec3 vWp;
      #include <fog_pars_fragment>
      ${ROOF_SHADOW}
      ${STADIUM_LIGHT}
      void main() {
        // quartered flag
        float q = step( 0.5, vUv.x ) + step( 0.5, vUv.y );
        vec3 base = mix( vec3( 0.95, 0.72, 0.05 ), vec3( 0.85, 0.07, 0.08 ), step( 0.5, mod( q, 2.0 ) ) );
        vec3 col = base * stadiumLight( vWp, vec3( 0.0, 0.8, 0.6 ) ) * 1.15;
        gl_FragColor = vec4( col, 1.0 );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    side: THREE.DoubleSide,
    fog: true,
  });
  const flags = new THREE.Mesh(fg, flagMat);
  flags.name = 'cornerFlags';
  flags.frustumCulled = false;
  flags.matrixAutoUpdate = false;

  return { solid: S.build(), glass, flags };
}
