/**
 * @module monsters
 * @description Gerencia catálogo, spawn, IA e respawn de monstros.
 * Sessão 17 — PROMPT 12 Parte 2:
 *   - 4 bosses gated: só spawnam via questBossSpawnRequest (quests.js Parte 3)
 *   - spawnQuestBoss(bossId, questId) e despawnQuestBoss(bossId): exports públicos
 *   - Geometria diferenciada por boss + anel dourado
 *   - Fases de boss: 100%/50%/25% HP com gatilhos específicos por tipo
 *   - Telegrafia visual AoE: scale 1.3x + cor vermelha por 2s antes do dano
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
import * as Inventory from '../systems/inventory.js';
import { generateSockets } from '../systems/cards.js';
import { playSFX3D } from '../core/audio.js';

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

/** @type {Map<string, {itemId:string, qty:number, mesh:THREE.Mesh, spawnTime:number, refineLevel?:number, sockets?:(string|null)[]}>} */
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
    on('petAttack', _onPetAttack);

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

        drops:      def.drops      ?? [],
        cardDrop:   def.cardDrop   ?? null,
        cardDrops:  def.cardDrops  ?? [],
        abilities:  def.abilities  ?? [],

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

        // Estado de telegrafia / habilidades especiais
        _telegraphing:       false,
        _telegraphTimer:     0,
        _pendingAoe:         false,
        _invisible:          false,
        _invisibilityUntil:  0,
        _surpriseStrikeReady:false,
        _reflectShield:      false,
        _reflectExpires:     0,
        _clonesMeshes:       [],
        _clones:             [],
        _stealthUsed:        false,
        _playerSawBoss:      false,
        _multishotPending:   0,
        _enraged:            false,
        _phaseAuraLocked:    false,
        _phaseMultishotAuto: false,
        _phaseStealthLoop:   false,
        _phaseReflectLocked: false,
        _phaseAbyssAura:     false,
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
    // Telegrafia: conta down antes do AoE
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
        return;
    }

    // Checar fases por HP
    if (m.isBoss) _checkBossPhases(m);

    const dist = m.mesh.position.distanceTo(playerPos);
    if (
        m.isBoss &&
        !m._playerSawBoss &&
        !m._invisible &&
        m.mesh.visible &&
        dist <= (m.aggroRange + 2)
    ) {
        m._playerSawBoss = true;
    }
    switch (m.state) {
        case 'idle':   _stateIdle(m, dt, dist);              break;
        case 'aggro':
            if (!m._aggroSfxPlayed) {
                const aggroDef = _catalogue[m.monsterId];
                const aggroSfx = aggroDef?.soundProfile?.aggro;
                if (aggroSfx) {
                    playSFX3D(`assets/audio/sfx/${aggroSfx}.ogg`, m.mesh.position);
                }
                m._aggroSfxPlayed = true;
            }
            m.state = 'chase';
            break;
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

    if (m.monsterId === 'boss_sniper' && m._phaseStealthLoop && !m._invisible && m.mesh.visible) {
        m.mesh.visible = true;
    }

    if (m.monsterId === 'boss_high_wizard' && m._phaseReflectLocked) {
        m._reflectShield = true;
        m._reflectExpires = Infinity;
        m.mesh.material.emissiveIntensity = 0.95;
    }

    if (m.monsterId === 'boss_shadow_assassin' && m._phaseAbyssAura) {
        const now = performance.now();
        if (!m._phaseAbyssAuraNextTick || now >= m._phaseAbyssAuraNextTick) {
            m._phaseAbyssAuraNextTick = now + 2000;
            emit('bossAbilityUsed', {
                bossId: m.monsterId,
                ability: 'abyssPoison',
                data: {
                    phasePersistent: true,
                    tickRateMs: 2000,
                    durationMs: 10000,
                    damagePerTickType: 'maxHpPct',
                    damagePerTickValue: 0.05,
                },
            });
        }
    }
}

