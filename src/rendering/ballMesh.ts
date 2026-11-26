/**
 * ballMesh.ts — the match ball.
 *
 * A true 32-panel football (truncated icosahedron: 12 pentagons + 20 hexagons)
 * generated analytically in the fragment shader — no texture, so the panels stay
 * razor-sharp in a close-up replay and there is no UV pinch at the poles.
 *
 * How the panels are found: a truncated icosahedron is the intersection of 32
 * half-spaces  dot(x, n_k) <= d_k  (n_k = an icosahedron vertex direction for a
 * pentagon, a face-centre direction for a hexagon). A ray from the centre in
 * direction p leaves through the plane with the largest  dot(p, n_k) / d_k, so
 * that arg-max IS the panel. The gap between the best and second-best value is
 * (to first order) the angular distance to the nearest seam, which gives us the
 * seam line, its anti-aliasing and the direction to tilt the normal for relief.
 *
 * Readability: pentagons are near-black on a white ball and four of them carry
 * accent colours, so the pattern is asymmetric and SPIN is visible in flight even
 * when the ball is only ~10 px across.
 */

import * as THREE from 'three';

const COL_HEX = '#f4f5f7';
const COL_PENT = '#14171d';
const COL_ACCENT_A = '#ff3d2e';
const COL_ACCENT_B = '#0aa5ff';
const COL_SEAM = '#3a3e46';

/** The 32 panel planes (xyz = unit normal, w = 1 / plane distance) — pentagons first. */
function panelPlanes(): THREE.Vector4[] {
  const phi = (1 + Math.sqrt(5)) / 2;
  const verts: THREE.Vector3[] = [];
  for (const a of [-1, 1]) {
    for (const b of [-phi, phi]) {
      verts.push(new THREE.Vector3(0, a, b), new THREE.Vector3(a, b, 0), new THREE.Vector3(b, 0, a));
    }
  }
  for (const v of verts) v.normalize();

  // icosahedron faces = triples of mutually adjacent vertices (adjacent: dot = 1/√5)
  const adj = (i: number, j: number): boolean => verts[i].dot(verts[j]) > 0.4;
  const faces: THREE.Vector3[] = [];
  for (let i = 0; i < 12; i++)
    for (let j = i + 1; j < 12; j++)
      for (let k = j + 1; k < 12; k++)
        if (adj(i, j) && adj(j, k) && adj(i, k)) {
          faces.push(new THREE.Vector3().add(verts[i]).add(verts[j]).add(verts[k]).normalize());
        }

  // Cutting each vertex a third of the way along its edges gives regular hexagons.
  // A cut point t = v_i + (v_j − v_i)/3 lies on both the pentagon plane of v_i and
  // the hexagon planes of the two faces sharing edge (i, j).
  let j0 = 1;
  while (!adj(0, j0)) j0++;
  const t = verts[0].clone().lerp(verts[j0], 1 / 3);
  const dPent = t.dot(verts[0]);
  let f0 = 0;
  for (let f = 0; f < faces.length; f++) if (faces[f].dot(t) > faces[f0].dot(t)) f0 = f;
  const dHex = t.dot(faces[f0]);

  const out: THREE.Vector4[] = [];
  for (const v of verts) out.push(new THREE.Vector4(v.x, v.y, v.z, 1 / dPent));
  for (const f of faces) out.push(new THREE.Vector4(f.x, f.y, f.z, 1 / dHex));
  return out;
}

function panelColors(planes: THREE.Vector4[]): THREE.Color[] {
  const cols = planes.map((_, i) => new THREE.Color(i < 12 ? COL_PENT : COL_HEX));
  // accents: one pentagon + its antipode in A, and another antipodal pair in B
  const antipode = (i: number): number => {
    let best = 0;
    let bd = 2;
    for (let j = 0; j < 12; j++) {
      const d = planes[i].x * planes[j].x + planes[i].y * planes[j].y + planes[i].z * planes[j].z;
      if (d < bd) {
        bd = d;
        best = j;
      }
    }
    return best;
  };
  cols[0].set(COL_ACCENT_A);
  cols[antipode(0)].set(COL_ACCENT_A);
  const other = [1, 2, 3, 4, 5].find((i) => i !== antipode(0)) ?? 1;
  cols[other].set(COL_ACCENT_B);
  cols[antipode(other)].set(COL_ACCENT_B);
  return cols;
}

