/**
 * playerLook.ts — turns a PlayerLook (who is this player?) into uniform values
 * on that player's material: resolved kit, keeper strip, squad number + name,
 * and seeded per-player variety (skin tone, hair, boots, build).
 */

import * as THREE from 'three';
import { teamMeta } from '../config/players';
import {
  PATTERN,
  colorDistance,
  pickKeeperColors,
  resolveKeeperKit,
  resolveOutfieldKit,
  shade,
  type ResolvedKit,
} from '../config/kits';
import { SLEEVE_LONG, SLEEVE_SHORT, type PlayerUniforms } from './kitMaterials';
import { setSlotName } from './kitAtlas';

/** Everything the renderer needs to know to dress one player. */
export interface PlayerLook {
  /** Roster key (selects the nation's kit design). */
  teamKey: string;
  /** The clash-resolved PRIMARY outfield colour the game wants (Team.color). */
  kitColor: string;
  isGK: boolean;
  /** +1 / −1 — which half the team defends; used to pair up the two keepers. */
  side: number;
  num: number;
  name: string;
  /** Stable per-player seed for skin / hair / boots variety. */
  seed: number;
}

/** Renderer-side state attached to each player Group (userData.lookState). */
export interface LookState {
  uniforms: PlayerUniforms;
  /** The scaled model root — per-player build variation is applied to it. */
  root: THREE.Object3D;
  baseScale: number;
  nameSlot: number;
  look: PlayerLook | null;
  /** Called with the resolved kit after every (re)dress — recolours the indicators. */
  onKit?: (kit: ResolvedKit) => void;
}