/** @param {Object} m */
function _triggerPhase50(m) {
    switch (m.monsterId) {
        case 'boss_lord_knight':
            emit('uiHintShow', {
                msg: `${_catalogue[m.monsterId].name}: reforços avançam para a arena!`,
                duration: 3500,
            });

            for (let i = 0; i < 2; i++) {
                const angle = (i / 2) * Math.PI * 2;
                const add = spawnMonster('goblin', {
                    x: m.mesh.position.x + Math.cos(angle) * 2,
                    y: 0.5,
                    z: m.mesh.position.z + Math.sin(angle) * 2,
                });

                emit('bossAbilityUsed', {
                    bossId: m.monsterId,
                    ability: 'summonAdds',
                    data: {
                        phase: 50,
                        summonedMonsterId: 'goblin',
                        summonedId: add?.id ?? null,
                    },
                });
            }
            break;

        case 'boss_high_wizard':
            emit('uiHintShow', {
                msg: `${_catalogue[m.monsterId].name}: o arcanista convergiu energia no centro da arena!`,
                duration: 3500,
            });

            m.mesh.position.set(0, m.mesh.position.y, 0);

            emit('bossAbilityUsed', {
                bossId: m.monsterId,
                ability: 'teleportStrike',
                data: {
                    phase: 50,
                    teleportedToCenter: true,
                    position: { x: 0, y: m.mesh.position.y, z: 0 },
                },
            });

            emit('bossAbilityUsed', {
                bossId: m.monsterId,
                ability: 'aoeWindup',
                data: {
                    phase: 50,
                    telegraphSeconds: 2,
                    radius: 5.0,
                    position: { x: 0, y: m.mesh.position.y, z: 0 },
                },
            });

            _startTelegraph(m);
            break;

        case 'boss_sniper':
            emit('uiHintShow', {
                msg: `${_catalogue[m.monsterId].name}: sumiu nas sombras e prepara tiros furtivos!`,
                duration: 3500,
            });

            m._phaseStealthLoop = true;
            m._invisible = true;
            m.mesh.visible = false;

            emit('bossAbilityUsed', {
                bossId: m.monsterId,
                ability: 'invisibility',
                data: {
                    phase: 50,
                    persistentStealth: true,
                    revealWindowMs: 1000,
                },
            });
            break;

        case 'boss_shadow_assassin':
            emit('uiHintShow', {
                msg: `${_catalogue[m.monsterId].name}: a arena foi tomada por sombras ilusórias!`,
                duration: 3500,
            });

            if (m._clonesMeshes.length === 0) {
                _spawnShadowClones(m);
            }

            // terceira cópia adicional para fase 50
            {
                const cloneGeo = new THREE.DodecahedronGeometry(0.8);
                const cloneMat = new THREE.MeshLambertMaterial({
                    color:       new THREE.Color(_catalogue[m.monsterId]?.modelPlaceholder ?? '#330033'),
                    transparent: true,
                    opacity:     0.5,
                });
                const cloneMesh = new THREE.Mesh(cloneGeo, cloneMat);
                cloneMesh.position.set(
                    m.mesh.position.x,
                    0.5,
                    m.mesh.position.z + 2.5,
                );
                cloneMesh.castShadow = false;
                cloneMesh.name = `${m.id}_clone_phase50`;

                const cloneEntity = {
                    id: cloneMesh.name,
                    monsterId: `${m.monsterId}_clone`,
                    type: 'monster',
                    isBoss: false,
                    isClone: true,
                    hp: 1,
                    maxHp: 1,
                    def: 0,
                    baseStats: { str: 0, vit: 0 },
                    state: 'idle',
                    mesh: cloneMesh,
                    parentBossId: m.id,
                    get position() { return this.mesh.position; },
                };

                sceneAdd(cloneMesh);
                registerTarget(cloneEntity);
                m._clonesMeshes.push(cloneMesh);
                m._clones.push(cloneEntity);

                emit('bossAbilityUsed', {
                    bossId: m.monsterId,
                    ability: 'spawnClones',
                    data: {
                        phase: 50,
                        count: 3,
                        extraCloneId: cloneEntity.id,
                    },
                });
            }
            break;
    }
}

