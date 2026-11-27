import * as THREE from 'three';
import { LAYOUT } from './layout';

/*
 * Environment presets (time of day / weather) and the shared uniform block that
 * every custom environment shader reads.
 *
 * Units: light values are scene-referred linear radiance. A DirectionalLight of
 * intensity I lights a diffuse surface with albedo·I/π (three r160, non-legacy
 * lights), so presets store the *DirectionalLight intensity* and the custom
 * shaders divide by π to stay in step with the PBR materials (players, ball,
 * pitch, goal frames). Exposure then maps the result through ACES.
 */

export type EnvPresetName = 'afternoon' | 'golden' | 'night' | 'overcast' | 'rain';

export const ENV_PRESETS: readonly EnvPresetName[] = ['afternoon', 'golden', 'night', 'overcast', 'rain'];

export interface AuxLight {
  /** Direction TOWARD the light. */
  dir: [number, number, number];
  color: string;
  intensity: number;
}

export interface EnvPreset {
  name: EnvPresetName;
  label: string;
  /** Key light: elevation / azimuth in degrees. Azimuth 0 = from −X, 90 = from +Z (camera side). */
  sunElev: number;
  sunAzim: number;
  sunColor: string;
  sunIntensity: number;
  /** 0 = the key is not a single sun (floodlights) → no analytic roof shadow. */
  roofShadow: number;
  /** Three auxiliary directional lights (fill / rim / opposite floodlights). */
  aux: [AuxLight, AuxLight, AuxLight];
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  /** Sky dome. */
  zenith: string;
  horizon: string;
  skyGround: string;
  skyIntensity: number;
  sunDisc: number; // brightness of the visible sun disc + halo (0 hides it)
  cloudCover: number; // 0..1
  cloudColor: string;
  cloudShade: string;
  stars: number;
  /** Exponential-squared fog. */
  fogColor: string;
  fogDensity: number;
  exposure: number;
  envIntensity: number;
  /** Floodlights: lamp emissive level (0 off) and their spill on stands/crowd. */
  flood: number;
  floodColor: string;
  floodSpill: number;
  /** Ambient the custom stadium shaders use (sky from above, bounce from below). */
  ambSky: string;
  ambGround: string;
  ambIntensity: number;
  /** LED board brightness (HDR > 1 blooms on high/ultra). */
  led: number;
  /** Rain: 0 dry .. 1 heavy. Drives wet pitch + streak particles. */
  wet: number;
  rain: number;
  /** Final grade. */
  saturation: number;
  contrast: number;
  tint: [number, number, number];
  vignette: number;
  bloomStrength: number;
  bloomThreshold: number;
}

const P = (p: EnvPreset): EnvPreset => p;

