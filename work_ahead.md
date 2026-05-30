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

- **Core gameplay fixed & validated** (see git history on `main`):
  - Ball physics fix (rolling ball no longer scrubbed every frame) — passes/shots/penalties work.
  - Pass-request off-ball runs (Simple Soccer `RequestPass`).
  - Distance-weighted passing (`passWeight`).
  - Shot-on-target stat fix (`Ball.shot` flag) and away-team curl-direction fix (`* team.side`).
  - Kickoff red-card guard.
- **World Championship 2026 reskin** (PR #9): 16 national teams (host **USA** default, **Norway** included), flag kits, fictional squads, away-kit clash handling, 4-round World Cup bracket, branding/SEO, self-healing saved team key.
- **Headless balance harness**: `simtest/`, run `npm run sim -- <matches> <secsPerHalf>`. Real sim, no renderer. Use it to validate every gameplay/balance change.
- Modes today: **Friendly / Knockout / World Cup** (4-round single-elim). Settings persist in `localStorage` (`core/settings.ts`).

**Key files to hook into:**
- `src/game/flow.ts` — `scoreGoal`, `fullTime`, `halfTime`, `startMatch`, `kickOff`, stats. **The result/full-time flow is where the retention pipeline plugs in.**
- `src/game/modes.ts` — mode/tournament controller, `configureTeams`, `presentResult`, cup bracket.
- `src/config/players.ts` — `TEAMS`, `SQUADS`, `DEFAULT_TEAM`, `teamMeta`.
- `src/core/settings.ts` — persistence pattern (extend into the player-save module).
- `src/ui/hud.ts` + `index.html` + `src/style.css` — UI surfaces (full-time card `#ft` is the result screen seed).
- `src/game/state.ts` — `match`, `MatchStats`.

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

### P0 — launch-critical & headline
- [x] **A1** Refactor harness match loop into importable `simulateMatch(home, away, diff)` (shared by sim + in-game tournament). → `src/game/simulate.ts`; harness now drives it. Behaviour-preserving (sim numbers unchanged). NOTE for A2: in-browser use needs mesh/UI isolation (createGameState adds meshes to the live scene; `flow.fullTime` fires UI) — handle in `game/worldcup.ts`.
- [ ] **A2** World Cup data model: field/groups/bracket/matchday in player save (`worldcup`), resume across sessions.
- [ ] **A3** Group stage: standings table + sim all other fixtures per matchday; advance per real 2026 format.
- [ ] **A4** Knockout bracket tree (R32→…→Final) screen + "road to the final".
- [ ] **A5** Real-calendar mapping: matchdays → real dates; menu surfaces "your nation plays today" (honest sim framing).
- [ ] **A6** Tournament UI: your fixtures, results ticker, bracket, group table, persistent resume.
- [ ] **B1** `platform/crazygames.ts` wrapper; SDK init + branded loading handshake; env detection; no-op in local dev.
- [ ] **B2** `gameplayStart/Stop` wired to match start/pause/full-time.
- [ ] **B3** Interstitial ad between World Cup matches (never mid-match); auto-mute + pause sim during ads.
- [ ] **B4** Rewarded ads (opt-in): continue-after-loss, double XP, reroll daily order. Honest UI.
- [x] **B5** Save abstraction: CrazyGames data module when present, `localStorage` fallback. → `src/platform/storage.ts` (KV backend, swappable via `setStorageBackend`, in-memory fallback for blocked storage/Node). CrazyGames data module slots in during B1.
- [x] **C1** `core/playerData.ts` with versioned schema (§5), migration + self-healing. → full §5 schema, `migratePlayerData` heals partial/corrupt/old saves (clamps, truncates name, heals unknown team keys), persists via B5. Loads on boot; fresh profile's nation aligns with chosen team. Verified with an 18-case headless self-test.
- [ ] **C2** Account XP + level curve + first-match-of-day bonus + good-play bonus.
- [ ] **C3** Titles (Rookie→Legend, football-flavoured).
- [ ] **C4** Profile card UI (flag avatar, name, tier badge, XP bar, 3 stat tiles).
- [ ] **D1** Rebuild full-time `#ft` into the Result Screen: headline + stars + stat grid.
- [ ] **D2** Animated progress stack (XP, season, daily order, daily chest, achievement).
- [ ] **D3** Reward reveal sequencing + "next best action" copy.
- [ ] **D4** Button hierarchy: NEXT MATCH/PLAY AGAIN primary; Menu/Collection secondary; exit always available.
- [ ] **E1** Daily Match hook (your nation's next WC fixture) on the menu.
- [ ] **E2** Daily Orders (3, rerollable once) + completion tracking from match events.
- [ ] **E3** Daily Chest meter (0→100) with per-action points.
- [ ] **H1** On-screen commentary shouts on key events (goal/save/curler/winner/progress).
- [ ] **H2** Bigger goal moments (slow-mo punch, scorer flash, crowd swell on knockouts, best-moment capture).
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
