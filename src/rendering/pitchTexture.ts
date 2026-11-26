import * as THREE from 'three';

/*
 * Procedural turf detail textures (generated once at boot, tiling).
 *
 * The pitch itself is drawn by a shader (stripes, markings, wear are analytic —
 * see pitch.ts); these two small textures only supply the *stochastic* part:
 *
 *   detail  R = blade-scale grain (thousands of short, mostly-aligned strokes)
 *           G = clump-scale variation
 *           B = broad mottling (used for colour drift, puddles, wear break-up)
 *   normal  RG = tangent-space slope of the blade grain (for sparkle / relief
 *           under low sun and floodlights when the camera is at pitch level)
 *
 * Using textures instead of in-shader noise matters at the broadcast camera's
 * grazing angle: mip-mapping + anisotropic filtering pre-filter the grain, where
 * hash noise would shimmer.
 */

export interface TurfTextures {
  detail: THREE.Texture;
  normal: THREE.Texture | null;
}

function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d', { willReadFrequently: true })!];
}

/** Draw `fn` at all 9 wrap offsets so the result tiles seamlessly. */
function wrapped(size: number, x: number, y: number, r: number, fn: (x: number, y: number) => void): void {
  for (let oy = -1; oy <= 1; oy++)
    for (let ox = -1; ox <= 1; ox++) {
      const px = x + ox * size;
      const py = y + oy * size;
      if (px < -r || px > size + r || py < -r || py > size + r) continue;
      fn(px, py);
    }
}

function blades(size: number, rnd: () => number): Uint8ClampedArray {
  const [, g] = canvas(size);
  g.fillStyle = '#6a6a6a';
  g.fillRect(0, 0, size, size);
  const n = Math.round(size * size * 0.22);
  g.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const len = (4 + rnd() * 9) * (size / 512);
    const ang = Math.PI / 2 + (rnd() - 0.5) * 1.1; // mostly along +v
    const v = Math.round(40 + rnd() * 215);
    g.strokeStyle = `rgba(${v},${v},${v},${0.55 + rnd() * 0.4})`;
    g.lineWidth = (0.8 + rnd() * 1.1) * (size / 512);
    const dx = Math.cos(ang) * len;
    const dy = Math.sin(ang) * len;
    wrapped(size, x, y, len + 2, (px, py) => {
      g.beginPath();
      g.moveTo(px, py);
      g.lineTo(px + dx, py + dy);
      g.stroke();
    });
  }
  return g.getImageData(0, 0, size, size).data;
}

function blotches(size: number, rnd: () => number, count: number, rMin: number, rMax: number): Uint8ClampedArray {
  const [, g] = canvas(size);
  g.fillStyle = '#808080';
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < count; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = (rMin + rnd() * (rMax - rMin)) * size;
    const light = rnd() > 0.5;
    const a = 0.1 + rnd() * 0.22;
    wrapped(size, x, y, r, (px, py) => {
      const gr = g.createRadialGradient(px, py, 0, px, py, r);
      gr.addColorStop(0, light ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`);
      gr.addColorStop(1, light ? 'rgba(255,255,255,0)' : 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(px - r, py - r, r * 2, r * 2);
    });
  }
  return g.getImageData(0, 0, size, size).data;
}

export function makeTurfTextures(size: number, withNormal: boolean, anisotropy: number): TurfTextures {
  const rnd = prng(0x51f15e);
  const fine = blades(size, rnd);
  const mid = blotches(size, rnd, 260, 0.02, 0.07);
  const large = blotches(size, rnd, 46, 0.1, 0.3);

  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = fine[i * 4];
    data[i * 4 + 1] = mid[i * 4];
    data[i * 4 + 2] = large[i * 4];
    data[i * 4 + 3] = 255;
  }
  const mk = (d: BufferSource): THREE.DataTexture => {
    const t = new THREE.DataTexture(d, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = anisotropy;
    t.colorSpace = THREE.NoColorSpace;
    t.needsUpdate = true;
    return t;
  };
  const detail = mk(data);

  let normal: THREE.Texture | null = null;
  if (withNormal) {
    const nd = new Uint8Array(size * size * 4);
    const h = (x: number, y: number): number => fine[(((y + size) % size) * size + ((x + size) % size)) * 4] / 255;
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const dx = h(x + 1, y) - h(x - 1, y);
        const dy = h(x, y + 1) - h(x, y - 1);
        const i = (y * size + x) * 4;
        nd[i] = Math.max(0, Math.min(255, 127.5 - dx * 300));
        nd[i + 1] = Math.max(0, Math.min(255, 127.5 - dy * 300));
        nd[i + 2] = 255;
        nd[i + 3] = 255;
      }
    normal = mk(nd);
  }
  return { detail, normal };
}

/**
 * Seat tile for the terraces: one seat wide, repeated along the row.
 * Top half (v 0.5‥1) = riser with the seat back seen from the front,
 * bottom half (v 0‥0.5) = tread seen from above with the folded seat pan.
 */
export function makeSeatTexture(anisotropy: number): THREE.CanvasTexture {
  const W = 64;
  const H = 128;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  // riser
  g.fillStyle = '#4b4f57';
  g.fillRect(0, 0, W, 64);
  const back = g.createLinearGradient(0, 4, 0, 60);
  back.addColorStop(0, '#2f5fae');
  back.addColorStop(0.25, '#1d438a');
  back.addColorStop(1, '#122c60');
  g.fillStyle = back;
  g.beginPath();
  g.roundRect(7, 5, W - 14, 52, 9);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.16)';
  g.fillRect(12, 8, W - 24, 4);
  // tread
  g.fillStyle = '#6c7179';
  g.fillRect(0, 64, W, 64);
  g.fillStyle = '#1a3d80';
  g.beginPath();
  g.roundRect(8, 66, W - 16, 26, 7);
  g.fill();
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(0, 92, W, 5);
  g.fillStyle = '#8a8f96';
  g.fillRect(0, 122, W, 6); // nosing
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  return t;
}
