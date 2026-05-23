/**
 * @module pets
 * @description Sistema de pets: coleção, invocação, bônus passivos, XP e habilidade ativa.
 */

import * as THREE from 'three';
import { on, emit } from '../core/events.js';
import { getScene } from '../world/scene.js';
import { getState as getPlayerState, getPosition as getPlayerPosition } from '../entities/player.js';
import { getClassLineage } from '../systems/classes.js';

let _petDefs = {};
let _collection = [];
let _summonedIndex = null;
let _summonedMesh = null;
let _abilityCooldowns = {};
let _initialized = false;

const _followTarget = new THREE.Vector3();
const _tempPlayerPos = new THREE.Vector3();

function _clonePlain(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

function _normalizePetDef(rawDef) {
    if (!rawDef?.id) return null;

    return {
        id: rawDef.id,
        name: rawDef.name ?? rawDef.label ?? rawDef.id,
        affinity: rawDef.affinity ?? null,
        visual: {
            radius: Number(rawDef.visual?.radius ?? 0.45),
            color: rawDef.visual?.color ?? rawDef.modelPlaceholder ?? 0x66ccff,
            emissive: rawDef.visual?.emissive ?? 0x111111
        },
        baseBonus: { ...(rawDef.baseBonus ?? {}) },
        bonusPerLevel: { ...(rawDef.bonusPerLevel ?? {}) },
        abilities: Array.isArray(rawDef.abilities) ? rawDef.abilities.map(a => ({
            name: a?.name ?? a?.id ?? 'Pet Skill',
            type: a?.type ?? 'buff',
            unlockLevel: Number(a?.unlockLevel ?? 1),
            value: Number(a?.value ?? 0),
            radius: Number(a?.radius ?? 0),
            duration: Number(a?.duration ?? 0),
            stat: a?.stat ?? null,
            cooldown: Number(a?.cooldown ?? 10),
            hpPercent: Number(a?.hpPercent ?? 0)
        })) : []
    };
}

function _cloneCollectionEntry(entry) {
    return {
        petId: entry.petId,
        level: Number(entry.level ?? 1),
        exp: Number(entry.exp ?? 0)
    };
}

function _disposeSummonedMesh() {
    if (!_summonedMesh) return;

    const scene = getScene();
    if (scene) {
        scene.remove(_summonedMesh);
    }

    if (_summonedMesh.geometry) {
        _summonedMesh.geometry.dispose();
    }

    if (_summonedMesh.material) {
        if (Array.isArray(_summonedMesh.material)) {
            _summonedMesh.material.forEach(mat => mat?.dispose?.());
        } else {
            _summonedMesh.material.dispose();
        }
    }

    _summonedMesh = null;
}

function _getSummonedEntry() {
    if (_summonedIndex == null) return null;
    return _collection[_summonedIndex] ?? null;
}

function _getRootClass(playerState) {
    if (!playerState?.class) return null;
    const lineage = getClassLineage(playerState.class);
    return lineage.length > 0 ? lineage[0] : playerState.class;
}

function _hasAffinityMatch(def, playerState) {
    if (!def?.affinity || !playerState) return false;
    return _getRootClass(playerState) === def.affinity;
}

function _xpToNext(level) {
    return Math.floor(50 * (1.3 ** (level - 1)));
}

function _emitBonusChanged() {
    emit('petBonusChanged', {
        summonedPet: getSummonedPet(),
        bonuses: getPetBonuses()
    });
}

function _buildSummonedMesh(def) {
    const geometry = new THREE.SphereGeometry(
        Number(def.visual?.radius ?? 0.45),
        20,
        16
    );

    const material = new THREE.MeshStandardMaterial({
        color: def.visual?.color ?? 0x66ccff,
        emissive: def.visual?.emissive ?? 0x111111
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.position.copy(getPlayerPosition());
    mesh.position.x -= 1.5;
    mesh.position.y += 0.5;
    mesh.position.z -= 1.0;
    mesh.name = `pet_${def.id}`;

    return mesh;
}

function _getUnlockedAbility(def, pet) {
    if (!def || !pet || !Array.isArray(def.abilities) || def.abilities.length === 0) {
        return null;
    }

    let unlocked = null;
    for (const ability of def.abilities) {
        if (pet.level >= Number(ability.unlockLevel ?? 1)) {
            unlocked = ability;
        }
    }
    return unlocked;
}

function _getNearestMonsterIdWithinRadius(radius) {
    const playerPos = getPlayerPosition();
    let nearestId = null;
    let nearestDist = Infinity;

    const scene = getScene();
    if (!scene) return null;

    scene.traverse(obj => {
        if (!obj?.isMesh || !obj.visible || !obj.name?.startsWith('monster_')) return;

        const dx = obj.position.x - playerPos.x;
        const dz = obj.position.z - playerPos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist <= radius && dist < nearestDist) {
            nearestDist = dist;
            nearestId = obj.name;
        }
    });

    return nearestId;
}

function _notifyUnlockedAbilities(def, oldLevel, newLevel) {
    if (!def || !Array.isArray(def.abilities)) return;

    for (const ability of def.abilities) {
        const unlockLevel = Number(ability.unlockLevel ?? 1);
        if (unlockLevel > oldLevel && unlockLevel <= newLevel) {
            emit('showNotification', {
                message: `${def.name} desbloqueou ${ability.name}!`,
                type: 'success'
            });
        }
    }
}

function _applyActiveAbility(nowSec) {
    const pet = _getSummonedEntry();
    if (!pet) return;

    const def = _petDefs[pet.petId];
    if (!def) return;

    const ability = _getUnlockedAbility(def, pet);
    if (!ability) return;

    const cooldownKey = `${pet.petId}:${ability.name}`;
    const readyAt = Number(_abilityCooldowns[cooldownKey] ?? 0);
    if (nowSec < readyAt) return;

    const playerState = getPlayerState();
    const nearestMonsterId = _getNearestMonsterIdWithinRadius(10);

    if (!nearestMonsterId && ability.type !== 'revive') {
        return;
    }

    if (ability.type === 'revive' && Number(playerState?.hp ?? 0) > 0) {
        return;
    }

    switch (ability.type) {
        case 'heal':
            emit('inventoryHealRequest', { amount: ability.value });
            break;

        case 'restoreMp':
            emit('inventoryRestoreMpRequest', { amount: ability.value });
            break;

        case 'attack':
            emit('petAttack', { targetId: nearestMonsterId, damage: ability.value });
            break;

        case 'taunt':
            emit('petTaunt', {
                radius: ability.radius,
                duration: ability.duration
            });
            break;

        case 'buff':
            emit('buffApplied', {
                stat: ability.stat,
                value: ability.value,
                duration: ability.duration,
                source: 'pet'
            });
            break;

        case 'revive':
            emit('petRevive', { hpPercent: ability.hpPercent });
            break;

        default:
            return;
    }

    emit('petAbilityUsed', {
        petId: pet.petId,
        abilityName: ability.name,
        type: ability.type
    });

    _abilityCooldowns[cooldownKey] = nowSec + Math.max(0.1, Number(ability.cooldown ?? 10));
}

function _onMonsterDied(payload) {
    if (_summonedIndex == null) return;

    const expReward = Number(
        payload?.expReward ??
        payload?.xp ??
        payload?.exp ??
        0
    );

    if (expReward <= 0) return;
    addPetExp(Math.floor(expReward * 0.3));
}

function _rebuildCooldownsForSummoned() {
    _abilityCooldowns = {};
    const pet = _getSummonedEntry();
    if (!pet) return;

    const def = _petDefs[pet.petId];
    if (!def?.abilities?.length) return;

    for (const ability of def.abilities) {
        _abilityCooldowns[`${pet.petId}:${ability.name}`] = 0;
    }
}

/**
 * Inicializa definições de pets.
 * @param {Array<Object>|Object<string, Object>} petDefs
 * @returns {void}
 */
export function init(petDefs) {
    _petDefs = {};

    if (Array.isArray(petDefs)) {
        for (const rawDef of petDefs) {
            const def = _normalizePetDef(rawDef);
            if (def) _petDefs[def.id] = def;
        }
    } else if (petDefs && typeof petDefs === 'object') {
        for (const rawDef of Object.values(petDefs)) {
            const def = _normalizePetDef(rawDef);
            if (def) _petDefs[def.id] = def;
        }
    }

    _disposeSummonedMesh();
    _summonedIndex = null;
    _abilityCooldowns = {};

    if (!_initialized) {
        on('monsterDied', _onMonsterDied);
        _initialized = true;
    }
}

/**
 * Invoca um pet da coleção.
 * @param {number} petIndex
 * @returns {Object|null}
 */
export function summon(petIndex) {
    if (!Number.isInteger(petIndex)) return null;
    const pet = _collection[petIndex];
    if (!pet) return null;

    const def = _petDefs[pet.petId];
    if (!def) return null;

    if (_summonedIndex !== null) {
        unsummon();
    }

    const scene = getScene();
    if (!scene) return null;

    _summonedMesh = _buildSummonedMesh(def);
    scene.add(_summonedMesh);
    _summonedIndex = petIndex;
    _rebuildCooldownsForSummoned();

    emit('petSummoned', {
        petId: pet.petId,
        index: petIndex
    });
    _emitBonusChanged();

    return getSummonedPet();
}

/**
 * Guarda o pet atualmente invocado.
 * @returns {boolean}
 */
export function unsummon() {
    const current = _getSummonedEntry();
    if (!current) return false;

    const oldPetId = current.petId;

    _disposeSummonedMesh();
    _summonedIndex = null;
    _abilityCooldowns = {};

    emit('petUnsummoned', { petId: oldPetId });
    _emitBonusChanged();

    return true;
}

/**
 * Retorna os dados do pet invocado.
 * @returns {Object|null}
 */
export function getSummonedPet() {
    const pet = _getSummonedEntry();
    if (!pet) return null;

    const def = _petDefs[pet.petId];
    return {
        ..._cloneCollectionEntry(pet),
        def: def ? _clonePlain(def) : null,
        bonuses: getPetBonuses()
    };
}

/**
 * Retorna a coleção de pets.
 * @returns {Array<Object>}
 */
export function getCollection() {
    return _collection.map(_cloneCollectionEntry);
}

/**
 * Adiciona um pet à coleção.
 * @param {string} petId
 * @returns {boolean}
 */
export function addPet(petId) {
    if (!petId || !_petDefs[petId] || hasPet(petId)) return false;

    _collection.push({
        petId,
        level: 1,
        exp: 0
    });

    emit('petObtained', { petId });
    return true;
}

/**
 * Verifica se o player já possui o pet.
 * @param {string} petId
 * @returns {boolean}
 */
export function hasPet(petId) {
    return _collection.some(p => p.petId === petId);
}

/**
 * Retorna a definição de um pet.
 * @param {string} petId
 * @returns {Object|null}
 */
export function getPetDef(petId) {
    return _petDefs[petId] ? _clonePlain(_petDefs[petId]) : null;
}

/**
 * Adiciona XP ao pet invocado.
 * @param {number} amount
 * @returns {boolean}
 */
export function addPetExp(amount) {
    const pet = _getSummonedEntry();
    if (!pet) return false;

    const gain = Math.floor(Number(amount ?? 0));
    if (!Number.isFinite(gain) || gain <= 0) return false;

    if (pet.level >= 20) {
        pet.exp = 0;
        return false;
    }

    pet.exp += gain;
    let leveled = false;
    const def = _petDefs[pet.petId];

    while (pet.level < 20) {
        const needed = _xpToNext(pet.level);
        if (pet.exp < needed) break;

        pet.exp -= needed;
        const oldLevel = pet.level;
        pet.level += 1;
        leveled = true;

        emit('petLevelUp', {
            petId: pet.petId,
            newLevel: pet.level
        });

        _notifyUnlockedAbilities(def, oldLevel, pet.level);
    }

    if (pet.level >= 20) {
        pet.level = 20;
        pet.exp = 0;
    }

    if (leveled) {
        _emitBonusChanged();
    }

    return true;
}

/**
 * Retorna bônus agregados do pet invocado.
 * @returns {Object}
 */
export function getPetBonuses() {
    const pet = _getSummonedEntry();
    if (!pet) return {};

    const def = _petDefs[pet.petId];
    if (!def) return {};

    const level = Number(pet.level ?? 1);
    const playerState = getPlayerState();
    const affinityMultiplier = _hasAffinityMatch(def, playerState) ? 1.25 : 1;
    const stats = {};

    const statKeys = new Set([
        ...Object.keys(def.baseBonus ?? {}),
        ...Object.keys(def.bonusPerLevel ?? {})
    ]);

    for (const stat of statKeys) {
        const base = Number(def.baseBonus?.[stat] ?? 0);
        const perLevel = Number(def.bonusPerLevel?.[stat] ?? 0);
        let value = base + (perLevel * Math.max(0, level - 1));

        if (affinityMultiplier !== 1) {
            value = Math.floor(value * affinityMultiplier);
        }

        if (value) {
            stats[stat] = value;
        }
    }

    return stats;
}

/**
 * Serializa o estado do sistema de pets.
 * @returns {{collection:Array<Object>, summonedIndex:number|null}}
 */
export function serialize() {
    return {
        collection: _collection.map(_cloneCollectionEntry),
        summonedIndex: _summonedIndex
    };
}

/**
 * Restaura o estado do sistema de pets.
 * @param {Object|null} data
 * @returns {void}
 */
export function hydrate(data) {
    _disposeSummonedMesh();
    _collection = [];
    _summonedIndex = null;
    _abilityCooldowns = {};

    if (Array.isArray(data?.collection)) {
        _collection = data.collection
            .filter(entry => entry?.petId && _petDefs[entry.petId])
            .map(entry => ({
                petId: entry.petId,
                level: Math.min(20, Math.max(1, Number(entry.level ?? 1))),
                exp: Math.max(0, Number(entry.exp ?? 0))
            }));
    }

    const desiredSummonedIndex = Number.isInteger(data?.summonedIndex)
        ? data.summonedIndex
        : null;

    if (
        desiredSummonedIndex !== null &&
        desiredSummonedIndex >= 0 &&
        desiredSummonedIndex < _collection.length
    ) {
        summon(desiredSummonedIndex);
    } else {
        _emitBonusChanged();
    }
}

/**
 * Atualiza posição do pet e habilidade ativa.
 * @param {number} delta
 * @returns {void}
 */
export function update(delta) {
    const pet = _getSummonedEntry();
    if (!pet || !_summonedMesh) return;

    _tempPlayerPos.copy(getPlayerPosition());
    _followTarget.set(
        _tempPlayerPos.x - 1.5,
        _tempPlayerPos.y + 0.5,
        _tempPlayerPos.z - 1.0
    );

    _summonedMesh.position.lerp(_followTarget, 0.05);
    _summonedMesh.rotation.y += Math.max(0, Number(delta ?? 0)) * 1.5;

    const nowSec = performance.now() / 1000;
    _applyActiveAbility(nowSec);
}