export const PRESETS: Record<EnvPresetName, EnvPreset> = {
  afternoon: P({
    name: 'afternoon',
    label: 'Afternoon',
    sunElev: 50,
    sunAzim: 60,
    sunColor: '#fff3df',
    sunIntensity: 7.2,
    roofShadow: 1,
    aux: [
      { dir: [0.7, 0.5, -0.6], color: '#9fc0ff', intensity: 0.75 },
      { dir: [0.2, 0.3, 1], color: '#cfe0ff', intensity: 0.45 },
      { dir: [-0.6, 0.4, -0.7], color: '#bcd2ff', intensity: 0.4 },
    ],
    hemiSky: '#bcd6ff',
    hemiGround: '#3f5a2c',
    hemiIntensity: 0.9,
    zenith: '#1f5fc4',
    horizon: '#a9cdf2',
    skyGround: '#5b6d58',
    skyIntensity: 1.0,
    sunDisc: 1,
    cloudCover: 0.32,
    cloudColor: '#ffffff',
    cloudShade: '#8fa5c4',
    stars: 0,
    fogColor: '#b6cfe8',
    fogDensity: 0.0016,
    exposure: 0.62,
    envIntensity: 1.0,
    flood: 0,
    floodColor: '#ffffff',
    floodSpill: 0,
    ambSky: '#a8c6f5',
    ambGround: '#5d7448',
    ambIntensity: 0.62,
    led: 1.3,
    wet: 0,
    rain: 0,
    saturation: 1.08,
    contrast: 1.04,
    tint: [1.0, 1.0, 1.0],
    vignette: 0.22,
    bloomStrength: 0.16,
    bloomThreshold: 3.0,
  }),
  golden: P({
    name: 'golden',
    label: 'Golden hour',
    sunElev: 31,
    sunAzim: 24,
    sunColor: '#ffb76a',
    sunIntensity: 5.4,
    roofShadow: 1,
    aux: [
      { dir: [0.7, 0.55, -0.5], color: '#8fa9ff', intensity: 1.4 },
      { dir: [0.5, 0.7, 0.8], color: '#ffe6c9', intensity: 1.1 },
      { dir: [-0.5, 0.7, -0.8], color: '#ffe6c9', intensity: 1.0 },
    ],
    hemiSky: '#9db4ee',
    hemiGround: '#4a4a2a',
    hemiIntensity: 1.7,
    zenith: '#2a4fa3',
    horizon: '#ffb37a',
    skyGround: '#5a4d3f',
    skyIntensity: 0.8,
    sunDisc: 1.3,
    cloudCover: 0.42,
    cloudColor: '#ffd9a8',
    cloudShade: '#7d6f98',
    stars: 0,
    fogColor: '#f0b98c',
    fogDensity: 0.0026,
    exposure: 0.84,
    envIntensity: 1.4,
    flood: 0.55,
    floodColor: '#fff1dc',
    floodSpill: 0.14,
    ambSky: '#93a9e6',
    ambGround: '#6b5a40',
    ambIntensity: 0.62,
    led: 1.3,
    wet: 0,
    rain: 0,
    saturation: 1.1,
    contrast: 1.06,
    tint: [1.03, 1.0, 0.96],
    vignette: 0.3,
    bloomStrength: 0.26,
    bloomThreshold: 2.2,
  }),
  night: P({
    name: 'night',
    label: 'Night',
    // Key = the camera-side-left floodlight rig.
    sunElev: 46,
    sunAzim: 52,
    sunColor: '#f4f7ff',
    sunIntensity: 2.3,
    roofShadow: 0,
    aux: [
      { dir: [0.78, 0.82, 0.62], color: '#f4f7ff', intensity: 1.6 }, // camera-side right rig
      { dir: [-0.78, 0.82, -0.62], color: '#f4f7ff', intensity: 1.3 }, // far-left rig
      { dir: [0.78, 0.82, -0.62], color: '#f4f7ff', intensity: 1.3 }, // far-right rig
    ],
    hemiSky: '#5a6c96',
    hemiGround: '#24361f',
    hemiIntensity: 0.4,
    zenith: '#03060f',
    horizon: '#16233f',
    skyGround: '#0a1016',
    skyIntensity: 0.55,
    sunDisc: 0,
    cloudCover: 0.25,
    cloudColor: '#27314a',
    cloudShade: '#0a0f1c',
    stars: 1,
    fogColor: '#101a2e',
    fogDensity: 0.0024,
    exposure: 0.82,
    envIntensity: 1.0,
    flood: 1,
    floodColor: '#f1f5ff',
    floodSpill: 0.5,
    ambSky: '#3b4a70',
    ambGround: '#22301c',
    ambIntensity: 0.34,
    led: 1.25,
    wet: 0,
    rain: 0,
    saturation: 1.1,
    contrast: 1.08,
    tint: [0.98, 1.0, 1.04],
    vignette: 0.38,
    bloomStrength: 0.3,
    bloomThreshold: 1.7,
  }),
  overcast: P({
    name: 'overcast',
    label: 'Overcast',
    sunElev: 62,
    sunAzim: 70,
    sunColor: '#f2f4f7',
    sunIntensity: 2.4,
    roofShadow: 0.35,
    aux: [
      { dir: [0.6, 0.8, -0.5], color: '#dfe6f0', intensity: 1.1 },
      { dir: [0.3, 0.6, 0.9], color: '#dfe6f0', intensity: 0.9 },
      { dir: [-0.7, 0.6, -0.6], color: '#dfe6f0', intensity: 0.9 },
    ],
    hemiSky: '#d5dde8',
    hemiGround: '#4a5a3c',
    hemiIntensity: 1.5,
    zenith: '#8793a3',
    horizon: '#c5ccd4',
    skyGround: '#5d665b',
    skyIntensity: 1.0,
    sunDisc: 0,
    cloudCover: 1,
    cloudColor: '#e3e7ec',
    cloudShade: '#8b95a3',
    stars: 0,
    fogColor: '#bcc4cc',
    fogDensity: 0.003,
    exposure: 0.8,
    envIntensity: 1.1,
    flood: 0.35,
    floodColor: '#ffffff',
    floodSpill: 0.1,
    ambSky: '#c9d2df',
    ambGround: '#66705a',
    ambIntensity: 0.95,
    led: 1.2,
    wet: 0.12,
    rain: 0,
    saturation: 0.98,
    contrast: 1.03,
    tint: [0.99, 1.0, 1.02],
    vignette: 0.26,
    bloomStrength: 0.14,
    bloomThreshold: 2.4,
  }),
  rain: P({
    name: 'rain',
    label: 'Rain',
    // A wet floodlit evening: the key is again a floodlight rig.
    sunElev: 44,
    sunAzim: 54,
    sunColor: '#eef3ff',
    sunIntensity: 2.1,
    roofShadow: 0,
    aux: [
      { dir: [0.78, 0.8, 0.62], color: '#eef3ff', intensity: 1.5 },
      { dir: [-0.78, 0.8, -0.62], color: '#eef3ff', intensity: 1.4 },
      { dir: [0.78, 0.8, -0.62], color: '#eef3ff', intensity: 1.4 },
    ],
    hemiSky: '#7f8ba3',
    hemiGround: '#2c3a2a',
    hemiIntensity: 0.75,
    zenith: '#1c2330',
    horizon: '#48515f',
    skyGround: '#151a1e',
    skyIntensity: 0.7,
    sunDisc: 0,
    cloudCover: 1,
    cloudColor: '#5a6474',
    cloudShade: '#252b36',
    stars: 0,
    fogColor: '#39424f',
    fogDensity: 0.0056,
    exposure: 0.82,
    envIntensity: 1.5,
    flood: 1,
    floodColor: '#eef4ff',
    floodSpill: 0.42,
    ambSky: '#5a6680',
    ambGround: '#2a3428',
    ambIntensity: 0.42,
    led: 1.2,
    wet: 1,
    rain: 1,
    saturation: 0.96,
    contrast: 1.08,
    tint: [0.97, 1.0, 1.05],
    vignette: 0.4,
    bloomStrength: 0.34,
    bloomThreshold: 1.6,
  }),
};

