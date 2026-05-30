/**
 * Shared simulation time.
 *
 * Yuka's `State.execute(owner)` only receives the owner, not a delta, so player
 * states read the frame delta from here. `elapsed` is a monotonically growing
 * clock used as the timestamp source for the perception/memory system.
 */
export const sim = {
  /** Seconds elapsed in the last frame (already clamped by the main loop). */
  dt: 0,
  /** Total elapsed simulation seconds. */
  elapsed: 0,
};

export function advanceTime(dt: number): void {
  sim.dt = dt;
  sim.elapsed += dt;
}
