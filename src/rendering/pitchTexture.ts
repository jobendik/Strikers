import * as THREE from 'three';
import { CFG } from '../config/constants';

/** Procedurally paints the pitch markings onto a canvas texture. */
export function makePitchTexture(): THREE.CanvasTexture {
  const W = 2400;
  const H = 1600;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;

  // world(-30..30, -20..20) -> canvas
  const X = (x: number): number => ((x + CFG.halfL) / (2 * CFG.halfL)) * W;
  const Z = (z: number): number => ((z + CFG.halfW) / (2 * CFG.halfW)) * H;
  const PX = (u: number): number => (u / (2 * CFG.halfL)) * W; // x-length -> px
  const PZ = (u: number): number => (u / (2 * CFG.halfW)) * H;

  // mowing stripes along the length
  const bands = 14;
  const bw = W / bands;
  for (let i = 0; i < bands; i++) {
    g.fillStyle = i % 2 ? '#1f8a3a' : '#1c7e34';
    g.fillRect(i * bw, 0, bw + 1, H);
  }

  // subtle vignette
  const vg = g.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.9);
  vg.addColorStop(0, 'rgba(255,255,255,.05)');
  vg.addColorStop(1, 'rgba(0,0,0,.28)');
  g.fillStyle = vg;
  g.fillRect(0, 0, W, H);

  // line drawing
  g.strokeStyle = 'rgba(255,255,255,.92)';
  g.lineWidth = PZ(0.28);
  g.fillStyle = 'rgba(255,255,255,.92)';
  const line = (x1: number, z1: number, x2: number, z2: number): void => {
    g.beginPath();
    g.moveTo(X(x1), Z(z1));
    g.lineTo(X(x2), Z(z2));
    g.stroke();
  };
  const rect = (x1: number, z1: number, x2: number, z2: number): void => {
    g.strokeRect(X(x1), Z(z1), X(x2) - X(x1), Z(z2) - Z(z1));
  };
  const circle = (x: number, z: number, r: number, fill = false): void => {
    g.beginPath();
    g.arc(X(x), Z(z), PX(r), 0, Math.PI * 2);
    fill ? g.fill() : g.stroke();
  };
  const arc = (x: number, z: number, r: number, a1: number, a2: number): void => {
    g.beginPath();
    g.arc(X(x), Z(z), PX(r), a1, a2);
    g.stroke();
  };

  // boundary (inset a touch)
  rect(-CFG.halfL + 0.4, -CFG.halfW + 0.4, CFG.halfL - 0.4, CFG.halfW - 0.4);
  line(0, -CFG.halfW + 0.4, 0, CFG.halfW - 0.4); // halfway
  circle(0, 0, 6.2); // center circle
  circle(0, 0, 0.5, true); // center spot

  // both ends
  for (const s of [-1, 1]) {
    const gl = s * CFG.halfL;
    rect(gl, -CFG.boxHalfW, gl - s * CFG.boxDepth, CFG.boxHalfW); // penalty box
    rect(gl, -CFG.sixHalfW, gl - s * CFG.sixDepth, CFG.sixHalfW); // six-yard
    const spot = gl - s * 7.5;
    circle(spot, 0, 0.45, true); // penalty spot
    // penalty arc
    const a = Math.acos((CFG.boxDepth - 7.5) / 6.2);
    if (s < 0) arc(spot, 0, 6.2, -a, a);
    else arc(spot, 0, 6.2, Math.PI - a, Math.PI + a);
  }

  // corner arcs
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      g.beginPath();
      g.arc(X(sx * (CFG.halfL - 0.4)), Z(sz * (CFG.halfW - 0.4)), PX(1), 0, Math.PI * 2);
      g.stroke();
    }

  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
