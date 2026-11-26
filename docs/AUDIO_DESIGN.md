# Strikers '26 — procedural stadium audio

Zero audio assets. Every sound is synthesised on the device with the Web Audio API.

> **Read this first.** No human has listened to this build. Everything below was
> designed by reasoning and verified by *measuring* offline renders (levels,
> spectra, envelopes, correlation, node counts). Measurements can prove that a
> sound has the intended physical shape; they cannot prove that it sounds good.
> Section 9 says which is which, and which sounds are the least certain.

## 1. Architecture

```
sim ──emit──► core/bus ──onAny──► core/audio.ts (façade) ──► engine.event(e, pulse)
game loop ──Audio.update(dt)───► engine.update(dt, pulse)

engine (src/audio/engine.ts)
 ├─ emotion.ts   PURE crowd-emotion model: pulse + events → state, CrowdMix, CrowdCues
 ├─ foley.ts     ball / body / woodwork / net / keeper / whistle voices
 ├─ crowd.ts     always-on layered bed, one-shots, chants, spontaneous "life"
 ├─ bake.ts      boot-time synthesis of crowd textures (OfflineAudioContext + JS)
 ├─ uiSounds.ts  menu sounds
 ├─ mixer.ts     buses, limiter, reverb, shared noise, voice pool
 └─ speech.ts    optional Web Speech commentary hook (off by default)
```

Signal flow:

```
voice ─(pan)─┬─► sfx bus   (0.55) ─┐
             ├─► crowd bus (0.80) ─┼─► master ─► DynamicsCompressor ─► WaveShaper ─► out
             └─► ui bus    (0.50) ─┘     ▲        (limiter: −10 dB,    (soft clip, hard
voice send ─► reverb in ─► stadium reverb ┘        12:1, 2 ms / 200 ms)  ceiling ±0.956)
crowd bus ─(0.16)─► reverb in
```

- `createEngine(ctx)` takes any `BaseAudioContext`. The live game passes an
  `AudioContext`; verification passes an `OfflineAudioContext`. Same code path.
- Nothing timing-critical uses `setTimeout`. Envelopes, multi-blast whistles,
  delayed crowd reactions and the three-stage goal roar are scheduled on
  `ctx.currentTime`. Voices are retired by comparing their scheduled end time
  with the context clock (`Mixer.sweep()`), so accounting is identical offline.
- All randomness comes from a seeded mulberry32 stream (`Math.random` only
  seeds it), never from the simulation RNG in `core/math`.
- **Reverb.** `full`: a generated 2.8 s stereo impulse response for an open
  bowl — 22 ms pre-delay, 35 ms diffuse build-up, three slap-backs per ear off
  the far stands (83–289 ms), two-slope decay (τ 0.16 s / 0.37 s ≈ 2.5 s T60),
  time-varying low-pass 9 kHz → 1.4 kHz; unit energy, `normalize = false`.
  `lite`: one filtered feedback delay (127 ms, 2.4 kHz, feedback 0.42).
- **Voice pool.** Cap 28 (`full`) / 14 (`lite`). When full, the lowest-priority
  then oldest voice not above the newcomer's priority is faded in ~20 ms and
  stolen; if every live voice outranks it, the newcomer is dropped. Priorities:
  0 dribble touch · 1–3 bounces, bumps, passes · 4–6 tackles, saves, shots,
  crowd reactions · 8 woodwork · 9 whistle and goal roar.
- **Shared buffers** (never one per sound): white 2 s mono, pink 5 s stereo
  (independent channels), brown 4 s mono, a 32 s "wander" LFO buffer at 8 kHz.
  Loop seams are equal-power cross-faded.
- **Placement.** `pan = clamp((x − pulse.ballX) / pulse.halfL, −1, 1) · 0.85`;
  attenuation `1 − 0.22·min(1, |z|/halfW) − 0.12·min(1, |dx|)`. Events with no
  position (goal, foul, whistle) are centred.