/** Unit vector toward the key light for a preset. */
export function sunDirection(p: EnvPreset, out = new THREE.Vector3()): THREE.Vector3 {
  const e = THREE.MathUtils.degToRad(p.sunElev);
  const a = THREE.MathUtils.degToRad(p.sunAzim);
  return out.set(-Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)).normalize();
}

/* ----------------------------- shared uniforms ----------------------------- */

/**
 * One uniform block shared (by reference) by every custom environment material.
 * Updating a value here updates all of them — presets never touch materials.
 */
export const envU = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  /** Key light radiance on a facing diffuse surface (colour · intensity / π). */
  uSunRad: { value: new THREE.Color() },
  uAmbSky: { value: new THREE.Color() },
  uAmbGround: { value: new THREE.Color() },
  /** Floodlight spill radiance on the stands. */
  uFlood: { value: new THREE.Color() },
  /** Lamp emissive level 0..1. */
  uFloodOn: { value: 0 },
  /** x: amount 0..1, y: roof edge height, z: roof inner d, w: height above which nothing is under the roof. */
  uRoof: { value: new THREE.Vector4(1, LAYOUT.roofInnerY, LAYOUT.roofInnerD, LAYOUT.roofBackY - 0.8) },
  /** Stand-front rounded rectangle: (straight half x, straight half z, corner r). */
  uBowl: { value: new THREE.Vector3(LAYOUT.hx - LAYOUT.rc, LAYOUT.hz - LAYOUT.rc, LAYOUT.rc) },
  uLed: { value: 1 },
  uWet: { value: 0 },
};

