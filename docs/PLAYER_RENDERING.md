# Player, kit and ball rendering

How the players and the ball are built and drawn. Code lives in `src/rendering/`
(`playerLoader`, `playerRig`, `kitMaterials`, `kitAtlas`, `playerLook`,
`playerIndicators`, `ballMesh`, `meshes`) and `src/config/kits.ts`.

## The model

`3dmodels/players/football_player.fbx` is the Mixamo character "Ch38", loaded with
`FBXLoader`. Model units are centimetres, bind pose is a T-pose, local +Z is forward.

| Mesh | Triangles | Notes |
| --- | ---: | --- |
| `Ch38_Shirt` | 4,154 | long-sleeved |
| `Ch38_Shorts` | 3,863 | |
| `Ch38_Socks` | 1,000 | |
| `Ch38_Shoes` | 2,088 | |
| `Ch38_Body` | 9,299 | head, neck, hands, knees only (no torso / arms / shins) |
| `Ch38_Hair` | 5,240 | alpha-blended strand cards |
| `Ch38_Eyelashes` | 960 | alpha cards |

- Geometry is non-indexed: 79,812 vertices for 26,604 triangles.
- Two `MeshPhongMaterial`s. Their textures **are embedded in the FBX** (a 512²
  base-colour atlas for body + kit, a 256² hair atlas + alpha) and load as blobs —
  nothing 404s. The old grey look came from the tint code: both materials were
  classed as "skin" by name (`Ch38_body`), so the white kit was never coloured.
- The embedded atlas has a baked crest, sleeve marks, shorts stripes and a "7" on
  the kit regions. We do not sample the atlas on any garment.
- Seven clips, 54 tracks each, hip translation stripped: idle 1.97 s, run 0.63 s,
  sprint 0.53 s, kick 0.5 s, gkDiveLeft 3.4 s, gkDiveRight 3.23 s, celebrate 7.67 s.

## The skeleton finding

The rig has 65 joints, but the loaded FBX contains **455 `Bone` objects and seven
`Skeleton`s**. `FBXLoader.buildSkeleton` creates one `Bone` per (skinned mesh ×
joint) and nests the copies as identity-transform children of each other
(`Hips > Hips > Hips > …`, seven deep). Animation was always correct — every copy
inherits the real joint's world matrix — but each player paid for 455 matrix
updates, seven skeleton updates and seven bone textures per frame.

All seven skeletons have the same joint order and identical inverse bind matrices
(max element difference 0), and every mesh's bind matrix is identity, so dedupe is
safe. `buildPlayerRigTemplate()`:

1. remaps each mesh's `skinIndex` onto one canonical joint order (by name);
2. merges Shirt, Shorts, Socks, Shoes and Body into one geometry with a per-vertex
   `aPart` id (shirt / shorts / socks / boots / skin / eyes — eyes are split off
   the body by UV island);
3. welds it with `mergeVertices` — it hashes every attribute including skin
   indices and weights, so only vertices that skin and shade identically merge:
   61,212 → 11,407 vertices, 20,404 triangles;
4. removes the 390 duplicate bones;
5. drops Hair and Eyelashes (6,200 triangles of alpha cards; the scalp is shaded
   instead).

`instantiatePlayerRig()` clones the 65-joint hierarchy and builds **one**
`Skeleton` per player that shares the template's inverse bind matrices. Geometry is
shared by every player. Bounds are a fixed generous sphere (skinned bounds are not
recomputed per frame). Checked by posing all seven clips mid-animation: every
garment follows the body with no tearing.

## Kit system

`src/config/kits.ts` is pure data + colour maths (no three.js, no DOM).

- `KITS[nation].home` is a `KitDesign`: pattern, second colour, trim, optional
  sleeve colour, shorts, socks, number colour. The shirt's **primary colour is not
  stored** — it is always the colour the game passes (`Team.color`), so HUD, radar
  and kit agree.
- Patterns: solid, stripes, pinstripes, hoops, sash, halves, band, yoke, checks,
  chevron. All 16 designs are invented; no crests, maker marks or sponsors.
- **Away strip**: `resolveOutfieldKit(teamKey, kitColor, homeColor)` returns the
  home design when `kitColor` matches the registered colour. Otherwise it builds
  an away strip around `kitColor`: the nation's home colour becomes the pattern /
  number colour, the pattern switches to the nation's low-coverage `awayPattern`,
  and any colour that would not read on the new shirt is replaced (OKLab distance
  test). `KITS[nation].away` can override individual fields.
- **Keeper strip**: `pickKeeperColors(kitA, kitB)` chooses from an 8-colour loud
  palette by greedy max-min OKLab distance to both outfield shirts (plus their
  pattern, sleeve and shorts colours at lower weight), the turf, and the other
  keeper. Looks arrive one player at a time, so `playerLook.ts` remembers each
  side's outfield kit and re-dresses both keepers whenever either side changes.
  Keepers get long sleeves and gloves.
- **Variety** from `PlayerLook.seed` (FNV-1a of team key + name + number): 8 skin
  tones, 8 hair colours (range narrowed for deeper skin tones), shaved or cropped
  hair, 10 boot colourways (skipping any that match the socks), ±3 % height and
  ±4 % width.

