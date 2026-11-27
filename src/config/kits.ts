/**
 * Kit design data — one ORIGINAL strip per nation, plus the rules that derive an
 * away strip and a goalkeeper strip from it.
 *
 * Pure data + colour maths (no three.js, no DOM), so it is safe to import from
 * anywhere, including the headless sim.
 *
 * Design rules
 *  - The outfield shirt's PRIMARY colour is never stored here: it is always the
 *    colour the game hands us (`Team.color`). At home that is the nation's
 *    registered colour from `TEAMS`; when the game resolves a clash it passes a
 *    different colour and we build the away strip around it. This keeps the HUD
 *    dots, the radar and the kit in agreement.
 *  - Every design is an invented pattern in the nation's colours. No federation
 *    crests, manufacturer marks or sponsor logos are reproduced.
 *  - Patterns are evaluated in the shirt's bind-pose space by the player shader
 *    (see rendering/kitMaterials.ts), so they need no textures.
 */

/** Shirt pattern ids — the numeric value is what the shader switches on. */
export const PATTERN = {
  solid: 0,
  /** Bold vertical stripes (primary / second). */
  stripes: 1,
  /** Thin vertical lines in `second`. */
  pinstripes: 2,
  /** Horizontal hoops. */
  hoops: 3,
  /** Diagonal sash, shoulder to hip. */
  sash: 4,
  /** Left / right halves. */
  halves: 5,
  /** Horizontal chest band, edged in `trim`. */
  band: 6,
  /** Contrast shoulder panel (pairs well with contrast sleeves). */
  yoke: 7,
  /** Chequerboard. */
  checks: 8,
  /** Chest chevron (V), edged in `trim`. */
  chevron: 9,
} as const;

export type KitPattern = keyof typeof PATTERN;

/** Everything about a strip except the shirt's primary colour. */
export interface KitDesign {
  pattern: KitPattern;
  /** Pattern colour. */
  second: string;
  /** Collar, cuffs and pattern edging. */
  trim: string;
  /** Sleeve colour (defaults to the shirt's primary). */
  sleeves?: string;
  shorts: string;
  shortsTrim?: string;
  socks: string;
  socksTrim?: string;
  /** Number / name colour (auto-corrected if it would not read on the shirt). */
  number: string;
}

export interface NationKit {
  home: KitDesign;
  /** Pattern used by the automatic away strip (kept low-coverage so the clash colour dominates). */
  awayPattern: KitPattern;
  /** Optional hand-tuned overrides for the automatic away strip. */
  away?: Partial<KitDesign>;
}

/** A fully resolved strip, ready for the renderer. All colours are #rrggbb. */
export interface ResolvedKit {
  shirt: string;
  second: string;
  trim: string;
  sleeves: string;
  pattern: KitPattern;
  shorts: string;
  shortsTrim: string;
  socks: string;
  socksTrim: string;
  number: string;
  numberOutline: string;
  /** Keepers wear long sleeves and gloves; outfielders short sleeves. */
  longSleeves: boolean;
  /** Glove colour, or null for bare hands. */
  gloves: string | null;
  /** True when this is the clash (away) strip. */
  away: boolean;
}

const NAVY = '#14213d';
const WHITE = '#f4f6fa';
const BLACK = '#14171c';