## 2. Public API (`import { Audio } from 'core/audio'`)

| Member | Behaviour |
| --- | --- |
| `resume()` | Create / resume the `AudioContext`. Call inside a user gesture. Idempotent. |
| `setMute(m)` | Fades the master, kills voices; the context is suspended ~0.6 s later and resumed on unmute. |
| `update(dt)` | Per rendered frame, real seconds: emotion model, bed mix, voice housekeeping. |
| `kick pass tackle save whistle goal post bounce header chip slide roar setCrowd` | **Silent no-ops** (kept so old call sites compile). |
| `ui(kind)` | `'click' \| 'confirm' \| 'back' \| 'reward' \| 'error'` — dry, on the ui bus. *New, not wired.* |
| `setVolume(bus, v)` / `getVolume(bus)` | `'master' \| 'sfx' \| 'crowd' \| 'ui' \| 'commentary'`, 0..1 (≤ 1.5). In memory only. *New, not wired.* |
| `setQuality('full' \| 'lite')` / `getQuality()` | `lite`: no convolver, single murmur layer, no shout / "oooh" / away-end bed layers, half the voice cap, smaller bakes. Switchable live. *New, not wired.* |
| `setCommentary(on)` / `say(text, opts?)` | Web Speech voice. Off by default, 2.5 s rate limit, never overlaps (`opts.urgent` cuts in), returns whether it spoke, no-op where unsupported. *New, not wired, not verified beyond "does nothing when off".* |
| `debug()` | `{ state, stats, emotion, speech }` for a dev overlay. |

Importing the module creates no audio objects. It subscribes to the bus
(`onAny`) and adds `visibilitychange` / `pointerdown` / `touchend` listeners
(suspend when the tab is hidden; re-wake an OS-interrupted context on the next
tap — it never *creates* a context there). Handlers never throw. With no
`AudioContext` at all, every call is a no-op.

The crowd-emotion model runs from the first frame even before audio is
unlocked or while muted, so the stadium is already "in the match" when sound
starts. While the context is not running, events are *not* queued.

## 3. Event map

| Event | Foley | Crowd |
| --- | --- | --- |
| `kick` | boot/head on ball by `kind` and `power`; `touch`/`knock` = quiet rate-limited tick | "olé" per pass only when cruising (≥ 5 home passes, ≥ 2 up, late); small cheer for a clearance under pressure |
| `shot` | — (the `kick` carries the strike) | breath held; rising "ooh" (home) or a small fearful gasp (away) |
| `bounce` | turf thump by `speed` | — |
| `post` | modal clang, bar vs post | gasp + groan (home shot) / gasp + sigh (away shot) |
| `net` | swish + cord ticks + stanchion thump | — |
| `goal` | — | team 0: three-stage roar scaled by context. team 1: gasp, groan, away-end cheer, stun |
| `save` | glove slap (parry) or muffled catch; dive adds a landing | away keeper: gasp, groan, sparse applause. Home keeper: cheer + applause |
| `nearmiss` | — | gasp → groan → smattering (home) / sigh + whistles (away) |
| `tackle` | shin-pad clack + thud; slide adds a turf scrape | cheer only for a home slide or under real threat |
| `block` | dull body thump | cheer / groan only if a shot was in the air or under threat |
| `collide` | body thud by `force` (> 2) | tiny gasp only above force 9 |
| `firstTouch` | clumsy knock only when `quality < 0.4` | — |
| `slide`, `dive` | turf scrape; air + landing | — |
| `foul` | — | away fouls: boos (+ cheer for the card). Home penalised: derisive whistles (+ boos for a card) |
| `offside` | — | sigh (home) / small ironic cheer (away) |
| `setpiece` | — | corner: anticipation floor for 4.5 s (+ cheer for a home corner) |
| `whistle` | pea whistle, seven distinct patterns | — |
| `turnover` | — | quiet sigh only when it kills a developing home attack |
| `toast` | ignored | ignored |

