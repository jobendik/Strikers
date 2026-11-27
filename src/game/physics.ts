import type { Vector3 } from 'yuka';
import { CFG } from '../config/constants';
import { V3, clamp, distSq, headingVec } from '../core/math';
import { emit } from '../core/bus';
import { ball, match, teamIndex } from './state';
import { setControl } from './control';
import { addStoppage, scoreGoal } from './flow';
import { attackHeading } from '../ai/analysis';
import type { Team } from '../entities/Team';
import type { Player } from '../entities/Player';

/*
 * Ball physics v2.
 *
 * The ball is always a free rigid sphere. Its motion comes from forces and
 * contacts, never from being parented to a player:
 *
 *   flight   gravity + quadratic air drag + Magnus force  a = k·(ω × v)
 *            (ω is a full 3-axis spin vector: side-spin bends the flight,
 *            back-spin floats it, top-spin dips it)
 *   bounce   normal restitution that falls with impact speed, plus a friction
 *            impulse at the contact point that trades spin against speed
 *            (top-spin kicks on, back-spin checks up)
 *   roll     constant grass deceleration + drag, spin locked to the roll
 *   frame    swept sphere-vs-cylinder tests against both posts and the crossbar
 *            (sub-stepped so a 38 m/s shot can't tunnel a 12 cm post)
 *   nets     a damped box behind each goal: a goal settles into the net, a miss
 *            thuds the side netting from outside
 *
 * `stepBallState` works on a plain struct so the same integrator drives the
 * live ball and look-ahead prediction (game/predict.ts).
 */

export interface BallState {
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  wx: number;
  wy: number;
  wz: number;
  grounded: boolean;
}

export function makeBallState(): BallState {
  return { px: 0, py: CFG.ballR, pz: 0, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0, grounded: true };
}

/**
 * Advance a free ball by `dt`. Returns the vertical impact speed if it bounced
 * on the turf during this step (0 otherwise). No goal/frame/player collisions —
 * those are layered on by the caller.
 */
export function stepBallState(s: BallState, dt: number): number {
  const r = CFG.ballR;
  let bounced = 0;

  if (s.grounded) {
    // --- rolling on the turf ---
    s.py = r;
    s.vy = 0;
    const hs = Math.hypot(s.vx, s.vz);
    if (hs > 0) {
      const dec = CFG.ballDecel + CFG.airDrag * hs * hs;
      const ns = Math.max(0, hs - dec * dt);
      // side-spin on a rolling ball still nudges it sideways a little
      if (s.wy !== 0 && hs > 1) {
        const a = CFG.magnusK * 0.35 * s.wy;
        const ax = a * s.vz;
        const az = -a * s.vx;
        s.vx += ax * dt;
        s.vz += az * dt;
      }
      const k = ns < CFG.ballStop ? 0 : ns / hs;
      s.vx *= k;
      s.vz *= k;
    }
    s.wy *= Math.max(0, 1 - CFG.spinDecayGround * dt);
    if (Math.abs(s.wy) < 0.05) s.wy = 0;
    // rolling without slipping: ω = (ŷ × v) / r
    s.wx = s.vz / r;
    s.wz = -s.vx / r;
    s.px += s.vx * dt;
    s.pz += s.vz * dt;
    return 0;
  }

  // --- flight ---
  const sp = Math.hypot(s.vx, s.vy, s.vz);
  const kd = CFG.airDrag * sp;
  const km = CFG.magnusK;
  const ax = -kd * s.vx + km * (s.wy * s.vz - s.wz * s.vy);
  const ay = -CFG.gravity - kd * s.vy + km * (s.wz * s.vx - s.wx * s.vz);
  const az = -kd * s.vz + km * (s.wx * s.vy - s.wy * s.vx);
  s.vx += ax * dt;
  s.vy += ay * dt;
  s.vz += az * dt;
  const sd = Math.max(0, 1 - CFG.spinDecay * dt);
  s.wx *= sd;
  s.wy *= sd;
  s.wz *= sd;
  s.px += s.vx * dt;
  s.py += s.vy * dt;
  s.pz += s.vz * dt;

  // --- turf contact ---
  if (s.py <= r) {
    s.py = r;
    if (s.vy < 0) {
      const impact = -s.vy;
      if (impact > CFG.bounceMin) {
        const e = clamp(CFG.ballRest - 0.012 * impact, 0.3, CFG.ballRest);
        // slip velocity of the contact point (ball bottom)
        const ux = s.vx + s.wz * r;
        const uz = s.vz - s.wx * r;
        // friction impulse: enough to stop the slip (hollow sphere ⇒ 0.4·u), capped by μ·Jn
        let dvx = -0.4 * ux;
        let dvz = -0.4 * uz;
        const need = Math.hypot(dvx, dvz);
        const maxJ = CFG.groundMu * (1 + e) * impact;
        if (need > maxJ && need > 1e-6) {
          const k = maxJ / need;
          dvx *= k;
          dvz *= k;
        }
        s.vx += dvx;
        s.vz += dvz;
        s.wx += (-1.5 * dvz) / r;
        s.wz += (1.5 * dvx) / r;
        s.wy *= 0.8;
        s.vy = impact * e;
        bounced = impact;
      } else {
        s.vy = 0;
        s.grounded = true;
      }
    } else if (s.vy < 0.05) {
      s.grounded = true;
    }
  }
  return bounced;
}

