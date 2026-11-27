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

### Open observations
- Conversion is still above target at the higher difficulties (44–49 %) and most
  shots still come from 5–10 m; `--gk` still shows a cliff between "unsaveable"
  (precise 11 m corner) and "almost always saved" (16 m+).
- Passing is quick (≈ 120 passes per 4 min) — carriers rarely take players on.
- Higher difficulty raises scoring for both sides in AI v AI (sharper finishing).

### Needs a human
Stick feel and turning, shot aiming, tackle timing, camera comfort, difficulty
curve, touch controls on a phone, a real gamepad, audio.
