/**
 * @file ui.js
 * @description Renderiza e atualiza toda a interface: HUD HP/MP/XP,
 * notificações toast, mensagens centrais e FPS counter.
 */

import * as Events from '../core/events.js';
import * as THREE from 'three';
import { getCamera, getRenderer } from '../world/scene.js';
import * as Audio  from '../core/audio.js';

// ─── Referências DOM ──────────────────────────────────────────────────────────

let _elHP        = null;
let _elMP        = null;
let _elHPBar     = null;
let _elMPBar     = null;
let _elName      = null;
let _elLevel     = null;
let _elFPS       = null;
let _elNotifWrap = null;
let _elCenter    = null;

// ─── Estado ───────────────────────────────────────────────────────────────────

let _dirty = {
    hp: false,
    mp: false,
};

let _hp    = { current: 100, max: 100 };
let _mp    = { current:  50, max:  50 };
let _name  = 'Herói';
let _level = 1;

// ─── Helpers privados ─────────────────────────────────────────────────────────

/**
 * Cria o elemento DOM do HUD e injeta no body.
 */
function _buildDOM() {
    const hud = document.createElement('div');
    hud.id = 'hud';
    hud.innerHTML = `
        <div id="hud-info">
            <span id="hud-name">${_name}</span>
            <span id="hud-level">Lv ${_level}</span>
        </div>
        <div id="hud-bars">
            <div class="bar-row">
                <label>HP</label>
                <div class="bar-bg">
                    <div id="hud-hp-bar" class="bar hp-bar" style="width:100%"></div>
                </div>
                <span id="hud-hp">100/100</span>
            </div>
            <div class="bar-row">
                <label>MP</label>
                <div class="bar-bg">
                    <div id="hud-mp-bar" class="bar mp-bar" style="width:100%"></div>
                </div>
                <span id="hud-mp">50/50</span>
            </div>
        </div>
        <div id="hud-fps">60 FPS</div>
    `;
    document.body.appendChild(hud);

    // Wrapper de notificações
    const notifWrap = document.createElement('div');
    notifWrap.id = 'notif-wrap';
    document.body.appendChild(notifWrap);

    // Mensagem central
    const center = document.createElement('div');
    center.id = 'center-msg';
    center.style.display = 'none';
    document.body.appendChild(center);

    // Estilos inline (evita dependência de CSS externo)
    const style = document.createElement('style');
    style.textContent = `
        #hud {
            position: fixed; top: 12px; left: 12px;
            color: #fff; font-family: monospace; font-size: 13px;
            text-shadow: 1px 1px 2px #000;
            pointer-events: none; user-select: none;
            z-index: 100;
        }
        #hud-info { margin-bottom: 4px; }
        #hud-name { margin-right: 8px; font-weight: bold; }
        .bar-row { display: flex; align-items: center; gap: 4px; margin-bottom: 3px; }
        .bar-row label { width: 20px; }
        .bar-bg { width: 120px; height: 10px; background: #333; border-radius: 4px; overflow: hidden; }
        .bar { height: 100%; border-radius: 4px; transition: width 0.2s; }
        .hp-bar { background: #e05050; }
        .mp-bar { background: #4080e0; }
        #hud-fps {
            position: fixed; top: 8px; right: 12px;
            color: #0f0; font-family: monospace; font-size: 11px;
            text-shadow: 1px 1px 2px #000;
            pointer-events: none;
            z-index: 100;
        }
        #notif-wrap {
            position: fixed; bottom: 60px; left: 50%;
            transform: translateX(-50%);
            display: flex; flex-direction: column; align-items: center; gap: 6px;
            pointer-events: none; z-index: 200;
        }
        .notif {
            background: rgba(0,0,0,0.75); color: #fff;
            padding: 6px 16px; border-radius: 20px;
            font-family: monospace; font-size: 13px;
            animation: notifFade 2.8s forwards;
        }
        .notif.success { border-left: 3px solid #4c4; }
        .notif.warning { border-left: 3px solid #fa4; }
        .notif.error   { border-left: 3px solid #e44; }
        @keyframes notifFade {
            0%   { opacity: 0; transform: translateY(8px); }
            15%  { opacity: 1; transform: translateY(0);   }
            70%  { opacity: 1; }
            100% { opacity: 0; }
        }
        #center-msg {
            position: fixed; top: 40%; left: 50%;
            transform: translate(-50%, -50%);
            color: #ffe87c; font-family: monospace; font-size: 22px; font-weight: bold;
            text-shadow: 0 0 12px #f80, 1px 1px 3px #000;
            pointer-events: none; z-index: 300;
            animation: centerFade 3s forwards;
        }
        @keyframes centerFade {
            0%   { opacity: 0; transform: translate(-50%, -60%); }
            20%  { opacity: 1; transform: translate(-50%, -50%); }
            70%  { opacity: 1; }
            100% { opacity: 0; }
        }
    `;
    document.head.appendChild(style);
}

/**
 * Reconecta referências DOM após _buildDOM.
 */
