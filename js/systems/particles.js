/**
 * @module particles
 * @description Sistema de partículas 3D para dano, críticos, drops, level up,
 * skills, refino e clima (chuva e vagalumes).
 * Usa pool fixo de até 500 partículas via THREE.Points + BufferGeometry.
 */

import * as THREE from 'three';
import { getScene } from '../world/scene.js';

const MAX_PARTICLES = 500;

/**
 * Tipos suportados:
 *  - damage
 *  - critical
 *  - drop
 *  - levelup
 *  - skill
 *  - refineSuccess
 *  - refineFail
 *  - weather_rain
 *  - weather_fireflies
 */

/** @type {THREE.Points|null} */
let _points = null;
/** @type {THREE.BufferGeometry|null} */
let _geometry = null;
/** @type {THREE.ShaderMaterial|null} */
let _material = null;
/** @type {Float32Array} */
let _positions;
/** @type {Float32Array} */
let _colors;
/** @type {Float32Array} */
let _sizes;
/** @type {Float32Array} */
let _lifetimes;
/** @type {Float32Array} */
let _ages;
/** @type {Int8Array} */
let _types;

let _scene = null;

/**
 * Inicializa o sistema de partículas e adiciona o Points à cena.
 * @param {THREE.Scene} scene
 */
export function init(scene) {
  if (_points) return;
  _scene = scene ?? getScene();
  if (!_scene) {
    console.warn('[particles] Cena não encontrada. init() adiado.');
    return;
  }

  _positions = new Float32Array(MAX_PARTICLES * 3);
  _colors    = new Float32Array(MAX_PARTICLES * 3);
  _sizes     = new Float32Array(MAX_PARTICLES);
  _lifetimes = new Float32Array(MAX_PARTICLES);
  _ages      = new Float32Array(MAX_PARTICLES);
  _types     = new Int8Array(MAX_PARTICLES);

  _geometry = new THREE.BufferGeometry();
  _geometry.setAttribute('position', new THREE.BufferAttribute(_positions, 3));
  _geometry.setAttribute('color',    new THREE.BufferAttribute(_colors,    3));
  _geometry.setAttribute('size',     new THREE.BufferAttribute(_sizes,     1));

  const vertexShader = /* glsl */`
    attribute float size;
    
    varying vec3 vColor;
    void main() {
      vColor = color;
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = size * (300.0 / -mvPosition.z);
      gl_Position = projectionMatrix * mvPosition;
    }
  `;

  const fragmentShader = /* glsl */`
    varying vec3 vColor;
    void main() {
      float d = length(gl_PointCoord - vec2(0.5));
      if (d > 0.5) discard;
      gl_FragColor = vec4(vColor, 1.0 - d * 2.0);
    }
  `;

  _material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
  });

  _points = new THREE.Points(_geometry, _material);
  _points.name = 'particlesPoints';
  _scene.add(_points);

  console.log('[particles] Sistema inicializado com pool de', MAX_PARTICLES, 'partículas.');
}

/**
 * Atualiza o sistema de partículas.
 * @param {number} dt segundos
 */
export function update(dt) {
  if (!_points || !_geometry) return;
  let anyAlive = false;

  for (let i = 0; i < MAX_PARTICLES; i++) {
    if (_lifetimes[i] <= 0) continue;
    _ages[i] += dt;
    if (_ages[i] >= _lifetimes[i]) {
      _lifetimes[i] = 0;
      continue;
    }
    anyAlive = true;

    const idx = i * 3;
    const type = _types[i];

    if (type === 0) {
      // damage: sobe lentamente
      _positions[idx + 1] += dt * 1.5;
    } else if (type === 1) {
      // critical: sobe mais rápido
      _positions[idx + 1] += dt * 2.0;
    } else if (type === 2) {
      // drop sparkle: leve pulsar
      _positions[idx + 1] += Math.sin((_ages[i] + i) * 6.0) * dt * 0.2;
    } else if (type === 3) {
      // levelup: espiral sutil
      const t = _ages[i] * 4.0;
      _positions[idx]     += Math.cos(t) * dt * 0.5;
      _positions[idx + 2] += Math.sin(t) * dt * 0.5;
      _positions[idx + 1] += dt * 1.0;
    } else if (type === 4) {
      // skill: explode radialmente
      _positions[idx]     += dt * 2.0 * ((i % 3) - 1);
      _positions[idx + 2] += dt * 2.0 * (((i + 1) % 3) - 1);
    } else if (type === 5) {
      // refineSuccess: sobe e expande
      _positions[idx + 1] += dt * 2.0;
      _sizes[i] += dt * 5.0;
    } else if (type === 6) {
      // refineFail: cai e some
      _positions[idx + 1] -= dt * 1.5;
      _sizes[i] = Math.max(0.0, _sizes[i] - dt * 10.0);
    } else if (type === 7) {
      // weather_rain: cai rápido
      _positions[idx + 1] -= dt * 15.0;
      if (_positions[idx + 1] < 0.0) {
        _lifetimes[i] = 0;
      }
    } else if (type === 8) {
      // weather_fireflies: flutua
      _positions[idx]     += Math.sin((_ages[i] + i) * 2.0) * dt * 0.5;
      _positions[idx + 2] += Math.cos((_ages[i] + i) * 2.0) * dt * 0.5;
      _positions[idx + 1] += Math.sin((_ages[i] + i) * 1.5) * dt * 0.2;
    }
  }

  if (anyAlive) {
    _geometry.attributes.position.needsUpdate = true;
    _geometry.attributes.size.needsUpdate     = true;
  }
}

