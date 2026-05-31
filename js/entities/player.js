/**
 * @module player
 * @description Personagem do jogador: spawn, movimento, cÃ¢mera e atributos.
 * DependÃªncias: events.js, input.js, scene.js, physics.js, classes.js
 */

import * as THREE        from 'three';
import { emit, on }      from '../core/events.js';
import { getState as getInput } from '../core/input.js';
import { getCamera, getSun, add, remove } from '../world/scene.js';
import { getCollisionBoxes } from '../world/world.js';
import { getGroundHeight }          from '../world/physics.js';
import { getBaseStats, getJobMeta } from '../systems/classes.js';
import * as Audio from '../core/audio.js';
import { findNearestTarget, attack } from '../systems/combat.js';
import { getCardBonuses } from '../systems/cards.js';
import { getPetBonuses } from '../systems/pets.js';
import * as Models from '../core/models.js';

let _dialogOpen = false;

on('dialogStarted', () => { _dialogOpen = true; });
on('dialogEnded',   () => { _dialogOpen = false; });

// Combat.castSkill emite mpConsumeRequest â€” player deduz o MP localmente.
on('mpConsumeRequest', ({ amount }) => {
    if (typeof amount === 'number' && amount > 0 && _data) {
        _data.mp = Math.max(0, _data.mp - amount);
        emit('playerMpChanged', { current: _data.mp, max: _data.maxMp });
    }
});
on('bossAbyssPoison', ({ damagePerTick, duration }) => {
    const ticks    = Math.floor(duration / 1000);
    let ticksDone  = 0;
    const interval = setInterval(() => {
        if (ticksDone >= ticks || _isDead) { clearInterval(interval); return; }
        takeDamage(damagePerTick, 'abyss_poison');
        ticksDone++;
    }, 1000);
});
// â”€â”€â”€ Constantes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const MOVE_SPEED         = 5;
const SPRINT_MULTIPLIER  = 2.5;
const MOUSE_SENSITIVITY  = 0.003;
const CAM_OFFSET         = new THREE.Vector3(0, 8, 8);
const CAM_ZOOM_MIN       = 3;
const CAM_ZOOM_MAX       = 40;
const CAM_ZOOM_STEP      = 0.5;
const CAM_PITCH_MIN      = 0.05;
const CAM_PITCH_MAX      = 1.4;
const PLAYER_RADIUS      = 0.5;
const ANIM_FADE_DURATION = 0.2;

const CLASS_MODELS = {
    swordman:        'assets/models/player/swordman.glb',
    mage:            'assets/models/player/mage.glb',
    archer:          'assets/models/player/archer.glb',
    assassin:        'assets/models/player/assassin.glb',
    knight:          'assets/models/player/knight.glb',
    wizard:          'assets/models/player/mage.glb',
    hunter:          'assets/models/player/archer.glb',
    assassin_master: 'assets/models/player/assassin.glb',
    lord_knight:     'assets/models/player/knight.glb',
    high_wizard:     'assets/models/player/mage.glb',
    sniper:          'assets/models/player/archer.glb',
    shadow_assassin: 'assets/models/player/shadow_assassin.glb'
};// â”€â”€â”€ Estado interno â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** @type {THREE.Object3D|null} */
let _mesh = null;
/** @type {THREE.Group|null} */
let _model = null;
/** @type {THREE.AnimationMixer|null} */
let _mixer = null;
/** @type {{ idle: THREE.AnimationAction|null, walk: THREE.AnimationAction|null, attack: THREE.AnimationAction|null }} */
let _actions = { idle: null, walk: null, attack: null };
/** @type {THREE.AnimationAction|null} */
let _currentAction = null;
/** @type {THREE.AnimationClip[]} */
let _animClips = [];
let _attackAnimTimer = null;
let _isDead = false;
/** @type {Object|null} */
let _data = null;
/** @type {{
 *  totalStats: { str:number, agi:number, vit:number, int:number, dex:number, luk:number },
 *  hp_pct: number,
 *  mp_pct: number
 * }} */
let _setBonusCache = {
    totalStats: { str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0 },
    hp_pct: 0,
    mp_pct: 0
};

let _cardBonusCache = {
    totalStats: { str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0 },
    hp_pct: 0,
    mp_pct: 0
};
let _petBonusCache = {
    totalStats: { str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0 },
    hp_pct: 0,
    mp_pct: 0,
    maxHp: 0,
    maxMp: 0
};

let _rotationY   = 0;
let _cameraPitch = 0.78;
let _lastMouseX  = null;
let _lastMouseY  = null;
let _cameraDistance = 5;
let _hasMoved    = false;

const _prevPosition = new THREE.Vector3();

// â”€â”€â”€ BUG-05: Footsteps â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let _footstepIndex    = 0;
let _lastFootstepTime = 0;

const FOOTSTEP_COOLDOWN_MS = 350;
const FOOTSTEP_VOLUME      = 0.4;
const FOOTSTEP_THRESHOLD   = 0.01;

// â”€â”€â”€ Regen passivo (Ragnarok-style) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const REGEN_TICK_S = 6;
let _regenTimer    = 0;

