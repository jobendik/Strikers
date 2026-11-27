import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { on, pulse } from '../core/bus';
import { camera, world } from './scene';
import { buildBowl } from './bowl';
import { Crowd } from './crowd';
import { Pitch } from './pitch';
import { Goals, unlitWhite } from './goalNet';
import { LedBoards } from './ledBoards';
import { buildProps } from './props';
import { Rain } from './rain';
import { makeSeatTexture } from './pitchTexture';
import { glowMaterial, lampMaterial, stadiumMaterial } from './materials';
import { getEnvPreset, onEnvChange, type EnvPreset } from './env';
import { getQuality, onQualityChange, type QualityProfile } from './quality';

/*
 * Stadium orchestration.
 *
 *   buildStadium()            build every environment system once (boot)
 *   updateStadium(dt)         all environment animation, once per rendered frame
 *   setCrowdColors(h, a)      colour the supporter sections (+ scoreboard, LEDs)
 *   setScoreboardTeams(h, a)  optional: names on the scoreboards
 *   netImpulse(side, y, z, s) poke a goal net (the `net` bus event does this itself)
 *
 * The sim talks to this module only through the event bus (`net`, `goal`, `post`)
 * and the `pulse` block; nothing here mutates simulation state.
 *
 * Draw calls (static): pitch · structure · seats · lamps · glow · crowd · LED
 * boards · LED ribbon · scoreboards · goal frames · 2 nets · dugout glass ·
 * corner flags · rain (rain preset only) · sky. See docs/RENDERING_DESIGN.md.
 */

let crowd: Crowd | null = null;
let pitch: Pitch | null = null;
let goals: Goals | null = null;
let leds: LedBoards | null = null;
let rain: Rain | null = null;
let roofProxy: THREE.Mesh | null = null;
let seatTex: THREE.Texture | null = null;
let homeColor: THREE.ColorRepresentation = '#d8232a';
let awayColor: THREE.ColorRepresentation = '#1e63d8';
let homeName: string | undefined;
let awayName: string | undefined;
let built = false;

/** Everything this module adds lives under one group (handy for measurement). */
export const stadiumRoot = new THREE.Group();
stadiumRoot.name = 'stadium';

const _white = new THREE.Color();

function applyPreset(p: EnvPreset): void {
  const q = getQuality();
  pitch?.applyPreset(p);
  if (roofProxy) roofProxy.castShadow = p.roofShadow > 0;
  goals?.setLight(unlitWhite(_white));
  rain?.configure(p.rain, q.rainCount);
}

function applyQuality(q: QualityProfile): void {
  pitch?.applyQuality(q);
  crowd?.setDensity(q.crowdDensity);
  crowd?.setAnisotropy(Math.min(4, q.anisotropy));
  leds?.setAnisotropy(q.anisotropy);
  if (seatTex) {
    seatTex.anisotropy = q.anisotropy;
    seatTex.needsUpdate = true;
  }
  rain?.configure(getEnvPreset().rain, q.rainCount);
}