/** Stable 32-bit FNV-1a hash of a player's identity → `PlayerLook.seed`. */
export function lookSeed(teamKey: string, name: string, num: number): number {
  const s = `${teamKey}|${name}|${num}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Small deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ variety palettes */

/** Skin albedo, light → deep. */
const SKIN_TONES = ['#f1cdb4', '#e6b998', '#d9a47e', '#c58a64', '#ab7049', '#8d5636', '#6c3f27', '#4f2c1b'];

/** Hair colours; the index ranges below pick plausible ones per skin tone. */
const HAIR = ['#0d0c0b', '#1f150f', '#3a2416', '#5b3a22', '#8a6238', '#c3a063', '#8a3a18', '#77777a'];

/** Boot uppers with a matching sole plate. */
const BOOTS: ReadonlyArray<readonly [string, string]> = [
  ['#111316', '#f2f3f5'],
  ['#f3f4f6', '#15171b'],
  ['#d9ff1f', '#15171b'],
  ['#ff5a1f', '#f2f3f5'],
  ['#17c3ff', '#f2f3f5'],
  ['#ff2e7e', '#15171b'],
  ['#e11d2e', '#f2f3f5'],
  ['#2447ff', '#d9ff1f'],
  ['#f6c400', '#15171b'],
  ['#111316', '#ff5a1f'],
];

/* ------------------------------------------------------------------ keeper pairing */

/**
 * Keepers must contrast with BOTH outfield strips, but a look is applied one
 * player at a time. We therefore remember each side's current outfield kit and
 * every live player, and re-pick the two keeper colours whenever either side
 * changes strip.
 */
const _sideKit = new Map<number, ResolvedKit>();
const _players = new Set<LookState>();
let _gkColors: [string, string] = ['#f4f01f', '#ff3f9d'];
let _gkKey = '';

function refreshKeeperColors(): void {
  const a = _sideKit.get(1) ?? null;
  const b = _sideKit.get(-1) ?? null;
  const key = `${a?.shirt}|${a?.second}|${a?.pattern}|${a?.shorts}|${b?.shirt}|${b?.second}|${b?.pattern}|${b?.shorts}`;
  if (key === _gkKey) return;
  _gkKey = key;
  _gkColors = pickKeeperColors(a, b);
  for (const st of _players) if (st.look?.isGK) dress(st, st.look);
}

const keeperColor = (side: number): string => (side > 0 ? _gkColors[0] : _gkColors[1]);

/* ------------------------------------------------------------------ applying */

function writeKit(u: PlayerUniforms, kit: ResolvedKit): void {
  u.uShirt.value.set(kit.shirt);
  u.uSecond.value.set(kit.second);
  u.uTrim.value.set(kit.trim);
  u.uSleeve.value.set(kit.sleeves);
  u.uShorts.value.set(kit.shorts);
  u.uShortsTrim.value.set(kit.shortsTrim);
  u.uSocks.value.set(kit.socks);
  u.uSocksTrim.value.set(kit.socksTrim);
  u.uNumber.value.set(kit.number);
  u.uNumOutline.value.set(kit.numberOutline);
  u.uKitParams.value.x = PATTERN[kit.pattern];
  u.uKitParams.value.y = kit.longSleeves ? SLEEVE_LONG : SLEEVE_SHORT;
  u.uKitParams.value.z = kit.gloves ? 1 : 0;
  if (kit.gloves) u.uGlove.value.set(kit.gloves);
}

function writeVariety(st: LookState, look: PlayerLook, kit: ResolvedKit): void {
  const u = st.uniforms;
  const r = rng(look.seed);

  const tone = Math.floor(r() * SKIN_TONES.length);
  u.uSkin.value.set(SKIN_TONES[tone]);

  // lighter skin → the whole hair range; deeper skin → black / dark brown
  const hairMax = tone <= 2 ? HAIR.length : tone <= 4 ? 4 : 2;
  u.uHair.value.set(HAIR[Math.floor(r() * hairMax)]);
  // ~1 in 4 shaved; the rest cropped
  u.uKitParams.value.w = r() < 0.26 ? 0 : 1;

  // boots: skip any pair that would vanish against this player's own socks
  let boot = BOOTS[Math.floor(r() * BOOTS.length)];
  for (let i = 0; i < BOOTS.length && colorDistance(boot[0], kit.socks) < 0.16; i++) {
    boot = BOOTS[(BOOTS.indexOf(boot) + 1) % BOOTS.length];
  }
  u.uBoot.value.set(boot[0]);
  u.uBootSole.value.set(boot[1]);

  // subtle build variation (±3 % height, ±4 % width); keepers skew tall
  const h = 0.975 + r() * 0.055 + (look.isGK ? 0.02 : 0);
  const w = h * (0.97 + r() * 0.07);
  st.root.scale.set(st.baseScale * w, st.baseScale * h, st.baseScale * w);
}

function dress(st: LookState, look: PlayerLook): void {
  const home = teamMeta(look.teamKey).color;
  const kit = look.isGK ? resolveKeeperKit(keeperColor(look.side)) : resolveOutfieldKit(look.teamKey, look.kitColor, home);
  const u = st.uniforms;
  writeKit(u, kit);
  writeVariety(st, look, kit);

  const n = Math.max(0, Math.min(99, Math.round(look.num)));
  u.uDigits.value.set(n >= 10 ? Math.floor(n / 10) : -1, n % 10);
  setSlotName(st.nameSlot, look.name, u.uNameRect.value);
  st.onKit?.(kit);
}

/** Dress one player. Safe to call as often as the identity changes. */
export function applyLookState(st: LookState, look: PlayerLook): void {
  st.look = { ...look };
  _players.add(st);
  if (!look.isGK) {
    // the outfield strip for this side may have changed → keepers may need to react
    _sideKit.set(look.side > 0 ? 1 : -1, resolveOutfieldKit(look.teamKey, look.kitColor, teamMeta(look.teamKey).color));
  }
  dress(st, st.look);
  refreshKeeperColors();
}

/** Legacy path: "tint the jersey". Keeps the current identity, swaps the primary colour. */
export function setPrimaryColor(st: LookState, color: string): void {
  const prev = st.look;
  applyLookState(st, {
    teamKey: prev?.teamKey ?? '',
    kitColor: color,
    isGK: false,
    side: prev?.side ?? 1,
    num: prev?.num ?? 0,
    name: prev?.name ?? '',
    seed: prev?.seed ?? 1,
  });
}

/** A neutral indicator colour helper: darker / lighter variant for outlines. */
export function outlineShade(hex: string): string {
  return shade(hex, -0.75);
}