const FOOTSTEP_SFXS = [
    'assets/audio/sfx/sfx_footstep_grass1.ogg',
    'assets/audio/sfx/sfx_footstep_grass2.ogg'
];
// â”€â”€â”€ API pÃºblica â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Inicializa o player com dados do save ou defaults.
 * @param {Object|null} [saveData]
 * @returns {void}
 */
/**
 * Inicializa o player com dados do save ou defaults.
 * @param {Object|null} [saveData]
 * @returns {Promise<void>}
 */
export async function init(saveData = null) {
    _setBonusCache = {
        totalStats: { str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0 },
        hp_pct: 0,
        mp_pct: 0
    };
    _cardBonusCache = {
        totalStats: { str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0 },
        hp_pct: 0,
        mp_pct: 0
    };
    _petBonusCache = {
        totalStats: { str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0 },
        hp_pct: 0,
        mp_pct: 0,
        maxHp: 0,
        maxMp: 0
    };

    _data = _buildData(saveData);

    _data.hp = _data.maxHp;
    _data.mp = _data.maxMp;
    _isDead = false;

    await _loadPlayerVisual(_data.class);

    _mesh.position.set(_data.position.x, _data.position.y, _data.position.z);
    _mesh.rotation.set(0, _rotationY, 0);
    _prevPosition.copy(_mesh.position);

    add(_model);

    on('cardBonusChanged', _onCardBonusChanged);
    on('itemEquipped', _onItemEquipped);
    on('setBonusChanged', _onSetBonusChanged);
    on('petBonusChanged', _onPetBonusChanged);
    on('playerMoved', _onPlayerMoved);
    on('mouseScrolled', ({ deltaY }) => {
        const dir = deltaY > 0 ? 1 : -1;
        _cameraDistance = Math.max(CAM_ZOOM_MIN, Math.min(CAM_ZOOM_MAX, _cameraDistance + dir * CAM_ZOOM_STEP));
    });
    on('playerCurrentMapChanged', ({ mapId }) => {
        if (_data && mapId) _data.currentMap = mapId;
    });

    on('mouseClicked', (e) => {
        if (e.button !== 0) return;
        if (_dialogOpen) return;
        if (_isDead || !_data || _data.hp <= 0) return;

        const pos    = _data.position;
        const target = findNearestTarget(pos, 3);
        if (!target) {
            Audio.playSFX('assets/audio/sfx/sfx_combat_miss.ogg');
            return;
        }

        const result = attack(_data, target);
        if (!result) return;

        _playAttackAnimation();
    });

// Validar spawn contra colisoes
    _validateSpawnPosition();

    _validateSpawnPosition();
    emit('playerSpawned', { position: _mesh.position.clone() });
    console.log('[player] Spawnou em', _mesh.position);
}

/**
 * Retorna estado completo serializÃ¡vel para o save.
 * @returns {Object|null}
 */
/**
 * Retorna estado completo serializÃ¡vel para o save.
 * @returns {Object|null}
 */
export function getState() {
    if (!_data || !_mesh) return null;
    return {
        ..._data,
        position: { x: _mesh.position.x, y: _mesh.position.y, z: _mesh.position.z },
    };
}

/**
 * Retorna posiÃ§Ã£o atual do player.
 * @returns {THREE.Vector3}
 */
export function getPosition() {
    return _mesh ? _mesh.position.clone() : new THREE.Vector3();
}
export function setPosition(x, y, z) {
    if (_mesh) _mesh.position.set(x, y, z);
    if (_data) _data.position = { x, y, z };
}
/**
 * Respawna o player na cidade, restaurando HP/MP e limpando estado de morte.
 * @returns {void}
 */
function _validateSpawnPosition() {
  if (!_mesh) return;
  const boxes = getCollisionBoxes();
  const r = 0.5;
  const px = _mesh.position.x;
  const pz = _mesh.position.z;

  let inside = false;
  for (const box of boxes) {
    if (px + r > box.minX && px - r < box.maxX && pz + r > box.minZ && pz - r < box.maxZ) {
      inside = true;
      break;
    }
  }
  if (!inside) return;

  // Tentar offsets pequenos ao redor da posicao atual
  for (let dist = 2; dist <= 20; dist += 2) {
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
      const tx = px + Math.cos(angle) * dist;
      const tz = pz + Math.sin(angle) * dist;
      let free = true;
      for (const box of boxes) {
        if (tx + r > box.minX && tx - r < box.maxX && tz + r > box.minZ && tz - r < box.maxZ) {
          free = false;
          break;
        }
      }
      if (free && Math.abs(tx) <= 75 && Math.abs(tz) <= 75) {
        _mesh.position.set(tx, 0, tz);
        _data.position = { x: tx, y: 0, z: tz };
        console.log('[player] Spawn ajustado para', tx.toFixed(1), tz.toFixed(1));
        return;
      }
    }
  }
}

export function respawn() {
    if (!_data || !_mesh) return;

    _isDead = false;

    _data.currentMap = 'city_01';
    _data.hp = _data.maxHp;
    _data.mp = _data.maxMp;

    _data.position = { x: 0, y: 0, z: 0 };
    _mesh.position.set(0, 0, 0);

    _mesh.rotation.set(0, _rotationY, 0);

    emit('playerHpChanged', { current: _data.hp, max: _data.maxHp });
    emit('playerMpChanged', { current: _data.mp, max: _data.maxMp });

    emit('playerRespawned', {
        position: { x: 0, y: 0, z: 0 },
        currentMap: _data.currentMap,
    });

    console.log('[player] Respawn na cidade_01 (0,0,0)');
}