/* ------------------------------------------------------------------ live ball */

const S: BallState = makeBallState();

function load(): void {
  S.px = ball.position.x;
  S.py = ball.position.y;
  S.pz = ball.position.z;
  S.vx = ball.velocity.x;
  S.vy = ball.velocity.y;
  S.vz = ball.velocity.z;
  S.wx = ball.w.x;
  S.wy = ball.w.y;
  S.wz = ball.w.z;
  S.grounded = ball.grounded;
}
function store(): void {
  ball.position.set(S.px, S.py, S.pz);
  ball.velocity.set(S.vx, S.vy, S.vz);
  ball.w.set(S.wx, S.wy, S.wz);
  ball.grounded = S.grounded;
}

/** Tell the physics the ball has just been given a new velocity (it may now be airborne). */
export function ballStruck(): void {
  ball.grounded = ball.position.y <= CFG.ballR + 1e-3 && Math.abs(ball.velocity.y) < 0.05;
}

/** Advance the match ball one tick: keeper's hands, or free flight + contacts + laws. */
export function updateBall(dt: number): void {
  const c = match.controlPlayer;
  if (c && c.roleType === 'GK' && match.gkHold > 0) {
    // held in the keeper's hands at chest height
    const fwd = headingVec(c.heading);
    ball.position.set(c.position.x + fwd.x * 0.32, 1.05, c.position.z + fwd.z * 0.32);
    ball.velocity.set(c.velocity.x, 0, c.velocity.z);
    ball.w.set(0, 0, 0);
    ball.grounded = false;
    return;
  }

  const prevX = ball.position.x;
  const prevZ = ball.position.z;
  load();
  const sp = Math.hypot(S.vx, S.vy, S.vz);
  // sub-step near the goals so fast shots resolve cleanly against the thin frame
  const nearGoal = Math.abs(S.px) > CFG.halfL - 2.5 && Math.abs(S.pz) < CFG.goalHalf + 2.5;
  const n = nearGoal ? clamp(Math.ceil((sp * dt) / 0.07), 1, 6) : 1;
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    const bx0 = S.px;
    const impact = stepBallState(S, h);
    if (impact > 2.2) emit({ t: 'bounce', speed: impact, x: S.px, y: S.py, z: S.pz });
    if (nearGoal) collideGoal(S, bx0);
  }
  // far beyond the field: the stands swallow it
  if (Math.abs(S.px) > CFG.halfL + 9 || Math.abs(S.pz) > CFG.halfW + 7) {
    S.vx *= 0.9;
    S.vz *= 0.9;
  }
  store();
  checkLaws(prevX, prevZ);
}

/* ------------------------------------------------------------- goal frame + nets */

/** Reflect the ball off a cylinder cross-section (2-D circle test in the given plane). */
function bounceOffCircle(s: BallState, dx: number, dy: number, rad: number, plane: 'xz' | 'xy'): number {
  const d = Math.hypot(dx, dy);
  if (d >= rad || d < 1e-6) return 0;
  const nx = dx / d;
  const ny = dy / d;
  const va = s.vx;
  const vb = plane === 'xz' ? s.vz : s.vy;
  const vn = va * nx + vb * ny;
  // push out
  const push = rad - d;
  s.px += nx * push;
  if (plane === 'xz') s.pz += ny * push;
  else s.py += ny * push;
  if (vn >= 0) return 0;
  const e = CFG.woodRest;
  const jx = -(1 + e) * vn * nx;
  const jy = -(1 + e) * vn * ny;
  s.vx += jx;
  if (plane === 'xz') s.vz += jy;
  else s.vy += jy;
  // a glancing blow scrubs a little tangential speed and scrambles the spin
  const k = 0.94;
  s.vx *= k;
  s.vy *= k;
  s.vz *= k;
  s.wx *= 0.5;
  s.wy *= -0.4;
  s.wz *= 0.5;
  s.grounded = false;
  return -vn;
}

