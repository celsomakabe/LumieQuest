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
import { getBaseStats }             from '../Systems/classes.js';

// ─── Constantes ───────────────────────────────────────────────────────────────

const MOVE_SPEED        = 5;
const MOUSE_SENSITIVITY = 0.003;
const CAM_OFFSET        = new THREE.Vector3(0, 5, 8);

// ─── Estado interno ───────────────────────────────────────────────────────────

/** @type {THREE.Mesh|null} */
let _mesh = null;
let _isDead = false;
/** @type {Object|null} */
let _data = null;

let _rotationY   = 0;
let _lastMouseX  = null; // null = primeiro frame, evita salto de rotação
let _hasMoved    = false;

const _prevPosition = new THREE.Vector3();

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Inicializa o player com dados do save ou defaults.
 * @param {Object|null} [saveData]
 * @returns {void}
 */
export function init(saveData = null) {
    _data = _buildData(saveData);

    const geometry = new THREE.CapsuleGeometry(0.5, 1.5, 8, 16);
    const material = new THREE.MeshStandardMaterial({ color: 0x4488ff });
    _mesh          = new THREE.Mesh(geometry, material);
    _mesh.castShadow = true;

    _mesh.position.set(_data.position.x, _data.position.y, _data.position.z);
    _prevPosition.copy(_mesh.position);

    add(_mesh);

    // Bônus de equipamento via bus — sem import direto de equipment.js (R8)
    on('itemEquipped', _onItemEquipped);

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
  _playerState.hp = Math.max(0, _playerState.hp - amount);
  emit('playerHpChanged', { current: _playerState.hp, max: _playerState.maxHp });
  if (_playerState.hp <= 0) {
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
 * Adiciona XP e verifica level up. Fórmula: 100 * level².
 * @param {number} amount
 * @returns {void}
 */
export function addExp(amount) {
    if (!_data) return;
    _data.exp += amount;
    const xpNeeded = 100 * (_data.level * _data.level);
    if (_data.exp >= xpNeeded) {
        _data.exp   -= xpNeeded;
        _data.level += 1;
        _data.baseStats = getBaseStats(_data.class, _data.level);
        _data.maxHp     = 100 + (_data.baseStats.vit * 5);
        _data.maxMp     = 50  + (_data.baseStats.int * 3);
        _data.hp        = _data.maxHp;
        _data.mp        = _data.maxMp;
        emit('levelUp', { newLevel: _data.level });
        console.log(`[player] Level up! Nível ${_data.level}`);
    }
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

    _prevPosition.copy(_mesh.position);
    _hasMoved = false;

    _updateMovement(delta, inputState);
    _updateCamera();

    if (_hasMoved) {
        _data.position.x = _mesh.position.x;
        _data.position.y = _mesh.position.y;
        _data.position.z = _mesh.position.z;
        emit('playerMoved', {
            position: _mesh.position.clone(),
            mapId:    _data.currentMap,
        });
    }
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

    // Rotação Y pelo mouse (delta calculado localmente)
    if (_lastMouseX !== null) {
        const dx = mouse.x - _lastMouseX;
        if (dx !== 0) {
            _rotationY    -= dx * MOUSE_SENSITIVITY;
            _mesh.rotation.y = _rotationY;
        }
    }
    _lastMouseX = mouse.x;

    // Movimento WASD orientado pela rotação do player
    let moveX = 0;
    let moveZ = 0;

    if (keys['KeyW']) moveZ -= 1;
    if (keys['KeyS']) moveZ += 1;
    if (keys['KeyA']) moveX -= 1;
    if (keys['KeyD']) moveX += 1;

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

    const offsetX = CAM_OFFSET.x * cos - CAM_OFFSET.z * sin;
    const offsetZ = CAM_OFFSET.x * sin + CAM_OFFSET.z * cos;

    camera.position.set(
        _mesh.position.x + offsetX,
        _mesh.position.y + CAM_OFFSET.y,
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
function _buildData(saveData) {
    const job   = saveData?.class ?? 'swordman';
    const level = saveData?.level ?? 1;
    const stats = getBaseStats(job, level);

    return {
        name:          saveData?.name          ?? 'Hero',
        class:         job,
        level:         level,
        jobLevel:      saveData?.jobLevel      ?? 1,
        exp:           saveData?.exp           ?? 0,
        jobExp:        saveData?.jobExp        ?? 0,
        hp:            saveData?.hp            ?? (100 + stats.vit * 5),
        maxHp:         saveData?.maxHp         ?? (100 + stats.vit * 5),
        mp:            saveData?.mp            ?? (50  + stats.int * 3),
        maxMp:         saveData?.maxMp         ?? (50  + stats.int * 3),
        baseStats:     saveData?.baseStats     ?? stats,
        statPoints:    saveData?.statPoints    ?? 0,
        skillPoints:   saveData?.skillPoints   ?? 0,
        learnedSkills: saveData?.learnedSkills ?? [],
        position:      saveData?.position      ?? { x: 0, y: 0, z: 0 },
        currentMap:    saveData?.currentMap    ?? 'city01',
        zeny:          saveData?.zeny          ?? 0,
        playtime:      saveData?.playtime      ?? 0,
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