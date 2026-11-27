# Playtest report

## Human playtesting

**None yet.** Nobody has played the rebuilt game with a keyboard, gamepad or touch
screen. Everything below is automated or AI-observed.

## Session 1 (2026-11-26) — automated + AI observation

### Baseline (commit cf0ea14)
- AI v AI, PRO, USA v BRA, 6 × (2×120 s): 6.2–5.3 goals, 24–20 shots, **96 % of
  shots "on target"**, 67 % pass completion, stuck-ball frames in 6 of 10 scenarios.
- Browser: tiny, identical grey players (kits never applied), 8.8 m × 4 m goals
  beside 1.85 m players, ball glued to the carrier, replays slid frozen poses.

### Rebuilt simulation (8 × (2×120 s) per scenario, seeded — end of session 1)
| Scenario | Goals | Shots | On target | Conversion | Pass acc. | Saves |
| --- | --- | --- | --- | --- | --- | --- |
| EASY USA v BRA | 0.9–1.0 | 4.0–3.3 | 40 % | 26 % | 76 % | 1.1 |
| PRO USA v BRA | 1.6–2.0 | 4.8–6.4 | 51 % | 33 % | 76 % | 3.0 |
| LEGEND USA v BRA | 3.1–2.6 | 6.5–6.5 | 58 % | 44 % | 73 % | 3.0 |
| WORLD CLASS USA v BRA | 2.1–3.0 | 4.3–6.1 | 66 % | 49 % | 73 % | 3.1 |
| PRO BRA v BRA (mirror) | 2.5–2.6 | 5.8–7.3 | 54 % | 39 % | 76 % | 2.4 |
| PRO ARG v FRA | 1.4–1.8 | 5.3–6.1 | 38 % | 27 % | 73 % | 1.8 |

Baseline for comparison (PRO USA v BRA): 6.2–5.3 goals, 96 % "on target".
No NaN, no hung matches, no stuck balls, deterministic. Shots by distance over 8
LEGEND matches: 12 / 54 / 18 / 7 / 15 from 0–5 / 5–10 / 10–15 / 15–20 / 20–25 m,
goals 5 / 33 / 5 / 2 / 2.

### Bugs found by the tooling and fixed
1. Goals were ejected by the net collision (treated as hitting the netting from
   outside) — found with the per-shot tracer: "on target" was 16 %.
2. Keepers over-dived (aimed hips, not hands, at the ball) — found with the
   in-match goal tracer.
3. First touch pushed the ball out of reach of a jogging receiver, causing ~30
   giveaways per match — found with the nick statistics.
4. A keeper could carry the ball behind his goal line.
5. Dribble touches were paced off the *wanted* speed, so the ball escaped a player
   setting off or reversing (1.9 m away at a jog; lost on a sprint reversal) —
   found with the scripted human-control run.
6. Keepers were dragged 5–8 m out of goal by over-eager one-on-one rushes and
   sweeping, stood on the ball when they collected it outside the box, shaded the
   near post far too much, and got their hands down to low shots too slowly —
   found with the close- and mid-range goal tracers.
7. Clip root motion on `Armature.position` displaced bodies up to 2.5 m from their
   simulated position (pre-existing) — found while calibrating the dive clip.
8. A wider keeper "spread" stance swatted dribble touches and counted them as
   saves — caught by the harness check `on-target ≤ shots`.

### Browser runs (Playwright, software WebGL, sim stepped deterministically)
- Scripted human control: jog (ball ≤ 1.03 m), sprint (≤ 1.34 m), full-sprint
  reversal keeps the ball (~0.8 s), 90° cut, stop on the ball, stick-aimed pass
  completes with auto-switch + assisted receive, charged shot registers.
- Gamepad via a mocked standard pad: stick + RT moves at sprint speed, A passes.
- Penalty shoot-out played through to full time.
- A full 2×2 min match to the result screen: half-time, second half, full time,
  result card, no console errors. (With an idle human the user's side lost 0–10 —
  an idle player is not a fair test, but it prompted the finishing/keeper fixes.)
- Goal → celebration camera → animated touchline replay; keeper dive sequence
  checked frame by frame (set → full stretch → parry → get up).
- Phone landscape (844×390, touch): boots on the `standard` tier, touch pad shown.

### Balance pass 2 (2026-11-27) — 16 × (2×120 s) per scenario, seeded
| Scenario | Goals | Shots | On target | Conversion | Pass acc. | Saves |
| --- | --- | --- | --- | --- | --- | --- |
| EASY USA v BRA | 0.7–1.1 | 4.3–5.7 | 34 % | 18 % | 91 % | 1.9 |
| PRO USA v BRA | 0.8–0.9 | 3.6–5.4 | 34 % | 19 % | 90 % | 1.7 |
| LEGEND USA v BRA | 0.9–0.9 | 3.6–3.7 | 40 % | 25 % | 86 % | 2.1 |
| ULTIMATE USA v BRA | 0.8–1.4 | 4.3–6.2 | 37 % | 21 % | 85 % | 2.3 |
| WORLD CLASS USA v BRA | 0.9–1.2 | 4.6–5.6 | 33 % | 20 % | 82 % | 1.5 |
| PRO BRA v BRA (mirror) | 1.1–1.1 | 3.9–4.9 | 40 % | 25 % | 89 % | 1.8 |
| PRO ARG v FRA | 0.9–1.0 | 4.1–5.1 | 32 % | 21 % | 88 % | 1.3 |
| PRO NOR v SEN | 1.0–1.5 | 4.6–4.4 | 40 % | 28 % | 88 % | 1.9 |
| LEGEND GER v ENG | 0.8–0.8 | 3.3–3.1 | 44 % | 26 % | 87 % | 1.6 |