/**
 * Aplica dano ao player.
 * @param {number} amount
 * @param {string} source
 * @returns {void}
 */
export function takeDamage(amount, source) {
    if (_isDead) return;
    if (!_data) return;
    // â”€â”€ reduÃ§Ã£o de dano por buff 'endure' â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    let dmg = typeof amount === 'number' ? Math.max(0, amount) : 0;
    if (Array.isArray(_data._activeBuffs)) {
        const endureBuff = _data._activeBuffs.find(
            b => b.id === 'endure' && b.expiresAt > performance.now()
        );
        if (endureBuff && endureBuff.modifier && typeof endureBuff.modifier.defenseMultiplier === 'number') {
            dmg = Math.floor(dmg * (1 - endureBuff.modifier.defenseMultiplier));
        }
    }

    _data.hp = Math.max(0, _data.hp - dmg);
    emit('playerHpChanged', { current: _data.hp, max: _data.maxHp });
    if (_data.hp <= 0 && !_isDead) {
        _isDead = true;
        if (_mesh) {
            _mesh.rotation.x = -Math.PI / 2;
        }
        emit('playerDied', {
            position: { x: _data.position.x, y: _data.position.y, z: _data.position.z },
            currentMap: _data.currentMap,
            source: source ?? 'unknown',
        });
        console.log(`[player] Morreu (fonte: ${source})`);
        setTimeout(() => {
            _isDead = false;
            _data.hp = _data.maxHp;
            _data.mp = _data.maxMp;
            _data.position = { x: 0, y: 0, z: 0 };
            if (_mesh) {
                _mesh.rotation.set(0, _rotationY, 0);
                _mesh.position.set(0, 0, 0);
            }
            _validateSpawnPosition();
            emit('playerHpChanged', { current: _data.hp, max: _data.maxHp });
            emit('playerMpChanged', { current: _data.mp, max: _data.maxMp });
            emit('playerRespawned', { position: _data.position, currentMap: _data.currentMap });
            console.log('[player] Auto-respawn no centro do mapa');
        }, 2000);
    }
    }


/**
 * Restaura HP do player.
 * @param {number} amount
 * @returns {void}
 */
export function heal(amount) {
    if (_isDead) return;
    if (!_data) return;
    _data.hp = Math.min(_data.maxHp, _data.hp + amount);
    emit('playerHpChanged', { current: _data.hp, max: _data.maxHp });
}
/**
 * Restaura MP do player.
 * @param {number} amount
 * @returns {void}
 */
export function restoreMp(amount) {
    if (_isDead) return;
    if (!_data) return;
    _data.mp = Math.min(_data.maxMp, _data.mp + amount);
    emit('playerMpChanged', { current: _data.mp, max: _data.maxMp });
}
/**
 * Adiciona XP e verifica level up. FÃ³rmula: 100 * levelÂ².
 * @param {number} amount
 * @returns {void}
 */
/**
 * Deduz MP do player, respeitando mÃ­nimo 0. Emite playerMpChanged.
 * @param {number} amount - quantidade a deduzir (positivo). Math.abs aplicado.
 */
export function consumeMp(amount) {
    if (_isDead) return;
    if (!_data) return;
    _data.mp = Math.max(0, _data.mp - Math.abs(amount));
    emit('playerMpChanged', { current: _data.mp, max: _data.maxMp });
}
export function addExp(amount) {
    if (!_data) return;

    const gain = Number(amount);
    if (!Number.isFinite(gain) || gain <= 0) return;

    _data.exp += gain;
    emit('expChanged', { current: _data.exp, needed: 100 * (_data.level * _data.level) });
    while (true) {
        if (_data.level >= 99) {
            _data.exp = 0;
            break;
        }
        const xpNeeded = 100 * (_data.level * _data.level);
        if (_data.exp < xpNeeded) break;

        _data.exp   -= xpNeeded;
        _data.level += 1;

        // Pre-Renewal: floor((BaseLv-1)/5) + 3 statPoints por level
        _data.statPoints += Math.floor((_data.level - 1) / 5) + 3;

        _data.maxHp = _calcMaxHp(_data.class, _data.level, _data.baseStats, _setBonusCache, _cardBonusCache, _petBonusCache);
        _data.maxMp = _calcMaxMp(_data.class, _data.level, _data.baseStats, _setBonusCache, _cardBonusCache, _petBonusCache);
        _data.hp = _data.maxHp;
        _data.mp = _data.maxMp;
        emit('levelUp', { newLevel: _data.level });
        emit('playerHpChanged', { current: _data.hp, max: _data.maxHp });
        emit('playerMpChanged', { current: _data.mp, max: _data.maxMp });
        console.log(`[player] Level up! NÃ­vel ${_data.level}`);
    }
}
/**
 * Marca quest de job-change como completada no estado do player.
 * Idempotente: ignora se jÃ¡ estava na lista.
 * @param {string} questId
 * @returns {void}
 */
