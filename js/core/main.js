/**
 * @file main.js
 * @description Bootstrap do jogo. Inicializa mÃ³dulos na ordem correta e
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
import * as Recipes   from '../systems/recipes.js';
import * as Stats     from '../systems/stats.js';
import * as Cards     from '../systems/cards.js';
import * as Pets      from '../systems/pets.js';
import * as World     from '../world/world.js';
import * as Particles from '../systems/particles.js';
import * as VFX       from '../systems/vfx.js';
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


// â”€â”€â”€ Estado interno â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

let _gameState     = 'loading';
let _lastTime      = 0;
let _rafId         = null;
let _saveData      = null;
let _autoSaveTimer = 0;
const AUTO_SAVE_INTERVAL = 30000; // 30s

// â”€â”€â”€ FPS â€” mÃ©dia mÃ³vel de 30 frames â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const FPS_SAMPLES   = 30;
const _fpsBuf       = new Float32Array(FPS_SAMPLES);
let   _fpsBufIdx    = 0;
let   _fpsSum       = 0;

/**
 * Atualiza buffer circular de FPS e retorna mÃ©dia arredondada.
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

// â”€â”€â”€ Textura procedural de grama â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Gera um Data URI de textura de grama 64Ã—64 via Canvas 2D.
 * Evita dependÃªncia de arquivo externo.
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

    // VariaÃ§Ã£o de tons para simular grama
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

// â”€â”€â”€ Game Loop â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Loop principal via requestAnimationFrame.
 * @param {number} timestamp
 */
function _loop(timestamp) {
    _rafId = requestAnimationFrame(_loop);

    let delta = (timestamp - _lastTime) / 1000;
    _lastTime = timestamp;
    if (delta > 0.1) delta = 0.1; // cap 100ms â€” evita spiral of death

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
    // PartÃ­culas
    Particles.update(delta);
    VFX.update(delta);
    // Render
    Scene.render(delta);

    // UI
    UI.update(delta);
UI.setFPS(_calcFPS(delta));

    // â”€â”€ PROMPT 10: tick de DoTs/buffs e overlays de cooldown â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    Combat.update(delta);
    UI.updateCooldownVisuals(delta);
    UI.updateMonsterHpBars();
    UI.updateDropLabels();
}

// â”€â”€â”€ Auto-save â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function _doAutoSave() {
    const playerData = Player.getState();
    const current    = Save.load() ?? {};
Save.save({ ...current, player: { ...playerData, inventory: Inventory.serialize(), quests: Quests.getState(), pets: Pets.serialize() } });
}

// â”€â”€â”€ Assets Ready â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function _onAssetsReady() {
    // Textura procedural â€” sem dependÃªncia de arquivo externo
    const dataURI = _makeProceduralGrassDataURI();
    Assets.loadTexture(dataURI).then(tex => {
        tex.wrapS = tex.wrapT = 1000; // THREE.RepeatWrapping
        tex.repeat.set(4, 4);
        Scene.setGroundTexture(tex);
    }).catch(() => {
        // graceful â€” chÃ£o fica sem textura
    });

    // Inicia BGM da cidade com fade in
    Audio.playBGM('assets/audio/bgm/bgm_city.ogg', 0.6);