Designed for the real event density (≈ 200 kicks, 100 first touches, 75
turnovers, 50 collisions per 4-minute match): routine midfield play produces
**no** crowd one-shots (unit-tested), and every cue kind has a minimum gap
(gasp 0.8 s, groan 1.2 s, cheer 1.5 s, sigh 2.5 s, applause/boo 3 s, jeer 5 s).

## 4. Voice recipes

All scaled by event data; `p` is the normalised strength.

- **Kick** (`p = (power−4)/30`). (1) body: sine, 2.3·f0 → f0 in 16 ms → 0.72·f0,
  `f0 = (165 − 70p)·pitch` Hz, decay 65–165 ms; (2) ball "pock": triangle
  ≈ 430 − 90p Hz, 32 ms; (3) leather slap: white noise band-passed at
  1.5 + 2.6p kHz, 20–50 ms, level ∝ slap·(0.3 + 0.7p); (4) air: pink noise
  through a band-pass sweeping 420 → 1.5–2 kHz → 560 Hz over 0.7 s, only above
  ≈ 17 m/s. Per-kind weights (body / slap / pitch / air): pass 0.7/0.35/1.15/0,
  shot 1.15/1.0/0.9/1, volley 1.0/1.25/0.95/1, clear 1.2/0.8/0.85/0.7, finesse
  0.8/0.55/1.05/0.6, cross 0.95/0.6/1.0/0.4. Chip/lob: the thump *scoops up*
  (0.8·f0 → 1.5·f0) plus a rising grass-brush noise. Header: no pock, slap moved
  down to ≈ 0.5–0.8 kHz. Level `0.16 + 0.84·p^1.2`, ×1.1 for the human player.
  Reverb send 0.08 + 0.3p.
- **Touch / knock.** 35 ms thump ≈ 250 Hz + 16 ms noise tick; gain 0.035–0.085;
  at most one per 90 ms; priority 0.
- **Bounce.** Sine 150 − 35p Hz falling to 55 %, 55–85 ms, plus pink noise
  low-passed at 1.1–1.7 kHz (turf).
- **Woodwork.** Sum of decaying sines on an inharmonic free-bar series.
  Post: 327 Hz × [1, 2.76, 5.40, 8.93, 13.34, 18.64], T60 1.4 → 0.18 s.
  Bar: 208 Hz × [1, 2.71, 5.15, 8.3, 12.2, 16.9], T60 1.9 → 0.25 s. The three
  lowest modes are close *pairs* (0.4–1 % apart) so they beat. A harder hit
  excites the upper modes more (`bright = 0.4 + 0.6p`). Plus a ball thump and a
  14 ms click at 3.2 kHz. Reverb send 0.6, priority 8.
- **Net.** White noise through a band-pass that flicks 900 Hz → 4.2–5.8 kHz in
  55 ms then relaxes to 1.3 kHz; 3–5 dry "cord" ticks (band-pass 4.2 kHz) over
  the next 300 ms; a 95 → 58 Hz thump when `speed` is high.
- **Save.** Parry: two short noise bursts (2.3 kHz, 35 ms; 900 Hz, 50 ms) + a
  190 Hz knock. Catch: pink noise low-passed at 1.1 kHz, 70 ms + a 130 Hz
  "oomph". `diving` adds a landing (80 → 46 Hz + low noise) 280 ms later.
- **Tackle / slide.** Clack (1.7 kHz, 28 ms) + 150 Hz thud; a slide adds 360 ms
  of pink noise swept 1.1 kHz → 620 Hz whose amplitude is roughened by a
  41–55 Hz sawtooth (studs through turf).
