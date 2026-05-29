import * as THREE from 'three';
import { getScene, getCamera, add, remove, updateLighting, setSkybox } from './scene.js';
import { spawnMonster, spawnGroup } from '../entities/monsters.js';
import { spawnFromConfig } from '../entities/npcs.js';
import * as Models from '../core/models.js';
import { playBGM, playSFX } from '../core/audio.js';
import { getPosition, getState } from '../entities/player.js';
import { on, off, emit } from '../core/events.js';

let _maps = [];
let _mapsById = new Map();
let _currentMapId = null;
let _currentMapConfig = null;
let _terrainMesh = null;
let _decorationGroup = null;
let _instancedMeshes = [];
let _mapObjects = [];
let _exitNearTarget = null;
let _npcsConfig = null;
let _boundExitPointAction = null;
let _cycleTime = 150;
let _weatherTime = 0;
let _currentWeather = 'clear';
let _currentPhase = 'day';
let _lastEmittedPhase = null;

const DAY_NIGHT_CYCLE_DURATION = 300;

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

  await _spawnMapDecoration(nextMap);
  await _spawnMapMonsters(nextMap);
  await _spawnMapNpcs(nextMap);
  _applyMapAudio(nextMap);
  _updatePlayerCurrentMap(mapId);
  const skyboxUrls = nextMap.skybox ?? null;
  setSkybox(skyboxUrls);
  updateLighting('day', 1.0, nextMap.lighting ?? {});
  emit('weatherChanged', { weather: 'clear' });

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
 * Retorna estado atual do ciclo dia/noite.
 * @returns {{ phase: 'day'|'night'|'dawn'|'dusk', progress: number }}
 */
export function getDayNightCycle() {
  return {
    phase: _currentPhase,
    progress: _getPhaseProgress(_cycleTime / DAY_NIGHT_CYCLE_DURATION)
  };
}

/**
 * Atualiza lógica do mundo.
 * @param {number} delta
 * @returns {void}
 */