/**
 * Marca quest de job-change como completada no estado do player.
 * Idempotente: ignora se jÃ¡ estava na lista.
 * @param {string} questId
 * @returns {void}
 */
export function unlockJobChangeQuest(questId) {
    if (!_data) return;
    if (!Array.isArray(_data.jobChangeQuestsCompleted)) {
        _data.jobChangeQuestsCompleted = [];
    }
    if (!_data.jobChangeQuestsCompleted.includes(questId)) {
        _data.jobChangeQuestsCompleted.push(questId);
        console.log(`[player] Quest de job-change desbloqueada: ${questId}`);
    }
}


 /**
 * Aplica mudanÃ§a de job ao estado real do player.
 * @param {string} newJobId
 * @returns {Promise<boolean>}
 */
export async function applyJobChange(newJobId) {
    if (!_data) return false;
    const Classes = await import('../systems/classes.js');
    const check = Classes.canJobChange(_data);
    if (!check.canChange) {
        console.warn('[player] applyJobChange bloqueado:', check.reason);
        return false;
    }

    const meta = Classes.getJobMeta(newJobId);
    if (!meta) {
        console.warn('[player] JOBS_META nÃ£o encontrado para', newJobId);
        return false;
    }

    const oldClass = _data.class;
    const oldModelUrl = _getClassModelUrl(oldClass);
    const newModelUrl = _getClassModelUrl(newJobId);

    _data.class      = newJobId;
    _data.title      = meta.title ?? '';
    _data.jobLevel   = 1;
    _data.jobExp     = 0;
    _data.statPoints += 5;

    if (meta.statBonus) {
        Object.keys(meta.statBonus).forEach(stat => {
            if (_data.baseStats[stat] !== undefined) {
                _data.baseStats[stat] += meta.statBonus[stat];
            }
        });
    }

    _data.maxHp = _calcMaxHp(_data.class, _data.level, _data.baseStats, _setBonusCache, _cardBonusCache, _petBonusCache);
    _data.maxMp = _calcMaxMp(_data.class, _data.level, _data.baseStats, _setBonusCache, _cardBonusCache, _petBonusCache);
    _data.hp = _data.maxHp;
    _data.mp = _data.maxMp;
    emit('playerHpChanged', { current: _data.hp, max: _data.maxHp });
    emit('playerMpChanged', { current: _data.mp, max: _data.maxMp });

    if (newModelUrl !== oldModelUrl) {
        if (_model) {
            remove(_model);
        }

        await _loadPlayerVisual(newJobId);
        _mesh.position.set(_data.position.x, _data.position.y, _data.position.z);
        _mesh.rotation.y = _rotationY;
        add(_model);
    }

    if (!Array.isArray(_data.jobHistory)) _data.jobHistory = [];
    _data.jobHistory.push({ jobId: newJobId, changedAt: Date.now(), level: _data.level });

    emit('jobChanged', { oldClass, newClass: newJobId, player: _data });
    emit('levelUp', { newLevel: _data.level });
    console.log(`[player] Job change: ${oldClass} â†’ ${newJobId}`);
    return true;
}

/**
 * Atualiza movimento, rotaÃ§Ã£o e cÃ¢mera. Chamado pelo game loop.
 * @param {number} delta
 * @param {Object} inputState
 * @returns {void}
 */
export function update(delta, inputState) {
    if (!_mesh || !_data) return;

    if (_mixer) {
        _mixer.update(delta);
    }

    if (_isDead) return;

    if (!_isDead && _data.hp <= 0) {
        _isDead = true;
        if (_mesh) _mesh.rotation.x = -Math.PI / 2;
        emit('playerDied', {
            position: { x: _data.position.x, y: _data.position.y, z: _data.position.z },
            currentMap: _data.currentMap,
            source: 'combat',
        });
        console.log('[player] Morreu (detectado no update)');
        setTimeout(() => {
            _isDead = false;
            _data.hp = _data.maxHp;
            _data.mp = _data.maxMp;
            _data.position = { x: 0, y: 0, z: 0 };
            if (_mesh) {
                _mesh.rotation.set(0, _rotationY, 0);
                _mesh.position.set(0, 0, 0);
            }
            _validateSpawnPosition();
            emit('playerHpChanged', { current: _data.hp, max: _data.maxHp });
            emit('playerMpChanged', { current: _data.mp, max: _data.maxMp });
            emit('playerRespawned', { position: _data.position, currentMap: _data.currentMap });
            console.log('[player] Auto-respawn no centro do mapa');
        }, 2000);
        return;
    }

    if (Array.isArray(_data._activeBuffs) && _data._activeBuffs.length > 0) {
        const now = performance.now();
        _data._activeBuffs = _data._activeBuffs.filter(buff => {
            if (now >= buff.expiresAt) {
                emit('buffExpired', { buffId: buff.id, casterId: _data.name });
                return false;
            }
            return true;
        });
    }

    _regenTimer += delta;
    if (_regenTimer >= REGEN_TICK_S) {
        _regenTimer -= REGEN_TICK_S;
        const hpRegen = Math.floor(_data.maxHp / 200) + Math.floor((_data.baseStats?.vit ?? 0) / 5);
        const mpRegen = 1 + Math.floor(_data.maxMp / 100) + Math.floor((_data.baseStats?.int ?? 0) / 6);
        if (hpRegen > 0 && _data.hp > 0 && _data.hp < _data.maxHp) {
            _data.hp = Math.min(_data.maxHp, _data.hp + hpRegen);
            emit('playerHpChanged', { current: _data.hp, max: _data.maxHp });
        }
        if (mpRegen > 0 && _data.mp < _data.maxMp) {
            _data.mp = Math.min(_data.maxMp, _data.mp + mpRegen);
            emit('playerMpChanged', { current: _data.mp, max: _data.maxMp });
        }
    }

    _prevPosition.copy(_mesh.position);
    _hasMoved = false;

    _updateMovement(delta, inputState);
    _updateCamera();
    _syncMovementAnimation();

    if (_hasMoved) {
        _data.position.x = _mesh.position.x;
        _data.position.y = _mesh.position.y;
        _data.position.z = _mesh.position.z;
        emit('playerMoved', {
            position: _mesh.position.clone(),
            previousPosition: _prevPosition.clone(),
            mapId: _data.currentMap,
        });
    }
}
 