What the new diagnostics showed before the fixes (WORLD CLASS, 8 matches): 35 shots
from inside 5 m with the nearest defender 7 m away and the keeper 1 m from the ball —
almost all taken 0.1–0.3 s after the *keeper's own* pass or clearance from his feet;
61 headers a match, 57 of them straight after another header; 75 % of passes played
with a defender inside 1.8 m, a quarter of those cut out within 4 m of the passer.
After: headers ≈ 15 a match, pressed mid-range passes complete 85–89 %.

AI observation (one seeded sequence, five stills): the keeper holds the ball, the
nearest forward backs off to the edge of the box, the throw reaches a team-mate.

### Attacking variety (2026-11-27, PRO, 12 × (2×120 s), `--diag`)
| How the chance was made | before | after |
| --- | --- | --- |
| Loose ball / rebound | 34 % | 29 % |
| Pass, a touch, shot | 20 % | 13 % |
| Solo carry | 15 % | 18 % |
| Through ball (any finish) | 9 % | 15 % |
| Header from a cross | 2 % | 10 % |
| First-time finish | 0 % | 8 % |
| Crosses per match | 2.6 | 8.7 |

Cause found on the way: with the ball between two of its own players a side was not
"in attack", so for every pass its off-ball players dropped into defensive positions
and one of them chased the pass. After fixing that and adding pass-and-move runs,
shots rose to 3.4 a minute (target ≤ 2.7) with 60 % of close-range shooters unmarked;
tighter marking of runners brought it back to 2.32 shots and 0.60 goals a minute over
90 matches. None of this has been watched as continuous play.

### Open observations
- **Correction:** an earlier version of this report said chances were now too scarce.
  That compared 2×2-minute runs with targets written for the game's real 2×3 minutes.
  At the real length (10 seeds per scenario, after AI shooters were taught to aim inside
  the post by their expected spread):

  | Scenario (2×180 s) | Goals | Shots | On target | Conversion | Pass acc. | Saves |
  | --- | --- | --- | --- | --- | --- | --- |
  | EASY USA v BRA | 1.2–2.3 | 5.2–6.6 | 47 % | 30 % | 91 % | 3.5 |
  | PRO USA v BRA | 1.2–1.9 | 4.8–7.1 | 46 % | 26 % | 88 % | 3.6 |
  | LEGEND USA v BRA | 1.2–1.3 | 4.3–5.3 | 55 % | 26 % | 86 % | 3.5 |
  | ULTIMATE USA v BRA | 1.7–2.7 | 6.2–9.2 | 45 % | 29 % | 85 % | 4.2 |
  | WORLD CLASS USA v BRA | 1.0–2.3 | 7.4–6.2 | 41 % | 24 % | 83 % | 3.4 |
  | PRO BRA v BRA (mirror) | 2.3–2.8 | 7.4–7.6 | 52 % | 34 % | 89 % | 4.4 |
  | PRO ARG v FRA | 2.0–2.1 | 6.6–9.1 | 46 % | 26 % | 89 % | 4.5 |
  | PRO NOR v SEN | 1.5–1.4 | 4.9–6.5 | 48 % | 25 % | 88 % | 3.7 |
  | LEGEND GER v ENG | 1.2–1.3 | 4.9–5.5 | 36 % | 24 % | 86 % | 2.1 |

  These meet the targets in `QUALITY_STANDARD.md` (2–4 goals, 10–16 shots, 45–55 % on
  target, 25–30 % conversion) apart from two scenarios' on-target share, the mirror's
  5.1 goals and pass completion a few points above the 78–85 % band.
- Possession spells (PRO, 8 matches): ≈ 42 a match, 48 % reach the final third, 43 % of
  those end in a shot — but a final-third spell lasts only ≈ 3.3 s. Attacks are quick
  strikes; there is little sustained pressure or combination play.
- _Superseded by balance pass 2 — the three points below describe the state before it:_
- Conversion is still above target at the higher difficulties (44–49 %) and most
  shots still come from 5–10 m; `--gk` still shows a cliff between "unsaveable"
  (precise 11 m corner) and "almost always saved" (16 m+).
- Passing is quick (≈ 120 passes per 4 min) — carriers rarely take players on.
- Higher difficulty raises scoring for both sides in AI v AI (sharper finishing).

### Needs a human
Stick feel and turning, shot aiming, tackle timing, camera comfort, difficulty
curve, touch controls on a phone, a real gamepad, audio.
