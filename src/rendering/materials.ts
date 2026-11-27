import * as THREE from 'three';
import { ENV_PARS, ROOF_SHADOW, STADIUM_LIGHT, envU } from './env';

/*
 * Materials for the static stadium. They deliberately do NOT use three's PBR
 * light loop: the stands cover a large part of many frames and are diffuse
 * concrete / plastic / steel, so a small custom model (hemisphere ambient + one
 * key light with an analytic roof shadow + floodlight spill) is both cheaper —
 * no 4-light GGX evaluation, no shadow-map taps — and easier to art-direct per
 * preset. All of them share the `envU` uniform block by reference.
 */

const VERT = /* glsl */ `
varying vec3 vWp;
varying vec3 vN;
varying vec3 vCol;
varying vec2 vUv;
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4( position, 1.0 );
  vWp = wp.xyz;
  vN = normalize( mat3( modelMatrix ) * normal );
  vCol = color;
  vUv = uv;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
${ENV_PARS}
varying vec3 vWp;
varying vec3 vN;
varying vec3 vCol;
varying vec2 vUv;
#ifdef S_MAP
uniform sampler2D uMap;
#endif
#include <fog_pars_fragment>
${ROOF_SHADOW}
${STADIUM_LIGHT}
void main() {
  vec3 n = normalize( vN );
  if ( ! gl_FrontFacing ) n = -n;
  vec3 albedo = vCol;
  #ifdef S_MAP
  albedo *= texture2D( uMap, vUv ).rgb;
  #endif
  vec3 col = albedo * stadiumLight( vWp, n );
  gl_FragColor = vec4( col, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** Lit, vertex-coloured (optionally textured) static stadium surface. */
export function stadiumMaterial(name: string, map?: THREE.Texture): THREE.ShaderMaterial {
  const uniforms: Record<string, THREE.IUniform> = { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...envU };
  if (map) uniforms.uMap = { value: map };
  return new THREE.ShaderMaterial({
    name,
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    defines: map ? { S_MAP: '' } : {},
    vertexColors: true,
    side: THREE.DoubleSide,
    fog: true,
  });
}

const LAMP_FRAG = /* glsl */ `
${ENV_PARS}
varying vec3 vCol;
varying vec2 vUv;
#include <fog_pars_fragment>
void main() {
  // uv.x/uv.y count lamps: draw a grid of round lenses
  vec2 g = fract( vUv ) - 0.5;
  float lens = smoothstep( 0.46, 0.30, length( g ) );
  float on = mix( 0.02, 1.0, uFloodOn );
  vec3 col = vCol * ( 0.05 + lens * on * 22.0 );
  gl_FragColor = vec4( col, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** Emissive floodlight lenses (vertex colour × floodlight level, HDR). */
export function lampMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'Lamps',
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...envU },
    vertexShader: VERT,
    fragmentShader: LAMP_FRAG,
    vertexColors: true,
    side: THREE.DoubleSide,
    fog: true,
  });
}

/** Camera-facing additive glow quads (floodlight halos). */
export function glowMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'Glow',
    uniforms: { ...envU },
    vertexShader: /* glsl */ `
      attribute vec3 aCenter;
      attribute float aSize;
      varying vec2 vQ;
      void main() {
        vQ = position.xy;
        vec4 mv = viewMatrix * vec4( aCenter, 1.0 );
        mv.xy += position.xy * aSize;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      ${ENV_PARS}
      varying vec2 vQ;
      void main() {
        float r = length( vQ );
        float g = exp( -r * r * 7.0 ) * 0.9 + exp( -r * 2.6 ) * 0.22;
        g *= smoothstep( 1.0, 0.6, r );
        // horizontal anamorphic streak
        g += exp( -abs( vQ.y ) * 26.0 ) * exp( -abs( vQ.x ) * 2.4 ) * 0.35;
        vec3 col = vec3( 0.92, 0.96, 1.0 ) * g * uFloodOn * 2.2;
        gl_FragColor = vec4( col, 1.0 );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });
}
