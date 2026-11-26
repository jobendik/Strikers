# Quality standard

Scores are **qualitative judgements by the AI developer**, on a demanding 1–10
scale (9 = exceptional, 10 = extraordinary), from automated evidence and
screenshots. **No human has played this build.** Treat every number as
provisional until human playtests exist; "feel" dimensions especially.

| Dimension | Baseline | Now | Why |
| --- | --- | --- | --- |
| Gameplay enjoyment | 4 | 4–5? | Unknown without human play. Mechanically much richer; balance not final. |
| Input responsiveness | 5 | 5? | Fixed 120 Hz tick and buffering help; kick wind-ups and momentum add latency by design. Unmeasured. |
| Football authenticity | 3 | 5 | Real proportions and speeds, physical ball, real first touch/tackles; scorelines still high. |
| Mechanical depth | 3 | 5 | Shot height/placement, finesse, chip, through, lob, jockey, first-time play, tackle timing. Skill moves/shielding missing. |
| Ball physics | 3 | 6 | Drag, 3-axis Magnus, spin bounces, frame, nets, verified solver. No body/leg collisions mid-action, simple net. |
| Player movement | 3 | 5 | Shared body model with attribute-driven limits; untuned by human hands. |
| Animation quality | 3 | 4 | Now state-driven and replay-correct with stride sync; still 7 clips and procedural stand-ins. |
| Individual AI | 4 | 5 | xG-based shooting, interception prediction, tackle timing, far better keeper logic. |
| Collective AI | 3 | 3–4 | Cover defender added; otherwise the same role system. |
| Goalkeeper quality | 3 | 5 | Believable mechanics; outcome curve still too binary. |
| Visual fidelity | 3 | 4 (→ more when the stadium branch merges) | Players transformed; old stadium still in this build. |
| Stadium atmosphere | 2 | 2 (pending merges) | |
| Audio quality | 2 | 2 (pending merge) | |
| Camera quality | 3 | 5 | Tele broadcast with predictive framing; needs human tuning. |
| Replay quality | 2 | 5 | Faithful, animated, two angles; no UI for scrub. |
| User interface | 5 | 5 | Unchanged apart from key hints. |
| Accessibility | 5 | 5 | Assists on by default; no remap UI yet. |
| Replayability | 5 | 5 | Existing modes/progression intact. |
| Performance | ? | ? | Sim is ~500× real time; GPU performance unmeasured on real hardware. |
| Technical robustness | 5 | 6 | Determinism, self-tests, seeded harness; browser coverage is one smoke script. |
| Overall polish | 3 | 4 | A foundation, not a finished product. |

## Target balance (5-a-side, 2×3 min, PRO, AI v AI)

2–4 goals per match · 10–16 shots · 45–55 % on target · 25–30 % conversion ·
78–85 % pass completion · possession 45–55 % in mirror matches · no NaN, no
stuck ball, ball never > 1.2 m out of play without a restart.

## Definition of done for a requirement

Code + automated check where possible + browser evidence + a line in
`MASTER_PLAN.md` naming the evidence and the known limits. "It compiles" and "the
test passes" are not evidence of fun.
