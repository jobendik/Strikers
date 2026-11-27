/**
 * Shared simulation clock.
 *
 * The match simulation advances in fixed ticks of {@link SIM_DT} seconds — it is
 * never fed a variable frame delta. The render loop accumulates real time and
 * runs as many ticks as fit, then interpolates the presentation between the last
 * two ticks. Gameplay outcomes are therefore independent of frame rate.
 */

/** Simulation tick rate (Hz). 120 Hz keeps fast shots and contacts well-resolved. */
export const SIM_HZ = 120;
/** Fixed simulation step (seconds). */
export const SIM_DT = 1 / SIM_HZ;

export const sim = {
  /** Seconds advanced by the current tick (always SIM_DT while the sim runs). */
  dt: SIM_DT,
  /** Total elapsed simulation seconds since the match state was created. */
  elapsed: 0,
  /** Tick counter since the match state was created. */
  tick: 0,
  /** Bumped every time the clock is reset (a new headless match) — invalidates per-tick caches. */
  epoch: 0,
};

/** Advance the simulation clock by one fixed tick. */
export function advanceTick(): void {
  sim.dt = SIM_DT;
  sim.elapsed += SIM_DT;
  sim.tick++;
}

/** Reset the simulation clock (new match / headless run). */
export function resetSimClock(): void {
  sim.dt = SIM_DT;
  sim.elapsed = 0;
  sim.tick = 0;
  sim.epoch++;
}

/**
 * Sim-time throttle (replaces Yuka's wall-clock `Regulator`, which would make AI
 * decision cadence depend on real time and break determinism). `phase` staggers
 * agents so they don't all think on the same tick.
 */
export class SimRegulator {
  private period: number;
  private next: number;

  constructor(hz: number, phase = 0) {
    this.period = 1 / hz;
    this.next = phase * this.period;
  }

  /** True at most `hz` times per simulated second. */
  ready(): boolean {
    // the clock was reset under us (a module-level regulator across headless matches):
    // without this it would stay silent until the new clock caught up with the old one
    if (this.next - sim.elapsed > this.period + 1e-6) this.next = sim.elapsed;
    if (sim.elapsed + 1e-9 < this.next) return false;
    this.next = sim.elapsed + this.period;
    return true;
  }

  reset(phase = 0): void {
    this.next = sim.elapsed + phase * this.period;
  }
}
