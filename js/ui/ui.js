import { on, emit } from '../core/events.js';

// ─── Estado interno ───────────────────────────────────────────────────────────
const _state = {
  hp: 100, maxHp: 100,
  mp: 50,  maxMp: 50,
  level: 1, name: 'Herói',
  fps: 0,
};

const _dirty = {
  hp: true, mp: true, level: true, name: true, fps: true,
};

// ─── Refs DOM ─────────────────────────────────────────────────────────────────
let _els = {};

// ─── Construção DOM ───────────────────────────────────────────────────────────
function _buildDOM() {
  const root = document.createElement('div');
  root.className = 'hud-root';
  root.id = 'hud-root';

  // ── Top-left ────────────────────────────────────────────────────────────────
  const topLeft = document.createElement('div');
  topLeft.className = 'hud-topleft';

  // Nome + Level
  const nameRow = document.createElement('div');
  nameRow.className = 'hud-nameline';

  const nameEl = document.createElement('span');
  nameEl.className = 'hud-name';
  nameEl.textContent = _state.name;

  const levelEl = document.createElement('span');
  levelEl.className = 'hud-level';
  levelEl.textContent = `Lv.${_state.level}`;

  nameRow.appendChild(nameEl);
  nameRow.appendChild(levelEl);

  // Barra HP
  const hpWrap = document.createElement('div');
  hpWrap.className = 'hud-bar-wrap';

  const hpLabel = document.createElement('span');
  hpLabel.className = 'hud-bar-label';
  hpLabel.textContent = 'HP';

  const hpBar = document.createElement('div');
  hpBar.className = 'hud-bar';

  const hpFill = document.createElement('div');
  hpFill.className = 'hud-bar-fill hud-bar-hp';

  const hpText = document.createElement('span');
  hpText.className = 'hud-bar-text';

  hpBar.appendChild(hpFill);
  hpBar.appendChild(hpText);
  hpWrap.appendChild(hpLabel);
  hpWrap.appendChild(hpBar);

  // Barra MP
  const mpWrap = document.createElement('div');
  mpWrap.className = 'hud-bar-wrap';

  const mpLabel = document.createElement('span');
  mpLabel.className = 'hud-bar-label';
  mpLabel.textContent = 'MP';

  const mpBar = document.createElement('div');
  mpBar.className = 'hud-bar';

  const mpFill = document.createElement('div');
  mpFill.className = 'hud-bar-fill hud-bar-mp';

  const mpText = document.createElement('span');
  mpText.className = 'hud-bar-text';

  mpBar.appendChild(mpFill);
  mpBar.appendChild(mpText);
  mpWrap.appendChild(mpLabel);
  mpWrap.appendChild(mpBar);

  topLeft.appendChild(nameRow);
  topLeft.appendChild(hpWrap);
  topLeft.appendChild(mpWrap);

  // ── Top-right: FPS ──────────────────────────────────────────────────────────
  const fpsEl = document.createElement('div');
  fpsEl.className = 'hud-fps';
  fpsEl.textContent = 'FPS: --';

  // ── Center-top: mensagens centrais ─────────────────────────────────────────
  const msgEl = document.createElement('div');
  msgEl.className = 'hud-message';
  msgEl.style.opacity = '0';

  // ── Bottom-center: hotbar placeholder ──────────────────────────────────────
  const hotbar = document.createElement('div');
  hotbar.className = 'hud-hotbar';
  for (let i = 0; i < 8; i++) {
    const slot = document.createElement('div');
    slot.className = 'hud-hotbar-slot';
    slot.dataset.index = i + 1;
    hotbar.appendChild(slot);
  }

  // ── Área de notificações ────────────────────────────────────────────────────
  const notifArea = document.createElement('div');
  notifArea.className = 'hud-notif-area';

  root.appendChild(topLeft);
  root.appendChild(fpsEl);
  root.appendChild(msgEl);
  root.appendChild(hotbar);
  root.appendChild(notifArea);

  document.body.appendChild(root);

  _els = {
    root, topLeft, fpsEl, msgEl, hotbar, notifArea,
    nameEl, levelEl,
    hpFill, hpText,
    mpFill, mpText,
  };
}

// ─── Render helpers ───────────────────────────────────────────────────────────
function _renderHP() {
  const pct = _state.maxHp > 0 ? (_state.hp / _state.maxHp) * 100 : 0;
  _els.hpFill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  _els.hpText.textContent = `${_state.hp}/${_state.maxHp}`;
}

function _renderMP() {
  const pct = _state.maxMp > 0 ? (_state.mp / _state.maxMp) * 100 : 0;
  _els.mpFill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  _els.mpText.textContent = `${_state.mp}/${_state.maxMp}`;
}

function _renderName() {
  _els.nameEl.textContent = _state.name;
}

function _renderLevel() {
  _els.levelEl.textContent = `Lv.${_state.level}`;
}

function _renderFPS() {
  _els.fpsEl.textContent = `FPS: ${_state.fps}`;
}

// ─── Mensagens centrais ───────────────────────────────────────────────────────
let _msgTimeout = null;

