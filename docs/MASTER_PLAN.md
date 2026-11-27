# Master plan

Vision → Milestones → Vertical slices → Requirements → Implementation → Verification.

**Status legend** — `DONE` verified with evidence · `PART` implemented, verification
or scope incomplete · `TODO` not started. Evidence types: **A** automated (harness /
unit / browser script), **O** AI observation of screenshots, **H** human playtest
(none has happened yet).

Milestones are not silos; each must leave a playable, better game.

## M1 — The football foundation

| ID | Requirement (player experience) | Acceptance | Status | Evidence / limits |
| --- | --- | --- | --- | --- |
| SIM-01 | The match plays the same at any frame rate | Fixed 120 Hz tick; render interpolates; no gameplay code takes a frame delta | DONE | A: `step.ts` is the only stepper; harness + browser run the same function |
| SIM-02 | A match can be reproduced | Seeded RNG for all sim randomness; same seed ⇒ identical final state | DONE | A: `npm run sim` determinism check (hash equal twice, differs for another seed). Live matches are not input-recorded yet |
| SIM-03 | Sim and presentation are separate | Sim emits bus events; no audio/DOM/render calls for gameplay feedback | PART | A: grep — `flow.ts`/`penalty.ts` still call HUD for screen flow (stubbed headless) |
| SIM-04 | Headless == shipped | Harness builds the real sim with presentation stubs only | DONE | A: `simtest/vite.config.ts`, 500× real time |
| BALL-01 | The ball flies like a football | Drag, 3-axis spin, Magnus, spin-coupled bounce, rolling model | DONE | A: `--physics` (closed forms vs integrator; curl 3.2 m in 1 s at 25 m/s). No drag-crisis model |
| BALL-02 | Shots can't tunnel the frame; woodwork is real | Sub-stepped cylinder collisions for posts + bar | PART | A: posts/bar hit 1–3×/match in sims. No dedicated tunnelling regression test yet |
| BALL-03 | A goal ends up in the net | Net volume catches the ball; `net` event carries impact | DONE | A: goals register only via the mouth (bug found + fixed with the shot tracer); O: pending new net visuals |
| BALL-04 | The ball is never glued to a player | Dribbling by touches; heavy touches at sprint; turn requires reaching the ball | DONE | A: diag (`touch` events), nick statistics; O: screenshots. H: feel untested |
| BALL-05 | First touch depends on the player and the pass | Capacity model (control, height, direction, speed, pressure) → trap / heavy / block | DONE | A: diag avg quality 0.8, ~4 poor touches/match, blocks 5/match |
| BALL-06 | Kicks are aimed, weighted and can go wrong | Aim solver + execution error from skill/context | DONE | A: `--physics` aim within 0.12 m with error 0 |
| MOVE-01 | Players have weight but respond | Acceleration/brake/grip/turn-rate body model shared by human and AI | PART | A: runs, distances plausible (≈1.2 km / 4 min). H: responsiveness untested by a human |
| MOVE-02 | Players feel different | Derived athletic profile from ratings drives speed/accel/agility/control/strength | PART | A: values differ per player; no test that shows a winger out-turning a centre-half yet |
| MOVE-03 | Contact matters | Strength-weighted body contact, stumbles | PART | A: `collide` events ≈ 50/match. No shielding action |
| GK-01 | Keepers make believable saves and mistakes | Reaction, reading error, finite dive, catch/parry/tip/spill/smother | PART | A: `--gk` table, goal tracers (fixed over-rushing, near-post shade, slow hands). Still a cliff between "no chance" (precise 11 m corner) and "almost always saved" (16 m+); conversion 33 % at PRO, 44–49 % at the top tiers |
| DEF-01 | Winning the ball is a skill | Geometric tackles/slides, fouls for man-first | PART | A: tackles ≈ 14–20/match, fouls ≈ 1/match. H: timing feel untested |
| CTRL-01 | Gamepad is first-class | Standard-mapping pad plays everything, dead zone handled | PART | A: browser run with a *mocked* standard pad (move, sprint, pass, shoot, shoot-out). No physical controller tested; no remap/dead-zone UI |
| CTRL-02 | First-time play | Buffered kick requests resolve as the ball arrives | PART | A: AI first-time finishes occur; human path exercised only by script |
| CTRL-03 | Expressive shooting/passing | Charge → power+height, stick aim, finesse, chip, through, lob | PART | A: script shot registers; aim/feel need human testing |
| TOOL-01 | Developers can see why | `--diag`, `--gk`, `--physics`, `window.__strikers` | DONE | A: used to find the net-ejection, over-dive and first-touch bugs |
| TOOL-02 | Football Intelligence / physics lab overlay | In-browser visualisation of trajectories, intents, pitch control | PART | O: `F2` / `?lab` overlay — predicted flight, steering intents by role, interception points, timings, seed, bus events, speed/step controls. No pitch control, no pass-candidate scores yet |

