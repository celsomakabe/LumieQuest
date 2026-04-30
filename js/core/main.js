/**
 * main.js — Bootstrap do LumieQuest.
 * Único módulo que importa todas as camadas (core, world).
 * Entities e systems serão adicionados nos prompts subsequentes (R1, R7).
 */

import * as events from './events.js';
import * as save   from './save.js';
import * as scene  from '../world/scene.js';
import * as physics from '../world/physics.js';

// ─── Estado do jogo ───────────────────────────────────────────────────────────

/** @type {'loading'|'playing'|'paused'} */
let _gameState = 'loading';

// ─── Variáveis do game loop ───────────────────────────────────────────────────

/** Timestamp do último frame (0 indica primeiro frame) */
let _lastTime = 0;

/** Acumulador de delta para cálculo de FPS (média a cada 30 frames) */
let _fpsFrameCount = 0;
let _fpsDeltaAccum = 0;

/** Elemento DOM do contador de FPS */
let _fpsEl;

// ─── Init ─────────────────────────────────────────────────────────────────────

/**
 * Inicializa todos os módulos e inicia o game loop.
 * Ordem de init respeitada conforme blueprint (R7):
 * events → save → scene → physics → loop
 */
export function init() {
  const canvas = document.getElementById('game-canvas');

  // Inicializa módulos na ordem correta
  scene.init(canvas);
  physics.init();
  save.init();

  // Cria overlay de FPS (div leve, sem framework, posição fixa no canto)
  _fpsEl = document.createElement('div');
  _fpsEl.id = 'fps-counter';
  _fpsEl.style.cssText = [
    'position:fixed',
    'top:8px',
    'left:8px',
    'color:#ffffff',
    'font:bold 13px/1 monospace',
    'text-shadow:1px 1px 0 #000,0 0 4px #000',
    'pointer-events:none',
    'z-index:9999',
    'user-select:none',
  ].join(';');
  _fpsEl.textContent = 'FPS: --';
  document.body.appendChild(_fpsEl);

  _gameState = 'playing';

  console.log('LumieQuest booted');
  events.emit('gameReady');

  // Inicia o loop — passa performance.now() como "último frame" para evitar
  // delta gigante no primeiro tick
  _lastTime = performance.now();
  requestAnimationFrame(_loop);
}

// ─── Game Loop ────────────────────────────────────────────────────────────────

/**
 * Loop principal do jogo. Chamado a cada frame pelo browser.
 * Delta com cap de 100ms evita "spiral of death" após mudança de aba (R6).
 * @param {number} timestamp - Timestamp do frame atual em ms (via rAF)
 * @private
 */
function _loop(timestamp) {
  requestAnimationFrame(_loop);

  if (_gameState === 'paused') return;

  // Delta com cap — nunca processa mais que 100ms de uma vez
  const rawDelta = timestamp - _lastTime;
  const delta = Math.min(rawDelta, 100);
  _lastTime = timestamp;

  // ── Atualização de sistemas (prompts futuros adicionam aqui) ──
  // physics.update(delta);   → PROMPT 5
  // player.update(delta);    → PROMPT 3
  // monsters.update(delta);  → PROMPT 6
  // combat.update(delta);    → PROMPT 5
  // ui.update(delta);        → PROMPT 4

  // ── Render ──
  scene.render(delta);

  // ── FPS counter (média móvel a cada 30 frames) ──
  _fpsFrameCount++;
  _fpsDeltaAccum += delta;
  if (_fpsFrameCount >= 30) {
    const avgDelta = _fpsDeltaAccum / _fpsFrameCount;
    const fps = avgDelta > 0 ? Math.round(1000 / avgDelta) : 0;
    _fpsEl.textContent = `FPS: ${fps}`;
    _fpsFrameCount = 0;
    _fpsDeltaAccum = 0;
  }
}

// ─── API Pública ──────────────────────────────────────────────────────────────

/**
 * Retorna o estado atual do jogo.
 * @returns {'loading'|'playing'|'paused'}
 */
export function getGameState() {
  return _gameState;
}

/**
 * Pausa o game loop. Emite 'gamePaused'.
 */
export function pause() {
  if (_gameState !== 'playing') return;
  _gameState = 'paused';
  events.emit('gamePaused');
}

/**
 * Retoma o game loop após pausa. Emite 'gameResumed'.
 * Reseta _lastTime para evitar delta gigante acumulado durante a pausa.
 */
export function resume() {
  if (_gameState !== 'paused') return;
  _gameState = 'playing';
  _lastTime = performance.now(); // Reseta para evitar spike de delta
  events.emit('gameResumed');
}

// ─── Auto-bootstrap ───────────────────────────────────────────────────────────
// Executa init() automaticamente quando o módulo é importado pelo index.html
init();