export function getInstance() {
    return _data;
}
function _getClassModelUrl(classId) {
    return CLASS_MODELS[classId] || CLASS_MODELS.swordman;
}

async function _loadPlayerVisual(classId) {
    const modelUrl = _getClassModelUrl(classId);

    const [playerGltf, generalGltf, movementGltf] = await Promise.all([
        Models.loadModel(modelUrl),
        Models.loadModel('assets/models/animations/general.glb'),
        Models.loadModel('assets/models/animations/movement.glb')
    ]);

    _model = playerGltf.scene;
    _mesh = _model;

    _model.traverse((child) => {
        if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = false;
        }
    });

    _mixer = Models.createMixer(_model);
    _animClips = [
        ...Models.getAnimationClips(generalGltf),
        ...Models.getAnimationClips(movementGltf)
    ];

    _actions = {
        idle: _makeAction(_findClip(['idle'])),
        walk: _makeAction(_findClip(['walk', 'walking', 'run', 'running'])),
        attack: _makeAction(_findClip(['attack', 'melee', 'slash', 'slice']))
    };

    if (_actions.attack) {
        _actions.attack.setLoop(THREE.LoopOnce, 1);
        _actions.attack.clampWhenFinished = true;
        _actions.attack.enabled = true;
        _actions.attack.reset();
        _actions.attack.paused = false;
        _actions.attack.stop();
        _actions.attack.getMixer().addEventListener('finished', _onAttackFinished);
    }

    _currentAction = null;
    _playAction('idle', 0);
}

function _makeAction(clip) {
    if (!_mixer || !clip) return null;
    const action = _mixer.clipAction(clip);
    action.enabled = true;
    return action;
}

function _findClip(substrings) {
    if (!Array.isArray(_animClips) || _animClips.length === 0) return null;

    const normalized = substrings.map((value) => String(value).toLowerCase());

    for (const clip of _animClips) {
        const clipName = String(clip.name || '').toLowerCase();
        if (normalized.some((term) => clipName.includes(term))) {
            return clip;
        }
    }

    return null;
}

function _playAction(name, fadeDuration = ANIM_FADE_DURATION) {
    const nextAction = _actions[name];
    if (!nextAction) return;
    if (_currentAction === nextAction) return;

    const previousAction = _currentAction;
    _currentAction = nextAction;

    nextAction.reset();
    nextAction.enabled = true;

    if (name === 'attack') {
        nextAction.setLoop(THREE.LoopOnce, 1);
        nextAction.clampWhenFinished = true;
    } else {
        nextAction.setLoop(THREE.LoopRepeat, Infinity);
        nextAction.clampWhenFinished = false;
    }

    if (previousAction) {
        previousAction.crossFadeTo(nextAction, fadeDuration, true);
    }

    nextAction.play();
}

function _syncMovementAnimation() {
    if (!_actions.attack || _currentAction !== _actions.attack) {
        _playAction(_hasMoved ? 'walk' : 'idle');
    }
}

function _playAttackAnimation() {
    if (!_actions.attack) return;
    _playAction('attack', 0.1);
}

function _onAttackFinished(event) {
    if (!_actions.attack) return;
    if (event.action !== _actions.attack) return;
    _playAction(_hasMoved ? 'walk' : 'idle', 0.1);
}
// â”€â”€â”€ Helpers privados â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Processa WASD e rotaÃ§Ã£o por mouse.
 * Usa _lastMouseX para calcular dx real â€” evita rotaÃ§Ã£o contÃ­nua quando
 * mouse.dx de input.js persiste o Ãºltimo delta entre frames sem movimento.
 * @param {number} delta
 * @param {Object} inputState
 */
/**
 * Processa WASD e rotaÃ§Ã£o por mouse.
 * Usa _lastMouseX para calcular dx real â€” evita rotaÃ§Ã£o contÃ­nua quando
 * mouse.dx de input.js persiste o Ãºltimo delta entre frames sem movimento.
 * @param {number} delta
 * @param {Object} inputState
 */
