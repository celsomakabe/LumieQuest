/**
 * @module monsters
 * @description Gerencia catálogo, spawn, IA e respawn de monstros.
 * Sessão 17 — PROMPT 12 Parte 2:
 *   - 4 bosses gated: só spawnam via questBossSpawnRequest (quests.js Parte 3)
 *   - spawnQuestBoss(bossId, questId) e despawnQuestBoss(bossId): exports públicos
 *   - Geometria diferenciada por boss + anel dourado
 *   - Fases de boss: 100%/50%/25% HP com gatilhos específicos por tipo
 *   - Telegrafía visual AoE: scale 1.3x + cor vermelha por 2s antes do dano
 *   - _stateAttack: _attackCounter % 2 alterna normal/ability
 *   - combat.js update() precisa de patch para deadly_poison/abyss_poison (ver R10)
 * Cross-layer imports justificados:
 *   entities→systems/combat (BUG-02 deferido),
 *   entities→world/scene: named imports { add, remove }.
 */

import * as THREE from 'three';
import { add as sceneAdd, remove as sceneRemove } from '../world/scene.js';
import { on, emit } from '../core/events.js';
import {
    registerTarget,
    unregisterTarget,
} from '../systems/combat.js';

// ─── Estado interno ───────────────────────────────────────────────────────────

/** @type {Map<string, Object>} instanceId → instância */
const _monsters = new Map();

/** @type {Object.<string, Object>} monsterId → def do catálogo */
let _catalogue = {};

/** @type {number} */
let _uidCounter = 0;

/** @type {boolean} */
let _initialized = false;

/** @type {Object.<string, Object>} itemId → def para cor de drops */
let _itemCatalogue = {};

/** @type {Map<string, {itemId,qty,mesh,spawnTime}>} */
const _drops = new Map();

/** @type {number} */
let _dropIdCounter = 0;

/** @type {{x,y,z}} posição do player — atualizada em updateAll */
let _playerPos = { x: 0, y: 0, z: 0 };

// ─── Init ─────────────────────────────────────────────────────────────────────

/**
 * Carrega monsters.json + items.json e registra listeners.
 * @returns {Promise<void>}
 */
async function init() {
    if (_initialized) return;

    const res = await fetch('assets/data/monsters.json');
    if (!res.ok) throw new Error(`[monsters] Falha monsters.json: ${res.status}`);
    const data = await res.json();
    for (const m of data.monsters) _catalogue[m.id] = m;

    const itemsRes = await fetch('assets/data/items.json');
    if (!itemsRes.ok) throw new Error(`[monsters] Falha items.json: ${itemsRes.status}`);
    const itemsData = await itemsRes.json();
    for (const item of itemsData.items) _itemCatalogue[item.id] = item;

    on('entityDied',              _onEntityDied);
    on('pickupRequest',           _onPickupRequest);
    on('questBossSpawnRequest',   _onQuestBossSpawnRequest);
    on('questBossDespawnRequest', _onQuestBossDespawnRequest);

    _initialized = true;
    console.log(`[monsters] Catálogo: ${Object.keys(_catalogue).length} tipos.`);
}

// ─── Geometria por tipo de boss ───────────────────────────────────────────────

/**
 * Cria geometry + material correto para o bossId dado.
 * Monstros normais usam BoxGeometry padrão.
 * @param {Object} def
 * @returns {{ geometry: THREE.BufferGeometry, material: THREE.Material }}
 */
