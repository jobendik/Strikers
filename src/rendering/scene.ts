import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/** Renderer, scene graph, camera and lighting rig. */

const appEl = document.getElementById('app');
if (!appEl) throw new Error('#app mount point not found');

export const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
// Slightly hotter exposure: PBR skin/kit read as dull and grey under the old
// night-time exposure once detailed models replaced the flat stub capsules.
renderer.toneMappingExposure = 1.18;
renderer.outputColorSpace = THREE.SRGBColorSpace;
appEl.appendChild(renderer.domElement);

export const scene = new THREE.Scene();
// A touch lighter than the near-black we had, so model silhouettes don't merge
// into the background and the fog reads as evening haze rather than a void.
scene.background = new THREE.Color('#0c1626');
scene.fog = new THREE.Fog('#0c1626', 80, 170);

// Image-based lighting: PBR MeshStandardMaterials have nothing to reflect without
// an environment, which is why kits/skin/ball looked chalky and lifeless. A cheap
// one-time PMREM bake of three's built-in RoomEnvironment gives every material
// proper ambient response + subtle reflections. No HDRI download, mobile-safe.
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
}

export const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.5, 400);
camera.position.set(0, 26, 38);
camera.lookAt(0, 0, 0);

/* ---- lights ---- */
// Hemisphere sky/ground fill: warmer sky and a green-tinted bounce off the turf
// so skin tones don't go blue. The envMap already supplies most ambient, so this
// is kept moderate to avoid washing the scene flat.
const hemi = new THREE.HemisphereLight('#cfe0ff', '#2a3a1e', 0.5);
scene.add(hemi);

// Neutral (not blue) base ambient — the old cold tint desaturated every kit.
const amb = new THREE.AmbientLight('#8893a6', 0.22);
scene.add(amb);

export const sun = new THREE.DirectionalLight('#fff4e0', 1.55);
sun.position.set(-30, 52, 28);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 10;
sun.shadow.camera.far = 140;
// Tighter frustum than before (±46×±34): the shadow camera only needs to cover
// the action around the ball (sun.target tracks it), so concentrating the 2048²
// map over a smaller area roughly doubles texel density → crisper, less blobby
// character shadows that actually ground the players.
sun.shadow.camera.left = -30;
sun.shadow.camera.right = 30;
sun.shadow.camera.top = 22;
sun.shadow.camera.bottom = -22;
sun.shadow.bias = -0.0004;
// normalBias tames the acne that appears once the skinned characters also
// receive shadows (self-shadowing on curved limbs).
sun.shadow.normalBias = 0.02;
scene.add(sun);
scene.add(sun.target);

// Warm-neutral fill from the opposite side to model the form without the old
// heavy blue cast.
const fill = new THREE.DirectionalLight('#aebed6', 0.45);
fill.position.set(34, 30, -26);
scene.add(fill);

/** Root group every pitch object is parented to. */
export const world = new THREE.Group();
scene.add(world);

export function handleResize(): void {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
