import './style.css';
import { handleResize } from './rendering/scene';
import { buildStadium } from './rendering/stadium';
import { createGameState } from './game/state';
import { initInput } from './game/input';
import { startLoop } from './game/loop';
import { returnToMenu, startMatch, startSecondHalf } from './game/flow';
import { initUI, updateHUD } from './ui/hud';
import { initRadar } from './ui/radar';
import { initSettings } from './core/settings';

/* ============================================================================
   YUKA STRIKERS — AI Soccer
   Rendering: three.js  ·  Agents: yuka.js (Vehicle steering, StateMachine,
   MemorySystem perception, FuzzyModule decisions, Regulator throttling).
   Architecture inspired by Buckland "Programming Game AI by Example" ch.4
   (Simple Soccer) and the Yuka "kickoff" demo.
   ========================================================================== */

buildStadium();
createGameState();

initUI({ onPlay: startMatch, onAgain: returnToMenu, onSecondHalf: startSecondHalf });
initSettings(); // loads saved prefs and applies them to the menu + engine
initRadar();
initInput();
window.addEventListener('resize', handleResize);

updateHUD();
startLoop();