- **Collide / block.** Low thud (98 → 54 Hz / 215 → 118 Hz) + low-passed noise.
- **Whistle.** Two sines a semitone apart (≈ 2075 and 2195 Hz) plus a faint
  octave; a 33–38 Hz triangle LFO does 40 % AM and ±24 Hz FM (the pea);
  band-passed breath noise at 3 kHz underneath. Each blast: 12 ms attack with
  overshoot, pitch scoops up 85 cents and sags 55 cents at the release, the
  trill slows by ≈ 5 Hz. One voice plays the whole pattern:
  kickoff 0.30 · restart 0.14 · foul 0.46 · offside 0.13+0.15 · goal 0.80 ·
  half 0.42+0.85 · full 0.40+0.40+1.25 s.
- **UI.** Sine/triangle notes, no reverb: click (1250 → 820 Hz, 45 ms),
  confirm (E5 → B5), back (C5 → G4), reward (C-major arpeggio with bell
  partials), error (two detuned low squares, low-passed).

## 5. The crowd

### Baked textures (boot time, off the main thread)

A mass of people needs dozens of formant-filtered voices; running them live is
too expensive, so they are rendered once through an `OfflineAudioContext` at
24 kHz and looped for the cost of one buffer source each.

| Texture | Content | Voices full / lite |
| --- | --- | --- |
| `murmur` 9 s | talking: sawtooth voices (95–260 Hz) stepping through random vowels syllable by syllable (two band-pass formants), phrases and pauses | 44 / 18 |
| `roar` 6 s | shouting: sustained open-vowel voices (170–400 Hz, F1 680–880, F2 1100–1500), pitch leaps then sags | 36 / 14 |
| `ooh` 5 s | closed-vowel sustained voices (115–285 Hz, F1 ≈ 400, F2 ≈ 800) | 28 / 12 |
| `applause` / `sparse` 4 s | plain JS: 160 (70) / 20 clappers, each with their own rate (2.6–5.2 Hz), hand resonance (1.1–3.2 kHz 2-pole) and position | — |

Each vocal texture also carries formant-shaped noise for the thousands too far
away to resolve (voices : noise RMS = 1 : 0.7 / 1.0 / 0.6), per-voice pitch
jitter, voices seated well off-centre, RMS-normalised, loop seam cross-faded.
Until a texture arrives its layer is absent and one-shots fall back to shaped
pink noise; if `OfflineAudioContext` is missing the crowd stays noise-only.

### Bed layers (persistent)

| Layer | Source → processing | Reference gain |
| --- | --- | --- |
| rumble | brown noise → low-pass 150 Hz → wander ±40 % | 0.07 |
| body | stereo pink → band-pass 620 Hz → low-pass (cutoff ×1.15) → L and R wander independently ±50 % | 0.17 |
| murmur | `murmur` at rates 0.94 and 1.09, each wandering ±45 % → low-pass (cutoff ×1.5) | 0.16 |
| shout | `roar` at 0.97, wander ±30 % | 0.32 |
| ooh | `ooh`, playback rate 0.90–1.18 with anticipation; **bypasses the bed level** | 0.24 |
| away end | `murmur` at 1.21 → high-pass 380 Hz → pan +0.75 | 0.40 |

On top, **spontaneous life**: every 0.5–4 s (faster when the house is awake,
never during a held breath) a small random one-shot somewhere in the bowl — a
pocket reacting, a ripple of claps, a lone whistle.

### One-shots

All are one enveloped pass over a texture with a pitch (playback-rate) glide
and a filter sweep. groan: `ooh`, rate 1.06 → 0.72, low-pass 2.4 kHz → 650 Hz.
ooh swell: `ooh`, rate 0.92 → 1.24, low-pass opening. boo: `ooh` at 0.66 → 0.56,
low-pass 900 Hz. cheer: `roar`, fast attack. sigh: quiet, falling `ooh`.
gasp: pink noise band swept 1.4 → 3.6 kHz, 60 ms in, 280 ms out. applause:
`sparse` below intensity 0.2, cross-fading to dense by 0.6. jeer: 3–9 sine
whistles gliding around 2.5–3.8 kHz, panned, very wet. away roar: `roar`,
band-passed, pan +0.75.

