/**
 * @module monsters
 * @description Gerencia catálogo, spawn, IA e respawn de monstros.
 * Cross-layer import justificado: entities→systems/combat (mesmo padrão do BUG-02 em player.js).
 * entities→world/scene: uso de named imports { add, remove } para manter scene desacoplada.
 */

import * as THREE from 'three';
import { add as sceneAdd, remove as sceneRemove } from '../world/scene.js';
import { on, emit } from '../core/events.js';
import {
  registerTarget,
  unregisterTarget,
  attack as combatAttack,
  canAttack
} from '../systems/combat.js';

// ─── Estado interno ───────────────────────────────────────────────────────────
/** @type {Map<string, Object>} id único → instância de monstro */
const _monsters = new Map();

/** @type {Object.<string, Object>} monsterId → dados do catálogo */
let _catalogue = {};

/** @type {number} contador para IDs únicos */
let _uidCounter = 0;

/** @type {boolean} */
let _initialized = false;
/** @type {Object.<string, Object>} Catálogo de items para cor dos drops */
let _itemCatalogue = {};

/** @type {Map<string, {itemId: string, qty: number, mesh: THREE.Mesh, spawnTime: number}>} */
const _drops = new Map();

/** Contador para IDs únicos de drops */
let _dropIdCounter = 0;

/** @type {{x:number, y:number, z:number}} Posição do player atualizada por updateAll */
let _playerPos = { x: 0, y: 0, z: 0 };
// ─── Init ─────────────────────────────────────────────────────────────────────

/**
 * Carrega monsters.json e registra listeners globais.
 * @returns {Promise<void>}
 */
