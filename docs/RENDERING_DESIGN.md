# Rendering design — environment (stadium, crowd, pitch, lighting, goals, tiers)

Scope: everything that is not a player or the ball. Three.js r160, WebGL2, no
downloaded assets — every texture is generated at boot (canvas / DataTexture) and
every repeated thing is merged or instanced.

All evidence in this document comes from this cloud sandbox (Chromium +
SwiftShader, no GPU): screenshots read by the author, `renderer.info` counts and
a Node run of the cloth solver. **No real-GPU frame time has been measured and no
human has play-tested it.**

## 1. Module map

| File | Role |
|---|---|
| `rendering/quality.ts` | Tier table, `applyQualityTier` / `getQualityTier` / `getQuality`, `onQualityChange`, dynamic-resolution governor. No renderer imports (no cycles). |
| `rendering/env.ts` | The five presets (pure data), the shared uniform block `envU`, and the GLSL chunks every environment shader includes (`ROOF_SHADOW`, `STADIUM_LIGHT`). |
| `rendering/scene.ts` | Renderer, scene, camera, light rig, `setEnvironmentPreset`, `renderFrame`, `getRenderStats`, `scanHdr`. |
| `rendering/sky.ts` | Sky dome shader + cube capture → PMREM (`scene.environment`). |
| `rendering/postfx.ts` | HDR chain: MSAA half-float target → bloom → final (ACES, grade, vignette, sRGB, dither). |
| `rendering/layout.ts` | Stadium dimensions and the 8 bowl sections (single source of truth). |
| `rendering/geo.ts` | Immediate-mode mesh builder (quads, boxes, beams, section sweeps). |
| `rendering/bowl.ts` | Terraces, vomitories, aisles, fascia, roof + trusses, shell, floodlight masts, seat list, shadow proxy. |
| `rendering/materials.ts` | Stadium / lamp / glow shaders. |
| `rendering/crowd.ts` | Instanced impostor crowd + sprite atlas. |
| `rendering/pitch.ts`, `pitchTexture.ts` | Analytic pitch shader; turf detail + seat textures. |
| `rendering/goalNet.ts` | Goal frames + Verlet net. |
| `rendering/ledBoards.ts` | LED perimeter boards, fascia ribbon, scoreboards, brand atlas. |
| `rendering/props.ts` | Dugouts, tunnel, corner flags. |
| `rendering/rain.ts` | Rain streaks. |
| `rendering/stadium.ts` | Orchestration: `buildStadium`, `updateStadium`, `setCrowdColors`, `setScoreboardTeams`, `netImpulse`; bus subscriptions. |

Contracts kept: `scene.ts` exports `renderer, scene, camera, sun, world,
handleResize, renderFrame`; `stadium.ts` exports `buildStadium`, `updateStadium`.
New: `setEnvironmentPreset(name)`, `ENV_PRESETS`, `getEnvironmentPreset`,
`getRenderStats`, `scanHdr` (scene); `setCrowdColors`, `setScoreboardTeams`,
`netImpulse`, `stadiumRoot` (stadium). The headless-sim stubs in
`simtest/vite.config.ts` list all of them.

Dev hook: `window.__gfx` (`setEnvironmentPreset`, `getRenderStats`, `scanHdr`,
`stadium.{updateStadium, netImpulse, root}`), and `?env=<preset>` in the URL.

## 2. Stadium ("The Meridian Bowl")

A rounded-rectangle bowl (stand front at `halfL+8 × halfW+8`, corner radius 10)
described once in `layout.ts` as 4 straights + 4 corners. Every surface is a
*sweep* of a profile edge `(d, y)` along a section, so straights and corners come
from the same code.

- **Horseshoe** (−Z, both ends, all four corners): 17-row lower tier (26.6°),
  dark concourse band, fascia carrying the LED ribbon, 16-row upper tier (35°).
