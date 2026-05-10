/**
 * @module player
 * @description Personagem do jogador: spawn, movimento, câmera e atributos.
 * Dependências: events.js, input.js, scene.js, physics.js, classes.js
 */

import * as THREE        from 'three';
import { emit, on }      from '../core/events.js';
import { getState as getInput } from '../core/input.js';
import { getScene, getCamera, add } from '../world/scene.js';
import { getGroundHeight }          from '../world/physics.js';
import { getBaseStats, getJobMeta } from '../systems/classes.js';
import * as Audio from '../core/audio.js';
import { findNearestTarget, attack } from '../systems/combat.js';
let _dialogOpen = false;

on('dialogStarted', () => { _dialogOpen = true; });
on('dialogEnded',   () => { _dialogOpen = false; });

// Combat.castSkill emite mpConsumeRequest — player deduz o MP localmente.
on('mpConsumeRequest', ({ amount }) => {
    if (typeof amount === 'number' && amount > 0 && _data) {
        _data.mp = Math.max(0, _data.mp - amount);
        emit('playerMpChanged', { current: _data.mp, max: _data.maxMp });
    }
});

// ─── Constantes ───────────────────────────────────────────────────────────────

const MOVE_SPEED        = 5;
const MOUSE_SENSITIVITY = 0.003;
const CAM_OFFSET        = new THREE.Vector3(0, 5, 8); // proporção base da câmera
const CAM_ZOOM_MIN      = 3;   // distância mínima
const CAM_ZOOM_MAX      = 20;  // distância máxima
const CAM_ZOOM_STEP     = 0.5; // velocidade da roda do mouse


// ─── Estado interno ───────────────────────────────────────────────────────────

/** @type {THREE.Mesh|null} */
let _mesh = null;
let _attackAnimTimer = null;
let _isDead = false;
/** @type {Object|null} */
let _data = null;

let _rotationY   = 0;
let _lastMouseX  = null; // null = primeiro frame, evita salto de rotação
let _cameraDistance = 5; // distância da câmera, ajustável via roda do mouse
let _hasMoved    = false;

const _prevPosition = new THREE.Vector3();

// ─── BUG-05: Footsteps ────────────────────────────────────────────────────────
let _footstepIndex    = 0;
let _lastFootstepTime = 0;

const FOOTSTEP_COOLDOWN_MS = 350;
const FOOTSTEP_VOLUME      = 0.4;
const FOOTSTEP_THRESHOLD   = 0.01;

// ── Regen passivo (Ragnarok-style) ───────────────────────────────────────
const REGEN_TICK_S = 6;       // tick a cada 6 segundos
let _regenTimer    = 0;       // acumulador de delta em segundos
const FOOTSTEP_SFXS = [
    'assets/audio/sfx/sfx_footstep_grass1.ogg',
    'assets/audio/sfx/sfx_footstep_grass2.ogg'
];
// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Inicializa o player com dados do save ou defaults.
 * @param {Object|null} [saveData]
 * @returns {void}
 */
export function init(saveData = null) {
   _data = _buildData(saveData);

    // Restaurar HP/MP cheios no boot (estilo MMO: relogar = full)
    _data.hp = _data.maxHp;
    _data.mp = _data.maxMp;

    const geometry = new THREE.CapsuleGeometry(0.5, 1.5, 8, 16);
    const material = new THREE.MeshStandardMaterial({ color: 0x4488ff });
    _mesh          = new THREE.Mesh(geometry, material);
    _mesh.castShadow = true;

    _mesh.position.set(_data.position.x, _data.position.y, _data.position.z);
    _prevPosition.copy(_mesh.position);

    add(_mesh);

    // Bônus de equipamento via bus — sem import direto de equipment.js (R8)
    on('itemEquipped', _onItemEquipped);
    on('playerMoved', _onPlayerMoved);
    on('mouseScrolled', ({ deltaY }) => {
        const dir = deltaY > 0 ? 1 : -1;
        _cameraDistance = Math.max(CAM_ZOOM_MIN, Math.min(CAM_ZOOM_MAX, _cameraDistance + dir * CAM_ZOOM_STEP));
    });
    // Auto-attack no clique esquerdo
    on('mouseClicked', (e) => {
      if (e.button !== 0) return;
      if (_dialogOpen) return;
      if (_data.hp <= 0) return;

      const pos    = _data.position;
      const target = findNearestTarget(pos, 3);
      if (!target) {
        Audio.playSFX('assets/audio/sfx/sfx_combat_miss.ogg');
        return;
      }

      const result = attack(_data, target);
      if (!result) return;

      if (_mesh) {
        if (_attackAnimTimer) clearTimeout(_attackAnimTimer);
        _mesh.scale.set(1.1, 1.1, 1.1);
        _attackAnimTimer = setTimeout(() => {
          if (_mesh) _mesh.scale.set(1.0, 1.0, 1.0);
          _attackAnimTimer = null;
        }, 100);
      }
    });

    emit('playerSpawned', { position: _mesh.position.clone() });
    console.log('[player] Spawnou em', _mesh.position);
}

