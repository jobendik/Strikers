import './style.css';
import { handleResize } from './rendering/scene';
import { buildStadium } from './rendering/stadium';
import { createGameState } from './game/state';
import { initInput } from './game/input';
import { startLoop } from './game/loop';
import { startSecondHalf } from './game/flow';
import { onFullTimeButton, onResultMenu, startGame } from './game/modes';
import { initUI, refreshTeamTags, updateHUD } from './ui/hud';
import { initResultScreen } from './ui/resultScreen';
import { initRadar } from './ui/radar';
import { initSettings, getSettings, applySettings } from './core/settings';
import { getPlayerData, savePlayerData } from './core/playerData';
import { initWorldCupUI, refreshWorldCupUI } from './ui/worldcup';
import { initDailyCard } from './ui/daily';
import { initWeeklyCard } from './ui/weekly';
import { initProfileCard, refreshProfileCard } from './ui/profile';
import { initCrazyGames, loadingStop } from './platform/crazygames';
import { loadPlayerModels } from './rendering/playerLoader';

/* ============================================================================
   YUKA STRIKERS — AI Soccer
   Rendering: three.js  ·  Agents: yuka.js (Vehicle steering, StateMachine,
   MemorySystem perception, FuzzyModule decisions, Regulator throttling).
   Architecture inspired by Buckland "Programming Game AI by Example" ch.4
   (Simple Soccer) and the Yuka "kickoff" demo.
   ========================================================================== */

// CrazyGames SDK (B1): detect + init the platform SDK (no-op in local dev),
// then swap the save to the platform data module + signal the loading handshake.
// Fire-and-forget so boot never blocks; loadingStop() runs once the SDK resolves.
void initCrazyGames().then(() => loadingStop());

// UI and settings can initialise before the 3-D assets arrive.
initUI({ onPlay: startGame, onSecondHalf: startSecondHalf });
initResultScreen({ onPrimary: onFullTimeButton, onSecondary: onResultMenu }); // Result Screen (D)
initSettings(); // loads saved prefs and applies them to the menu + engine

// Player save (C1): loads on import; align a brand-new profile's nation with the
// chosen team so the (future) profile flag matches the team the player picked.
const player = getPlayerData();
if (player.stats.played === 0 && player.name === 'PLAYER') {
  player.flag = getSettings().team;
  player.worldcup.yourNation = getSettings().team;
  savePlayerData();
}

initWorldCupUI(); // World Cup menu banner + tournament screens (A5/A6)
initDailyCard(); // daily orders + chest meter on the menu (E2/E3)
initWeeklyCard(); // weekly orders + activity meter on the menu (E4)
initProfileCard(); // profile card: flag avatar, name, tier, XP, stat tiles (C4)
// keep the menu's World Cup banner + profile current when the team changes
for (const id of ['teamPick', 'segMode']) {
  document.getElementById(id)?.querySelectorAll('button').forEach((b) =>
    b.addEventListener('click', () => {
      refreshWorldCupUI();
      refreshProfileCard(); // a new nation changes the profile flag avatar
    }),
  );
}

initRadar();
initInput();
window.addEventListener('resize', handleResize);

// Player model + animations must be fully loaded before Player instances are
// created (they clone the FBX template in their constructor).
void loadPlayerModels().then(() => {
  buildStadium();
  createGameState();
  // Re-apply settings now that match exists (applySettings skips match
  // writes on the first early call before createGameState runs).
  applySettings();
  refreshTeamTags();
  updateHUD();
  startLoop();
});
