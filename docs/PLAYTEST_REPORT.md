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

### Rebuilt simulation (10 × (2×120 s) per scenario, seeded)
| Scenario | Goals | Shots | On target | Conversion | Pass acc. |
| --- | --- | --- | --- | --- | --- |
| EASY USA v BRA | 2.0–1.9 | 3.8–4.0 | 73 % | 50 % | 78 % |
| PRO USA v BRA | 2.0–2.8 | 4.5–5.3 | 62 % | 49 % | 72 % |
| LEGEND USA v BRA | 2.9–2.8 | 5.9–5.3 | 66 % | 51 % | 73 % |
| WORLD CLASS USA v BRA | 3.5–3.4 | 5.5–5.8 | 73 % | 61 % | 69 % |
| PRO BRA v BRA (mirror) | 1.8–2.4 | 4.1–4.5 | 62 % | 49 % | 74 % |

No NaN, no hung matches, no stuck balls, deterministic.

### Bugs found by the tooling and fixed
1. Goals were ejected by the net collision (treated as hitting the netting from
   outside) — found with the per-shot tracer: "on target" was 16 %.
2. Keepers over-dived (aimed hips, not hands, at the ball) — found with the
   in-match goal tracer.
3. First touch pushed the ball out of reach of a jogging receiver, causing ~30
   giveaways per match — found with the nick statistics.
4. A keeper could carry the ball behind his goal line.

### Open observations
- Conversion ≈ 50 %: too many finishes from inside 10 m (≈ 60 % of shots); the
  keeper outcome curve is too binary by distance.
- Higher difficulty currently raises scoring for both sides in AI v AI.
- An AI side scored 3 s after kick-off in the browser smoke run.
- Browser smoke run (scripted WASD + shoot): movement, shot, goal, replay all
  functioned; no console errors.

### Needs a human
Stick feel and turning, shot aiming, tackle timing, camera comfort, difficulty
curve, touch controls on a phone, a real gamepad, audio.