let active: EnvPreset = PRESETS.night;
const listeners: Array<(p: EnvPreset) => void> = [];

export function getEnvPreset(): EnvPreset {
  return active;
}

/** Subscribe to preset changes (called after the shared uniforms are updated). */
export function onEnvChange(fn: (p: EnvPreset) => void): void {
  listeners.push(fn);
}

/** Write a preset into the shared uniform block and notify subscribers. */
export function writeEnvUniforms(p: EnvPreset): void {
  active = p;
  sunDirection(p, envU.uSunDir.value);
  envU.uSunRad.value.set(p.sunColor).multiplyScalar(p.sunIntensity / Math.PI);
  envU.uAmbSky.value.set(p.ambSky).multiplyScalar(p.ambIntensity);
  envU.uAmbGround.value.set(p.ambGround).multiplyScalar(p.ambIntensity);
  envU.uFlood.value.set(p.floodColor).multiplyScalar(p.floodSpill);
  envU.uFloodOn.value = p.flood;
  envU.uRoof.value.x = p.roofShadow;
  envU.uLed.value = p.led;
  envU.uWet.value = p.wet;
  // With floodlights as the key there is no single sun: the stands are lit by
  // the broad floodlight spill term instead (see STADIUM_LIGHT).
  if (p.flood >= 1) envU.uSunRad.value.setScalar(0);
  for (let i = 0; i < listeners.length; i++) listeners[i](p);
}

/* ------------------------------- GLSL chunks ------------------------------- */

/** Uniform declarations for the shared block. */
export const ENV_PARS = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunRad;
uniform vec3 uAmbSky;
uniform vec3 uAmbGround;
uniform vec3 uFlood;
uniform float uFloodOn;
uniform vec4 uRoof;
uniform vec3 uBowl;
uniform float uLed;
uniform float uWet;
`;

/**
 * Analytic roof shadow. The roof is everything outside the rounded rectangle at
 * `d > roofInnerD`, at height uRoof.y; a point is lit by the sun when the ray
 * toward the sun passes through the opening. Returns 1 = lit … 0 = shadowed,
 * with a penumbra that widens with the distance to the roof edge.
 */
export const ROOF_SHADOW = /* glsl */ `
float bowlD( vec2 p ) {
  vec2 q = abs( p ) - uBowl.xy;
  return length( max( q, 0.0 ) ) + min( max( q.x, q.y ), 0.0 ) - uBowl.z;
}
float roofLit( vec3 wp ) {
  if ( uRoof.x <= 0.0 ) return 1.0;
  float t = ( uRoof.y - wp.y ) / max( uSunDir.y, 0.02 );
  if ( t < 0.0 || wp.y > uRoof.w ) return 1.0;
  vec2 q = wp.xz + uSunDir.xz * t;
  float w = 0.25 + 0.03 * t;
  float lit = 1.0 - smoothstep( uRoof.z - w, uRoof.z + w, bowlD( q ) );
  return mix( 1.0, lit, uRoof.x );
}
`;

/**
 * The stand lighting model: hemisphere ambient + roof-shadowed key + floodlight
 * spill from above the pitch. `n` is the world normal. Returns irradiance/π
 * (multiply by albedo).
 */
export const STADIUM_LIGHT = /* glsl */ `
vec3 stadiumLight( vec3 wp, vec3 n ) {
  vec3 amb = mix( uAmbGround, uAmbSky, n.y * 0.5 + 0.5 );
  float ndl = max( dot( n, uSunDir ), 0.0 );
  vec3 key = uSunRad * ndl * roofLit( wp );
  // floodlight spill: a broad light hovering above the centre circle
  vec3 toL = normalize( vec3( -wp.x * 0.6, 34.0 - wp.y, -wp.z * 0.6 ) );
  vec3 flood = uFlood * ( 0.35 + 0.65 * max( dot( n, toL ), 0.0 ) );
  return amb + key + flood;
}
`;