/** @param {Object} m */
function _triggerPhase25(m) {
    switch (m.monsterId) {
        case 'boss_lord_knight':
            emit('uiHintShow', {
                msg: `${_catalogue[m.monsterId].name}: entrou em fúria total!`,
                duration: 3500,
            });

            m._enraged = true;
            m.str = Math.floor(m.baseStats.str * 1.3);
            m.mesh.material.emissive.set(0xff3333);
            m.mesh.material.emissiveIntensity = 0.9;

            emit('bossAbilityUsed', {
                bossId: m.monsterId,
                ability: 'enrage',
                data: {
                    phase: 25,
                    attackMultiplier: 1.3,
                    speedMultiplier: 1.5,
                },
            });
            break;

        case 'boss_high_wizard':
            emit('uiHintShow', {
                msg: `${_catalogue[m.monsterId].name}: o espelho arcano tornou-se permanente!`,
                duration: 3500,
            });

            m._phaseReflectLocked = true;
            m._reflectShield = true;
            m._reflectExpires = Infinity;
            m.mesh.material.emissiveIntensity = 1.0;

            emit('bossAbilityUsed', {
                bossId: m.monsterId,
                ability: 'reflectShield',
                data: {
                    phase: 25,
                    permanent: true,
                    reflectsPct: 0.5,
                },
            });
            break;

        case 'boss_sniper':
            emit('uiHintShow', {
                msg: `${_catalogue[m.monsterId].name}: cada ataque agora se divide em múltiplos tiros!`,
                duration: 3500,
            });

            m._phaseMultishotAuto = true;

            emit('bossAbilityUsed', {
                bossId: m.monsterId,
                ability: 'multishot',
                data: {
                    phase: 25,
                    continuous: true,
                    count: 3,
                    damagePerProjectile: Math.max(1, Math.floor(m.str * 0.6)),
                },
            });
            break;

        case 'boss_shadow_assassin':
            emit('uiHintShow', {
                msg: `${_catalogue[m.monsterId].name}: o veneno do abismo cobriu toda a arena!`,
                duration: 3500,
            });

            m._phaseAbyssAura = true;
            m._enraged = true;
            m.str = Math.floor(m.baseStats.str * 1.3);
            m.mesh.material.emissive.set(0x7a1fa2);
            m.mesh.material.emissiveIntensity = 0.9;

            emit('bossAbilityUsed', {
                bossId: m.monsterId,
                ability: 'abyssPoison',
                data: {
                    phase: 25,
                    permanent: true,
                    tickRateMs: 2000,
                    damagePerTickType: 'maxHpPct',
                    damagePerTickValue: 0.05,
                    enrage: true,
                },
            });
            break;
    }
}

// ─── Habilidades específicas de boss ──────────────────────────────────────────

/**
 * Inicia telegrafia visual 2s antes do AoE do boss_lord_knight.
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
 * Executa o dano AoE do boss_lord_knight após telegrafia.
 * @param {Object} m @param {THREE.Vector3} playerPos
 */
function _executeBossAoe(m, playerPos) {
    const AOE_RADIUS = 3.0;
    const dx = playerPos.x - m.mesh.position.x;
    const dz = playerPos.z - m.mesh.position.z;
    const hit = Math.sqrt(dx * dx + dz * dz) <= AOE_RADIUS;
    const dmg = Math.floor(m.str * 2.5);

    emit('bossAbilityUsed', {
        bossId: m.monsterId,
        ability: 'aoeWindup',
        data: {
            radius: AOE_RADIUS,
            damage: dmg,
            position: {
                x: m.mesh.position.x,
                y: m.mesh.position.y,
                z: m.mesh.position.z,
            },
            hit,
        },
    });

    if (hit) {
        emit('monsterAttackRequest', { attacker: m, ability: 'aoeWindup', damage: dmg });
    }
}

/**
 * Teleport strike do boss_high_wizard: teletransporta ao lado do player e ataca.
 * @param {Object} m
 */
