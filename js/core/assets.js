/**
 * @module assets
 * @description Loader centralizado com cache por URL.
 * Único dono do cache de AudioBuffer no projeto (blueprint §1, regra de cache).
 * Dependências: events.js (event bus)
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { emit } from './events.js';

// ─── Estado interno ───────────────────────────────────────────────────────────

/** @type {THREE.LoadingManager|null} */
let _manager = null;

/** @type {GLTFLoader|null} */
let _gltfLoader = null;

/** @type {THREE.TextureLoader|null} */
let _textureLoader = null;

/**
 * AudioContext criado sob demanda na primeira chamada de loadAudio().
 * Motivo: browsers bloqueiam AudioContext antes de gesto do usuário.
 * @type {AudioContext|null}
 */
let _audioCtx = null;

/**
 * Cache unificado — chave: URL (string), valor: GLTF | THREE.Texture | AudioBuffer.
 * @type {Map<string, any>}
 */
const _cache = new Map();

// ─── Funções públicas ─────────────────────────────────────────────────────────

/**
 * Inicializa o LoadingManager e os loaders internos.
 * Deve ser chamado uma única vez, antes de qualquer load.
 * @returns {void}
 */
export function init() {
    _manager = new THREE.LoadingManager();
    _gltfLoader = new GLTFLoader(_manager);
    _textureLoader = new THREE.TextureLoader(_manager);
    // _audioCtx é criado sob demanda em _getAudioCtx()
}

/**
 * Carrega modelo GLTF/GLB com cache. Retorna do cache se já carregado.
 * @param {string} url - Caminho do arquivo .glb ou .gltf
 * @returns {Promise<Object>} Objeto GLTF com { scene, animations, ... }
 */
export function loadModel(url) {
    if (_cache.has(url)) return Promise.resolve(_cache.get(url));

    return new Promise((resolve, reject) => {
        _gltfLoader.load(
            url,
            (gltf) => { _cache.set(url, gltf); resolve(gltf); },
            undefined,
            (err) => reject(new Error(`[assets] loadModel falhou: ${url} — ${err.message ?? err}`))
        );
    });
}

/**
 * Carrega textura com cache. Aceita URLs de arquivo ou data URIs.
 * Emite aviso no console se a textura não for potência de 2 (R6 — performance).
 * @param {string} url - Caminho da imagem ou data URI (ex.: data:image/png;base64,...)
 * @returns {Promise<THREE.Texture>}
 */
export function loadTexture(url) {
    if (_cache.has(url)) return Promise.resolve(_cache.get(url));

    return new Promise((resolve, reject) => {
        _textureLoader.load(
            url,
            (texture) => {
                _warnIfNotPow2(texture, url);
                _cache.set(url, texture);
                resolve(texture);
            },
            undefined,
            (err) => reject(new Error(`[assets] loadTexture falhou: ${url} — ${err.message ?? err}`))
        );
    });
}

/**
 * Carrega áudio via Web Audio API e decodifica para AudioBuffer com cache.
 * Este módulo é o ÚNICO dono do cache de AudioBuffer no projeto.
 * AudioContext é criado sob demanda para respeitar a política de autoplay dos browsers.
 * @param {string} url - Caminho do arquivo de áudio (.ogg, .mp3, .wav)
 * @returns {Promise<AudioBuffer>}
 */
export function loadAudio(url) {
    if (_cache.has(url)) return Promise.resolve(_cache.get(url));

    return fetch(url)
        .then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status} ao carregar ${url}`);
            return res.arrayBuffer();
        })
        .then((arrayBuffer) => _getAudioCtx().decodeAudioData(arrayBuffer))
        .then((audioBuffer) => {
            _cache.set(url, audioBuffer);
            return audioBuffer;
        });
}

/**
 * Pré-carrega uma lista de assets em paralelo.
 * Emite assetsProgress { loaded, total } após cada item.
 * Emite assetLoadError { url, error } se um item falhar — continua os demais.
 * Emite assetsReady ao final (independente de falhas parciais).
 * @param {Array<{type: 'model'|'texture'|'audio', url: string}>} list
 * @returns {Promise<void>}
 */
export async function preloadAll(list) {
    const total = list.length;
    let loaded = 0;

    /** @type {Record<string, (url: string) => Promise<any>>} */
    const loaderMap = {
        model:   loadModel,
        texture: loadTexture,
        audio:   loadAudio,
    };

    const tasks = list.map(async ({ type, url }) => {
        const loaderFn = loaderMap[type];
        if (!loaderFn) {
            console.warn(`[assets] preloadAll: tipo desconhecido "${type}" (${url}) — ignorado`);
            return;
        }
        try {
            await loaderFn(url);
        } catch (error) {
            console.error(`[assets] Falha ao carregar "${url}":`, error);
            emit('assetLoadError', { url, error });
        } finally {
            loaded++;
            emit('assetsProgress', { loaded, total });
        }
    });

    await Promise.all(tasks);
    emit('assetsReady');
}

// ─── Helpers privados ─────────────────────────────────────────────────────────

/**
 * Retorna (criando sob demanda) o AudioContext compartilhado.
 * @returns {AudioContext}
 */
function _getAudioCtx() {
    if (!_audioCtx) {
        _audioCtx = new AudioContext();
    }
    return _audioCtx;
}

/**
 * Emite warning se textura não for potência de 2 (degrada mipmap / performance).
 * @param {THREE.Texture} texture
 * @param {string} url
 */
function _warnIfNotPow2(texture, url) {
    // data URIs não têm dimensões antes de decodificação — pula o check
    if (url.startsWith('data:')) return;
    const img = texture.image;
    if (!img) return;
    const isPow2 = (v) => v > 0 && (v & (v - 1)) === 0;
    if (!isPow2(img.width) || !isPow2(img.height)) {
        console.warn(`[assets] Textura não é potência de 2: ${url} (${img.width}x${img.height}) — pode causar artefatos de mipmap`);
    }
}/**
 * Retorna o AudioContext interno para compartilhamento com audio.js.
 * Evita criação de dois contextos paralelos (R6 — performance budget).
 * @returns {AudioContext|null}
 */
export function getAudioContext() {
    return _audioCtx;
}