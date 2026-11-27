import * as THREE from 'three';
import { CFG } from '../config/constants';
import { ENV_PARS, ROOF_SHADOW, envU, type EnvPreset } from './env';
import { LAYOUT } from './layout';
import { makeTurfTextures, type TurfTextures } from './pitchTexture';
import type { QualityProfile } from './quality';

/*
 * The playing surface: one plane, one PBR material (MeshStandardMaterial patched
 * through onBeforeCompile so it still gets three's shadow maps, image-based
 * lighting and the full light rig).
 *
 * Everything deterministic is ANALYTIC in the fragment shader, in world metres:
 *   - line markings as a signed-distance field with derivative-based
 *     anti-aliasing → razor sharp at any resolution, no texture magnification
 *     blur, and no shimmer at the broadcast camera's grazing angle;
 *   - mowing pattern (bands across X + a fainter cross-cut), whose contrast
 *     depends on the view direction like real leaned grass;
 *   - wear in the goal mouths and centre circle;
 *   - the surround: natural run-off, synthetic apron, perimeter track,
 *     technical-area markings.
 * Only the stochastic grain comes from (mip-mapped, anisotropic) textures.
 *
 * Geometry of the markings — all from CFG, nothing hard-coded to a texture:
 *   boundary  ±halfL × ±halfW (line's outer edge on the boundary)
 *   boxes     boxDepth × ±boxHalfW,  six-yard sixDepth × ±sixHalfW
 *   spot      CFG.pen.spotOut from the goal line
 *   circle/D  radius CENTRE_R, corner arcs radius 1
 */

export const CENTRE_R = 6.2;
export const LINE_W = 0.13;
const CORNER_R = 1.0;

const PARS = /* glsl */ `
${ENV_PARS}
varying vec3 vWp;
uniform sampler2D uDetail;
#ifdef TURF_NORMAL
uniform sampler2D uDetailN;
#endif
uniform vec4 uPitch; // halfL, halfW, lineW, grass margin
uniform vec4 uBox; // boxDepth, boxHalfW, sixDepth, sixHalfW
uniform vec4 uMark; // penalty spot, circle r, corner r, track start
uniform vec3 uGrassA;
uniform vec3 uGrassB;
${ROOF_SHADOW}

float sdBox2( vec2 p, vec2 b ) {
  vec2 d = abs( p ) - b;
  return length( max( d, 0.0 ) ) + min( max( d.x, d.y ), 0.0 );
}

// distance to the centre-line of the nearest marking
float lineDist( vec2 p ) {
  float HL = uPitch.x;
  float HW = uPitch.y;
  float w2 = uPitch.z * 0.5;
  float d = abs( sdBox2( p, vec2( HL - w2, HW - w2 ) ) );
  d = min( d, max( abs( p.x ), abs( p.y ) - HW ) );
  d = min( d, abs( length( p ) - uMark.y ) );
  vec2 q = vec2( HL - abs( p.x ), abs( p.y ) ); // (distance in from the goal line, |z|)
  float inside = -q.x; // > 0 behind the goal line
  d = min( d, max( abs( sdBox2( q, uBox.xy ) ), inside ) );
  d = min( d, max( abs( sdBox2( q, uBox.zw ) ), inside ) );
  d = min( d, max( abs( length( q - vec2( uMark.x, 0.0 ) ) - uMark.y ), uBox.x - q.x ) );
  d = min( d, max( abs( length( vec2( q.x, HW - q.y ) ) - uMark.z ), max( inside, q.y - HW ) ) );
  return d;
}

float spotDist( vec2 p ) {
  vec2 q = vec2( uPitch.x - abs( p.x ), p.y );
  return min( length( p ) - 0.2, length( q - vec2( uMark.x, 0.0 ) ) - 0.17 );
}

float aaLine( float d, float halfW ) {
  float aa = max( fwidth( d ), 1e-5 );
  float w = max( halfW, aa * 0.62 ); // never thinner than ~1.25 px
  float fade = clamp( halfW / ( aa * 0.62 ), 0.6, 1.0 ); // ...but dimmer when inflated
  return clamp( ( w - d ) / aa + 0.5, 0.0, 1.0 ) * fade;
}

// anti-aliased square wave: 0/1 bands of width bw
float bands( float x, float bw ) {
  float s = x / bw;
  float tri = abs( fract( s * 0.5 ) * 2.0 - 1.0 );
  float e = fwidth( s ) * 0.5 + 0.004;
  return smoothstep( 0.5 - e, 0.5 + e, tri );
}
`;