function _bossTeleportStrike(m) {
    const angle = Math.random() * Math.PI * 2;
    m.mesh.position.x = _playerPos.x + Math.cos(angle) * 1.5;
    m.mesh.position.z = _playerPos.z + Math.sin(angle) * 1.5;

    emit('bossAbilityUsed', {
        bossId: m.monsterId,
        ability: 'teleportStrike',
        data: {
            position: {
                x: m.mesh.position.x,
                y: m.mesh.position.y,
                z: m.mesh.position.z,
            },
            strikeDelayMs: 200,
        },
    });

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
    const created = [];

    for (let i = 0; i < 2; i++) {
        const angle = (i / 2) * Math.PI * 2;
        const cloneGeo = new THREE.DodecahedronGeometry(0.8);
        const cloneMat = new THREE.MeshLambertMaterial({
            color:       new THREE.Color(_catalogue[m.monsterId]?.modelPlaceholder ?? '#330033'),
            transparent: true,
            opacity:     0.5,
        });
        const cloneMesh = new THREE.Mesh(cloneGeo, cloneMat);
        cloneMesh.position.set(
            m.mesh.position.x + Math.cos(angle) * 2,
            0.5,
            m.mesh.position.z + Math.sin(angle) * 2,
        );
        cloneMesh.castShadow = false;
        cloneMesh.name = `${m.id}_clone_${i + 1}`;

        const cloneEntity = {
            id: cloneMesh.name,
            monsterId: `${m.monsterId}_clone`,
            type: 'monster',
            isBoss: false,
            isClone: true,
            hp: 1,
            maxHp: 1,
            def: 0,
            baseStats: { str: 0, vit: 0 },
            state: 'idle',
            mesh: cloneMesh,
            parentBossId: m.id,
            get position() { return this.mesh.position; },
        };

        sceneAdd(cloneMesh);
        registerTarget(cloneEntity);
        m._clonesMeshes.push(cloneMesh);
        m._clones.push(cloneEntity);
        created.push({
            id: cloneEntity.id,
            x: cloneMesh.position.x,
            y: cloneMesh.position.y,
            z: cloneMesh.position.z,
        });
    }

    emit('bossAbilityUsed', {
        bossId: m.monsterId,
        ability: 'spawnClones',
        data: {
            count: created.length,
            clones: created,
        },
    });
}

/**
 * Remove clones e anel ao desaparecer o boss.
 * @param {Object} m
 */