const VERT_DECL = /* glsl */ `
varying vec3 vBallPos;
varying mat3 vBallNM;
`;
const VERT_BODY = /* glsl */ `
vBallPos = position;
vBallNM = normalMatrix;
`;

const FRAG_DECL = /* glsl */ `
uniform vec4 uPanels[32];
uniform vec3 uPanelCol[32];
uniform vec3 uSeamCol;
varying vec3 vBallPos;
varying mat3 vBallNM;
`;

/** Replaces <map_fragment>; leaves kSeam / kTilt for the normal + roughness chunks. */
const FRAG_ALBEDO = /* glsl */ `
float kSeam = 0.0;
vec3 kTilt = vec3(0.0);
{
  vec3 p = normalize(vBallPos);
  float b1 = -2.0;
  float b2 = -2.0;
  int i1 = 0;
  int i2 = 0;
  for (int i = 0; i < 32; i++) {
    float v = dot(p, uPanels[i].xyz) * uPanels[i].w;
    if (v > b1) { b2 = b1; i2 = i1; b1 = v; i1 = i; }
    else if (v > b2) { b2 = v; i2 = i; }
  }
  float d = b1 - b2;                                   // ~0.9 × angular distance to the seam
  float fw = 0.9 * max(length(dFdx(p)), length(dFdy(p))) + 1e-5;
  const float SEAM_W = 0.02;

  // panel colour, blended across the boundary by pixel coverage (no stair-steps far away)
  vec3 col = mix(uPanelCol[i2], uPanelCol[i1], clamp(0.5 + 0.5 * d / fw, 0.5, 1.0));
  // stitched seam: a dark line that fades out once it is thinner than a pixel
  kSeam = (1.0 - smoothstep(SEAM_W - fw, SEAM_W + fw, d)) * clamp(SEAM_W / fw, 0.0, 1.0);
  col = mix(col, uSeamCol, kSeam * 0.85);
  diffuseColor.rgb = col;

  // pillowed panels: tilt the normal toward the neighbouring panel near the seam
  vec3 toward = uPanels[i2].xyz - uPanels[i1].xyz;
  toward -= p * dot(p, toward);
  float slope = (1.0 - smoothstep(0.0, 0.11, d)) * clamp(0.05 / fw, 0.0, 1.0);
  kTilt = normalize(toward + vec3(1e-6)) * slope * 0.55;
}
`;

const FRAG_NORMAL = /* glsl */ `
normal = normalize(normal + vBallNM * kTilt);
`;

const FRAG_ROUGH = /* glsl */ `
roughnessFactor = mix(roughnessFactor, 0.8, kSeam);
`;

/**
 * Build the ball: a Mesh (the game positions and spins it) plus a soft blob
 * shadow returned separately so the caller can parent both to the world.
 */
export function createBall(radius: number): { ball: THREE.Mesh; shadow: THREE.Mesh } {
  const planes = panelPlanes();
  const uniforms = {
    uPanels: { value: planes },
    uPanelCol: { value: panelColors(planes) },
    uSeamCol: { value: new THREE.Color(COL_SEAM) },
  };

  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.34, metalness: 0, envMapIntensity: 0.75 });
  mat.name = 'ball';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_DECL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_DECL}`)
      .replace('#include <map_fragment>', FRAG_ALBEDO)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${FRAG_ROUGH}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FRAG_NORMAL}`);
  };
  mat.customProgramCacheKey = () => 'strikers-ball-v1';

  const ball = new THREE.Mesh(new THREE.SphereGeometry(radius, 40, 24), mat);
  ball.name = 'ball';
  ball.castShadow = true;
  ball.receiveShadow = true;

  // Soft contact shadow. The game shrinks and fades it as the ball climbs, which
  // is the main height cue from the broadcast camera.
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.85)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 3.4, radius * 3.4),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), color: '#000', transparent: true, opacity: 0.34, depthWrite: false }),
  );
  shadow.name = 'ball-shadow';
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  shadow.renderOrder = 1;

  return { ball, shadow };
}