/** Builds the full stadium. Call once at boot. */
export function buildStadium(): void {
  if (built) return;
  built = true;
  const q = getQuality();
  const add = (m: THREE.Object3D): void => void stadiumRoot.add(m);

  pitch = new Pitch(q);
  add(pitch.mesh);

  const bowl = buildBowl();
  leds = new LedBoards(q.maxTexture);
  leds.setTeams(homeColor, awayColor, homeName, awayName);
  const props = buildProps();

  // One merged static mesh for all vertex-coloured structure.
  const parts = [bowl.structure, leds.housing, props.solid];
  const structureGeo = mergeGeometries(parts, false) ?? bowl.structure;
  if (structureGeo !== bowl.structure) parts.forEach((g) => g.dispose());
  seatTex = makeSeatTexture(q.anisotropy);
  const structure = new THREE.Mesh(structureGeo, stadiumMaterial('StadiumStructure'));
  structure.name = 'structure';
  const seats = new THREE.Mesh(bowl.seats, stadiumMaterial('StadiumSeats', seatTex));
  seats.name = 'seats';
  const lamps = new THREE.Mesh(bowl.lamps, lampMaterial());
  lamps.name = 'lamps';
  for (const m of [structure, seats, lamps]) {
    m.matrixAutoUpdate = false;
    m.frustumCulled = false;
    add(m);
  }
  leds.meshes.forEach(add);
  add(props.glass);
  add(props.flags);

  // floodlight halos (one instanced draw)
  {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const c = new Float32Array(bowl.floodHeads.length * 3);
    const s = new Float32Array(bowl.floodHeads.length);
    bowl.floodHeads.forEach((h, i) => {
      c[i * 3] = h.x;
      c[i * 3 + 1] = h.y;
      c[i * 3 + 2] = h.z;
      s[i] = 24;
    });
    g.setAttribute('aCenter', new THREE.InstancedBufferAttribute(c, 3));
    g.setAttribute('aSize', new THREE.InstancedBufferAttribute(s, 1));
    const glow = new THREE.Mesh(g, glowMaterial());
    glow.name = 'floodGlow';
    glow.frustumCulled = false;
    glow.renderOrder = 6;
    add(glow);
  }

  // Invisible shadow caster standing in for the roof + outer shell: puts the
  // stand's shadow on the players and the pitch inside the shadow frustum. (The
  // stands themselves use the matching analytic shadow — see env.ts.)
  roofProxy = new THREE.Mesh(bowl.roofProxy, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false, side: THREE.DoubleSide }));
  roofProxy.name = 'roofProxy';
  roofProxy.frustumCulled = false;
  roofProxy.castShadow = true;
  add(roofProxy);

  goals = new Goals();
  add(goals.group);

  crowd = new Crowd(bowl.seatList, q.crowdDensity);
  crowd.setColors(homeColor, awayColor);
  add(crowd.mesh);

  rain = new Rain(12000);
  add(rain.mesh);

  world.add(stadiumRoot);
  // dev / QA hook (see scene.ts)
  const gfx = (window as unknown as { __gfx?: Record<string, unknown> }).__gfx;
  if (gfx) gfx.stadium = { updateStadium, netImpulse, setCrowdColors, setScoreboardTeams, root: stadiumRoot };

  applyPreset(getEnvPreset());
  applyQuality(q);
  onEnvChange(applyPreset);
  onQualityChange(applyQuality);

  // --- sim → presentation ---
  on('net', (e) => goals?.hit(e.side, e.x, e.y, e.z, e.vx, e.vy, e.vz, e.speed));
  on('goal', (e) => {
    crowd?.goal(e.team);
    leds?.goalFlash(e.team);
  });
  on('post', (e) => {
    // the frame rings: a small shiver through the net nearest the impact
    const side: 1 | -1 = e.x >= 0 ? 1 : -1;
    goals?.push(side, Math.min(e.y, 2.2), e.z * 0.9, Math.min(8, e.speed * 0.25));
  });
}

/**
 * Colour the home / away supporter sections, the scoreboard panels and the LED
 * goal take-over. Accepts anything THREE.Color does (0xrrggbb, '#rrggbb').
 * Safe to call before buildStadium().
 */
export function setCrowdColors(home: THREE.ColorRepresentation, away: THREE.ColorRepresentation): void {
  homeColor = home;
  awayColor = away;
  crowd?.setColors(home, away);
  leds?.setTeams(home, away, homeName, awayName);
}

/** Optional: short team names (≤ 9 chars shown) for the stadium scoreboards. */
export function setScoreboardTeams(home: string, away: string): void {
  homeName = home;
  awayName = away;
  leds?.setTeams(homeColor, awayColor, home, away);
}

/**
 * Push the back of goal `side`'s net outward at height `y`, lateral position
 * `z`. `strength` is roughly a ball speed in u/s (6 = a roll-in, 30 = a rocket).
 */
export function netImpulse(side: 1 | -1, y: number, z: number, strength: number): void {
  goals?.push(side, y, z, strength);
}

/**
 * Per-frame environment animation (crowd, nets, LED boards, flags…). Called once
 * per rendered frame with the real (undilated) frame delta in seconds.
 */
export function updateStadium(dt: number): void {
  if (!built) return;
  const live = pulse.live || pulse.state === 'play' || pulse.state === 'celebrate' || pulse.state === 'shootout';
  crowd?.update(dt, pulse.threat[0], pulse.threat[1], live ? 0.2 : 0.1);
  leds?.update(dt, pulse.score[0], pulse.score[1]);
  goals?.update(dt, pulse.ballX, pulse.ballY, pulse.ballZ, live);
  rain?.update(camera);
}