/**
 * Emite uma partícula de um tipo específico na posição informada.
 * @param {'damage'|'critical'|'drop'|'levelup'|'skill'|'refineSuccess'|'refineFail'|'weather_rain'|'weather_fireflies'} kind
 * @param {{x:number,y:number,z:number}} position
 */
export function emit(kind, position) {
  if (!_points || !_geometry) return;

  const typeId = _mapKindToType(kind);
  if (typeId === -1) return;

  const idx = _findFreeIndex();
  if (idx === -1) return;

  const baseIdx = idx * 3;
  _positions[baseIdx]     = position.x;
  _positions[baseIdx + 1] = position.y;
  _positions[baseIdx + 2] = position.z;

  const color = _getColorForType(typeId);
  _colors[baseIdx]     = color.r;
  _colors[baseIdx + 1] = color.g;
  _colors[baseIdx + 2] = color.b;

  _sizes[idx]     = _getSizeForType(typeId);
  _lifetimes[idx] = _getLifetimeForType(typeId);
  _ages[idx]      = 0;
  _types[idx]     = typeId;

  _geometry.attributes.position.needsUpdate = true;
  _geometry.attributes.color.needsUpdate    = true;
  _geometry.attributes.size.needsUpdate     = true;
}

/**
 * Mapeia kind textual para id interno.
 * @param {string} kind
 * @returns {number}
 */
function _mapKindToType(kind) {
  switch (kind) {
    case 'damage':          return 0;
    case 'critical':        return 1;
    case 'drop':            return 2;
    case 'levelup':         return 3;
    case 'skill':           return 4;
    case 'refineSuccess':   return 5;
    case 'refineFail':      return 6;
    case 'weather_rain':    return 7;
    case 'weather_fireflies': return 8;
    default: return -1;
  }
}

/**
 * Encontra primeiro índice livre na pool.
 * @returns {number}
 */
function _findFreeIndex() {
  for (let i = 0; i < MAX_PARTICLES; i++) {
    if (_lifetimes[i] <= 0) return i;
  }
  return -1;
}

function _getColorForType(typeId) {
  const c = new THREE.Color(0xffffff);
  switch (typeId) {
    case 0: c.set('#ff4444'); break; // damage
    case 1: c.set('#ffdd33'); break; // critical
    case 2: c.set('#33ccff'); break; // drop
    case 3: c.set('#7cff7c'); break; // levelup
    case 4: c.set('#9c27b0'); break; // skill
    case 5: c.set('#00e676'); break; // refineSuccess
    case 6: c.set('#ff1744'); break; // refineFail
    case 7: c.set('#4fc3f7'); break; // rain
    case 8: c.set('#fff176'); break; // fireflies
    default: c.set('#ffffff');       break;
  }
  return c;
}

function _getSizeForType(typeId) {
  switch (typeId) {
    case 0: return 18;
    case 1: return 22;
    case 2: return 10;
    case 3: return 24;
    case 4: return 20;
    case 5: return 26;
    case 6: return 20;
    case 7: return 8;
    case 8: return 12;
    default: return 16;
  }
}

function _getLifetimeForType(typeId) {
  switch (typeId) {
    case 7: return 1.0; // rain
    case 8: return 3.5; // fireflies
    default: return 1.2;
  }
}