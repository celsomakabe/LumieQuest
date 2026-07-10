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

// ─── Projéteis (efeito que VIAJA da origem ao destino) ────────────────────────

/** Tamanho do pool de projéteis simultâneos. */
const PROJ_POOL_SIZE = 12;
/** Nº de vértices do rastro (trail) de cada projétil. */
const PROJ_TRAIL_POINTS = 10;
/** Cor padrão do projétil (verde energia). */
const PROJ_DEFAULT_COLOR = 0x66ff66;
/** Velocidade padrão em unidades/segundo (usada quando não há duration explícita). */
const PROJ_DEFAULT_SPEED = 32;

/** Geometria compartilhada da "cabeça" do projétil (esfera brilhante). */
let _projGeometry = null;

/**
 * Pool de projéteis. Cada slot tem head (mesh esfera), light (PointLight filho),
 * trail (THREE.Line em espaço de mundo) e o estado da viagem.
 * @type {Array<Object>}
 */
const _projPool = [];

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

  _buildProjectilePool();

  console.log('[vfx] Sistema inicializado com pool de', POOL_SIZE, 'efeitos e', PROJ_POOL_SIZE, 'projéteis.');
}

/**
 * Cria o pool de projéteis (esfera + luz + rastro) e adiciona à cena.
 */
function _buildProjectilePool() {
  _projGeometry = new THREE.SphereGeometry(0.18, 12, 10);

  for (let i = 0; i < PROJ_POOL_SIZE; i++) {
    // Cabeça: esfera aditiva. Material próprio por slot (cor independente).
    const headMat = new THREE.MeshBasicMaterial({
      color: PROJ_DEFAULT_COLOR,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const head = new THREE.Mesh(_projGeometry, headMat);
    head.name = 'vfxProjectile';
    head.visible = false;
    head.frustumCulled = false;

    // Luz que acompanha o projétil (filha da cabeça).
    const light = new THREE.PointLight(PROJ_DEFAULT_COLOR, 0, 6);
    head.add(light);
    _scene.add(head);

    // Rastro: Line em espaço de mundo, com histórico de posições e fade por vértice.
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PROJ_TRAIL_POINTS * 3), 3));
    trailGeo.setAttribute('color',    new THREE.BufferAttribute(new Float32Array(PROJ_TRAIL_POINTS * 3), 3));
    const trailMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const trail = new THREE.Line(trailGeo, trailMat);
    trail.name = 'vfxProjectileTrail';
    trail.visible = false;
    trail.frustumCulled = false;
    _scene.add(trail);

    const history = [];
    for (let h = 0; h < PROJ_TRAIL_POINTS; h++) history.push(new THREE.Vector3());

    _projPool.push({
      head, light, trail, history,
      from: new THREE.Vector3(),
      to:   new THREE.Vector3(),
      t: 0,
      duration: 0.0001,
      active: false,
      useTrail: true,
      colR: 1, colG: 1, colB: 1,
    });
  }
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
 * Encontra um slot de projétil livre, ou recicla o mais avançado na viagem.
 * @returns {Object|null}
 */
function _findFreeProjSlot() {
  for (const slot of _projPool) {
    if (!slot.active) return slot;
  }
  let best = null;
  for (const slot of _projPool) {
    if (!best || slot.t > best.t) best = slot;
  }
  return best;
}

/**
 * Dispara um projétil que viaja de fromPos até toPos ao longo do tempo, com luz
 * acompanhando e rastro opcional. Recicla no pool ao chegar. Não afeta playEffect.
 * @param {{x:number,y:number,z:number}} fromPos - origem (ex.: player)
 * @param {{x:number,y:number,z:number}} toPos   - destino (ex.: monstro)
 * @param {{ color?: number, scale?: number, speed?: number, duration?: number, trail?: boolean }} [options]
 *   color: cor hex; scale: multiplicador do tamanho da esfera; speed: unidades/s;
 *   duration: segundos de viagem (sobrepõe speed); trail: liga/desliga o rastro (default true).
 */
export function playProjectile(fromPos, toPos, options = {}) {
  if (!_scene || _projPool.length === 0) return;
  if (!fromPos || !toPos) return;

  const slot = _findFreeProjSlot();
  if (!slot) return;

  slot.from.set(fromPos.x, fromPos.y ?? 0, fromPos.z);
  slot.to.set(toPos.x, toPos.y ?? 0, toPos.z);
  const dist = slot.from.distanceTo(slot.to);
  if (dist < 0.0001) return; // origem == destino: nada a viajar

  const color = options.color ?? PROJ_DEFAULT_COLOR;
  const scale = options.scale ?? 1;
  const speed = options.speed ?? PROJ_DEFAULT_SPEED;

  slot.active = true;
  slot.t = 0;
  slot.duration = Math.max(0.0001, options.duration ?? (dist / speed));
  slot.useTrail = options.trail !== false;

  const c = new THREE.Color(color);
  slot.colR = c.r; slot.colG = c.g; slot.colB = c.b;

  slot.head.material.color.copy(c);
  slot.head.material.opacity = 1;
  slot.head.scale.setScalar(scale);
  slot.head.position.copy(slot.from);
  slot.head.visible = true;

  slot.light.color.copy(c);
  slot.light.intensity = 2.4;

  // Rastro começa colapsado na origem.
  for (const p of slot.history) p.copy(slot.from);
  slot.trail.visible = slot.useTrail;
  if (slot.useTrail) _writeTrail(slot);
}

/**
 * Escreve o histórico de posições e o fade de cor nos buffers do rastro.
 * @param {Object} slot
 */
function _writeTrail(slot) {
  const posAttr = slot.trail.geometry.getAttribute('position');
  const colAttr = slot.trail.geometry.getAttribute('color');
  const last = PROJ_TRAIL_POINTS - 1;
  for (let i = 0; i < PROJ_TRAIL_POINTS; i++) {
    const p = slot.history[i];
    posAttr.setXYZ(i, p.x, p.y, p.z);
    const f = 1 - i / last; // 1 na cabeça → 0 na cauda (aditivo: preto = invisível)
    colAttr.setXYZ(i, slot.colR * f, slot.colG * f, slot.colB * f);
  }
  posAttr.needsUpdate = true;
  colAttr.needsUpdate = true;
}

/**
 * Avança todos os projéteis ativos. Chamado por update().
 * @param {number} dt segundos
 */
function _updateProjectiles(dt) {
  for (const slot of _projPool) {
    if (!slot.active) continue;

    slot.t += dt / slot.duration;
    const t = Math.min(1, slot.t);
    slot.head.position.lerpVectors(slot.from, slot.to, t);

    if (slot.useTrail) {
      for (let i = PROJ_TRAIL_POINTS - 1; i > 0; i--) slot.history[i].copy(slot.history[i - 1]);
      slot.history[0].copy(slot.head.position);
      _writeTrail(slot);
    }

    if (t >= 1) {
      slot.active = false;
      slot.head.visible = false;
      slot.light.intensity = 0;
      slot.trail.visible = false;
    }
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

  _updateProjectiles(dt);
}

/**
 * Libera geometrias, materiais e remove os meshes da cena.
 */
export function dispose() {
  for (const slot of _pool) {
    if (_scene) _scene.remove(slot.mesh);
  }
  _pool.length = 0;

  for (const slot of _projPool) {
    if (_scene) {
      _scene.remove(slot.head);
      _scene.remove(slot.trail);
    }
    slot.head.material?.dispose?.();
    slot.trail.geometry?.dispose?.();
    slot.trail.material?.dispose?.();
  }
  _projPool.length = 0;
  _projGeometry?.dispose?.();
  _projGeometry = null;

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
