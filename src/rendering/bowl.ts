import * as THREE from 'three';
import { GeoBuilder, v3, type P3 } from './geo';
import { LAYOUT, SECTIONS, lowerRowD, lowerRowY, mainUpperD, mainUpperY, roofY, upperRowD, upperRowY, type Section } from './layout';

/*
 * The stadium bowl: stepped terraces, vomitories, aisles, fascia, roof with
 * cantilever trusses, outer shell, floodlight masts.
 *
 * Identity: a two-tier horseshoe (N, E, W + all four corners) wrapped around a
 * single-tier "wall" stand on the camera side (S, +Z) — the broadcast camera
 * looks over the wall at the hero N stand, and the wall keeps every +Z structure
 * under the camera's sight line to the near touchline.
 *
 * Output: three merged geometries (structure / seats / lamps), the spectator seat
 * list for the crowd system, and the positions needed by other systems.
 */

export interface SeatList {
  count: number;
  /** x, y, z per seat (feet position). */
  pos: Float32Array;
  /** yaw (facing), away-fan probability 0..1, depth 0..1 (front→back of the bowl), tier id. */
  data: Float32Array;
}

export interface BowlBuild {
  structure: THREE.BufferGeometry;
  seats: THREE.BufferGeometry;
  lamps: THREE.BufferGeometry;
  roofProxy: THREE.BufferGeometry;
  seatList: SeatList;
  /** Floodlight head centres (for glow billboards). */
  floodHeads: THREE.Vector3[];
  triangles: number;
}

const C = (hex: string): THREE.Color => new THREE.Color(hex);

const COL = {
  concrete: C('#7b8088'),
  concreteDark: C('#454a52'),
  tread: C('#666b73'),
  wall: C('#0d1a36'),
  wallTop: C('#16284f'),
  accent: C('#f2c230'),
  steel: C('#dfe3e8'),
  steelDark: C('#8a9099'),
  roofUnder: C('#2a2e36'),
  roofTop: C('#cfd4da'),
  glassRoof: C('#b9d3e6'),
  portal: C('#040506'),
  dark: C('#12151b'),
  facade: C('#2b3340'),
  facadeLight: C('#4a5566'),
  glass: C('#35506e'),
  aisle: C('#9a9fa6'),
  aisleNose: C('#e8c53a'),
  white: C('#ffffff'),
  outside: C('#1a1d22'),
};

interface Tier {
  rows: number;
  /** Row index offset into the D/Y functions. */
  r0: number;
  D: (r: number) => number;
  Y: (r: number) => number;
  /** d where the first tread starts (walkway in front of row 0). */
  frontD: number;
  id: number;
}

interface Cut {
  u: number;
  halfW: number;
  rA: number; // first cut row (tier-local)
  rB: number; // one past the last cut row
  floorY: number;
}

const LOWER: Tier = { rows: LAYOUT.lowerRows, r0: 0, D: lowerRowD, Y: lowerRowY, frontD: 0, id: 0 };
const MAIN_UP: Tier = { rows: LAYOUT.mainUpperRows, r0: 0, D: mainUpperD, Y: mainUpperY, frontD: LAYOUT.mainDeckD, id: 2 };
const UPPER: Tier = { rows: LAYOUT.upperRows, r0: 0, D: upperRowD, Y: upperRowY, frontD: LAYOUT.upperD0, id: 1 };

/** Aisle positions (u) of a section. Straights own the aisles at their ends. */
export function aisleUs(sec: Section): number[] {
  if (sec.corner) return [1 / 3, 2 / 3];
  const nb = Math.round(sec.length(0) / LAYOUT.bayLen);
  const out: number[] = [];
  for (let k = 0; k <= nb; k++) out.push(k / nb);
  return out;
}

function bayCount(sec: Section): number {
  return Math.round(sec.length(0) / LAYOUT.bayLen);
}

