/**
 * @module main
 * @description Bootstrap do jogo e game loop.
 * Único módulo que importa todos os outros (blueprint §1).
 */

import * as Events  from './events.js';
import * as Save    from './save.js';
import * as Assets  from './assets.js';
import * as Input   from './input.js';
import * as Scene   from '../world/scene.js';
import * as Physics from '../world/physics.js';
import * as Classes from '../systems/classes.js';
import * as Player  from '../entities/player.js';

// ─── Estado ───────────────────────────────────────────────────────────────────

/** @type {'loading'|'playing'|'paused'} */
let _gameState     = 'loading';
let _lastTime      = 0;
let _rafId         = null;
let _saveData      = null;
let _autoSaveTimer = 0;
// FPS counter
let _fpsFrames  = 0;
let _fpsElapsed = 0;
let _fpsDisplay = document.getElementById('fps-counter');
const AUTO_SAVE_INTERVAL = 30; // segundos

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * @returns {'loading'|'playing'|'paused'}
 */
export function getGameState() { return _gameState; }

/**
 * Pausa o game loop.
 * @returns {void}
 */
export function pause() {
    if (_gameState !== 'playing') return;
    _gameState = 'paused';
    if (_rafId !== null) { cancelAnimationFrame(_rafId); _rafId = null; }
    Events.emit('gamePaused');
}

/**
 * Retoma o game loop.
 * @returns {void}
 */
export function resume() {
    if (_gameState !== 'paused') return;
    _gameState = 'playing';
    _lastTime  = performance.now();
    Events.emit('gameResumed');
    _startLoop();
}

/**
 * Inicializa todos os módulos. Loop inicia somente após assetsReady (R8).
 * Ordem: scene → physics → save → input → classes → player → assets → preloadAll
 * @returns {void}
 */
export function init() {
    const canvas = document.getElementById('game-canvas');
    if (!canvas) { console.error('[main] Canvas #game-canvas não encontrado'); return; }

    Scene.init(canvas);
    Physics.init();

    // Listener registrado ANTES de Save.init() pois save emite saveLoaded sincronamente.
    // Isso garante que _saveData está disponível quando Player.init() é chamado abaixo.
    Events.once('saveLoaded', (data) => { _saveData = data; });
    Save.init();

    Input.init();
    Classes.init();

    // Player.init() chamado aqui, após Save.init(), para receber dados do save (R2).
    Player.init(_saveData?.player ?? null);

    Assets.init();
    Events.once('assetsReady', _onAssetsReady);

    Events.on('assetsProgress', ({ loaded, total }) => {
        console.log(`[main] Assets carregados: ${loaded} de ${total}`);
    });
    Events.on('assetLoadError', ({ url, error }) => {
        console.warn(`[main] Asset com falha: ${url}`, error);
    });

    Assets.preloadAll([
        { type: 'texture', url: _makeProceduralGrassDataURI() },
    ]);
}

// ─── Handlers internos ────────────────────────────────────────────────────────

function _onAssetsReady() {
    console.log('[main] Pipeline de assets pronto');
    Assets.loadTexture(_makeProceduralGrassDataURI()).then((tex) => {
        Scene.setGroundTexture(tex);
    });
    _gameState = 'playing';
    Events.emit('gameReady');
    _lastTime  = performance.now();
    _startLoop();
    console.log('[main] LumieQuest booted ✔');
}

function _startLoop() {
    _rafId = requestAnimationFrame(_loop);
}

function _loop(timestamp) {
    if (_gameState !== 'playing') return;

    const delta = Math.min((timestamp - _lastTime) / 1000, 0.1);
    _lastTime   = timestamp;

    // FPS counter
    _fpsFrames++;
    _fpsElapsed += delta;
    if (_fpsElapsed >= 1.0) {
        if (_fpsDisplay) _fpsDisplay.textContent = `FPS: ${_fpsFrames}`;
        console.log(`[main] FPS: ${_fpsFrames}`);
        _fpsFrames  = 0;
        _fpsElapsed = 0;
    }

    const inputState = Input.getState();

    Physics.update(delta);
    Player.update(delta, inputState);
    // monsters.update(delta)  — PROMPT 5
    // npcs.update(delta)      — PROMPT 6
    // pets.update(delta)      — PROMPT 16
    // combat.update(delta)    — PROMPT 7

    _autoSaveTimer += delta;
    if (_autoSaveTimer >= AUTO_SAVE_INTERVAL) {
        _autoSaveTimer = 0;
        _doSave();
    }

    Scene.render(delta);
    // ui.update(delta)        — PROMPT 9

    _rafId = requestAnimationFrame(_loop);
}

function _doSave() {
    const playerState = Player.getState();
    if (!playerState) return;
    Save.save({
        saveVersion: Save.getCurrentVersion(),
        player:      playerState,
        // inventory  — PROMPT 11
        // equipment  — PROMPT 12
        // quests     — PROMPT 17
        // world      — PROMPT 4
        // pets       — PROMPT 16
    });
}

// ─── Helpers privados ─────────────────────────────────────────────────────────

function _makeProceduralGrassDataURI() {
    if (_makeProceduralGrassDataURI._cached) return _makeProceduralGrassDataURI._cached;

    const size = 64;
    const cv   = document.createElement('canvas');
    cv.width   = cv.height = size;
    const ctx  = cv.getContext('2d');

    ctx.fillStyle = '#4a7c3f';
    ctx.fillRect(0, 0, size, size);

    let seed   = 42;
    const rand = () => {
        seed = (seed * 1664525 + 1013904223) & 0xffffffff;
        return (seed >>> 0) / 0xffffffff;
    };
    for (let i = 0; i < 600; i++) {
        const x = Math.floor(rand() * size);
        const y = Math.floor(rand() * size);
        ctx.fillStyle = rand() > 0.5 ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.10)';
        ctx.fillRect(x, y, 2, 2);
    }

    const uri = cv.toDataURL('image/png');
    _makeProceduralGrassDataURI._cached = uri;
    return uri;
}

// ─── Auto-bootstrap — não remover ─────────────────────────────────────────────
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}