async function init() {
  if (_initialized) return;

  const res = await fetch('assets/data/monsters.json');
  if (!res.ok) throw new Error(`[monsters] Falha ao carregar monsters.json: ${res.status}`);
  const data = await res.json();

  for (const m of data.monsters) {
    _catalogue[m.id] = m;
  }
// Carrega catálogo de items para cor dos drops e _rollDrops
  const itemsRes = await fetch('assets/data/items.json');
  if (!itemsRes.ok) throw new Error(`[monsters] Falha ao carregar items.json: ${itemsRes.status}`);
  const itemsData = await itemsRes.json();
  for (const item of itemsData.items) {
    _itemCatalogue[item.id] = item;
  }
  // Listener global: detecta morte de qualquer entidade registrada neste módulo
  on('entityDied', _onEntityDied);
  on('pickupRequest', _onPickupRequest);
  _initialized = true;
  console.log(`[monsters] Catálogo carregado: ${Object.keys(_catalogue).length} tipos.`);
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Cria e registra uma instância de monstro na cena e no combat.
 * @param {string} monsterId - ID do catálogo (ex: 'slime')
 * @param {{x: number, y: number, z: number}} position
 * @returns {Object} instância do monstro
 */
function spawnMonster(monsterId, position) {
  const def = _catalogue[monsterId];
  if (!def) {
    console.warn(`[monsters] monsterId desconhecido: ${monsterId}`);
    return null;
  }

  const uid = `monster_${monsterId}_${++_uidCounter}`;

  // Mesh placeholder
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshLambertMaterial({
    color: new THREE.Color(def.modelPlaceholder)
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(position.x, position.y ?? 0.5, position.z);
  mesh.castShadow = true;
  mesh.name = uid;

  sceneAdd(mesh);

  const instance = {
    // Identificação
    id: uid,
    monsterId,
    type: 'monster',              // filtro ui.js popup de dano

    // Visual
    mesh,

    // Atributos
    hp: def.hp,
    maxHp: def.hp,
    str: def.str,
    def: def.def,
    agi: def.agi,
    xp: def.xp,
    aggroRange: def.aggroRange,
    attackRange: def.attackRange,
    speed: def.speed,
    baseStats: { str: def.str, vit: def.def }, // compatibilidade combat.js

    // drops (reservado para sessão futura)
    drops: def.drops ?? [],

    // IA
    state: 'idle',
    _spawnPosition: new THREE.Vector3(position.x, position.y ?? 0.5, position.z),
    _idleTarget: null,
    _idleTimer: 0,
    _lastAttackTime: 0,
    _respawnTimeout: null,

    // posição como getter para compatibilidade com combat.js (usa .position)
    get position() { return this.mesh.position; }
  };

  _monsters.set(uid, instance);
  registerTarget(instance);

  emit('monsterSpawned', { id: uid, monsterId, position: { ...position } });
  return instance;
}

/**
 * Spawna count monstros do mesmo tipo dispersos em uma área circular.
 * @param {string} monsterId
 * @param {number} count
 * @param {{ center: {x: number, z: number}, radius: number }} area
 */
function spawnGroup(monsterId, count, area) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random() * area.radius;
    spawnMonster(monsterId, {
      x: area.center.x + Math.cos(angle) * r,
      y: 0.5,
      z: area.center.z + Math.sin(angle) * r
    });
  }
}

// ─── Loop de IA ───────────────────────────────────────────────────────────────

/**
 * Atualiza todos os monstros vivos. Chamar no game loop do main.js.
 * Máximo 1 cálculo de distância por monstro por frame (R6).
 * @param {number} dt - delta time em segundos
 * @param {THREE.Vector3} playerPosition
 */
function updateAll(dt, playerPosition) {
  _playerPos = playerPosition;
  for (const [, m] of _monsters) {
    if (m.state === 'dead') continue;
    _updateMonster(m, dt, playerPosition);
  }
  _updateDrops(dt, playerPosition);
}

/**
 * @param {Object} m - instância do monstro
 * @param {number} dt
 * @param {THREE.Vector3} playerPos
 */
function _updateMonster(m, dt, playerPos) {
  // 1 cálculo de distância por frame (R6)
  const distToPlayer = m.mesh.position.distanceTo(playerPos);

  switch (m.state) {
    case 'idle':
      _stateIdle(m, dt, distToPlayer);
      break;
    case 'aggro':
      _stateAggro(m, distToPlayer);
      break;
    case 'chase':
      _stateChase(m, dt, playerPos, distToPlayer);
      break;
    case 'attack':
      _stateAttack(m, dt, playerPos, distToPlayer);
      break;
  }
}

// ─── Estados ──────────────────────────────────────────────────────────────────

function _stateIdle(m, dt, distToPlayer) {
  // Verificar aggro antes de mover
  if (distToPlayer < m.aggroRange) {
    m.state = 'aggro';
    return;
  }

  m._idleTimer -= dt;

  if (m._idleTimer <= 0 || !m._idleTarget) {
    // Escolhe novo ponto aleatório a cada 2–4s
    m._idleTimer = 2 + Math.random() * 2;
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random() * 3;
    m._idleTarget = new THREE.Vector3(
      m._spawnPosition.x + Math.cos(angle) * r,
      m._spawnPosition.y,
      m._spawnPosition.z + Math.sin(angle) * r
    );
  }

  // Anda devagar até o ponto idle (metade da speed normal)
  const idleSpeed = m.speed * 0.4;
  _moveTowards(m, m._idleTarget, idleSpeed, dt);
}

function _stateAggro(m, distToPlayer) {
  // Gira para o player — chase imediato
  m.state = 'chase';
}

function _stateChase(m, dt, playerPos, distToPlayer) {
  if (distToPlayer < m.attackRange) {
    m.state = 'attack';
    return;
  }
  if (distToPlayer > m.aggroRange * 1.5) {
    m.state = 'idle';
    m._idleTimer = 0; // força novo ponto idle imediatamente
    return;
  }
  _moveTowards(m, playerPos, m.speed, dt);
}

function _stateAttack(m, dt, playerPos, distToPlayer) {
  if (distToPlayer > m.attackRange) {
    m.state = 'chase';
    return;
  }

  // Gira para o player durante o ataque
  _faceTarget(m, playerPos);

  // Ataque via combat.js (cooldown interno de combat: 1s)
  // Obtemos o player como alvo pelo proxy que combat.js já conhece
  // Nota: combat.attack requer objeto com interface { hp, def, type, position }
  // Player é obtido via evento para evitar import direto (R8)
  const now = performance.now() / 1000;
  if (now - m._lastAttackTime >= 1.0) {
    m._lastAttackTime = now;
    emit('monsterAttackRequest', { attacker: m });
  }
}

// ─── Helpers de movimento ─────────────────────────────────────────────────────

/**
 * Move o mesh do monstro em direção a um alvo com speed * dt.
 * @param {Object} m
 * @param {THREE.Vector3} target
 * @param {number} speed
 * @param {number} dt
 */
function _moveTowards(m, target, speed, dt) {
  const dir = new THREE.Vector3()
    .subVectors(target, m.mesh.position)
    .setY(0);

  const dist = dir.length();
  if (dist < 0.05) return;

  dir.normalize();
  m.mesh.position.addScaledVector(dir, Math.min(speed * dt, dist));
  _faceTarget(m, target);
}

/**
 * Rotaciona o monstro para olhar para um alvo no eixo Y.
 * @param {Object} m
 * @param {THREE.Vector3} target
 */
function _faceTarget(m, target) {
  const dx = target.x - m.mesh.position.x;
  const dz = target.z - m.mesh.position.z;
  if (Math.abs(dx) < 0.001 && Math.abs(dz) < 0.001) return;
  m.mesh.rotation.y = Math.atan2(dx, dz);
}

// ─── Morte e Respawn ──────────────────────────────────────────────────────────

/**
 * Listener do event bus: trata morte de entidades deste módulo.
 * @param {{ entity: Object }} payload
 */
function _onEntityDied({ entity }) {
  if (!_monsters.has(entity.id)) return;

  const m = _monsters.get(entity.id);
  if (m.state === 'dead') return; // evitar duplo trigger

  m.state = 'dead';
  m.hp = 0;
  m.mesh.visible = false;
// Rolar drops do monstro morto
  const def = _catalogue[m.monsterId];
  _rollDrops(def, m.mesh.position);
  unregisterTarget(m);

  emit('monsterDied', { id: m.id, monsterId: m.monsterId, xp: m.xp });

  // Respawn após 30s
  // Cleanup: guardar referência do timeout (clearTimeout disponível se módulo for desmontado futuramente)
  m._respawnTimeout = setTimeout(() => {
    _respawn(m);
  }, 30_000);
}

/**
 * Restaura monstro morto à posição de spawn.
 * @param {Object} m
 */
function _respawn(m) {
  m.hp = m.maxHp;
  m.mesh.position.copy(m._spawnPosition);
  m.mesh.visible = true;
  m.state = 'idle';
  m._idleTimer = 0;
  m._idleTarget = null;
  m._lastAttackTime = 0;
  m._respawnTimeout = null;

  registerTarget(m);

  emit('monsterSpawned', { id: m.id, monsterId: m.monsterId, position: {
    x: m._spawnPosition.x,
    y: m._spawnPosition.y,
    z: m._spawnPosition.z
  }});
}

// ─── Exports públicos ─────────────────────────────────────────────────────────
// ─── Drops ────────────────────────────────────────────────────────────────────

/**
 * Rola drops de um monstro morto e cria meshes flutuantes na cena.
 * @param {Object} def - Definição do monstro (com def.drops)
 * @param {THREE.Vector3} position - Posição da morte
 */
function _rollDrops(def, position) {
  if (!def || !Array.isArray(def.drops)) return;

  for (const drop of def.drops) {
    if (Math.random() >= drop.chance) continue;

    let qty = 1;
    if (drop.qty && typeof drop.qty === 'object') {
      qty = Math.floor(Math.random() * (drop.qty.max - drop.qty.min + 1)) + drop.qty.min;
    } else if (typeof drop.qty === 'number') {
      qty = drop.qty;
    }

    const itemColor = _itemCatalogue[drop.itemId]?.modelPlaceholder ?? '#ffffff';

    const geometry = new THREE.BoxGeometry(0.3, 0.3, 0.3);
    const material = new THREE.MeshLambertMaterial({ color: itemColor });
    const mesh = new THREE.Mesh(geometry, material);

    mesh.position.set(
      position.x + (Math.random() - 0.5) * 0.6,
      position.y + 0.3,
      position.z + (Math.random() - 0.5) * 0.6
    );
    mesh.castShadow = false;

    sceneAdd(mesh);

    const dropId = `drop_${_dropIdCounter++}`;
    _drops.set(dropId, {
      itemId: drop.itemId,
      qty,
      mesh,
      spawnTime: performance.now()
    });

    emit('itemDropped', { itemId: drop.itemId, qty, position: mesh.position, dropId });
  }
}

/**
 * Remove drop do mundo: dispose geometry/material e remove da cena.
 * @param {string} dropId
 */
function _removeDrop(dropId) {
  const drop = _drops.get(dropId);
  if (!drop) return;
  drop.mesh.geometry.dispose();
  drop.mesh.material.dispose();
  sceneRemove(drop.mesh);
  _drops.delete(dropId);
}

/**
 * Atualiza animação flutuante e auto-pickup de todos os drops.
 * @param {number} dt
 * @param {THREE.Vector3} playerPos
 */
function _updateDrops(dt, playerPos) {
  const now = performance.now();

  for (const [dropId, drop] of _drops) {
    drop.mesh.position.y = 0.3 + Math.sin(now * 0.002 + drop.mesh.position.x) * 0.08;
    drop.mesh.rotation.y += dt * 1.5;

    if ((now - drop.spawnTime) < 500) continue;

    const dx = drop.mesh.position.x - playerPos.x;
    const dz = drop.mesh.position.z - playerPos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < 1.5) {
      emit('itemPicked', { itemId: drop.itemId, qty: drop.qty, dropId });
      _removeDrop(dropId);
    }
  }
}

/**
 * Pickup manual: localiza drop mais próximo no raio e coleta.
 * @param {{ position: {x:number,y:number,z:number} }} payload
 */
function _onPickupRequest({ position }) {
  let nearestId = null;
  let nearestDist = Infinity;

  for (const [dropId, drop] of _drops) {
    const dx = drop.mesh.position.x - position.x;
    const dz = drop.mesh.position.z - position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 1.5 && dist < nearestDist) {
      nearestDist = dist;
      nearestId = dropId;
    }
  }

  if (nearestId) {
    const drop = _drops.get(nearestId);
    emit('itemPicked', { itemId: drop.itemId, qty: drop.qty, dropId: nearestId });
    _removeDrop(nearestId);
  }
}
export { init, spawnMonster, spawnGroup, updateAll };