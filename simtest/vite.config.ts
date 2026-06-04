import { defineConfig } from 'vite';
import { resolve, dirname } from 'node:path';

/*
 * Headless balance-test build. Swaps every browser/render/audio/DOM module for a
 * tiny no-op stub so the *real* simulation (state, control, physics, movement,
 * flow, the full Yuka AI, pass-requests, pass-weighting) runs under Node with no
 * WebGL/DOM. Everything that touches gameplay is the shipped code; only the
 * presentation shell is stubbed.
 */

const STUBS: Record<string, string> = {
  'core/audio': `export const Audio = new Proxy({}, { get: () => () => {} });`,
  'core/haptics': `export const Haptics = new Proxy({}, { get: () => () => {} });`,
  'game/render': `export const addShake=()=>{};export const syncMeshes=()=>{};export const updateCamera=()=>{};export const clearTrail=()=>{};`,
  'ui/hud': `export const updateHUD=()=>{};export const refreshTeamTags=()=>{};export const flashToast=()=>{};export const updateToast=()=>{};export const showGoalFx=()=>{};export const showScorerFlash=()=>{};export const showFullTime=()=>{};export const showHalfTime=()=>{};export const showShootout=()=>{};export const showReplayUI=()=>{};export const updateShootoutBoard=()=>{};export const setMenuVisible=()=>{};export const setFullTimeVisible=()=>{};export const setHalfTimeVisible=()=>{};export const setPauseVisible=()=>{};export const initUI=()=>{};export const commentate=()=>{};export const goalCommentary=()=>{};export const resetCommentary=()=>{};`,
  'ui/commentary': `export const commentate=()=>{};export const goalCommentary=()=>{};export const resetCommentary=()=>{};export const goalCall=()=>'';`,
  'ui/radar': `export const initRadar=()=>{};export const updateRadar=()=>{};`,
  'rendering/meshes': `const mk=()=>({userData:{body:{material:{color:{set(){}}}},ring:{visible:false},call:{visible:false},shadow:{position:{set(){}},scale:{set(){}},material:{opacity:0}}},position:{set(){},x:0,y:0,z:0},rotation:{set(){},x:0,y:0,z:0},scale:{setScalar(){}},visible:true,rotateOnWorldAxis(){}});export const makePlayerMesh=()=>mk();export const makeModelPlayerMesh=()=>mk();export const makeBallMesh=()=>mk();`,
  'rendering/scene': `export const renderer={setSize(){},setPixelRatio(){},render(){},shadowMap:{},domElement:{}};export const scene={add(){}};export const camera={position:{set(){},lerp(){}},lookAt(){},updateProjectionMatrix(){}};export const sun={position:{set(){}},target:{position:{set(){}}},shadow:{mapSize:{set(){}},camera:{}}};export const world={add(){}};export const handleResize=()=>{};`,
  'game/replay': `export const setReplayEnabled=()=>{};export const recordFrame=()=>{};export const resetReplayBuffer=()=>{};export const hasReplay=()=>false;export const isReplaying=()=>false;export const startReplay=()=>{};export const skipReplay=()=>{};export const updateReplay=()=>true;`,
  'game/penalty': `export const inShootout=()=>false;export const abortShootout=()=>{};export const startShootout=()=>{};export const penaltyAction=()=>{};export const updateShootout=()=>{};`,
  'game/modes': `export const startGame=()=>{};export const onFullTimeButton=()=>{};export const onResultMenu=()=>{};export const presentResult=()=>{};`,
  'platform/crazygames': `export const initCrazyGames=async()=>{};export const available=()=>false;export const environment=()=>'local';export const loadingStart=()=>{};export const loadingStop=()=>{};export const gameplayStart=()=>{};export const gameplayStop=()=>{};export const happytime=()=>{};export const requestAd=(_t,cb)=>cb(false);export const interstitial=(cb)=>cb();export const rewarded=(cb)=>cb(false);`,
  'core/settings': `export const getSettings=()=>({team:'USA',mentality:1,diff:1,half:180,mode:'friendly',sim:false,sound:false,haptics:false,quality:'lite',lefty:false,titles:0});export const saveSettings=()=>{};export const applySettings=()=>{};export const initSettings=()=>{};`,
};

function stubPlugin() {
  return {
    name: 'sim-stub',
    enforce: 'pre' as const,
    resolveId(source: string, importer?: string) {
      if (!importer || !source.startsWith('.')) return null;
      const norm = resolve(dirname(importer), source).replace(/\\/g, '/').replace(/\.ts$/, '');
      for (const key of Object.keys(STUBS)) {
        if (norm.endsWith('/src/' + key)) return '\0stub:' + key;
      }
      return null;
    },
    load(id: string) {
      if (id.startsWith('\0stub:')) return STUBS[id.slice(6)];
      return null;
    },
  };
}

export default defineConfig({
  plugins: [stubPlugin()],
  ssr: { noExternal: ['yuka'] },
  build: {
    ssr: 'simtest/harness.ts',
    outDir: 'simtest/dist',
    emptyOutDir: true,
    minify: false,
    target: 'node20',
    rollupOptions: { output: { entryFileNames: 'harness.mjs' } },
  },
});
