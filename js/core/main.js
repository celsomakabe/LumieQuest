/**
 * @module main
 * @description Bootstrap do jogo. Inicializa todos os módulos na ordem
 * correta e controla o game loop via requestAnimationFrame.
 * Dependências: todos os módulos (único módulo que importa tudo — blueprint §1)
 */

import * as Events from './events.js';
import * as Save   from './save.js';
import * as Assets from './assets.js';
import * as Input  from './input.js';
import * as Scene  from '../world/scene.js';
import * as Physics from '../world/physics.js';

// ─── Estado ───────────────────────────────────────────────────────────────────

/** @type {'loading'|'playing'|'paused'} */
let _gameState = 'loading';

/** @type {number} Timestamp do frame anterior */
let _lastTime = 0;

/** @type {number|null} ID do requestAnimationFrame ativo */
let _rafId = null;

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Retorna o estado atual do jogo.
 * @returns {'loading'|'playing'|'paused'}
 */
export function getGameState() {
    return _gameState;
}

/**
 * Pausa o game loop.
 * @returns {void}
 */
export function pause() {
    if (_gameState !== 'playing') return;
    _gameState = 'paused';
    if (_rafId !== null) {
        cancelAnimationFrame(_rafId);
        _rafId = null;
    }
    Events.emit('gamePaused');
}

/**
 * Retoma o game loop após pausa.
 * @returns {void}
 */
export function resume() {
    if (_gameState !== 'paused') return;
    _gameState = 'playing';
    _lastTime = performance.now();
    Events.emit('gameResumed');
    _startLoop();
}

/**
 * Inicializa todos os módulos e aguarda assetsReady para iniciar o loop.
 * Ordem obrigatória definida no blueprint §1:
 *   scene → physics → save → input → assets → preloadAll
 * O loop NÃO inicia aqui — inicia ao receber assetsReady via event bus (R8).
 * @returns {void}
 */
export function init() {
    const canvas = document.getElementById('game-canvas');
    if (!canvas) {
        console.error('[main] Canvas #game-canvas não encontrado no DOM');
        return;
    }

    // 1. Cena 3D (renderer, câmera, luzes, chão)
    Scene.init(canvas);

    // 2. Física (stubs por ora — apenas inicializa estrutura)
    Physics.init();

    // 3. Sistema de save (verifica e migra save existente)
    Save.init();

    // 4. Input (registra listeners de teclado e mouse)
    Input.init();

    // 5. Assets (cria LoadingManager e loaders internos)
    Assets.init();

    // 6. Aguarda assetsReady para continuar — R8 (event bus, sem acoplamento direto)
    Events.once('assetsReady', _onAssetsReady);

    // 7. Debug: progresso de carregamento
    Events.on('assetsProgress', ({ loaded, total }) => {
        console.log(`[main] Assets carregados: ${loaded} de ${total}`);
    });

    // 8. Debug: erro de asset individual (não interrompe boot)
    Events.on('assetLoadError', ({ url, error }) => {
        console.warn(`[main] Asset com falha: ${url}`, error);
    });

    // 9. Inicia preload com textura procedural do chão
    //    Motivo: ainda não temos arquivos de imagem reais neste prompt.
    //    Geramos uma data URI de textura verde 64x64 com ruído via canvas,
    //    validando o pipeline completo de assets sem depender de arquivos externos.
    //    Será substituída por 'assets/textures/grass.png' no Prompt de mundo (world.js).
    Assets.preloadAll([
        { type: 'texture', url: _makeProceduralGrassDataURI() },
    ]);
}

// ─── Handlers internos ────────────────────────────────────────────────────────

/**
 * Chamado uma única vez quando todos os assets do preloadAll terminam.
 * Aplica textura ao chão e inicia o game loop.
 * @returns {void}
 */
