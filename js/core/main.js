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
import * as Equipment from '../systems/equipment.js';
import * as UI      from '../ui/ui.js';
import * as THREE  from 'three';
import * as Combat from '../systems/combat.js';
import * as Monsters from '../entities/monsters.js';
import * as NPCs     from '../entities/npcs.js';
import * as Inventory from '../systems/inventory.js';
import * as Quests    from '../systems/quests.js';
import * as Refine    from '../systems/refine.js';
import * as Cards     from '../systems/cards.js';
import * as Pets      from '../systems/pets.js';
import * as World     from '../world/world.js';
let _dialogOpen = false;

Events.on('dialogStarted', () => { _dialogOpen = true; });
Events.on('dialogEnded',   () => { _dialogOpen = false; });
let _nearExitPointTargetMap = null;

Events.on('exitPointNear', ({ targetMap } = {}) => {
    _nearExitPointTargetMap = targetMap ?? null;
});

Events.on('exitPointLeft', () => {
    _nearExitPointTargetMap = null;
});

Events.on('mapLoaded', () => {
    _nearExitPointTargetMap = null;
});


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
    Pets.update(delta);
    Monsters.updateAll(delta, Player.getPosition());
    NPCs.updateAll(delta, Player.getPosition());  
    World.update(delta);
    // Render
    Scene.render(delta);

    // UI
    UI.update(delta);
UI.setFPS(_calcFPS(delta));

    // ── PROMPT 10: tick de DoTs/buffs e overlays de cooldown ──────────────
    Combat.update(delta);
    UI.updateCooldownVisuals(delta);
    UI.updateMonsterHpBars();
}

// ─── Auto-save ────────────────────────────────────────────────────────────────

