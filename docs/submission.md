# CrazyGames submission prep (L1–L3)

Living checklist for shipping **Strikers '26** to CrazyGames, timed to the 2026
World Cup. Code-side items are done where noted; the rest need a browser, real
devices, or art tools (can't be produced/verified headlessly).

## Store metadata (L3 — drafted)

- **Title:** Strikers '26 — World Soccer Championship
- **Short description:** Pick your nation and chase the 2026 World Championship —
  fast 5-a-side arcade football with curling shots, diving keepers, give-and-go
  runs and penalty shootouts. Free to play, mobile + desktop.
- **Tags / keywords:** world cup, soccer 2026, football, arcade soccer, penalty
  shootout, world championship, 5-a-side, sports, multiplayer-feel, mobile.
  (Also set in `index.html` meta: description, keywords, og:*, twitter:card.)
- **Category:** Sports / Football.
- **IP/branding (retention.md §3):** country names only; **player names are
  fictional**; brand as "World Championship 2026" — avoid official FIFA marks and
  the word "FIFA". Lowercase "world cup"/"soccer 2026" in SEO copy only. ✅ in copy.

## Assets still to produce (need art tooling / a browser)

- [ ] Thumbnail / cover (CrazyGames sizes).
- [ ] Screenshots (capture from a real browser run — menu, a match, the result
      screen, the season track, a chest open).
- [ ] Optional gameplay trailer.

## CrazyGames QA pass (L1 — needs the QA tool in a browser)

The SDK seam (`src/platform/crazygames.ts`) is wired and no-ops in dev. Verify on
the QA tool:
- [ ] `loadingStart/Stop` handshake fires; branded loader shows.
- [ ] `gameplayStart/Stop` fire on kick-off / pause / full-time.
- [ ] Interstitial (between World Cup matches) shows and mutes audio; resumes clean.
- [ ] Rewarded ads grant only on full watch: result-screen **Double XP**, daily/
      weekly **extra reroll** (`rewarded()` → `granted`).
- [ ] Data module save/load round-trips (backend swap in `initCrazyGames`).
- [ ] Mute on blur; no external links; fast load; correct aspect handling.

## Mobile / perf / input (L2)

- [x] iOS/mobile **audio unlock** on first gesture (`main.ts`), respects the
      sound setting.
- [x] Portrait **rotate prompt** (`#rotate`) and landscape-first layout present.
- [x] **LITE graphics** tier (replays off, lower pixel ratio, shadows off).
- [ ] Low-end device FPS pass (draw calls, shadow/quality scaling) — needs devices.
- [ ] Touch ergonomics pass on a range of phones — needs devices.

## Accessibility (X1) — done in code

- Reduced-motion / reduced-effects honoured (result screen snaps to final state;
  CSS animations gated by `prefers-reduced-motion`). Clear pause/exit with saved-
  progress copy.

## Honest-economy review (X3) — done in code

- No real money, no tracking, no fake stock / countdowns / near-miss. Chest odds
  + pity are published; the shop states "items return"; simulated leaderboard /
  feed / region goal are labelled "simulated / not real players"; the build shows
  a "Simulated · no payments · no tracking" ribbon on first run.
