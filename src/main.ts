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
import { initSettings, getSettings } from './core/settings';
import { getPlayerData, savePlayerData } from './core/playerData';
import { initWorldCupUI, refreshWorldCupUI } from './ui/worldcup';
import { initDailyCard } from './ui/daily';

/* ============================================================================
   YUKA STRIKERS — AI Soccer
   Rendering: three.js  ·  Agents: yuka.js (Vehicle steering, StateMachine,
   MemorySystem perception, FuzzyModule decisions, Regulator throttling).
   Architecture inspired by Buckland "Programming Game AI by Example" ch.4
   (Simple Soccer) and the Yuka "kickoff" demo.
   ========================================================================== */

buildStadium();
createGameState();

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
// keep the menu's World Cup banner current when the team or match-type changes
for (const id of ['teamPick', 'segMode']) {
  document.getElementById(id)?.querySelectorAll('button').forEach((b) =>
    b.addEventListener('click', () => refreshWorldCupUI()),
  );
}

initRadar();
initInput();
window.addEventListener('resize', handleResize);

refreshTeamTags();
updateHUD();
startLoop();
