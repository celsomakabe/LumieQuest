/**
 * @file main.js
 * @description Bootstrap do jogo. Inicializa módulos na ordem correta e
 * gerencia o game loop via requestAnimationFrame.
 */

import * as Events  from './events.js';
import * as Input   from './input.js';
import * as Assets  from './assets.js';
import * as Audio   from './audio.js';
import * as Save    from './save.js';
import * as Scene   from '../world/scene.js';
import * as Player  from '../entities/player.js';
import * as Classes from '../systems/classes.js';
import * as UI      from '../ui/ui.js';
import * as THREE  from 'three';
import * as Combat from '../systems/combat.js';
import * as Monsters from '../entities/monsters.js';
import * as Inventory from '../systems/inventory.js';
let _dialogOpen = false;

Events.on('dialogStarted', () => { _dialogOpen = true; });
Events.on('dialogEnded',   () => { _dialogOpen = false; });
// ─── Estado interno ───────────────────────────────────────────────────────────

let _gameState     = 'loading';
let _lastTime      = 0;
let _rafId         = null;
let _saveData      = null;
let _autoSaveTimer = 0;
const AUTO_SAVE_INTERVAL = 30000; // 30s

// ─── FPS — média móvel de 30 frames ──────────────────────────────────────────

const FPS_SAMPLES   = 30;
const _fpsBuf       = new Float32Array(FPS_SAMPLES);
let   _fpsBufIdx    = 0;
let   _fpsSum       = 0;

/**
 * Atualiza buffer circular de FPS e retorna média arredondada.
 * @param {number} delta  segundos
 * @returns {number}
 */
function _calcFPS(delta) {
    const sample = delta > 0 ? 1 / delta : 0;
    _fpsSum -= _fpsBuf[_fpsBufIdx];
    _fpsBuf[_fpsBufIdx] = sample;
    _fpsSum += sample;
    _fpsBufIdx = (_fpsBufIdx + 1) % FPS_SAMPLES;
    return Math.round(_fpsSum / FPS_SAMPLES);
}

// ─── Textura procedural de grama ─────────────────────────────────────────────

/**
 * Gera um Data URI de textura de grama 64×64 via Canvas 2D.
 * Evita dependência de arquivo externo.
 * @returns {string} Data URI PNG
 */
function _makeProceduralGrassDataURI() {
    const size   = 64;
    const canvas = document.createElement('canvas');
    canvas.width  = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Base verde
    ctx.fillStyle = '#4a7c3f';
    ctx.fillRect(0, 0, size, size);

    // Variação de tons para simular grama
    const shades = ['#3d6b35', '#52883f', '#436e38', '#5a9147', '#3a6030'];
    for (let i = 0; i < 200; i++) {
        ctx.fillStyle = shades[Math.floor(Math.random() * shades.length)];
        const x = Math.random() * size;
        const y = Math.random() * size;
        const w = 1 + Math.random() * 3;
        const h = 1 + Math.random() * 3;
        ctx.fillRect(x, y, w, h);
    }

    return canvas.toDataURL('image/png');
}

// ─── Game Loop ────────────────────────────────────────────────────────────────

/**
 * Loop principal via requestAnimationFrame.
 * @param {number} timestamp
 */
function _loop(timestamp) {
    _rafId = requestAnimationFrame(_loop);

    let delta = (timestamp - _lastTime) / 1000;
    _lastTime = timestamp;
    if (delta > 0.1) delta = 0.1; // cap 100ms — evita spiral of death

    if (_gameState !== 'playing') return;

    // Auto-save a cada 30s
    _autoSaveTimer += delta * 1000;
    if (_autoSaveTimer >= AUTO_SAVE_INTERVAL) {
        _autoSaveTimer = 0;
        _doAutoSave();
    }

    const inputState = Input.getState();

    // Entities
    Player.update(delta, inputState);
    Monsters.updateAll(delta, Player.getPosition());    
    // Render
    Scene.render(delta);

    // UI
    UI.update(delta);
    UI.setFPS(_calcFPS(delta));
}

// ─── Auto-save ────────────────────────────────────────────────────────────────

function _doAutoSave() {
    const playerData = Player.getState();
    const current    = Save.load() ?? {};
Save.save({ ...current, player: { ...playerData, inventory: Inventory.serialize() } });
}

// ─── Assets Ready ─────────────────────────────────────────────────────────────

