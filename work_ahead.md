# work_ahead.md — STRIKERS '26 master build plan

> Single source of truth for finishing **Strikers '26** (working title) for a **CrazyGames** launch timed to the **2026 World Cup** (USA, kickoff ~June 11 2026). Built to be picked up by **any session, including a brand-new fresh chat**. The big checklist at the bottom is the durable to-do list — tick items as they ship.

---

## 0. How to use this file (every session, especially a fresh chat)

1. Read `memory/MEMORY.md` → `memory/project-goal-crazygames.md`, then this file top-to-bottom.
2. Pick the **highest-priority unchecked item** from the **Master Checklist** (§8). P0 before P1 before P2.
3. Implement it. **Validate** (typecheck + `vite build` + `npm run sim` for any gameplay/balance change).
4. **Commit on a branch → PR → merge to `main`** (the owner is happy with autonomous merge; see git history pattern).
5. **Tick the box** in §8 and add a one-line note if behaviour changed. Append new tasks you discover.
6. Keep changes balance-safe: re-run `npm run sim -- 16 180` and confirm mirror ≈ even, on-target ≤ shots, no NaN/hang.

**Definition of done for the whole game:** a player lands, understands it in 10s, plays a 2-min match, leaves the result screen with *unfinished momentum*, and has a concrete reason to return tomorrow (their nation's next World Cup matchday). All retention is **earned, honest, no real money, no deception** (see §3).

---

## 1. Vision & success criteria

**Pitch:** *Live the 2026 World Cup.* Pick your nation, play your matches in fast, juicy 5-a-side arcade football, and chase the trophy through a tournament that **mirrors the real event's format and calendar**. Every match feeds a deep, ethical progression loop so you come back the next matchday.

**Why it can win on CrazyGames:** (a) perfect timing + searchability ("world cup", "soccer 2026", "football"); (b) instant fun (already true after the physics/balance work); (c) a retention spine most CrazyGames sports games lack.

**Success = :**
- D1 retention driven by "your nation plays today" + daily orders + daily chest meter.
- Replay-after-match and replay-after-loss both high (result screen never a dead end).
- Clean CrazyGames SDK integration (loading, ads, events) so it can be featured + monetised.
- Feels premium: the RICOCHET design language (§6), big goal moments, commentary.

---

## 2. Current state (DONE — do not redo)

### 2a. Core gameplay & reskin (pre-retention baseline)
- **Core gameplay fixed & validated** (see git history on `main`):
  - Ball physics fix (rolling ball no longer scrubbed every frame) — passes/shots/penalties work.
  - Pass-request off-ball runs (Simple Soccer `RequestPass`).
  - Distance-weighted passing (`passWeight`).
  - Shot-on-target stat fix (`Ball.shot` flag) and away-team curl-direction fix (`* team.side`).
  - Kickoff red-card guard.
- **World Championship 2026 reskin** (PR #9): 16 national teams (host **USA** default, **Norway** included), flag kits, fictional squads, away-kit clash handling, branding/SEO, self-healing saved team key.
- **Headless balance harness**: `simtest/`, run `npm run sim -- <matches> <secsPerHalf>`. Real sim, no renderer. Use it to validate every gameplay/balance change. **Now driven by the shared `simulateMatch()` (A1).**
- Modes: **Friendly / Knockout / World Cup**. Settings persist in `localStorage` (`core/settings.ts`).

### 2b. Retention foundation + World Cup + daily loop (PRs #11–17)
Done end-to-end (headless-tested; UI items marked still want an in-browser pass):
- **A1 — shared sim:** `src/game/simulate.ts` `simulateMatch()`; harness drives it. *In-browser headless isolation is NOT done — `createGameState()` spawns scene meshes and `flow.fullTime()` fires UI; the World Cup engine therefore uses a statistical resolver, not `simulateMatch`, for AI-vs-AI fixtures (see A1 note below).*
- **B5 — storage:** `src/platform/storage.ts` — swappable KV backend (localStorage now, CrazyGames data module later via `setStorageBackend`), in-memory fallback.
- **C1 — player save:** `src/core/playerData.ts` — full §5 schema, versioned, `migratePlayerData` self-heals partial/corrupt/old saves. Loads on boot.
- **C2/C3 — progression:** `src/core/progression.ts` (XP curve + Rookie→Legend titles) + `src/game/rewards.ts` (`applyMatchRewards` pipeline: XP/coins/bonuses, stats). Hooked in `modes.presentResult`.
- **A2–A6 — World Cup:** `src/game/worldcup.ts` (engine: 16-team field → 4 groups of 4 → QF/SF/Final, strength-based resolver, standings, champion, resume) + live integration in `modes.ts` (the "World Cup" mode now drives it) + `src/ui/worldcup.ts` (menu banner + groups/bracket/your-road screens, `#tournament` overlay).
- **E1/E2/E3 — daily loop:** `src/game/quests.ts` (daily orders + chest) + reward-pipeline integration (first-win bonus) + `src/ui/daily.ts` (menu daily card). `src/core/dates.ts` for local-day/ISO-week keys.

### 2c. Result screen + profile + excitement + CrazyGames SDK (PRs #19–24, this build)
Built clean (tsc + vite + `npm run sim` all green); **UI/feel + SDK not yet browser-tested — see §debt:**
- **D1–D4 — Result Screen:** `src/ui/resultScreen.ts` (`showResultScreen` + `ResultScreenData`) replaces the old `showFullTime`. Rebuilt `#ft` in `index.html`: tone-coloured emotional headline + 1–3 stars + per-team stat grid (D1), animated progress stack — XP / daily chest / daily orders (D2), staggered reward-chip reveal + next-best-action (D3), NEXT/PLAY-AGAIN primary + always-available MENU exit (D4). Built by `modes.presentResult` (one-off) / `presentWorldCupResult` (cup). Respects reduced-motion.
- **C4 — profile card:** `src/ui/profile.ts` + `#profileCard` on the menu — kit flag avatar, editable name (persisted), tier badge + level, XP bar, 3 stat tiles (Titles/Win%/Goals). Refreshes on boot, team change, and post-match.
- **H1 — commentary:** `src/ui/commentary.ts` + `#commentary` caption — contextual goal calls + shootout drama; complements the scorer toast. Re-exported through `ui/hud` so `flow.ts` reaches it via an already-stubbed boundary.
- **H2 — bigger goal moments:** `flow.scoreGoal` classifies a *big* goal (knockout tie / last-gasp / lead-changer) → deeper slow-mo + longer net-flight + harder shake + double roar; `showScorerFlash` (`#scorerFlash`) flashes the scorer name. *(Best-moment-on-result capture still TODO — see §debt.)*
- **B1–B4 — CrazyGames SDK:** `src/platform/crazygames.ts` — defensive runtime seam over `window.CrazyGames.SDK` (NOT bundled). B1 init + loading handshake + env detection + data-module backend swap; B2 `gameplayStart/Stop` in `flow.ts`; B3 interstitial between World Cup matches + `happytime` on wins; B4 `rewarded()` engine-ready (UI surfaces TODO). All feature-detected → clean no-op in dev.

**Sim-bundle rule (important):** the retention/tournament/UI modules are kept OUT of the headless harness because `game/modes`, `core/settings`, `ui/hud`, `game/render`, `core/audio` etc. are **stubbed** in `simtest/vite.config.ts`. Anything reached only via `modes`/`main` stays out of the sim. **Do not add imports of these systems into the gameplay path (`flow`, `control`, `physics`, `movement`, `Team`, `Player`)** or they'll pollute the sim bundle.

### Key files to hook into
- `src/game/flow.ts` — `scoreGoal` (big-goal FX + commentary), `fullTime`, `halfTime`, `startMatch`, `kickOff`; SDK `gameplayStart/Stop` (B2). Calls `modes.presentResult` at full time.
- `src/game/modes.ts` — mode controller; **owns the reward-pipeline + World Cup call + Result-Screen build at `presentResult`/`presentWorldCupResult`** (stubbed in sim — safe place for retention logic). `onFullTimeButton` (PLAY AGAIN / NEXT, B3 interstitial) + `onResultMenu` (exit).
- `src/game/rewards.ts` — `applyMatchRewards()` reward pipeline (extend here for season/achievements/medals).
- `src/game/worldcup.ts` — tournament engine (extend for 32/48 field, or to swap in `simulateMatch`).
- `src/game/quests.ts` — daily orders/chest (extend for weekly orders E4).
- `src/core/playerData.ts` — the save schema/singleton (`getPlayerData()` + `savePlayerData()`); add fields here (additive, self-healed in `migrate`).
- `src/config/players.ts` — `TEAMS`, `SQUADS`, `DEFAULT_TEAM`, `teamMeta` source.
- **UI surfaces** (`index.html` + `src/style.css`): `src/ui/resultScreen.ts` (`#ft`, the Result Screen — D), `src/ui/profile.ts` (`#profileCard` — C4), `src/ui/commentary.ts` (`#commentary` — H1), `src/ui/hud.ts` (scoreboard, toasts, `showGoalFx`/`showScorerFlash`, half-time, shootout board; re-exports commentary), `src/ui/worldcup.ts` (`#tournament`), `src/ui/daily.ts` (daily card).
- `src/platform/crazygames.ts` — CrazyGames SDK seam (B1–B4); `src/platform/storage.ts` — KV backend (B5).
- `src/main.ts` — boot wiring (init order: `initCrazyGames` (async, non-blocking) → UI buttons → result screen → settings → playerData → worldcup UI → daily card → profile card).
- `src/game/state.ts` — `match`, `MatchStats`. `src/game/render.ts` — `addShake`, meshes/camera/trail. `src/config/constants.ts` — FX tunables (`goalSlowmo[Big]`, `celebrateBall[Big]`).

### Known follow-ups / debt
- **In-browser verification debt (TOP priority):** everything shipped after PR #18 — the **D** Result Screen, **C4** profile card, **H1** commentary, **H2** goal-moment punch, and the **B** CrazyGames SDK no-op path — builds clean (tsc + vite + `npm run sim` green) but has **never been click-tested in a browser**. The visual/feel layers and the SDK event firing specifically need eyes-on (`npm run dev`) + a **CrazyGames QA-tool pass (L1)**. The older WC banner/screens + daily card also still want this pass.
- **B4 rewarded UI:** the wrapper `rewarded(onComplete)` is engine-ready, but the opt-in UI surfaces (a rewarded button on the Result Screen / daily card — e.g. continue-after-loss, double XP, reroll order) are not wired. Do with the browser pass so the honest framing can be seen.
- **H2 best-moment capture:** Best-Moment-of-the-Match on the Result Screen is not done — needs the replay buffer (`game/replay.ts`) surfaced on `#ft` + a browser pass.
- **A1 isolation:** to use the real physics `simulateMatch` for AI-vs-AI World Cup fixtures in-browser, build an isolation layer (pause render loop, swap `performance.now`, snapshot/restore the `state.ts` live bindings, headless meshes, bypass `flow.fullTime`'s UI). Until then `worldcup.resolveFixture` (statistical) is the resolver — interface is ready for the swap.
- **Legacy cup state removed:** the old 4-round single-elim in `modes.ts` is gone (replaced by the engine).

---

## 3. Guardrails (read before building retention)

From `retention.md` — **use pressure to create excitement, never to deceive, shame, trap, or exploit.**
- **No real money, no real ads required for progress, no real tracking.** All rewards earned in-game.
- **No fake scarcity / fake social proof / fake countdowns / "never returns" / "only 3 left" / fake near-miss wheels / confirmshaming / fake-disabled buttons / obstructive quit.** (retention.md §24)
- **Honest AI framing:** simulated rivals/activity are labelled (e.g. "AI Rival", "Simulation Feed"). Keep the dp.html **"Simulated build · no real payments · no tracking"** ribbon spirit.
- **Don't gate core play** behind energy. Energy = *bonus* charge only (retention.md §19).
- **Forgiving streaks:** weekly-activity model ("play 3 days this week"), never "lose everything". Earned rewards are never removed.
- **Accessibility:** reduced-motion + reduced-effects setting; clear exit/pause; LITE graphics already exists.
- **Modal cadence:** no blocking modal during gameplay; ≤1 retention modal per session; result screen may nudge but must allow leaving.
- **Legal/IP:** country names are fine; **player names stay fictional** (no real likenesses). Brand as **"World Championship 2026"** (avoid official FIFA marks/emblems/the "FIFA" word). Use "world cup"/"soccer 2026" lowercase in meta/SEO copy only. Confirm wording before shipping store assets.

---

## 4. Workstreams

Priorities: **P0** = launch-critical / headline. **P1** = strong retention, ship soon after. **P2** = live-service depth.

### A. World Cup 2026 — a living tournament that mirrors the real event  ★ P0 headline
The feature the owner specifically wants. Make the in-game World Cup **mirror the real 2026 format and calendar** so daily return is tied to "your nation plays today".
- **Format:** real 2026 structure — 48 teams, 12 groups of 4 → Round of 32 → R16 → QF → SF → Final (dates ~Jun 11–Jul 19 2026, hosts USA/Canada/Mexico). For scope, a **curated field (start with our 16, expand toward 32/48)** using the real group draw if we ship the data; otherwise a seeded draw.
- **You play your nation; the sim plays the rest.** Reuse the harness sim to resolve all other fixtures each matchday (fast, headless) and produce **group standings + a live knockout bracket**.
- **Calendar tie-in (the daily hook):** map matchdays to **real dates**. On each real matchday the menu surfaces *"MATCHDAY 3 — USA vs Brazil — play now"*. Coming back on a new matchday = your next fixture. (Honest: it's a simulation of the schedule, not live real scores.)
- **Tournament screens:** group table, bracket tree, "road to the final", your fixtures, a results ticker for sim'd matches.
- **Persistence:** the active World Cup run is saved (resume mid-tournament across days/sessions).
- **Stretch:** "Re-live history" classic tournaments; Euro/Copa reskins post-WC for longevity.

### B. CrazyGames SDK & launch plumbing  ★ P0
Integrate the official SDK (`@crazygames/sdk` or the `<script>` include). Gate everything so it **no-ops in local dev** and activates on CrazyGames/QA.
- **Init + loading handshake:** `sdk.game.loadingStart()` / `loadingStop()` around boot/asset load; `sdk.game.sdkGameLoadingStart/Stop` as per current docs. Show a branded loader.
- **Gameplay events:** `sdk.game.gameplayStart()` when a match begins, `gameplayStop()` on pause/menu/full-time (drives ad timing & analytics).
- **Ads (default = light, owner approved):**
  - **Interstitial** (`requestAd('midgame')`) at natural breaks: between World Cup matches / after full-time → before next. Never mid-match.
  - **Rewarded** (`requestAd('rewarded')`) opt-in only: e.g. *"Continue your World Cup run after a defeat"*, *"Double match XP"*, *"Reroll a daily order"*, *"Instant replay angle"*.
  - **Auto-mute audio** during ads (`adStarted`/`adFinished` callbacks); pause sim; resume cleanly.
- **Data storage:** prefer CrazyGames data module / user account when available, fall back to `localStorage`. One save module abstracts both (see §5).
- **Other:** invite link / `sdk.game.inviteLink` for share; `happytime()` on big wins/goals; banner ads only if it fits; environment detection (`sdk.environment`).
- **Verify against current official docs each session** (APIs evolve); keep the integration behind a thin `src/platform/crazygames.ts` wrapper.

### C. Player profile, save & progression core  ★ P0
- **Persistent player save** (`src/core/playerData.ts`) — schema in §5. Versioned + migration-safe + self-healing (like settings.ts).
- **Account XP & Level** — every match grants XP (win > draw > loss but loss still pays). First-match-of-day bonus. Good-play bonus (goals, clean sheet, comeback). Curve per retention.md §3.1.
- **Titles** — Rookie → Pro → Star → Captain → Maestro → Icon → Legend (football-flavoured, replaces Recruit→Legend).
- **Profile card** (RICOCHET style §6): flag avatar, name (editable), title/tier badge, XP bar, 3 stat tiles (e.g. Titles won · Win % · Goals).

### D. The Result Screen — the retention engine  ★ P0
Rebuild `#ft` full-time card into the most important UI (retention.md §4). It must never be a dead end.
- **Emotional headline:** VICTORY / DEFEAT / DRAW / WORLD CHAMPIONS / LAST-GASP WINNER / KNOCKED OUT / SHOOTOUT HERO.
- **Star rating** (1–3) from performance (result + goals + clean sheet + difficulty).
- **Performance stats** (have most already): score, possession, shots/on-target, saves, pass %, MOTM, best moment.
- **Progress stack** — animated bars filling: Account XP, Season track, Daily order(s), Daily chest meter, an Achievement near completion.
- **Reward reveal** with timing: XP → currency → objective progress → chest/rare last.
- **Next best action** copy: *"One more match fills your daily chest"*, *"Win the QF to reach the semis"*, *"Capture 1 more clean sheet for the medal"*.
- **Button hierarchy:** **PLAY AGAIN / NEXT MATCH** primary; Upgrade/Collection/Menu secondary. Quitting always available.
- Reuse `playerRating`/MOTM already in `flow.ts`.

### E. Daily & weekly systems  ★ P0 (daily match, daily orders) / P1 (rest)
- **Daily Match** = your nation's next World Cup-calendar fixture (ties to workstream A). Strongest daily hook.
- **Daily Orders** (3, rerollable once): *Win a match · Score 3 goals · Keep a clean sheet · Win a shootout · Score a curler · 5 successful slide tackles · Win from behind.* Doable in 5–15 min, in any mode. Reward XP/coins/chest points.
- **Daily Chest meter** (0→100 over ~2–3 matches): +40 play, +30 win, +20 objective. Drives "one more match".
- **Weekly Orders** (bigger, aspirational) + **Weekly Activity meter** ("play 3 days this week → bonus") — forgiving, no punishment.
- **First-win-of-day bonus.**

### F. Season track + collection + chests + shop  ★ P1
- **Free Season Track** (~30 tiers, 2–6 wk season; first season = "World Cup 2026 Season"). Rewards: coins, shards, cosmetics, titles, banners, celebrations, ball/kit skins, goal-stingers. **Earned "Elite Track"** unlocked via weekly orders (no payment) with retroactive unlock.
- **Cosmetic collection album**: kit variants, **ball skins**, **goal celebrations**, **shot trails** (ball trail already exists — make it a cosmetic), **profile banners/avatars/flags**, **net colours**, **crowd tifo**, **commentary voice packs**, **sound stingers**. Rarity + source + progress + preview + equipped.
- **Shards** (duplicate-friendly) + **completion bonuses** (e.g. "all common kits → Collector badge").
- **Free chests** (daily/weekly/level-up/season/achievement) with **visible odds** + **pity** (epic ≤10, mythic ≤50). Satisfying open; clear duplicate→shard conversion. **No fake near-miss.**
- **Earned-currency shop** (coins/gems/shards; ≤3 currencies), 24–48h rotation, items return, wishlist, **no fake stock**.

### G. Achievements, medals, mastery, difficulty ladder  ★ P1
- **In-match medals** (instant dopamine): First Goal · Brace · Hat-trick · Clean Sheet · Screamer (long-range) · Curler · Last-Minute Winner · Comeback · Shootout Hero · No-Sweat (win without conceding) · Wonder Save. Sound + slide-in callout + XP + collection progress.
- **Achievements** (long-term): Win 100 · Win the World Cup with 3 nations · Score 500 · 50 clean sheets · Beat Legend · Complete a season · Unlock 50 cosmetics. Reward titles/banners/chests with **visible partial progress**.
- **Mastery** per **nation** (and maybe per playstyle): XP bar + small rewards + "next mastery reward".
- **Difficulty ladder** beyond Easy/Pro/Legend: add **Ultimate/World Class** tiers with XP multipliers + unique medals + leaderboard category.

### H. Excitement / feel layer  ★ P0-ish (cheap, high ROI)
- **On-screen commentary** shouts driven by events: *"WHAT A STRIKE!", "GOAL — USA LEAD!", "INTO THE SEMIS!", "SHOOTOUT DRAMA!", "WONDER SAVE!"* (text + existing toast/`flashToast`; later voice packs).
- **Bigger goal moments:** punchier slow-mo, net ripple, crowd roar swell on knockouts, scorer name flash, replay angle.
- **Match drama:** stoppage-time tension cue; "DECIDER" framing in knockouts; rising crowd as a goal nears (already partly there).
- **Best Moment of the Match** captured for the result screen (reuse replay buffer).

### I. UI/UX redesign to the RICOCHET design language  ★ P1
Adopt the dp.html visual system (§6) across menu, HUD, result, profile, shop, modals. Football-skin it (pitch greens + neon accent + flag colours). **Mobile-first** (CrazyGames skews mobile): big touch targets, safe-area, landscape lock already present.
- Menu: top bar (currencies + profile + settings/badges), hero title + profile card, big PLAY/NEXT MATCH, daily/featured cards, modes list with lock states, World Cup matchday banner.
- Toaster + medal-callout layers; badge system on icon buttons (claimable rewards).

### J. Onboarding, comeback/loss & clean exit  ★ P1
- **First 5 minutes** (retention.md §20): playing in <10s, first reward <30s, first level-up <2min, first chest <5min, a visible long-term goal before leaving. Short interactive tip overlay on first run.
- **Loss retention:** defeat shows XP + what improved + what's nearly complete + easier next step. Comeback medals dramatic. Optional adaptive difficulty / pity chest progress after repeated losses. **Never shame.**
- **Clean exit/pause:** show objective + progress + claimables; RESUME primary; "Progress saved. Come back anytime · daily chest 80%." Neutral copy only.

### K. Leaderboards, AI rivals, activity feed  ★ P2
- **Leaderboards** (CrazyGames leaderboard API if available, else local): weekly score / fastest World Cup win / longest win streak / survival-of-Legend. Reward participation tiers, not only top.
- **AI rivals** (honestly labelled) + **activity river** (simulated, labelled) for liveliness (dp.html pattern).
- **Faction/region goals** as fiction/lore if no real aggregate data.

### L. Mobile/perf/QA + CrazyGames submission  ★ P0 before launch
- Perf pass on low-end mobile (LITE path, draw calls, shadow/quality scaling, target 60fps / graceful 30).
- Input ergonomics on phones; test portrait→rotate prompt; iOS Safari audio unlock.
- CrazyGames QA checklist: no external links, correct aspect handling, fast load, SDK events firing, ads in QA tool, mute on blur.
- Submission assets: thumbnail/cover, screenshots, description (SEO), tags, branding pass (title/icon/manifest already updated).

---

## 5. Architecture & integration notes

**Player save schema** (`src/core/playerData.ts`; persisted via the save abstraction in §B):
```jsonc
{
  "v": 1,                       // schema version (migrate on load)
  "playerId": "local-or-cg-id",
  "name": "PLAYER", "flag": "USA",
  "level": 1, "xp": 0, "title": "Rookie",
  "coins": 0, "gems": 0, "shards": {},
  "stats": { "played":0,"wins":0,"draws":0,"losses":0,"goals":0,"conceded":0,"cleanSheets":0,"cupsWon":0 },
  "daily":  { "date":"YYYY-MM-DD","orders":[],"rerollUsed":false,"chestPoints":0,"firstWin":false },
  "weekly": { "weekId":"","orders":[],"activeDays":[] },
  "season": { "id":"wc2026","level":1,"xp":0,"eliteUnlocked":false,"claimed":[] },
  "collection": { "owned":[], "equipped":{ "kit":null,"ball":null,"celebration":null,"trail":null,"banner":null } },
  "achievements": {}, "medals": {}, "mastery": {},
  "worldcup": { "active":false, "field":[], "groups":[], "bracket":[], "matchday":0, "yourNation":"USA", "yourPath":[] },
  "settings": { "reducedMotion":false, "effects":"full" }
}
```

**Match reward pipeline** (call from `flow.ts` `fullTime()` / end-of-match, retention.md §25.2):
```
match ends → base rewards (result+perf) → first-win/daily/weekly modifiers →
update XP/level → season → daily/weekly orders → daily chest → achievements →
medals (already shown in-match) → mastery → collection/chest → build result-screen cards → next-best-action
```
Reward reveal order on screen: result → XP/level → quests → season → chest → collection → medals → next action.

**Modules to add:** `core/playerData.ts`, `platform/crazygames.ts`, `game/rewards.ts` (pipeline), `game/quests.ts` (daily/weekly), `game/season.ts`, `game/collection.ts`, `game/worldcup.ts` (tournament sim/bracket, reuses harness sim logic), `ui/resultScreen.ts`, `ui/profile.ts`, `ui/shop.ts`, `ui/toasts.ts` (extend existing). Keep gameplay (`control/physics/movement/ai`) untouched unless balance-validated.

**Reuse the harness sim** for World Cup AI-vs-AI fixture resolution: factor the headless match loop in `simtest/harness.ts` into a small importable `simulateMatch(homeKey, awayKey, diff)` so both the harness and the in-game tournament call it.

---

## 6. Design language tokens (from dp.html "RICOCHET")

- **Fonts:** display = Antonio (condensed), labels/mono = JetBrains Mono, body = Outfit. (Current game uses Teko/Rajdhani — either keep or adopt; be consistent.)
- **Theme:** deep near-black surfaces (`#0a0911`/`#0f0e17`/`#15131f`), hairline borders `rgba(255,255,255,.07)`. Football-skin: pitch-green tints + flag accents.
- **Accents:** lime `#c6ff00` (primary), magenta `#ff2d75`, amber `#ffb836`, ice `#7dd3fc`, violet `#b18cff`. Tier colours bronze→mythic.
- **Components:** profile card w/ XP bar + 3 stat tiles; currency pills (coin/amber, gem/ice) with "+"; daily/featured cards (type label + reward); mode buttons w/ lock; result card (pretitle + huge title + stars + stat grid + actions); medal callouts slide-in-right; toasts slide-down-top-center; icon buttons with badges.
- **Motion:** `--ease-out`/`--ease-back`; XP/score bump animations; star-pop; reduced-motion respects setting.
- **Ethical chrome:** keep a subtle "Simulated · no payments · no tracking" tag where systems imply economy.

---

## 7. Validation & workflow

- **Every gameplay/balance change:** `npx tsc --noEmit` → `npx vite build` → `npm run sim -- 16 180`; confirm mirror ≈ even, possession ~50/50, on-target ≤ shots, no NaN/hang/OOB.
- **Every commit:** branch → PR → squash/merge to `main` (owner merges autonomously). End commits with the Co-Authored-By trailer.
- **Keep `npm run sim` green** as the regression gate. Extend the harness with reward/quest unit checks where useful.
- **Update §8 and MEMORY.md** as things ship.

---

## 8. MASTER CHECKLIST  ✅ (tick across sessions — this is the durable to-do)

> **Progress snapshot (last updated this build):** the **headline + retention spine is feature-complete** — progression foundation (A1, B5, C1, C2, C3), the entire World Cup (A2–A6), the daily loop (E1–E3), the animated Result Screen (D1–D4), the profile card (C4), on-screen commentary (H1), bigger goal moments (H2, minus best-moment-on-result capture), and the CrazyGames SDK seam (B1, B2, B3; B4 engine-ready). ~155 headless test assertions; `npm run sim` green throughout (mirror ≈ even, on-target ≤ shots, no NaN/guard; SDK + commentary verified absent from the sim bundle). **Remaining P0 is now the launch-readiness tail:** L1–L3 (CrazyGames QA-tool pass, mobile perf/iOS audio, submission assets), B4's opt-in rewarded UI surfaces, and H2's best-moment capture. **Top priority is no longer feature work — it's an in-browser + CrazyGames-QA-tool verification pass:** everything since #18 (D, C4, H1, H2, B SDK) builds clean (tsc+vite green, sim green) but has not been click-tested in a browser; the visual/feel layers (Result Screen animation, commentary, goal-moment punch) and the SDK event firing specifically need eyes-on.

### P0 — launch-critical & headline
- [x] **A1** Refactor harness match loop into importable `simulateMatch(home, away, diff)` (shared by sim + in-game tournament). → `src/game/simulate.ts`; harness now drives it. Behaviour-preserving (sim numbers unchanged). NOTE for A2: in-browser use needs mesh/UI isolation (createGameState adds meshes to the live scene; `flow.fullTime` fires UI) — handle in `game/worldcup.ts`.
- [x] **A2** World Cup data model: field/groups/bracket/matchday in player save (`worldcup`), resume across sessions. → `src/game/worldcup.ts` engine: 16-team field, pot-based draw into 4 groups of 4, round-robin fixtures, knockout ties, champion/userOut; serialised into the `worldcup` save slot (`saveRun`/`loadRun`), resumes mid-tournament. 69-case headless lifecycle test.
- [x] **A3** Group stage: standings table + sim all other fixtures per matchday; advance per real 2026 format. → engine + live integration: playing your nation's fixture resolves the rest of the field and advances the matchday (group draws stand); standings-table screen shipped in A6. *(UI wants an in-browser pass.)*
- [x] **A4** Knockout bracket tree (R32→…→Final) screen + "road to the final". → engine + live integration: win to advance QF→SF→Final, level knockout ties go to the live shootout, champion crowned (bumps titles + `cupsWon`), knocked-out run plays on simulated; bracket-tree + your-road screens shipped in A6. *(UI wants an in-browser pass.)*
- [x] **A5** Real-calendar mapping: matchdays → real dates; menu surfaces "your nation plays today" (honest sim framing). → `CALENDAR` (6 matchdays → real 2026 dates) + menu banner (`ui/worldcup.ts` `refreshBanner`) showing "WORLD CUP 2026 · <round> · <date> — <nation> vs <opp> — play now", updates on team/mode change. Not hard-gated on the real date (don't gate core play) — date is flavour + the hook. *(UI wants an in-browser pass.)*
- [x] **A6** Tournament UI: your fixtures, results ticker, bracket, group table, persistent resume. → `ui/worldcup.ts` + `#tournament` overlay: GROUPS (4 standings tables, qualifiers + your nation highlighted), BRACKET (QF/SF/Final tree with scores/winners/pens + champion), YOUR ROAD (your fixtures with results + next marked). Opens from the menu banner; reads persisted run so it resumes. *(UI wants an in-browser pass.)*

> **World Cup scope note:** mirrors the real *structure* (group stage → knockout bracket) with the curated 16-team field — 4 groups of 4 → QF → SF → Final. The engine (`worldcup.ts`) is field/group-count-driven, so expanding toward 32/48 is a data change. AI-vs-AI fixtures use a calibrated strength-based statistical resolver (instant, football-realistic tables); swapping in the full physics `simulateMatch` (A1) awaits in-browser headless isolation (see A1 note). PR A = engine (logic, headless-tested). PR B = live integration + screens.
- [x] **B1** `platform/crazygames.ts` wrapper; SDK init + branded loading handshake; env detection; no-op in local dev. → `src/platform/crazygames.ts`: thin defensive seam over CrazyGames HTML5 SDK v3 (`window.CrazyGames.SDK`), read off `window` at runtime (NOT bundled). `initCrazyGames()` (fired from `main.ts`, non-blocking) detects the SDK, `await`s `init()`, reads `environment()` (treats `disabled` as inert), runs the loading handshake (`sdkGameLoadingStart/Stop`), and swaps the save backend to the data module (B5). Every call is feature-detected + try/caught via `available()`/`safe()`, so a missing/renamed method degrades to a no-op and never breaks a match. Verified API names against current docs (game/ad/data namespaces).
- [x] **B2** `gameplayStart/Stop` wired to match start/pause/full-time. → `flow.ts`: `gameplayStart()` on kick-off (`startMatch`), second-half start and resume; `gameplayStop()` at half-time, full-time, shootout finish, pause and return-to-menu. Idempotent (guarded by a `gameplayLive` flag in the wrapper) so doubled start/stop is safe. No-op in dev.
- [x] **B3** Interstitial ad between World Cup matches (never mid-match); auto-mute + pause sim during ads. → `modes.onFullTimeButton` runs `interstitial()` at the natural break before the *next* World Cup fixture only (never mid-match, never on a friendly/KO PLAY AGAIN). `requestAd` mutes audio + fires `gameplayStop` for the ad, then unmutes + `gameplayStart` and proceeds in the callback; in dev it resolves immediately so the next fixture starts with no ad. `happytime()` also fires on a win/championship result.
- [~] **B4** Rewarded ads (opt-in): continue-after-loss, double XP, reroll daily order. Honest UI. → wrapper API ready: `rewarded(onComplete)` returns `granted=true` only on a fully-watched ad (and `false`/no-op in dev so nothing is gated). The opt-in *UI surfaces* (a rewarded button on the Result Screen / daily card) still need wiring + an in-browser QA pass — left for the browser session so the honest framing can be seen. Engine seam is done.
- [x] **B5** Save abstraction: CrazyGames data module when present, `localStorage` fallback. → `src/platform/storage.ts` (KV backend, swappable via `setStorageBackend`, in-memory fallback for blocked storage/Node). CrazyGames data module slots in during B1.
- [x] **C1** `core/playerData.ts` with versioned schema (§5), migration + self-healing. → full §5 schema, `migratePlayerData` heals partial/corrupt/old saves (clamps, truncates name, heals unknown team keys), persists via B5. Loads on boot; fresh profile's nation aligns with chosen team. Verified with an 18-case headless self-test.
- [x] **C2** Account XP + level curve + first-match-of-day bonus + good-play bonus. → `core/progression.ts` (xpToNext curve per §3.1, `grantXp` roll-up) + `game/rewards.ts` pipeline (`applyMatchRewards`): base win>draw>loss, first-match-of-day bonus, +XP for goals/clean sheet/big-win margin, coins, lifetime-stats update. Hooked in `modes.presentResult` (stubbed out of the sim harness, so balance runs are unaffected). 27-case headless self-test.
- [x] **C3** Titles (Rookie→Legend, football-flavoured). → `TITLES` ladder Rookie→Pro→Star→Captain→Maestro→Icon→Legend by level; `titleForLevel`; applied on every XP grant; level-up/new-title surfaced on the Result Screen XP bar (a `LEVEL UP → <title>` badge).
- [x] **C4** Profile card UI (flag avatar, name, tier badge, XP bar, 3 stat tiles). → `src/ui/profile.ts` + `#profileCard` on the menu (between the hero sub and the options): kit-coloured flag avatar (nation short code, tinted border/fill), editable name (clamped to 16, persisted to the save on input/blur, normalises empty→PLAYER), tier badge + `LV n`, XP bar toward `xpToNext(level)`, and 3 career tiles (Titles · Win % · Goals). Refreshes on boot, on team change (new flag), and after every match (`modes.presentResult`).
- [x] **D1** Rebuild full-time `#ft` into the Result Screen: headline + stars + stat grid. → `src/ui/resultScreen.ts` (`showResultScreen`) replaces the old `showFullTime`; tone-coloured emotional headlines (VICTORY/DEFEAT/DRAW/SHOOTOUT HERO + the World Cup set: INTO THE SEMI-FINAL, THROUGH TO THE KNOCKOUTS, WORLD CHAMPIONS 🏆, KNOCKED OUT), 1–3 star rating from result+goals+clean-sheet+champion, and a per-team stat grid (Poss/Shots/On Target/Saves/Tackles) read from `match.stats`. `modes.presentResult` now builds structured `ResultScreenData`.
- [x] **D2** Animated progress stack (XP, season, daily order, daily chest, achievement). → animated bars: account XP (fills from pre-grant fill, or from empty on level-up with `LEVEL UP → <title>` badge), daily chest (animates from the real pre-match value via a new honest `chestBefore` field in `rewards.ts`, `CHEST!` badge + carry on fill), one bar per daily order. (Season/achievement bars are wired into the same `ResultBar` stack for when F/G land.)
- [x] **D3** Reward reveal sequencing + "next best action" copy. → staggered reveal: stars pop → reward chips (+XP, +coins, first-match/first-win bonuses) → bars fill → honest next-best-action line. Honours reduced-motion/reduced-effects (snaps to final state).
- [x] **D4** Button hierarchy: NEXT MATCH/PLAY AGAIN primary; Menu/Collection secondary; exit always available. → primary `NEXT: <opp> ▸` / `PLAY AGAIN ▸` + secondary `MENU` (shown when Next is primary, via `onResultMenu`), so leaving is always one tap away.
- [x] **E1** Daily Match hook (your nation's next WC fixture) on the menu. → delivered by the A5 World Cup menu banner ("WORLD CUP 2026 · <round> · <date> — <nation> vs <opp> — play now") in `ui/worldcup.ts`.
- [x] **E2** Daily Orders (3, rerollable once) + completion tracking from match events. → `game/quests.ts` (order catalogue, daily roll, reroll-once, match scoring) wired into the reward pipeline; menu daily card (`ui/daily.ts`) shows orders + reroll; completions surfaced on the result card. *(UI wants an in-browser pass.)*
- [x] **E3** Daily Chest meter (0→100) with per-action points. → +40 play / +30 win / +20 per order; fills in ~2–3 matches, awards coins + carries overflow; shown as a meter on the menu daily card and on the result card with "one more match fills your chest" copy. First-win-of-day bonus also added (part of **E4**). 23-case headless test.
- [x] **H1** On-screen commentary shouts on key events (goal/save/curler/winner/progress). → `src/ui/commentary.ts` + `#commentary` lower-third caption layer: contextual goal calls (EQUALISER / IN FRONT / TURNAROUND COMPLETE / RUNAWAY WIN / LAST-GASP WINNER from score + half + stoppage state) plus shootout drama (WONDER SAVE, SUDDEN-DEATH DRAMA, SHOOTOUT HEROES). Complements (doesn't duplicate) the scorer toast — together they read like a TV feed. Tone-coloured (goal/save/drama/info), respects reduced-motion, auto-hides ~2.6s, cleared on match start. **Sim-safe:** reached only via the already-stubbed `ui/hud`/`game/penalty` boundaries and explicitly stubbed in `simtest/vite.config.ts` (`ui/commentary` + the new hud exports) — verified absent from the built harness bundle; `npm run sim` green. *(Visual polish/feel wants an in-browser pass; H2 bigger-goal-moments is the remaining excitement item.)*
- [~] **H2** Bigger goal moments (slow-mo punch, scorer flash, crowd swell on knockouts, best-moment capture). → `flow.scoreGoal` now classifies a *big* goal (knockout/cup tie via `settleDraws`, last-gasp 2nd-half-stoppage winner, or a lead-changing strike) and punches the celebration: deeper slow-mo (`goalSlowmoBig` 0.2 vs 0.32) + longer cinematic net-flight (`celebrateBallBig`) + harder camera shake (1.9 vs 1.2) + a second crowd-roar swell. New `showScorerFlash` (`#scorerFlash`) flashes the scorer's name kit-tinted across the celebration, louder/longer for big goals. **Sim-safe:** FX route through the already-stubbed `ui/hud`/`render`/`audio`; `showScorerFlash` added to the hud sim-stub; verified no DOM id leaked into the harness bundle; `npm run sim` green. **Best-Moment-of-the-Match capture for the Result Screen is NOT done** — it needs the replay buffer surfaced on `#ft` + an in-browser pass; left as the H2 follow-up. Visual feel of the rest also wants a browser pass.
- [ ] **L1** CrazyGames QA pass: SDK events fire, ads in QA tool, mute on blur, no external links, fast load.
- [ ] **L2** Mobile perf + input ergonomics + iOS audio unlock; portrait rotate prompt verified.
- [ ] **L3** Submission assets: thumbnail, screenshots, SEO description, tags; final IP/branding review (§3).

### P1 — strong retention (ship soon after launch)
- [ ] **E4** Weekly Orders + Weekly Activity meter (forgiving, "play 3 days") + first-win-of-day bonus.
- [ ] **F1** Free Season Track (~30 tiers, "World Cup 2026 Season") + reward claim flow.
- [ ] **F2** Earned Elite Track (weekly-order unlock) + retroactive unlock.
- [ ] **F3** Cosmetic collection album (kits, ball skins, celebrations, trails, banners, nets, stingers) + equip.
- [ ] **F4** Shards + duplicate conversion + collection completion bonuses.
- [ ] **F5** Free chests with visible odds + pity (epic≤10/mythic≤50); honest open animation.
- [ ] **F6** Earned-currency shop, 24–48h rotation, wishlist, no fake stock.
- [ ] **G1** In-match medals (brace, hat-trick, clean sheet, screamer, curler, last-minute, comeback, shootout hero, wonder save).
- [ ] **G2** Achievements with visible partial progress + title/banner/chest rewards.
- [ ] **G3** Nation mastery levels + "next mastery reward".
- [ ] **G4** Difficulty ladder additions (Ultimate/World Class) + XP multipliers + medals.
- [ ] **I1** Adopt RICOCHET design language across menu/HUD/result/profile (football-skinned, mobile-first).
- [ ] **I2** Toast + medal-callout layers + claimable-reward badges on icon buttons.
- [ ] **J1** Onboarding first-5-min flow + first-run tip overlay.
- [ ] **J2** Loss/comeback retention (improvement summary, dramatic comeback medals, optional pity/adaptive aid).
- [ ] **J3** Clean exit/pause with progress + claimables + neutral copy.

### P2 — live-service depth
- [ ] **K1** Leaderboards (CrazyGames API or local), participation-tier rewards.
- [ ] **K2** AI rivals + simulated activity river (honestly labelled).
- [ ] **K3** Rotating weekly events/modifiers (Double XP, One-Life Cup, Shootout Rush, Tiny-Goal Mayhem).
- [ ] **K4** Faction/region community goals (fiction-framed).
- [ ] **A7** Post-WC longevity: Euro/Copa reskins, classic "re-live history" tournaments, monthly seasons, prestige.
- [ ] **G5** Hidden achievements (surprise rewards for unusual feats).

### Cross-cutting / always
- [ ] **X1** Accessibility: reduced-motion + reduced-effects settings honoured everywhere.
- [ ] **X2** Keep `npm run sim` green; mirror ≈ even; on-target ≤ shots; no NaN/hang after every change.
- [ ] **X3** Ethical guardrails (§3) respected in every retention surface; "simulated · no payments · no tracking" framing where economy is implied.
- [ ] **X4** Update `work_ahead.md` checklist + `memory/MEMORY.md` as items ship.

---

*When in doubt, optimise for "the player wants one more match" — never "the player can't leave." Build unfinished desire, honestly.*
