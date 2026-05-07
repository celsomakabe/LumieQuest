/**
 * @module input
 * @description Captura e normaliza teclado e mouse.
 * Expõe estado via getState() e emite eventos no bus (events.js).
 * Dependências: events.js
 */

import { emit } from './events.js';

// ─── Bindings padrão ──────────────────────────────────────────────────────────

/**
 * Mapa action → código de tecla/botão.
 * Mouse: 'Mouse0' = esquerdo, 'Mouse1' = meio, 'Mouse2' = direito.
 * @type {Record<string, string>}
 */
const _bindings = {
    moveUp:    'KeyW',
    moveDown:  'KeyS',
    moveLeft:  'KeyA',
    moveRight: 'KeyD',
    jump:      'Space',
    attack:    'Mouse0',
    camera:    'Mouse2',
    interact:  'KeyF',
};

// ─── Estado interno ───────────────────────────────────────────────────────────

/**
 * Teclas atualmente pressionadas. Chave = event.code.
 * @type {Record<string, boolean>}
 */
const _keys = {};

/**
 * Estado do mouse.
 * @type {{ x: number, y: number, dx: number, dy: number,
 *          buttons: { left: boolean, right: boolean, middle: boolean } }}
 */
const _mouse = {
    x: 0, y: 0,
    dx: 0, dy: 0,
    buttons: { left: false, right: false, middle: false },
};

/** Posição do mouse no frame anterior — usada para calcular dx/dy. */
let _prevMouseX = 0;
let _prevMouseY = 0;

/** Timestamp do último evento mouseMoved emitido — throttle de 16ms (R6). */
let _lastMouseEmit = 0;

/** Flag de inicialização — evita registrar listeners duplicados. */
let _initialized = false;

// ─── Mapeamento de botão numérico → nome legível ──────────────────────────────

/** @type {Record<number, 'left'|'middle'|'right'>} */
const _buttonName = { 0: 'left', 1: 'middle', 2: 'right' };

/** @type {Record<number, string>} Código de string para eventos de mouse */
const _buttonCode = { 0: 'Mouse0', 1: 'Mouse1', 2: 'Mouse2' };

// ─── Funções públicas ─────────────────────────────────────────────────────────

/**
 * Registra todos os listeners de DOM.
 * Idempotente: seguro chamar mais de uma vez (sem listeners duplicados).
 * @returns {void}
 */
export function init() {
    if (_initialized) return;
    _initialized = true;

    document.addEventListener('keydown',   _onKeyDown,   { passive: true });
    document.addEventListener('keyup',     _onKeyUp,     { passive: true });
    window.addEventListener('mousemove',   _onMouseMove, { passive: true });
    window.addEventListener('mousedown',   _onMouseDown, { passive: true });
    window.addEventListener('mouseup',     _onMouseUp,   { passive: true });
    window.addEventListener('wheel',       _onWheel,     { passive: true });

    // Previne menu de contexto do botão direito dentro do canvas
    document.addEventListener('contextmenu', (e) => e.preventDefault());
}

/**
 * Retorna snapshot imutável do estado atual de input.
 * Chamado pelo game loop a cada frame (player.update, etc.).
 * @returns {{ keys: Record<string, boolean>,
 *             mouse: { x: number, y: number, dx: number, dy: number,
 *                      buttons: { left: boolean, right: boolean, middle: boolean } } }}
 */
export function getState() {
    return {
        keys:  { ..._keys },
        mouse: {
            x: _mouse.x,
            y: _mouse.y,
            dx: _mouse.dx,
            dy: _mouse.dy,
            buttons: { ..._mouse.buttons },
        },
    };
}

/**
 * Redefine a tecla associada a uma ação.
 * @param {string} action - Nome da ação (ex.: 'moveUp', 'attack')
 * @param {string} key    - Código da tecla (ex.: 'ArrowUp') ou botão ('Mouse0')
 * @returns {void}
 */
export function setBinding(action, key) {
    if (!(action in _bindings)) {
        console.warn(`[input] setBinding: ação desconhecida "${action}"`);
        return;
    }
    _bindings[action] = key;
}

/**
 * Retorna a tecla atual associada a uma ação.
 * @param {string} action - Nome da ação
 * @returns {string} Código da tecla/botão, ou string vazia se ação não existe
 */
export function getBinding(action) {
    return _bindings[action] ?? '';
}

// ─── Helpers privados ─────────────────────────────────────────────────────────

/**
 * Resolve o código de uma tecla/botão para a action correspondente.
 * Retorna null se o código não estiver mapeado a nenhuma action.
 * @param {string} code - event.code ou 'Mouse0'/'Mouse1'/'Mouse2'
 * @returns {string|null}
 */
function _resolveAction(code) {
    for (const [action, binding] of Object.entries(_bindings)) {
        if (binding === code) return action;
    }
    return null;
}

// ─── Handlers de DOM ──────────────────────────────────────────────────────────

/** @param {KeyboardEvent} e */
function _onKeyDown(e) {
    // Ignora repeat (tecla mantida pressionada)
    if (e.repeat) return;
    _keys[e.code] = true;
    emit('keyPressed', { code: e.code, action: _resolveAction(e.code) });
}

/** @param {KeyboardEvent} e */
function _onKeyUp(e) {
    _keys[e.code] = false;
    emit('keyReleased', { code: e.code, action: _resolveAction(e.code) });
}

/** @param {MouseEvent} e */
function _onMouseMove(e) {
    const dx = e.clientX - _prevMouseX;
    const dy = e.clientY - _prevMouseY;

    _mouse.x  = e.clientX;
    _mouse.y  = e.clientY;
    _mouse.dx = dx;
    _mouse.dy = dy;

    _prevMouseX = e.clientX;
    _prevMouseY = e.clientY;

    // Throttle: não emite mais de 1 evento a cada 16ms (~60fps) — R6
    const now = performance.now();
    if (now - _lastMouseEmit < 16) return;
    _lastMouseEmit = now;

    emit('mouseMoved', { x: _mouse.x, y: _mouse.y, dx, dy });
}

/** @param {MouseEvent} e */
function _onMouseDown(e) {
    const name = _buttonName[e.button];
    if (name) _mouse.buttons[name] = true;

    const code   = _buttonCode[e.button];
    const action = code ? _resolveAction(code) : null;
    emit('mouseClicked', { button: e.button, x: e.clientX, y: e.clientY, action });
}

/** @param {MouseEvent} e */
function _onMouseUp(e) {
    const name = _buttonName[e.button];
    if (name) _mouse.buttons[name] = false;
}

/** @param {WheelEvent} e */
function _onWheel(e) {
    emit('mouseScrolled', { deltaY: e.deltaY });
}