function _cleanupBoss(m) {
    if (Array.isArray(m._clones)) {
        for (const cloneEntity of m._clones) {
            unregisterTarget(cloneEntity);
        }
    }

    for (const clone of m._clonesMeshes) {
        clone.geometry.dispose();
        clone.material.dispose();
        sceneRemove(clone);
    }

    m._clonesMeshes = [];
    m._clones = [];
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
    if (dist > m.aggroRange * 1.5) { m.state = 'idle'; m._idleTimer = 0; m._aggroSfxPlayed = false; return; }

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

    const baseCooldown = m.isBoss ? 1.5 : 1.0;
    const cooldown = m._enraged ? (baseCooldown / 1.5) : baseCooldown;
    const now = performance.now() / 1000;
    if (now - m._lastAttackTime < cooldown) return;
    m._lastAttackTime = now;

    if (m.monsterId === 'boss_sniper' && m._phaseMultishotAuto) {
        _executeBossAbility(m, 'multishot', playerPos);
        return;
    }

    if (m._multishotPending && m._multishotPending > 0) {
        m._multishotPending--;
        _executeBossAbility(m, 'multishot', playerPos);
        return;
    }

    if (!m.isBoss || m.abilities.length === 0) {
        emit('monsterAttackRequest', { attacker: m, ability: null, damage: null });
        return;
    }

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
            emit('bossAbilityUsed', {
                bossId: m.monsterId,
                ability: 'aoeWindup',
                data: {
                    telegraphSeconds: 2,
                    radius: 3.0,
                    position: {
                        x: m.mesh.position.x,
                        y: m.mesh.position.y,
                        z: m.mesh.position.z,
                    },
                },
            });
            break;

        case 'summonAdds': {
            const add = spawnMonster('goblin', {
                x: m.mesh.position.x + (Math.random() - 0.5) * 3,
                y: 0.5,
                z: m.mesh.position.z + (Math.random() - 0.5) * 3,
            });

            emit('bossAbilityUsed', {
                bossId: m.monsterId,
                ability: 'summonAdds',
                data: {
                    summonedMonsterId: 'goblin',
                    summonedId: add?.id ?? null,
                    position: add ? {
                        x: add.mesh.position.x,
                        y: add.mesh.position.y,
                        z: add.mesh.position.z,
                    } : null,
                },
            });
            break;
        }

        case 'teleportStrike':
            _bossTeleportStrike(m);
            break;

        case 'reflectShield':
            if (!m._reflectShield) {
                m._reflectShield = true;
                m._reflectExpires = performance.now() + 5000;
                m.mesh.material.emissiveIntensity = 0.8;

                emit('buffApplied', {
                    buffId: 'reflectShield',
                    casterId: m.monsterId,
                    expiresAt: m._reflectExpires,
                });

                emit('bossAbilityUsed', {
                    bossId: m.monsterId,
                    ability: 'reflectShield',
                    data: {
                        durationMs: 5000,
                        reflectsPct: 0.5,
                        expiresAt: m._reflectExpires,
                    },
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
                m._invisibilityUntil = performance.now() + 3000;
                m._surpriseStrikeReady = true;
                m.mesh.visible = false;

                emit('bossAbilityUsed', {
                    bossId: m.monsterId,
                    ability: 'invisibility',
                    data: {
                        durationMs: 3000,
                        surpriseDamageMultiplier: 2,
                        phaseStealthLoop: !!m._phaseStealthLoop,
                    },
                });

                setTimeout(() => {
                    if (m.state !== 'dead') {
                        m._invisible = false;
                        m.mesh.visible = true;

                        if (m._phaseStealthLoop) {
                            setTimeout(() => {
                                if (m.state !== 'dead') {
                                    m._invisible = true;
                                    m.mesh.visible = false;
                                }
                            }, 1000);
                        }
                    }
                }, 3000);
            }
            break;

        case 'multishot': {
            const projectiles = [];
            const baseDamage = Math.max(1, Math.floor(m.str * 0.6));

            for (let i = 0; i < 3; i++) {
                projectiles.push({
                    index: i,
                    spreadOffset: i - 1,
                    damage: baseDamage,
                });
                emit('monsterAttackRequest', {
                    attacker: m,
                    ability: 'multishot',
                    damage: baseDamage,
                });
            }

            emit('bossAbilityUsed', {
                bossId: m.monsterId,
                ability: 'multishot',
                data: {
                    count: 3,
                    damagePerProjectile: baseDamage,
                    projectiles,
                },
            });
            break;
        }

        case 'stealthStrikeFirst': {
            if (m._stealthUsed) {
                emit('monsterAttackRequest', { attacker: m, ability: null, damage: null });
                break;
            }

            const unseenByPlayer = !m._playerSawBoss || m._invisible;
            const multiplier = unseenByPlayer ? 2 : 1;
            const dmg = Math.max(1, Math.floor(m.str * multiplier));

            m._stealthUsed = true;

            emit('bossAbilityUsed', {
                bossId: m.monsterId,
                ability: 'stealthStrikeFirst',
                data: {
                    unseenByPlayer,
                    damageMultiplier: multiplier,
                    damage: dmg,
                },
            });

            emit('monsterAttackRequest', {
                attacker: m,
                ability: 'stealthStrikeFirst',
                damage: dmg,
            });
            break;
        }

        case 'spawnClones':
            if (m._clonesMeshes.length === 0) {
                _spawnShadowClones(m);
            } else {
                emit('bossAbilityUsed', {
                    bossId: m.monsterId,
                    ability: 'spawnClones',
                    data: {
                        count: m._clonesMeshes.length,
                        reused: true,
                    },
                });
            }
            break;

        case 'abyssPoison':
            emit('bossAbilityUsed', {
                bossId: m.monsterId,
                ability: 'abyssPoison',
                data: {
                    tickRateMs: 2000,
                    durationMs: 10000,
                    damagePerTickType: 'maxHpPct',
                    damagePerTickValue: 0.05,
                },
            });

            emit('monsterAttackRequest', {
                attacker: m,
                ability: 'abyssPoison',
                damage: null,
            });
            break;

        default:
            emit('bossAbilityUsed', {
                bossId: m.monsterId,
                ability,
                data: {},
            });
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
function _onPetAttack({ targetId, damage } = {}) {
    if (!targetId) return;

    let monster = _monsters.get(targetId);

    if (!monster) {
        for (const [, boss] of _monsters) {
            if (!Array.isArray(boss._clones)) continue;
            const foundClone = boss._clones.find(clone => clone.id === targetId);
            if (foundClone) {
                monster = foundClone;
                break;
            }
        }
    }

    if (!monster || monster.state === 'dead') return;

    const rawDamage = Math.floor(Number(damage ?? 0));
    if (!Number.isFinite(rawDamage) || rawDamage <= 0) return;

    const finalDamage = monster.isClone ? 1 : rawDamage;
    monster.hp = Math.max(0, monster.hp - finalDamage);

    emit('damageDealt', {
        attackerId: 'pet',
        attackerType: 'pet',
        targetId: monster.id,
        targetType: 'monster',
        amount: finalDamage
    });

    if (monster.hp <= 0) {
        emit('entityDied', { entity: monster });
    }
}

function _onEntityDied({ entity }) {
    if (_monsters.has(entity.id)) {
        const m = _monsters.get(entity.id);
        if (m.state === 'dead') return;

        m.state = 'dead';
        const deadDef = _catalogue[m.monsterId];
        const dieSfx = deadDef?.soundProfile?.die;
        if (dieSfx) {
            playSFX3D(`assets/audio/sfx/${dieSfx}.ogg`, m.mesh.position);
        }
        m.hp = 0;
        m.mesh.visible = false;

        if (m.isBoss) _cleanupBoss(m);

        const def = _catalogue[m.monsterId];
        _rollDrops(def, m.mesh.position);
        _rollCardDrops(def);
        unregisterTarget(m);

        emit('monsterDied', {
            id: m.id,
            monsterId: m.monsterId,
            xp: m.xp,
            isBoss: m.isBoss,
            linkedQuestId: m.linkedQuestId,
        });

        if (m.isBoss) {
            emit('uiHintShow', {
                msg: `Boss derrotado: ${def.name}! +${m.xp} XP`,
                duration: 5000,
            });
        } else {
            m._respawnTimeout = setTimeout(() => _respawn(m), 30_000);
        }
        return;
    }

    for (const [, boss] of _monsters) {
        if (!Array.isArray(boss._clones)) continue;
        const cloneIndex = boss._clones.findIndex(clone => clone.id === entity.id);
        if (cloneIndex === -1) continue;

        const cloneEntity = boss._clones[cloneIndex];
        const meshIndex = boss._clonesMeshes.findIndex(mesh => mesh === cloneEntity.mesh);

        unregisterTarget(cloneEntity);
        cloneEntity.hp = 0;
        cloneEntity.state = 'dead';
        cloneEntity.mesh.visible = false;

        if (meshIndex !== -1) {
            const cloneMesh = boss._clonesMeshes[meshIndex];
            cloneMesh.geometry.dispose();
            cloneMesh.material.dispose();
            sceneRemove(cloneMesh);
            boss._clonesMeshes.splice(meshIndex, 1);
        }

        boss._clones.splice(cloneIndex, 1);

        emit('bossAbilityUsed', {
            bossId: boss.monsterId,
            ability: 'spawnClones',
            data: {
                cloneDestroyedId: entity.id,
                remainingClones: boss._clones.length,
            },
        });
        return;
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
    m._telegraphing        = false;
        m._pendingAoe          = false;
        m._reflectShield       = false;
        m._invisible           = false;
        m._invisibilityUntil   = 0;
        m._surpriseStrikeReady = false;
        m._multishotPending    = 0;
        m._stealthUsed         = false;
        m._playerSawBoss       = false;
        m._enraged             = false;
        m._phaseAuraLocked     = false;
        m._phaseMultishotAuto  = false;
        m._phaseStealthLoop    = false;
        m._phaseReflectLocked  = false;
        m._phaseAbyssAura      = false;
        m._phaseAbyssAuraNextTick = 0;
        m._respawnTimeout      = null;
        m.str                  = m.baseStats.str;
    registerTarget(m);
    emit('monsterSpawned', {
        id:       m.id,
        monsterId: m.monsterId,
        position: { x: m._spawnPosition.x, y: m._spawnPosition.y, z: m._spawnPosition.z },
    });
}

// ─── Drops ────────────────────────────────────────────────────────────────────

/**
 * Resolve a quantidade de um drop baseado no schema atual.
 * @param {Object} drop
 * @returns {number}
 */
function _rollDrops(def, position) {
    if (!def || !Array.isArray(def.drops)) return;

    for (const drop of def.drops) {
        if (Math.random() >= drop.chance) continue;

        const qty = _resolveDropQty(drop);
        const meta = _buildDropItemMeta(drop.itemId);
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
        _drops.set(dropId, {
            itemId: drop.itemId,
            qty,
            mesh,
            spawnTime: performance.now(),
            ...(meta?.refineLevel != null ? { refineLevel: meta.refineLevel } : {}),
            ...(meta?.sockets?.length ? { sockets: [...meta.sockets] } : {})
        });

        emit('itemDropped', {
            itemId: drop.itemId,
            qty,
            position: mesh.position,
            dropId,
            ...(meta?.refineLevel != null ? { refineLevel: meta.refineLevel } : {}),
            ...(meta?.sockets?.length ? { sockets: [...meta.sockets] } : {})
        });
    }
}

function _resolveDropQty(drop) {
    if (drop.qty && typeof drop.qty === 'object') {
        return Math.floor(Math.random() * (drop.qty.max - drop.qty.min + 1)) + drop.qty.min;
    }
    if (typeof drop.qty === 'number') {
        return drop.qty;
    }
    if (typeof drop.qtyMin === 'number' && typeof drop.qtyMax === 'number') {
        return Math.floor(Math.random() * (drop.qtyMax - drop.qtyMin + 1)) + drop.qtyMin;
    }
    if (typeof drop.qtyMin === 'number') {
        return drop.qtyMin;
    }
    return 1;
}

/**
 * Monta metadata opcional para item dropado no mundo.
 * Equipáveis recebem sockets aleatórios conforme o slot do item.
 * @param {string} itemId
 * @returns {{ refineLevel?: number, sockets?: (string|null)[] }|null}
 */
function _buildDropItemMeta(itemId) {
    const itemDef = _itemCatalogue[itemId];
    if (!itemDef?.slot) return null;

    const sockets = generateSockets(itemDef.slot);
    if (sockets.length <= 0) return null;

    return { sockets };
}

function _rollCardDrops(def) {
    if (!def) return;

    const cardEntries = [];
    if (Array.isArray(def.cardDrops)) {
        cardEntries.push(...def.cardDrops);
    } else if (def.cardDrop) {
        cardEntries.push(def.cardDrop);
    }

    for (const cardDrop of cardEntries) {
        if (!cardDrop?.cardId || typeof cardDrop.chance !== 'number') continue;
        if (Math.random() >= cardDrop.chance) continue;

        const added = Inventory.addItem(cardDrop.cardId, 1);
        if (added === false) {
            emit('inventoryFull', { itemId: cardDrop.cardId });
        }
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
            emit('itemPicked', {
                itemId: drop.itemId,
                qty: drop.qty,
                dropId,
                ...(drop.refineLevel != null ? { refineLevel: drop.refineLevel } : {}),
                ...(Array.isArray(drop.sockets) && drop.sockets.length > 0 ? { sockets: [...drop.sockets] } : {})
            });
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
        emit('itemPicked', {
            itemId: drop.itemId,
            qty: drop.qty,
            dropId: nearestId,
            ...(drop.refineLevel != null ? { refineLevel: drop.refineLevel } : {}),
            ...(Array.isArray(drop.sockets) && drop.sockets.length > 0 ? { sockets: [...drop.sockets] } : {})
        });
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