- **Main stand** (+Z, camera side): the same lower tier, then an **open broadcast
  deck** (y ≈ 8, z 42…48) that the gameplay cameras fly over, a strip of glazed
  boxes and a short 8-row upper tier behind the camera positions.
- Real stepped terraces (tread + riser per row), radial aisle stairs, vomitories
  cut into the rows (floor, portal, side walls), the players' tunnel through the
  main stand, hand rail, cantilever roof with a translucent leading strip,
  purlins, tapered trusses at every aisle line, back columns, outer shell, four
  leaning floodlight masts behind the corners, a roof-edge LED floodlight line.
- Pitch side: LED perimeter boards (three full sides; the near side is broken for
  tunnel + dugouts), two dugouts with curved glazed canopies and seats, tunnel
  canopy, technical-area markings, corner flags, two scoreboards under the roof
  edge at the ends.

**Camera clearance (+Z side).** Limit given by the camera rigs: nothing above
`y = 0.45·(z − 20)` for z ∈ 20…36. Actual: boards 1.0 m at z = 24 (limit 1.8),
dugout canopy ≤ 2.32 m at z ≥ 25.5 (limit ≥ 2.5), tunnel canopy 2.3 m at z = 25.6
(limit 2.5), rail 1.75 m at z = 28 (limit 3.6), seated heads on the lower tier
`≈ 0.50·(z − 28) + 2.3` (under the limit throughout). Raised hands of fans
*jumping during a goal eruption* exceed the line by up to ≈ 0.4 m at z ≈ 35 —
below every camera's actual sight line, but it is over the nominal rule. Verified
by screenshot from the broadcast (y 17, z 43, fov 30), tele (y 12.5, z 45,
fov 24) and dynamic (y 9.5, z 34, fov 38) rigs: no stand in frame with the ball
in midfield; with the ball on the near touchline the dynamic rig shows the dugout
and tunnel roofs along the bottom edge (below the touchline in frame).

**Shading.** The stands do *not* use three's PBR light loop. One small shader
(`materials.ts`): vertex colour × optional texture × (hemisphere ambient + key
light with the analytic roof shadow + a floodlight-spill term). Reason: stands
fill a large part of many frames with purely diffuse surfaces; this avoids a
4-light GGX loop and shadow-map taps per pixel and is trivially art-directable
per preset. All such materials share one uniform block by reference, so a preset
change is a handful of uniform writes.

**Roof shadow.** A point is lit when the ray toward the sun passes through the
roof opening: `bowlD(p.xz + L.xz·t) < roofInnerD` at roof height (sun-size
penumbra, widening with distance). Used by stands, crowd, flags, glass and the
pitch. For players and the ball the same shape is cast into the shadow map by an
invisible flat annulus (`roofProxy`), so pitch, players and stands agree. The
shadow frustum (72 × 60 m) follows `sun.target` (game-driven) with texel snapping.

## 3. Crowd

17,085 seats generated from the same row/aisle/vomitory layout as the geometry.
One `InstancedBufferGeometry` draw: an upright card per spectator facing the
pitch, 2 triangles each.

- **Why impostors, not instanced 3-D figures:** at the broadcast camera a fan in
  the hero stand is about 8×10 px at 720p. Cards + a mip-mapped sprite are
  ≈ 34 k triangles instead of several hundred thousand and are *more* stable
  (the mip chain pre-filters what sub-pixel geometry would alias). Not measured
  against a 3-D variant on a GPU — this is a reasoned choice, not a benchmark.
- **Atlas** (canvas, 256×256): 4 poses (seated, standing/clapping, arms in a V,
  arms straight up) × 2 body variants; channels R = shirt mask, G = skin mask,
  B = shading, A = coverage. The shader composes shirt/skin/hair-trouser colours
  per instance. Alpha is derivative-sharpened and written for alpha-to-coverage.
- **Colour:** 60 % wear the section's team colour with brightness/saturation
  variation and the odd white shirt, the rest a muted random palette. Home/away
  is per seat: the +X end and the +X quarters of the side stands are away.
  `setCrowdColors(home, away)` writes two uniforms.
