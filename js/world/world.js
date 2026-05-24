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
let _cycleTime = 0;
let _weatherTime = 0;
let _currentWeather = 'clear';
let _currentPhase = 'day';
let _hemiLight = null;
let _sunLight = null;
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

  _spawnMapMonsters(nextMap);
  _spawnMapNpcs(nextMap);
  _applyMapAudio(nextMap);
  _updatePlayerCurrentMap(mapId);
  _cacheSceneLights();
  _applyCurrentLighting();
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

  _mapObjects = [];
  _terrainMesh = null;
  _cycleTime = 0;
  _weatherTime = 0;
  _currentWeather = 'clear';
  _currentPhase = 'day';
  _lastEmittedPhase = null;
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

// ─── Ciclo dia/noite ──────────────────────────────────────────────────────────

function _cacheSceneLights() {
  const scene = getScene();
  if (!scene) return;

  _hemiLight = null;
  _sunLight = null;

  for (const child of scene.children) {
    if (!_hemiLight && child instanceof THREE.HemisphereLight) {
      _hemiLight = child;
      continue;
    }

    if (!_sunLight && child instanceof THREE.DirectionalLight) {
      _sunLight = child;
    }

    if (_hemiLight && _sunLight) break;
  }
}

function _updateDayNightCycle(delta) {
  if (!_currentMapConfig) return;

  const isOutdoor = _currentMapConfig.audioProfile?.reverb === 'outdoor';
  if (!isOutdoor) {
    _currentPhase = 'day';
    _applyIndoorLighting();
    _emitPhaseEventIfNeeded();
    return;
  }

  _cycleTime = (_cycleTime + delta) % DAY_NIGHT_CYCLE_DURATION;
  _applyOutdoorLighting();
  _emitPhaseEventIfNeeded();
}

function _applyCurrentLighting() {
  const isOutdoor = _currentMapConfig?.audioProfile?.reverb === 'outdoor';
  if (isOutdoor) {
    _applyOutdoorLighting();
    return;
  }
  _applyIndoorLighting();
}

function _applyIndoorLighting() {
  const dayLighting = _currentMapConfig?.lighting?.day;
  if (!dayLighting) return;

  _currentPhase = 'day';
  _applyLightingValues(dayLighting);
}

function _applyOutdoorLighting() {
  const dayLighting = _currentMapConfig?.lighting?.day;
  const nightLighting = _currentMapConfig?.lighting?.night;
  if (!dayLighting || !nightLighting) return;

  const cycleProgress = _cycleTime / DAY_NIGHT_CYCLE_DURATION;
  let lighting = dayLighting;

  if (cycleProgress < 0.25) {
    _currentPhase = 'dawn';
    lighting = _interpolateLighting(nightLighting, dayLighting, cycleProgress / 0.25);
  } else if (cycleProgress < 0.75) {
    _currentPhase = 'day';
    lighting = dayLighting;
  } else if (cycleProgress < 0.85) {
    _currentPhase = 'dusk';
    lighting = _interpolateLighting(dayLighting, nightLighting, (cycleProgress - 0.75) / 0.10);
  } else {
    _currentPhase = 'night';
    lighting = nightLighting;
  }

  _applyLightingValues(lighting);
}

function _applyLightingValues(lighting) {
  if (!_hemiLight || !_sunLight || !lighting) return;

  if (lighting.ambient) {
    _hemiLight.color.set(lighting.ambient);
  }
  if (typeof lighting.intensity === 'number') {
    _hemiLight.intensity = lighting.intensity;
    _sunLight.intensity = lighting.intensity;
  }
  if (lighting.directional) {
    _sunLight.color.set(lighting.directional);
  }
}

function _interpolateLighting(fromLighting, toLighting, t) {
  const clampedT = THREE.MathUtils.clamp(t, 0, 1);

  return {
    ambient: _lerpColor(fromLighting.ambient, toLighting.ambient, clampedT),
    directional: _lerpColor(fromLighting.directional, toLighting.directional, clampedT),
    intensity: THREE.MathUtils.lerp(fromLighting.intensity ?? 0, toLighting.intensity ?? 0, clampedT)
  };
}

function _lerpColor(fromColor, toColor, t) {
  const from = new THREE.Color(fromColor ?? '#ffffff');
  const to = new THREE.Color(toColor ?? '#ffffff');
  return `#${from.lerp(to, t).getHexString()}`;
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