export function update(delta) {
  if (!_currentMapConfig) return;

  _updateDayNightCycle(delta);
  _updateWeather(delta);

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

// ─── Funções privadas ─────────────────────────────────────────────────────────

function _clearCurrentMap() {
  // TODO PARTE 4: stopAmbient()

  for (const obj of _mapObjects) {
    remove(obj);
    _disposeObject(obj);
  }
for (const im of _instancedMeshes) {
    remove(im);
    im.geometry?.dispose?.();
    if (Array.isArray(im.material)) {
      im.material.forEach(m => m?.dispose?.());
    } else {
      im.material?.dispose?.();
    }
  }
  _instancedMeshes = [];
  _mapObjects = [];
  _decorationGroup = null;
  _terrainMesh = null;
  _cycleTime = 150;
  _weatherTime = 0;
  _currentWeather = 'clear';
  _currentPhase = 'day';
  _lastEmittedPhase = null;
}

function _createTerrain(mapConfig) {
  const geometry = new THREE.PlaneGeometry(mapConfig.terrainSize, mapConfig.terrainSize);
  const material = new THREE.MeshLambertMaterial({
    color: mapConfig.terrainColor ?? '#7caa5a'
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  mesh.name = `terrain_${mapConfig.id}`;
  mesh.position.y = -0.01;

  if (mapConfig.terrainTexture) {
    const loader = new THREE.TextureLoader();
    loader.load(
      mapConfig.terrainTexture,
      (texture) => {
        if (!mesh.parent) return;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        const tileCount = Math.round(mapConfig.terrainSize / 10);
        texture.repeat.set(tileCount, tileCount);
        material.map = texture;
        material.color.set(0xffffff);
        material.needsUpdate = true;
      },
      undefined,
      (err) => {
        console.warn(`[world] Falha ao carregar terrainTexture: ${mapConfig.terrainTexture}`, err);
      }
    );
  }

  return mesh;
}
async function _spawnMapDecoration(mapConfig) {
  const decorations = Array.isArray(mapConfig.decoration) ? mapConfig.decoration : [];
  if (decorations.length === 0) return;

  _decorationGroup = new THREE.Group();
  _decorationGroup.name = 'decorationGroup';
  add(_decorationGroup);
  _mapObjects.push(_decorationGroup);

  const proceduralByModel = new Map();
  const nonProcedural = [];

  for (const entry of decorations) {
    const count = Math.max(0, Number(entry.count || 0));
    if (count <= 0 && !Array.isArray(entry.positions)) continue;

    if (entry.procedural === true) {
      const key = entry.model ?? 'unknown';
      if (!proceduralByModel.has(key)) {
        proceduralByModel.set(key, { entry, totalCount: 0, entries: [] });
      }
      const bucket = proceduralByModel.get(key);
      bucket.totalCount += count;
      bucket.entries.push({ entry, count });
    } else {
      nonProcedural.push({ entry, count });
    }
  }

  for (const [model, bucket] of proceduralByModel) {
    _spawnProceduralInstancedMesh(model, bucket);
  }

  for (const { entry, count } of nonProcedural) {
    await _spawnModelDecoration(entry, count, _decorationGroup);
  }
}

async function _spawnModelDecoration(entry, count, group) {
  if (!entry?.path) return;

  let gltf = null;
  try {
    gltf = await Models.loadModel(entry.path);
  } catch (err) {
    console.warn(`[world] Falha ao carregar decoração: ${entry.model ?? entry.path}`, err);
    return;
  }

  if (!gltf?.scene) return;
// Posição fixa: entry.positions sobrepõe area/count
  if (Array.isArray(entry.positions) && entry.positions.length > 0) {
    for (const pos of entry.positions) {
      const instance = Models.cloneModel(gltf);
      if (!instance) continue;
      instance.position.set(Number(pos.x ?? 0), Number(pos.y ?? 0), Number(pos.z ?? 0));
      instance.rotation.y = Number(pos.rotY ?? 0);
      instance.scale.setScalar(Number(pos.scale ?? 1));
      instance.traverse?.((child) => {
        if (child?.isMesh) {
          child.castShadow = false;
          child.receiveShadow = true;
        }
      });
      group.add(instance);
    }
    return;
  }
  for (let i = 0; i < count; i++) {
    const instance = Models.cloneModel(gltf);
    if (!instance) continue;

    _applyDecorationTransform(instance, entry);
    instance.traverse?.((child) => {
      if (child?.isMesh) {
        child.castShadow = false;
        child.receiveShadow = false;
      }
    });
    group.add(instance);
  }
}

function _spawnProceduralInstancedMesh(modelKey, bucket) {
  const { totalCount, entries } = bucket;
  if (totalCount <= 0) return;

  const geometry = _createProceduralGeometry(modelKey);
  if (!geometry) return;

  const material = new THREE.MeshStandardMaterial({
    color: _getProceduralColor(modelKey),
    roughness: 1,
    metalness: 0
  });

  const instanced = new THREE.InstancedMesh(geometry, material, totalCount);
  instanced.name = `instanced_${modelKey}`;
  instanced.castShadow = false;
  instanced.receiveShadow = false;

  const dummy = new THREE.Object3D();
  let idx = 0;

  for (const { entry, count } of entries) {
    for (let i = 0; i < count; i++) {
      _applyDecorationTransform(dummy, entry);
      dummy.updateMatrix();
      instanced.setMatrixAt(idx, dummy.matrix);
      idx++;
    }
  }

  instanced.instanceMatrix.needsUpdate = true;

  add(instanced);
  _instancedMeshes.push(instanced);
}

function _applyDecorationTransform(object, entry) {
  const area = entry.area ?? {};
  const xMin = Number(area.xMin ?? -10);
  const xMax = Number(area.xMax ?? 10);
  const zMin = Number(area.zMin ?? -10);
  const zMax = Number(area.zMax ?? 10);
  const scaleRange = Array.isArray(entry.scaleRange) ? entry.scaleRange : [1, 1];
  const minScale = Number(scaleRange[0] ?? 1);
  const maxScale = Number(scaleRange[1] ?? minScale);
  const x = THREE.MathUtils.lerp(xMin, xMax, Math.random());
  const z = THREE.MathUtils.lerp(zMin, zMax, Math.random());
  const y = _getGroundHeight(x, z);
  const scale = THREE.MathUtils.lerp(minScale, maxScale, Math.random());

  object.position.set(x, y, z);
  object.scale.setScalar(scale);

  if (entry.rotateY) {
    object.rotation.y = Math.random() * Math.PI * 2;
  }
}

function _createProceduralGeometry(kind) {
  switch (kind) {
    case 'pillar_cylinder':
      return new THREE.CylinderGeometry(0.45, 0.6, 2.6, 8);
    case 'broken_pillar':
      return new THREE.CylinderGeometry(0.45, 0.7, 1.6, 8);
    case 'torch_placeholder':
      return new THREE.CylinderGeometry(0.08, 0.1, 1.4, 6);
    case 'skull_placeholder':
      return new THREE.SphereGeometry(0.35, 10, 8);
    case 'rock_sphere':
    default:
      return new THREE.SphereGeometry(0.7, 10, 8);
  }
}

function _getProceduralColor(kind) {
  switch (kind) {
    case 'pillar_cylinder':
    case 'broken_pillar':
      return '#7a6a56';
    case 'torch_placeholder':
      return '#8a5a2b';
    case 'skull_placeholder':
      return '#b7b0a3';
    case 'rock_sphere':
    default:
      return '#7b7b82';
  }
}

function _getGroundHeight(x, z) {
  return 0;
}


async function _spawnMapMonsters(mapConfig) {
  const pool = Array.isArray(mapConfig.monsterPool) ? mapConfig.monsterPool : [];
  const maxMonsters = Number(mapConfig.maxMonsters || 0);

  if (pool.length === 0 || maxMonsters <= 0) return;

  for (let i = 0; i < maxMonsters; i++) {
    const selected = _pickWeightedMonster(pool);
    if (!selected) continue;

    const position = _randomPointInMap(mapConfig.terrainSize);
    await spawnMonster(selected.monsterId, position);
  }
}

async function _spawnMapNpcs(mapConfig) {
  if (!_npcsConfig || !Array.isArray(mapConfig.npcs) || mapConfig.npcs.length === 0) return;

  const filtered = {
    npcs: _npcsConfig.npcs.filter(npc => mapConfig.npcs.includes(npc.id))
  };

  if (filtered.npcs.length > 0) {
    await spawnFromConfig(filtered);
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

  object.traverse?.((child) => {
    if (child.geometry?.dispose) {
      child.geometry.dispose();
    }

    if (Array.isArray(child.material)) {
      for (const material of child.material) {
        material?.dispose?.();
      }
    } else if (child.material?.dispose) {
      child.material.dispose();
    }
  });

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

// ─── Ciclo dia/noite ──────────────────────────────────────────────────────────

// _cacheSceneLights removido: iluminação gerenciada por scene.js via updateLighting()

function _updateDayNightCycle(delta) {
  if (!_currentMapConfig) return;

  const isOutdoor = _currentMapConfig.audioProfile?.reverb === 'outdoor';
  if (!isOutdoor) {
    _currentPhase = 'day';
    _emitPhaseEventIfNeeded();
    updateLighting('day', 1.0, _currentMapConfig.lighting ?? {});
    return;
  }

  _cycleTime = (_cycleTime + delta) % DAY_NIGHT_CYCLE_DURATION;
  const cycleProgress = _cycleTime / DAY_NIGHT_CYCLE_DURATION;

  let phase, phaseProgress;

  if (cycleProgress < 0.25) {
    phase         = 'dawn';
    phaseProgress = cycleProgress / 0.25;
  } else if (cycleProgress < 0.75) {
    phase         = 'day';
    phaseProgress = (cycleProgress - 0.25) / 0.50;
  } else if (cycleProgress < 0.85) {
    phase         = 'dusk';
    phaseProgress = (cycleProgress - 0.75) / 0.10;
  } else {
    phase         = 'night';
    phaseProgress = (cycleProgress - 0.85) / 0.15;
  }

  _currentPhase = phase;
  _emitPhaseEventIfNeeded();
  updateLighting(phase, phaseProgress, _currentMapConfig.lighting ?? {});
}




// ─── Clima ────────────────────────────────────────────────────────────────────

function _updateWeather(delta) {
  if (!_currentMapConfig) return;

  const weatherProfile = _currentMapConfig.weatherProfile ?? {};
  const options = Array.isArray(weatherProfile.options) ? weatherProfile.options : ['none'];
  const validOptions = options.filter(option => option !== 'none');
  const changeInterval = Number(weatherProfile.changeInterval || 0);

  if (validOptions.length === 0 || changeInterval <= 0) {
    if (_currentWeather !== 'clear') {
      _currentWeather = 'clear';
      emit('weatherChanged', { weather: 'clear' });
    }
    return;
  }

  _weatherTime += delta;
  if (_weatherTime < changeInterval) return;

  _weatherTime = 0;
  const nextWeather = validOptions[Math.floor(Math.random() * validOptions.length)] ?? 'clear';

  if (nextWeather === _currentWeather) return;

  _currentWeather = nextWeather;
  emit('weatherChanged', { weather: nextWeather });
}

// ─── Eventos de fase ──────────────────────────────────────────────────────────

function _emitPhaseEventIfNeeded() {
  if (_lastEmittedPhase === _currentPhase) return;

  const previousPhase = _lastEmittedPhase;
  _lastEmittedPhase = _currentPhase;

  if (_currentPhase === 'night' && previousPhase !== 'night') {
    emit('nightStarted');
  }

  if ((_currentPhase === 'day' || _currentPhase === 'dawn') && previousPhase === 'night') {
    emit('dayStarted');
  }
}

function _getPhaseProgress(cycleProgress) {
  if (_currentPhase === 'dawn') {
    return THREE.MathUtils.clamp(cycleProgress / 0.25, 0, 1);
  }
  if (_currentPhase === 'day') {
    return THREE.MathUtils.clamp((cycleProgress - 0.25) / 0.50, 0, 1);
  }
  if (_currentPhase === 'dusk') {
    return THREE.MathUtils.clamp((cycleProgress - 0.75) / 0.10, 0, 1);
  }
  return THREE.MathUtils.clamp((cycleProgress - 0.85) / 0.15, 0, 1);
}