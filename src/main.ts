import './style.css';
import { handleResize } from './rendering/scene';
import { buildStadium } from './rendering/stadium';
import { createGameState } from './game/state';
import { initInput } from './game/input';
import { startLoop } from './game/loop';
import { startSecondHalf } from './game/flow';
import { onFullTimeButton, startGame } from './game/modes';
import { initUI, refreshTeamTags, updateHUD } from './ui/hud';
import { initRadar } from './ui/radar';
import { initSettings, getSettings } from './core/settings';
import { getPlayerData, savePlayerData } from './core/playerData';

/* ============================================================================
   YUKA STRIKERS — AI Soccer
   Rendering: three.js  ·  Agents: yuka.js (Vehicle steering, StateMachine,
   MemorySystem perception, FuzzyModule decisions, Regulator throttling).
   Architecture inspired by Buckland "Programming Game AI by Example" ch.4
   (Simple Soccer) and the Yuka "kickoff" demo.
   ========================================================================== */

buildStadium();
createGameState();

initUI({ onPlay: startGame, onAgain: onFullTimeButton, onSecondHalf: startSecondHalf });
initSettings(); // loads saved prefs and applies them to the menu + engine

// Player save (C1): loads on import; align a brand-new profile's nation with the
// chosen team so the (future) profile flag matches the team the player picked.
const player = getPlayerData();
if (player.stats.played === 0 && player.name === 'PLAYER') {
  player.flag = getSettings().team;
  player.worldcup.yourNation = getSettings().team;
  savePlayerData();
}

initRadar();
initInput();
window.addEventListener('resize', handleResize);

refreshTeamTags();
updateHUD();
startLoop();