function _createBossMesh(def) {
    let geometry;
    switch (def.id) {
        case 'boss_lord_knight':
            geometry = new THREE.OctahedronGeometry(1.2);
            break;
        case 'boss_high_wizard':
            geometry = new THREE.IcosahedronGeometry(1.0);
            break;
        case 'boss_sniper':
            geometry = new THREE.ConeGeometry(0.8, 2.0, 8);
            break;
        case 'boss_shadow_assassin':
            geometry = new THREE.DodecahedronGeometry(1.0);
            break;
        default:
            geometry = new THREE.BoxGeometry(1, 1, 1);
    }
    const material = new THREE.MeshLambertMaterial({
        color:             new THREE.Color(def.modelPlaceholder),
        emissive:          new THREE.Color(def.modelPlaceholder),
        emissiveIntensity: 0.3,
    });
    return { geometry, material };
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Cria e registra uma instância de monstro na cena e no combat.
 * @param {string} monsterId
 * @param {{x,y,z}} position
 * @param {string|null} [linkedQuestId=null]
 * @returns {Object|null}
 */
function spawnMonster(monsterId, position, linkedQuestId = null) {
    const def = _catalogue[monsterId];
    if (!def) {
        console.warn(`[monsters] monsterId desconhecido: ${monsterId}`);
        return null;
    }

    const uid = `monster_${monsterId}_${++_uidCounter}`;

    let mesh;
    if (def.isBoss) {
        const { geometry, material } = _createBossMesh(def);
        mesh = new THREE.Mesh(geometry, material);
    } else {
        mesh = new THREE.Mesh(
            new THREE.BoxGeometry(1, 1, 1),
            new THREE.MeshLambertMaterial({ color: new THREE.Color(def.modelPlaceholder) }),
        );
    }

    mesh.position.set(position.x, position.y ?? 0.5, position.z);
    mesh.castShadow = true;
    mesh.name = uid;

    // Anel dourado para todos os bosses
    if (def.isBoss) {
        const ring = new THREE.Mesh(
            new THREE.RingGeometry(0.7, 1.0, 24),
            new THREE.MeshLambertMaterial({ color: 0xffcc00, side: THREE.DoubleSide }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = -0.6;
        mesh.add(ring);
    }

    sceneAdd(mesh);

    const instance = {
        id:         uid,
        monsterId,
        type:       'monster',
        isBoss:     def.isBoss ?? false,
        linkedQuestId,

        mesh,

        hp:          def.hp,
        maxHp:       def.hp,
        str:         def.str,
        def:         def.def,
        agi:         def.agi,
        xp:          def.xp,
        aggroRange:  def.aggroRange,
        attackRange: def.attackRange,
        speed:       def.speed,
        baseStats:   { str: def.str, vit: def.def },

        drops:     def.drops     ?? [],
        abilities: def.abilities ?? [],

        // IA
        state:           'idle',
        _spawnPosition:  new THREE.Vector3(position.x, position.y ?? 0.5, position.z),
        _idleTarget:     null,
        _idleTimer:      0,
        _lastAttackTime: 0,
        _attackCounter:  0,

        // Fases (flags para disparar apenas uma vez)
        _phase50Done: false,
        _phase25Done: false,

        // Estado de telegrafía / habilidades especiais
        _telegraphing:       false,
        _telegraphTimer:     0,
        _pendingAoe:         false,
        _invisible:          false,
        _reflectShield:      false,
        _reflectExpires:     0,
        _clonesMeshes:       [],

        // Debuffs ativos (DoT de boss sobre o player são emitidos via evento)
        _activeDebuffs: [],

        get position() { return this.mesh.position; },
    };

    _monsters.set(uid, instance);
    registerTarget(instance);

    emit('monsterSpawned', { id: uid, monsterId, position: { ...position } });
    return instance;
}

/**
 * Spawna count monstros do mesmo tipo em área circular.
 * @param {string} monsterId
 * @param {number} count
 * @param {{ center:{x,z}, radius:number }} area
 */
function spawnGroup(monsterId, count, area) {
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const r     = Math.random() * area.radius;
        spawnMonster(monsterId, {
            x: area.center.x + Math.cos(angle) * r,
            y: 0.5,
            z: area.center.z + Math.sin(angle) * r,
        });
    }
}

/**
 * Spawna um boss vinculado a uma quest. Chamado via event bus questBossSpawnRequest.
 * @param {string} bossId
 * @param {string} questId
 * @param {{x,y,z}} position
 * @returns {Object|null}
 */
function spawnQuestBoss(bossId, questId, position) {
    // Evitar spawn duplicado do mesmo boss para a mesma quest
    for (const [, m] of _monsters) {
        if (m.monsterId === bossId && m.linkedQuestId === questId && m.state !== 'dead') {
            console.warn(`[monsters] Boss ${bossId} já ativo para quest ${questId}.`);
            return null;
        }
    }
    const instance = spawnMonster(bossId, position, questId);
    if (instance) {
        emit('uiHintShow', {
            msg: `Boss apareceu: ${_catalogue[bossId]?.name ?? bossId}!`,
            duration: 4000,
        });
    }
    return instance;
}

/**
 * Remove um boss da cena ao abandonar/completar a quest.
 * @param {string} bossId
 */
function despawnQuestBoss(bossId) {
    for (const [uid, m] of _monsters) {
        if (m.monsterId === bossId && m.isBoss) {
            _cleanupBoss(m);
            unregisterTarget(m);
            sceneRemove(m.mesh);
            _monsters.delete(uid);
            console.log(`[monsters] Boss ${bossId} despawnado.`);
            return;
        }
    }
}

/**
 * Retorna cópia readonly do catálogo.
 * @returns {Object.<string, Object>}
 */
function getCatalog() {
    return { ..._catalogue };
}

// ─── Listeners de eventos de boss ─────────────────────────────────────────────

/** @param {{ bossId:string, questId:string, position:{x,y,z} }} payload */
function _onQuestBossSpawnRequest({ bossId, questId, position }) {
    spawnQuestBoss(bossId, questId, position ?? { x: 0, y: 0.5, z: 0 });
}

/** @param {{ bossId:string }} payload */
function _onQuestBossDespawnRequest({ bossId }) {
    despawnQuestBoss(bossId);
}

// ─── Loop de IA ───────────────────────────────────────────────────────────────

/**
 * Atualiza todos os monstros vivos. Chamado no game loop.
 * @param {number} dt - delta em segundos
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

/** @param {Object} m @param {number} dt @param {THREE.Vector3} playerPos */
function _updateMonster(m, dt, playerPos) {
    // Telegrafía: conta down antes do AoE
    if (m._telegraphing) {
        m._telegraphTimer -= dt;
        if (m._telegraphTimer <= 0) {
            m._telegraphing = false;
            m.mesh.scale.set(1, 1, 1);
            m.mesh.material.color.set(new THREE.Color(
                _catalogue[m.monsterId]?.modelPlaceholder ?? '#ffffff'
            ));
            if (m._pendingAoe) {
                m._pendingAoe = false;
                _executeBossAoe(m, playerPos);
            }
        }
        return; // congela IA durante telegrafía
    }

    // Checar fases por HP
    if (m.isBoss) _checkBossPhases(m);

    const dist = m.mesh.position.distanceTo(playerPos);
    switch (m.state) {
        case 'idle':   _stateIdle(m, dt, dist);              break;
        case 'aggro':  m.state = 'chase';                    break;
        case 'chase':  _stateChase(m, dt, playerPos, dist);  break;
        case 'attack': _stateAttack(m, dt, playerPos, dist); break;
    }
}

// ─── Fases de boss ────────────────────────────────────────────────────────────

/** @param {Object} m */
function _checkBossPhases(m) {
    const pct = m.hp / m.maxHp;

    if (!m._phase50Done && pct <= 0.5) {
        m._phase50Done = true;
        _triggerPhase50(m);
    }
    if (!m._phase25Done && pct <= 0.25) {
        m._phase25Done = true;
        _triggerPhase25(m);
    }
}

/** @param {Object} m */
function _triggerPhase50(m) {
    emit('uiHintShow', { msg: `${_catalogue[m.monsterId].name}: FASE 2!`, duration: 3000 });

    switch (m.monsterId) {
        case 'boss_lord_knight':
            // Summon 2 adds (goblins) próximos ao boss
            for (let i = 0; i < 2; i++) {
                const angle = (i / 2) * Math.PI * 2;
                spawnMonster('goblin', {
                    x: m.mesh.position.x + Math.cos(angle) * 2,
                    y: 0.5,
                    z: m.mesh.position.z + Math.sin(angle) * 2,
                });
            }
            break;

        case 'boss_high_wizard':
            // Ativa escudo refletivo 5s
            m._reflectShield  = true;
            m._reflectExpires = performance.now() + 5000;
            m.mesh.material.emissiveIntensity = 0.8;
            emit('buffApplied', {
                buffId:   'reflectShield',
                casterId: m.monsterId,
                expiresAt: m._reflectExpires,
            });
            setTimeout(() => {
                if (m.state !== 'dead') {
                    m._reflectShield = false;
                    m.mesh.material.emissiveIntensity = 0.3;
                }
            }, 5000);
            break;

        case 'boss_sniper':
            // Invisibilidade 3s (opacity 0.2)
            m._invisible = true;
            m.mesh.material.transparent = true;
            m.mesh.material.opacity     = 0.2;
            setTimeout(() => {
                if (m.state !== 'dead') {
                    m._invisible = false;
                    m.mesh.material.opacity = 1.0;
                }
            }, 3000);
            break;

        case 'boss_shadow_assassin':
            // Spawna 2 clones visuais (sem dano, sem registerTarget)
            _spawnShadowClones(m);
            break;
    }
}

/** @param {Object} m */
function _triggerPhase25(m) {
    emit('uiHintShow', { msg: `${_catalogue[m.monsterId].name}: FASE FINAL!`, duration: 3000 });

    switch (m.monsterId) {
        case 'boss_lord_knight':
            // Força AoE telegrafado imediato
            _startTelegraph(m);
            break;

        case 'boss_high_wizard':
            // Segundo teleport strike
            _bossTeleportStrike(m);
            break;

        case 'boss_sniper':
            // Multishot: forçar 3 ataques rápidos via flag
            m._multishotPending = 3;
            break;

        case 'boss_shadow_assassin':
            // Abyss poison ativo direto no player via evento
            emit('bossAbyssPoison', {
                bossId:        m.monsterId,
                damagePerTick: 50,
                duration:      10000,
            });
            break;
    }
}

// ─── Habilidades específicas de boss ──────────────────────────────────────────

/**
 * Inicia telegrafía visual 2s antes do AoE do boss_lord_knight.
 * @param {Object} m
 */
function _startTelegraph(m) {
    if (m._telegraphing) return;
    m._telegraphing   = true;
    m._telegraphTimer = 2.0;
    m._pendingAoe     = true;
    m.mesh.scale.set(1.3, 1.3, 1.3);
    m.mesh.material.color.set(0xff2200);
    emit('uiHintShow', { msg: '⚠ AoE se aproxima! Saia do raio!', duration: 2000 });
}

/**
 * Executa o dano AoE do boss_lord_knight após telegrafía.
 * @param {Object} m @param {THREE.Vector3} playerPos
 */
function _executeBossAoe(m, playerPos) {
    const AOE_RADIUS = 3.5;
    const dx = playerPos.x - m.mesh.position.x;
    const dz = playerPos.z - m.mesh.position.z;
    if (Math.sqrt(dx * dx + dz * dz) <= AOE_RADIUS) {
        const dmg = Math.floor(m.str * 2.5);
        emit('monsterAttackRequest', { attacker: m, ability: 'aoeWindup', damage: dmg });
    }
}

/**
 * Teleport strike do boss_high_wizard: teletransporta ao lado do player e ataca.
 * @param {Object} m
 */
function _bossTeleportStrike(m) {
    // Teleport
    const angle = Math.random() * Math.PI * 2;
    m.mesh.position.x = _playerPos.x + Math.cos(angle) * 1.5;
    m.mesh.position.z = _playerPos.z + Math.sin(angle) * 1.5;

    // Ataque imediato após teleporte
    setTimeout(() => {
        if (m.state !== 'dead') {
            const dmg = Math.floor(m.str * 2.0);
            emit('monsterAttackRequest', { attacker: m, ability: 'teleportStrike', damage: dmg });
        }
    }, 200);
}

/**
 * Spawna 2 clones visuais do boss_shadow_assassin (sem dano).
 * @param {Object} m
 */
function _spawnShadowClones(m) {
    for (let i = 0; i < 2; i++) {
        const angle  = (i / 2) * Math.PI * 2;
        const cloneGeo = new THREE.DodecahedronGeometry(0.8);
        const cloneMat = new THREE.MeshLambertMaterial({
            color:       new THREE.Color(_catalogue[m.monsterId]?.modelPlaceholder ?? '#330033'),
            transparent: true,
            opacity:     0.5,
        });
        const clone = new THREE.Mesh(cloneGeo, cloneMat);
        clone.position.set(
            m.mesh.position.x + Math.cos(angle) * 2,
            0.5,
            m.mesh.position.z + Math.sin(angle) * 2,
        );
        sceneAdd(clone);
        m._clonesMeshes.push(clone);
    }
}

/**
 * Remove clones e anel ao desaparecer o boss.
 * @param {Object} m
 */
function _cleanupBoss(m) {
    for (const clone of m._clonesMeshes) {
        clone.geometry.dispose();
        clone.material.dispose();
        sceneRemove(clone);
    }
    m._clonesMeshes = [];
}

// ─── Estados de IA ────────────────────────────────────────────────────────────

function _stateIdle(m, dt, distToPlayer) {
    if (distToPlayer < m.aggroRange) { m.state = 'aggro'; return; }
    m._idleTimer -= dt;
    if (m._idleTimer <= 0 || !m._idleTarget) {
        m._idleTimer = 2 + Math.random() * 2;
        const angle  = Math.random() * Math.PI * 2;
        const r      = Math.random() * 3;
        m._idleTarget = new THREE.Vector3(
            m._spawnPosition.x + Math.cos(angle) * r,
            m._spawnPosition.y,
            m._spawnPosition.z + Math.sin(angle) * r,
        );
    }
    _moveTowards(m, m._idleTarget, m.speed * 0.4, dt);
}

function _stateChase(m, dt, playerPos, dist) {
    if (dist < m.attackRange) { m.state = 'attack'; return; }
    if (dist > m.aggroRange * 1.5) { m.state = 'idle'; m._idleTimer = 0; return; }

    // boss_sniper fica parado atirando à distância se dentro do attackRange estendido
    if (m.monsterId === 'boss_sniper' && dist <= m.attackRange) {
        m.state = 'attack';
        return;
    }
    _moveTowards(m, playerPos, m.speed, dt);
}

function _stateAttack(m, dt, playerPos, dist) {
    if (dist > m.attackRange) { m.state = 'chase'; return; }
    _faceTarget(m, playerPos);

    const cooldown = m.isBoss ? 1.5 : 1.0;
    const now      = performance.now() / 1000;
    if (now - m._lastAttackTime < cooldown) return;
    m._lastAttackTime = now;

    // Multishot pendente para boss_sniper fase 25%
    if (m._multishotPending && m._multishotPending > 0) {
        m._multishotPending--;
        const dmg = Math.floor(m.str * 1.2);
        emit('monsterAttackRequest', { attacker: m, ability: 'multishot', damage: dmg });
        return;
    }

    if (!m.isBoss || m.abilities.length === 0) {
        // Ataque normal
        emit('monsterAttackRequest', { attacker: m, ability: null, damage: null });
        return;
    }

    // Alternância: contador par → ability, ímpar → ataque normal
    m._attackCounter++;
    if (m._attackCounter % 2 === 0) {
        const ability = m.abilities[Math.floor(m._attackCounter / 2) % m.abilities.length];
        _executeBossAbility(m, ability, playerPos);
    } else {
        emit('monsterAttackRequest', { attacker: m, ability: null, damage: null });
    }
}

/**
 * Despacha lógica de ability específica do boss.
 * @param {Object} m @param {string} ability @param {THREE.Vector3} playerPos
 */
function _executeBossAbility(m, ability, playerPos) {
    switch (ability) {
        case 'aoeWindup':
            _startTelegraph(m);
            break;

        case 'summonAdds':
            if (!m._phase50Done) break; // só após fase 50%
            spawnMonster('goblin', {
                x: m.mesh.position.x + (Math.random() - 0.5) * 3,
                y: 0.5,
                z: m.mesh.position.z + (Math.random() - 0.5) * 3,
            });
            break;

        case 'teleportStrike':
            _bossTeleportStrike(m);
            break;

        case 'reflectShield':
            if (!m._reflectShield) {
                m._reflectShield  = true;
                m._reflectExpires = performance.now() + 5000;
                m.mesh.material.emissiveIntensity = 0.8;
                emit('buffApplied', {
                    buffId:    'reflectShield',
                    casterId:  m.monsterId,
                    expiresAt: m._reflectExpires,
                });
                setTimeout(() => {
                    if (m.state !== 'dead') {
                        m._reflectShield = false;
                        m.mesh.material.emissiveIntensity = 0.3;
                    }
                }, 5000);
            }
            break;

        case 'invisibility':
            if (!m._invisible) {
                m._invisible = true;
                m.mesh.material.transparent = true;
                m.mesh.material.opacity     = 0.2;
                setTimeout(() => {
                    if (m.state !== 'dead') {
                        m._invisible = false;
                        m.mesh.material.opacity = 1.0;
                    }
                }, 3000);
            }
            break;

        case 'multishot': {
            const dmg = Math.floor(m.str * 1.2);
            emit('monsterAttackRequest', { attacker: m, ability: 'multishot', damage: dmg });
            break;
        }

        case 'stealthStrikeFirst': {
            const dmg = Math.floor(m.str * 3.0);
            emit('monsterAttackRequest', { attacker: m, ability: 'stealthStrikeFirst', damage: dmg });
            break;
        }

        case 'spawnClones':
            if (m._clonesMeshes.length === 0) _spawnShadowClones(m);
            break;

        case 'abyssPoison':
            emit('monsterAttackRequest', { attacker: m, ability: 'abyssPoison', damage: 50 });
            break;

        default:
            emit('monsterAttackRequest', { attacker: m, ability, damage: null });
    }
}

// ─── Helpers de movimento ─────────────────────────────────────────────────────

/** @param {Object} m @param {THREE.Vector3} target @param {number} speed @param {number} dt */
function _moveTowards(m, target, speed, dt) {
    const dir  = new THREE.Vector3().subVectors(target, m.mesh.position).setY(0);
    const dist = dir.length();
    if (dist < 0.05) return;
    dir.normalize();
    m.mesh.position.addScaledVector(dir, Math.min(speed * dt, dist));
    _faceTarget(m, target);
}

/** @param {Object} m @param {THREE.Vector3} target */
function _faceTarget(m, target) {
    const dx = target.x - m.mesh.position.x;
    const dz = target.z - m.mesh.position.z;
    if (Math.abs(dx) < 0.001 && Math.abs(dz) < 0.001) return;
    m.mesh.rotation.y = Math.atan2(dx, dz);
}

// ─── Morte ────────────────────────────────────────────────────────────────────

/** @param {{ entity:Object }} payload */
function _onEntityDied({ entity }) {
    if (!_monsters.has(entity.id)) return;
    const m = _monsters.get(entity.id);
    if (m.state === 'dead') return;

    m.state = 'dead';
    m.hp    = 0;
    m.mesh.visible = false;

    if (m.isBoss) _cleanupBoss(m);

    const def = _catalogue[m.monsterId];
    _rollDrops(def, m.mesh.position);
    unregisterTarget(m);

    emit('monsterDied', {
        id:       m.id,
        monsterId: m.monsterId,
        xp:       m.xp,
        isBoss:   m.isBoss,
        linkedQuestId: m.linkedQuestId,
    });

    if (m.isBoss) {
        emit('uiHintShow', {
            msg:      `Boss derrotado: ${def.name}! +${m.xp} XP`,
            duration: 5000,
        });
        // Boss de quest não ressuscita — quest fica como completada
        // Despawn já foi tratado pelo linkedQuestId no payload acima (quests.js Parte 3)
    } else {
        // Monstros normais: respawn após 30s
        m._respawnTimeout = setTimeout(() => _respawn(m), 30_000);
    }
}

/** @param {Object} m */
function _respawn(m) {
    m.hp = m.maxHp;
    m.mesh.position.copy(m._spawnPosition);
    m.mesh.visible      = true;
    m.state             = 'idle';
    m._idleTimer        = 0;
    m._idleTarget       = null;
    m._lastAttackTime   = 0;
    m._attackCounter    = 0;
    m._phase50Done      = false;
    m._phase25Done      = false;
    m._telegraphing     = false;
    m._pendingAoe       = false;
    m._reflectShield    = false;
    m._invisible        = false;
    m._multishotPending = 0;
    m._respawnTimeout   = null;

    registerTarget(m);
    emit('monsterSpawned', {
        id:       m.id,
        monsterId: m.monsterId,
        position: { x: m._spawnPosition.x, y: m._spawnPosition.y, z: m._spawnPosition.z },
    });
}

// ─── Drops ────────────────────────────────────────────────────────────────────

/** @param {Object} def @param {THREE.Vector3} position */
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
        const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(0.3, 0.3, 0.3),
            new THREE.MeshLambertMaterial({ color: itemColor }),
        );
        mesh.position.set(
            position.x + (Math.random() - 0.5) * 0.6,
            position.y + 0.3,
            position.z + (Math.random() - 0.5) * 0.6,
        );
        mesh.castShadow = false;
        sceneAdd(mesh);
        const dropId = `drop_${_dropIdCounter++}`;
        _drops.set(dropId, { itemId: drop.itemId, qty, mesh, spawnTime: performance.now() });
        emit('itemDropped', { itemId: drop.itemId, qty, position: mesh.position, dropId });
    }
}