export function buildBowl(): BowlBuild {
  const S = new GeoBuilder(); // structure
  const T = new GeoBuilder(); // seats (textured)
  const L = new GeoBuilder(); // lamps
  const seatPos: number[] = [];
  const seatData: number[] = [];
  const tmp: P3 = v3(0, 0, 0);
  const nrm = { x: 0, z: 0 };
  const maxD = LAYOUT.backD;

  const subtract = (cuts: Cut[], r: number, len: number): Array<[number, number]> => {
    let spans: Array<[number, number]> = [[0, 1]];
    for (const c of cuts) {
      if (r < c.rA || r >= c.rB) continue;
      const a = c.u - c.halfW / len;
      const b = c.u + c.halfW / len;
      const next: Array<[number, number]> = [];
      for (const [s0, s1] of spans) {
        if (b <= s0 || a >= s1) next.push([s0, s1]);
        else {
          if (a > s0) next.push([s0, a]);
          if (b < s1) next.push([b, s1]);
        }
      }
      spans = next;
    }
    return spans;
  };

  const buildTier = (sec: Section, tier: Tier, cuts: Cut[], aisles: number[]): void => {
    const D = (r: number): number => (r === 0 ? tier.frontD : tier.D(tier.r0 + r));
    const Y = (r: number): number => tier.Y(tier.r0 + r);
    for (let r = 0; r < tier.rows; r++) {
      const d0 = D(r);
      const d1 = tier.D(tier.r0 + r + 1);
      const y0 = Y(r);
      const y1 = Y(r + 1);
      const len = sec.length(d1);
      const spans = subtract(cuts, r, len);
      // slight front→back darkening so deep rows read as being under cover
      const shade = 1 - 0.18 * (r / tier.rows);
      const cT = COL.white.clone().multiplyScalar(shade);
      for (const [ua, ub] of spans) {
        T.sweep(sec, ua, ub, d0, y0, d1, y0, 0, 1, cT, { uvUnit: LAYOUT.seatPitch, v0: 0.0, v1: 0.5 });
        T.sweep(sec, ua, ub, d1, y0, d1, y1, -1, 0, cT, { uvUnit: LAYOUT.seatPitch, v0: 0.5, v1: 1.0 });

        // seats: on the global grid so sprites sit exactly on the seat texture
        const seatD = tier.D(tier.r0 + r) + 0.42;
        const sl = sec.length(seatD);
        const k0 = Math.ceil((ua * sl) / LAYOUT.seatPitch - 0.25);
        const k1 = Math.floor((ub * sl) / LAYOUT.seatPitch - 0.75);
        for (let k = k0; k <= k1; k++) {
          const s = (k + 0.5) * LAYOUT.seatPitch;
          let blocked = false;
          for (const au of aisles) {
            if (Math.abs(s - au * sl) < LAYOUT.aisleW * 0.5 + 0.12) {
              blocked = true;
              break;
            }
          }
          if (blocked) continue;
          const u = s / sl;
          sec.point(u, seatD, y0, tmp);
          sec.normal(u, nrm);
          seatPos.push(tmp.x, tmp.y, tmp.z);
          // yaw so the sprite's +Z faces the pitch (inward = −normal)
          const yaw = Math.atan2(-nrm.x, -nrm.z);
          const away = THREE.MathUtils.smoothstep(tmp.x, 16, 30);
          const depth = Math.min(1, seatD / maxD);
          seatData.push(yaw, away, depth, tier.id);
        }
      }
      // aisle steps (overlay strips)
      for (const au of aisles) {
        let inCut = false;
        for (const c of cuts) if (r >= c.rA && r < c.rB && Math.abs(au - c.u) * len < c.halfW + 0.5) inCut = true;
        if (inCut) continue;
        const hw = (LAYOUT.aisleW * 0.5) / len;
        const a = Math.max(0, au - hw);
        const b = Math.min(1, au + hw);
        if (b - a < 1e-5) continue;
        S.sweep(sec, a, b, d0, y0 + 0.02, d1 - 0.02, y0 + 0.02, 0, 1, COL.aisle, { segs: 1 });
        S.sweep(sec, a, b, d1 - 0.02, y0 + 0.02, d1 - 0.02, y1 - 0.05, -1, 0, COL.concrete, { segs: 1 });
        S.sweep(sec, a, b, d1 - 0.02, y1 - 0.05, d1 - 0.02, y1 + 0.02, -1, 0, COL.aisleNose, { segs: 1 });
      }
    }

    // vomitories / tunnel
    for (const c of cuts) {
      const len = sec.length(D(c.rA));
      const ua = c.u - c.halfW / len;
      const ub = c.u + c.halfW / len;
      const dA = D(c.rA);
      const dB = tier.D(tier.r0 + c.rB);
      S.sweep(sec, ua, ub, dA, c.floorY + 0.01, dB, c.floorY + 0.01, 0, 1, COL.concreteDark);
      S.sweep(sec, ua, ub, dB, c.floorY, dB, Y(c.rB), -1, 0, COL.portal);
      for (const u of [ua, ub]) {
        for (let r = c.rA; r < c.rB; r++) {
          const d0 = D(r);
          const d1 = tier.D(tier.r0 + r + 1);
          const top = Y(r) + 1.05;
          const a = v3(0, 0, 0),
            b = v3(0, 0, 0),
            cc = v3(0, 0, 0),
            d = v3(0, 0, 0);
          sec.point(u, d0, c.floorY, a);
          sec.point(u, d1, c.floorY, b);
          sec.point(u, d1, top, cc);
          sec.point(u, d0, top, d);
          S.quad(a, b, cc, d, COL.concreteDark, { col2: COL.concrete });
        }
      }
    }
  };

  const floodHeads: THREE.Vector3[] = [];

  for (const sec of SECTIONS) {
    const aisles = aisleUs(sec);
    const nb = sec.corner ? 0 : bayCount(sec);
    const lowerCuts: Cut[] = [];
    const upperCuts: Cut[] = [];
    if (!sec.corner) {
      for (let k = 1; k < nb; k += 2) {
        const u = (k + 0.5) / nb;
        const centre = sec.wall && Math.abs(u - 0.5) < 0.01;
        if (!centre) lowerCuts.push({ u, halfW: 1.15, rA: 6, rB: 11, floorY: lowerRowY(6) });
        upperCuts.push({ u, halfW: 1.15, rA: 3, rB: 7, floorY: upperRowY(3) });
      }
      if (sec.wall) lowerCuts.push({ u: 0.5, halfW: 2.3, rA: 0, rB: 6, floorY: 0 }); // players' tunnel
    }

    /* ---- front wall (with a gap for the tunnel) ---- */
    const wallSpans = sec.wall ? ([[0, 0.5 - 2.3 / sec.length(0)], [0.5 + 2.3 / sec.length(0), 1]] as Array<[number, number]>) : ([[0, 1]] as Array<[number, number]>);
    for (const [a, b] of wallSpans) {
      S.sweep(sec, a, b, 0, 0, 0, LAYOUT.wallH - 0.16, -1, 0, COL.wall, { col2: COL.wallTop });
      S.sweep(sec, a, b, 0, LAYOUT.wallH - 0.16, 0, LAYOUT.wallH, -1, 0, COL.accent);
      // hand rail
      S.sweep(sec, a, b, 0.04, LAYOUT.railH - 0.07, 0.04, LAYOUT.railH, -1, 0, COL.steel);
    }
    // rail posts
    {
      const len = sec.length(0);
      const n = Math.max(2, Math.round(len / 2.4));
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        if (sec.wall && Math.abs(u - 0.5) * len < 2.3) continue;
        const hw = 0.03 / len;
        S.sweep(sec, Math.max(0, u - hw), Math.min(1, u + hw), 0.04, LAYOUT.wallH, 0.04, LAYOUT.railH, -1, 0, COL.steelDark, { segs: 1 });
      }
    }

    /* ---- terraces ---- */
    buildTier(sec, LOWER, lowerCuts, aisles);
    const lowTopD = lowerRowD(LAYOUT.lowerRows);
    const lowTopY = lowerRowY(LAYOUT.lowerRows);

    if (sec.upper) {
      const fy0 = LAYOUT.upperY0 - 1.2; // fascia bottom
      const fy1 = fy0 + LAYOUT.fasciaH;
      // concourse wall behind the lower tier + soffit under the upper tier
      S.sweep(sec, 0, 1, lowTopD, lowTopY, lowTopD, fy0 + 0.6, -1, 0, COL.dark, { col2: COL.portal });
      S.sweep(sec, 0, 1, LAYOUT.upperD0, fy0, lowTopD, fy0 + 0.6, 0, -1, COL.roofUnder, { col2: COL.dark });
      // fascia (the LED ribbon is mounted on it by ledBoards.ts)
      S.sweep(sec, 0, 1, LAYOUT.upperD0, fy0, LAYOUT.upperD0, fy1, -1, 0, COL.dark, { col2: COL.concreteDark });
      S.sweep(sec, 0, 1, LAYOUT.upperD0, fy1, LAYOUT.upperD0 + 0.25, fy1, 0, 1, COL.steel);
      S.sweep(sec, 0, 1, LAYOUT.upperD0 + 0.25, fy1, LAYOUT.upperD0 + 0.25, LAYOUT.upperY0, 1, 0, COL.concreteDark);
      buildTier(sec, UPPER, upperCuts, aisles);
      const upTopD = upperRowD(LAYOUT.upperRows);
      const upTopY = upperRowY(LAYOUT.upperRows);
      // back wall of the upper tier up to the roof
      S.sweep(sec, 0, 1, upTopD, upTopY, upTopD, roofY(upTopD), -1, 0, COL.concreteDark, { col2: COL.dark });
    } else {
      // Main (camera-side) stand: the lower tier, then an open broadcast deck
      // that the gameplay cameras fly over, a strip of glazed boxes and a short
      // upper tier — all of it behind / below the camera positions.
      const deckD = LAYOUT.mainDeckD;
      S.sweep(sec, 0, 1, lowTopD, lowTopY, deckD, lowTopY, 0, 1, COL.tread, { col2: COL.concreteDark });
      S.sweep(sec, 0, 1, deckD, lowTopY, deckD, lowTopY + 0.35, -1, 0, COL.dark);
      S.sweep(sec, 0, 1, deckD, lowTopY + 0.35, deckD, lowTopY + 2.9, -1, 0, COL.glass, { col2: COL.facadeLight });
      S.sweep(sec, 0, 1, deckD, lowTopY + 2.9, deckD, lowTopY + 3.2, -1, 0, COL.accent);
      S.sweep(sec, 0, 1, deckD, lowTopY + 3.2, deckD, mainUpperY(0) + 1.0, -1, 0, COL.concreteDark);
      // box mullions
      {
        const len = sec.length(deckD);
        const n = Math.round(len / 3.8);
        for (let i = 0; i <= n; i++) {
          const u = i / n;
          const hw = 0.09 / len;
          S.sweep(sec, Math.max(0, u - hw), Math.min(1, u + hw), deckD - 0.05, lowTopY + 0.35, deckD - 0.05, lowTopY + 2.9, -1, 0, COL.steelDark, { segs: 1 });
        }
      }
      buildTier(sec, MAIN_UP, [], aisles);
      const topD = mainUpperD(LAYOUT.mainUpperRows);
      const topY = mainUpperY(LAYOUT.mainUpperRows);
      S.sweep(sec, 0, 1, topD, topY, topD, roofY(topD), -1, 0, COL.concreteDark, { col2: COL.dark });

      // end walls where the horseshoe's (taller) upper tier meets the main stand
      const mainY = (dd: number): number => (dd < lowTopD ? lowerRowY(Math.max(0, (dd - LAYOUT.row0) / LAYOUT.rowDepth)) : dd < deckD ? lowTopY : mainUpperY(Math.max(0, (dd - deckD - 0.4) / LAYOUT.rowDepth)));
      const hornY = (dd: number): number => upperRowY(Math.max(0, (dd - LAYOUT.upperD0 - 0.4) / LAYOUT.rowDepth)) + 1.1;
      for (const u of [0, 1]) {
        const d0 = LAYOUT.upperD0;
        const d1 = upperRowD(LAYOUT.upperRows);
        const steps = 12;
        for (let i = 0; i < steps; i++) {
          const da = d0 + ((d1 - d0) * i) / steps;
          const db = d0 + ((d1 - d0) * (i + 1)) / steps;
          const a = v3(0, 0, 0),
            b = v3(0, 0, 0),
            cc = v3(0, 0, 0),
            d = v3(0, 0, 0);
          sec.point(u, da, Math.min(mainY(da), mainY(db)) - 0.3, a);
          sec.point(u, db, Math.min(mainY(da), mainY(db)) - 0.3, b);
          sec.point(u, db, hornY(db), cc);
          sec.point(u, da, hornY(da), d);
          S.quad(a, b, cc, d, COL.concreteDark, { col2: COL.concrete });
        }
        // close the remaining gap up to the roof at the back
        const a = v3(0, 0, 0),
          b = v3(0, 0, 0),
          cc = v3(0, 0, 0),
          d = v3(0, 0, 0);
        sec.point(u, d1, mainY(d1) - 0.3, a);
        sec.point(u, LAYOUT.backD, mainY(d1) - 0.3, b);
        sec.point(u, LAYOUT.backD, roofY(LAYOUT.backD), cc);
        sec.point(u, d1, roofY(d1), d);
        S.quad(a, b, cc, d, COL.concreteDark);
      }
    }

    /* ---- outer shell ---- */
    S.sweep(sec, 0, 1, LAYOUT.backD, 0, LAYOUT.backD, 6, 1, 0, COL.facade, { col2: COL.facadeLight });
    S.sweep(sec, 0, 1, LAYOUT.backD, 6, LAYOUT.backD, 6.5, 1, 0, COL.accent);
    S.sweep(sec, 0, 1, LAYOUT.backD, 6.5, LAYOUT.backD, LAYOUT.roofBackY, 1, 0, COL.facadeLight, { col2: COL.facade });

    /* ---- roof ---- */
    const rI = LAYOUT.roofInnerD;
    const rG = rI + 4.2; // translucent leading strip
    const rB = LAYOUT.backD + 1.2;
    // underside: glazed leading strip then dark deck
    S.sweep(sec, 0, 1, rI, roofY(rI), rG, roofY(rG), 0, 1, COL.glassRoof, { col2: COL.glassRoof });
    S.sweep(sec, 0, 1, rG, roofY(rG), rB, roofY(rB) - 0.1, 0, -1, COL.roofUnder, { col2: COL.dark });
    // top skin
    S.sweep(sec, 0, 1, rG, roofY(rG) + 0.3, rB, roofY(rB) + 0.25, 0, 1, COL.roofTop);
    // leading-edge fascia
    S.sweep(sec, 0, 1, rI, roofY(rI) - 0.35, rI, roofY(rI) + 0.25, -1, 0, COL.steel);
    S.sweep(sec, 0, 1, rB, roofY(rB) - 0.3, rB, roofY(rB) + 0.3, 1, 0, COL.steelDark);
    // roof-edge LED floodlight line (emissive)
    {
      const len = sec.length(rI + 0.5);
      L.sweep(sec, 0, 1, rI + 0.25, roofY(rI) - 0.34, rI + 0.85, roofY(rI) - 0.3, 0, -1, COL.white, { uvUnit: 0.6, v0: 0, v1: 1, segs: sec.corner ? 10 : 1 });
      void len;
    }
    // purlins
    for (const pd of [11.5, 16, 20.5, 24.5]) {
      S.sweep(sec, 0, 1, pd - 0.12, roofY(pd) - 0.32, pd + 0.12, roofY(pd) - 0.32, 0, -1, COL.steelDark);
      S.sweep(sec, 0, 1, pd - 0.12, roofY(pd) - 0.32, pd - 0.12, roofY(pd) - 0.02, -1, 0, COL.steelDark);
    }
    // cantilever trusses + back columns at every aisle line
    const trussUs = sec.corner ? [0.0, 1 / 3, 2 / 3, 1.0] : aisles.slice(1, -1);
    for (const u of trussUs) {
      const a = v3(0, 0, 0),
        b = v3(0, 0, 0);
      sec.point(u, LAYOUT.backD - 0.6, roofY(LAYOUT.backD) - 0.1, a);
      sec.point(u, rI + 0.4, roofY(rI) - 0.1, b);
      S.beam(a, b, 0.32, 2.6, COL.steel, 0.35);
      // tension tie from the column head to mid-span, and the column itself
      const c0 = v3(0, 0, 0),
        c1 = v3(0, 0, 0);
      sec.point(u, LAYOUT.backD - 0.6, roofY(LAYOUT.backD) - 2.6, c0);
      sec.point(u, LAYOUT.backD - 0.6, sec.upper ? upperRowY(LAYOUT.upperRows) : mainUpperY(LAYOUT.mainUpperRows), c1);
      S.beam(c0, c1, 0.4, 0.4, COL.steelDark);
    }
  }

  /* ---- floodlight masts: four leaning pylons behind the corners ---- */
  for (const sec of SECTIONS) {
    if (!sec.corner) continue;
    const base = v3(0, 0, 0),
      head = v3(0, 0, 0);
    sec.point(0.5, LAYOUT.backD + 9, 0, base);
    sec.point(0.5, LAYOUT.backD + 2.5, 47, head);
    S.beam(v3(base.x, base.y + 0.01, base.z), head, 1.5, 1.5, COL.steelDark, 0.8);
    // lamp head: a tilted panel aimed at the centre spot
    const hc = new THREE.Vector3(head.x, head.y + 1.5, head.z);
    floodHeads.push(hc.clone());
    const toC = new THREE.Vector3(-hc.x, 6 - hc.y, -hc.z).normalize();
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), toC).normalize();
    const up = new THREE.Vector3().crossVectors(toC, right).normalize();
    const W = 5.6,
      H = 3.8;
    const corner = (sx: number, sy: number, off: number): P3 => {
      const p = hc.clone().addScaledVector(right, sx * W).addScaledVector(up, sy * H).addScaledVector(toC, off);
      return v3(p.x, p.y, p.z);
    };
    // frame (back box) + emissive face
    S.quad(corner(-1, -1, -0.5), corner(1, -1, -0.5), corner(1, 1, -0.5), corner(-1, 1, -0.5), COL.steelDark);
    S.quad(corner(-1, -1, -0.5), corner(-1, -1, 0), corner(1, -1, 0), corner(1, -1, -0.5), COL.steelDark);
    S.quad(corner(-1, 1, -0.5), corner(1, 1, -0.5), corner(1, 1, 0), corner(-1, 1, 0), COL.steelDark);
    L.quad(corner(-1, -1, 0.02), corner(1, -1, 0.02), corner(1, 1, 0.02), corner(-1, 1, 0.02), COL.white, { uv: [0, 0, 10, 6] });
  }

  /* ---- ground outside the bowl ---- */
  {
    const R = 600;
    S.quad(v3(-R, -0.06, R), v3(R, -0.06, R), v3(R, -0.06, -R), v3(-R, -0.06, -R), COL.outside);
  }

  /* ---- shadow-map proxy: the roof ring + everything behind it, as one flat annulus ---- */
  const P = new GeoBuilder();
  for (const sec of SECTIONS) {
    P.sweep(sec, 0, 1, LAYOUT.roofInnerD, LAYOUT.roofInnerY, LAYOUT.roofInnerD + 90, LAYOUT.roofInnerY, 0, 1, COL.white);
  }

  const count = seatPos.length / 3;
  return {
    structure: S.build(),
    seats: T.build(),
    lamps: L.build(),
    roofProxy: P.build(),
    seatList: { count, pos: new Float32Array(seatPos), data: new Float32Array(seatData) },
    floodHeads,
    triangles: S.triangleCount + T.triangleCount + L.triangleCount,
  };
}
