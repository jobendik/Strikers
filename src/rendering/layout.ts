import { CFG } from '../config/constants';

/*
 * Single source of truth for the stadium's dimensions (world units = metres).
 *
 * The bowl is a rounded rectangle swept around the pitch. Every position in a
 * stand is expressed as (station along the perimeter, d = distance outward from
 * the stand front, y = height); geometry, the crowd, the analytic roof shadow in
 * the shaders and the shadow-map proxy are all derived from these numbers, so
 * they always agree with each other.
 *
 * Camera constraint (see docs/RENDERING_DESIGN.md): the gameplay cameras sit on
 * the +Z side — broadcast (y 17, z ≈ 43…46, fov 30), tele (y 12.5, z 45, fov 24),
 * dynamic (y 9.5, z 34, fov 38) — looking down at the ball. On that side nothing
 * may rise above y = 0.45·(z − halfW) between the touchline and z = 36. So the
 * +Z stand is: a 26.6° lower tier starting at z = halfW + 8 (seated head line
 * ≈ 0.50·(z − 28) + 2.4, standing fans stay under the limit), then an open
 * broadcast deck at y ≈ 8 from z = 42 to 48 that the cameras fly over, with the
 * glazed boxes and a short upper tier behind them. The roof clears y = 27.
 */

const HL = CFG.halfL;
const HW = CFG.halfW;

export const LAYOUT = {
  /** Grass run-off beyond the touchlines / goal lines. */
  grassMargin: 2.6,
  /** LED perimeter boards: offset from the lines. */
  boardSide: 4.0,
  boardEnd: 4.6,
  boardH: 0.95,

  /** Stand front (inner rounded rectangle): half extents and corner radius. */
  hx: HL + 8,
  hz: HW + 8,
  rc: 10,

  /** Front wall. */
  wallH: 1.15,
  railH: 1.75,

  /** Lower tier. */
  row0: 0.5, // d of the first riser
  rowDepth: 0.8,
  lowerRows: 17,
  lowerRise: 0.4,
  lowerY0: 1.15,

  /** Camera-side main stand: broadcast deck behind the lower tier, then a short upper tier. */
  mainDeckD: 20.0,
  mainUpperRows: 8,
  mainUpperY0: 11.6,

  /** Upper tier (horseshoe: every side except +Z). */
  upperD0: 11.6,
  upperY0: 11.2,
  upperRows: 16,
  upperRise: 0.56,
  fasciaH: 2.2,

  /** Outer shell + roof. */
  backD: 27.0,
  roofInnerD: 7.0,
  roofInnerY: 28.6,
  roofBackY: 25.2,

  /** Seats. */
  seatPitch: 0.52,
  bayLen: 7.6,
  aisleW: 0.95,
} as const;

/** Height of the tread (floor) of lower-tier / wall-stand row `r` (0-based). */
export function lowerRowY(r: number): number {
  return LAYOUT.lowerY0 + r * LAYOUT.lowerRise;
}
export function upperRowY(r: number): number {
  return LAYOUT.upperY0 + r * LAYOUT.upperRise;
}
/** Outward distance of the front edge of row `r`. */
export function lowerRowD(r: number): number {
  return LAYOUT.row0 + r * LAYOUT.rowDepth;
}
export function upperRowD(r: number): number {
  return LAYOUT.upperD0 + 0.4 + r * LAYOUT.rowDepth;
}
/** Short upper tier of the camera-side main stand (behind the broadcast deck). */
export function mainUpperY(r: number): number {
  return LAYOUT.mainUpperY0 + r * LAYOUT.upperRise;
}
export function mainUpperD(r: number): number {
  return LAYOUT.mainDeckD + 0.4 + r * LAYOUT.rowDepth;
}

/** Roof underside height at outward distance d. */
export function roofY(d: number): number {
  const t = (d - LAYOUT.roofInnerD) / (LAYOUT.backD - LAYOUT.roofInnerD);
  return LAYOUT.roofInnerY + (LAYOUT.roofBackY - LAYOUT.roofInnerY) * Math.min(1, Math.max(0, t));
}

/* ------------------------------ bowl sections ------------------------------ */

export type SectionId = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

/**
 * One stretch of the bowl perimeter. `u` runs 0..1 along it (counter-clockwise
 * seen from above, i.e. N → W → S → E when walking with the pitch on the left is
 * NOT assumed — each section just maps its own u), `d` is the outward distance
 * from the stand front.
 */
export interface Section {
  id: SectionId;
  corner: boolean;
  /** true for every section that carries the upper tier. */
  upper: boolean;
  /** true for the single-tier +Z stand. */
  wall: boolean;
  /** Perimeter length at outward distance d. */
  length(d: number): number;
  /** World position for (u, d, y). Writes into `out` (x, y, z). */
  point(u: number, d: number, y: number, out: { x: number; y: number; z: number }): void;
  /** Outward horizontal normal at u (unit, xz). */
  normal(u: number, out: { x: number; z: number }): void;
}

function straight(id: SectionId, ax: number, az: number, bx: number, bz: number, nx: number, nz: number, upper: boolean, wall: boolean): Section {
  const len = Math.hypot(bx - ax, bz - az);
  return {
    id,
    corner: false,
    upper,
    wall,
    length: () => len,
    point(u, d, y, out) {
      out.x = ax + (bx - ax) * u + nx * d;
      out.y = y;
      out.z = az + (bz - az) * u + nz * d;
    },
    normal(_u, out) {
      out.x = nx;
      out.z = nz;
    },
  };
}

function corner(id: SectionId, cx: number, cz: number, a0: number, upper: boolean): Section {
  const r0 = LAYOUT.rc;
  return {
    id,
    corner: true,
    upper,
    wall: false,
    length: (d) => (r0 + d) * Math.PI * 0.5,
    point(u, d, y, out) {
      const a = a0 + u * Math.PI * 0.5;
      out.x = cx + Math.cos(a) * (r0 + d);
      out.y = y;
      out.z = cz + Math.sin(a) * (r0 + d);
    },
    normal(u, out) {
      const a = a0 + u * Math.PI * 0.5;
      out.x = Math.cos(a);
      out.z = Math.sin(a);
    },
  };
}

const sx = LAYOUT.hx - LAYOUT.rc; // straight half-length along x
const sz = LAYOUT.hz - LAYOUT.rc;

/** The eight sections of the bowl. N = −Z (the hero stand facing the camera). */
export const SECTIONS: readonly Section[] = [
  straight('N', sx, -LAYOUT.hz, -sx, -LAYOUT.hz, 0, -1, true, false),
  corner('NW', -sx, -sz, Math.PI, true), // angle π → 3π/2 : from −X round to −Z
  straight('W', -LAYOUT.hx, sz, -LAYOUT.hx, -sz, -1, 0, true, false),
  corner('SW', -sx, sz, Math.PI * 0.5, true),
  straight('S', -sx, LAYOUT.hz, sx, LAYOUT.hz, 0, 1, false, true),
  corner('SE', sx, sz, 0, true),
  straight('E', LAYOUT.hx, -sz, LAYOUT.hx, sz, 1, 0, true, false),
  corner('NE', sx, -sz, -Math.PI * 0.5, true),
];

/** Signed distance from (x, z) to the stand front: equals the `d` coordinate. */
export function bowlDistance(x: number, z: number): number {
  const qx = Math.abs(x) - sx;
  const qz = Math.abs(z) - sz;
  const ox = Math.max(qx, 0);
  const oz = Math.max(qz, 0);
  return Math.hypot(ox, oz) + Math.min(Math.max(qx, qz), 0) - LAYOUT.rc;
}