async function _onAssetsReady() {
    // Textura procedural — sem dependência de arquivo externo
    const dataURI = _makeProceduralGrassDataURI();
    Assets.loadTexture(dataURI).then(tex => {
        tex.wrapS = tex.wrapT = 1000; // THREE.RepeatWrapping
        tex.repeat.set(4, 4);
        Scene.setGroundTexture(tex);
    }).catch(() => {
        // graceful — chão fica sem textura
    });

    // Inicia BGM da cidade com fade in
    Audio.playBGM('assets/audio/bgm/bgm_city.ogg', 0.6);

    // Spawna player com dados do save (capturado via Events.once abaixo)
    Player.init(_saveData?.player ?? null);
    await Inventory.init(_saveData?.player?.inventory ?? null);
    Combat.registerTarget(Player.getInstance());

  Events.on('monsterAttackRequest', ({ attacker }) => {
      const player = Player.getInstance();
      if (player.hp <= 0) return;
      Combat.attack(attacker, player);
    });
 // ── Inventário ────────────────────────────────────────────────────────
    Events.on('itemPicked', ({ itemId, qty }) => {
        Inventory.addItem(itemId, qty);
    Audio.playSFX('assets/audio/sfx/sfx_ui_click.ogg');
    });

    Events.on('inventoryHealRequest', ({ amount }) => {
        Player.heal(amount);
    });

    Events.on('inventoryRestoreMpRequest', ({ amount }) => {
        Player.restoreMp(amount);
    });

    Events.on('keyPressed', ({ code }) => {
    if (_dialogOpen) return;

        if (code === 'KeyE') {
            Events.emit('pickupRequest', { position: Player.getPosition() });
        }
        if (code === 'KeyI') {
            Events.emit('uiWindowToggle', { id: 'inventory' });
        }
    });
    _gameState = 'playing';
    _lastTime  = performance.now();
    Events.emit('gameReady');
}

// ─── Init ─────────────────────────────────────────────────────────────────────

/**
 * Inicializa todos os módulos na ordem correta e inicia o game loop.
 */
export async function init() {
    const canvas = document.getElementById('game-canvas');
    if (!canvas) {
        console.error('[Main] #game-canvas não encontrado.');
        return;
    }

    // Infraestrutura
    Input.init();
    Assets.init();
    Scene.init(canvas);

    // Áudio após cena (precisa da câmera)
    Audio.init(Scene.getCamera());

    // Sistemas e UI
    Classes.init();
    UI.init();

// SESSÃO 24: mover para world.js (mapsConfig['map_inicial'].monsters)
    await Monsters.init();
    Monsters.spawnGroup('slime',  5, { center: { x:  5, z:  5 }, radius: 4 });
    Monsters.spawnGroup('goblin', 3, { center: { x: -5, z:  5 }, radius: 3 });

    // Captura save antes de tudo (one-shot)
    Events.once('saveLoaded', (data) => {
        _saveData = data;
    });
    Events.once('saveFailed', () => {
        _saveData = null;
    });

    // Tenta carregar save existente
    Save.init();

    // Quando assets prontos, inicializa jogo
    Events.on('assetsReady', _onAssetsReady);

    Events.on('gamePaused', () => {
        _gameState = 'paused';
    });

    Events.on('gameResumed', () => {
        _gameState = 'playing';
        _lastTime  = performance.now();
    });

    // Preload — texturas procedurais não precisam de entry aqui;
    // áudios são pré-carregados para cache imediato
    Assets.preloadAll([
        { type: 'audio', url: 'assets/audio/bgm/bgm_city.ogg'     },
        { type: 'audio', url: 'assets/audio/sfx/sfx_ui_click.ogg' },
        { type: 'audio', url: 'assets/audio/sfx/sfx_ui_hover.ogg' },
        { type: 'audio', url: 'assets/audio/sfx/sfx_levelup.ogg'  },
        { type: 'audio', url: 'assets/audio/sfx/sfx_footstep_grass1.ogg' },
        { type: 'audio', url: 'assets/audio/sfx/sfx_footstep_grass2.ogg' },
        { type: 'audio', url: 'assets/audio/sfx/sfx_combat_swing.ogg'    },
        { type: 'audio', url: 'assets/audio/sfx/sfx_combat_hit.ogg'      },
        { type: 'audio', url: 'assets/audio/sfx/sfx_combat_critical.ogg' },
        { type: 'audio', url: 'assets/audio/sfx/sfx_combat_miss.ogg'     },
    ]);

    // Inicia loop (roda em 'loading' para exibir progresso na UI)
    _lastTime = performance.now();
    _rafId    = requestAnimationFrame(_loop);

    console.log('[Main] LumieQuest booted.');
}

// ─── Controles de estado ──────────────────────────────────────────────────────

/**
 * Retorna o estado atual do jogo.
 * @returns {'loading'|'playing'|'paused'}
 */
export function getGameState() {
    return _gameState;
}

/**
 * Pausa o game loop.
 */
export function pause() {
    if (_gameState !== 'playing') return;
    _gameState = 'paused';
    Events.emit('gamePaused');
}

/**
 * Retoma o game loop.
 */
export function resume() {
    if (_gameState !== 'paused') return;
    _gameState = 'playing';
    _lastTime  = performance.now();
    Events.emit('gameResumed');
}

// ─── Auto-bootstrap ───────────────────────────────────────────────────────────

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}