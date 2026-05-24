import * as THREE from 'three';
import { getScene, getCamera, add, remove } from './scene.js';
import { spawnMonster, spawnGroup } from '../entities/monsters.js';
import { spawnFromConfig } from '../entities/npcs.js';
import { playBGM, playSFX } from '../core/audio.js';
import { getPosition, getState } from '../entities/player.js';
import { on, off, emit } from '../core/events.js';

let _maps = [];
let _mapsById = new Map();
let _currentMapId = null;
let _currentMapConfig = null;
let _terrainMesh = null;
let _mapObjects = [];
let _exitNearTarget = null;
let _npcsConfig = null;
let _boundExitPointAction = null;

/**
 * Inicializa o módulo de mundo e carrega maps.json.
 * @returns {Promise<void>}
 */
export async function init() {
  const response = await fetch('assets/data/maps.json');
  if (!response.ok) {
    throw new Error(`[world] Falha ao carregar maps.json: ${response.status}`);
  }

  const data = await response.json();
  _maps = data.maps;
  _mapsById = new Map(_maps.map(map => [map.id, map]));

  const npcsResponse = await fetch('assets/data/npcs.json');
  if (!npcsResponse.ok) {
    throw new Error(`[world] Falha ao carregar npcs.json: ${npcsResponse.status}`);
  }
  _npcsConfig = await npcsResponse.json();

  _boundExitPointAction = ({ targetMap } = {}) => {
    if (!targetMap) return;
    loadMap(targetMap);
  };

  on('exitPointAction', _boundExitPointAction);
}

/**
 * Carrega um mapa pelo id.
 * @param {string} mapId
 * @returns {Promise<void>}
 */
export async function loadMap(mapId) {
  const nextMap = _mapsById.get(mapId);
  if (!nextMap) {
    console.warn(`[world] Mapa desconhecido: ${mapId}`);
    return;
  }

  const previousMapId = _currentMapId;
  emit('mapUnloading', previousMapId);

  _clearCurrentMap();

  _currentMapId = mapId;
  _currentMapConfig = nextMap;
  _exitNearTarget = null;

  _terrainMesh = _createTerrain(nextMap);
  add(_terrainMesh);
  _mapObjects.push(_terrainMesh);

  _spawnMapMonsters(nextMap);
  _spawnMapNpcs(nextMap);
  _applyMapAudio(nextMap);
  _updatePlayerCurrentMap(mapId);

  emit('mapLoaded', {
    mapId,
    mapName: nextMap.name ?? mapId
  });
}

/**
 * Retorna id do mapa atual.
 * @returns {string|null}
 */
export function getCurrentMap() {
  return _currentMapId;
}

/**
 * Retorna config do mapa atual.
 * @returns {Object|null}
 */
export function getMapConfig() {
  return _currentMapConfig;
}

/**
 * Atualiza lógica do mundo.
 * @param {number} delta
 * @returns {void}
 */
export function update(delta) {
  if (!_currentMapConfig) return;

  const playerPos = getPosition();
  const exitPoints = Array.isArray(_currentMapConfig.exitPoints) ? _currentMapConfig.exitPoints : [];

  let nearestExit = null;
  let nearestDistance = Infinity;

  for (const exitPoint of exitPoints) {
    const distance = _distanceToExit(playerPos, exitPoint.position);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestExit = exitPoint;
    }
  }

  if (nearestExit && nearestDistance <= 3) {
    if (_exitNearTarget !== nearestExit.targetMap) {
      _exitNearTarget = nearestExit.targetMap;
      emit('exitPointNear', {
        targetMap: nearestExit.targetMap,
        label: nearestExit.label
      });
    }
    return;
  }

  if (_exitNearTarget && (!nearestExit || nearestDistance > 5)) {
    _exitNearTarget = null;
    emit('exitPointLeft');
  }
}

function _clearCurrentMap() {
  // TODO PARTE 4: stopAmbient()

  for (const obj of _mapObjects) {
    remove(obj);
    _disposeObject(obj);
  }

  _mapObjects = [];
  _terrainMesh = null;
}

function _createTerrain(mapConfig) {
  const geometry = new THREE.PlaneGeometry(mapConfig.terrainSize, mapConfig.terrainSize);
  const material = new THREE.MeshLambertMaterial({
    color: mapConfig.terrainColor
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  mesh.name = `terrain_${mapConfig.id}`;

  return mesh;
}

function _spawnMapMonsters(mapConfig) {
  const pool = Array.isArray(mapConfig.monsterPool) ? mapConfig.monsterPool : [];
  const maxMonsters = Number(mapConfig.maxMonsters || 0);

  if (pool.length === 0 || maxMonsters <= 0) return;

  for (let i = 0; i < maxMonsters; i++) {
    const selected = _pickWeightedMonster(pool);
    if (!selected) continue;

    const position = _randomPointInMap(mapConfig.terrainSize);
    spawnMonster(selected.monsterId, position);
  }
}

function _spawnMapNpcs(mapConfig) {
  if (!_npcsConfig || !Array.isArray(mapConfig.npcs) || mapConfig.npcs.length === 0) return;

  const filtered = {
    npcs: _npcsConfig.npcs.filter(npc => mapConfig.npcs.includes(npc.id))
  };

  if (filtered.npcs.length > 0) {
    spawnFromConfig(filtered);
  }
}

function _applyMapAudio(mapConfig) {
  const profile = mapConfig.audioProfile ?? {};
  const bgmId = profile.bgm;

  if (bgmId) {
    playBGM(`assets/audio/bgm/${bgmId}.ogg`);
  }
  // TODO PARTE 4: startAmbient com ambient sounds
}

function _updatePlayerCurrentMap(mapId) {
  emit('playerCurrentMapChanged', { mapId });
}

function _pickWeightedMonster(pool) {
  let totalWeight = 0;

  for (const entry of pool) {
    totalWeight += Math.max(0, Number(entry.weight || 0));
  }

  if (totalWeight <= 0) return null;

  const roll = Math.random() * totalWeight;
  let accumulated = 0;

  for (const entry of pool) {
    accumulated += Math.max(0, Number(entry.weight || 0));
    if (roll <= accumulated) {
      return entry;
    }
  }

  return pool[pool.length - 1] ?? null;
}

function _randomPointInMap(terrainSize) {
  const half = terrainSize * 0.5;
  return {
    x: (Math.random() * terrainSize) - half,
    y: 0.5,
    z: (Math.random() * terrainSize) - half
  };
}

function _distanceToExit(playerPos, exitPos) {
  const dx = playerPos.x - exitPos.x;
  const dy = (playerPos.y ?? 0) - (exitPos.y ?? 0);
  const dz = playerPos.z - exitPos.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function _disposeObject(object) {
  if (!object) return;

  if (object.geometry?.dispose) {
    object.geometry.dispose();
  }

  if (Array.isArray(object.material)) {
    for (const material of object.material) {
      material?.dispose?.();
    }
  } else if (object.material?.dispose) {
    object.material.dispose();
  }
}