function _updateMovement(delta, inputState) {
    if (_isDead || _data.hp <= 0) return;
    const { keys, mouse } = inputState;

     if (mouse.buttons?.right) {
        if (_lastMouseX !== null && _lastMouseY !== null) {
            const dx = mouse.x - _lastMouseX;
            const dy = mouse.y - _lastMouseY;
            if (dx !== 0) {
                _rotationY -= dx * MOUSE_SENSITIVITY;
                _mesh.rotation.y = _rotationY;
            }
            if (dy !== 0) {
                _cameraPitch = Math.max(CAM_PITCH_MIN, Math.min(CAM_PITCH_MAX, _cameraPitch + dy * MOUSE_SENSITIVITY));
            }
        }
        _lastMouseX = mouse.x;
        _lastMouseY = mouse.y;
    } else {
        _lastMouseX = null;
        _lastMouseY = null;
    }

    let moveX = 0;
    let moveZ = 0;

    if (!_dialogOpen) {
        if (keys['KeyW']) moveZ -= 1;
        if (keys['KeyS']) moveZ += 1;
        if (keys['KeyA']) moveX -= 1;
        if (keys['KeyD']) moveX += 1;
    }

    if (moveX !== 0 || moveZ !== 0) {
        const len = Math.sqrt(moveX * moveX + moveZ * moveZ);
        moveX /= len;
        moveZ /= len;

        const cos    = Math.cos(_rotationY);
        const sin    = Math.sin(_rotationY);
        const worldX = moveX * cos - moveZ * sin;
        const worldZ = moveX * sin + moveZ * cos;

        const _speed = keys['ShiftLeft'] || keys['ShiftRight'] ? MOVE_SPEED * SPRINT_MULTIPLIER : MOVE_SPEED;
        _mesh.position.x += worldX * _speed * delta;
        _mesh.position.z += worldZ * _speed * delta;
        // --- Colisao com construcoes ---
        const _oldPx = _mesh.position.x - worldX * _speed * delta;
        const _oldPz = _mesh.position.z - worldZ * _speed * delta;
        const _cboxes = getCollisionBoxes();
        for (const b of _cboxes) {
          if (_mesh.position.x + PLAYER_RADIUS > b.minX && _mesh.position.x - PLAYER_RADIUS < b.maxX &&
              _mesh.position.z + PLAYER_RADIUS > b.minZ && _mesh.position.z - PLAYER_RADIUS < b.maxZ) {
            _mesh.position.x = _oldPx;
            break;
          }
        }
        for (const b of _cboxes) {
          if (_mesh.position.x + PLAYER_RADIUS > b.minX && _mesh.position.x - PLAYER_RADIUS < b.maxX &&
              _mesh.position.z + PLAYER_RADIUS > b.minZ && _mesh.position.z - PLAYER_RADIUS < b.maxZ) {
            _mesh.position.z = _oldPz;
            break;
          }
        }
        _mesh.position.y  = getGroundHeight(_mesh.position.x, _mesh.position.z);
        const HALF_TERRAIN = 75;
        _mesh.position.x = Math.max(-HALF_TERRAIN, Math.min(HALF_TERRAIN, _mesh.position.x));
        _mesh.position.z = Math.max(-HALF_TERRAIN, Math.min(HALF_TERRAIN, _mesh.position.z));
        _mesh.rotation.y = Math.atan2(worldX, worldZ);
        _hasMoved = true;
    }

    if (!_hasMoved && _prevPosition.distanceTo(_mesh.position) > 0.0001) {
        _hasMoved = true;
    }
}



function _updateCamera() {
    const camera = getCamera();
    if (!camera || !_mesh) return;

    const zoomScale = _cameraDistance / 8;
    const totalDist = Math.sqrt(CAM_OFFSET.y ** 2 + CAM_OFFSET.z ** 2) * zoomScale;
    const offsetY = totalDist * Math.sin(_cameraPitch);
    const horizDist = totalDist * Math.cos(_cameraPitch);
    const offsetX = -horizDist * Math.sin(_rotationY);
    const offsetZ = horizDist * Math.cos(_rotationY);

    const targetPos = new THREE.Vector3(
        _mesh.position.x + offsetX,
        _mesh.position.y + offsetY,
        _mesh.position.z + offsetZ,
    );

    camera.position.lerp(targetPos, 0.08);

    const lookTarget = _mesh.position.clone();
    lookTarget.y += 1.0;
    camera.lookAt(lookTarget);

    const sun = getSun?.();
    if (sun) {
        const sunOffset = new THREE.Vector3(10, 20, 10);
        const sunPos = _mesh.position.clone().add(sunOffset);
        sun.position.copy(sunPos);
        sun.target.position.copy(_mesh.position);
        sun.target.updateMatrixWorld();

        const shadowCam = sun.shadow.camera;
        shadowCam.left   = -40;
        shadowCam.right  =  40;
        shadowCam.top    =  40;
        shadowCam.bottom = -40;
        shadowCam.near   = 0.5;
        shadowCam.far    = 50;
        shadowCam.updateProjectionMatrix();
    }
}

/**
 * Monta PlayerData a partir do save ou com valores padrÃ£o.
 * @param {Object|null} saveData
 * @returns {Object}
 */
