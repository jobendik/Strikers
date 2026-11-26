/**
 * kitMaterials.ts — the player material: a MeshStandardMaterial whose albedo,
 * roughness and a little emissive are generated procedurally per fragment.
 *
 * Why a shader instead of textures
 *   The whole character is ONE mesh (see playerRig.ts) whose vertices carry a
 *   part id. The fragment shader switches on that id and paints:
 *     shirt  — kit pattern evaluated in BIND-POSE space (the un-skinned vertex
 *              position), so stripes/hoops/sashes stick to the cloth as it
 *              deforms; collar + cuffs; squad number and name projected onto the
 *              back from a shared glyph atlas; short sleeves (the model's long
 *              sleeve is shaded as bare forearm past the cuff);
 *     shorts — colour, side stripe, small front number;
 *     socks  — colour + turnover band;
 *     boots  — upper + sole;
 *     skin   — the model's embedded face/hand texture used as a DETAIL map and
 *              re-tinted to the player's skin tone; scalp tinted to hair colour;
 *              keeper gloves;
 *     eyes   — texture as authored.
 *   Every pattern edge is anti-aliased with screen-space derivatives and fades
 *   to its average colour when it gets sub-pixel, so nothing shimmers at
 *   broadcast distance.
 *
 * Cost model
 *   One WebGL program for every player (shared via customProgramCacheKey); one
 *   small material per player that only differs by uniform values. Two shared
 *   textures (the 512² body atlas and the glyph atlas).
 */

import * as THREE from 'three';
import { ATLAS_LAYOUT } from './kitAtlas';

/** Uniform block of one player material. Colours are linear-working-space THREE.Colors. */
export interface PlayerUniforms {
  uBodyMap: { value: THREE.Texture | null };
  uAtlas: { value: THREE.Texture | null };
  uShirt: { value: THREE.Color };
  uSecond: { value: THREE.Color };
  uTrim: { value: THREE.Color };
  uSleeve: { value: THREE.Color };
  uShorts: { value: THREE.Color };
  uShortsTrim: { value: THREE.Color };
  uSocks: { value: THREE.Color };
  uSocksTrim: { value: THREE.Color };
  uNumber: { value: THREE.Color };
  uNumOutline: { value: THREE.Color };
  uSkin: { value: THREE.Color };
  uHair: { value: THREE.Color };
  uBoot: { value: THREE.Color };
  uBootSole: { value: THREE.Color };
  uGlove: { value: THREE.Color };
  /** x: pattern id, y: sleeve end |x| in bind metres, z: gloves on (0/1), w: hair style (0 shaved … 1 cropped). */
  uKitParams: { value: THREE.Vector4 };
  /** x: tens digit (−1 = none), y: units digit. */
  uDigits: { value: THREE.Vector2 };
  /** Name slot rectangle in the atlas: u0, v0, width, height (width 0 = no name). */
  uNameRect: { value: THREE.Vector4 };
}

/** Bind-space |x| (metres) where a short sleeve ends / a long sleeve "ends" (past the wrist). */
export const SLEEVE_SHORT = 0.335;
export const SLEEVE_LONG = 0.95;

const VERT_DECL = /* glsl */ `
attribute float aPart;
varying vec3 vBind;
varying vec3 vBindN;
varying float vPart;
varying vec2 vTexUv;
`;

const VERT_BODY = /* glsl */ `
vBind = position * 0.01;   // model units are centimetres → metres
vBindN = normal;
vPart = aPart;
vTexUv = uv;
`;

