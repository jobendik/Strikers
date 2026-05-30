import * as THREE from 'three';

/** Renderer, scene graph, camera and lighting rig. */

const appEl = document.getElementById('app');
if (!appEl) throw new Error('#app mount point not found');

export const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
appEl.appendChild(renderer.domElement);

export const scene = new THREE.Scene();
scene.background = new THREE.Color('#070b14');
scene.fog = new THREE.Fog('#070b14', 70, 160);

export const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.5, 400);
camera.position.set(0, 26, 38);
camera.lookAt(0, 0, 0);

/* ---- lights ---- */
const hemi = new THREE.HemisphereLight('#9fb8ff', '#0a1a10', 0.55);
scene.add(hemi);

const amb = new THREE.AmbientLight('#5566aa', 0.25);
scene.add(amb);

export const sun = new THREE.DirectionalLight('#fff6e6', 1.35);
sun.position.set(-30, 52, 28);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 10;
sun.shadow.camera.far = 140;
sun.shadow.camera.left = -46;
sun.shadow.camera.right = 46;
sun.shadow.camera.top = 34;
sun.shadow.camera.bottom = -34;
sun.shadow.bias = -0.0004;
scene.add(sun);
scene.add(sun.target);

// cool fill from the opposite side
const fill = new THREE.DirectionalLight('#88a6ff', 0.4);
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
