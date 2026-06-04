# Assets to provide — 3D model + animations

## Short answers to your questions

**1. Can we use only ONE football-player model? — Yes. This is the correct choice.**
One rigged model, recoloured per team, is exactly how real arcade football games
do it. You do NOT need a model per team. What makes recolouring work is the model
having **separate material slots** so the team colour only hits the kit:

- `kit_shirt`, `kit_shorts`, `kit_socks` — tinted by team colour at runtime
- `skin` — never tinted (the current build tints everything, so players look like
  solid plastic blobs; this is the #1 reason they look bad)
- `boots`, `hair` — their own fixed colours

With those slots, the code already in place tints **only** the kit. The goalkeeper
just gets a different kit colour through the same mechanism (already wired:
`#ffd23e` / `#19e0c0`). So: **1 model, 0 extra meshes, recolour for teams + GK.**

> If you want GK to also look different in shape (gloves, long sleeves, padded
> shirt) that's optional polish — a second model variant. Not required for launch.

**2. Yes — you need many more animations.** 7 clips is "tech demo" territory. The
list below is what takes it to "feels like a real game." They must all be on the
**same Mixamo skeleton** as the base model, exported **"In Place"** (no root
motion — the game drives position).

**3. The celebrate animation is wrong — confirmed.** It's a moving/travelling clip,
but the code strips root motion and pins the player in place, so the body slides.
Replace it with an **in-place** celebration (or several). Mixamo has many; pick
ones tagged in-place or enable the "In Place" checkbox on export.

---

## A. The 3D model (provide 1)

| Item | Requirement |
|---|---|
| **Football player** | Single rigged humanoid, **Mixamo / mixamorig skeleton** (so all clips share it) |
| Topology | Game-res: **≤ 6k triangles** ideal (≤ 10k acceptable). 22 on screen on mobile. |
| Material slots | **Separate, named**: `kit_shirt`, `kit_shorts`, `kit_socks`, `skin`, `boots`, `hair` |
| Textures | One small atlas (≤ 1024², WebP/PNG). Keep kit areas plain/neutral so tinting reads cleanly. |
| Rig | Standard Mixamo bones; **no fingers needed** at this camera distance (fewer bones = faster) |
| Format | FBX or GLB. We convert to **one Draco-compressed GLB** for shipping. |
| Height | Authored any height — code normalises to ~1.85 m. |

**Optional:** a goalkeeper variant (gloves / long sleeves). Nice-to-have, not required.

---

## B. Animations

All clips: **same skeleton**, **"In Place"**, facing **+Z**, loopable ones must
loop seamlessly. Mixamo download settings: 30 fps, "Without Skin" (skeleton only),
"In Place" ticked where available.

### B1 — Must-have (locomotion & core actions)
These are what the player sees every second of play.

| Clip | Type | Why / replaces |
|---|---|---|
| **idle** | loop | ✅ have — keep |
| **walk / jog** | loop | **NEW** — fills the idle→run gap (hard pop today at low speed) |
| **run** | loop | ✅ have |
| **sprint** | loop | ✅ have |
| **kick / pass** | one-shot | ✅ have (also reused for shots) |
| **slide tackle** | one-shot | **NEW** — currently fakes this with the kick clip; looks clearly wrong |
| **goal celebration (in place)** | one-shot/loop | **REPLACE** — current one slides; need an in-place celebration |

### B2 — Goalkeeper
| Clip | Type | Why |
|---|---|---|
| **GK dive left** | one-shot | ✅ have |
| **GK dive right** | one-shot | ✅ have |
| **GK idle / ready crouch** | loop | **NEW** — keeper currently uses the outfield idle; a set stance reads as a keeper |
| **GK catch / gather** | one-shot | **NEW** — for a held save (optional but high value) |

### B3 — High-value polish (makes it feel "real")
| Clip | Type | Why |
|---|---|---|
| **header** | one-shot | Aerial duels currently have no pose |
| **tackle (standing)** | one-shot | Non-slide ball-win |
| **turn / quick pivot** | one-shot | Smooths sharp direction changes |
| **tap-in / short pass** | one-shot | A gentler kick variant so every touch isn't a full swing |
| **throw-in** | one-shot | Restarts (if/when added) |
| **knocked down / foul reaction** | one-shot | Sells fouls in Sim rules |

### B4 — Celebrations (variety — pick 2–4, all IN PLACE)
The single static celebration gets repetitive fast. Good in-place options on Mixamo:
- Arms-raised cheer
- Knee slide → **NOTE: a knee slide DOES travel; only use if you want the goal cam
  to follow it, otherwise pick a standing celebration**
- Fist pump / chest thump
- Backflip or "the robot" for personality (CrazyGames audience likes character)

> Implementation note: celebrations can travel **if** we stop stripping root motion
> for that one clip and let the player actually move during the goal cutaway. Tell
> me which you want (in-place vs travelling) and I'll wire it accordingly.

---

## C. Priority if you want to stage it

1. **Walk/jog + real slide tackle + in-place celebration** → biggest feel jump, fixes the two visibly-broken things.
2. **GK idle + GK catch** → the keeper stops looking like an outfielder standing still.
3. **Header + standing tackle + turn** → fills the remaining gameplay poses.
4. **Extra celebrations + foul reaction** → personality / polish.

## D. What I do once you drop the files in
- Add each clip to `3dmodels/animations/`
- Register it in `playerLoader.ts` (clip table + `AnimName` union)
- Wire selection logic in `render.updatePlayerAnimation` (e.g. walk between idle/run, real slide clip, GK idle)
- Convert everything to one Draco GLB for shipping (see `docs/visual-upgrade-followups.md`)

## E. Where to get them (all same rig, free)
- **Mixamo** (mixamo.com) — upload your one model once, then download every
  animation above retargeted to it automatically. This guarantees the shared
  skeleton. Use the **"In Place"** checkbox on every locomotion/celebration clip.