function _doAutoSave() {
    const playerData = Player.getState();
    const current    = Save.load() ?? {};
Save.save({ ...current, player: { ...playerData, inventory: Inventory.serialize(), quests: Quests.getState(), pets: Pets.serialize() } });
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

// ── PROMPT 10: carregar skills.json e injetar em Classes ──────────────
    try {
        const skillsRes  = await fetch('./assets/data/skills.json');
        const skillsData = await skillsRes.json();
        Classes.setSkillDefs(skillsData.skills || []);
 
    } catch (err) {
        console.error('[main] Falha ao carregar skills.json:', err);
        Classes.setSkillDefs([]);
    }

    // ── PROMPT 16: carregar pet_defs de items.json ──────
    try {
        const itemsRes = await fetch('./assets/data/items.json');
        const itemsData = await itemsRes.json();
        const petDefs = (itemsData.items ?? []).filter(i => i?.type === 'pet_def');
        Pets.init(petDefs);
    } catch (err) {
        console.error('[main] Falha ao carregar petDefs de items.json:', err);
        Pets.init([]);
    }

    // ── PROMPT 10: modal de classe se save novo (player.class vazio) ──────
    if (!_saveData) _saveData = { player: {} };
    if (!_saveData.player) _saveData.player = {};

    if (!_saveData.player.class) {
        await new Promise(resolve => {
            UI.showClassSelectionModal((classId) => {
                const CLASS_SKILLS = {
                    swordman: ['bash', 'endure', 'provoke'],
                    mage:     ['fireball', 'iceBolt', 'lightning'],
                    archer:   ['doubleStrike', 'explosiveShot', 'slowShot'],
                    assassin: ['stealthStrike', 'poison', 'evasion'],
                };
                const skillIds = CLASS_SKILLS[classId] || [];
                const baseStats = Classes.getBaseStats(classId, 1);

                _saveData.player.class          = classId;
                _saveData.player.level          = _saveData.player.level ?? 1;
                _saveData.player.baseStats      = baseStats;
                _saveData.player.learnedSkills  = skillIds.slice();
                _saveData.player.equippedSkills = [skillIds[0] ?? null, skillIds[1] ?? null, skillIds[2] ?? null, null];
                _saveData.player.cooldowns      = {};

                resolve();
            });
        });
    }

    // Spawna player com dados do save (capturado via Events.once abaixo)
    if (!_saveData.player.pets || typeof _saveData.player.pets !== 'object') {
        _saveData.player.pets = { collection: [], summonedIndex: null };
    }
    await Player.init(_saveData.player);
    if (typeof window !== 'undefined') window.Player = Player; // debug console (PROMPT 10)
    await Inventory.init(_saveData.player.inventory ?? null);
    await Quests.init(_saveData.player.quests ?? null);
    Pets.hydrate(_saveData.player.pets ?? null);
    Combat.registerTarget(Player.getInstance());

    // Atualiza hotbar com skills equipadas (após Player.init populou _data)
    UI.updateHotbar();

    Events.on('monsterAttackRequest', ({ attacker, ability, damage }) => {
      const player = Player.getInstance();
      if (!player || player.hp <= 0) return;

      if (ability === 'abyssPoison') {
          Events.emit('bossAbyssPoison', { damagePerTick: 50, duration: 10000 });
          return;
      }

      if (damage != null) {
          Player.takeDamage(damage, `boss_${attacker.monsterId ?? attacker.id}_${ability}`);
          return;
      }

      Combat.attack(attacker, player);
  });
 // ── Inventário ────────────────────────────────────────────────────────
    Events.on('itemPicked', ({ itemId, qty, dropId, refineLevel, sockets }) => {
        Inventory.addItem(itemId, qty, {
            ...(refineLevel != null ? { refineLevel } : {}),
            ...(Array.isArray(sockets) && sockets.length > 0 ? { sockets } : {})
        });
    });

    Events.on('inventoryHealRequest', ({ amount }) => {
        Player.heal(amount);
    });

    Events.on('inventoryRestoreMpRequest', ({ amount }) => {
        Player.restoreMp(amount);
    });
    Events.on('jobChangeUnlocked', ({ questId }) => {
        Player.unlockJobChangeQuest(questId);
    });
    Events.on('questCompleted', ({ rewards }) => {
        if (!rewards) return;
        if (rewards.exp != null) Player.addExp(rewards.exp);
        if (rewards.gold) Inventory.addItem('gold', rewards.gold);
        if (rewards.items?.length) {
            for (const { itemId, qty } of rewards.items) {
                Inventory.addItem(itemId, qty);
            }
        }
    });
    Events.on('monsterDied', ({ xp }) => {
        if (xp) Player.addExp(xp);
    });
    Events.on('keyPressed', ({ code }) => {
    if (_dialogOpen) return;

        if (code === 'KeyE') {
            if (_nearExitPointTargetMap) {
                Events.emit('exitPointAction', { targetMap: _nearExitPointTargetMap });
            } else {
                Events.emit('pickupRequest', { position: Player.getPosition() });
            }
        }
        
        if (code === 'KeyI') {
            Events.emit('uiWindowToggle', { id: 'inventory' });
        }
 });

    // ── PROMPT 10: consumo de MP por skills (combat.js emite via R8) ──────
    Events.on('mpConsumeRequest', ({ amount }) => {
        Player.consumeMp(amount);
    });
    _gameState = 'playing';
    _lastTime  = performance.now();
    Events.emit('gameReady');
}
async function _loadSetDefs() {
    try {
        const setsRes = await fetch('./assets/data/sets.json');
        const setsData = await setsRes.json();
        Equipment.setCatalogue(setsData);
    } catch (err) {
        console.error('[Main] Falha ao carregar sets.json:', err);
        Equipment.setCatalogue([]);
    }
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
    await Audio.init(Scene.getCamera());    

    // Sistemas e UI
    Classes.init();
    Equipment.init();
    await _loadSetDefs();
    Refine.init();
    await Cards.init();
    UI.init();

    await Monsters.init();
    NPCs.init(Scene.getScene());
    await World.init();
    await World.loadMap('city_01');
    // ──────────────────────────────────────────────────────────────────────
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
        // Player models (Sessão 25A)
        { type: 'model', url: 'assets/models/player/swordman.glb' },
        { type: 'model', url: 'assets/models/player/mage.glb' },
        { type: 'model', url: 'assets/models/player/archer.glb' },
        { type: 'model', url: 'assets/models/player/assassin.glb' },
        { type: 'model', url: 'assets/models/player/knight.glb' },
        { type: 'model', url: 'assets/models/player/shadow_assassin.glb' },

        // Shared animations (KayKit)
        { type: 'model', url: 'assets/models/animations/general.glb' },
        { type: 'model', url: 'assets/models/animations/movement.glb' },

        // Audio
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