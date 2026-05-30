import { CFG } from '../config/constants';
import { ball, match } from '../game/state';

/*
 * Tactical radar — a tiny top-down minimap of the pitch drawn on a 2D canvas:
 * both teams' dots in their kit colours, the ball, and a ring on the player you
 * control. Costs almost nothing (a dozen arcs on a 130×90 canvas) and only draws
 * during live play.
 */

const W = 132;
const H = 88;
const PAD = 5;

let cv: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;

export function initRadar(): void {
  cv = document.getElementById('radar') as HTMLCanvasElement | null;
  if (!cv) return;
  cv.width = W;
  cv.height = H;
  ctx = cv.getContext('2d');
}

const mapX = (x: number): number => PAD + ((x + CFG.halfL) / (CFG.halfL * 2)) * (W - 2 * PAD);
const mapZ = (z: number): number => PAD + ((z + CFG.halfW) / (CFG.halfW * 2)) * (H - 2 * PAD);

function dot(x: number, z: number, r: number, fill: string, ring = false): void {
  if (!ctx) return;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(mapX(x), mapZ(z), r, 0, Math.PI * 2);
  ctx.fill();
  if (ring) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.3;
    ctx.stroke();
  }
}

/** Redraw the radar. Call once per frame; it hides itself outside live play. */
export function updateRadar(): void {
  if (!ctx || !cv) return;
  const live = match.state === 'play';
  cv.style.opacity = live ? '1' : '0';
  if (!live) return;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(8,26,16,.55)';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,.22)';
  ctx.lineWidth = 1;
  ctx.strokeRect(PAD, PAD, W - 2 * PAD, H - 2 * PAD);
  ctx.beginPath();
  ctx.moveTo(W / 2, PAD);
  ctx.lineTo(W / 2, H - PAD);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(W / 2, H / 2, 7, 0, Math.PI * 2);
  ctx.stroke();

  for (const t of match.teams)
    for (const p of t.players) {
      if (p.sentOff) continue;
      const user = p === match.userPlayer;
      dot(p.position.x, p.position.z, user ? 3.1 : 2.2, t.color, user);
    }
  dot(ball.position.x, ball.position.z, 1.8, '#ffffff');
}