/** Home strips, keyed like `TEAMS` / `SQUADS`. */
export const KITS: Record<string, NationKit> = {
  // Royal blue with a white chest band edged in red.
  USA: {
    home: { pattern: 'band', second: WHITE, trim: '#e0263a', shorts: '#16225e', shortsTrim: WHITE, socks: '#2c3fd6', socksTrim: '#e0263a', number: WHITE },
    awayPattern: 'band',
  },
  // Canary yellow, green collar and cuffs, blue shorts, white socks.
  BRAZIL: {
    home: { pattern: 'solid', second: '#0f8a43', trim: '#0f8a43', shorts: '#1b47c4', shortsTrim: WHITE, socks: WHITE, socksTrim: '#0f8a43', number: '#0c6a34' },
    awayPattern: 'yoke',
    away: { second: '#ffd400', trim: '#ffd400' },
  },
  // Sky-blue and white stripes, black shorts.
  ARGENTINA: {
    home: { pattern: 'stripes', second: WHITE, trim: NAVY, shorts: '#15181f', shortsTrim: WHITE, socks: WHITE, socksTrim: '#75aadb', number: NAVY },
    awayPattern: 'pinstripes',
  },
  // Deep navy with pale pinstripes, red trim, white shorts, red socks.
  FRANCE: {
    home: { pattern: 'pinstripes', second: '#5d7fd6', trim: '#e0263a', shorts: WHITE, shortsTrim: '#1e3a8a', socks: '#d81f33', socksTrim: WHITE, number: WHITE },
    awayPattern: 'sash',
    away: { trim: '#e0263a' },
  },
  // White with a navy shoulder panel and red piping, navy shorts.
  ENGLAND: {
    home: { pattern: 'yoke', second: '#1a2a5c', trim: '#d81f33', sleeves: '#e9eef5', shorts: '#1a2a5c', shortsTrim: WHITE, socks: WHITE, socksTrim: '#1a2a5c', number: '#1a2a5c' },
    awayPattern: 'chevron',
    away: { second: '#d81f33', trim: WHITE },
  },
  // Red with gold pinstripes, navy shorts.
  SPAIN: {
    home: { pattern: 'pinstripes', second: '#ffc61a', trim: '#ffc61a', shorts: '#1a2456', shortsTrim: '#ffc61a', socks: '#1a2456', socksTrim: '#d7182a', number: '#ffc61a' },
    awayPattern: 'sash',
    away: { trim: '#ffc61a' },
  },
  // Silver-grey with a black chevron edged in gold, black shorts.
  GERMANY: {
    home: { pattern: 'chevron', second: BLACK, trim: '#f2b90f', shorts: BLACK, shortsTrim: '#9aa0a6', socks: '#c9ced6', socksTrim: BLACK, number: BLACK },
    awayPattern: 'chevron',
    away: { second: '#c9202f', trim: '#f2b90f' },
  },
  // Green with a red sash edged in gold, red socks.
  PORTUGAL: {
    home: { pattern: 'sash', second: '#d3202c', trim: '#f2c21a', shorts: '#0f5f33', shortsTrim: '#f2c21a', socks: '#d3202c', socksTrim: '#1fa055', number: '#f2c21a' },
    awayPattern: 'sash',
    away: { trim: '#d3202c' },
  },
  // Orange with black sleeves, black shorts.
  NETHERLANDS: {
    home: { pattern: 'solid', second: BLACK, trim: WHITE, sleeves: '#17191d', shorts: '#17191d', shortsTrim: '#ff6a00', socks: '#ff6a00', socksTrim: BLACK, number: BLACK },
    awayPattern: 'band',
  },
  // Azure with tonal hoops, white shorts, gold trim.
  ITALY: {
    home: { pattern: 'hoops', second: '#1f6cc0', trim: '#e8c66a', shorts: WHITE, shortsTrim: '#2e86de', socks: '#2e86de', socksTrim: WHITE, number: WHITE },
    awayPattern: 'band',
    away: { trim: '#e8c66a' },
  },
  // Dark green with a white chevron edged in red, white shorts, red socks.
  MEXICO: {
    home: { pattern: 'chevron', second: WHITE, trim: '#d3202c', shorts: WHITE, shortsTrim: '#0b6e4f', socks: '#c81f2c', socksTrim: WHITE, number: WHITE },
    awayPattern: 'chevron',
    away: { trim: '#d3202c' },
  },
  // Red and white checks, white shorts, blue socks.
  CROATIA: {
    home: { pattern: 'checks', second: WHITE, trim: '#1c3f94', shorts: WHITE, shortsTrim: '#1c3f94', socks: '#1c3f94', socksTrim: '#e23e57', number: '#1c3f94' },
    awayPattern: 'yoke',
  },
  // Red with navy sleeves and white piping, white shorts, navy socks.
  NORWAY: {
    home: { pattern: 'solid', second: '#13295b', trim: WHITE, sleeves: '#13295b', shorts: WHITE, shortsTrim: '#13295b', socks: '#13295b', socksTrim: '#c8102e', number: WHITE },
    awayPattern: 'band',
    away: { trim: '#13295b' },
  },
  // Indigo and deep-indigo halves, red trim, white shorts.
  JAPAN: {
    home: { pattern: 'halves', second: '#3b3399', trim: '#e23048', shorts: WHITE, shortsTrim: '#5a4fcf', socks: '#5a4fcf', socksTrim: '#e23048', number: WHITE },
    awayPattern: 'pinstripes',
    away: { trim: '#e23048' },
  },
  // Green with a red chest band edged in white, red shorts.
  MOROCCO: {
    home: { pattern: 'band', second: '#c9202f', trim: WHITE, shorts: '#c9202f', shortsTrim: '#157347', socks: '#157347', socksTrim: '#c9202f', number: WHITE },
    awayPattern: 'band',
    away: { second: '#c9202f', trim: '#157347' },
  },
  // Bright green with a yellow shoulder panel and sleeves, yellow shorts.
  SENEGAL: {
    home: { pattern: 'yoke', second: '#f7d21c', trim: '#d3202c', sleeves: '#f7d21c', shorts: '#f7d21c', shortsTrim: '#11a658', socks: '#11a658', socksTrim: '#f7d21c', number: '#f7d21c' },
    awayPattern: 'chevron',
    away: { second: '#11a658', trim: '#f7d21c' },
  },
};

