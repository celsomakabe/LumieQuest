/**
 * @module vfx
 * @description Sistema de efeitos visuais mesh-based para skills.
 * Pool de efeitos reutilizáveis com geometrias compartilhadas por tipo
 * (melee, ranged, magic, buff). Cada efeito anima escala/rotação/posição
 * e faz fade de um PointLight filho ao longo da vida útil.
 */

import * as THREE from 'three';
import { getScene } from '../world/scene.js';

/** Tamanho do pool de efeitos ativos simultâneos (R6: 60fps / 50 draw calls). */
const POOL_SIZE = 20;

/**
 * Definições por tipo: geometria compartilhada, cor, duração e curva de animação.
 * @type {Object.<string, { color: number, duration: number }>}
 */
const TYPE_DEFS = {
  melee: { color: 0xff6600, duration: 0.45 },
  ranged: { color: 0x33ff33, duration: 0.50 },
  magic: { color: 0x9933ff, duration: 0.60 },
  buff: { color: 0xffcc00, duration: 0.70 },
};

/** @type {THREE.Scene|null} */
let _scene = null;

/** Geometrias compartilhadas por tipo (não recriadas por efeito). */
const _geometries = {};

/** Materiais compartilhados por tipo. */
const _materials = {};

/**
 * Pool de efeitos: cada entrada é { mesh, light, type, age, active }.
 * @type {Array<{mesh: THREE.Mesh, light: THREE.PointLight, type: string, age: number, active: boolean}>}
 */
const _pool = [];

/**
 * Cria as geometrias e materiais compartilhados por tipo.
 */
function _buildSharedResources() {
  _geometries.melee = new THREE.RingGeometry(0.6, 0.8, 32);
  _geometries.ranged = new THREE.SphereGeometry(0.5, 16, 12);
  _geometries.magic = new THREE.TorusGeometry(0.8, 0.15, 12, 32);
  _geometries.buff = new THREE.CylinderGeometry(0.6, 0.6, 1, 16, 1, true);

  for (const type of Object.keys(TYPE_DEFS)) {
    _materials[type] = new THREE.MeshBasicMaterial({
      color: TYPE_DEFS[type].color,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      opacity: 1,
    });
  }
}

/**
 * Inicializa o sistema de VFX e popula o pool de efeitos na cena.
 * @param {THREE.Scene} [scene]
 */
export function init(scene) {
  if (_pool.length > 0) return;
  _scene = scene ?? getScene();
  if (!_scene) {
    console.warn('[vfx] Cena não encontrada. init() adiado.');
    return;
  }

  _buildSharedResources();

  for (let i = 0; i < POOL_SIZE; i++) {
    const mesh = new THREE.Mesh(_geometries.melee, _materials.melee);
    mesh.name = 'vfxEffect';
    mesh.visible = false;

    const light = new THREE.PointLight(TYPE_DEFS.melee.color, 0, 4);
    mesh.add(light);

    _scene.add(mesh);

    _pool.push({ mesh, light, type: 'melee', age: 0, active: false });
  }

  console.log('[vfx] Sistema inicializado com pool de', POOL_SIZE, 'efeitos.');
}

/**
 * Encontra uma entrada livre no pool, ou recicla a mais antiga se todas ocupadas.
 * @returns {{mesh: THREE.Mesh, light: THREE.PointLight, type: string, age: number, active: boolean}|null}
 */
function _findFreeSlot() {
  for (const slot of _pool) {
    if (!slot.active) return slot;
  }
  let oldest = null;
  for (const slot of _pool) {
    if (!oldest || slot.age > oldest.age) oldest = slot;
  }
  return oldest;
}

/**
 * Dispara um efeito visual de skill na posição informada.
 * @param {'melee'|'ranged'|'magic'|'buff'} type
 * @param {{x:number,y:number,z:number}} position
 * @param {{scale?:number}} [options]
 */
export function playEffect(type, position, options = {}) {
  if (!_scene || _pool.length === 0) return;
  const def = TYPE_DEFS[type];
  if (!def) return;

  const slot = _findFreeSlot();
  if (!slot) return;

  slot.mesh.geometry = _geometries[type];
  slot.mesh.material = _materials[type];
  slot.type = type;
  slot.age = 0;
  slot.active = true;
  slot.scale = options.scale ?? 1;

  slot.mesh.position.set(position.x, position.y ?? 0, position.z);
  slot.mesh.rotation.set(0, 0, 0);
  slot.mesh.scale.setScalar(0.0001);
  slot.mesh.visible = true;
  slot.mesh.material.opacity = 1;

  slot.light.color.setHex(def.color);
  slot.light.intensity = 2;

  if (type === 'melee') {
    slot.mesh.rotation.x = -Math.PI / 2; // Ring plano no chão
  } else if (type === 'buff') {
    slot.mesh.position.y = (position.y ?? 0) + 0.01; // base da coluna no chão
  }
}

/**
 * Atualiza a animação de todos os efeitos ativos no pool.
 * @param {number} dt segundos
 */
export function update(dt) {
  if (_pool.length === 0) return;

  for (const slot of _pool) {
    if (!slot.active) continue;

    slot.age += dt;
    const def = TYPE_DEFS[slot.type];
    const t = Math.min(1, slot.age / def.duration);

    if (slot.age >= def.duration) {
      slot.active = false;
      slot.mesh.visible = false;
      slot.light.intensity = 0;
      continue;
    }

    const baseScale = slot.scale ?? 1;

    if (slot.type === 'melee') {
      // expande 0 -> 1.5 em 0.45s
      const s = 1.5 * t * baseScale;
      slot.mesh.scale.set(s, s, s);
      slot.mesh.material.opacity = 1 - t;
    } else if (slot.type === 'ranged') {
      // pulse 0.5 -> 1.2 -> 0 em 0.50s
      const s = (t < 0.5
        ? THREE.MathUtils.lerp(0.5, 1.2, t / 0.5)
        : THREE.MathUtils.lerp(1.2, 0, (t - 0.5) / 0.5)) * baseScale;
      slot.mesh.scale.set(s, s, s);
      slot.mesh.material.opacity = 1 - t;
    } else if (slot.type === 'magic') {
      // gira em Y, expande 0 -> 2.0 em 0.60s
      slot.mesh.rotation.y += dt * 8.0;
      const s = 2.0 * t * baseScale;
      slot.mesh.scale.set(s, s, s);
      slot.mesh.material.opacity = 1 - t;
    } else if (slot.type === 'buff') {
      // sobe 0 -> 4 em 0.70s
      const h = 4.0 * t * baseScale;
      slot.mesh.scale.set(baseScale, h, baseScale);
      slot.mesh.material.opacity = 1 - t;
    }

    slot.light.intensity = 2 * (1 - t);
  }
}

/**
 * Libera geometrias, materiais e remove os meshes da cena.
 */
export function dispose() {
  for (const slot of _pool) {
    if (_scene) _scene.remove(slot.mesh);
  }
  _pool.length = 0;

  for (const type of Object.keys(_geometries)) {
    _geometries[type].dispose();
    delete _geometries[type];
  }
  for (const type of Object.keys(_materials)) {
    _materials[type].dispose();
    delete _materials[type];
  }

  _scene = null;
}
