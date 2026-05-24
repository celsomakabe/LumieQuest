/**
 * @file audio.js
 * @description Gerencia BGM com crossfade, SFX 2D/3D e camadas de ambient.
 * Consome AudioBuffer via Assets.loadAudio e registry de assets/data/audio.json.
 */

import * as THREE from 'three';
import * as Events from './events.js';
import * as Assets from './assets.js';
import { getCamera } from '../world/scene.js';

/** @type {AudioContext|null} */
let _ctx = null;

/** @type {{ url: string, source: AudioBufferSourceNode, gainNode: GainNode }|null} */
let _bgmCurrent = null;

/** @type {GainNode[]} Pool de 16 gain nodes para SFX 2D */
const _sfxPool = [];
let _sfxIndex = 0;

/** @type {{ bgm: number, sfx: number, master: number }} */
const _volumes = { bgm: 0.6, sfx: 0.8, master: 1.0 };

/** @type {GainNode|null} */
let _masterGain = null;
/** @type {GainNode|null} */
let _bgmGain = null;
/** @type {GainNode|null} */
let _sfxGain = null;
/** @type {GainNode|null} */
let _ambientGain = null;

/** @type {import('three').Camera|null} */
let _camera = null;
/** @type {THREE.AudioListener|null} */
let _listener = null;

/** @type {Array<{ audio: THREE.PositionalAudio, anchor: THREE.Object3D, busy: boolean, sourceUrl: string|null }>} */
const _sfx3DPool = [];

/** @type {Map<string, { audio: THREE.Audio, volume: number, soundId: string, url: string }>} */
const _ambientLayers = new Map();

/** @type {Record<string, any>} */
let _audioRegistry = {};

const POOL_SIZE = 16;
const FADE_TIME = 1.0;

// ─── Helpers privados ─────────────────────────────────────────────────────────

/**
 * Obtém (ou cria) o AudioContext compartilhado.
 * @returns {AudioContext}
 */