/**
 * Calcula maxHp Ragnarok-style.
 * @param {string} job
 * @param {number} level
 * @param {{vit:number}} stats
 * @returns {number}
 */
function _calcMaxHp(job, level, stats, setBonus = null, cardBonus = null, petBonus = null) {
    const meta = getJobMeta(job);
    const jobModHP = meta?.jobModHP ?? 1.0;
    const hpPct = Number(setBonus?.hp_pct || 0) + Number(cardBonus?.hp_pct || 0) + Number(petBonus?.hp_pct || 0);
    const effectiveVit = (stats.vit ?? 0)
        + (setBonus?.totalStats?.vit ?? 0)
        + (cardBonus?.totalStats?.vit ?? 0)
        + (petBonus?.totalStats?.vit || 0);
    const flatHp = Number(petBonus?.maxHp || 0);
    return Math.floor((35 + level * 8) * (1 + effectiveVit / 100) * jobModHP * (1 + hpPct / 100)) + flatHp;
}

/**
 * Calcula maxMp Ragnarok-style.
 * @param {string} job
 * @param {number} level
 * @param {{int:number}} stats
 * @returns {number}
 */
function _calcMaxMp(job, level, stats, setBonus = null, cardBonus = null, petBonus = null) {
    const meta = getJobMeta(job);
    const jobModMP = meta?.jobModMP ?? 1.0;
    const mpPct = Number(setBonus?.mp_pct || 0) + Number(cardBonus?.mp_pct || 0) + Number(petBonus?.mp_pct || 0);
    const effectiveInt = (stats.int ?? 0)
        + (setBonus?.totalStats?.int ?? 0)
        + (cardBonus?.totalStats?.int ?? 0)
        + (petBonus?.totalStats?.int || 0);
    const flatMp = Number(petBonus?.maxMp || 0);
    return Math.floor((40 + level * 5) * (1 + effectiveInt / 100) * jobModMP * (1 + mpPct / 100)) + flatMp;
}

function _buildData(saveData) {
    const job   = saveData?.class ?? 'swordman';
    const level = saveData?.level ?? 1;
    const stats = getBaseStats(job, level);

    return {
        type:          'player',
        name:          saveData?.name          ?? 'Hero',
        title:         saveData?.title         ?? '',
        class:         job,
        level:         level,
        jobLevel:      saveData?.jobLevel      ?? 1,
        exp:           saveData?.exp           ?? 0,
        jobExp:        saveData?.jobExp        ?? 0,
        hp:            saveData?.hp            ?? _calcMaxHp(job, level, stats, _setBonusCache, _cardBonusCache, _petBonusCache),
        maxHp:         saveData?.maxHp         ?? _calcMaxHp(job, level, stats, _setBonusCache, _cardBonusCache, _petBonusCache),
        mp:            saveData?.mp            ?? _calcMaxMp(job, level, stats, _setBonusCache, _cardBonusCache, _petBonusCache),
        maxMp:         saveData?.maxMp         ?? _calcMaxMp(job, level, stats, _setBonusCache, _cardBonusCache, _petBonusCache),
        baseStats:     saveData?.baseStats     ?? stats,
        statPoints:    saveData?.statPoints    ?? 0,
        skillPoints:   saveData?.skillPoints   ?? 0,
        learnedSkills: saveData?.learnedSkills ?? [],
        position:      saveData?.position      ?? { x: 0, y: 0, z: 0 },
        currentMap:    saveData?.currentMap    ?? 'city_01',

        playtime:      saveData?.playtime      ?? 0,
        equippedSkills: Array.isArray(saveData?.equippedSkills)
            ? saveData.equippedSkills
            : [null, null, null, null],
        jobHistory: Array.isArray(saveData?.jobHistory) ? saveData.jobHistory : [],
        jobChangeQuestsCompleted: Array.isArray(saveData?.jobChangeQuestsCompleted) ? saveData.jobChangeQuestsCompleted : [],
        cooldowns:     {}, // sempre zerado no boot â€” performance.now() reinicia em 0
        _activeBuffs:  [],
    };
    
}

/**
 * Recebe bÃ´nus de equipamento via bus (R8 â€” sem import de equipment.js).
 * @param {Object} _payload
 */
function _onItemEquipped(_payload) {
    // PROMPT 11: aplicar bÃ´nus de stats ao player
    console.log('[player] itemEquipped recebido â€” bÃ´nus aplicado no PROMPT 11');
}
/**
 * Atualiza cache de bÃ´nus percentuais e stats de set, depois recalcula HP/MP mÃ¡ximos.
 * @param {{ totalStats?: Object, hpPctBonus?: number, mpPctBonus?: number }} payload
 */