const FRAG_DECL = /* glsl */ `
uniform sampler2D uBodyMap;
uniform sampler2D uAtlas;
uniform vec3 uShirt;
uniform vec3 uSecond;
uniform vec3 uTrim;
uniform vec3 uSleeve;
uniform vec3 uShorts;
uniform vec3 uShortsTrim;
uniform vec3 uSocks;
uniform vec3 uSocksTrim;
uniform vec3 uNumber;
uniform vec3 uNumOutline;
uniform vec3 uSkin;
uniform vec3 uHair;
uniform vec3 uBoot;
uniform vec3 uBootSole;
uniform vec3 uGlove;
uniform vec4 uKitParams;
uniform vec2 uDigits;
uniform vec4 uNameRect;

varying vec3 vBind;
varying vec3 vBindN;
varying float vPart;
varying vec2 vTexUv;

// Linear-space mean of the bare skin in the model's embedded atlas: dividing the
// texture by it leaves pure detail (creases, lips, brows) to multiply onto any tone.
const vec3 K_SKIN_REF = vec3(0.376, 0.254, 0.205);
const float K_SKIN_REF_L = 0.276;

// 1 inside a repeating band (period 1, centred on fract == 0.5) of the given duty;
// fades to the duty cycle itself once the bands are sub-pixel.
float kBands(float c, float duty) {
  float fw = fwidth(c);
  float t = abs(fract(c) - 0.5) * 2.0;
  float b = 1.0 - smoothstep(duty - fw * 2.0, duty + fw * 2.0, t);
  return mix(b, duty, smoothstep(0.3, 0.8, fw));
}

// 1 where |d| < hw, anti-aliased.
float kLine(float d, float hw) {
  float fw = fwidth(d);
  return 1.0 - smoothstep(hw - fw, hw + fw, abs(d));
}

// Anti-aliased step.
float kStep(float edge, float v) {
  float fw = fwidth(v);
  return smoothstep(edge - fw, edge + fw, v);
}

// Sample the squad number. q spans the two-digit box (x → reader's right, y up).
// Returns (fill, fill + outline).
vec2 kNumber(vec2 q) {
  if (q.x <= 0.0 || q.x >= 1.0 || q.y <= 0.0 || q.y >= 1.0) return vec2(0.0);
  float two = step(0.0, uDigits.x);
  float x = mix((q.x - 0.25) * 2.0, q.x * 2.0, two);
  if (x <= 0.0 || x >= 2.0) return vec2(0.0);
  float cell = floor(x);
  if (two < 0.5 && cell > 0.5) return vec2(0.0);
  float digit = (two > 0.5 && cell < 0.5) ? uDigits.x : uDigits.y;
  vec2 scale = vec2(${(2 * ATLAS_LAYOUT.digitWidthU).toFixed(6)}, ${ATLAS_LAYOUT.digitHeightV.toFixed(6)});
  vec2 uv = vec2(
    digit * ${ATLAS_LAYOUT.digitPitchU.toFixed(6)} + ${ATLAS_LAYOUT.digitOffsetU.toFixed(6)} + fract(x) * ${ATLAS_LAYOUT.digitWidthU.toFixed(6)},
    ${ATLAS_LAYOUT.digitBottomV.toFixed(6)} + q.y * ${ATLAS_LAYOUT.digitHeightV.toFixed(6)});
  // gradients from the continuous box coordinate: no mip seam between the digits
  return textureGrad(uAtlas, uv, dFdx(q) * scale, dFdy(q) * scale).rg;
}

vec2 kName(vec2 q) {
  if (uNameRect.z <= 0.0 || q.x <= 0.0 || q.x >= 1.0 || q.y <= 0.0 || q.y >= 1.0) return vec2(0.0);
  return textureGrad(uAtlas, uNameRect.xy + q * uNameRect.zw, dFdx(q) * uNameRect.zw, dFdy(q) * uNameRect.zw).rg;
}

vec3 kInk(vec3 base, vec2 g) {
  return mix(mix(base, uNumOutline, g.y), uNumber, g.x);
}
`;

/**
 * Replaces <map_fragment>. Leaves three locals for later chunks:
 *   kRough — roughness, kSkinAmt — how much of the fragment is skin (drives the
 *   warm sub-surface term), and writes diffuseColor.rgb.
 */
