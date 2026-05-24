/**
 * @module models
 * @description Loader de modelos glTF com cache, clone seguro para SkinnedMesh e utilitários de animação.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

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

    const gltf = await new Promise((resolve, reject) => {
        _loader.load(
            url,
            resolve,
            undefined,
            (err) => reject(new Error(`[models] loadModel falhou: ${url} — ${err?.message ?? err}`))
        );
    });

    _cache.set(url, gltf);
    return _cloneGltf(gltf);
}

/**
 * Clona apenas a cena do glTF com suporte correto a skeleton.
 * Use para instanciar modelos skinned sem compartilhar rig.
 * @param {Object} gltf
 * @returns {THREE.Object3D|null}
 */
export function cloneModel(gltf) {
    if (!gltf?.scene) return null;
    return cloneSkeleton(gltf.scene);
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

function _cloneGltf(gltf) {
    return {
        ...gltf,
        scene: cloneSkeleton(gltf.scene),
        animations: Array.isArray(gltf.animations)
            ? gltf.animations.map((clip) => clip.clone())
            : [],
    };
}