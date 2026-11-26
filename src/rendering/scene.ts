import * as THREE from 'three';
import { DynamicResolution, getQuality, onQualityChange, type QualityProfile } from './quality';
import { ENV_PRESETS, PRESETS, envU, sunDirection, writeEnvUniforms, type EnvPreset, type EnvPresetName } from './env';
import { Sky } from './sky';
import { PostFx } from './postfx';

/*
 * Renderer, scene graph, camera, lighting rig and the frame presenter.
 *
 * - `setEnvironmentPreset(name)` re-lights the whole scene (key + 3 aux lights,
 *   hemisphere, sky dome, fog, exposure, PMREM environment, grade).
 * - `renderFrame()` is the only place a frame is drawn: it advances the shared
 *   shader clock, keeps the shadow frustum glued to `sun.target`, runs the
 *   dynamic-resolution governor and presents either directly (lite/standard) or
 *   through the HDR post chain (high/ultra).
 */

const appEl = document.getElementById('app');
if (!appEl) throw new Error('#app mount point not found');

export const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', stencil: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, getQuality().pixelRatioCap));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.info.autoReset = false; // reset once per frame so stats cover every pass
appEl.appendChild(renderer.domElement);

export const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2('#101a2e', 0.0024);

export const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.5, 2000);
camera.position.set(0, 26, 38);
camera.lookAt(0, 0, 0);

/* --------------------------------- lights --------------------------------- */

const hemi = new THREE.HemisphereLight('#cfe0ff', '#2a3a1e', 0.5);
scene.add(hemi);

/** Key light (sun, or the dominant floodlight rig at night). Casts the shadows. */
export const sun = new THREE.DirectionalLight('#fff4e0', 3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun);
scene.add(sun.target);

const aux: THREE.DirectionalLight[] = [];
for (let i = 0; i < 3; i++) {
  const l = new THREE.DirectionalLight('#ffffff', 0);
  l.shadow.bias = -0.0004;
  l.shadow.normalBias = 0.03;
  aux.push(l);
  scene.add(l);
  scene.add(l.target);
}

const SHADOW_DIST = 150;
const SHADOW_HALF_W = 36;
const SHADOW_HALF_H = 30;
function fitShadowCamera(l: THREE.DirectionalLight): void {
  const c = l.shadow.camera;
  c.near = 20;
  c.far = SHADOW_DIST + 90;
  c.left = -SHADOW_HALF_W;
  c.right = SHADOW_HALF_W;
  c.top = SHADOW_HALF_H;
  c.bottom = -SHADOW_HALF_H;
  c.updateProjectionMatrix();
}
fitShadowCamera(sun);
fitShadowCamera(aux[0]);

/** Root group every pitch object is parented to. */
export const world = new THREE.Group();
scene.add(world);

/* ---------------------------------- sky ----------------------------------- */

const sky = new Sky(getQuality().skyOctaves);
scene.add(sky.mesh);

/* ------------------------------ preset state ------------------------------ */

export { ENV_PRESETS };
export type { EnvPresetName };

let preset: EnvPreset = PRESETS.night;
let envDirty = true;
const sunDir = new THREE.Vector3(0, 1, 0);
const auxDir = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
let post: PostFx | null = null;

function applyShadowConfig(q: QualityProfile): void {
  renderer.shadowMap.enabled = q.shadows;
  const type = q.shadowSoft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  if (renderer.shadowMap.type !== type) {
    renderer.shadowMap.type = type;
    renderer.shadowMap.needsUpdate = true;
  }
  const resize = (l: THREE.DirectionalLight, size: number): void => {
    if (l.shadow.mapSize.x === size) return;
    l.shadow.mapSize.set(size, size);
    l.shadow.map?.dispose();
    l.shadow.map = null;
  };
  resize(sun, q.shadowMapSize);
  resize(aux[0], Math.min(2048, q.shadowMapSize));
  sun.castShadow = q.shadows;
  // crossed floodlight shadows: a second caster, floodlit presets + ultra only
  aux[0].castShadow = q.shadows && q.secondShadow && preset.flood >= 1;
}

function applyPresetToRig(): void {
  const p = preset;
  const q = getQuality();
  sunDirection(p, sunDir);
  sun.color.set(p.sunColor);
  sun.intensity = p.sunIntensity;
  // Fewer aux lights on the low tiers: fold their energy into the key + hemisphere
  // so the overall exposure stays put.
  let dropped = 0;
  for (let i = 0; i < 3; i++) {
    const a = p.aux[i];
    const on = i < q.auxLights;
    aux[i].visible = on;
    aux[i].color.set(a.color);
    aux[i].intensity = a.intensity;
    auxDir[i].set(a.dir[0], a.dir[1], a.dir[2]).normalize();
    if (!on) dropped += a.intensity;
  }
  if (dropped > 0) sun.intensity += dropped * 0.55;
  hemi.color.set(p.hemiSky);
  hemi.groundColor.set(p.hemiGround);
  hemi.intensity = p.hemiIntensity + dropped * 0.12;

  const fog = scene.fog as THREE.FogExp2;
  fog.color.set(p.fogColor);
  fog.density = p.fogDensity;
  scene.background = null;

  renderer.toneMappingExposure = p.exposure;
  sky.apply(p);
  post?.applyPreset(p);
  applyShadowConfig(q);
  envDirty = true;
}

