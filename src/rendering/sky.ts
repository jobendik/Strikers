import * as THREE from 'three';
import { EnvPreset, sunDirection } from './env';

/*
 * Procedural sky: an inside-out dome with an analytic gradient, sun disc + halo,
 * fbm clouds and stars. The same shader (minus the sun core) is rendered into a
 * small cube map and PMREM-filtered to become `scene.environment`, so image-based
 * lighting and reflections always match the visible sky of the active preset.
 */

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 mv = modelViewMatrix * vec4( position, 1.0 );
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w; // pin to the far plane
}
`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform float uSunDisc;
uniform float uCover;
uniform vec3 uCloudCol;
uniform vec3 uCloudShade;
uniform float uStars;
uniform float uTime;
uniform float uEnvPass;
varying vec3 vDir;

float hash21( vec2 p ) {
  p = fract( p * vec2( 123.34, 456.21 ) );
  p += dot( p, p + 45.32 );
  return fract( p.x * p.y );
}
float vnoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  float a = hash21( i );
  float b = hash21( i + vec2( 1.0, 0.0 ) );
  float c = hash21( i + vec2( 0.0, 1.0 ) );
  float d = hash21( i + vec2( 1.0, 1.0 ) );
  return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
}
float fbm( vec2 p ) {
  float s = 0.0;
  float a = 0.5;
  for ( int i = 0; i < SKY_OCTAVES; i ++ ) {
    s += a * vnoise( p );
    p = p * 2.03 + vec2( 17.1, 9.2 );
    a *= 0.5;
  }
  return s / ( 1.0 - a * 2.0 );
}

void main() {
  vec3 dir = normalize( vDir );
  float h = dir.y;
  float up = clamp( h, 0.0, 1.0 );
  vec3 col = mix( uHorizon, uZenith, pow( up, 0.42 ) );

  float sd = max( dot( dir, uSunDir ), 0.0 );
  // warm scattering lobe toward the sun, strongest near the horizon
  col += uSunCol * uSunDisc * ( 0.22 * pow( sd, 6.0 ) + 0.10 * pow( sd, 2.0 ) ) * ( 1.0 - 0.6 * up );

  if ( h > 0.0 ) {
    vec2 uv = dir.xz / ( h + 0.16 ) * 0.9 + vec2( uTime * 0.0035, uTime * 0.0012 );
    float n = fbm( uv );
    float lo = 0.78 - uCover * 0.62;
    float c = smoothstep( lo, lo + 0.32, n );
    // cheap self-shadowing: sample toward the sun
    float n2 = fbm( uv + uSunDir.xz * 0.18 );
    float lit = clamp( 0.55 + ( n - n2 ) * 2.6, 0.0, 1.0 );
    vec3 cc = mix( uCloudShade, uCloudCol, lit );
    cc += uSunCol * uSunDisc * 0.25 * pow( sd, 5.0 );
    // full overcast keeps some structure instead of a flat fill
    cc *= mix( 1.0, 0.82 + 0.36 * n, step( 0.99, uCover ) );
    col = mix( col, cc, c * smoothstep( 0.0, 0.14, h ) );

    if ( uStars > 0.0 ) {
      vec2 sp = dir.xz / ( h + 0.4 ) * 90.0;
      vec2 id = floor( sp );
      float r = hash21( id );
      vec2 f = fract( sp ) - 0.5 - ( vec2( hash21( id + 3.1 ), hash21( id + 7.7 ) ) - 0.5 ) * 0.6;
      float star = smoothstep( 0.09, 0.0, length( f ) ) * step( 0.93, r );
      col += vec3( 0.9, 0.95, 1.0 ) * star * uStars * ( 1.0 - c ) * smoothstep( 0.05, 0.4, h ) * 0.8;
    }
  }

  // sun disc (skipped in the environment capture: the DirectionalLight already
  // supplies the sun's specular highlight)
  if ( uEnvPass < 0.5 ) {
    col += uSunCol * uSunDisc * ( smoothstep( 0.99965, 0.99985, sd ) * 14.0 + pow( sd, 900.0 ) * 2.0 );
  }

  col = mix( col, uGround, smoothstep( 0.0, -0.06, h ) );

  gl_FragColor = vec4( col, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function skyUniforms(): Record<string, THREE.IUniform> {
  return {
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uGround: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunCol: { value: new THREE.Color() },
    uSunDisc: { value: 0 },
    uCover: { value: 0.3 },
    uCloudCol: { value: new THREE.Color() },
    uCloudShade: { value: new THREE.Color() },
    uStars: { value: 0 },
    uTime: { value: 0 },
    uEnvPass: { value: 0 },
  };
}

function skyMaterial(octaves: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'Sky',
    uniforms: skyUniforms(),
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    defines: { SKY_OCTAVES: octaves },
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    fog: false,
  });
}

function writeSky(u: Record<string, THREE.IUniform>, p: EnvPreset): void {
  (u.uZenith.value as THREE.Color).set(p.zenith).multiplyScalar(p.skyIntensity);
  (u.uHorizon.value as THREE.Color).set(p.horizon).multiplyScalar(p.skyIntensity);
  (u.uGround.value as THREE.Color).set(p.skyGround).multiplyScalar(p.skyIntensity);
  sunDirection(p, u.uSunDir.value as THREE.Vector3);
  (u.uSunCol.value as THREE.Color).set(p.sunColor);
  u.uSunDisc.value = p.sunDisc;
  u.uCover.value = p.cloudCover;
  (u.uCloudCol.value as THREE.Color).set(p.cloudColor).multiplyScalar(p.skyIntensity);
  (u.uCloudShade.value as THREE.Color).set(p.cloudShade).multiplyScalar(p.skyIntensity);
  u.uStars.value = p.stars;
}

export class Sky {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private geo = new THREE.SphereGeometry(1, 32, 16);

  // environment capture
  private envScene = new THREE.Scene();
  private envMat: THREE.ShaderMaterial;
  private envLamps: THREE.Mesh;
  private lampMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  private cubeRT: THREE.WebGLCubeRenderTarget | null = null;
  private cubeCam: THREE.CubeCamera | null = null;
  private pmremRT: THREE.WebGLRenderTarget | null = null;

  constructor(octaves: number) {
    this.mat = skyMaterial(octaves);
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.scale.setScalar(900);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
    this.mesh.matrixAutoUpdate = true;

    this.envMat = skyMaterial(3);
    this.envMat.uniforms.uEnvPass.value = 1;
    this.envMat.toneMapped = false;
    const dome = new THREE.Mesh(this.geo, this.envMat);
    dome.scale.setScalar(400);
    this.envScene.add(dome);

    // Four floodlight banks so wet turf / glossy kit pick up real highlights.
    const lampGeo = new THREE.PlaneGeometry(16, 9);
    const lamps = new THREE.InstancedMesh(lampGeo, this.lampMat, 4);
    const m = new THREE.Matrix4();
    const o = new THREE.Object3D();
    let i = 0;
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        o.position.set(sx * 58, 46, sz * 46);
        o.lookAt(0, 0, 0);
        o.updateMatrix();
        m.copy(o.matrix);
        lamps.setMatrixAt(i++, m);
      }
    this.envLamps = lamps;
    this.envScene.add(lamps);
  }

  setOctaves(octaves: number): void {
    if (this.mat.defines.SKY_OCTAVES === octaves) return;
    this.mat.defines.SKY_OCTAVES = octaves;
    this.mat.needsUpdate = true;
  }

  apply(p: EnvPreset): void {
    writeSky(this.mat.uniforms, p);
    writeSky(this.envMat.uniforms, p);
    this.envLamps.visible = p.flood > 0.05;
    this.lampMat.color.set(p.floodColor).multiplyScalar(26 * p.flood);
  }

  update(time: number, cameraPos: THREE.Vector3): void {
    this.mat.uniforms.uTime.value = time;
    this.mesh.position.copy(cameraPos);
  }

  /**
   * Capture the sky into a cube map of `size`² faces and PMREM-filter it. Returns
   * the texture to assign to `scene.environment`. Previous targets are disposed.
   */
  bakeEnvironment(renderer: THREE.WebGLRenderer, size: number): THREE.Texture {
    if (!this.cubeRT || this.cubeRT.width !== size) {
      this.cubeRT?.dispose();
      this.cubeRT = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false });
      this.cubeCam = new THREE.CubeCamera(1, 1000, this.cubeRT);
    }
    const prevTM = renderer.toneMapping;
    renderer.toneMapping = THREE.NoToneMapping;
    this.cubeCam!.position.set(0, 1.2, 0);
    this.cubeCam!.update(renderer, this.envScene);
    renderer.toneMapping = prevTM;

    const pmrem = new THREE.PMREMGenerator(renderer);
    const next = pmrem.fromCubemap(this.cubeRT.texture);
    pmrem.dispose();
    this.pmremRT?.dispose();
    this.pmremRT = next;
    return next.texture;
  }
}