**Goal roar** (team 0), scheduled in one go: (1) *burst* — pink noise at
1.1 kHz + brown sub thump, peak inside 30 ms; (2) *roar* — two passes of the
`roar` texture, rate falling 14 %, low-pass 5.2 → 1.9 kHz, a +5 dB vowel peak
that opens to 1.3 kHz then closes ("yeaaah"); a second, bigger wave at ≈ 1.9 s
when delirious; (3) *ovation* — dense applause creeping in from 0.7 s and
outlasting the roar. Gain ∝ intensity^1.5; length 4.5 + 5·I s (+3 s delirious).
The bed stays lifted afterwards (arousal) and the model may start a chant.

### Chants

Four **original** contours (`bake.ts: CHANTS`) written for this game: `urge`
(clapped rhythm + three shouts), `terrace-a` (minor, rolling), `terrace-b`
(major, bouncy), `anthem` (slow long notes). Baked on first use: 22 (10)
sawtooth-through-formant singers, each with its own octave, tuning (±30
cents), lag, per-note jitter, scoop into every note and 8 % missed notes; unison
claps as grains. Played as a loop that builds over the first phrases; stopped
with a 0.3–2.5 s fade. They were composed ad hoc and were **not** checked
against any database of existing songs.

## 6. Crowd-emotion model (`src/audio/emotion.ts`, pure)

Home = team 0. No Web Audio, no clock, no randomness; deterministic.

| State | Range | Driven by | Time constants |
| --- | --- | --- | --- |
| `anticipation` | 0..1 | `smoothstep(0.2, 0.85, threat)` of the attacking side (away ×0.9); shots jump it to 0.55 + 0.45·q; corner / free-kick floors | attack 0.22 s, release 0.7 s |
| `side` | −1/0/1 | which team is creating danger; flips only when the other threat leads by 0.1 | hysteresis |
| `hold` (held breath) | 0..1 | `0.7·smoothstep(0.6, 0.92, anticipation)`, or 0.55 + 0.45·q while a shot is unresolved (0.5–1.4 s, then a sigh) | 0.12 s in, 0.3 s out |
| `tension` | 0..1 | closeness (level 1, one goal 0.85, two 0.25) × (0.12 + 0.88·late); shoot-out 0.95 | 3 s |
| `valence` | −1..1 | goal difference ×0.35 (weighted by match progress), ±0.2 momentum, event impulses | 5 s; impulses decay 14 s |
| `arousal` | 0..1 | base 0.34 (+0.1·valence⁺, −0.16·flat, +0.2·tension, +0.22·anticipation·(1 − hold)) + event impulses; menu 0.10, half-time 0.20, full time 0.42 / 0.28 / 0.14 | up 0.6 s, down 3.5 s; impulses 2.8 s |
| `stun` | 0..1 | set by an away goal (0.6 + 0.4·I for 6 + 8·I s) | holds half the spell, then fades |
| `flat` | 0..1 | well behind, little tension, late | 4 s |
| `mood` | flat / nervous / neutral / confident / delirious | Schmitt thresholds on the above + 2 s dwell; a big home goal flips it at once | — |

`late = smoothstep(0.62, 0.92, progress)`; the half length is learned from the
largest `timeLeft` seen. Goal intensity
`I = 0.3 + 0.4·imp + 0.2·late·imp (+0.08 big, +0.2 lastGasp)` with
`imp` = 1 for an equaliser or go-ahead goal, 0.7 at two up, 0.45 at three-plus,
0.75 pulling back to one behind, 0.4 otherwise.

Mapping to the bed (`mix()`):