/** Switch time-of-day / weather. Safe to call at any time (e.g. at match start). */
export function setEnvironmentPreset(name: EnvPresetName): void {
  const p = PRESETS[name];
  if (!p) return;
  preset = p;
  applyPresetToRig();
  writeEnvUniforms(p); // shared shader uniforms + notify stadium systems
}

export function getEnvironmentPreset(): EnvPresetName {
  return preset.name;
}

/* --------------------------------- quality -------------------------------- */

const drs = new DynamicResolution();
let pixelRatio = renderer.getPixelRatio();

function pixelRatioCap(q: QualityProfile): number {
  return Math.min(window.devicePixelRatio || 1, q.pixelRatioCap);
}

function setPixelRatio(pr: number): void {
  pixelRatio = pr;
  renderer.setPixelRatio(pr);
  renderer.setSize(window.innerWidth, window.innerHeight);
  post?.setSize(window.innerWidth, window.innerHeight, pr);
}

function applyQuality(q: QualityProfile): void {
  drs.reset();
  if (q.postFx && !post) {
    post = new PostFx(renderer, scene, camera, q.msaa);
    post.applyPreset(preset);
  } else if (!q.postFx && post) {
    post.dispose();
    post = null;
  }
  setPixelRatio(pixelRatioCap(q));
  sky.setOctaves(q.skyOctaves);
  applyPresetToRig(); // aux light count, shadow config, env-map size
}
onQualityChange(applyQuality);

export function handleResize(): void {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  post?.setSize(window.innerWidth, window.innerHeight, pixelRatio);
}

/* ---------------------------------- frame --------------------------------- */

const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _t = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

/**
 * Keep a directional light at a fixed direction from its (game-driven) target and
 * snap the target to shadow-texel increments in light space, so the shadow map
 * does not shimmer while the frustum follows the ball.
 */
function placeLight(l: THREE.DirectionalLight, dir: THREE.Vector3, snap: boolean): void {
  const tp = l.target.position;
  if (snap && l.castShadow) {
    _right.crossVectors(WORLD_UP, dir).normalize();
    _up.crossVectors(dir, _right).normalize();
    const texel = (2 * SHADOW_HALF_W) / l.shadow.mapSize.x;
    const r = Math.round(tp.dot(_right) / texel) * texel;
    const u = Math.round(tp.dot(_up) / texel) * texel;
    const d = tp.dot(dir);
    _t.set(0, 0, 0).addScaledVector(_right, r).addScaledVector(_up, u).addScaledVector(dir, d);
    tp.copy(_t);
  }
  l.position.copy(tp).addScaledVector(dir, SHADOW_DIST);
}

let lastT = performance.now();
let clock = 0;

export interface RenderStats {
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
  pixelRatio: number;
}
const stats: RenderStats = { calls: 0, triangles: 0, geometries: 0, textures: 0, programs: 0, pixelRatio: 1 };

/** Draw-call / triangle counts of the most recent frame (all passes). */
export function getRenderStats(): RenderStats {
  return stats;
}

/**
 * Render one frame. Everything that presents the 3-D scene goes through here (not
 * `renderer.render` directly) so the renderer is free to add a post-processing
 * chain per quality tier without touching the game loop.
 */
export function renderFrame(): void {
  const now = performance.now();
  const dt = Math.min(0.25, Math.max(0, (now - lastT) / 1000));
  const rawDt = (now - lastT) / 1000;
  lastT = now;
  clock += dt;
  envU.uTime.value = clock;

  const q = getQuality();
  if (q.dynamicRes && !(window as unknown as { __noDRS?: boolean }).__noDRS) {
    const pr = drs.update(rawDt, pixelRatioCap(q), Math.min(q.pixelRatioFloor, pixelRatioCap(q)));
    if (pr > 0) setPixelRatio(pr);
  }

  // The game moves sun.target to follow the action; the aux rig follows the same point.
  placeLight(sun, sunDir, true);
  for (let i = 0; i < 3; i++) {
    aux[i].target.position.copy(sun.target.position);
    placeLight(aux[i], auxDir[i], false);
  }

  sky.update(clock, camera.position);

  if (envDirty) {
    envDirty = false;
    scene.environment = sky.bakeEnvironment(renderer, q.envMapSize);
  }

  renderer.info.reset();
  if (post) post.render(dt);
  else renderer.render(scene, camera);

  stats.calls = renderer.info.render.calls;
  stats.triangles = renderer.info.render.triangles;
  stats.geometries = renderer.info.memory.geometries;
  stats.textures = renderer.info.memory.textures;
  stats.programs = renderer.info.programs?.length ?? 0;
  stats.pixelRatio = pixelRatio;
}

/* ---------------------------------- boot ---------------------------------- */

function initialPreset(): EnvPresetName {
  try {
    const v = new URLSearchParams(location.search).get('env');
    if (v && (ENV_PRESETS as readonly string[]).includes(v)) return v as EnvPresetName;
  } catch {
    /* ignore */
  }
  return 'night';
}
setEnvironmentPreset(initialPreset());

// Dev / QA hook (screenshots, tier measurements). Not used by game code.
(window as unknown as { __gfx?: unknown }).__gfx = {
  setEnvironmentPreset,
  getEnvironmentPreset,
  getRenderStats,
  presets: ENV_PRESETS,
  renderer,
  scene,
  camera,
};