const FRAG_ALBEDO = /* glsl */ `
float kRough = 0.8;
float kSkinAmt = 0.0;
{
  int part = int(vPart + 0.5);
  vec3 bp = vBind;
  vec3 bn = normalize(vBindN);
  float ax = abs(bp.x);
  vec3 col = vec3(1.0);

  if (part == 0) {
    // ------------------------------------------------------------ shirt
    int pat = int(uKitParams.x + 0.5);
    float sleeve = kStep(0.215, ax);
    float m = 0.0;   // amount of the pattern colour
    float e = 0.0;   // amount of trim edging
    if (pat == 1) {
      m = 1.0 - kBands(bp.x / 0.09 + 0.5, 0.5);
    } else if (pat == 2) {
      m = kBands(bp.x / 0.034 + 0.5, 0.2);
    } else if (pat == 3) {
      m = kBands(bp.y / 0.11 + 0.2, 0.42);
    } else if (pat == 4) {
      float d = dot(vec2(bp.x, bp.y - 1.215), vec2(0.827, -0.563));
      m = kLine(d, 0.05);
      e = kLine(abs(d) - 0.06, 0.008);
    } else if (pat == 5) {
      m = kStep(0.0, bp.x);
    } else if (pat == 6) {
      float d = bp.y - 1.3;
      m = kLine(d, 0.05);
      e = kLine(abs(d) - 0.061, 0.008);
    } else if (pat == 7) {
      float yv = bp.y - 0.22 * ax;
      m = kStep(1.365, yv);
      e = kLine(yv - 1.356, 0.008);
    } else if (pat == 8) {
      float a = kBands(bp.x / 0.17 + 0.25, 0.5);
      float b = kBands(bp.y / 0.17, 0.5);
      m = a * b + (1.0 - a) * (1.0 - b);
    } else if (pat == 9) {
      float d = bp.y - (1.2 + 0.6 * ax);
      m = kLine(d, 0.042);
      e = kLine(abs(d) - 0.053, 0.008);
    }
    // keep the back plain behind the name + number so they always read
    float back = smoothstep(0.1, 0.3, -bn.z) * (1.0 - sleeve);
    float panel = back * (1.0 - kStep(0.175, ax)) * kStep(1.06, bp.y) * (1.0 - kStep(1.45, bp.y));
    m *= 1.0 - panel;
    e *= 1.0 - panel;

    col = mix(uShirt, uSecond, m);
    col = mix(col, uTrim, e);
    col = mix(col, uSleeve, sleeve);

    // collar ring around the neck opening
    float neckR = length(vec2(bp.x, (bp.z + 0.015) * 0.9));
    float collar = (1.0 - kStep(0.1, neckR + (1.5 - bp.y) * 0.55)) * kStep(1.4, bp.y);
    col = mix(col, uTrim, collar);

    // cuff, then bare forearm beyond a short sleeve
    float sleeveEnd = uKitParams.y;
    col = mix(col, uTrim, kLine(ax - (sleeveEnd - 0.016), 0.016) * sleeve);
    float arm = kStep(sleeveEnd, ax);

    // name + number on the back (viewed from behind, +x is the reader's LEFT)
    vec2 qn = vec2(0.5 - bp.x / 0.27, (bp.y - 1.085) / 0.25);
    vec2 qm = vec2(0.5 - bp.x / 0.3, (bp.y - 1.362) / 0.052);
    vec2 g = (kNumber(qn) + kName(qm)) * back;
    col = kInk(col, g);

    kRough = mix(0.74, 0.58, arm);
    kSkinAmt = arm;
    col = mix(col, uSkin, arm);
  } else if (part == 1) {
    // ------------------------------------------------------------ shorts
    float outward = bn.x * sign(bp.x);
    float stripe = smoothstep(0.8, 0.9, outward) * kStep(0.12, ax);
    col = mix(uShorts, uShortsTrim, stripe);
    // small number on the front of the (player's) left thigh
    vec2 qn = vec2(0.5 + (bp.x - 0.105) / 0.1, (bp.y - 0.655) / 0.095);
    col = kInk(col, kNumber(qn) * smoothstep(0.2, 0.4, bn.z));
    kRough = 0.78;
  } else if (part == 2) {
    // ------------------------------------------------------------ socks
    col = mix(uSocks, uSocksTrim, kStep(0.325, bp.y));
    kRough = 0.9;
  } else if (part == 3) {
    // ------------------------------------------------------------ boots
    col = mix(uBootSole, uBoot, kStep(0.022, bp.y));
    kRough = 0.36;
  } else if (part == 4) {
    // ------------------------------------------------------------ skin
    vec3 tex = texture2D(uBodyMap, vTexUv).rgb;
    float lum = dot(tex, vec3(0.2126, 0.7152, 0.0722)) / K_SKIN_REF_L;
    col = uSkin * min(tex / K_SKIN_REF, vec3(1.5));
    // the atlas paints the scalp near-black: re-tint it as hair (cropped) or a
    // stubble shadow (shaved)
    float scalp = (1.0 - smoothstep(0.03, 0.16, lum)) * smoothstep(1.5, 1.53, bp.y);
    vec3 hair = mix(mix(uSkin * 0.62, uHair, 0.3), uHair * (0.75 + 2.5 * lum), uKitParams.w);
    col = mix(col, hair, scalp);
    float glove = uKitParams.z * kStep(0.655, ax) * step(1.2, bp.y);
    col = mix(col, uGlove, glove);
    kRough = mix(mix(0.56, 0.5, scalp), 0.7, glove);
    kSkinAmt = (1.0 - scalp) * (1.0 - glove);
  } else {
    // ------------------------------------------------------------ eyes / inner mouth
    col = texture2D(uBodyMap, vTexUv).rgb;
    kRough = 0.22;
  }
  diffuseColor.rgb = col;
}
`;