/** @param {string} dropId */
function _removeDrop(dropId) {
    const drop = _drops.get(dropId);
    if (!drop) return;
    drop.mesh.geometry.dispose();
    drop.mesh.material.dispose();
    sceneRemove(drop.mesh);
    _drops.delete(dropId);
}

/** @param {number} dt @param {THREE.Vector3} playerPos */
function _updateDrops(dt, playerPos) {
    const now = performance.now();
    for (const [dropId, drop] of _drops) {
        drop.mesh.position.y  = 0.3 + Math.sin(now * 0.002 + drop.mesh.position.x) * 0.08;
        drop.mesh.rotation.y += dt * 1.5;
        if ((now - drop.spawnTime) < 500) continue;
        const dx = drop.mesh.position.x - playerPos.x;
        const dz = drop.mesh.position.z - playerPos.z;
        if (Math.sqrt(dx * dx + dz * dz) < 1.5) {
            emit('itemPicked', { itemId: drop.itemId, qty: drop.qty, dropId });
            _removeDrop(dropId);
        }
    }
}

/** @param {{ position:{x,y,z} }} payload */
function _onPickupRequest({ position }) {
    let nearestId   = null;
    let nearestDist = Infinity;
    for (const [dropId, drop] of _drops) {
        const dx   = drop.mesh.position.x - position.x;
        const dz   = drop.mesh.position.z - position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < 1.5 && dist < nearestDist) { nearestDist = dist; nearestId = dropId; }
    }
    if (nearestId) {
        const drop = _drops.get(nearestId);
        emit('itemPicked', { itemId: drop.itemId, qty: drop.qty, dropId: nearestId });
        _removeDrop(nearestId);
    }
}

// ─── Exports públicos ─────────────────────────────────────────────────────────

/** @param {string} id @returns {THREE.Mesh|null} */
function getMesh(id) { return _monsters?.get?.(id)?.mesh ?? null; }

/** @param {string} id @returns {Object|null} */
function getById(id) { return _monsters?.get?.(id) ?? null; }

export {
    init,
    spawnMonster,
    spawnGroup,
    spawnQuestBoss,
    despawnQuestBoss,
    getCatalog,
    updateAll,
    getMesh,
    getById,
};