import { CFG } from './constants';
import type { PlayerAttributes, RoleType } from './types';

/*
 * Derived athletic profile.
 *
 * Squads are authored with five headline ratings (pace, shooting, passing,
 * tackling, composure). Everything the movement / ball-control / duel systems
 * need is derived from those here, deterministically, so each player *moves and
 * handles the ball* differently — a 95-pace winger really does out-accelerate
 * and out-turn an 88-tackling centre-half, who in turn wins the shoulder duel.
 *
 * All derived values are 0..1 fractions unless noted.
 */
export interface Athlete {
  /** Top sprint speed (m/s). */
  sprint: number;
  /** Cruising run speed when not sprinting (m/s). */
  run: number;
  /** Peak acceleration from a standing start (m/s²). */
  accel: number;
  /** Braking deceleration (m/s²). */
  decel: number;
  /** How quickly the body turns (rad/s). */
  turn: number;
  /** 0..1 — agility: tight turns at speed. */
  agility: number;
  /** 0..1 — close control and first touch. */
  control: number;
  /** 0..1 — body strength in shoulder duels and shielding. */
  strength: number;
  /** 0..1 — stamina (slower drain, quicker recovery). */
  stamina: number;
  /** 0..1 fractions of the authored ratings, for convenience. */
  pace: number;
  shooting: number;
  passing: number;
  tackling: number;
  composure: number;
}

const f = (v: number): number => (v < 0 ? 0 : v > 100 ? 1 : v / 100);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Map a 0..1 rating so 0.4→0, 1.0→1 (ratings below 40 never occur in squads). */
const band = (v: number): number => Math.min(1, Math.max(0, (v - 0.4) / 0.6));

export function deriveAthlete(attr: PlayerAttributes, role: RoleType): Athlete {
  const pace = f(attr.pace);
  const shooting = f(attr.shooting);
  const passing = f(attr.passing);
  const tackling = f(attr.tackling);
  const composure = f(attr.composure);

  // Technique: touch and close control come from passing + composure, with a
  // dash of shooting technique. Defenders are usually a notch less silky.
  const control = Math.min(1, 0.5 * passing + 0.32 * composure + 0.18 * shooting + (role === 'ATT' ? 0.04 : 0));
  // Physique: strong tacklers are built for duels; whippet-quick forwards less so.
  const strength = Math.min(1, 0.62 * tackling + 0.2 * composure + 0.18 * (1 - pace) + (role === 'DEF' ? 0.06 : 0));
  // Agility: quick, light players turn sharper; heavy-duel players turn wider.
  const agility = Math.min(1, 0.55 * pace + 0.25 * control + 0.2 * (1 - strength) + 0.05);
  const stamina = Math.min(1, 0.45 + 0.3 * tackling + 0.25 * pace);

  const base = role === 'GK' ? CFG.spd.gk : CFG.spd.out;
  // pace 60 → ×0.90, 70 → ×0.95, 80 → ×1.0, 95 → ×1.075
  const sprint = base * lerp(0.9, 1.075, band(pace) / band(0.95));
  return {
    sprint,
    run: sprint * CFG.spd.run,
    accel: lerp(11, 17.5, band(0.6 * pace + 0.4 * agility)),
    decel: lerp(15, 22, band(agility)),
    turn: lerp(7.5, 13.5, band(agility)),
    agility,
    control,
    strength,
    stamina,
    pace,
    shooting,
    passing,
    tackling,
    composure,
  };
}
