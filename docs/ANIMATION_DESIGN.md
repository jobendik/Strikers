# Animation design

## Assets

One Mixamo footballer rig (65 joints) and seven clips: idle, run, sprint, kick,
keeper dive left/right, celebrate. Root translation is stripped. See
`PLAYER_RENDERING.md` for the model/licence notes.

## Principle: pose = f(snapshot)

`src/game/playerAnim.ts` never free-runs action clips. Each player's snapshot
block carries position, heading, velocity, action code, action clock, contact
time and a **stride phase** integrated by the simulation from real ground speed.

| Layer | How it is driven |
| --- | --- |
| Locomotion blend space | idle ⇄ run ⇄ sprint weights from speed relative to the player's own run speed; run and sprint are *scrubbed* by stride phase (one clip cycle = two steps), with per-clip phase offsets measured at start-up (`calibrateClips` finds the left-foot plant) so they stay foot-locked to each other. |
| Actions | Kick: scrubbed so the clip's contact frame (`CLIP_CAL.kickContact`) lands on the simulation's contact tick; short wind-ups start mid-swing. Dive: a sub-range of the 3.4 s dive clips mapped onto the dive's duration, left/right from the dive direction relative to facing. Celebrate: free-running on the scoring team. |
| Procedural | Lean into acceleration, bank into turns (from velocity change); slide = body laid back with the leading leg out; getting up; header hop; stumble; standing-tackle jab. |

Because of this, replays (which feed recorded snapshots to the same presenter)
animate exactly as the live action did, at any speed, including scrubbing.

## Honest status

- Calibration constants (`kickContact` 0.40, dive range 0.20–0.50) are estimates
  that have been checked only against a handful of screenshots.
- No walk / jog / strafe / back-pedal / turn clips: jockeying and walking reuse
  the run clip at low cadence. No dedicated slide, tackle, header, trap, throw,
  save-catch or get-up clips — these are procedural approximations.
- No IK foot placement, no upper/lower-body layering, no motion matching (the
  clip set is far too small for it — not claimed).
- Next: source appropriately-licensed clips (walk, jog, strafes, slide, header,
  keeper set/catch), add an upper-body additive layer for shielding/receiving,
  and two-bone leg IK so the striking foot actually meets the ball.