function _onSetBonusChanged(payload) {
    if (!_data) return;

    _setBonusCache.totalStats = {
        str: Number(payload?.totalStats?.str || 0),
        agi: Number(payload?.totalStats?.agi || 0),
        vit: Number(payload?.totalStats?.vit || 0),
        int: Number(payload?.totalStats?.int || 0),
        dex: Number(payload?.totalStats?.dex || 0),
        luk: Number(payload?.totalStats?.luk || 0)
    };
    _setBonusCache.hp_pct = Number(payload?.hpPctBonus || 0);
    _setBonusCache.mp_pct = Number(payload?.mpPctBonus || 0);

    const hpRatio = _data.maxHp > 0 ? (_data.hp / _data.maxHp) : 1;
    const mpRatio = _data.maxMp > 0 ? (_data.mp / _data.maxMp) : 1;

    _data.maxHp = _calcMaxHp(_data.class, _data.level, _data.baseStats, _setBonusCache, _cardBonusCache, _petBonusCache);
    _data.maxMp = _calcMaxMp(_data.class, _data.level, _data.baseStats, _setBonusCache, _cardBonusCache, _petBonusCache);

    _data.hp = Math.max(1, Math.min(_data.maxHp, Math.floor(_data.maxHp * hpRatio)));
    _data.mp = Math.max(0, Math.min(_data.maxMp, Math.floor(_data.maxMp * mpRatio)));

    emit('playerHpChanged', { current: _data.hp, max: _data.maxHp });
    emit('playerMpChanged', { current: _data.mp, max: _data.maxMp });
}

function _onCardBonusChanged(_payload) {
    if (!_data) return;

    const bonus = getCardBonuses?.() ?? {
        stats: { str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0 },
        hp_pct: 0,
        mp_pct: 0
    };

    _cardBonusCache.totalStats = {
        str: Number(bonus?.stats?.str || 0),
        agi: Number(bonus?.stats?.agi || 0),
        vit: Number(bonus?.stats?.vit || 0),
        int: Number(bonus?.stats?.int || 0),
        dex: Number(bonus?.stats?.dex || 0),
        luk: Number(bonus?.stats?.luk || 0)
    };
    _cardBonusCache.hp_pct = Number(bonus?.hp_pct || 0);
    _cardBonusCache.mp_pct = Number(bonus?.mp_pct || 0);

    const hpRatio = _data.maxHp > 0 ? (_data.hp / _data.maxHp) : 1;
    const mpRatio = _data.maxMp > 0 ? (_data.mp / _data.maxMp) : 1;

    _data.maxHp = _calcMaxHp(_data.class, _data.level, _data.baseStats, _setBonusCache, _cardBonusCache, _petBonusCache);
    _data.maxMp = _calcMaxMp(_data.class, _data.level, _data.baseStats, _setBonusCache, _cardBonusCache, _petBonusCache);

    _data.hp = Math.max(1, Math.min(_data.maxHp, Math.floor(_data.maxHp * hpRatio)));
    _data.mp = Math.max(0, Math.min(_data.maxMp, Math.floor(_data.maxMp * mpRatio)));

    emit('playerHpChanged', { current: _data.hp, max: _data.maxHp });
    emit('playerMpChanged', { current: _data.mp, max: _data.maxMp });
}

function _onPetBonusChanged(_payload) {
    if (!_data) return;

    const bonus = getPetBonuses?.() ?? {};

    _petBonusCache.totalStats = {
        str: Number(bonus?.str || 0),
        agi: Number(bonus?.agi || 0),
        vit: Number(bonus?.vit || 0),
        int: Number(bonus?.int || 0),
        dex: Number(bonus?.dex || 0),
        luk: Number(bonus?.luk || 0)
    };
    _petBonusCache.hp_pct = 0;
    _petBonusCache.mp_pct = 0;
    _petBonusCache.maxHp = Number(bonus?.maxHp || 0);
    _petBonusCache.maxMp = Number(bonus?.maxMp || 0);

    const hpRatio = _data.maxHp > 0 ? (_data.hp / _data.maxHp) : 1;
    const mpRatio = _data.maxMp > 0 ? (_data.mp / _data.maxMp) : 1;

    _data.maxHp = _calcMaxHp(_data.class, _data.level, _data.baseStats, _setBonusCache, _cardBonusCache, _petBonusCache);
    _data.maxMp = _calcMaxMp(_data.class, _data.level, _data.baseStats, _setBonusCache, _cardBonusCache, _petBonusCache);

    _data.hp = Math.max(1, Math.min(_data.maxHp, Math.floor(_data.maxHp * hpRatio)));
    _data.mp = Math.max(0, Math.min(_data.maxMp, Math.floor(_data.maxMp * mpRatio)));

    emit('playerHpChanged', { current: _data.hp, max: _data.maxHp });
    emit('playerMpChanged', { current: _data.mp, max: _data.maxMp });
}



/**
 * Toca SFX de footstep alternado ao detectar deslocamento real no plano XZ.
 * @param {{ position: THREE.Vector3, previousPosition: THREE.Vector3, mapId: string }} data
 */
function _onPlayerMoved(data) {
    if (!data.previousPosition) return;

    const dx   = data.position.x - data.previousPosition.x;
    const dz   = data.position.z - data.previousPosition.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < FOOTSTEP_THRESHOLD) return;

    const now = performance.now();
    if (now - _lastFootstepTime < FOOTSTEP_COOLDOWN_MS) return;

    _lastFootstepTime = now;
    Audio.playSFX(FOOTSTEP_SFXS[_footstepIndex], FOOTSTEP_VOLUME);
    _footstepIndex = (_footstepIndex + 1) % FOOTSTEP_SFXS.length;
}