const COLOR = /* glsl */ `
{
  vec2 p = vWp.xz;
  float HL = uPitch.x;
  float HW = uPitch.y;
  float dOut = sdBox2( p, vec2( HL, HW ) ); // > 0 outside the lines
  float aaO = fwidth( dOut ) + 1e-4;

  // --- stochastic detail ---
  vec3 dA = texture2D( uDetail, p * 0.55 ).rgb; // blade grain, ~1.8 m tile
  vec3 dB = texture2D( uDetail, p.yx * 0.071 + 0.37 ).rgb; // ~14 m tile
  vec3 dC = texture2D( uDetail, p * 0.019 + 0.11 ).rgb; // ~52 m tile
  float fine = dA.r;
  float clump = dB.g;
  float broad = dC.b;

  // --- mowing pattern: view-dependent, like leaned blades ---
  vec2 vd = normalize( cameraPosition.xz - p + 1e-4 );
  float sx = bands( p.x + HL, uPitch.x / 6.0 ) * 2.0 - 1.0; // 12 bands across the length
  float sz = bands( p.y + HW, uPitch.y / 4.0 ) * 2.0 - 1.0; // 8 cross bands
  float stripe = sx * ( 0.045 + 0.10 * abs( vd.y ) ) * sign( vd.y + 0.2 ) + sz * ( 0.015 + 0.075 * abs( vd.x ) ) * sign( vd.x + 0.001 );

  vec3 grass = mix( uGrassA, uGrassB, clamp( 0.5 + stripe * 2.2, 0.0, 1.0 ) );
  grass *= ( 0.74 + 0.52 * fine ) * ( 0.88 + 0.24 * clump );
  grass = mix( grass, grass * vec3( 1.22, 1.05, 0.72 ), clamp( ( broad - 0.42 ) * 1.3, 0.0, 0.45 ) );

  // --- wear: goal mouths + centre spot, broken up by the clump noise ---
  vec2 q = vec2( HL - abs( p.x ), p.y );
  float wearM = exp( -( ( q.x - 1.6 ) * ( q.x - 1.6 ) / 5.5 + q.y * q.y / 11.0 ) ) + 0.55 * exp( -dot( p, p ) / 5.0 );
  float wear = smoothstep( 0.42, 1.05, wearM * ( 0.55 + 0.95 * clump ) ) * step( dOut, 0.0 );
  grass = mix( grass, vec3( 0.23, 0.205, 0.085 ) * ( 0.75 + 0.5 * fine ), wear * 0.62 );

  // --- markings ---
  float line = aaLine( lineDist( p ), uPitch.z * 0.5 );
  float sd = spotDist( p );
  line = max( line, clamp( 0.5 - sd / ( fwidth( sd ) + 1e-5 ), 0.0, 1.0 ) );
  // paint sits on the blades: let the grain show through a little
  vec3 paint = vec3( 0.86, 0.87, 0.84 ) * ( 0.86 + 0.2 * fine );
  vec3 col = mix( grass, paint, line * ( 0.93 - 0.3 * wear ) );

  // --- surround: synthetic apron, then the perimeter track ---
  float apron = smoothstep( uPitch.w - aaO, uPitch.w + aaO, dOut );
  vec3 apronCol = vec3( 0.030, 0.105, 0.052 ) * ( 0.8 + 0.4 * dA.g ) * ( 0.9 + 0.2 * clump );
  col = mix( col, apronCol, apron );
  // technical areas (camera side), thin dashed lines on the apron
  vec2 tq = vec2( abs( p.x ) - 9.0, p.y - ( HW + 3.3 ) );
  float td = abs( sdBox2( tq, vec2( 5.5, 2.3 ) ) );
  float dash = step( 0.5, fract( ( abs( tq.x ) + abs( tq.y ) ) * 1.25 ) );
  col = mix( col, vec3( 0.8 ), aaLine( td, 0.04 ) * dash * apron * 0.85 );
  float track = smoothstep( uMark.w - aaO, uMark.w + aaO, dOut );
  vec3 trackCol = vec3( 0.052, 0.058, 0.07 ) * ( 0.75 + 0.5 * dA.b ) * ( 0.9 + 0.2 * fine );
  col = mix( col, trackCol, track );

  // --- rain: wet surfaces go darker ---
  col *= mix( 1.0, 0.74, uWet );

  diffuseColor.rgb = col;
  turfWear = wear;
  turfLine = line * ( 1.0 - apron );
  turfTrack = track;
  turfBroad = broad;
  turfFine = fine;
}
`;

