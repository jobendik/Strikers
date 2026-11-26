import * as THREE from 'three';
import type { Section } from './layout';

/*
 * Tiny immediate-mode mesh builder. The whole static stadium is emitted through
 * it into a handful of merged, vertex-coloured BufferGeometries (one draw call
 * per material) instead of thousands of individual meshes.
 *
 * Winding always agrees with the stored normal, so the stadium shader can light
 * both faces correctly by flipping the normal on back faces.
 */

export interface P3 {
  x: number;
  y: number;
  z: number;
}

export const v3 = (x: number, y: number, z: number): P3 => ({ x, y, z });

export interface QuadOpts {
  /** Colour of the second edge (c, d). Defaults to the first colour. */
  col2?: THREE.Color;
  /** [u0, v0, u1, v1] → a=(u0,v0) b=(u1,v0) c=(u1,v1) d=(u0,v1). */
  uv?: [number, number, number, number];
  /** Explicit per-vertex normals (a, b, c, d); winding is fixed up to match. */
  normals?: [P3, P3, P3, P3];
}

export class GeoBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];
  private uv: number[] = [];
  private idx: number[] = [];
  private n = 0;

  get vertexCount(): number {
    return this.n;
  }
  get triangleCount(): number {
    return this.idx.length / 3;
  }

  private vert(p: P3, nx: number, ny: number, nz: number, c: THREE.Color, u: number, v: number): number {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(nx, ny, nz);
    this.col.push(c.r, c.g, c.b);
    this.uv.push(u, v);
    return this.n++;
  }

  /** Quad a→b→c→d (loop order). */
  quad(a: P3, b: P3, c: P3, d: P3, col: THREE.Color, o: QuadOpts = {}): void {
    // geometric normal from the winding
    const ux = b.x - a.x,
      uy = b.y - a.y,
      uz = b.z - a.z;
    const vx = d.x - a.x,
      vy = d.y - a.y,
      vz = d.z - a.z;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    const uvs = o.uv ?? [0, 0, 1, 1];
    const c2 = o.col2 ?? col;
    let flip = false;
    let i0: number, i1: number, i2: number, i3: number;
    if (o.normals) {
      const N = o.normals;
      flip = nx * N[0].x + ny * N[0].y + nz * N[0].z < 0;
      i0 = this.vert(a, N[0].x, N[0].y, N[0].z, col, uvs[0], uvs[1]);
      i1 = this.vert(b, N[1].x, N[1].y, N[1].z, col, uvs[2], uvs[1]);
      i2 = this.vert(c, N[2].x, N[2].y, N[2].z, c2, uvs[2], uvs[3]);
      i3 = this.vert(d, N[3].x, N[3].y, N[3].z, c2, uvs[0], uvs[3]);
    } else {
      i0 = this.vert(a, nx, ny, nz, col, uvs[0], uvs[1]);
      i1 = this.vert(b, nx, ny, nz, col, uvs[2], uvs[1]);
      i2 = this.vert(c, nx, ny, nz, c2, uvs[2], uvs[3]);
      i3 = this.vert(d, nx, ny, nz, c2, uvs[0], uvs[3]);
    }
    if (flip) this.idx.push(i0, i2, i1, i0, i3, i2);
    else this.idx.push(i0, i1, i2, i0, i2, i3);
  }

  tri(a: P3, b: P3, c: P3, col: THREE.Color): void {
    const ux = b.x - a.x,
      uy = b.y - a.y,
      uz = b.z - a.z;
    const vx = c.x - a.x,
      vy = c.y - a.y,
      vz = c.z - a.z;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    const i0 = this.vert(a, nx, ny, nz, col, 0, 0);
    const i1 = this.vert(b, nx, ny, nz, col, 1, 0);
    const i2 = this.vert(c, nx, ny, nz, col, 0, 1);
    this.idx.push(i0, i1, i2);
  }

  /**
   * Axis-aligned box in a local frame: centre `c`, half sizes (hx, hy, hz), yaw
   * about Y. `faces` selects which faces to emit (default all six).
   */
  box(c: P3, hx: number, hy: number, hz: number, col: THREE.Color, yaw = 0, top?: THREE.Color): void {
    const cs = Math.cos(yaw);
    const sn = Math.sin(yaw);
    const P = (x: number, y: number, z: number): P3 => ({ x: c.x + x * cs + z * sn, y: c.y + y, z: c.z - x * sn + z * cs });
    const p = [P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, -hy, hz), P(-hx, -hy, hz), P(-hx, hy, -hz), P(hx, hy, -hz), P(hx, hy, hz), P(-hx, hy, hz)];
    this.quad(p[3], p[2], p[6], p[7], col); // +z
    this.quad(p[1], p[0], p[4], p[5], col); // -z
    this.quad(p[2], p[1], p[5], p[6], col); // +x
    this.quad(p[0], p[3], p[7], p[4], col); // -x
    this.quad(p[7], p[6], p[5], p[4], top ?? col); // top
    this.quad(p[0], p[1], p[2], p[3], col); // bottom
  }

  /** Rectangular beam between two points (width w horizontal, height h vertical-ish). */
  beam(a: P3, b: P3, w: number, h: number, col: THREE.Color, hEnd = h): void {
    const dx = b.x - a.x,
      dy = b.y - a.y,
      dz = b.z - a.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    // side vector: horizontal, perpendicular to the beam
    let sx = -dz,
      sz = dx;
    const sl = Math.hypot(sx, sz);
    if (sl < 1e-5) {
      sx = 1;
      sz = 0;
    } else {
      sx /= sl;
      sz /= sl;
    }
    // "up" vector perpendicular to beam and side
    const tx = dx / len,
      ty = dy / len,
      tz = dz / len;
    let ux = -sz * ty,
      uy = sz * tx - sx * tz,
      uz = sx * ty;
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul;
    uy /= ul;
    uz /= ul;
    if (uy < 0) {
      ux = -ux;
      uy = -uy;
      uz = -uz;
    }
    const hw = w / 2;
    const C = (p: P3, s: number, u: number, hh: number): P3 => ({ x: p.x + sx * s * hw + ux * u * hh, y: p.y + uy * u * hh, z: p.z + sz * s * hw + uz * u * hh });
    // top of the beam is the a→b line; depth hangs below it
    const a0 = C(a, -1, 0, 0),
      a1 = C(a, 1, 0, 0),
      a2 = C(a, 1, -1, h),
      a3 = C(a, -1, -1, h);
    const b0 = C(b, -1, 0, 0),
      b1 = C(b, 1, 0, 0),
      b2 = C(b, 1, -1, hEnd),
      b3 = C(b, -1, -1, hEnd);
    this.quad(a0, b0, b1, a1, col);
    this.quad(a1, b1, b2, a2, col);
    this.quad(a2, b2, b3, a3, col);
    this.quad(a3, b3, b0, a0, col);
    this.quad(a0, a1, a2, a3, col);
    this.quad(b1, b0, b3, b2, col);
  }

  /**
   * Sweep the profile edge (d0,y0)→(d1,y1) along a bowl section from ua to ub.
   * `nd`/`ny` is the surface normal in the (outward, up) plane.
   */
  sweep(
    sec: Section,
    ua: number,
    ub: number,
    d0: number,
    y0: number,
    d1: number,
    y1: number,
    nd: number,
    ny: number,
    col: THREE.Color,
    o: { col2?: THREE.Color; uvUnit?: number; v0?: number; v1?: number; segs?: number } = {},
  ): void {
    if (ub <= ua) return;
    const segs = o.segs ?? (sec.corner ? Math.max(1, Math.ceil((ub - ua) * 12)) : 1);
    const nl = Math.hypot(nd, ny) || 1;
    nd /= nl;
    ny /= nl;
    const nrm = { x: 0, z: 0 };
    const A: P3 = v3(0, 0, 0),
      B: P3 = v3(0, 0, 0),
      C: P3 = v3(0, 0, 0),
      D: P3 = v3(0, 0, 0);
    for (let i = 0; i < segs; i++) {
      const u0 = ua + ((ub - ua) * i) / segs;
      const u1 = ua + ((ub - ua) * (i + 1)) / segs;
      sec.point(u0, d0, y0, A);
      sec.point(u1, d0, y0, B);
      sec.point(u1, d1, y1, C);
      sec.point(u0, d1, y1, D);
      sec.normal(u0, nrm);
      const n0 = v3(nrm.x * nd, ny, nrm.z * nd);
      sec.normal(u1, nrm);
      const n1 = v3(nrm.x * nd, ny, nrm.z * nd);
      let uv: [number, number, number, number] | undefined;
      if (o.uvUnit) {
        const dm = (d0 + d1) * 0.5;
        const L = sec.length(dm);
        uv = [(u0 * L) / o.uvUnit, o.v0 ?? 0, (u1 * L) / o.uvUnit, o.v1 ?? 1];
      }
      this.quad({ ...A }, { ...B }, { ...C }, { ...D }, col, { col2: o.col2, uv, normals: [n0, n1, n1, n0] });
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}