## M2 — The beautiful game

| ID | Requirement | Status | Notes |
| --- | --- | --- | --- |
| ANIM-01 | Animation is a function of game state (works in replays) | DONE | A/O: replays animate; see ANIMATION_DESIGN |
| ANIM-02 | Boot meets ball on the contact tick | PART | O: contact frame measured from a strip (0.47); keeper dive verified frame-by-frame in game. Shots use the same side-foot clip |
| ANIM-03 | Walk/jog/strafe/slide/header/keeper clips | TODO | needs licensed clips |
| ANIM-04 | Leg IK to the ball, upper-body layers | TODO | |
| PLAY-01 | Shielding, skill moves, player-triggered runs | TODO | |
| PLAY-02 | Proper set pieces (throw-ins, corners, free kicks with walls) | TODO | currently quick restarts |
| PLAY-03 | Balance: 2–4 goals per 6 min, ~45–55 % on target, ~25–30 % conversion, 78 %+ pass accuracy | PART | PRO now ≈ 3.6 goals / 4 min, 51 % on target, 33 % conversion, 76 % pass accuracy (baseline ≈ 11.5 goals, 96 %) |
| PLAY-04 | Practice arena | TODO | |

## M3 — Football intelligence

Pitch-control / influence maps, team tactical state machine (build-up, press,
mid/low block, transitions), structured runs (overlap, third man, near/far post),
zonal + man marking, offside line management, tactical identities per nation,
opponent adaptation, Football Intelligence Lab overlay. See `FOOTBALL_AI.md` — all TODO
except the cover defender and xG-based shot selection (PART).

## M4 — Next-generation presentation

| ID | Requirement | Status | Notes |
| --- | --- | --- | --- |
| REND-01 | Teams are instantly distinguishable; players look like footballers | DONE | O: kits/skin/numbers/indicators merged; see PLAYER_RENDERING. One shared face, no hair geometry |
| REND-02 | A stadium that looks like one (bowl, instanced crowd, boards) | PART | O: bowl, 17k coloured instanced crowd reacting to `pulse`/goals, LED boards, scoreboards — see RENDERING_DESIGN. Black-frame bug (non-finite HDR texel through bloom) fixed by sanitising; source texel never identified. Real-GPU cost unmeasured |
| REND-03 | Professional pitch, lighting presets, quality tiers | PART | O: analytic pitch, 5 presets, 4 tiers all boot without shader errors (screenshots). No grass-blade layer; dynamic resolution never exercised on a GPU |
| REND-04 | Goal nets that deform | PART | O: Verlet cloth net reacts to `net`/`post`/ball; seen only as still frames |
| CAM-01 | Readable broadcast camera with predictive framing + modes | PART | O: broadcast/tele/tactical/dynamic rigs; no settings UI; not human-tuned |
| CAM-02 | Multi-angle replays from recorded play | PART | two-shot sequence; scrub/rate API exists, no UI |
| AUD-01 | Bus-driven stadium audio with a crowd-emotion model | PART | A: merged; 90 offline numeric assertions + 58 unit tests on the pure emotion model; live match runs with no errors. **Nobody has listened to it** — see AUDIO_DESIGN |
| UI-01 | Premium menus / broadcast HUD | TODO | only key hints added |

## M5 — Full-scale football
Configurable pitch/team size (7- and 11-a-side), formations, roles, instructions,
formation editor. TODO. Prerequisite: remove module-level reads of pitch constants
(`Team.spots`, `FORMATION`, penalty spot) and make `CFG` per-match.

## M6 — The complete experience
Training arena, challenges, career. TODO. Existing friendly / knockout / World Cup /
progression systems are preserved and untouched.

## M7 — Relentless quality
Real-device profiling, human playtests, long-session stability, save-migration
re-verification after every schema change. TODO.
