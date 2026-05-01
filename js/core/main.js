import * as Scene   from '../world/scene.js';
import * as Physics from '../world/physics.js';
import * as Events  from './events.js';
import * as Input   from './input.js';
import * as Assets  from './assets.js';
import * as Save    from './save.js';
import * as Player  from '../entities/player.js';
import * as Classes from '../systems/classes.js';
import * as UI      from '../ui/ui.js';

// ─── Constantes ───────────────────────────────────────────────────────────────
const DELTA_CAP  = 0.1;
const FPS_SAMPLE = 30;

// ─── Estado ───────────────────────────────────────────────────────────────────
let _state     = 'loading';
let _lastTime  = 0;
let _rafId     = null;
let _saveData  = null;

// ─── FPS média móvel ──────────────────────────────────────────────────────────
let _fpsAccum      = 0;
let _fpsFrameCount = 0;

// ─── Textura procedural de grama ─────────────────────────────────────────────
/**
 * Gera um data URI de textura de grama 64×64 via Canvas 2D.
 * @returns {string} Data URI PNG.
 */
function _makeProceduralGrassDataURI() {
  const size   = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Base verde
  ctx.fillStyle = '#4a7c3f';
  ctx.fillRect(0, 0, size, size);

  // Variação de tom
  const rng = (min, max) => min + Math.random() * (max - min);
  for (let i = 0; i < 120; i++) {
    const x = rng(0, size);
    const y = rng(0, size);
    const r = rng(1, 3);
    ctx.fillStyle = `rgba(${Math.floor(rng(40,90))},${Math.floor(rng(100,160))},${Math.floor(rng(30,70))},0.35)`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  return canvas.toDataURL('image/png');
}

// ─── Callback assetsReady ─────────────────────────────────────────────────────
function _onAssetsReady() {
  Assets.loadTexture(_makeProceduralGrassDataURI()).then(tex => {
    Scene.setGroundTexture(tex);
  });

  // Inicia o loop apenas após assets prontos (padrão PROMPT 3)
  _state    = 'playing';
  _lastTime = performance.now();
  _rafId    = requestAnimationFrame(_loop);

  Events.emit('gameReady');
}

// ─── Game Loop ────────────────────────────────────────────────────────────────
function _loop(timestamp) {
  _rafId = requestAnimationFrame(_loop);

  if (_state !== 'playing') return;

  const rawDelta = (timestamp - _lastTime) / 1000;
  _lastTime      = timestamp;
  const delta    = Math.min(rawDelta, DELTA_CAP);

  // FPS — média móvel, atualiza UI a cada FPS_SAMPLE frames (R2: adição do PROMPT 4)
  if (rawDelta > 0) {
    _fpsAccum += 1 / rawDelta;
    _fpsFrameCount++;
    if (_fpsFrameCount >= FPS_SAMPLE) {
      UI.setFPS(_fpsAccum / _fpsFrameCount);
      _fpsAccum      = 0;
      _fpsFrameCount = 0;
    }
  }

  // Physics
  Physics.update(delta);

  // Entities
  const inputState = Input.getState();
  Player.update(delta, inputState);

  // Render
  Scene.render(delta);

  // UI — dirty flag garante que só redesenha o que mudou (R2: adição do PROMPT 4)
  UI.update(delta);
}

// ─── Auto-save ────────────────────────────────────────────────────────────────
function _startAutoSave() {
  setInterval(() => {
    if (_state !== 'playing') return;
    Save.save({
      saveVersion: Save.getCurrentVersion(),
      player: Player.getState(),
    });
  }, 30_000);
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Inicializa todos os módulos na ordem correta e inicia o game loop.
 * @returns {void}
 */
export function init() {
  console.log('LumieQuest booted');

  // Captura save antes que Player.init() precise dele
  Events.once('saveLoaded', (data) => { _saveData = data; });
  Events.on('assetsReady', _onAssetsReady);

  // Infraestrutura
  Assets.init();
  Input.init();

  const canvas = document.getElementById('game-canvas');
  Scene.init(canvas);

  // UI — após Scene, antes de Save (R2: adição do PROMPT 4)
  UI.init();

  Physics.init();
  Classes.init();

  // Save emite saveLoaded → _saveData preenchido
  Save.init();

  // Player usa _saveData capturado acima
  Player.init(_saveData?.player ?? null);

  _startAutoSave();

  // Preload da textura de grama — dispara assetsReady ao concluir
  Assets.preloadAll([
    { type: 'texture', url: _makeProceduralGrassDataURI() },
  ]);
}

/**
 * Retorna o estado atual do jogo.
 * @returns {'loading'|'playing'|'paused'} Estado atual.
 */
export function getGameState() {
  return _state;
}

/**
 * Pausa o game loop.
 * @returns {void}
 */
export function pause() {
  if (_state !== 'playing') return;
  _state = 'paused';
  Events.emit('gamePaused');
}

/**
 * Retoma o game loop após pausa.
 * @returns {void}
 */
export function resume() {
  if (_state !== 'paused') return;
  _state    = 'playing';
  _lastTime = performance.now();
  Events.emit('gameResumed');
}

// ─── Auto-bootstrap com check de readyState (padrão PROMPT 3) ────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}