function _queryRefs() {
    _elHP        = document.getElementById('hud-hp');
    _elMP        = document.getElementById('hud-mp');
    _elHPBar     = document.getElementById('hud-hp-bar');
    _elMPBar     = document.getElementById('hud-mp-bar');
    _elName      = document.getElementById('hud-name');
    _elLevel     = document.getElementById('hud-level');
    _elFPS       = document.getElementById('hud-fps');
    _elNotifWrap = document.getElementById('notif-wrap');
    _elCenter    = document.getElementById('center-msg');
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Inicializa a UI: cria DOM e registra listeners de eventos.
 */
export function init() {
    _buildDOM();
    _queryRefs();

    if (!document.getElementById('lumie-damage-style')) {
  const style = document.createElement('style');
  style.id = 'lumie-damage-style';
  style.textContent = `
    @keyframes lumie-dmg-float {
      0%   { transform: translateY(0px);   opacity: 1; }
      100% { transform: translateY(-40px); opacity: 0; }
    }
    .lumie-dmg {
      position: absolute;
      pointer-events: none;
      font-family: sans-serif;
      font-weight: bold;
      text-shadow: 1px 1px 2px #000;
      animation: lumie-dmg-float 800ms ease-out forwards;
      white-space: nowrap;
    }
    .lumie-dmg.critical { color: #ffcc00; font-size: 1.5em; }
    .lumie-dmg.normal   { color: #ff3333; font-size: 1em; }
  `;
  document.head.appendChild(style);
    }

    Events.on('playerHpChanged', ({ current, max }) => {
        _hp = { current, max };
        _dirty.hp = true;
    });

    Events.on('playerMpChanged', ({ current, max }) => {
        _mp = { current, max };
        _dirty.mp = true;
    });

    Events.on('playerSpawned', ({ name, level, hp, mp } = {}) => {
        if (name)  { _name  = name;  _elName.textContent  = name; }
        if (level) { _level = level; _elLevel.textContent = `Lv ${level}`; }
        if (hp)    { _hp = hp;  _dirty.hp = true; }
        if (mp)    { _mp = mp;  _dirty.mp = true; }
    });

    Events.on('levelUp', ({ newLevel }) => {
        _level = newLevel;
        if (_elLevel) _elLevel.textContent = `Lv ${newLevel}`;
        showNotification(`🎉 Level Up! Nível ${newLevel}`, 'success');
        Audio.playSFX('assets/audio/sfx/sfx_levelup.ogg');
    });
    Events.on('damageDealt', ({ target, amount, isCritical }) => {
        if (!target?.position) return;
        showDamagePopup(target.position, amount, isCritical);
    });
}

/**
 * Atualiza barras de HP/MP quando dirty flag ativo.
 * Chamado a cada frame pelo game loop.
 * @param {number} _delta
 */
export function update(_delta) {
    if (_dirty.hp) {
        const pct = _hp.max > 0 ? (_hp.current / _hp.max) * 100 : 0;
        _elHP.textContent    = `${_hp.current}/${_hp.max}`;
        _elHPBar.style.width = `${pct}%`;
        _dirty.hp = false;
    }
    if (_dirty.mp) {
        const pct = _mp.max > 0 ? (_mp.current / _mp.max) * 100 : 0;
        _elMP.textContent    = `${_mp.current}/${_mp.max}`;
        _elMPBar.style.width = `${pct}%`;
        _dirty.mp = false;
    }
}

/**
 * Exibe notificação toast temporária (2.8s) e toca SFX de click.
 * @param {string} msg              - Texto da notificação
 * @param {'info'|'success'|'warning'|'error'} [type='info']
 */
export function showNotification(msg, type = 'info') {
    Audio.playSFX('assets/audio/sfx/sfx_ui_click.ogg', 0.4);

    if (!_elNotifWrap) return;
    const el = document.createElement('div');
    el.className = `notif ${type}`;
    el.textContent = msg;
    _elNotifWrap.appendChild(el);
    setTimeout(() => el.remove(), 2900);
}

/**
 * Exibe mensagem central temporária (ex: "LEVEL UP!").
 * @param {string} msg
 */
export function showCenterMessage(msg) {
    if (!_elCenter) return;
    _elCenter.textContent = msg;
    _elCenter.style.display = 'block';
    _elCenter.style.animation = 'none';
    // Força reflow para reiniciar animação
    void _elCenter.offsetWidth;
    _elCenter.style.animation = 'centerFade 3s forwards';
    setTimeout(() => { _elCenter.style.display = 'none'; }, 3100);
}

/**
 * Atualiza o contador de FPS no HUD.
 * @param {number} fps
 */
export function setFPS(fps) {
    if (_elFPS) _elFPS.textContent = `${fps} FPS`;
}

/**
 * Exibe uma janela de UI pelo id (stub — implementação completa em prompts futuros).
 * @param {string} id
 */
export function showWindow(id) {
    Events.emit('uiWindowOpened', { id });
}

/**
 * Fecha uma janela de UI pelo id (stub).
 * @param {string} id
 */
export function hideWindow(id) {
    Events.emit('uiWindowClosed', { id });
}
/**
 * Exibe número de dano flutuante sobre a posição world do alvo.
 * @param {{ x: number, y: number, z: number }} worldPosition
 * @param {number}  amount
 * @param {boolean} isCritical
 */
function showDamagePopup(worldPosition, amount, isCritical) {
  const camera   = getCamera();
  const renderer = getRenderer();
  if (!camera || !renderer) return;

  const canvas = renderer.domElement;
  const vec = new THREE.Vector3(
    worldPosition.x,
    (worldPosition.y ?? 0) + 1.2,
    worldPosition.z
  );
  vec.project(camera);

  const hw = canvas.clientWidth  / 2;
  const hh = canvas.clientHeight / 2;
  const sx = Math.round( vec.x * hw + hw);
  const sy = Math.round(-vec.y * hh + hh);

  const div = document.createElement('div');
  div.className  = `lumie-dmg ${isCritical ? 'critical' : 'normal'}`;
  div.textContent = isCritical ? `★${amount}` : `${amount}`;
  div.style.left = `${sx}px`;
  div.style.top  = `${sy}px`;

  const root = document.getElementById('ui-root') ?? document.body;
  root.appendChild(div);

  div.addEventListener('animationend', () => div.remove(), { once: true });
}