# Visual upgrade — code done + asset follow-ups

This tracks the player-model / animation / rendering polish pass. Everything in
**§1 is implemented in code** (shipped in this change). Everything in **§2 needs
offline binary tooling** (model/animation conversion) that can't run inside the
repo's TS build — each item has an exact, copy-pasteable command.

## 1. Done in code

| Area | Change | Files |
|---|---|---|
| IBL | `scene.environment` from a PMREM bake of `RoomEnvironment` — PBR materials now have something to reflect (kits/skin/ball no longer chalky) | `rendering/scene.ts` |
| Lighting | Warmer/neutral hemi+ambient (was cold blue), key intensity 1.35→1.55, exposure 1.05→1.18, lighter bg/fog | `rendering/scene.ts` |
| Shadows | Tighter sun frustum (±46×±34 → ±30×±22) ≈ doubles shadow texel density; `normalBias` added | `rendering/scene.ts` |
| Self-shadow | Players now `receiveShadow = true` (was off) — limbs/torso self-shadow instead of flat doll shading | `rendering/playerLoader.ts` |
| Foot skating | Locomotion `action.timeScale` scaled to actual ground speed / baseSpeed — kills the ice-skating | `game/render.ts` |
| Shirt-only tint | Materials tagged kit vs skin (`prepareMaterial` + `isSkinMaterial`); only kit gets the team colour (was tinting skin too) | `rendering/playerLoader.ts`, `rendering/meshes.ts` |
| Material sharing | One cloned material set per kit colour, shared across all players wearing it (fewer unique materials → fewer state changes) | `rendering/meshes.ts` |
| Mixer throttle | Distant, non-busy players update their skinned mixer at half rate (accumulated dt) | `game/render.ts` |
| Blob vs real | Fake blob shadow auto-hidden when shadow-mapping is on; it's the grounding fallback only in the `lite` tier | `rendering/meshes.ts`, `game/render.ts` |
| Ball | Cleaner 256² leather texture + bump map for seam relief, tuned roughness/envMapIntensity, denser sphere | `rendering/meshes.ts` |
| Scale | Model height 2.4 m → 1.85 m (`MODEL_HEIGHT`), so players don't dwarf the ball/goals | `rendering/playerLoader.ts` |
| Crossfade | Slightly longer blend into one-shots (sprint→kick was snapping) | `game/render.ts` |

> **Note on shirt-only tint:** `isSkinMaterial()` first checks material *names*
> (`skin`, `head`, `hand`, …) then falls back to a warm-colour sniff. If the
> current `football_player.fbx` exports a single merged material (common for raw
> Mixamo), the name check finds nothing and the whole body is treated as kit —
> i.e. you'll still get a mono-colour player. The real fix is a kitted model with
> named material slots (§2.3). Verify in-browser whether skin stays skin-coloured;
> if not, §2.3 is required, not optional.

## 2. Needs offline tooling (not runnable in the TS build)

### 2.1 Convert FBX → one Draco-compressed GLB  ⭐ biggest load-time win
Currently shipping ~5.6 MB across 8 FBX files, parsed on the main thread at boot.
One GLB with all clips embedded + Draco usually lands < 1 MB and parses faster,
and lets us drop `FBXLoader` from the bundle.

```bash
# one-time: merge the base mesh + all 7 animations into a single glb
npx @gltf-transform/cli merge \
  3dmodels/players/football_player.fbx \
  3dmodels/animations/*.fbx \
  -o 3dmodels/build/player_raw.glb
# compress geometry (Draco) + dedupe + prune
npx @gltf-transform/cli optimize 3dmodels/build/player_raw.glb \
  public/models/player.glb --compress draco --texture-compress webp
```
Then swap `playerLoader.ts` to `GLTFLoader` + `DRACOLoader` (one `import`,
clips come back on `gltf.animations`). Keep the same `clips` map / `MODEL_HEIGHT`
normalisation logic.

### 2.2 Decimate mesh + reduce bones  (per-frame GPU/CPU win)
Mixamo characters are ~10–15k tris with fully rigged fingers — overkill at this
camera distance with 22 on screen.
```bash
npx @gltf-transform/cli simplify public/models/player.glb public/models/player.glb \
  --ratio 0.5 --error 0.001
```
For bones, weld finger joints in Blender (or accept the simplify pass). Target
< 6k tris and < 35 bones per character.

### 2.3 Kitted model with separate material slots  (only true fix for mono-colour)
Source/author a model whose mesh has distinct material slots named e.g.
`kit_shirt`, `kit_shorts`, `kit_socks`, `skin`, `boots`. Then the in-code tint
(§1) tints **only** `kit_*` and everyone stops being a single plastic colour.
Mixamo's default merged material can't be separated at runtime.

### 2.4 Missing animation clips  (gameplay readability)
Download from Mixamo (same skeleton, "In Place" where offered) and add to
`3dmodels/animations/` + the `rawClips` table in `playerLoader.ts` + the
`AnimName` union + the selection logic in `render.updatePlayerAnimation`:
- **walk / jog** — fills the idle→run gap (hard pop today at low speed)
- **slide tackle** — currently reuses the kick clip (visibly wrong)
- **GK idle** (ready crouch) + **GK catch**
- nice-to-have: **turn**, **header**, **throw-in**

### 2.5 Kick-to-contact sync  (timing, needs care)
The kick one-shot fires on the `kickCooldown` rising edge but the ball impulse is
applied the same frame, so leg-swing and ball-launch don't line up. Options:
(a) trigger the kick anim a few frames *before* applying the impulse (anticipation),
or (b) delay the impulse to the clip's contact frame. Both touch
`game/control.ts` / `game/humanActions.ts` timing — do it deliberately and
re-test shot feel/balance, not blind.

## 3. QA checklist (ties into the existing browser-verification debt)
- [ ] Real mid-range Android, not just desktop
- [ ] `lite` tier: blob shadows show, real shadows off, pixel ratio 1 — players still grounded
- [ ] Skin stays skin-coloured on both teams + both GK kits (decides whether §2.3 is needed)
- [ ] No foot-skating across walk/run/sprint speed bands
- [ ] Load time on a throttled connection after §2.1
