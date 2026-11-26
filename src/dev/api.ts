import { CFG } from '../config/constants';
import * as bus from '../core/bus';
import { sim, SIM_DT, SIM_HZ } from '../core/time';
import { rngSeed } from '../core/rng';
import { ball, match } from '../game/state';
import { loopCtl, stepTicks } from '../game/loop';
import { ballTrajectory } from '../game/predict';
import { replayCtl } from '../game/replay';
import { setCameraMode, getCameraMode } from '../game/camera';
import { renderer } from '../rendering/scene';

/*
 * Developer / test API — `window.__strikers`.
 *
 * Gives automated browser tests (Playwright) and the dev lab a stable handle on
 * the running game: read the live state, step the simulation deterministically
 * (independent of the display frame rate), listen to the event bus, read
 * renderer statistics. It exposes nothing a player could not already do and has
 * no effect unless something calls it.
 */
export function installDevApi(): void {
  const api = {
    CFG,
    bus,
    sim,
    SIM_DT,
    SIM_HZ,
    get match() {
      return match;
    },
    get ball() {
      return ball;
    },
    get seed() {
      return rngSeed();
    },
    loop: loopCtl,
    replay: replayCtl,
    /** Advance exactly `n` simulation ticks now (use with loop.manual = true for frame-rate-free tests). */
    step: (n = 1) => stepTicks(n),
    /** Advance `seconds` of simulated time. */
    run: (seconds: number) => stepTicks(Math.round(seconds * SIM_HZ)),
    trajectory: () => ballTrajectory(),
    camera: { set: setCameraMode, get: getCameraMode },
    /** Renderer statistics for the last frame. */
    renderInfo: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures }),
    /** A compact summary of the match right now (for assertions). */
    summary: () => ({
      state: match.state,
      score: [...match.score],
      half: match.half,
      timeLeft: match.timeLeft,
      tick: sim.tick,
      ball: { x: ball.position.x, y: ball.position.y, z: ball.position.z, speed: ball.velocity.length() },
      control: match.controlPlayer ? { name: match.controlPlayer.name, team: match.controlPlayer.team.short } : null,
      user: match.userPlayer ? { name: match.userPlayer.name, x: match.userPlayer.position.x, z: match.userPlayer.position.z, speed: match.userPlayer.getSpeed(), act: match.userPlayer.act } : null,
      stats: match.stats,
    }),
  };
  (window as unknown as { __strikers: typeof api }).__strikers = api;
}