function collideGoal(s: BallState, prevX: number): void {
  const r = CFG.ballR;
  const side = s.px > 0 ? 1 : -1;
  const gx = side * CFG.halfL;
  const G = CFG.goalHalf;
  const H = CFG.crossbarH;
  const rad = r + CFG.postR;
  const dx = s.px - gx;

  if (Math.abs(dx) < rad + 0.02) {
    // uprights
    if (s.py < H + CFG.postR) {
      for (let k = -1; k <= 1; k += 2) {
        const hit = bounceOffCircle(s, s.px - gx, s.pz - k * G, rad, 'xz');
        if (hit > 0.6) {
          emit({ t: 'post', speed: hit, bar: false, x: gx, y: s.py, z: k * G });
          return;
        }
      }
    }
    // crossbar
    if (Math.abs(s.pz) < G + CFG.postR) {
      const hit = bounceOffCircle(s, s.px - gx, s.py - H, rad, 'xy');
      if (hit > 0.6) {
        emit({ t: 'post', speed: hit, bar: true, x: gx, y: H, z: s.pz });
        return;
      }
    }
  }

  // --- nets (a box behind the goal line) ---
  const depth = side * (s.px - gx); // >0 once behind the line
  if (depth <= 0) {
    if (ball.inNet === side) ball.inNet = 0; // came back out before fully crossing
    return;
  }
  // did it just come through the mouth (between the posts, under the bar)? then it is *in* the goal
  if (ball.inNet === 0 && side * (prevX - gx) <= 0 && Math.abs(s.pz) < G && s.py < H) ball.inNet = side;
  const D = CFG.goalDepth;
  if (ball.inNet === side) {
    // inside the goal: the net catches the ball
    let hitSpeed = 0;
    if (depth > D - r) {
      hitSpeed = Math.max(hitSpeed, Math.abs(s.vx));
      s.px = gx + side * (D - r);
      s.vx *= -0.06;
      s.vy *= 0.55;
      s.vz *= 0.45;
    }
    if (Math.abs(s.pz) > G - r) {
      hitSpeed = Math.max(hitSpeed, Math.abs(s.vz));
      s.pz = Math.sign(s.pz) * (G - r);
      s.vz *= -0.06;
      s.vx *= 0.5;
      s.vy *= 0.55;
    }
    if (s.py > H - r) {
      hitSpeed = Math.max(hitSpeed, Math.abs(s.vy));
      s.py = H - r;
      s.vy *= -0.06;
      s.vx *= 0.5;
      s.vz *= 0.5;
    }
    if (hitSpeed > 1.5) {
      emit({ t: 'net', side: side as 1 | -1, speed: hitSpeed, x: s.px, y: s.py, z: s.pz, vx: S.vx, vy: S.vy, vz: S.vz, goal: true });
      s.wx = s.wy = s.wz = 0;
    }
  } else if (depth < D + r && Math.abs(s.pz) < G + r && s.py < H + r) {
    // outside the goal but inside the net's volume: it hit the netting from outside
    const penSide = G + r - Math.abs(s.pz);
    const penTop = H + r - s.py;
    const penBack = D + r - depth;
    const m = Math.min(penSide, penTop, penBack);
    const sp = Math.hypot(s.vx, s.vy, s.vz);
    if (m === penSide) {
      s.pz = Math.sign(s.pz || 1) * (G + r);
      s.vz *= -0.12;
      s.vx *= 0.35;
    } else if (m === penTop) {
      s.py = H + r;
      s.vy = Math.abs(s.vy) * 0.15;
      s.vx *= 0.5;
      s.vz *= 0.6;
    } else {
      s.px = gx + side * (D + r);
      s.vx *= -0.12;
      s.vz *= 0.4;
    }
    if (sp > 3) emit({ t: 'net', side: side as 1 | -1, speed: sp, x: s.px, y: s.py, z: s.pz, vx: s.vx, vy: s.vy, vz: s.vz, goal: false });
  }
}

/* ------------------------------------------------------------------ laws of the game */

type RestartKind = 'throw' | 'corner' | 'goalkick' | 'freekick';

/** A restart that has been awarded but not yet taken (the ball is dead, still moving). */
export interface PendingRestart {
  kind: RestartKind;
  x: number;
  z: number;
  team: Team;
  label: string;
  t: number;
}