```
level   = (0.5 + 1.1·arousal^1.3) · (1 − 0.6·hold) · (1 − 0.5·stun) · (menu ? 0.5 : 1)
murmur  = 1 − 0.7·s          shout = s · (0.55 + 0.45·clamp(valence + 0.4))      s = smoothstep(0.42, 0.9, arousal)
ooh     = anticipation^1.6 · (away attacking ? 0.35 : 1)     oohRate = 0.9 + 0.28·anticipation
cutoff  = 1300 + 4200·arousal^1.2 − 500·flat   (menu 520 Hz, half-time ≤ 1300 Hz)
away    = 0.1 + 0.3·max(0, −valence)           rumble = 0.3 + 0.7·arousal
```

So: a build-up lifts the house a little; when the chance is *clear* the
broadband bed drops below idle while the pitched "oooh" rises; then it explodes
(goal) or gasps and groans (save / post / miss). Conceding stuns the home end
for several seconds while the away end is heard.

Chants start after 5 s of calm play (anticipation < 0.3, no stun) in a willing
mood and stop on danger (anticipation > 0.55 or a held breath), a foul, a shot,
a goal, leaving play, or after 26 s; then a 10–18 s cool-down.

## 7. Measured mix levels

Offline renders, 48 kHz, full tier, dBFS RMS of the stereo mean after the limiter.

| Scene | Level |
| --- | --- |
| Menu ambience | −40.6 |
| Half-time hum | −32.6 |
| Match bed, idle 0–0 | −30.6 (250 ms windows range −32.4 … −28.2) |
| Bed-only at a clear chance (held breath) | −34.1 |
| Chant over the bed | −24.2 |
| Near miss: gasp / groan | −26.1 / −22.9 |
| Boo | −22.1 |
| Goal roar: routine 4–0 / opener / last-gasp equaliser (4–6 s window) | −18.6 / −16.3 / −15.0 |
| Away goal (same window) | −21.3 |

Peaks: pass (12 m/s) 0.17, shot (30 m/s) 0.68, dribble touch
0.038, whistle 0.09–0.20 by pattern. The compressor adds ≈ 5 dB of automatic make-up
gain to everything below its threshold; the levels above include it.

## 8. Budgets and measured counts

| | full | lite |
| --- | --- | --- |
| Persistent nodes (graph + bed) | 50 | 30 |
| Voice cap | 28 | 14 |
| 60 s scripted match (2285 events): peak voices / peak live nodes | 15 / 177 | 14 / 153 |
| Same match: voices started / stolen / dropped | 503 / 0 / 0 | 504 / 1 / 0 |
| Worst case measured (350 max-power events in 1.2 s) | 28 voices, 575 nodes, 130 stolen, 215 dropped | — |
| Bake time on the test machine (4 cores, headless Chromium) | ≈ 1.9–2.2 s | ≈ 1.1–1.3 s |
| Buffer memory (float32) | ≈ 5.4 MB baked textures + 0.8–2.4 MB per chant used + ≈ 5 MB shared noise / impulse response | same lengths (no impulse response) |
| Offline render speed, 60 s match | ≈ 10× real time | — |

A typical kick is 13–16 nodes, the woodwork 26, a whistle 17, the goal roar
three voices ≈ 20 nodes. Bake time and render speed are for this machine only;
no phone was measured.

## 9. Verification

### Measured (Chromium, `OfflineAudioContext`, 90 numeric assertions, all passing)

Each scenario creates an engine on an offline context, drives it with events
and `update(dt)` at 30 Hz (via `suspend`/`resume` on the offline clock) and
analyses the rendered buffer: peak, windowed RMS, Welch spectra, band
energies, spectral centroid and flatness, envelope-modulation spectrum, L/R
correlation, NaN scan.