- **Motion (vertex shader only, zero per-instance CPU work):** idle sway;
  standing + bouncing as that team's `pulse.threat` rises (fast attack, slow
  release); on `goal` an eruption wave travels out from the scoring goal through
  that team's fans (arms-up poses, big hops) and decays over ~10 s; random camera
  flashes on floodlit presets.
- **LOD:** instances are shuffled once, so density is just `instanceCount`.

Not built: waving flags / scarves.

## 4. Pitch

One plane, one `MeshStandardMaterial` patched with `onBeforeCompile` (keeps
three's shadow maps, IBL and light rig). Everything deterministic is analytic in
the fragment shader, in world metres:

- **Markings** as a signed-distance field with derivative anti-aliasing and a
  ~1.25 px minimum width (dimmed when inflated): crisp at any resolution, no
  texture blur, stable at the grazing broadcast angle. Geometry from `CFG`:
  boundary (outer edge on ±halfL/±halfW), halfway line, centre circle (r 6.2),
  centre spot, penalty boxes, six-yard boxes, penalty spots at `CFG.pen.spotOut`,
  the D (r 6.2, outside the box only), corner arcs (r 1). Line width 0.13 m.
- **Mowing pattern:** 12 bands across X plus a fainter 8-band cross-cut. Contrast
  depends on the view direction (leaned blades), so the cross-cut appears from
  the goal-end cameras and the main bands from the side.
- **Wear** in both goal mouths and at the centre spot, broken up by noise.
- **Surround:** grass run-off (2.6 m), synthetic apron, perimeter track,
  dashed technical areas.
- **Stochastic detail** from two small tiling textures (blade grain / clumps /
  mottling, and a normal map of the grain) sampled at three scales with
  anisotropic filtering — textures rather than hash noise because mips pre-filter
  the grain at grazing angles.
- **Rain:** `uWet` darkens albedo, drops roughness to 0.2–0.5 with puddle
  variation and raises `envMapIntensity`, so the PMREM sky and floodlights
  reflect.
- Receives the key shadow map (+ the analytic roof shadow outside the frustum).

Not built: the Ultra near-camera instanced grass-blade layer. The gameplay
cameras are ≥ 34 m from the nearest turf, where blades are sub-pixel; the grain +
normal map carries the pitch-level replay shots (see screenshots). It would only
pay off for cameras under ~3 m.

## 5. Goals and nets

Frame: posts and crossbar are `CFG.postR` tubes centred on x = ±halfL,
z = ±goalHalf, bar at y = goalH (what you see is what the sim collides with);
box-net supports out to ±(halfL + goalDepth). One merged PBR mesh for both goals.

Net: position-based (Verlet) cloth, ≈ 1,500 particles and ≈ 5.6 k rope constraints
per goal (stretch-only, so it hangs and billows like cord). Four panels (back,
two sides, roof) share particles on their seams; all panel borders are pinned;
3 % slack. Rendered as an alpha-blended hexagonal mesh texture (mip-mapped, so it
becomes a veil at distance instead of shimmering).

- `net` bus event → impulse around the impact point along the ball velocity.
  Node measurement for a 24 u/s hit (earlier, weaker kick setting 0.5): peak
  bulge 0.72 m at 0.13 s, 0.42 m at 0.6 s, 0.24 m at 1 s. Shipping kick is 0.7
  (not re-measured; ≈ 0.9–1.0 m expected by scaling).
- `post` event → a small shiver. `netImpulse(side, y, z, strength)` for manual pokes.
- `pulse.ball*` is a sphere collider near the goal, so a ball resting against the
  net holds a pocket.
- The solver sleeps when at rest: no CPU and no buffer upload on ordinary frames.

Verified: the solver in Node; in the browser that a `net` event changes the
vertex buffer and (screenshot from behind the goal) the mesh visibly bulges. At
1–2 fps here the *motion* could not be judged — the feel needs a real GPU.

## 6. Lighting, sky, atmosphere

Rig: key `sun` (casts), three auxiliary directional lights, hemisphere. Presets
(`env.ts`) set all of it plus sky, fog (exp²), exposure, grade and bloom.

| Preset | Key | Notes |
|---|---|---|
| `afternoon` | sun 50° from behind the camera | Roof shadow across the near strip of the pitch; hero stand sunlit. |
| `golden` | sun 31°, low from −X | Most of the pitch in stand shadow, a warm sunlit quarter; floodlights at 55 %, raised fill so shaded players stay readable. |
| `night` (default) | four floodlight rigs (key + 3 aux) | Dark sky with stars, lamp banks + halos, camera flashes. Ultra adds a second shadow caster (crossed shadows). |
| `overcast` | soft high key | Full cloud deck, no roof shadow, flat ambient. |
| `rain` | floodlit, wet | Wet pitch, heavier fog, streaks (count per tier). |

Sky: inside-out dome — gradient, sun disc + scattering lobe, fbm clouds with
cheap self-shadowing, stars. The same shader (minus the disc) plus four emissive
floodlight panels is captured to a cube map (64/128/256 px by tier) and
PMREM-filtered into `scene.environment` on every preset/tier change, so IBL and
reflections match the visible sky. ACES tone mapping; exposure per preset.

Post (high/ultra): scene → half-float 4×MSAA target → UnrealBloom → one final
pass (ACES, saturation/contrast/tint, vignette, sRGB, 1-LSB dither). Lite and
standard render straight to the MSAA canvas.

**Robustness fix (black frame).** A single non-finite texel in the half-float
target turns the *whole* frame black once the bloom's mip-chain blur spreads it
(Inf·0 → NaN). Reproduced deliberately by placing a 4 cm emitter of `1/0` (and
`0/0`) in view: full black frame before, normal frame after. The bloom
bright-pass and the final pass now sanitise their input (NaN → 0, clamp).
Honest status: the reported repro cameras ((2.2,1.5,3.6)→(0,1,0) and the ball
close-up) rendered **correctly** in this sandbox both on this branch and on an
export of the integration branch at the reporting commit, and `__gfx.scanHdr()`
found no non-finite texel there (max HDR value ≈ 2.9). So the mechanism is proven
and guarded, but the texel that triggered it on the integrator's machine was not
identified. If it recurs, run `__gfx.scanHdr()` at that camera: it returns the
count and screen position of non-finite / extreme texels.

## 7. Quality tiers

| | lite | standard | high | ultra |
|---|---|---|---|---|
| Pixel-ratio cap / DRS floor | 1 / 0.75 | 1.5 / 0.85 | 2 / 1 | 2 / — (DRS off) |
| Shadows | off (game shows blob shadows) | 1024 PCF | 2048 PCF-soft | 4096 PCF-soft + 2nd caster on floodlit presets |
| Aux lights | 1 (energy folded into key/hemi) | 3 | 3 | 3 |
| Crowd density | 42 % | 72 % | 100 % | 100 % |
| Grass detail | 256² grain, no normal map | 512² grain | + normal map | + normal map |
| Post chain | — | — | bloom + grade + vignette, 4×MSAA HDR | same |
| Env cube | 64 | 128 | 256 | 256 |
| Anisotropy | 4 | 8 | 16 | 16 |
| Rain streaks | 1,400 | 3,500 | 7,000 | 12,000 |
| Sky cloud octaves | 2 | 3 | 4 | 5 |
| Goal replays | off | on | on | on |

`Settings.quality` is now the four tiers; stored `'high'`/`'lite'` remain valid,
anything else falls back to the device default (`standard` on coarse-pointer
devices, `lite` if they also report ≤ 2 GB, otherwise `high`).

Dynamic resolution: EMA of frame time; steps down 10 % above ≈ 19 ms, probes back
up 5 % after a quiet period that doubles each time a probe fails; ignores
hitches > 250 ms. Logic only — never exercised on a GPU.

Texture sizes follow the tier active at boot (LED atlas 2048×1024, or 1024×512
on lite); switching tier later does not rebuild them.

### Measured cost (environment only, players and ball hidden)

Broadcast camera (0, 17, 43) fov 30, `night` unless stated, 1280×720,
`renderer.info` summed over all passes of one frame:

| Tier | Draw calls | Triangles | Budget |
|---|---|---|---|
| lite | 14 | 38,422 | ≤ 60 / ≤ 150 k |
| standard | 16 | 49,570 | — |
| high | 29 | 59,152 | ≤ 150 / ≤ 1.2 M |
| ultra | 31 | 60,048 | — |
| lite, rain | 15 | 41,222 | |
| ultra, rain | 31 | 84,048 | |

High/ultra include ≈ 13 full-screen post draws. Static triangle breakdown:
structure 14,650 · seats 7,148 · crowd 34,170 (17,085 instances) · nets 2 × 2,880
· goal frames 896 · everything else < 500. Whole-scene memory at high:
28–38 geometries, 98 textures (this includes the player models' textures).
With this branch's player models visible the same frame is 162 calls / 540 k
triangles — the environment is a small fraction of it.

No per-frame allocations in `updateStadium`; per-frame CPU work is a few uniform
writes, plus the cloth only while a net is moving.

## 8. WebGPU vs WebGL2

Not migrated. In three r160 `WebGPURenderer` is an examples add-on with a
different material system (node materials): `ShaderMaterial`, `onBeforeCompile`,
`EffectComposer` and `PMREMGenerator` as used here do not carry over, so this
would be a rewrite of every shader in this document, not a switch. Browser
coverage at the time of writing still requires a WebGL2 path on a large share of
phones, so both back-ends would have to be maintained and tested. And nothing
here is limited by the API: the environment is ~30 draw calls and ~60 k
triangles; the cost is fill rate and the skinned players.

What would justify revisiting: a three release where the WebGPU renderer and TSL
are the documented default *with* an automatic WebGL2 fallback from one material
source; a feature that needs compute (GPU cloth for kits, large GPU particle
systems, GPU-driven crowd culling well beyond 20 k fans); or profiling on real
devices showing draw-call/CPU submission as the bottleneck.

## 9. Known limitations

- Real-GPU frame times, thermal behaviour and mobile driver quirks: unverified.
- The black-frame trigger on the integrator's machine was not identified (§6).
- Crowd figures are flat cards: fine from gameplay cameras, visibly 2-D in a
  close replay shot from the side; no flags/scarves/tifo.
- Stand lighting is a custom diffuse model: no specular on roof steel or glass,
  and the stands do not receive shadow-map shadows from players or goals.
- The roof top is a plain white skin and there is nothing outside the bowl
  (no skyline, flat ground) — a high exterior beauty shot looks empty.
- Golden hour: the roof-shadow edge on the pitch is hard and curved (it is the
  true projection of the rounded roof opening); no floodlight shafts / volumetrics.
- Rain: streaks only — no splashes, no spray from the ball, no wet-kit response.
- Net: no self-collision and no collision with players; the net does not cast a
  shadow. Resting shape after a hit is wherever it is when the solver sleeps (3 s).
- Scoreboard shows colours, short names and score only (no clock).
- Brand names are invented for this game; they were not checked against
  trademark registers.
- `pulse.threat`-driven excitement and the `post` shiver were exercised only by
  emitting events by hand in this branch.

## 10. Next steps

1. Profile on a real desktop GPU and two phones; set the DRS thresholds and the
   default tier from data.
2. Identify the black-frame texel on the machine that showed it (`scanHdr`).
3. Crowd: flags/scarves layer, a second atlas row of standing-idle variants,
   optional 3-D front rows for close replays.
4. Stadium exterior + skyline ring, roof-top detail, floodlight shafts at night.
5. Rain splashes on the pitch shader; net shadow; scoreboard clock.
6. Pick the preset per fixture (kick-off time / weather) from game code.
