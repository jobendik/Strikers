import { ball, match } from './state';
import type { Player } from '../entities/Player';

/*
 * Presentation snapshots.
 *
 * After every simulation tick the complete *visible* state of the match is
 * written into a flat Float32Array. The renderer never reads the simulation
 * directly: it draws an interpolation between the last two snapshots (smooth at
 * any refresh rate), and the replay system stores the very same snapshots and
 * plays them back — so a replay shows exactly what happened, with the same
 * animation, from any camera, at any speed, forwards or backwards.
 *
 * Because every pose is a pure function of a snapshot (stride phase and action
 * time are in it), nothing about animation depends on wall-clock history.
 */

/** Ball block: x y z · wx wy wz · speed · flags */
export const B_STRIDE = 8;
/** Player block (per player). */
export const P_STRIDE = 10;
export const enum PF {
  X = 0,
  Z = 1,
  Heading = 2,
  Vx = 3,
  Vz = 4,
  /** Action code (see ACT). */
  Act = 5,
  /** Seconds into the action. */
  ActT = 6,
  /** Contact time of the action (kick/tackle) or total duration (dive/slide). */
  ActK = 7,
  /** Stride phase (steps). */
  Stride = 8,
  /** Bit flags (see FLAG). */
  Flags = 9,
}

export const ACT = { none: 0, kick: 1, header: 2, tackle: 3, slide: 4, dive: 5, recover: 6, stumble: 7 } as const;
const ACT_CODE: Record<string, number> = ACT;

export const FLAG = {
  user: 1,
  calling: 2,
  celebrate: 4,
  hasBall: 8,
  holding: 16,
  hidden: 32,
  /** dive/slide direction is to the player's left (vs right) */
  left: 64,
  sprint: 128,
  /** recovering from a dive (vs a slide) */
  fromDive: 256,
  dejected: 512,
  jockey: 1024,
} as const;

let players: Player[] = [];

/** The fixed player order used by every snapshot (team 0 then team 1). */
export function snapshotPlayers(): Player[] {
  if (players.length === 0 || players[0] !== match.teams[0].players[0]) players = [...match.teams[0].players, ...match.teams[1].players];
  return players;
}

export function snapshotSize(): number {
  return B_STRIDE + snapshotPlayers().length * P_STRIDE;
}

/** Remember what each player was last doing before 'recover' so the pose can match. */
const lastAct = new WeakMap<Player, string>();
const lastLeft = new WeakMap<Player, boolean>();

/** Write the current simulation state into `out`. */
export function writeSnapshot(out: Float32Array): void {
  const ps = snapshotPlayers();
  out[0] = ball.position.x;
  out[1] = ball.position.y;
  out[2] = ball.position.z;
  out[3] = ball.w.x;
  out[4] = ball.w.y;
  out[5] = ball.w.z;
  out[6] = Math.hypot(ball.velocity.x, ball.velocity.y, ball.velocity.z);
  out[7] = ball.inNet;
  const celebrating = match.state === 'celebrate';
  let o = B_STRIDE;
  for (const p of ps) {
    out[o + PF.X] = p.position.x;
    out[o + PF.Z] = p.position.z;
    out[o + PF.Heading] = p.heading;
    out[o + PF.Vx] = p.velocity.x;
    out[o + PF.Vz] = p.velocity.z;
    out[o + PF.Act] = ACT_CODE[p.act] ?? 0;
    out[o + PF.ActT] = p.actT;
    out[o + PF.ActK] = p.act === 'kick' || p.act === 'tackle' || p.act === 'header' ? p.actContact : p.actDur;
    out[o + PF.Stride] = p.stride;
    let f = 0;
    if (p === match.userPlayer && match.state !== 'menu') f |= FLAG.user;
    if (p === match.callingPlayer && match.state === 'play') f |= FLAG.calling;
    if (celebrating) f |= match.teams[match.scoredBy] === p.team ? FLAG.celebrate : FLAG.dejected;
    if (p === match.controlPlayer) f |= FLAG.hasBall;
    if (p === match.controlPlayer && p.roleType === 'GK' && match.gkHold > 0) f |= FLAG.holding;
    if (p.sentOff) f |= FLAG.hidden;
    if (p.sprinting) f |= FLAG.sprint;
    if (p.jockey) f |= FLAG.jockey;
    if (p.act === 'dive' || p.act === 'slide') {
      // is the committed direction to the left of where he faces?
      const hx = Math.sin(p.heading);
      const hz = Math.cos(p.heading);
      const cross = hx * p.actDirZ - hz * p.actDirX; // >0 ⇒ direction is to his left (x→z handedness)
      if (cross < 0) f |= FLAG.left;
      lastAct.set(p, p.act);
      lastLeft.set(p, cross < 0);
    } else if (p.act === 'recover') {
      if (lastAct.get(p) === 'dive') f |= FLAG.fromDive;
      if (lastLeft.get(p)) f |= FLAG.left; // which way he went down — he gets up from that side
    }
    out[o + PF.Flags] = f;
    o += P_STRIDE;
  }
}

const TAU = Math.PI * 2;

/** Interpolate snapshots a→b by t into `out` (angles take the short way; discrete fields come from b). */
export function lerpSnapshot(a: Float32Array, b: Float32Array, t: number, out: Float32Array): void {
  const n = out.length;
  for (let i = 0; i < 3; i++) out[i] = a[i] + (b[i] - a[i]) * t;
  for (let i = 3; i < B_STRIDE; i++) out[i] = b[i];
  for (let o = B_STRIDE; o < n; o += P_STRIDE) {
    // a jump of more than a couple of metres in one tick is a teleport (restart) — don't smear it
    const dx = b[o + PF.X] - a[o + PF.X];
    const dz = b[o + PF.Z] - a[o + PF.Z];
    const tele = dx * dx + dz * dz > 4;
    const k = tele ? 1 : t;
    out[o + PF.X] = a[o + PF.X] + dx * k;
    out[o + PF.Z] = a[o + PF.Z] + dz * k;
    let dh = b[o + PF.Heading] - a[o + PF.Heading];
    dh -= Math.round(dh / TAU) * TAU;
    out[o + PF.Heading] = a[o + PF.Heading] + dh * k;
    out[o + PF.Vx] = a[o + PF.Vx] + (b[o + PF.Vx] - a[o + PF.Vx]) * k;
    out[o + PF.Vz] = a[o + PF.Vz] + (b[o + PF.Vz] - a[o + PF.Vz]) * k;
    out[o + PF.Act] = b[o + PF.Act];
    // action time only interpolates within the same action
    const same = a[o + PF.Act] === b[o + PF.Act] && b[o + PF.ActT] >= a[o + PF.ActT];
    out[o + PF.ActT] = same ? a[o + PF.ActT] + (b[o + PF.ActT] - a[o + PF.ActT]) * k : b[o + PF.ActT];
    out[o + PF.ActK] = b[o + PF.ActK];
    out[o + PF.Stride] = a[o + PF.Stride] + (b[o + PF.Stride] - a[o + PF.Stride]) * k;
    out[o + PF.Flags] = b[o + PF.Flags];
  }
  // ball teleports too (restarts)
  const bx = b[0] - a[0];
  const bz = b[2] - a[2];
  if (bx * bx + bz * bz > 9) {
    out[0] = b[0];
    out[1] = b[1];
    out[2] = b[2];
  }
}