| Claim | Evidence |
| --- | --- |
| Never clips | max sample over every ordinary scenario 0.90; the stress test sits exactly on the soft-clip ceiling, 0.956; 60 s match peak 0.88 with pre-limiter peak 1.31; a stress input peaking at 8.3 before the limiter still leaves at ≤ 0.956 (audibly distorted, but bounded) |
| No NaN | none in any render; non-finite event fields are rejected by `AudioParam` and caught |
| Shot ≫ pass | 30 m/s shot vs 12 m/s pass: +15.0 dB RMS, +22.7 dB at 20–160 Hz, +35.7 dB at 1.5–8 kHz, thump 94 Hz vs 164 Hz, air tail 23 dB above the pass 0.35–0.7 s after the strike |
| Touches are quiet and limited | peak 0.038; 20 touches in 0.4 s → 5 voices |
| Woodwork is a modal clang | post partials 328 / 902 / 1764 / 2912 / 4354 Hz (ratios 1 : 2.75 : 5.38 : 8.88 : 13.27, none near an integer); bar 205 / 563 / 1072 / 1723 / 2531 Hz; dry ring to −40 dB 0.78 s (post) and 1.16 s (bar), 3.0 s with the stadium reverb; a 25 m/s hit is 8 dB louder and brighter (centroid 557 vs 492 Hz) than an 8 m/s one |
| Net | 0.3–9 kHz centroid 2.0 → 5.8 kHz in 75 ms, back to ≈ 3 kHz by 375 ms; louder with speed |
| Parry sharper than catch | centroid 629 Hz vs 130 Hz |
| Whistle | 98.5 % of energy in 1.9–2.6 kHz; tones at 2098 and 2221 Hz; AM peak 37–39 Hz, depth ≈ 0.68; blast patterns 0.29 · 0.13 · 0.45 · 0.12/0.14 · 0.79 · 0.41/0.85 · 0.39/0.39/1.24 s — all seven distinct |
| Panning | ±28 m from the ball → ±15.7 dB L/R; far touchline −2.1 dB |
| Bed is not static | 70 % of energy in 300–2500 Hz, 0.2 % above 5 kHz (white: 75 %); spectral flatness 0.45 vs 0.997 for white; 250 ms RMS wanders over 4.2 dB (σ 0.82 dB); L/R correlation 0.22 |
| Menu is distant | 10 dB below the match bed, centroid 459 Hz vs 780 Hz |
| Held breath | threat 0.5 → bed +1.9 dB; threat 0.95 → broadband bed −3.3 dB below idle while the full mix (with the "oooh") is +2.1 dB; bed back within 1 dB afterwards |
| Goal roar ≫ bed | opener: +15.2 dB at peak (−15.9 vs −31.1 dBFS), above bed + 6 dB for 7.5 s, 6 dB up within 10 ms; centroid 1310 Hz vs 777 Hz; vowel peaks at 750 and 1219 Hz |
| Context | last-gasp equaliser: 12.25 s above bed + 6 dB, 1.3 dB louder; 4–0 goal: 2.3 dB quieter and 1.25 s shorter than an opener (the limiter compresses the top of this range) |
| Stages | solo roar: burst −15.5 dB (first 150 ms), body −17.6 dB (1–3 s), −22.5 dB at 6 s, gone by 11 s; A/B without applause (1–6 kHz): −0.3 dB at the peak, +2.1 dB at 7–9 s, +6 dB at 10–12 s |
| Away goal differs | above bed + 6 dB for only 1.5 s; cheer is 6.8 dB right-biased (solo: 11.2 dB); home side 3 dB *below* its pre-goal level 4–8 s later |
| One-shots have their shape | groan centroid falls 19 %; "ooh" rises 12 %; gasp centroid 2.5 kHz, gone in 0.34 s; boo centroid 374 Hz vs cheer 1215 Hz; applause centroid 1.9 kHz, smattering 2.2× grainier; crowd whistles 100 % in 2–4.5 kHz |
| Full time | win: +10.8 dB over the pre-whistle bed for 5 s; 0–1 loss: home side 1.9 dB below |
| Chants | starts in calm 2–0 play, +7.2 dB over the bed, tonal peaks at note pitches (100–500 Hz flatness 0.65 vs 0.93), stops 0.9 s after a threat starts to build; all four templates bake finite and non-silent |
| Budgets | see section 8; pool drains at the end; mute → −240 dB including new events; live quality switch without a gap |