/** Detect goals and out-of-play; award the goal or the restart. */
function checkLaws(prevX: number, _prevZ: number): void {
  if (match.state !== 'play' || match.restart) return;
  const r = CFG.ballR;
  const x = ball.position.x;
  const z = ball.position.z;
  const L = CFG.halfL;

  // goal: the whole ball over the line, between the posts, under the bar
  for (let side = -1; side <= 1; side += 2) {
    const line = side * (L + r);
    const crossed = side > 0 ? prevX <= line && x > line : prevX >= line && x < line;
    const behind = side > 0 ? x > line : x < line;
    if ((crossed || behind) && ball.inNet === side) {
      scoreGoal(side > 0 ? 0 : 1);
      return;
    }
  }

  if (Math.abs(z) > CFG.halfW + r) {
    const ez = Math.sign(z) * CFG.halfW;
    const toTeam = ball.lastTouch === match.teams[0] ? match.teams[1] : match.teams[0];
    awardRestart('throw', clamp(x, -L + 1.5, L - 1.5), ez, toTeam, 'THROW-IN');
    return;
  }
  if (Math.abs(x) > L + r) {
    const defTeam = x > 0 ? match.teams[1] : match.teams[0];
    const attTeam = defTeam === match.teams[0] ? match.teams[1] : match.teams[0];
    // a shot that fizzed just past the frame
    const y = ball.position.y;
    if (ball.shot && Math.abs(z) < CFG.goalHalf + 1.6 && y < CFG.crossbarH + 1.2) {
      emit({ t: 'nearmiss', team: teamIndex(attTeam), x, y, z });
    }
    if (ball.lastTouch === defTeam) {
      const zs = Math.sign(z || 1);
      const lineX = defTeam.side > 0 ? -L : L;
      addStoppage(CFG.stoppagePerFoul);
      awardRestart('corner', lineX - Math.sign(lineX) * CFG.cornerInset, zs * (CFG.halfW - CFG.cornerInset), attTeam, 'CORNER');
    } else {
      const gkx = defTeam.side > 0 ? -L + 5 : L - 5;
      awardRestart('goalkick', gkx, clamp(z, -5, 5), defTeam, 'GOAL KICK');
    }
  }
}

/** Award a restart: play is dead for a beat (the ball keeps travelling), then it is taken. */
export function awardRestart(kind: RestartKind, x: number, z: number, team: Team, label: string, delay = CFG.deadBallTime): void {
  match.restart = { kind, x, z, team, label, t: delay };
  match.controlPlayer = null;
  match.controlTeam = null;
  ball.shot = false;
  emit({ t: 'whistle', kind: kind === 'freekick' ? 'foul' : 'restart' });
  emit({ t: 'toast', text: label });
}

/** Count a pending restart down and take it when the beat is over. */
export function updateRestart(dt: number): void {
  const p = match.restart;
  if (!p) return;
  p.t -= dt;
  if (p.t > 0) return;
  match.restart = null;
  setPiece(V3(p.x, 0, p.z), p.team, p.kind);
}

/** Place the ball and a taker for a restart; play is live again immediately. */
export function setPiece(pos: Vector3, team: Team, kind: RestartKind | 'kickoff'): void {
  ball.place(pos.x, pos.z);
  ball.lastTouch = team;
  match.controlPlayer = null;
  match.controlTeam = null;
  const toKeeper = kind === 'goalkick';
  let taker: Player | null = toKeeper ? team.gk : null;
  if (!taker) {
    let nd = Infinity;
    for (const p of team.outfield()) {
      const d = distSq(p.position, pos);
      if (d < nd) {
        nd = d;
        taker = p;
      }
    }
  }
  if (taker) {
    // face infield: toward the centre for throws/corners, upfield otherwise
    let hd = attackHeading(team.side);
    if (kind === 'throw' || kind === 'corner') hd = Math.atan2(-pos.x * 0.25 + team.side * 6, -pos.z);
    const f = headingVec(hd);
    taker.position.set(pos.x - f.x * CFG.carryDist, 0, pos.z - f.z * CFG.carryDist);
    taker.velocity.set(0, 0, 0);
    taker.heading = hd;
    taker.clearAction();
    setControl(taker);
    match.gkHold = 0;
    // nobody may challenge until the restart has been played
    match.setPieceT = 2.6;
    match.setPieceTaker = taker;
  }
  emit({ t: 'setpiece', kind, team: teamIndex(team), x: pos.x, y: 0, z: pos.z });
}