// â”€â”€ PROMPT 10: carregar skills.json e injetar em Classes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    try {
        const skillsRes  = await fetch('./assets/data/skills.json');
        const skillsData = await skillsRes.json();
        Classes.setSkillDefs(skillsData.skills || []);
 
    } catch (err) {
        console.error('[main] Falha ao carregar skills.json:', err);
        Classes.setSkillDefs([]);
    }

    // â”€â”€ PROMPT 16: carregar pet_defs de items.json â”€â”€â”€â”€â”€â”€
    try {
        const itemsRes = await fetch('./assets/data/items.json');
        const itemsData = await itemsRes.json();
        const petDefs = (itemsData.items ?? []).filter(i => i?.type === 'pet_def');
        Pets.init(petDefs);
    } catch (err) {
        console.error('[main] Falha ao carregar petDefs de items.json:', err);
        Pets.init([]);
    }

    // â”€â”€ PROMPT 10: modal de classe se save novo (player.class vazio) â”€â”€â”€â”€â”€â”€
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
    if (typeof window !== 'undefined') {
        window.Player = Player; // debug console (PROMPT 10)
        // [DEBUG] Troca de classe pelo console para testar VFX de skills sem upar.
        // Ex.: window.debugSetClass('mage') e dispare pelo hotbar (1-4).
        window.debugSetClass = async (classId) => {
            const ok = await Player.debugSetClass(classId);
            if (ok) {
                UI.updateHotbar();
                UI.updateCooldownVisuals(0);
            }
            return ok;
        };

        // [DEBUG] Itens: dar item/set e listar catalogo (a bag auto-refresca via 'itemAdded').
        window.debugGiveItem = (itemId, qty = 1) => {
            const n = Number(qty) || 1;
            const r = Inventory.addItem(itemId, n);
            if (r === false) console.warn('[debugGiveItem] falhou (item desconhecido ou inventario cheio):', itemId);
            else console.log('[debugGiveItem] +' + n + ' ' + itemId);
            return r;
        };
        window.debugGiveSet = (setId) => {
            const pieces = Object.values(Inventory.getCatalogue()).filter(i => i.setId === setId);
            if (pieces.length === 0) { console.warn('[debugGiveSet] set sem pecas / id invalido:', setId); return 0; }
            for (const p of pieces) Inventory.addItem(p.id, 1);
            console.log('[debugGiveSet] ' + setId + ': +' + pieces.length + ' pecas ->', pieces.map(p => p.id).join(', '));
            return pieces.length;
        };
        window.debugListItems = (filter) => {
            let items = Object.values(Inventory.getCatalogue());
            if (filter) {
                const f = String(filter).toLowerCase();
                items = items.filter(i =>
                    String(i.type).toLowerCase() === f ||
                    i.id.toLowerCase().includes(f) ||
                    String(i.setId ?? '').toLowerCase().includes(f) ||
                    (Array.isArray(i.classRestriction) ? i.classRestriction : [i.classRestriction])
                        .some(c => String(c ?? '').toLowerCase() === f)
                );
            }
            const rows = items.map(i => ({ id: i.id, name: i.name, type: i.type, slot: i.slot ?? '-', setId: i.setId ?? '-' }));
            if (console.table) console.table(rows); else console.log(rows);
            console.log('[debugListItems] ' + rows.length + ' itens' + (filter ? ' (filtro: ' + filter + ')' : ''));
            return rows.map(r => r.id);
        };
        // [DEBUG] Forja: entrega todos os materiais + ouro de uma receita (por result id
        // ou recipe id) para testar o craft. Ex.: window.debugGiveRecipeMats('weapon_normal_swordman').
        window.debugGiveRecipeMats = (idOrResult) => {
            const recipe = Recipes.getRecipeForResult(idOrResult) || Recipes.getRecipe(idOrResult);
            if (!recipe) { console.warn('[debugGiveRecipeMats] receita nao encontrada:', idOrResult); return false; }
            for (const m of recipe.materials) Inventory.addItem(m.itemId, m.qty);
            if (recipe.gold > 0) Inventory.setGold(Inventory.getGold() + recipe.gold);
            console.log('[debugGiveRecipeMats] ' + recipe.result + ': +' +
                recipe.materials.map(m => m.qty + 'x ' + m.itemId).join(', ') + ' + ' + recipe.gold + ' ouro');
            return true;
        };
        // [DEBUG] Stats finais: compara base vs final (gear/refino/carta/set/pet) no objeto
        // REAL do player. Também mostra type/monsterId (confirma a detecção do stats.js).
        window.debugStats = () => {
            const inst = Player.getInstance?.();
            const st = Player.getState?.();
            if (!inst) { console.warn('[debugStats] player nao inicializado'); return null; }
            const KEYS = ['str', 'agi', 'vit', 'int', 'dex', 'luk'];

            console.log('=== debugStats (runtime real) ===');

            // 1) Objeto do player como ele realmente chega ao combate.
            console.log('1) OBJETO DO PLAYER');
            console.log('   getInstance().type =', JSON.stringify(inst.type),
                        '| monsterId =', inst.monsterId ?? '(nenhum)',
                        '| isBoss =', inst.isBoss ?? '(nenhum)');
            console.log('   getState().type    =', JSON.stringify(st?.type),
                        '| mesma ref? (getInstance é o que attack usa)');
            console.log('   baseStats =', JSON.stringify(inst.baseStats));

            // 2) Equipamento como está AGORA (formato cru).
            console.log('2) Inventory.getEquipment()');
            const equip = Inventory.getEquipment();
            console.table(Object.entries(equip).map(([slot, v]) => ({
                slot,
                itemId: v?.itemId ?? (typeof v === 'string' ? v : '(vazio)'),
                refineLevel: v?.refineLevel ?? '-',
                formato: v == null ? 'null' : typeof v,
            })));

            // 3/4) Breakdown que o stats.js realmente enxerga.
            const bd = Stats.getBreakdown ? Stats.getBreakdown() : null;
            console.log('3) PECAS EQUIPADAS (def + stats, do stats.js)');
            if (bd) console.table(bd.pieces); else console.warn('   Stats.getBreakdown indisponível');

            console.log('4) BONUS AGREGADO por fonte (o que o stats.js somou)');
            if (bd) {
                console.log('   equipamento+set (getActiveSetBonuses.totalStats) =', JSON.stringify(bd.equipmentTotalStats));
                console.log('   sets ativos =', JSON.stringify(bd.equipmentSets));
                console.log('   refino (soma) =', JSON.stringify(bd.refineBonus));
                console.log('   cartas =', JSON.stringify(bd.cardBonus?.stats ?? bd.cardBonus));
                console.log('   pet =', JSON.stringify(bd.petBonus));
                console.log('   TOTAL recomputado =', JSON.stringify(bd.recomputedTotal));
                console.log('   cache: dirty =', bd.cacheDirty, '| cached =', JSON.stringify(bd.cachedBonus));
            }

            // 5) base vs final lado a lado.
            console.log('5) baseStats vs getFinalStats()');
            const finalS = Stats.getFinalStats(inst);
            console.table(KEYS.map(k => ({
                stat: k, base: inst.baseStats?.[k] ?? 0, final: finalS[k] ?? 0,
                delta: (finalS[k] ?? 0) - (inst.baseStats?.[k] ?? 0),
            })));

            // 6) o str que attack() de fato usa (mesma expressão do combat.js).
            console.log('6) STR que attack() usa =', (finalS.str || inst.str || 1),
                        '  [getFinalStats(inst).str || inst.str || 1]');

            return { instanceType: inst.type, finalS, breakdown: bd };
        };
    }
    await Inventory.init(_saveData.player.inventory ?? null);
    await Quests.init(_saveData.player.quests ?? null);
    Pets.hydrate(_saveData.player.pets ?? null);
    Combat.registerTarget(Player.getInstance());

    // Atualiza hotbar com skills equipadas (apÃ³s Player.init populou _data)
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
 // â”€â”€ InventÃ¡rio â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    // â”€â”€ PROMPT 10: consumo de MP por skills (combat.js emite via R8) â”€â”€â”€â”€â”€â”€
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
async function _loadRecipeDefs() {
    try {
        const res = await fetch('./assets/data/recipes.json');
        const data = await res.json();
        Recipes.setRecipes(data.recipes || []);
    } catch (err) {
        console.error('[Main] Falha ao carregar recipes.json:', err);
        Recipes.setRecipes([]);
    }
}
// â”€â”€â”€ Init â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Inicializa todos os mÃ³dulos na ordem correta e inicia o game loop.
 */
export async function init() {
    const canvas = document.getElementById('game-canvas');
    if (!canvas) {
        console.error('[Main] #game-canvas nÃ£o encontrado.');
        return;
    }

    // Infraestrutura
    Input.init();
    Assets.init();
    Scene.init(canvas);
    Particles.init(Scene.getScene());
    VFX.init(Scene.getScene());
    // Ãudio apÃ³s cena (precisa da cÃ¢mera)
    await Audio.init(Scene.getCamera());    

    // Sistemas e UI
    Classes.init();
    Equipment.init();
    await _loadSetDefs();
    Refine.init();
    Recipes.init();
    await _loadRecipeDefs();
    Stats.init(); // registra invalidação do cache de stats finais (event bus)
    await Cards.init();
    UI.init();

    await Monsters.init();
    NPCs.init(Scene.getScene());
    await World.init();
    await World.loadMap('city_01');
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    // Preload â€” texturas procedurais nÃ£o precisam de entry aqui;
    // Ã¡udios sÃ£o prÃ©-carregados para cache imediato
   Assets.preloadAll([
        // Player models (SessÃ£o 25A)
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

// â”€â”€â”€ Controles de estado â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€â”€ Auto-bootstrap â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}