function _getCtx() {
  if (_ctx) return _ctx;
  if (typeof Assets.getAudioContext === 'function') {
    _ctx = Assets.getAudioContext();
  }
  if (!_ctx) {
    _ctx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return _ctx;
}

/**
 * Retorna o volume efetivo para um tipo, já multiplicado pelo master.
 * @param {'bgm'|'sfx'} type
 * @returns {number}
 */
function _effective(type) {
  return _volumes[type] * _volumes.master;
}

/**
 * Aplica fade de volume em um GainNode.
 * @param {GainNode} gainNode
 * @param {number} targetValue
 * @param {number} duration
 */
function _fade(gainNode, targetValue, duration) {
  const ctx = _getCtx();
  const now = ctx.currentTime;
  gainNode.gain.cancelScheduledValues(now);
  gainNode.gain.setValueAtTime(gainNode.gain.value, now);
  gainNode.gain.linearRampToValueAtTime(targetValue, now + duration);
}

/**
 * Garante listener anexado à câmera.
 * @returns {THREE.AudioListener|null}
 */
function _ensureListener() {
  if (_listener) return _listener;

  const activeCamera = _camera || getCamera();
  if (!activeCamera) {
    console.warn('[Audio] câmera indisponível para criar AudioListener.');
    return null;
  }

  const existing = activeCamera.children.find(child => child instanceof THREE.AudioListener);
  if (existing) {
    _listener = existing;
    return _listener;
  }

  _listener = new THREE.AudioListener();
  activeCamera.add(_listener);
  return _listener;
}

/**
 * Resolve um soundId em URL usando audio.json, com fallback para sfx.
 * @param {string} soundId
 * @returns {string}
 */
function _resolveSoundIdToUrl(soundId) {
  const sfxEntry = _audioRegistry?.sfx?.[soundId];
  if (typeof sfxEntry === 'string') return sfxEntry;

  const bgmEntry = _audioRegistry?.bgm?.[soundId];
  if (typeof bgmEntry === 'string') return bgmEntry;

  return `assets/audio/sfx/${soundId}.ogg`;
}

/**
 * Carrega buffer de áudio.
 * @param {string} url
 * @returns {Promise<AudioBuffer|null>}
 */
async function _loadBuffer(url) {
  try {
    return await Assets.loadAudio(url);
  } catch (err) {
    console.warn('[Audio] Falha ao carregar áudio:', url, err);
    return null;
  }
}

/**
 * Libera camada ambient.
 * @param {{ audio: THREE.Audio, volume: number, soundId: string, url: string }|undefined} layer
 */
function _disposeAmbientLayer(layer) {
  if (!layer) return;

  try {
    if (layer.audio.isPlaying) {
      layer.audio.stop();
    }
  } catch (_) {}

  try {
    layer.audio.disconnect();
  } catch (_) {}
}

/**
 * Reaplica volumes dos ambient layers.
 */
function _refreshAmbientVolumes() {
  for (const layer of _ambientLayers.values()) {
    layer.audio.setVolume(layer.volume * _effective('sfx'));
  }
}

/**
 * Retorna um slot livre do pool 3D.
 * @returns {{ audio: THREE.PositionalAudio, anchor: THREE.Object3D, busy: boolean, sourceUrl: string|null }|null}
 */
function _acquire3DSlot() {
  for (const slot of _sfx3DPool) {
    if (!slot.busy) {
      slot.busy = true;
      return slot;
    }
  }
  return null;
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Inicializa AudioContext, hierarquia de gain nodes, pools e registry.
 * Deve ser chamado após Scene.init() e antes de UI.init().
 * @param {import('three').Camera} camera
 */
export async function init(camera) {
  _camera = camera;
  const ctx = _getCtx();

  _masterGain = ctx.createGain();
  _masterGain.gain.setValueAtTime(_volumes.master, ctx.currentTime);
  _masterGain.connect(ctx.destination);

  _bgmGain = ctx.createGain();
  _bgmGain.gain.setValueAtTime(_effective('bgm'), ctx.currentTime);
  _bgmGain.connect(_masterGain);

  _sfxGain = ctx.createGain();
  _sfxGain.gain.setValueAtTime(_effective('sfx'), ctx.currentTime);
  _sfxGain.connect(_masterGain);

  _ambientGain = ctx.createGain();
  _ambientGain.gain.setValueAtTime(_effective('sfx'), ctx.currentTime);
  _ambientGain.connect(_masterGain);

  _ensureListener();

  _sfxPool.length = 0;
  for (let i = 0; i < POOL_SIZE; i++) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(1.0, ctx.currentTime);
    g.connect(_sfxGain);
    _sfxPool.push(g);
  }

  _sfx3DPool.length = 0;
  const listener = _ensureListener();
  if (listener) {
    for (let i = 0; i < POOL_SIZE; i++) {
      const anchor = new THREE.Object3D();
      const audio = new THREE.PositionalAudio(listener);
      audio.setRefDistance(5);
      audio.setMaxDistance(30);
      audio.setRolloffFactor(1);
      audio.setLoop(false);
      anchor.add(audio);

      _sfx3DPool.push({
        audio,
        anchor,
        busy: false,
        sourceUrl: null
      });
    }
  }

  try {
    const response = await fetch('assets/data/audio.json');
    if (response.ok) {
      const data = await response.json();
      _audioRegistry = data ?? {};
    } else {
      console.warn(`[Audio] audio.json não carregado: ${response.status}`);
    }
  } catch (err) {
    console.warn('[Audio] Falha ao carregar audio.json', err);
  }

  if (ctx.state === 'suspended') {
    const resume = () => {
      ctx.resume();
      window.removeEventListener('pointerdown', resume);
      window.removeEventListener('keydown', resume);
    };
    window.addEventListener('pointerdown', resume);
    window.addEventListener('keydown', resume);
  }

  Events.on('assetsReady', () => {
    Events.emit('audioReady');
  });

  console.log('[Audio] init OK — pool 2D/3D e ambient prontos.');
}

/**
 * Toca BGM com crossfade de 1s. Ignora se a mesma URL já está tocando.
 * @param {string} url
 * @param {number} [volume=_volumes.bgm]
 */
export async function playBGM(url, volume) {
  const ctx = _getCtx();
  const nextVolume = volume !== undefined ? volume : _volumes.bgm;
  const targetVol = nextVolume * _volumes.master;

  if (_bgmCurrent && _bgmCurrent.url === url) return;

  _volumes.bgm = nextVolume;

  const buffer = await _loadBuffer(url);
  if (!buffer) return;

  const gainNode = ctx.createGain();
  gainNode.gain.setValueAtTime(0, ctx.currentTime);
  gainNode.connect(_bgmGain);

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.connect(gainNode);
  source.start();

  const previous = _bgmCurrent;
  _bgmCurrent = { url, source, gainNode };

  if (previous) {
    _fade(previous.gainNode, 0, FADE_TIME);
    setTimeout(() => {
      try { previous.source.stop(); } catch (_) {}
      try { previous.source.disconnect(); } catch (_) {}
      try { previous.gainNode.disconnect(); } catch (_) {}
    }, FADE_TIME * 1000 + 50);
  }

  _fade(gainNode, targetVol, FADE_TIME);
}

/**
 * Para o BGM atual com fade out.
 */
export function stopBGM() {
  if (!_bgmCurrent) return;

  const old = _bgmCurrent;
  _bgmCurrent = null;

  _fade(old.gainNode, 0, FADE_TIME);
  setTimeout(() => {
    try { old.source.stop(); } catch (_) {}
    try { old.source.disconnect(); } catch (_) {}
    try { old.gainNode.disconnect(); } catch (_) {}
  }, FADE_TIME * 1000 + 50);
}

/**
 * Toca SFX 2D usando o próximo slot do pool.
 * @param {string} url
 * @param {number} [volume=1.0]
 */
export async function playSFX(url, volume = 1.0) {
  const ctx = _getCtx();
  const buffer = await _loadBuffer(url);
  if (!buffer) return;

  const slot = _sfxPool[_sfxIndex];
  _sfxIndex = (_sfxIndex + 1) % POOL_SIZE;

  slot.gain.setValueAtTime(volume, ctx.currentTime);

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(slot);
  source.start();
  source.onended = () => {
    try { source.disconnect(); } catch (_) {}
  };
}

/**
 * Toca SFX 3D real usando pool de PositionalAudio.
 * @param {string} url
 * @param {import('three').Vector3|{x:number,y:number,z:number}} position
 * @param {number} [volume=1.0]
 */
export async function playSFX3D(url, position, volume = 1.0) {
  const listener = _ensureListener();
  if (!listener || _sfx3DPool.length === 0) {
    playSFX(url, volume);
    return;
  }

  const slot = _acquire3DSlot();
  if (!slot) {
    return;
  }

  const buffer = await _loadBuffer(url);
  if (!buffer) {
    slot.busy = false;
    return;
  }

  const anchor = slot.anchor;
  const audio = slot.audio;

  anchor.position.set(position?.x ?? 0, position?.y ?? 0, position?.z ?? 0);

  if (!anchor.parent) {
    const scene = _camera?.parent;
    if (scene) {
      scene.add(anchor);
    }
  }

  try {
    if (audio.isPlaying) {
      audio.stop();
    }
  } catch (_) {}

  audio.setBuffer(buffer);
  audio.setRefDistance(5);
  audio.setMaxDistance(30);
  audio.setRolloffFactor(1);
  audio.setLoop(false);
  audio.setVolume(volume * _effective('sfx'));

  slot.sourceUrl = url;
  audio.play();

  const cleanup = () => {
    audio.source?.removeEventListener?.('ended', cleanup);
    try {
      audio.stop();
    } catch (_) {}
    if (anchor.parent) {
      anchor.parent.remove(anchor);
    }
    slot.busy = false;
    slot.sourceUrl = null;
  };

  if (audio.source) {
    audio.source.addEventListener('ended', cleanup, { once: true });
  } else {
    const durationMs = ((buffer.duration || 0) * 1000) + 50;
    setTimeout(cleanup, durationMs);
  }
}

/**
 * Inicia conjunto base de ambient em loop.
 * Para os ambients anteriores antes de tocar os novos.
 * @param {string[]} soundIds
 * @param {number} [volume=0.3]
 */
export async function startAmbient(soundIds, volume = 0.3) {
  stopAmbient();

  if (!Array.isArray(soundIds) || soundIds.length === 0) return;

  for (const soundId of soundIds) {
    await addAmbientLayer(soundId, volume);
  }
}

/**
 * Para todos os ambient atuais.
 */
export function stopAmbient() {
  for (const [soundId, layer] of _ambientLayers) {
    _disposeAmbientLayer(layer);
    _ambientLayers.delete(soundId);
  }
}

/**
 * Adiciona uma camada ambient em loop.
 * @param {string} soundId
 * @param {number} [volume=0.3]
 */
export async function addAmbientLayer(soundId, volume = 0.3) {
  const listener = _ensureListener();
  if (!listener) return;
  if (!soundId) return;

  removeAmbientLayer(soundId);

  const url = _resolveSoundIdToUrl(soundId);
  const buffer = await _loadBuffer(url);
  if (!buffer) return;

  const audio = new THREE.Audio(listener);
  audio.setBuffer(buffer);
  audio.setLoop(true);
  audio.setVolume(volume * _effective('sfx'));
  audio.play();

  _ambientLayers.set(soundId, {
    audio,
    volume,
    soundId,
    url
  });
}

/**
 * Remove uma camada ambient específica.
 * @param {string} soundId
 */
export function removeAmbientLayer(soundId) {
  const layer = _ambientLayers.get(soundId);
  if (!layer) return;

  _disposeAmbientLayer(layer);
  _ambientLayers.delete(soundId);
}

/**
 * Ajusta volume global por tipo e propaga imediatamente.
 * @param {'bgm'|'sfx'|'master'} type
 * @param {number} value
 */
export function setVolume(type, value) {
  if (!(type in _volumes)) {
    console.warn('[Audio] setVolume — tipo inválido:', type);
    return;
  }

  _volumes[type] = Math.max(0, Math.min(1, value));

  if (!_masterGain) return;

  const ctx = _getCtx();
  const now = ctx.currentTime;

  if (type === 'master') {
    _masterGain.gain.setValueAtTime(_volumes.master, now);
    _bgmGain?.gain.setValueAtTime(_effective('bgm'), now);
    _sfxGain?.gain.setValueAtTime(_effective('sfx'), now);
    _ambientGain?.gain.setValueAtTime(_effective('sfx'), now);
    _refreshAmbientVolumes();
    return;
  }

  if (type === 'bgm') {
    _bgmGain?.gain.setValueAtTime(_effective('bgm'), now);
    if (_bgmCurrent) {
      _bgmCurrent.gainNode.gain.setValueAtTime(_effective('bgm'), now);
    }
    return;
  }

  if (type === 'sfx') {
    _sfxGain?.gain.setValueAtTime(_effective('sfx'), now);
    _ambientGain?.gain.setValueAtTime(_effective('sfx'), now);
    _refreshAmbientVolumes();
  }
}

/**
 * Retorna o volume atual de um tipo.
 * @param {'bgm'|'sfx'|'master'} type
 * @returns {number}
 */
export function getVolume(type) {
  return _volumes[type] ?? 0;
}