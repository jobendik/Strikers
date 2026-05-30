import type { Vector3 } from 'yuka';
import { CFG } from '../config/constants';
import { attr01 } from '../config/players';
import { V3, clamp, distSq } from '../core/math';
import { ball, match, oppOf } from './state';
import {
  canChipKeeper,
  canShoot,
  clampShot,
  findBestPass,
  findThroughBall,
  getBestPassToReceiver,
  goalX,
} from '../ai/analysis';
import { headBall, kick, lobKick, startSlide } from './control';
import { canHead } from './aerial';
import { setUser } from './movement';
import { flashToast } from '../ui/hud';
import type { Player } from '../entities/Player';

const _tmp = V3();

/**
 * SHOOT — charge-and-release strike on goal. A light tap when the keeper has
 * rushed out becomes a delicate chip; otherwise `charge` (0–1) scales the
 * power. With no possession it becomes a header (if the ball is up) or a slide
 * tackle (footballSimulationEngine action set).
 */
export function userShoot(charge = 1): void {
  if (match.state !== 'play' || !match.userPlayer) return;
  const p = match.userPlayer;
  const opp = oppOf(p.team);

  if (match.controlPlayer === p) {
    // dink it over an advancing keeper on a soft tap (target sits just beyond the line)
    if (charge < 0.4 && canChipKeeper(ball.position, p.team, opp, _tmp)) {
      lobKick(p, _tmp, 3.1, 'kick');
      match.stats.shots[0]++;
      flashToast('CHEEKY CHIP!');
      return;
    }
    const power = clamp(
      CFG.shootPow * (0.55 + 0.45 * charge) * (0.9 + 0.2 * attr01(p.attr.shooting)),
      16,
      CFG.shootPow * 1.05,
    );
    if (!canShoot(ball.position, power, p.team, opp, _tmp)) {
      // aim into the far corner away from the keeper
      _tmp.set(goalX(p.team), 0, (opp.gk.position.z >= 0 ? -1 : 1) * CFG.goalHalf * 0.6);
    }
    clampShot(_tmp, p.team);
    kick(p, V3(_tmp.x - ball.position.x, 0, _tmp.z - ball.position.z), power, 'kick');
    match.stats.shots[0]++;
    flashToast(charge > 0.8 ? 'SHOOT!' : 'PLACED');
    return;
  }

  // no possession — head a high ball, else commit a slide tackle
  if (canHead(p)) {
    const tz = clamp(ball.position.z * 0.4, -(CFG.goalHalf - 0.6), CFG.goalHalf - 0.6);
    headBall(p, V3(goalX(p.team) - ball.position.x, 0, tz - ball.position.z), CFG.passShort);
    match.stats.shots[0]++;
    flashToast('HEADER!');
  } else {
    if (startSlide(p)) flashToast('SLIDE!');
  }
}

/** Pick the teammate best aligned with the joystick (for directional passing). */
function directionalMate(p: Player, power: number, opp: ReturnType<typeof oppOf>, lob: boolean): { mate: Player; target: Vector3 } | null {
  const inLen = Math.hypot(match.input.x, match.input.z);
  if (inLen <= 0.35) return null;
  const ix = match.input.x / inLen;
  const iz = match.input.z / inLen;
  let mate: Player | null = null;
  let target: Vector3 | null = null;
  let bestA = -2;
  for (const m of p.team.players) {
    if (m === p || p.position.distanceTo(m.position) < 3) continue;
    const dx = m.position.x - p.position.x;
    const dz = m.position.z - p.position.z;
    const dl = Math.hypot(dx, dz) || 1;
    const a = (dx / dl) * ix + (dz / dl) * iz;
    if (a <= bestA) continue;
    if (lob) {
      bestA = a;
      mate = m;
      target = V3(m.position.x + p.team.side, 0, m.position.z);
    } else if (getBestPassToReceiver(p, m, power, opp, _tmp)) {
      bestA = a;
      mate = m;
      target = _tmp.clone();
    }
  }
  return mate && target ? { mate, target } : null;
}

/**
 * PASS — `lob` (held button) plays a lofted cross/ball over the top; a tap plays
 * a ground pass, preferring a through-ball into space when the joystick points
 * forward. Falls back to the safest pass, then the nearest teammate.
 */
export function userPass(lob = false): void {
  if (match.state !== 'play' || !match.userPlayer) return;
  const p = match.userPlayer;
  if (match.controlPlayer !== p) return;
  const team = p.team;
  const opp = oppOf(team);
  const power = CFG.passLong * 0.9;

  if (lob) {
    // lofted ball — toward the joystick if aimed, else to the most advanced mate
    let target = directionalMate(p, power, opp, true)?.target ?? null;
    if (!target) {
      let mate: Player | null = null;
      let adv = -Infinity;
      for (const m of team.outfield()) {
        if (m === p) continue;
        const a = m.position.x * team.side;
        if (a > adv) {
          adv = a;
          mate = m;
        }
      }
      if (mate) target = V3(mate.position.x + team.side, 0, mate.position.z);
    }
    if (target) {
      lobKick(p, target, 2.7, 'pass');
      flashToast('LOFTED BALL');
    }
    return;
  }

  // through-ball when pushing forward and a runner is in behind
  const inLen = Math.hypot(match.input.x, match.input.z);
  const forward = inLen > 0.35 && (match.input.x / inLen) * team.side > 0.4;
  if (forward) {
    const thr = findThroughBall(p, opp);
    if (thr) {
      kick(p, V3(thr.target.x - ball.position.x, 0, thr.target.z - ball.position.z), CFG.throughPow, 'pass');
      flashToast('THROUGH BALL!');
      return;
    }
  }

  // directional ground pass, else safest pass, else nearest
  let chosen = directionalMate(p, power, opp, false);
  if (!chosen) {
    const pass = findBestPass(p, power, CFG.minPassDist, opp);
    if (pass) chosen = { mate: pass.receiver, target: pass.target };
  }
  if (!chosen) {
    let nd = Infinity;
    let nm: Player | null = null;
    for (const m of team.outfield()) {
      if (m === p) continue;
      const d = distSq(m.position, p.position);
      if (d < nd) {
        nd = d;
        nm = m;
      }
    }
    if (nm) chosen = { mate: nm, target: V3(nm.position.x, 0, nm.position.z) };
  }
  if (chosen) {
    kick(p, V3(chosen.target.x - ball.position.x, 0, chosen.target.z - ball.position.z), power, 'pass');
  }
}

/** SWITCH — cycle control to the next-nearest outfield player (when defending). */
export function switchPlayer(): void {
  if (match.state !== 'play' || !match.userPlayer) return;
  if (match.controlTeam === match.teams[0]) return;
  const of = match.teams[0]
    .outfield()
    .slice()
    .sort((a, b) => distSq(a.position, ball.position) - distSq(b.position, ball.position));
  setUser(of[(of.indexOf(match.userPlayer) + 1) % of.length]);
  match.switchLock = 2.0;
}
