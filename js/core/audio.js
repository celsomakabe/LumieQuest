/**
 * @file audio.js
 * @description Gerencia BGM (fade in/out) e pool de 16 SFX 2D.
 * Consome AudioBuffer via Assets.loadAudio — nunca faz fetch próprio.
 * PositionalAudio 3D será implementado no PROMPT 17.
 */

import * as Events from './events.js';
import * as Assets  from './assets.js';

// ─── Estado interno ───────────────────────────────────────────────────────────

/** @type {AudioContext|null} */
let _ctx = null;

/** @type {{ url: string, source: AudioBufferSourceNode, gainNode: GainNode }|null} */
let _bgmCurrent = null;

/** @type {GainNode[]} Pool de 16 gain nodes para SFX 2D */
const _sfxPool = [];
let _sfxIndex  = 0;          // ponteiro round-robin

/** @type {{ bgm: number, sfx: number, master: number }} */
const _volumes = { bgm: 0.6, sfx: 0.8, master: 1.0 };

/** @type {GainNode|null} Gain mestre, filho direto de destination */
let _masterGain = null;
/** @type {GainNode|null} Gain do BGM, filho do masterGain */
let _bgmGain    = null;
/** @type {GainNode|null} Gain global de SFX, filho do masterGain */
let _sfxGain    = null;

/** Camera guardada para uso futuro no PROMPT 17 */
let _camera = null;

const POOL_SIZE   = 16;
const FADE_TIME   = 1.0;  // segundos

// ─── Helpers privados ─────────────────────────────────────────────────────────

/**
 * Obtém (ou cria) o AudioContext compartilhado.
 * Tenta reutilizar o contexto já criado por assets.js se exposto.
 * @returns {AudioContext}
 */