function _onAssetsReady() {
    console.log('[main] Pipeline de assets pronto');

    // Recupera a textura do chão do cache e aplica na cena
    // A URL é a mesma data URI gerada em init() — assets.loadTexture retorna do cache
    const grassURI = _makeProceduralGrassDataURI();
    Assets.loadTexture(grassURI).then((texture) => {
        Scene.setGroundTexture(texture);
    });

    _gameState = 'playing';
    Events.emit('gameReady');
    _lastTime = performance.now();
    _startLoop();

    console.log('[main] LumieQuest booted ✔');
}

/**
 * Inicia o requestAnimationFrame loop.
 * @returns {void}
 */
function _startLoop() {
    _rafId = requestAnimationFrame(_loop);
}

/**
 * Frame do game loop. Calcula delta com cap de 100ms (evita spiral of death
 * após tab switch ou breakpoint de debug).
 * @param {number} timestamp - DOMHighResTimeStamp fornecido pelo rAF
 * @returns {void}
 */
function _loop(timestamp) {
    if (_gameState !== 'playing') return;

    const rawDelta = (timestamp - _lastTime) / 1000; // converte ms → segundos
    const delta    = Math.min(rawDelta, 0.1);        // cap: 100ms = 0.1s
    _lastTime      = timestamp;

    // ── Ordem do game loop (blueprint §3) ──────────────────────────────────
    // INPUT — snapshot do estado atual (usado por player.update mais tarde)
    const inputState = Input.getState(); // eslint-disable-line no-unused-vars

    // PHYSICS — stubs por ora
    Physics.update(delta);

    // ENTITIES — módulos ainda não implementados (prompts futuros)
    // player.update(delta, inputState)
    // monsters.update(delta)
    // npcs.update(delta)
    // pets.update(delta)

    // SYSTEMS — módulos ainda não implementados
    // combat.update(delta)

    // RENDER — único sistema ativo neste prompt
    Scene.render(delta);

    // UI — módulo ainda não implementado
    // ui.update(delta)

    _rafId = requestAnimationFrame(_loop);
}

// ─── Helpers privados ─────────────────────────────────────────────────────────

/**
 * Gera uma textura procedural verde 64x64 com ruído via OffscreenCanvas.
 * Retorna uma data URI estável (mesma seed sempre = mesmo resultado).
 *
 * Motivo de uso de data URI: o pipeline de assets.loadTexture() precisa ser
 * validado neste prompt, mas arquivos de imagem reais só existirão a partir
 * do prompt de world/tileset. Uma data URI resolve o bootstrap sem arquivos
 * externos e sem abrir exceção no fluxo de preloadAll.
 *
 * @returns {string} data URI PNG da textura procedural
 */
function _makeProceduralGrassDataURI() {
    // Retorna cacheado se já gerado (evita recriar canvas a cada chamada)
    if (_makeProceduralGrassDataURI._cached) {
        return _makeProceduralGrassDataURI._cached;
    }

    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width  = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Base verde grama
    ctx.fillStyle = '#4a7c3f';
    ctx.fillRect(0, 0, size, size);

    // Ruído visual simples — variações de brilho em pixels aleatórios
    // Seed fixa via sequência determinística (sem Math.random — reproduzível)
    let seed = 42;
    const rand = () => {
        seed = (seed * 1664525 + 1013904223) & 0xffffffff;
        return (seed >>> 0) / 0xffffffff;
    };

    for (let i = 0; i < 600; i++) {
        const x = Math.floor(rand() * size);
        const y = Math.floor(rand() * size);
        const bright = rand() > 0.5;
        ctx.fillStyle = bright ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.10)';
        ctx.fillRect(x, y, 2, 2);
    }

    const uri = canvas.toDataURL('image/png');
    _makeProceduralGrassDataURI._cached = uri;
    return uri;
}// ─── Auto-bootstrap ────────────────────────────────────────────────────────
// Inicia o jogo automaticamente quando o módulo é carregado pelo browser.
// Garante que o DOM esteja pronto antes de executar init().
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}