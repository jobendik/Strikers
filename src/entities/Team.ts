import { Regulator, Vector3 } from 'yuka';
import { CFG, FORMATION, MENTALITY } from '../config/constants';
import { teamMeta } from '../config/players';
import { V3, clamp, distSq } from '../core/math';
import { ball, match, oppOf } from '../game/state';
import { updatePerception } from '../ai/perception';
import { canShoot, isPassSafe, ownGoalX, supportSpot } from '../ai/analysis';
import { Player } from './Player';
import type { PlayerRole } from '../config/types';

// scratch vector for the support-spot shoot test
const _scratch = V3();

/** A team of five: GK + 2 DEF + 2 ATT. Owns role assignment and tactics. */
export class Team {
  side: number;
  /** Roster key (indexes into SQUADS). */
  name: string;
  /** Kit colour, 3-letter tag and full display name (from the team registry). */
  color: string;
  short: string;
  fullName: string;
  isUser: boolean;
  inAttack = false;
  /** 0 Defensive · 1 Balanced · 2 Attacking — biases the resting shape's depth. */
  mentality = 1;
  players: Player[];
  gk: Player;
  bestSpot: Vector3 | null = null;
  spots: Vector3[] = [];

  /** Throttles the (relatively expensive) support-spot solver to ~4 Hz. */
  private supportRegulator = new Regulator(4);

  constructor(side: number, key: string, isUser: boolean) {
    this.side = side;
    this.isUser = isUser;
    const m = teamMeta(key);
    this.name = key;
    this.color = m.color;
    this.short = m.short;
    this.fullName = m.name;
    this.players = FORMATION.map((e, i) => new Player(this, i, e));
    this.gk = this.players[0];

    const xs = side > 0 ? [6, 11, 16, 21, 26] : [-6, -11, -16, -21, -26];
    for (const x of xs) for (const z of [-13, -6.5, 0, 6.5, 13]) this.spots.push(V3(x, 0, z));
  }

  /** Re-skin this team to a new roster/kit (team selection & cup fixtures). */
  setIdentity(key: string): void {
    const m = teamMeta(key);
    this.name = key;
    this.color = m.color;
    this.short = m.short;
    this.fullName = m.name;
    for (const p of this.players) p.applyIdentity();
  }

  outfield(): Player[] {
    return this.players.filter((p) => p.roleType !== 'GK' && !p.sentOff);
  }

  /** Resting-shape depth bias (world units) from the current mentality. */
  mentalityPush(): number {
    return MENTALITY[this.mentality]?.push ?? 0;
  }

  /** Buckland-style SupportSpotCalculator: scores candidate spots for the off-ball attacker. */
  computeSupport(carrier: Player): Vector3 | null {
    if (this.bestSpot && !this.supportRegulator.ready()) return this.bestSpot;
    const opp = oppOf(this);
    let best: Vector3 | null = null;
    let bs = 0;
    for (const s of this.spots) {
      let sc = 0;
      if (isPassSafe(ball.position, s, null, CFG.passLong, opp)) sc += 2;
      if (canShoot(s, CFG.shootPow, this, opp, _scratch)) sc += 1.5;
      sc += 2 * clamp(carrier.position.distanceTo(s) / 9, 0, 1);
      if (sc > bs) {
        bs = sc;
        best = s;
      }
    }
    this.bestSpot = best;
    return best;
  }

  /** Assign markers (defending POSITION players) to the most dangerous attackers. */
  assignMarks(): void {
    const opp = oppOf(this);
    const markers = this.outfield().filter((p) => p.role === 'POSITION');
    for (const p of this.players) p.marking = false;
    const ownGoal = V3(ownGoalX(this), 0, 0);
    const targets = opp
      .outfield()
      .filter((o) => o.position.x * this.side < 8)
      .sort((a, b) => distSq(a.position, ownGoal) - distSq(b.position, ownGoal));
    const used = new Set<Player>();
    for (const m of markers) {
      let best: Player | null = null;
      let bd = Infinity;
      for (const o of targets) {
        if (used.has(o)) continue;
        const d = distSq(o.position, m.position);
        if (d < bd) {
          bd = d;
          best = o;
        }
      }
      if (best) {
        used.add(best);
        m.marking = true;
        const gx = ownGoalX(this);
        const dx = gx - best.position.x;
        const dz = 0 - best.position.z;
        const dl = Math.hypot(dx, dz) || 1;
        m.markTarget = V3(best.position.x + (dx / dl) * 2.6, 0, best.position.z + (dz / dl) * 2.6);
      }
    }
  }

  update(_dt: number): void {
    // refresh perception for all players before any decision-making
    for (const p of this.players) if (!p.sentOff) updatePerception(p);

    this.inAttack = match.controlTeam === this;
    const of = this.outfield();
    const side = this.side;
    for (const p of this.players) p.role = p.roleType === 'GK' ? 'GK' : 'POSITION';

    if (this.inAttack && match.controlPlayer && match.controlPlayer.team === this) {
      const carrier = match.controlPlayer;
      if (carrier.roleType !== 'GK') carrier.role = 'CARRIER';
      const others = of.filter((p) => p !== carrier).sort((a, b) => b.position.x * side - a.position.x * side);
      if (others[0]) {
        others[0].role = 'SUPPORT';
        const sp = carrier.roleType !== 'GK' ? this.computeSupport(carrier) : null;
        others[0].supportTarget.copy(sp ?? supportSpot(this, carrier, 1));
      }
      if (others[1]) {
        others[1].role = 'SUPPORT';
        others[1].supportTarget.copy(supportSpot(this, carrier, -1));
      }
    } else {
      const sorted = of.slice().sort((a, b) => distSq(a.position, ball.position) - distSq(b.position, ball.position));
      if (sorted[0]) sorted[0].role = 'CHASER';
      if (ball.position.x * side < 0 && sorted[1]) sorted[1].role = 'CHASER';
      this.assignMarks();
    }

    // an assigned pass receiver overrides their tactical role to run onto the ball
    const rcv = match.receivingPlayer;
    if (rcv && rcv.team === this && rcv.roleType !== 'GK') rcv.role = 'RECEIVE';

    for (const p of this.players) {
      if (p.sentOff) continue;
      const role: PlayerRole = p.role;
      if (!p.fsm.in(role)) p.fsm.changeTo(role);
      p.fsm.update();
    }
  }
}