function _getCtx() {
    if (_ctx) return _ctx;
    // assets.js expõe getAudioContext() se disponível
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
 * @param {number}   targetValue
 * @param {number}   duration  segundos
 */
function _fade(gainNode, targetValue, duration) {
    const ctx  = _getCtx();
    const now  = ctx.currentTime;
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setValueAtTime(gainNode.gain.value, now);
    gainNode.gain.linearRampToValueAtTime(targetValue, now + duration);
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Inicializa AudioContext, hierarquia de gain nodes e pool de SFX.
 * Deve ser chamado após Scene.init() e antes de UI.init().
 * @param {import('three').Camera} camera - Câmera ativa (reservada para PROMPT 17)
 */
export function init(camera) {
    _camera = camera;
    const ctx = _getCtx();

    // Hierarquia: sources → bgmGain / sfxSlot → masterGain → destination
    _masterGain = ctx.createGain();
    _masterGain.gain.setValueAtTime(_volumes.master, ctx.currentTime);
    _masterGain.connect(ctx.destination);

    _bgmGain = ctx.createGain();
    _bgmGain.gain.setValueAtTime(_effective('bgm'), ctx.currentTime);
    _bgmGain.connect(_masterGain);

    _sfxGain = ctx.createGain();
    _sfxGain.gain.setValueAtTime(_effective('sfx'), ctx.currentTime);
    _sfxGain.connect(_masterGain);

    // Pool de 16 GainNodes para SFX (round-robin)
    for (let i = 0; i < POOL_SIZE; i++) {
        const g = ctx.createGain();
        g.gain.setValueAtTime(1.0, ctx.currentTime); // volume individual por chamada
        g.connect(_sfxGain);
        _sfxPool.push(g);
    }

    // Resumir contexto suspenso (política autoplay dos browsers)
    if (ctx.state === 'suspended') {
        const resume = () => {
            ctx.resume();
            window.removeEventListener('pointerdown', resume);
            window.removeEventListener('keydown',     resume);
        };
        window.addEventListener('pointerdown', resume);
        window.addEventListener('keydown',     resume);
    }

    Events.on('assetsReady', () => {
        Events.emit('audioReady');
    });

    console.log('[Audio] init OK — pool de', POOL_SIZE, 'SFX slots criado.');
}

/**
 * Toca BGM com fade in. Ignora se a mesma URL já está tocando.
 * @param {string} url    - Caminho do arquivo de áudio
 * @param {number} [volume=_volumes.bgm] - Volume alvo (0–1)
 */
export async function playBGM(url, volume) {
    const ctx = _getCtx();

    if (_bgmCurrent && _bgmCurrent.url === url) return;

    const targetVol = (volume !== undefined ? volume : _volumes.bgm) * _volumes.master;
    _volumes.bgm = volume !== undefined ? volume : _volumes.bgm;

    // Fade out do BGM atual
    if (_bgmCurrent) {
        const old = _bgmCurrent;
        _fade(old.gainNode, 0, FADE_TIME);
        setTimeout(() => {
            try { old.source.stop(); } catch (_) {}
        }, FADE_TIME * 1000 + 50);
        _bgmCurrent = null;
    }

    // Carrega buffer via assets.js (cache — sem fetch próprio)
    let buffer;
    try {
        buffer = await Assets.loadAudio(url);
    } catch (err) {
        console.warn('[Audio] playBGM — falha ao carregar', url, err);
        return;
    }

    // Reconecta ao _bgmGain com fade in
    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.connect(_bgmGain);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop   = true;
    source.connect(gainNode);
    source.start();

    _bgmCurrent = { url, source, gainNode };
    _fade(gainNode, targetVol, FADE_TIME);
}

/**
 * Para o BGM atual com fade out de 1s.
 */
export function stopBGM() {
    if (!_bgmCurrent) return;
    const old = _bgmCurrent;
    _fade(old.gainNode, 0, FADE_TIME);
    setTimeout(() => {
        try { old.source.stop(); } catch (_) {}
    }, FADE_TIME * 1000 + 50);
    _bgmCurrent = null;
}

/**
 * Toca SFX 2D usando o próximo slot do pool (round-robin).
 * @param {string} url              - Caminho do arquivo de áudio
 * @param {number} [volume=1.0]     - Volume individual (0–1)
 */
export async function playSFX(url, volume = 1.0) {
    const ctx = _getCtx();

    let buffer;
    try {
        buffer = await Assets.loadAudio(url);
    } catch (err) {
        console.warn('[Audio] playSFX — falha ao carregar', url, err);
        return;
    }

    // Slot round-robin
    const slot = _sfxPool[_sfxIndex];
    _sfxIndex = (_sfxIndex + 1) % POOL_SIZE;

    slot.gain.setValueAtTime(volume, ctx.currentTime);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(slot);
    source.start();
    // source se autodestrói ao terminar (sem referência retida)
    source.onended = () => { source.disconnect(); };
}

/**
 * STUB — SFX posicional 3D. Implementação completa no PROMPT 17.
 * Por ora delega para playSFX 2D.
 * @param {string}                    url
 * @param {import('three').Vector3}   position
 * @param {number}                    [volume=1.0]
 */
export function playSFX3D(url, position, volume = 1.0) {
    console.warn('[Audio] playSFX3D ainda não implementado — PROMPT 17. Usando 2D.');
    playSFX(url, volume);
}

/**
 * Ajusta volume global por tipo e propaga imediatamente.
 * @param {'bgm'|'sfx'|'master'} type
 * @param {number}               value  0–1
 */
export function setVolume(type, value) {
    if (!(type in _volumes)) {
        console.warn('[Audio] setVolume — tipo inválido:', type);
        return;
    }
    _volumes[type] = Math.max(0, Math.min(1, value));

    if (!_masterGain) return; // init ainda não foi chamado

    const ctx = _getCtx();
    const now = ctx.currentTime;

    if (type === 'master') {
        _masterGain.gain.setValueAtTime(_volumes.master, now);
    } else if (type === 'bgm') {
        _bgmGain.gain.setValueAtTime(_effective('bgm'), now);
    } else if (type === 'sfx') {
        _sfxGain.gain.setValueAtTime(_effective('sfx'), now);
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