API: `applyPlayerLook(mesh, look)` in `meshes.ts`; `Player.applyIdentity()` calls
it. The legacy `userData.body.material.color.set(hex)` still works and means "set
the primary kit colour". Applying a look only rewrites uniforms.

## Material / shader

One `MeshStandardMaterial` per player, extended with `onBeforeCompile`; all
players share one program (`customProgramCacheKey`), one geometry and two textures.
The fragment shader switches on the part id:

- **Shirt** — pattern evaluated in bind-pose space (the un-skinned `position`), so
  it sticks to the cloth while skinned. Collar and cuffs in trim. Short sleeves:
  past the cuff the long sleeve is shaded as bare forearm. Placed motifs (sash,
  band, yoke, chevron) are front-only; repeating patterns leave a plain panel
  behind the number.
- **Number and name** — projected onto the back in bind-pose space from a shared
  1024×512 glyph atlas (digits 0–9 plus a name slot per player; R = fill,
  G = outline). A small number is also drawn on the shorts. Sampled with
  `textureGrad`, so there is no mip seam between digits.
- **Skin** — the embedded atlas divided by its mean skin colour gives a detail
  map (creases, lips, brows) that is multiplied onto the chosen tone. The atlas's
  near-black scalp paint is re-tinted to hair colour (cropped) or stubble
  (shaved). A small warm emissive stands in for sub-surface scatter.
- **Eyes** — atlas as authored.
- **Shorts / socks / boots** — colour plus side stripe, turnover band, sole.
- A faint albedo-coloured Fresnel rim lifts silhouettes off the turf.

Pattern edges are anti-aliased with screen-space derivatives and fade to their
mean colour when sub-pixel.

## Indicators

`playerIndicators.ts`. Shared geometry, textures and materials; no per-frame
allocation.

- `userData.ring` (controlled player): a segmented ground ring with a facing tick,
  dark keyline, and a child camera-facing chevron above the head drawn without
  depth test. The chevron never shrinks below 3 % of viewport height. Colour is
  gold, switching to white or cyan when the shirt is close to gold. Hiding `ring`
  hides the chevron.
- `userData.call` (pass request): a double ground ring and a double chevron
  overhead. The game still drives `.visible`, `.scale.setScalar()` and
  `.material.opacity`; the overhead marker copies the opacity.
- `userData.blob`: fallback blob shadow, unchanged contract.

## Ball

`ballMesh.ts`. A sphere with an analytic truncated-icosahedron shader: the panel
is the arg-max of `dot(p, n_k) / d_k` over the 32 face planes, and the gap to the
second-best value gives the seam line, its anti-aliasing, and the direction to
tilt the normal for pillowed panels. White hexagons, near-black pentagons, four
accent pentagons so the pattern is asymmetric and spin is visible. Radius is
`CFG.ballR`. `userData.shadow` is a soft blob.

## Measured cost

10 players in view, 1280×720, SwiftShader. Players only (scene with players hidden
subtracted). `renderer.info` resets after the shadow pass, so the totals below
were taken with `info.autoReset = false`.

| | Before | After |
| --- | ---: | ---: |
| Draw calls, shadows on | 140 | 20 |
| Draw calls, shadows off | 70 | 10 |
| Triangles, shadows on | 532,080 | 408,080 |
| Triangles, shadows off | 266,040 | 204,040 |
| Skinned meshes / skeletons | 70 / 70 | 10 / 10 |
| Bone objects | 4,550 | 650 |
| Textures in memory (whole scene) | 79 | 19–21 |

Frame rate was not measured (no GPU in the test environment).

## Asset provenance and licence

The character and the seven animation clips are Adobe Mixamo assets. Mixamo's
terms, as I understand them, allow royalty-free use inside a shipped game but do
not allow redistributing the raw asset files on their own. This repository
contains the raw `.fbx` files. **The repo owner must confirm that their Mixamo /
Adobe licence covers keeping those files in a public repository**, or move them
out of it. The embedded atlas also carries a baked crest, marks and a number of
unknown origin; we only sample its skin and eye regions.

## Known limitations

- Every player has the same face and head shape; only tone, hair colour and
  crop / shave differ. There is no hair geometry.
- Eye sockets read dark in close-up.
- Kit cloth has no normal or wrinkle detail.
- 20,404 triangles per player and no LOD; the shadow pass redraws all of them.
- Names are small — legible in close-up only. Numbers read at match distance.
- The pass-call ground ring is lime on green turf; the overhead marker carries it.
- The name atlas has 24 slots; more players than that would share slots.
- Needs WebGL2 (`textureGrad`).
- The test environment has no GPU, so nothing was checked on real hardware or a
  mobile device.

## Next steps

- Convert to GLB offline (meshopt or Draco): the merge, weld and bone dedupe done
  at load would be baked in, the 2 MB FBX and `FBXLoader` would go, and the baked
  kit marks could be removed from the atlas.
- A decimated LOD (roughly 5k triangles) for match distance and for the shadow pass.
- Hair meshes and two or three head variants.
- A front shirt number and a generic crest shape.
- A slide-tackle clip (the game currently reuses the kick).