/** Used for any roster key without a registered design. */
const FALLBACK_KIT: NationKit = {
  home: { pattern: 'solid', second: WHITE, trim: WHITE, shorts: BLACK, socks: BLACK, number: WHITE },
  awayPattern: 'band',
};

/**
 * Keeper palette. Loud, saturated colours that no outfield strip uses, so a
 * keeper can always be found that contrasts with both teams (see pickKeeperColors).
 */
export const GK_PALETTE: readonly string[] = [
  '#f4f01f', // volt yellow
  '#ff3f9d', // hot pink
  '#ff8418', // signal orange
  '#19d3e6', // cyan
  '#9b4dff', // violet
  '#15171b', // black
  '#c7ccd4', // silver
  '#e81e2c', // red
];

/** Mean turf colour — keepers (and nothing else we choose) should not blend into it. */
export const PITCH_COLOR = '#1e8437';

/* ------------------------------------------------------------------ colour maths */

export type RGB = [number, number, number];

/** '#rrggbb' (or '#rgb') → 0–1 sRGB triple. */
export function hexToRgb(hex: string): RGB {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  if (!Number.isFinite(n)) return [0.5, 0.5, 0.5];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function rgbToHex(c: RGB): string {
  const q = (v: number): string =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${q(c[0])}${q(c[1])}${q(c[2])}`;
}

const toLinear = (v: number): number => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));

/** sRGB hex → OKLab (perceptually uniform; Euclidean distance ≈ visual difference). */
export function hexToOklab(hex: string): RGB {
  const [r, g, b] = hexToRgb(hex).map(toLinear) as RGB;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Perceptual distance between two hex colours (0 = identical, ≈1 = black vs white). */
export function colorDistance(a: string, b: string): number {
  const p = hexToOklab(a);
  const q = hexToOklab(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/** Perceptual lightness, 0 (black) – 1 (white). */
export function lightness(hex: string): number {
  return hexToOklab(hex)[0];
}

/** Linear sRGB blend of two hex colours. */
export function mixHex(a: string, b: string, t: number): string {
  const p = hexToRgb(a);
  const q = hexToRgb(b);
  return rgbToHex([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]);
}

/** Darken (t < 0) or lighten (t > 0) by blending toward black / white. */
export function shade(hex: string, t: number): string {
  return t < 0 ? mixHex(hex, '#000000', -t) : mixHex(hex, '#ffffff', t);
}

const sameColor = (a: string, b: string): boolean => colorDistance(a, b) < 0.02;

/** The lighter or darker of white / near-black, whichever reads better on `bg`. */
export function inkOn(bg: string): string {
  return lightness(bg) > 0.68 ? BLACK : WHITE;
}

/** `wanted` if it is clearly visible on `bg`, otherwise the first alternative that is. */
function legible(wanted: string, bg: string, min: number, ...alts: string[]): string {
  if (colorDistance(wanted, bg) >= min) return wanted;
  for (const a of alts) if (colorDistance(a, bg) >= min) return a;
  return inkOn(bg);
}

/* ------------------------------------------------------------------ resolvers */

/**
 * Resolve an outfield strip.
 *
 * @param teamKey   roster key (selects the design)
 * @param kitColor  the primary colour the game wants on the pitch
 * @param homeColor the nation's registered home colour; if `kitColor` differs,
 *                  the away strip is built around `kitColor`
 */
export function resolveOutfieldKit(teamKey: string, kitColor: string, homeColor: string): ResolvedKit {
  const nation = KITS[teamKey] ?? FALLBACK_KIT;
  const h = nation.home;
  const isAway = !sameColor(kitColor, homeColor);

  if (!isAway) {
    const number = legible(h.number, kitColor, 0.32);
    return {
      shirt: kitColor,
      second: h.second,
      trim: h.trim,
      sleeves: h.sleeves ?? kitColor,
      pattern: h.pattern,
      shorts: h.shorts,
      shortsTrim: h.shortsTrim ?? h.trim,
      socks: h.socks,
      socksTrim: h.socksTrim ?? h.trim,
      number,
      numberOutline: outlineFor(number, kitColor, h.pattern, h.second),
      longSleeves: false,
      gloves: null,
      away: false,
    };
  }

  // ---- automatic away strip: the clash colour dominates; the nation's own
  // colours survive as pattern, trim and number so the side is still recognisable.
  const a = nation.away ?? {};
  const light = lightness(kitColor) > 0.6;
  const second = legible(a.second ?? homeColor, kitColor, 0.2, h.second, h.trim);
  const trim = legible(a.trim ?? h.trim, kitColor, 0.12, homeColor, h.second);
  const shorts = a.shorts ?? (light ? shade(kitColor, -0.04) : shade(kitColor, -0.25));
  const socks = a.socks ?? kitColor;
  const number = legible(a.number ?? second, kitColor, 0.34, homeColor);
  const pattern = a.pattern ?? nation.awayPattern;
  return {
    shirt: kitColor,
    second,
    trim,
    sleeves: a.sleeves ?? kitColor,
    pattern,
    shorts,
    shortsTrim: a.shortsTrim ?? second,
    socks,
    socksTrim: a.socksTrim ?? second,
    number,
    numberOutline: outlineFor(number, kitColor, pattern, second),
    longSleeves: false,
    gloves: null,
    away: true,
  };
}

/** Busy shirts get an outlined number so it survives the pattern behind it. */
function outlineFor(number: string, shirt: string, pattern: KitPattern, second: string): string {
  const busy = pattern === 'stripes' || pattern === 'checks' || pattern === 'hoops' || pattern === 'halves';
  if (!busy) return number; // outline == fill → effectively a slightly bolder number
  // pick the outline that separates the number from BOTH pattern colours
  const cands = [WHITE, BLACK, shirt, second];
  let best = cands[0];
  let bestD = -1;
  for (const c of cands) {
    const d = Math.min(colorDistance(c, number), 1) ;
    if (d > bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/** A keeper strip built around one loud colour: tonal chevron, darker shorts, gloves. */
export function resolveKeeperKit(color: string): ResolvedKit {
  const dark = lightness(color) < 0.4;
  const tone = dark ? shade(color, 0.16) : shade(color, -0.22);
  const ink = inkOn(color);
  return {
    shirt: color,
    second: tone,
    trim: ink,
    sleeves: color,
    pattern: 'yoke',
    shorts: dark ? shade(color, 0.05) : shade(color, -0.12),
    shortsTrim: ink,
    socks: color,
    socksTrim: ink,
    number: ink,
    numberOutline: ink,
    longSleeves: true,
    gloves: dark ? '#e9edf2' : '#f5f6f8',
    away: false,
  };
}

/**
 * Choose keeper colours for two sides so each keeper contrasts with BOTH
 * outfield strips, with the turf, and with the other keeper. Greedy max-min over
 * {@link GK_PALETTE} in OKLab: the first keeper takes the colour whose nearest
 * "thing to avoid" is furthest away; the second does the same with the first
 * keeper's colour added to the avoid list.
 *
 * @returns [colour for kitA's keeper, colour for kitB's keeper]
 */
export function pickKeeperColors(kitA: ResolvedKit | null, kitB: ResolvedKit | null): [string, string] {
  const avoid: Array<[string, number]> = [[PITCH_COLOR, 0.8]];
  for (const k of [kitA, kitB]) {
    if (!k) continue;
    avoid.push([k.shirt, 1]);
    // large secondary areas matter too, but less than the shirt body
    const bold = k.pattern === 'stripes' || k.pattern === 'checks' || k.pattern === 'halves' || k.pattern === 'hoops';
    if (k.pattern !== 'solid') avoid.push([k.second, bold ? 0.8 : 0.5]);
    if (!sameColor(k.sleeves, k.shirt)) avoid.push([k.sleeves, 0.6]);
    avoid.push([k.shorts, 0.45]);
  }
  const score = (c: string, extra: string | null): number => {
    let m = Infinity;
    for (const [a, w] of avoid) m = Math.min(m, colorDistance(c, a) / w);
    if (extra) m = Math.min(m, colorDistance(c, extra));
    return m;
  };
  const pick = (extra: string | null): string => {
    let best = GK_PALETTE[0];
    let bestS = -1;
    for (const c of GK_PALETTE) {
      const s = score(c, extra);
      if (s > bestS) {
        bestS = s;
        best = c;
      }
    }
    return best;
  };
  const first = pick(null);
  const second = pick(first);
  return [first, second];
}