const FRAG_ROUGH = /* glsl */ `
roughnessFactor = kRough;
`;

/**
 * After <emissivemap_fragment> (the shading normal exists by now):
 *  - a warm, low-level emissive on skin stands in for sub-surface scatter so
 *    shadowed skin stays alive instead of going grey;
 *  - a faint albedo-coloured Fresnel rim lifts the silhouette off the turf,
 *    which is most of what makes a 50-px player readable.
 */
const FRAG_EMISSIVE = /* glsl */ `
{
  float kNdV = saturate(dot(normal, normalize(vViewPosition)));
  float kRim = pow(1.0 - kNdV, 3.0);
  totalEmissiveRadiance += diffuseColor.rgb * (kRim * 0.32);
  totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.38, 0.26) * (kSkinAmt * 0.085);
}
`;

const PROGRAM_KEY = 'strikers-player-v1';

/** Create one player's material + its uniform block. */
export function createPlayerMaterial(
  bodyMap: THREE.Texture | null,
  atlas: THREE.Texture,
): { material: THREE.MeshStandardMaterial; uniforms: PlayerUniforms } {
  const uniforms: PlayerUniforms = {
    uBodyMap: { value: bodyMap },
    uAtlas: { value: atlas },
    uShirt: { value: new THREE.Color('#cccccc') },
    uSecond: { value: new THREE.Color('#ffffff') },
    uTrim: { value: new THREE.Color('#ffffff') },
    uSleeve: { value: new THREE.Color('#cccccc') },
    uShorts: { value: new THREE.Color('#222222') },
    uShortsTrim: { value: new THREE.Color('#ffffff') },
    uSocks: { value: new THREE.Color('#222222') },
    uSocksTrim: { value: new THREE.Color('#ffffff') },
    uNumber: { value: new THREE.Color('#ffffff') },
    uNumOutline: { value: new THREE.Color('#ffffff') },
    uSkin: { value: new THREE.Color('#c98d68') },
    uHair: { value: new THREE.Color('#1a1410') },
    uBoot: { value: new THREE.Color('#111111') },
    uBootSole: { value: new THREE.Color('#eeeeee') },
    uGlove: { value: new THREE.Color('#f5f6f8') },
    uKitParams: { value: new THREE.Vector4(0, SLEEVE_SHORT, 0, 1) },
    uDigits: { value: new THREE.Vector2(-1, 0) },
    uNameRect: { value: new THREE.Vector4(0, 0, 0, 0) },
  };

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.8,
    metalness: 0,
    envMapIntensity: 0.85,
  });
  material.name = 'player';

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_DECL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_DECL}`)
      .replace('#include <map_fragment>', FRAG_ALBEDO)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${FRAG_ROUGH}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FRAG_EMISSIVE}`);
  };
  // Same key for every player → one compiled program, however many materials.
  material.customProgramCacheKey = () => PROGRAM_KEY;

  return { material, uniforms };
}