/**
 * Retorna estado completo serializável para o save.
 * @returns {Object|null}
 */
export function getState() {
    if (!_data) return null;
    return {
        ..._data,
        position: { x: _mesh.position.x, y: _mesh.position.y, z: _mesh.position.z },
    };
}

/**
 * Retorna posição atual do player.
 * @returns {THREE.Vector3}
 */
export function getPosition() {
    return _mesh ? _mesh.position.clone() : new THREE.Vector3();
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
    // ── redução de dano por buff 'endure' ─────────────────────────────────
    let dmg = dmg;
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
    if (_data.hp <= 0) {
        _isDead = true;
        emit('playerDied');
        console.log(`[player] Morreu (fonte: ${source})`);
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
 * Adiciona XP e verifica level up. Fórmula: 100 * level².
 * @param {number} amount
 * @returns {void}
 */
/**
 * Deduz MP do player, respeitando mínimo 0. Emite playerMpChanged.
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

        // Recalcular maxHp/maxMp via fórmula Ragnarok-like (não mexer em baseStats)
        const meta = getJobMeta(_data.class);
        const jobModHP = meta?.jobModHP ?? 1.0;
        const jobModMP = meta?.jobModMP ?? 1.0;
        _data.maxHp = Math.floor((35 + _data.level * 8) * (1 + _data.baseStats.vit / 100) * jobModHP);
        _data.maxMp = Math.floor((40 + _data.level * 5) * (1 + _data.baseStats.int / 100) * jobModMP);
        _data.hp = _data.maxHp;
        _data.mp = _data.maxMp;
        emit('levelUp', { newLevel: _data.level });
        emit('playerHpChanged', { current: _data.hp, max: _data.maxHp });
        emit('playerMpChanged', { current: _data.mp, max: _data.maxMp });
        console.log(`[player] Level up! Nível ${_data.level}`);
    }
}
/**
 * Marca quest de job-change como completada no estado do player.
 * Idempotente: ignora se já estava na lista.
 * @param {string} questId
 * @returns {void}
 */
/**
 * Marca quest de job-change como completada no estado do player.
 * Idempotente: ignora se já estava na lista.
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
 * Aplica mudança de job ao estado real do player.
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
        console.warn('[player] JOBS_META não encontrado para', newJobId);
        return false;
    }
    const oldClass = _data.class;

    _data.class      = newJobId;
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
// Recalcular maxHp/maxMp com novo jobMod (HP/MP escalam por classe)
    const jobModHP = meta.jobModHP ?? 1.0;
    const jobModMP = meta.jobModMP ?? 1.0;
    _data.maxHp = Math.floor((35 + _data.level * 8) * (1 + _data.baseStats.vit / 100) * jobModHP);
    _data.maxMp = Math.floor((40 + _data.level * 5) * (1 + _data.baseStats.int / 100) * jobModMP);
    _data.hp = _data.maxHp;
    _data.mp = _data.maxMp;
    emit('playerHpChanged', { current: _data.hp, max: _data.maxHp });
    emit('playerMpChanged', { current: _data.mp, max: _data.maxMp });

    if (!Array.isArray(_data.jobHistory)) _data.jobHistory = [];
    _data.jobHistory.push({ jobId: newJobId, changedAt: Date.now(), level: _data.level });

    emit('jobChanged', { oldClass, newClass: newJobId, player: _data });
    emit('levelUp', { newLevel: _data.level });
    console.log(`[player] Job change: ${oldClass} → ${newJobId}`);
    return true;
}
/**
 * Atualiza movimento, rotação e câmera. Chamado pelo game loop.
 * @param {number} delta
 * @param {Object} inputState
 * @returns {void}
 */
export function update(delta, inputState) {
    if (_isDead) return;
    if (!_mesh || !_data) return;

    // ── expirar buffs temporários ─────────────────────────────────────────────
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

    // ── regen passivo de HP/MP (Ragnarok-style: tick 8s standing) ─────────
    _regenTimer += delta;
    if (_regenTimer >= REGEN_TICK_S) {
        _regenTimer -= REGEN_TICK_S;
        const hpRegen = Math.floor(_data.maxHp / 200) + Math.floor((_data.baseStats?.vit ?? 0) / 5);
        const mpRegen = 1 + Math.floor(_data.maxMp / 100) + Math.floor((_data.baseStats?.int ?? 0) / 6);
        if (hpRegen > 0 && _data.hp < _data.maxHp) {
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

    if (_hasMoved) {
        _data.position.x = _mesh.position.x;
        _data.position.y = _mesh.position.y;
        _data.position.z = _mesh.position.z;
       /**
        *@event playerMoved
        *@property {THREE.Vector3} position         - posição atual
        *@property {THREE.Vector3} previousPosition - posição no frame anterior
        *@property {string} mapId
        */
        emit('playerMoved', {
            position:         _mesh.position.clone(),
            previousPosition: _prevPosition.clone(),
            mapId:            _data.currentMap,
});
    }
}
/**
 * Retorna referência direta ao objeto interno _data.
 * Usado por combat.js e main.js para registrar o player como alvo.
 * @returns {Object}
 */
export function getInstance() {
    return _data;
}
// ─── Helpers privados ─────────────────────────────────────────────────────────

/**
 * Processa WASD e rotação por mouse.
 * Usa _lastMouseX para calcular dx real — evita rotação contínua quando
 * mouse.dx de input.js persiste o último delta entre frames sem movimento.
 * @param {number} delta
 * @param {Object} inputState
 */
function _updateMovement(delta, inputState) {
    const { keys, mouse } = inputState;
    // Rotação Y pelo mouse — só com botão direito segurado (padrão MMORPG)
    if (mouse.buttons?.right) {
        if (_lastMouseX !== null) {
            const dx = mouse.x - _lastMouseX;
            if (dx !== 0) {
                _rotationY    -= dx * MOUSE_SENSITIVITY;
                _mesh.rotation.y = _rotationY;
            }
        }
        _lastMouseX = mouse.x;
    } else {
        _lastMouseX = null; // reseta quando solta o botão (evita salto na próxima vez)
    }

    // Movimento WASD orientado pela rotação do player
    let moveX = 0;
    let moveZ = 0;

    if (!_dialogOpen) {
        if (keys['KeyW']) moveZ -= 1;
        if (keys['KeyS']) moveZ += 1;
        if (keys['KeyA']) moveX -= 1;
        if (keys['KeyD']) moveX += 1;
    }

    if (moveX !== 0 || moveZ !== 0) {
        // Normaliza diagonal
        const len = Math.sqrt(moveX * moveX + moveZ * moveZ);
        moveX /= len;
        moveZ /= len;

        // Rotaciona direção pelo yaw do player
        const cos    = Math.cos(_rotationY);
        const sin    = Math.sin(_rotationY);
        const worldX = moveX * cos - moveZ * sin;
        const worldZ = moveX * sin + moveZ * cos;

        _mesh.position.x += worldX * MOVE_SPEED * delta;
        _mesh.position.z += worldZ * MOVE_SPEED * delta;
        _mesh.position.y  = getGroundHeight(_mesh.position.x, _mesh.position.z);
        _hasMoved         = true;
    }

    if (!_hasMoved && _prevPosition.distanceTo(_mesh.position) > 0.0001) {
        _hasMoved = true;
    }
}

/** Atualiza câmera orbit follow atrás do player. */
function _updateCamera() {
    const camera = getCamera();
    if (!camera) return;

    const cos = Math.cos(_rotationY);
    const sin = Math.sin(_rotationY);

// Escala proporcional baseada em _cameraDistance (zoom via wheel)
    const zoomScale = _cameraDistance / 8;
    const offsetX = (CAM_OFFSET.x * cos - CAM_OFFSET.z * sin) * zoomScale;
    const offsetZ = (CAM_OFFSET.x * sin + CAM_OFFSET.z * cos) * zoomScale;

    camera.position.set(
        _mesh.position.x + offsetX,
        _mesh.position.y + CAM_OFFSET.y * zoomScale,
        _mesh.position.z + offsetZ,
    );

    const lookTarget = _mesh.position.clone();
    lookTarget.y += 1.0;
    camera.lookAt(lookTarget);
}

/**
 * Monta PlayerData a partir do save ou com valores padrão.
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
function _calcMaxHp(job, level, stats) {
    const meta = getJobMeta(job);
    const jobModHP = meta?.jobModHP ?? 1.0;
    return Math.floor((35 + level * 8) * (1 + stats.vit / 100) * jobModHP);
}

/**
 * Calcula maxMp Ragnarok-style.
 * @param {string} job
 * @param {number} level
 * @param {{int:number}} stats
 * @returns {number}
 */
function _calcMaxMp(job, level, stats) {
    const meta = getJobMeta(job);
    const jobModMP = meta?.jobModMP ?? 1.0;
    return Math.floor((40 + level * 5) * (1 + stats.int / 100) * jobModMP);
}
function _buildData(saveData) {
    const job   = saveData?.class ?? 'swordman';
    const level = saveData?.level ?? 1;
    const stats = getBaseStats(job, level);

    return {
        type:          'player',
        name:          saveData?.name          ?? 'Hero',
        class:         job,
        level:         level,
        jobLevel:      saveData?.jobLevel      ?? 1,
        exp:           saveData?.exp           ?? 0,
        jobExp:        saveData?.jobExp        ?? 0,
        hp:            saveData?.hp            ?? _calcMaxHp(job, level, stats),
        maxHp:         saveData?.maxHp         ?? _calcMaxHp(job, level, stats),
        mp:            saveData?.mp            ?? _calcMaxMp(job, level, stats),
        maxMp:         saveData?.maxMp         ?? _calcMaxMp(job, level, stats),
        baseStats:     saveData?.baseStats     ?? stats,
        statPoints:    saveData?.statPoints    ?? 0,
        skillPoints:   saveData?.skillPoints   ?? 0,
        learnedSkills: saveData?.learnedSkills ?? [],
        position:      saveData?.position      ?? { x: 0, y: 0, z: 0 },
        currentMap:    saveData?.currentMap    ?? 'city01',

        playtime:      saveData?.playtime      ?? 0,
        equippedSkills: Array.isArray(saveData?.equippedSkills)
            ? saveData.equippedSkills
            : [null, null, null, null],
        jobHistory: Array.isArray(saveData?.jobHistory) ? saveData.jobHistory : [],
        jobChangeQuestsCompleted: Array.isArray(saveData?.jobChangeQuestsCompleted) ? saveData.jobChangeQuestsCompleted : [],
        cooldowns:     {}, // sempre zerado no boot — performance.now() reinicia em 0
        _activeBuffs:  [],
    };
    
}

/**
 * Recebe bônus de equipamento via bus (R8 — sem import de equipment.js).
 * @param {Object} _payload
 */
function _onItemEquipped(_payload) {
    // PROMPT 11: aplicar bônus de stats ao player
    console.log('[player] itemEquipped recebido — bônus aplicado no PROMPT 11');
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