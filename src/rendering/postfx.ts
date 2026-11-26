import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { EnvPreset } from './env';

/*
 * HDR post chain (high / ultra tiers):
 *
 *   scene → half-float MSAA target → bloom (mip chain) → final pass
 *
 * The final pass does, in one full-screen draw: ACES tone mapping, a restrained
 * colour grade (saturation / contrast / tint), vignette, sRGB encode and a 1-LSB
 * dither that removes banding in the night sky gradient.
 */

const FinalShader = {
  name: 'StrikersFinal',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    toneMappingExposure: { value: 1 },
    uSaturation: { value: 1 },
    uContrast: { value: 1 },
    uTint: { value: new THREE.Vector3(1, 1, 1) },
    uVignette: { value: 0.3 },
    uAspect: { value: 1.777 },
  },
  vertexShader: /* glsl */ `
    precision highp float;
    uniform mat4 modelViewMatrix;
    uniform mat4 projectionMatrix;
    attribute vec3 position;
    attribute vec2 uv;
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }`,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform float uSaturation;
    uniform float uContrast;
    uniform vec3 uTint;
    uniform float uVignette;
    uniform float uAspect;
    #include <tonemapping_pars_fragment>
    #include <colorspace_pars_fragment>
    varying vec2 vUv;

    float hash12( vec2 p ) {
      vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
      p3 += dot( p3, p3.yzx + 33.33 );
      return fract( ( p3.x + p3.y ) * p3.z );
    }

    void main() {
      vec3 c = texture2D( tDiffuse, vUv ).rgb;
      c = ACESFilmicToneMapping( c );
      // grade in display-linear
      c *= uTint;
      float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
      c = mix( vec3( l ), c, uSaturation );
      c = ( c - 0.18 ) * uContrast + 0.18;
      // vignette (aspect-corrected, smooth, never crushes the centre)
      vec2 q = ( vUv - 0.5 ) * vec2( uAspect, 1.0 );
      float v = smoothstep( 0.35, 1.05, length( q ) );
      c *= 1.0 - uVignette * v * v;
      c = clamp( c, 0.0, 1.0 );
      gl_FragColor = sRGBTransferOETF( vec4( c, 1.0 ) );
      gl_FragColor.rgb += ( hash12( gl_FragCoord.xy ) - 0.5 ) / 255.0;
    }`,
};

export class PostFx {
  private composer: EffectComposer;
  private renderPass: RenderPass;
  private bloom: UnrealBloomPass;
  private final: ShaderPass;
  private rt: THREE.WebGLRenderTarget;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, samples: number) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples,
      depthBuffer: true,
      stencilBuffer: false,
    });
    this.composer = new EffectComposer(renderer, this.rt);
    this.renderPass = new RenderPass(scene, camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.3, 0.55, 1.2);
    // a wide knee so highlights roll into the bloom instead of popping on
    (this.bloom as unknown as { highPassUniforms: Record<string, THREE.IUniform> }).highPassUniforms.smoothWidth.value = 0.8;
    const mat = new THREE.RawShaderMaterial({
      name: FinalShader.name,
      uniforms: THREE.UniformsUtils.clone(FinalShader.uniforms),
      vertexShader: FinalShader.vertexShader,
      fragmentShader: FinalShader.fragmentShader,
      defines: { ACES_FILMIC_TONE_MAPPING: '', SRGB_TRANSFER: '' },
      depthTest: false,
      depthWrite: false,
    });
    this.final = new ShaderPass(mat);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.final);
  }

  applyPreset(p: EnvPreset): void {
    this.bloom.strength = p.bloomStrength;
    this.bloom.threshold = p.bloomThreshold;
    this.bloom.radius = 0.6;
    this.bloom.enabled = p.bloomStrength > 0.001;
    const u = this.final.uniforms;
    u.toneMappingExposure.value = p.exposure;
    u.uSaturation.value = p.saturation;
    u.uContrast.value = p.contrast;
    (u.uTint.value as THREE.Vector3).set(p.tint[0], p.tint[1], p.tint[2]);
    u.uVignette.value = p.vignette;
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
    this.final.uniforms.uAspect.value = width / Math.max(1, height);
  }

  render(dt: number): void {
    this.composer.render(dt);
  }

  dispose(): void {
    this.bloom.dispose();
    this.final.material.dispose();
    this.composer.dispose();
    this.rt.dispose();
  }
}
