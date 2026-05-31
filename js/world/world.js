import * as THREE from 'three';
import { getScene, getCamera, add, remove, updateLighting, setSkybox } from './scene.js';
import { spawnMonster, spawnGroup } from '../entities/monsters.js';
import { spawnFromConfig } from '../entities/npcs.js';
import * as Models from '../core/models.js';
import { playBGM, playSFX } from '../core/audio.js';
import { getPosition, getState, getInstance, setPosition } from '../entities/player.js';
import { on, off, emit } from '../core/events.js';

let _maps = [];
let _mapsById = new Map();
let _currentMapId = null;
let _collisionBoxes = [];
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
 * Inicializa o mÃ³dulo de mundo e carrega maps.json.
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
    const fromMap = _currentMapId;
    loadMap(targetMap, fromMap);
  };

  on('exitPointAction', _boundExitPointAction);
}

/**
 * Carrega um mapa pelo id.
 * @param {string} mapId
 * @returns {Promise<void>}
 */
export async function loadMap(mapId, fromMapId) {
  const nextMap = _mapsById.get(mapId);
  if (!nextMap) {
    console.warn(`[world] Mapa desconhecido: ${mapId}`);
    return;
  }

  const previousMapId = _currentMapId;
  emit('mapUnloading', previousMapId);
  _collisionBoxes.length = 0;

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
  _spawnExitPointMarkers(nextMap);
  _applyMapAudio(nextMap);
  _updatePlayerCurrentMap(mapId);
  const skyboxUrls = nextMap.skybox ?? null;
  setSkybox(skyboxUrls);
  updateLighting('day', 1.0, nextMap.lighting ?? {});
  emit('weatherChanged', { weather: 'clear' });

  // Posicionar player no exit point que leva de volta ao mapa de origem
  if (fromMapId) {
    const arrivals = Array.isArray(nextMap.exitPoints) ? nextMap.exitPoints : [];
    const arrival = arrivals.find(ep => ep.targetMap === fromMapId);
    if (arrival?.position) {
      const px = Number(arrival.position.x ?? 0);
      const pz = Number(arrival.position.z ?? 0);
      setPosition(px, 0, pz);
      console.log('[world] Player posicionado no exit point (' + px + ', ' + pz + ')');
    }
  }

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
 * Atualiza lÃ³gica do mundo.
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

// â”€â”€â”€ FunÃ§Ãµes privadas â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
    if (count <= 0 && !Array.isArray(entry.positions) && !entry.type) continue;

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
  if (entry?.type === 'ground_plane') {
    const width = Number(entry.width ?? 160);
    const height = Number(entry.height ?? 160);
    const y = Number(entry.y ?? 0.02);
    const texturePath = entry.texture ?? 'assets/textures/terrain/cobblestone.jpg';
    const loader = new THREE.TextureLoader();
    const texture = await new Promise(resolve => {
      loader.load(texturePath, resolve, undefined, () => resolve(null));
    });
    if (!texture) return;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(Math.max(1, width / 8), Math.max(1, height / 8));
    texture.anisotropy = 16;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshStandardMaterial({ map: texture, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(entry.x ?? 0, y, entry.z ?? 0);
    mesh.receiveShadow = true;
    group.add(mesh);
    return;
  }

  if (!entry?.path) return;

  let gltf = null;
  try {
    gltf = await Models.loadModel(entry.path);
  } catch (err) {
    console.warn(`[world] Falha ao carregar decoraÃ§Ã£o: ${entry.model ?? entry.path}`, err);
    return;
  }

  if (!gltf?.scene) return;
  // PosiÃ§Ã£o fixa: entry.positions sobrepÃµe area/count
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
      // Colisao com construcoes (ignora objetos pequenos)
      instance.updateWorldMatrix(true, true);
      const _cbox = new THREE.Box3().setFromObject(instance);
      if (_cbox.max.x - _cbox.min.x > 1.5 && _cbox.max.z - _cbox.min.z > 1.5 && !entry.path?.includes('wall_')) {
        _collisionBoxes.push({ minX: _cbox.min.x, maxX: _cbox.max.x, minZ: _cbox.min.z, maxZ: _cbox.max.z });
      }
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
function _spawnExitPointMarkers(mapConfig) {
  const exits = Array.isArray(mapConfig.exitPoints) ? mapConfig.exitPoints : [];
  for (const ep of exits) {
    const x = Number(ep.position?.x ?? 0);
    const z = Number(ep.position?.z ?? 0);
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    // Anel portal
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.5, 0.15, 12, 32),
      new THREE.MeshStandardMaterial({ color: 0x00ccff, emissive: 0x0088ff, emissiveIntensity: 0.8, transparent: true, opacity: 0.7 })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.3;
    group.add(ring);

    // Pilar de luz
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.3, 4, 8),
      new THREE.MeshStandardMaterial({ color: 0x00aaff, emissive: 0x0066cc, emissiveIntensity: 0.6, transparent: true, opacity: 0.35 })
    );
    pillar.position.y = 2;
    group.add(pillar);

    // Label com canvas texture
    const label = ep.label || ep.targetMap || '???';
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, 256, 64);
    ctx.font = 'bold 24px sans-serif';
    ctx.fillStyle = '#00eeff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 128, 32);
    const tex = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    sprite.scale.set(4, 1, 1);
    sprite.position.y = 4.5;
    group.add(sprite);

    add(group);
    _mapObjects.push(group);
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
  const half = 70;
  return {
    x: (Math.random() * half * 2) - half,
    y: 0.5,
    z: (Math.random() * half * 2) - half
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

// â”€â”€â”€ Ciclo dia/noite â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// _cacheSceneLights removido: iluminaÃ§Ã£o gerenciada por scene.js via updateLighting()

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




// â”€â”€â”€ Clima â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€â”€ Eventos de fase â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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


export function getCollisionBoxes() { return _collisionBoxes; }