/**
 * Exibe mensagem no centro-topo por duração determinada.
 * @param {string} text
 * @param {number} [duration=3000] ms
 */
function showMessage(text, duration = 3000) {
  if (_msgTimeout) clearTimeout(_msgTimeout);
  const el = _els.msgEl;
  el.textContent = text;
  el.style.transition = 'opacity 0.3s';
  el.style.opacity = '1';
  _msgTimeout = setTimeout(() => {
    el.style.transition = 'opacity 0.5s';
    el.style.opacity = '0';
    _msgTimeout = null;
  }, duration);
}

// ─── Event listeners ──────────────────────────────────────────────────────────
function _registerEvents() {
  on('playerSpawned', ({ position }) => {
    // playerSpawned não traz stats completos; playerHpChanged/playerMpChanged chegam logo após
    _dirty.name = true;
    _dirty.level = true;
  });

  on('playerHpChanged', ({ current, max }) => {
    _state.hp = current;
    _state.maxHp = max;
    _dirty.hp = true;
  });

  on('playerMpChanged', ({ current, max }) => {
    _state.mp = current;
    _state.maxMp = max;
    _dirty.mp = true;
  });

  on('levelUp', ({ newLevel }) => {
    _state.level = newLevel;
    _dirty.level = true;
    showNotification(`Level up! Nível ${newLevel}`, 'info');
  });

  on('playerDied', () => {
    showMessage('Você morreu', 5000);
  });

  on('saveLoaded', (data) => {
    if (!data?.player) return;
    const p = data.player;
    _state.name    = p.name  ?? _state.name;
    _state.level   = p.level ?? _state.level;
    _state.hp      = p.hp    ?? _state.hp;
    _state.maxHp   = p.maxHp ?? _state.maxHp;
    _state.mp      = p.mp    ?? _state.mp;
    _state.maxMp   = p.maxMp ?? _state.maxMp;
    _dirty.hp = _dirty.mp = _dirty.level = _dirty.name = true;
  });
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Inicializa o HUD: constrói o DOM e registra listeners de eventos.
 * @returns {void}
 */
export function init() {
  _buildDOM();
  _registerEvents();
  _dirty.hp = _dirty.mp = _dirty.level = _dirty.name = _dirty.fps = true;
}

/**
 * Atualiza o HUD respeitando dirty flags — chamado pelo game loop a cada frame.
 * @param {number} delta - Tempo desde o último frame em segundos.
 * @returns {void}
 */
export function update(delta) {
  if (_dirty.hp)    { _renderHP();    _dirty.hp    = false; }
  if (_dirty.mp)    { _renderMP();    _dirty.mp    = false; }
  if (_dirty.name)  { _renderName();  _dirty.name  = false; }
  if (_dirty.level) { _renderLevel(); _dirty.level = false; }
  if (_dirty.fps)   { _renderFPS();   _dirty.fps   = false; }
}

/**
 * Informa o FPS atual ao HUD (chamado a cada 30 frames pelo main.js).
 * @param {number} value - Valor de FPS calculado como média móvel.
 * @returns {void}
 */
export function setFPS(value) {
  const rounded = Math.round(value);
  if (_state.fps !== rounded) {
    _state.fps = rounded;
    _dirty.fps = true;
  }
}

/**
 * Exibe uma janela de UI pelo ID (stub — janelas reais serão implementadas nos PROMPTs 7+).
 * @param {string} id - Identificador da janela ('inventory', 'equipment', 'quest').
 * @returns {void}
 */
export function showWindow(id) {
  console.log(`[UI] showWindow: ${id} (stub — disponível no PROMPT 7+)`);
  emit('uiWindowOpened', { id });
}

/**
 * Fecha uma janela de UI pelo ID (stub).
 * @param {string} id - Identificador da janela.
 * @returns {void}
 */
export function hideWindow(id) {
  console.log(`[UI] hideWindow: ${id} (stub — disponível no PROMPT 7+)`);
  emit('uiWindowClosed', { id });
}

/**
 * Exibe um toast de notificação temporário por 3 segundos.
 * @param {string} msg - Texto da notificação.
 * @param {'info'|'warn'|'error'} [type='info'] - Tipo visual da notificação.
 * @returns {void}
 */
export function showNotification(msg, type = 'info') {
  const notif = document.createElement('div');
  notif.className = `hud-notification hud-notif-${type}`;
  notif.textContent = msg;
  _els.notifArea.appendChild(notif);

  // Trigger reflow para ativar animação CSS de entrada
  void notif.offsetWidth;
  notif.classList.add('hud-notif-visible');

  setTimeout(() => {
    notif.classList.remove('hud-notif-visible');
    notif.classList.add('hud-notif-hiding');
    notif.addEventListener('transitionend', () => notif.remove(), { once: true });
  }, 2700);
}

/**
 * Exibe uma árvore de diálogo (stub — implementação real no PROMPT 8).
 * @param {object} tree - DialogueTree conforme schema do blueprint.
 * @returns {void}
 */
export function showDialogue(tree) {
  console.log(`[UI] showDialogue: ${tree?.id ?? 'unknown'} (stub — disponível no PROMPT 8)`);
}