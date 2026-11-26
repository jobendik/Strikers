/**
 * kitAtlas.ts — one shared canvas texture holding the shirt-number digits (0–9)
 * and a slot per player for the name printed above the number.
 *
 * The player shader projects these onto the shirt in bind-pose space, so a
 * number is never "baked" into a per-player texture: every player samples the
 * same atlas and only differs by a couple of uniforms (which digits, which name
 * slot). Channel layout: R = glyph fill, G = fill + outline (a dilated glyph).
 */

import * as THREE from 'three';

const W = 1024;
const H = 512;

/** Digit cells: ten across the top. */
const DIGIT_PITCH = 102;
const DIGIT_W = 100;
const DIGIT_TOP = 2;
const DIGIT_H = 180;

/** Name slots: a grid below the digits. */
const NAME_COLS = 4;
const NAME_W = 256;
const NAME_H = 40;
const NAME_TOP = 192;
const NAME_ROWS = Math.floor((H - NAME_TOP) / NAME_H);
export const NAME_SLOTS = NAME_COLS * NAME_ROWS;

/** Atlas constants the shader needs, in UV units. */
export const ATLAS_LAYOUT = {
  digitPitchU: DIGIT_PITCH / W,
  digitOffsetU: 1 / W,
  digitWidthU: DIGIT_W / W,
  digitBottomV: 1 - (DIGIT_TOP + DIGIT_H) / H,
  digitHeightV: DIGIT_H / H,
};

const FONT_STACK = `Teko, "Arial Narrow", "Helvetica Neue", "DejaVu Sans Condensed", Arial, sans-serif`;

let _canvas: HTMLCanvasElement | null = null;
let _ctx: CanvasRenderingContext2D | null = null;
let _tex: THREE.CanvasTexture | null = null;
const _names: string[] = new Array<string>(NAME_SLOTS).fill('');
let _nextSlot = 0;

function drawGlyphs(text: string, cx: number, cy: number, px: number, maxWidth: number, outline: number): void {
  const x = _ctx!;
  x.font = `700 ${px}px ${FONT_STACK}`;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.lineJoin = 'round';
  // outline first (green only), then the fill on top (red + green)
  x.strokeStyle = '#00ff00';
  x.lineWidth = outline;
  x.strokeText(text, cx, cy, maxWidth);
  x.fillStyle = '#ffff00';
  x.fillText(text, cx, cy, maxWidth);
}

function drawDigits(): void {
  const x = _ctx!;
  x.fillStyle = '#000';
  x.fillRect(0, 0, W, NAME_TOP);
  for (let d = 0; d < 10; d++) {
    const cx = d * DIGIT_PITCH + 1 + DIGIT_W / 2;
    // Teko's digits sit high in the em box; nudge down so they centre in the cell.
    drawGlyphs(String(d), cx, DIGIT_TOP + DIGIT_H / 2 + 8, 212, DIGIT_W - 22, 16);
  }
}

function drawName(slot: number): void {
  const x = _ctx!;
  const col = slot % NAME_COLS;
  const row = Math.floor(slot / NAME_COLS);
  const x0 = col * NAME_W;
  const y0 = NAME_TOP + row * NAME_H;
  x.fillStyle = '#000';
  x.fillRect(x0, y0, NAME_W, NAME_H);
  const name = _names[slot];
  if (name) drawGlyphs(name, x0 + NAME_W / 2, y0 + NAME_H / 2 + 3, 40, NAME_W - 16, 5);
}

function ensure(): THREE.CanvasTexture {
  if (_tex) return _tex;
  _canvas = document.createElement('canvas');
  _canvas.width = W;
  _canvas.height = H;
  _ctx = _canvas.getContext('2d')!;
  _ctx.fillStyle = '#000';
  _ctx.fillRect(0, 0, W, H);
  drawDigits();
  _tex = new THREE.CanvasTexture(_canvas);
  _tex.colorSpace = THREE.NoColorSpace; // coverage masks, not colour
  _tex.generateMipmaps = true;
  _tex.minFilter = THREE.LinearMipmapLinearFilter;
  _tex.magFilter = THREE.LinearFilter;
  _tex.anisotropy = 4;
  _tex.name = 'kit-atlas';

  // The display face (Teko, already used by the HUD) may still be loading when
  // the first player is built; redraw once it arrives so numbers match the UI.
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (fonts?.load) {
    void fonts
      .load('700 64px Teko')
      .then(() => {
        drawDigits();
        for (let i = 0; i < NAME_SLOTS; i++) if (_names[i]) drawName(i);
        _tex!.needsUpdate = true;
      })
      .catch(() => undefined);
  }
  return _tex;
}

/** The shared atlas texture (created on first use). */
export function getKitAtlas(): THREE.CanvasTexture {
  return ensure();
}

/** Reserve a name slot for one player mesh (stable for that mesh's lifetime). */
export function allocNameSlot(): number {
  const s = _nextSlot % NAME_SLOTS;
  _nextSlot++;
  return s;
}

/**
 * Write `name` into `slot` and return its atlas rectangle as (u0, v0, width, height).
 * Redraws only when the name actually changes.
 */
export function setSlotName(slot: number, name: string, out: THREE.Vector4): THREE.Vector4 {
  ensure();
  const clean = name.toUpperCase().slice(0, 14);
  if (_names[slot] !== clean) {
    _names[slot] = clean;
    drawName(slot);
    _tex!.needsUpdate = true;
  }
  const col = slot % NAME_COLS;
  const row = Math.floor(slot / NAME_COLS);
  const y0 = NAME_TOP + row * NAME_H;
  return out.set((col * NAME_W) / W, 1 - (y0 + NAME_H) / H, NAME_W / W, NAME_H / H);
}