Live page (real `AudioContext`, headless Chromium): events fired before
`resume()` create no context and no errors; `resume()` twice → `running`; the
legacy methods start zero voices; every event type, including malformed ones,
runs with zero console errors; mute suspends the context and unmute resumes it;
with `AudioContext` and `OfflineAudioContext` removed, every call is a silent
no-op.

The pure emotion model has its own section (`crowd emotion`) in `simtest/units.ts`
(attack/release, held breath, goal context, stun, flatness, hysteresis, chant
start/stop, event density, state changes, determinism, fuzz bounds).

### Not verified

- **How any of it sounds.** No human has listened. Least certain, most to least:
  1. *Crowd voices* — the textures are sawtooth-through-two-formants voices plus
     noise. Spectrally they are speech-shaped and decorrelated, but they may
     read as "synthetic choir / buzzy" rather than "people", especially the
     chants and the sustained goal roar. This is the biggest risk.
  2. *Chants* — pitch, rhythm and looseness are plausible on paper; musical
     quality and whether they are charming or annoying is unknown. The melodies
     were not checked for accidental resemblance to existing songs.
  3. *Boo / groan / "ooh"* — all derived from one texture by pitch shifting,
     which also shifts formants. Measured differences are modest (12–19 %).
  4. *Applause* — clap-like on paper; may sound like filtered noise when dense.
  5. *Loop periodicity* — the 5–9 s loops are masked by two-rate layering and
     slow modulation, but a repeating voice may still be audible.
  6. *Mix balance* — levels follow a reasoned hierarchy, not ears. The limiter
     works hard during a goal roar (pre-limiter peaks ≈ 1.5), so kicks and
     whistles are ducked then; it may pump.
  7. *Foley* — most confident group, but still unheard: kicks could read as a
     drum, the woodwork as a bell.
- **Phones.** Nothing was run on iOS or Android. CPU, bake time, memory,
  the `resume()`-in-gesture unlock and the iOS mute switch are untested.
- **Autoplay-blocked state.** Headless Chromium would not keep the context
  suspended, so "events while suspended are dropped, then sound starts on the
  first gesture" is covered by code inspection only.
- **Safari / Firefox.** Only Chromium was measured. The compressor's make-up
  gain is the same WebKit-derived algorithm elsewhere, but that is assumed.
- **Speech hook.** Only that it is off by default and returns `false`.

## 10. Known limitations

- Until the simulation emits bus events and writes `pulse`, a match on this
  branch alone is silent apart from the menu ambience (legacy calls are no-ops).
- `post` has no team; the shooter is inferred from the last `shot` (≤ 4 s) or
  kick. `goal` during a shoot-out is treated with fixed importance.
- Volumes and quality are not persisted (no settings ownership here).
- A chant decided while muted or before unlock is not played late; the next
  one plays normally.
- Crowd one-shots and foley share one voice pool; in the stress case 215
  low-priority voices were dropped by design.
- Reverb tails are cut when a voice is stolen (20 ms fade).

## 11. Next steps

1. Listen, on speakers and on a phone, and retune the mix (section 7).
2. If the crowd sounds synthetic: richer glottal source than a sawtooth, a
   third formant, consonant noise bursts, more voices per bake.
3. Wire `setVolume`, `setQuality` (tie to the existing graphics tier),
   `ui()` and optionally `setCommentary` / `say` into settings and menus.
4. Profile on a mid-range Android phone; pick `lite` automatically if needed.
5. Use `pulse.possession` and ball height for more texture (e.g. the goal-kick
   taunt, a rising hum under a long aerial ball).
6. Keep the offline measurement harness as a repo tool so levels can be
   regression-tested after sim changes.
