# Performance budget

## What can and cannot be measured here

The development sandbox has **no GPU**: Chromium renders with SwiftShader at
1–2 fps for this scene, so frame times measured there say nothing about real
hardware. Until someone profiles on real devices, GPU performance is
**unverified**. What we do measure: simulation cost, draw calls, triangles,
texture/geometry counts.

## Reference targets (to be verified on hardware)

| Tier | Reference device | Target | Budget at the gameplay camera |
| --- | --- | --- | --- |
| Lite | mid-range 2021 Android phone | 30 fps stable (33 ms, p95 < 40 ms) | ≤ 60 draw calls, ≤ 250k tris, no shadows map / blob shadows, DPR 1 |
| Standard | recent phone / integrated-GPU laptop | 60 fps | ≤ 110 calls, ≤ 700k tris, 1024² shadow map |
| High | desktop with a mid-range discrete GPU (e.g. RTX 3060 class), 1440p | 60 fps (p99 < 16.7 ms) | ≤ 160 calls, ≤ 1.5M tris, 2048² shadows, bloom |
| Ultra | high-end desktop GPU, 4K | 60 fps, 120 where available | justify anything above High |

## Simulation cost (measured)

`npm run sim` on the sandbox CPU: **≈ 500× real time** for a 10-player match at
120 Hz with full AI (≈ 0.017 ms per tick). At 60 fps that is two ticks ≈ 0.03 ms
per frame — the simulation is not a bottleneck; 22 players at ~4× the pairwise
work still leaves two orders of magnitude of headroom.

## Rendering counts (measured via `__strikers.renderInfo()`)

| Build | Draw calls | Triangles | Notes |
| --- | --- | --- | --- |
| Baseline players + old stadium | 53 | 134k | 7 skinned meshes × 10 players |
| New player rig + old stadium | 35 | 186k | one welded mesh on one 65-joint skeleton per player |
| New stadium, environment only (lite / standard / high / ultra) | 14 / 16 / 29 / 31 | 38k / 50k / 59k / 60k | 17 085 crowd impostors in one draw call; high/ultra include ~13 post passes |
| Full match scene, `high`, broadcast camera | 53–56 | 430–480k | 10 players at ~20k tris each + shadow pass — players dominate; no player LOD yet |

## Rules

- No per-frame allocation in the tick or the presenter (typed-array snapshots;
  scratch vectors).
- Skinned players: one mesh, one skeleton, one material instance each.
- Everything repeated is instanced; static geometry is merged.
- Measure frame-time *distributions* (p50/p95/p99), not averages, when hardware
  is available; separate CPU (sim/JS) from GPU (use `EXT_disjoint_timer_query`
  where supported). Never report an improvement without numbers.