const ROUGH = /* glsl */ `
{
  float dry = mix( 0.88, 0.96, turfWear );
  dry = mix( dry, 0.72, turfLine );
  dry = mix( dry, 0.82, turfTrack );
  // wet: mostly glossy, with puddles where the broad noise is low
  float wet = mix( 0.2, 0.52, smoothstep( 0.3, 0.62, turfBroad ) );
  wet = mix( wet, 0.3, turfTrack );
  roughnessFactor = mix( dry, wet, uWet ) * ( 0.94 + 0.12 * turfFine );
}
`;

const NORMAL = /* glsl */ `
#ifdef TURF_NORMAL
{
  vec2 dn = texture2D( uDetailN, vWp.xz * 0.55 ).rg * 2.0 - 1.0;
  float k = mix( 0.55, 0.16, uWet ) * ( 1.0 - turfTrack * 0.6 );
  normal = normalize( normal + mat3( viewMatrix ) * vec3( dn.x, 0.0, dn.y ) * k );
}
#endif
`;

export class Pitch {
  readonly mesh: THREE.Mesh;
  private mat: THREE.MeshStandardMaterial;
  private tex: TurfTextures;
  private uniforms: Record<string, THREE.IUniform>;
  private detailLevel: number;

  constructor(q: QualityProfile) {
    this.detailLevel = q.grassDetail;
    const size = q.grassDetail === 0 ? 256 : 512;
    this.tex = makeTurfTextures(size, q.grassDetail >= 2, q.anisotropy);
    this.uniforms = {
      ...envU,
      uDetail: { value: this.tex.detail },
      uDetailN: { value: this.tex.normal },
      uPitch: { value: new THREE.Vector4(CFG.halfL, CFG.halfW, LINE_W, LAYOUT.grassMargin) },
      uBox: { value: new THREE.Vector4(CFG.boxDepth, CFG.boxHalfW, CFG.sixDepth, CFG.sixHalfW) },
      uMark: { value: new THREE.Vector4(CFG.pen.spotOut, CENTRE_R, CORNER_R, LAYOUT.boardSide + 0.75) },
      uGrassA: { value: new THREE.Color('#2a6424') },
      uGrassB: { value: new THREE.Color('#3e8232') },
    };

    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, envMapIntensity: 0.4 });
    mat.name = 'Pitch';
    mat.defines = { ...(mat.defines ?? {}) };
    if (q.grassDetail >= 2) mat.defines.TURF_NORMAL = '';
    const uniforms = this.uniforms;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWp;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWp = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
      const lights = THREE.ShaderChunk.lights_fragment_begin.replace(
        'getDirectionalLightInfo( directionalLight, directLight );',
        `getDirectionalLightInfo( directionalLight, directLight );
		#if ( UNROLLED_LOOP_INDEX == 0 )
		directLight.color *= roofLit( vWp );
		#endif`,
      );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${PARS}`)
        .replace('void main() {', 'void main() {\nfloat turfWear = 0.0; float turfLine = 0.0; float turfTrack = 0.0; float turfBroad = 0.5; float turfFine = 0.5;')
        .replace('#include <map_fragment>', COLOR)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${ROUGH}`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${NORMAL}`)
        .replace('#include <lights_fragment_begin>', lights);
    };
    mat.customProgramCacheKey = () => `pitch-${mat.defines?.TURF_NORMAL !== undefined ? 'n' : 'f'}`;
    this.mat = mat;

    const geo = new THREE.PlaneGeometry(2 * (LAYOUT.hx + 1.5), 2 * (LAYOUT.hz + 1.5));
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.name = 'pitch';
  }

  applyPreset(p: EnvPreset): void {
    // dry turf barely mirrors the sky; soaked turf does
    this.mat.envMapIntensity = THREE.MathUtils.lerp(0.42, 1.0, p.wet) * p.envIntensity;
  }

  applyQuality(q: QualityProfile): void {
    if (q.grassDetail >= 2 && !this.tex.normal) {
      // upgraded from a lower tier: build the full-resolution set (with normals)
      const next = makeTurfTextures(512, true, q.anisotropy);
      this.tex.detail.dispose();
      this.tex = next;
      this.uniforms.uDetail.value = next.detail;
      this.uniforms.uDetailN.value = next.normal;
    }
    this.tex.detail.anisotropy = q.anisotropy;
    this.tex.detail.needsUpdate = true;
    if (this.tex.normal) {
      this.tex.normal.anisotropy = q.anisotropy;
      this.tex.normal.needsUpdate = true;
    }
    if (q.grassDetail !== this.detailLevel) {
      this.detailLevel = q.grassDetail;
      const defs = this.mat.defines!;
      if (q.grassDetail >= 2) defs.TURF_NORMAL = '';
      else delete defs.TURF_NORMAL;
      this.mat.needsUpdate = true;
    }
  }
}
