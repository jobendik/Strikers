import type { Vector3 } from 'yuka';
import { CFG } from '../config/constants';
import { V3, clamp, distSq } from '../core/math';
import { ball, match, oppOf } from './state';
import { canShoot, clampShot, findBestPass, getBestPassToReceiver, goalX } from '../ai/analysis';
import { kick } from './control';
import { setUser } from './movement';
import { flashToast } from '../ui/hud';
import type { Player } from '../entities/Player';

const _tmp = V3();

/** SHOOT — strike on goal if in possession, otherwise lunge for the ball. */
export function userShoot(): void {
  if (match.state !== 'play' || !match.userPlayer) return;
  const p = match.userPlayer;
  const opp = oppOf(p.team);
  if (match.controlPlayer === p) {
    const dGoal = Math.abs(goalX(p.team) - p.position.x);
    const power = clamp(CFG.shootPow * (0.7 + 0.3 * clamp(dGoal / CFG.shootRange, 0, 1)), 18, CFG.shootPow);
    if (!canShoot(ball.position, power, p.team, opp, _tmp)) {
      _tmp.set(goalX(p.team), 0, (oppOf(p.team).gk.position.z >= 0 ? -1 : 1) * CFG.goalHalf * 0.6);
    }
    clampShot(_tmp, p.team);
    kick(p, V3(_tmp.x - ball.position.x, 0, _tmp.z - ball.position.z), power, 'kick');
    match.stats.shots[0]++;
    flashToast('SHOOT!');
  } else {
    match.lunge = 0.22;
  }
}

/** PASS — directional pass toward the joystick, else best safe pass, else nearest. */
export function userPass(): void {
  if (match.state !== 'play' || !match.userPlayer) return;
  const p = match.userPlayer;
  if (match.controlPlayer !== p) return;
  const team = p.team;
  const opp = oppOf(team);
  const power = CFG.passLong * 0.9;
  const inLen = Math.hypot(match.input.x, match.input.z);
  let chosen: Player | null = null;
  let chosenTarget: Vector3 | null = null;

  if (inLen > 0.35) {
    const ix = match.input.x / inLen;
    const iz = match.input.z / inLen;
    let bestA = -2;
    for (const m of team.players) {
      if (m === p || p.position.distanceTo(m.position) < 3) continue;
      if (getBestPassToReceiver(p, m, power, opp, _tmp)) {
        const dx = m.position.x - p.position.x;
        const dz = m.position.z - p.position.z;
        const dl = Math.hypot(dx, dz) || 1;
        const a = (dx / dl) * ix + (dz / dl) * iz;
        if (a > bestA) {
          bestA = a;
          chosen = m;
          chosenTarget = _tmp.clone();
        }
      }
    }
  }
  if (!chosen) {
    const pass = findBestPass(p, power, CFG.minPassDist, opp);
    if (pass) {
      chosen = pass.receiver;
      chosenTarget = pass.target;
    }
  }
  if (!chosen) {
    let nd = Infinity;
    for (const m of team.outfield()) {
      if (m === p) continue;
      const d = distSq(m.position, p.position);
      if (d < nd) {
        nd = d;
        chosen = m;
      }
    }
    if (chosen) chosenTarget = V3(chosen.position.x, 0, chosen.position.z);
  }
  if (chosen && chosenTarget) {
    kick(p, V3(chosenTarget.x - ball.position.x, 0, chosenTarget.z - ball.position.z), power, 'pass');
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
