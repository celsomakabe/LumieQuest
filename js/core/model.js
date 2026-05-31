/**
 * @module models
 * @description Loader de modelos glTF com cache, clone seguro para SkinnedMesh e utilitários de animação.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

/** @type {Map<string, THREE.Material>} */
const _materialCache = new Map();
let _materialCacheHits = 0;

function _getMaterialKey(mat) {
  const mapUrl = mat.map?.source?.data?.src ?? mat.map?.image?.src ?? '';
  const color  = mat.color ? mat.color.getHexString() : 'none';
  const metal  = (mat.metalness ?? 0).toFixed(2);
  const rough  = (mat.roughness ?? 1).toFixed(2);
  return `${mat.type}|${mapUrl}|${color}|${metal}|${rough}`;
}

function _getCachedMaterial(mat) {
  const key = _getMaterialKey(mat);
  if (_materialCache.has(key)) {
    _materialCacheHits++;
    return _materialCache.get(key);
  }
  _materialCache.set(key, mat);
  return mat;
}

let _loader = null;
/** @type {Map<string, any>} */
const _cache = new Map();

/**
 * Inicializa o loader interno de modelos.
 * @returns {Promise<void>}
 */
export async function init() {
    if (_loader) return;
    _loader = new GLTFLoader();
}

/**
 * Carrega um modelo glTF/GLB com cache.
 * Se já estiver em cache, retorna uma cópia clonada do gltf.
 * @param {string} url
 * @returns {Promise<Object>}
 */
export async function loadModel(url) {
    if (!_loader) {
        await init();
    }

    if (_cache.has(url)) {
        return _cloneGltf(_cache.get(url));
    }

    const previousResourcePath = _loader.resourcePath ?? '';
    const resourcePath = _getResourcePath(url);

    if (resourcePath) {
        _loader.setResourcePath(resourcePath);
    }

    try {
        const gltf = await new Promise((resolve, reject) => {
            _loader.load(
                url,
                resolve,
                undefined,
                (err) => reject(new Error(`[models] loadModel falhou: ${url} â€” ${err?.message ?? err}`))
            );
        });

        _cache.set(url, gltf);
        return _cloneGltf(gltf);
    } finally {
        _loader.setResourcePath(previousResourcePath);
    }
}

/**
 * Clona apenas a cena do glTF com suporte correto a skeleton.
 * Use para instanciar modelos skinned sem compartilhar rig.
 * @param {Object} gltf
 * @returns {THREE.Object3D|null}
 */
export function cloneModel(gltf) {
  if (!gltf?.scene) return null;
  const clone = cloneSkeleton(gltf.scene);
  clone.traverse((child) => {
    if (child.isMesh && child.material) {
      if (Array.isArray(child.material)) {
        child.material = child.material.map(_getCachedMaterial);
      } else {
        child.material = _getCachedMaterial(child.material);
      }
    }
  });
  return clone;
}

/**
 * Retorna os clips de animação do glTF.
 * @param {Object} gltf
 * @returns {THREE.AnimationClip[]}
 */
export function getAnimationClips(gltf) {
    return Array.isArray(gltf?.animations) ? gltf.animations : [];
}

/**
 * Cria um AnimationMixer para o model informado.
 * @param {THREE.Object3D} model
 * @returns {THREE.AnimationMixer}
 */
export function createMixer(model) {
    return new THREE.AnimationMixer(model);
}
function _getResourcePath(url) {
    if (typeof url !== 'string' || url.length === 0) return '';

    const normalized = url.replace(/\\/g, '/');
    const lastSlashIndex = normalized.lastIndexOf('/');

    if (lastSlashIndex === -1) return '';
    return normalized.slice(0, lastSlashIndex + 1);
}
function _cloneGltf(gltf) {
    return {
        ...gltf,
        scene: cloneSkeleton(gltf.scene),
        animations: Array.isArray(gltf.animations)
            ? gltf.animations.map((clip) => clip.clone())
            : [],
    };
}
/**
 * Retorna estatisticas do cache de materiais para profiling.
 * @returns {{ totalCached: number, reuses: number }}
 */
export function getMaterialCacheStats() {
  return {
    totalCached: _materialCache.size,
    reuses: _materialCacheHits
  };
}