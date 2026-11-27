import * as THREE from 'three';
import { envU } from './env';

/*
 * Rain: instanced streak quads living in a box that wraps around a point just in
 * front of the camera, so a few thousand streaks are enough to fill the view at
 * any camera position. Fully GPU-animated (fall, wind slant, wrap, billboarding);
 * the only per-frame CPU work is writing one vec3 uniform.
 */

const BOX = new THREE.Vector3(44, 24, 44);

export class Rain {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private mat: THREE.ShaderMaterial;
  private capacity: number;
  private fwd = new THREE.Vector3();

  constructor(capacity: number) {
    this.capacity = capacity;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const seed = new Float32Array(capacity * 4);
    let s = 0x2545f491;
    const rnd = (): number => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return (s >>> 0) / 4294967296;
    };
    for (let i = 0; i < seed.length; i++) seed[i] = rnd();
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
    g.instanceCount = capacity;
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      name: 'Rain',
      uniforms: {
        uTime: envU.uTime,
        uFlood: envU.uFlood,
        uAmbSky: envU.uAmbSky,
        uCenter: { value: new THREE.Vector3() },
        uBox: { value: BOX },
        uAmount: { value: 1 },
      },
      vertexShader: /* glsl */ `
        attribute vec4 aSeed;
        uniform float uTime;
        uniform vec3 uCenter;
        uniform vec3 uBox;
        varying float vA;
        varying float vV;
        void main() {
          float speed = 17.0 + 8.0 * aSeed.w;
          vec3 wind = vec3( 2.6, 0.0, -1.1 );
          vec3 p = aSeed.xyz * uBox;
          p.y -= uTime * speed;
          p.xz += uTime * wind.xz;
          vec3 rel = mod( p - uCenter + uBox * 0.5, uBox ) - uBox * 0.5;
          vec3 wp = uCenter + rel;
          vec3 dir = normalize( vec3( wind.x, -speed, wind.z ) );
          vec3 toCam = cameraPosition - wp;
          float dist = length( toCam );
          vec3 side = normalize( cross( dir, toCam ) );
          float len = 0.55 + 0.6 * aSeed.w;
          float width = max( 0.005, dist * 0.0007 );
          wp += dir * ( -position.y * len ) + side * position.x * width;
          vV = position.y;
          // fade at the box faces (hides the wrap) and very close to the lens
          vec3 e = 1.0 - abs( rel ) / ( uBox * 0.5 );
          vA = smoothstep( 0.0, 0.18, min( e.x, min( e.y, e.z ) ) ) * smoothstep( 0.6, 3.0, dist ) * step( 0.0, wp.y );
          gl_Position = projectionMatrix * viewMatrix * vec4( wp, 1.0 );
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uFlood;
        uniform vec3 uAmbSky;
        uniform float uAmount;
        varying float vA;
        varying float vV;
        void main() {
          float a = vA * uAmount * 0.17 * sin( vV * 3.14159 );
          if ( a < 0.004 ) discard;
          vec3 col = ( uFlood * 1.5 + uAmbSky * 1.2 ) * vec3( 0.86, 0.92, 1.0 );
          gl_FragColor = vec4( col, a );
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide, // the billboard's winding depends on the view direction
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = 8;
    this.mesh.visible = false;
    this.mesh.name = 'rain';
  }

  /** @param amount 0 (off) … 1, @param count streak budget of the active tier */
  configure(amount: number, count: number): void {
    this.mesh.visible = amount > 0.01;
    this.mat.uniforms.uAmount.value = amount;
    this.geo.instanceCount = Math.min(this.capacity, Math.max(1, Math.round(count * amount)));
  }

  update(camera: THREE.Camera): void {
    if (!this.mesh.visible) return;
    camera.getWorldDirection(this.fwd);
    (this.mat.uniforms.uCenter.value as THREE.Vector3).copy(camera.position).addScaledVector(this.fwd, 15);
  }
}
