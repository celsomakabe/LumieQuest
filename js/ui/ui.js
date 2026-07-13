/**
 * @file ui.js
 * @description Renderiza e atualiza toda a interface: HUD HP/MP/XP,
 * notificações toast, mensagens centrais e FPS counter.
 */

import * as Events from '../core/events.js';
import * as THREE from 'three';
import { getCamera, getRenderer } from '../world/scene.js';
import * as Refine from '../systems/refine.js';
import * as Recipes from '../systems/recipes.js';
import * as Audio  from '../core/audio.js';
import * as Inventory from '../systems/inventory.js';
import * as Equipment from '../systems/equipment.js';
import * as Cards from '../systems/cards.js';
import * as Quests from '../systems/quests.js';
import * as Combat from '../systems/combat.js';
import * as Player from '../entities/player.js';
import * as Classes from '../systems/classes.js';
import * as Monsters from '../entities/monsters.js';
import * as Pets from '../systems/pets.js';

const EQUIPMENT_SLOT_META = [
    { slot: 'weapon',          label: 'Arma',    icon: '⚔️', title: 'Arma' },
    { slot: 'shield',          label: 'Escudo',  icon: '🛡️', title: 'Escudo' },
    { slot: 'upper_headgear',  label: 'Topo',    icon: '👒', title: 'Cabeça (Topo)' },
    { slot: 'mid_headgear',    label: 'Meio',    icon: '🎭', title: 'Cabeça (Meio)' },
    { slot: 'lower_headgear',  label: 'Baixo',   icon: '😷', title: 'Cabeça (Baixo)' },
    { slot: 'armor',           label: 'Arm.',    icon: '🥋', title: 'Armadura' },
    { slot: 'garment',         label: 'Capa',    icon: '🧥', title: 'Capa' },
    { slot: 'footgear',        label: 'Botas',   icon: '🥾', title: 'Calçado' },
    { slot: 'accessory_left',  label: 'Aces. E', icon: '💍', title: 'Acessório Esquerdo' },
    { slot: 'accessory_right', label: 'Aces. D', icon: '💍', title: 'Acessório Direito' }
];

// Off-hand polivalente: mesmo slot 'shield', rotulo conforme a classe do player.
const OFFHAND_LABELS = {
    swordman: 'Escudo', knight: 'Escudo', lord_knight: 'Escudo',
    mage: 'Grimório', wizard: 'Grimório', high_wizard: 'Grimório',
    archer: 'Aljava', hunter: 'Aljava', sniper: 'Aljava',
    assassin: 'Manopla', assassin_master: 'Manopla', shadow_assassin: 'Manopla',
};
/** Rotulo do off-hand (slot shield) conforme a classe atual. @returns {string} */
function _offhandLabel() {
    return OFFHAND_LABELS[Player.getState?.()?.class] ?? 'Escudo';
}

/**
 * Filtro da loja: item deve aparecer na coluna COMPRAR para a classe ATUAL.
 * Le a classe direto de Player.getState() (autoritativo, sem cache). Itens sem
 * classRestriction (consumiveis/materiais) sempre aparecem. Se a classe for
 * desconhecida, esconde os itens restritos (deterministico — nao "mostra tudo").
 * @param {string} itemId
 * @returns {boolean}
 */
function _shopShowsForClass(itemId) {
    const def = Inventory.getItemDef(itemId);
    if (!def) return false;
    const cr = def.classRestriction;
    if (cr == null || (Array.isArray(cr) && cr.length === 0)) return true; // sem restricao
    const cls = Player.getState?.()?.class;
    if (!cls) return false; // classe desconhecida -> nao mostra restritos
    const lineage = Classes.getClassLineage(cls);
    const list = Array.isArray(cr) ? cr : [cr];
    return list.some(c => lineage.includes(c));
}

let _inventoryWindowEl = null;
let _equipmentWindowEl = null;
let _refineWindowEl = null;
let _shopWindowEl = null;
let _shopStock = [];
let _petWindowEl = null;
let _selectedRefineTarget = null;
let _selectedRefineMeta = null;
let _refineActiveTab = 'refine'; // 'refine' (atual) | 'forge' (Forja de sets)
let _socketPopupEl = null;
let _socketPopupTarget = null;

function _formatStatsLine(stats) {
    if (!stats) return 'Sem bônus ativo';

    const parts = [];

    if (stats.str) parts.push(`+${stats.str} STR`);
    if (stats.agi) parts.push(`+${stats.agi} AGI`);
    if (stats.vit) parts.push(`+${stats.vit} VIT`);
    if (stats.int) parts.push(`+${stats.int} INT`);
    if (stats.dex) parts.push(`+${stats.dex} DEX`);
    if (stats.luk) parts.push(`+${stats.luk} LUK`);
    if (stats.hp_pct) parts.push(`+${stats.hp_pct}% HP`);
    if (stats.mp_pct) parts.push(`+${stats.mp_pct}% MP`);

    return parts.length ? parts.join(', ') : 'Sem bônus ativo';
}

function _getTierBadgeColor(tier) {
    if (tier === 'divine') return '#d4af37';
    if (tier === 'legendary') return '#a020f0';
    return '#5aa9e6';
}

export function getRefineColor(level) {
    const lv = Number(level ?? 0);
    if (lv >= 15) return '#F44336';
    if (lv >= 10) return '#FF9800';
    if (lv >= 7) return '#4CAF50';
    return '';
}

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
let _elXP        = null;
let _elXPBar     = null;

// ─── Estado ───────────────────────────────────────────────────────────────────

let _dirty = {
    hp: false,
    mp: false,
    xp: false,
};

let _hp    = { current: 100, max: 100 };
let _mp    = { current:  50, max:  50 };
let _xp    = { current:   0, needed: 100 };
let _name        = 'Herói';
let _playerTitle = '';
let _level       = 1;

// ─── estado do diálogo ───────────────────────────────────────────────────────
let _dialogOpen     = false;
let _currentNpcId   = null;
let _currentNpcName = null;
let _currentTree    = null;
let _currentNodeId  = null;

// ── Quest Log ─────────────────────────────────────────
let _questLogOpen = false;

/** @type {Map<string, HTMLElement>} npcId → elemento indicador */
const _npcIndicators = new Map();

// elementos DOM (criados em _buildDialogWindow / _buildHintElement)
let _dialogEl       = null;
let _hintEl         = null;

// ── Estado de skills/hotbar (PROMPT 10) ──────────────────────────────────
let _skillWindowOpen   = false;
let _petWindowOpen     = false;
let _hotbarEl          = null;
let _hotbarSlotEls     = [];
let _skillWindowEl     = null;
let _classModalEl      = null;
let _classModalCb      = null;
let _selectedSkillId   = null;
let _elMapName    = null;
let _elExitPrompt = null;
// ─── Helpers privados ─────────────────────────────────────────────────────────

/**
 * Cria o elemento DOM do HUD e injeta no body.
 */
let _deathOverlayEl = null;
let _deathOverlayVisible = false;
function _buildDOM() {
    const hud = document.createElement('div');
    hud.id = 'hud';
    hud.innerHTML = `
        <div id="hud-info">
            <span id="hud-name">${_name}</span>
            <span id="hud-map">Mapa: —</span>
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
            <div class="bar-row">
                <label>XP</label>
                <div class="bar-bg">
                    <div id="hud-xp-bar" class="bar xp-bar" style="width:0%"></div>
                </div>
                <span id="hud-xp">0/100</span>
            </div>
        </div>
        <div id="hud-fps">60 FPS</div>
    `;
    document.body.appendChild(hud);

    const notifWrap = document.createElement('div');
    notifWrap.id = 'notif-wrap';
    document.body.appendChild(notifWrap);

    const center = document.createElement('div');
    center.id = 'center-msg';
    center.style.display = 'none';
    document.body.appendChild(center);

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
        #hud-map { display: inline-block; margin-left: 10px; color: #ffd27a; font-size: 12px; }
        #exit-point-prompt {
            position: fixed; bottom: 110px; left: 50%; transform: translateX(-50%);
            background: rgba(10,8,5,0.82); border: 1px solid rgba(200,162,39,0.65);
            border-radius: 6px; padding: 7px 16px; color: #ffe6a3;
            font-family: monospace; font-size: 13px; text-shadow: 1px 1px 2px #000;
            pointer-events: none; user-select: none; z-index: 260; white-space: nowrap;
            display: none;
        }
        .bar-row { display: flex; align-items: center; gap: 4px; margin-bottom: 3px; }
        .bar-row label { width: 20px; }
        .bar-bg { width: 120px; height: 10px; background: #333; border-radius: 4px; overflow: hidden; }
        .bar { height: 100%; border-radius: 4px; transition: width 0.2s; }
        .hp-bar { background: #e05050; }
        .mp-bar { background: #4080e0; }
        .xp-bar { background: #a060e0; }
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
    const deathOverlay = document.createElement('div');
    deathOverlay.id = 'ui-death-overlay';
    deathOverlay.style.position = 'fixed';
    deathOverlay.style.inset = '0';
    deathOverlay.style.background = 'rgba(0, 0, 0, 0.75)';
    deathOverlay.style.display = 'none';
    deathOverlay.style.zIndex = '9999';
    deathOverlay.style.alignItems = 'center';
    deathOverlay.style.justifyContent = 'center';
    deathOverlay.style.flexDirection = 'column';
    deathOverlay.style.pointerEvents = 'auto';

    const deathMessage = document.createElement('div');
    deathMessage.textContent = 'Você morreu';
    deathMessage.style.color = '#ffffff';
    deathMessage.style.fontFamily = 'sans-serif';
    deathMessage.style.fontSize = '32px';
    deathMessage.style.marginBottom = '24px';
    deathMessage.style.textShadow = '0 0 8px rgba(0,0,0,0.8)';

    const deathButton = document.createElement('button');
    deathButton.textContent = 'Reviver na Cidade';
    deathButton.style.padding = '10px 20px';
    deathButton.style.fontSize = '18px';
    deathButton.style.cursor = 'pointer';
    deathButton.style.borderRadius = '4px';
    deathButton.style.border = 'none';
    deathButton.style.background = '#ff5252';
    deathButton.style.color = '#ffffff';
    deathButton.style.boxShadow = '0 0 10px rgba(0,0,0,0.5)';

    deathOverlay.appendChild(deathMessage);
    deathOverlay.appendChild(deathButton);
    document.body.appendChild(deathOverlay);
}
function _showDeathOverlay() {
    if (!_deathOverlayEl) return;
    _deathOverlayEl.style.display = 'flex';
    _deathOverlayVisible = true;
}

function _hideDeathOverlay() {
    if (!_deathOverlayEl) return;
    _deathOverlayEl.style.display = 'none';
    _deathOverlayVisible = false;
}
/**
 * Reconecta referências DOM após _buildDOM.
 */
function _queryRefs() {
    _elHP        = document.getElementById('hud-hp');
    _deathOverlayEl = document.getElementById('ui-death-overlay');
    _elMP        = document.getElementById('hud-mp');
    _elHPBar     = document.getElementById('hud-hp-bar');
    _elMPBar     = document.getElementById('hud-mp-bar');
    _elName      = document.getElementById('hud-name');
    _elLevel     = document.getElementById('hud-level');
    _elFPS       = document.getElementById('hud-fps');
    _elMapName   = document.getElementById('hud-map');
    _elExitPrompt = document.getElementById('exit-point-prompt');
    _elNotifWrap = document.getElementById('notif-wrap');
    _elCenter    = document.getElementById('center-msg');
    _elXP        = document.getElementById('hud-xp');
    _elXPBar     = document.getElementById('hud-xp-bar');
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Inicializa a UI: cria DOM e registra listeners de eventos.
 */
function _renderPlayerName() {
    if (!_elName) return;
    const title = (_playerTitle || '').trim();
    const name  = (_name || 'Herói').trim();
    _elName.textContent = title ? `[${title}] ${name}` : name;
}

export function isEquipmentWindowOpen() {
    return !!_equipmentWindowEl && _equipmentWindowEl.style.display !== 'none';
}

export function toggleEquipmentWindow() {
    if (!_equipmentWindowEl) return;

    const opening = _equipmentWindowEl.style.display === 'none';
    _equipmentWindowEl.style.display = opening ? 'block' : 'none';

    if (opening) {
        _refreshEquipmentWindowUI();
        Events.emit('uiWindowOpened', { id: 'equipment' });
    } else {
        _closeSocketPopup();
        Events.emit('uiWindowClosed', { id: 'equipment' });
    }
}

export function init() {
    _buildDOM();
    _queryRefs();
    if (_deathOverlayEl) {
        const btn = _deathOverlayEl.querySelector('button');
        if (btn) {
            btn.addEventListener('click', () => {
                import('../entities/player.js').then(mod => {
                    if (typeof mod.respawn === 'function') {
                        mod.respawn();
                    }
                }).catch(err => {
                    console.error('[ui] Erro ao importar player.js para respawn:', err);
                });
            });
        }
    }
    _renderPlayerName();
    Events.on('exitPointNear', ({ label } = {}) => {
        if (_elExitPrompt) {
            _elExitPrompt.textContent = `Pressione E para ir a ${label || 'saída'}`;
            _elExitPrompt.style.display = 'block';
        }
    });

    Events.on('exitPointLeft', () => {
        if (_elExitPrompt) _elExitPrompt.style.display = 'none';
    });

    Events.on('mapLoaded', ({ mapId, mapName } = {}) => {
        if (_elExitPrompt) _elExitPrompt.style.display = 'none';
        const label = mapName || mapId || '';
        if (_elMapName) _elMapName.textContent = `Mapa: ${label}`;
        if (label) showCenterMessage(label);
    });
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
        if (name)  _name = name;
        if (level) { _level = level; _elLevel.textContent = `Lv ${level}`; }
        if (hp)    { _hp = hp; _dirty.hp = true; }
        if (mp)    { _mp = mp; _dirty.mp = true; }
        const state = Player.getState?.();
        if (state?.title !== undefined) _playerTitle = state.title ?? '';
        _renderPlayerName();
    });

    Events.on('jobChanged', ({ player } = {}) => {
        if (player?.title !== undefined) _playerTitle = player.title ?? '';
        if (player?.name) _name = player.name;
        _renderPlayerName();
    });

    Events.on('levelUp', ({ newLevel }) => {
        _level = newLevel;
        if (_elLevel) _elLevel.textContent = `Lv ${newLevel}`;
        showNotification(`🎉 Level Up! Nível ${newLevel}`, 'success');
        Audio.playSFX('assets/audio/sfx/sfx_levelup.ogg');
    });

    Events.on('expChanged', ({ current, needed }) => {
        _xp = { current, needed };
        _dirty.xp = true;
    });

     Events.on('damageDealt', ({ target, amount, isCritical, isSkill }) => {
        
        if (!target?.position) return;
        if (target.type === 'player') return;
        
        if (isCritical) {
            showDamagePopup(target.position, amount, true);
        } else if (isSkill) {
            _showSkillDamagePopup(target.position, amount);
        } else {
            showDamagePopup(target.position, amount, false);
        }
    });

    Events.on('mpConsumeRequest', ({ amount }) => {
        if (typeof amount !== 'number' || amount <= 0) return;
        showMpPopup(amount);
    });

    const goldHud = document.createElement('div');
    goldHud.id = 'ui-gold-hud';
    goldHud.style.cssText = `
        position:fixed; bottom:16px; right:16px;
        background:rgba(20,18,14,0.82); border:1px solid #5a4a2a;
        border-radius:6px; padding:4px 10px;
        color:#ffd700; font-family:monospace; font-size:13px;
        z-index:100; pointer-events:none;
    `;
    goldHud.textContent = '🪙 0';
    document.body.appendChild(goldHud);

    const invPanel = document.createElement('div');
    invPanel.id = 'ui-inventory';
    invPanel.style.cssText = `
        display:none;
        position:fixed;
        top:50%;
        left:50%;
        transform:translate(-50%,-50%);
        background:rgba(20,18,14,0.97);
        border:1px solid #5a4a2a;
        border-radius:8px;
        padding:16px;
        z-index:200;
        width:720px;
        max-width:95vw;
        color:#e8d8a0;
        font-family:monospace;
        font-size:15px;
        box-shadow:0 8px 32px rgba(0,0,0,0.7);
        user-select:none;
    `;
    invPanel.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <span style="font-size:15px;font-weight:bold;">🎒 Inventário</span>
            <span id="ui-inv-close" style="cursor:pointer;font-size:18px;line-height:1;">✕</span>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;font-size:12px;color:#c8a84a;">
            <div>Equipamentos</div>
            <div>🪙 <span id="ui-gold-inv">0</span></div>
        </div>

        <div id="ui-inv-equip-grid" style="display:grid;grid-template-columns:repeat(5,72px);gap:6px;margin-bottom:10px;">
            ${EQUIPMENT_SLOT_META.map(({ slot, label, title }) => `
                <div class="ui-equip-slot" data-slot="${slot}" title="${title}" style="width:72px;height:72px;border:1px solid #5a4a2a;border-radius:4px;display:flex;align-items:center;justify-content:center;cursor:pointer;background:#2a2010;font-size:12px;text-align:center;">${label}</div>
            `).join('')}
        </div>

        <div style="font-size:11px;color:#a08040;margin-bottom:6px;">ITENS (clique-dir: usar/equipar)</div>
        <div id="ui-inv-grid" style="display:grid;grid-template-columns:repeat(6,1fr);gap:6px;"></div>
        <div style="margin-top:8px;font-size:10px;color:#706050;">E = pegar item | I = fechar</div>
    `;
    document.body.appendChild(invPanel);
    _inventoryWindowEl = invPanel;

    document.getElementById('ui-inv-close').addEventListener('click', () => {
        invPanel.style.display = 'none';
        Events.emit('uiWindowClosed', { id: 'inventory' });
    });

    invPanel.querySelectorAll('.ui-equip-slot').forEach(el => {
        el.addEventListener('click', () => {
            Inventory.unequipItem(el.dataset.slot);
            _refreshInventoryUI();
        });
    });

    const equipmentPanel = document.createElement('div');
    equipmentPanel.id = 'ui-equipment';
    equipmentPanel.style.cssText = `
        display:none;
        position:fixed;
        top:50%;
        left:50%;
        transform:translate(-50%,-50%);
        background:rgba(20,18,14,0.97);
        border:1px solid #5a4a2a;
        border-radius:8px;
        padding:16px;
        z-index:210;
        width:760px;
        max-width:95vw;
        max-height:85vh;
        overflow:auto;
        color:#e8d8a0;
        font-family:monospace;
        font-size:15px;
        box-shadow:0 8px 32px rgba(0,0,0,0.7);
        user-select:none;
    `;

    equipmentPanel.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <span style="font-size:15px;font-weight:bold;">🛡️ Equipamentos</span>
            <span id="ui-equip-close" style="cursor:pointer;font-size:18px;line-height:1;">✕</span>
        </div>

        <div style="font-size:11px;color:#a08040;margin-bottom:6px;">EQUIPAMENTO</div>
        <div id="ui-eq-grid" style="display:grid;grid-template-columns:repeat(5,72px);gap:6px;margin-bottom:14px;">
            ${EQUIPMENT_SLOT_META.map(({ slot, label, title }) => `
                <div class="ui-equipment-slot" data-slot="${slot}" title="${title}" style="width:72px;height:72px;border:1px solid #5a4a2a;border-radius:4px;display:flex;align-items:center;justify-content:center;cursor:pointer;background:#2a2010;font-size:12px;text-align:center;">${label}</div>
            `).join('')}
        </div>

        <div style="font-size:13px;color:#c8a84a;margin-bottom:8px;">Sockets</div>
        <div id="ui-item-sockets" style="display:flex;flex-direction:column;gap:10px;margin-bottom:14px;"></div>

        <div style="font-size:13px;color:#c8a84a;margin-bottom:8px;">Sets Ativos</div>
        <div id="ui-active-sets" style="display:flex;flex-direction:column;gap:10px;"></div>

        <div style="margin-top:8px;font-size:10px;color:#706050;">C = fechar</div>
    `;

    document.body.appendChild(equipmentPanel);
    _equipmentWindowEl = equipmentPanel;

    document.getElementById('ui-equip-close').addEventListener('click', () => {
        equipmentPanel.style.display = 'none';
        _closeSocketPopup();
        Events.emit('uiWindowClosed', { id: 'equipment' });
    });

    equipmentPanel.querySelectorAll('.ui-equipment-slot').forEach(el => {
        el.addEventListener('click', () => {
            Inventory.unequipItem(el.dataset.slot);
            _refreshInventoryUI();
            _refreshEquipmentWindowUI();
        });
    });

    Events.on('itemAdded', () => _refreshInventoryUI());
    Events.on('itemRemoved', () => _refreshInventoryUI());

    Events.on('itemEquipped', () => {
        _refreshInventoryUI();
        if (isEquipmentWindowOpen()) _refreshEquipmentWindowUI();
    });

    Events.on('itemUnequipped', () => {
        _refreshInventoryUI();
        if (isEquipmentWindowOpen()) _refreshEquipmentWindowUI();
    });

    Events.on('setBonusChanged', () => {
        if (isEquipmentWindowOpen()) _refreshEquipmentWindowUI();
    });

    Events.on('goldChanged', ({ total }) => {
        const gh = document.getElementById('ui-gold-hud');
        const gi = document.getElementById('ui-gold-inv');
        const gs = document.getElementById('ui-shop-gold');
        if (gh) gh.textContent = '🪙 ' + total;
        if (gi) gi.textContent = total;
        if (gs) gs.textContent = total;
    });

    Events.on('inventoryFull', ({ itemId }) => {
        showNotification(`Inventário cheio! (${itemId})`, 'warning');
    });

    Events.on('equipBlocked', ({ itemId }) => {
        const nm = Inventory.getItemDef(itemId)?.name ?? itemId;
        showNotification(`Sua classe não pode equipar: ${nm}`, 'warning');
    });

    Events.on('equipmentAutoUnequipped', ({ itemId }) => {
        const nm = Inventory.getItemDef(itemId)?.name ?? itemId;
        showNotification(`${nm} foi desequipado (classe incompatível).`, 'warning');
        _refreshInventoryUI();
    });

    Events.on('refineSuccess', ({ itemId, newLevel }) => {
        const def = Inventory.getItemDef(itemId);
        const name = def?.name ?? itemId;
        showNotification(`Refino concluído: +${newLevel} ${name}`, 'success');
        _renderRefineList();
    });

    Events.on('refineFail', ({ itemId, newLevel, broke, blessed, protected: wasProtected }) => {
        const def = Inventory.getItemDef(itemId);
        const name = def?.name ?? itemId;

        if (blessed) {
            showNotification('Abençoado! Item protegido.', 'info');
        } else if (wasProtected) {
            showNotification('Protetor ativado! Item não quebrou.', 'info');
        } else if (broke) {
            showNotification(`Falha no refino: ${name} foi destruído!`, 'error');
        } else {
            showNotification(`Falha no refino: agora em +${newLevel} ${name}`, 'warning');
        }

        _renderRefineList();
    });

    Events.on('refineMax', ({ itemId }) => {
        const def = Inventory.getItemDef(itemId);
        const name = def?.name ?? itemId;
        showCenterMessage(`+15 ${name}`);
        _renderRefineList();
    });

    Events.on('uiWindowToggle', ({ id, stock }) => {
        if (id === 'shop') {
            Audio.playSFX('assets/audio/sfx/sfx_ui_click.ogg');
            const opening = !_shopWindowEl || _shopWindowEl.style.display === 'none';
            if (opening) { _openShopWindow(stock); } else { _closeShopWindow(); }
            return;
        }
        if (id === 'inventory') {
            const panel = document.getElementById('ui-inventory');
            if (!panel) return;

            const isOpen = panel.style.display !== 'none';
            if (isOpen) {
                panel.style.display = 'none';
                Events.emit('uiWindowClosed', { id: 'inventory' });
            } else {
                Audio.playSFX('assets/audio/sfx/sfx_ui_click.ogg');
                _refreshInventoryUI();
                panel.style.display = 'block';
                Events.emit('uiWindowOpened', { id: 'inventory' });
            }
            return;
        }

        if (id === 'equipment') {
            Audio.playSFX('assets/audio/sfx/sfx_ui_click.ogg');
            toggleEquipmentWindow();
            return;
        }

        if (id === 'refine') {
            Audio.playSFX('assets/audio/sfx/sfx_ui_click.ogg');
            const opening = !_refineWindowEl || _refineWindowEl.style.display === 'none';
            if (opening) {
                _openRefineWindow();
            } else {
                _closeRefineWindow();
            }
            return;
        }
        if (id === 'pets' || id === 'petWindow') {
            Audio.playSFX('assets/audio/sfx/sfx_ui_click.ogg');
            togglePetWindow();
            return;
        }
    });
    _buildDialogWindow();
    _buildHintElement();

    Events.on('dialogStarted', _onDialogStarted);
    Events.on('uiHintShow',    _onHintShow);
    Events.on('uiHintHide',    _onHintHide);

    Events.on('keyPressed', ({ code, action }) => {
if (code === 'Escape' && _dialogOpen) _closeDialog();
        if (code === 'Escape' && _questLogOpen && !_dialogOpen) toggleQuestLog();
        if (code === 'Escape' && _skillWindowOpen && !_dialogOpen) toggleSkillWindow();
        if (code === 'Escape' && _petWindowOpen && !_dialogOpen) togglePetWindow();
        if (code === 'Escape' && _refineWindowEl && _refineWindowEl.style.display !== 'none' && !_dialogOpen) _closeRefineWindow();
        if (code === 'Escape' && _shopWindowEl && _shopWindowEl.style.display !== 'none' && !_dialogOpen) _closeShopWindow();

        if (action === 'questLog') {
            if (!_dialogOpen) toggleQuestLog();
        }

        if (typeof isDialogOpen === 'function' && isDialogOpen()) return;
        if ((code === 'KeyC' || action === 'equipmentWindow') && !_dialogOpen) {
            toggleEquipmentWindow();
        }
        if ((code === 'KeyP' || action === 'petWindow') && !_dialogOpen) {
            togglePetWindow();
        }    });

    _createQuestLogPanel();
    _createQuestNotificationContainer();
    _createPetWindow();

    Events.on('uiWindowClosed', ({ id, name }) => {
        if (id === 'questLog' || name === 'questLog') _questLogOpen = false;
        if (id === 'pets' || name === 'pets') {
            _petWindowOpen = false;
            if (_petWindowEl) _petWindowEl.style.display = 'none';
        }
    });

    Events.on('questAccepted', ({ quest }) =>
        showQuestNotification(`Quest aceita: ${quest.name}`, 'quest-accepted'));

    Events.on('questProgress', ({ questId, objectiveId, current, required }) => {
        const entry = Quests.getActiveQuests().find(({ definition: q }) => q.id === questId);
        const quest = entry?.definition;
        const obj = quest?.objectives?.find(o => o.id === objectiveId);
        if (obj) {
            showQuestNotification(`${obj.label}: ${current}/${required}`, 'quest-progress');
        }
    });

    Events.on('questCompletable', ({ quest }) =>
        showQuestNotification(`${quest.name}: fale com o NPC!`, 'quest-completable'));

    Events.on('questCompleted', ({ quest }) =>
        showQuestNotification(`Quest completa: ${quest.name}`, 'quest-completed'));

    _injectSkillStyles();
    _buildHotbar();
    _buildSkillWindow();

    Events.on('keyPressed', ({ action }) => {
        if (_dialogOpen) return;

        if (action === 'petWindow') {
            togglePetWindow();
            return;
        }

        if (action === 'skillWindow') {
            toggleSkillWindow();
            return;
        }

        const slotMap = { skill1: 0, skill2: 1, skill3: 2, skill4: 3 };
        if (action in slotMap) {
            _triggerSkillSlot(slotMap[action]);
        }
    });

    Events.on('playerSpawned', () => updateHotbar());

    Events.on('monsterSpawned', ({ id }) => _createMonsterHpBar(id));
    Events.on('monsterDied',    ({ id }) => _removeMonsterHpBar(id));

    // Labels flutuantes de drops no chao ("{qty}x {nome}" / "{nome}").
    Events.on('itemDropped', ({ dropId, name, qty, type }) => {
        if (!dropId) return;
        const label = qty > 1 ? `${qty}x ${name}` : `${name}`;
        _createDropLabel(dropId, label, type);
    });
    Events.on('itemPicked', ({ dropId }) => { if (dropId) _removeDropLabel(dropId); });
    Events.on('mapUnloading', () => {
        _dropLabels.forEach(el => el.remove());
        _dropLabels.clear();
    });

    Events.on('petObtained',    () => { if (_petWindowOpen) _refreshPetWindowUI(); });
    Events.on('petSummoned',    () => { if (_petWindowOpen) _refreshPetWindowUI(); });
    Events.on('petUnsummoned',  () => { if (_petWindowOpen) _refreshPetWindowUI(); });
    Events.on('petLevelUp',     () => { if (_petWindowOpen) _refreshPetWindowUI(); });
    Events.on('petBonusChanged',() => { if (_petWindowOpen) _refreshPetWindowUI(); });
    // Boss HP bar
    Events.on('questBossSpawnRequest', _onQuestBossSpawnRequest);
    Events.on('damageDealt', _onDamageDealt);
    Events.on('monsterDied', _onMonsterDiedBoss);
    Events.on('playerDied', () => {
        _showDeathOverlay();
    });

    Events.on('playerRespawned', () => {
        _hideDeathOverlay();
    });
    _ensureBossHpBar();
}

// ─── Boss HP bar ─────────────────────────────────────────────────────────────

let _bossHpRoot = null;
let _bossHpName = null;
let _bossHpFill = null;
let _activeBossBar = null;

function _ensureBossHpBar() {
    if (_bossHpRoot) return;

    _bossHpRoot = document.createElement('div');
    _bossHpRoot.id = 'boss-hp-bar';
    _bossHpRoot.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);width:400px;pointer-events:none;z-index:1200;display:none;background:rgba(10,10,10,0.88);border:2px solid #d4af37;border-radius:10px;padding:8px 10px 10px 10px;box-shadow:0 0 16px rgba(0,0,0,0.35)';

    _bossHpName = document.createElement('div');
    _bossHpName.style.cssText = 'color:#f5e6a8;font-weight:700;font-size:14px;margin-bottom:6px;text-align:center';
    _bossHpName.textContent = 'Boss';

    const track = document.createElement('div');
    track.style.cssText = 'width:100%;height:20px;background:#1b1b1b;border:1px solid #8a6b1f;border-radius:999px;overflow:hidden';

    _bossHpFill = document.createElement('div');
    _bossHpFill.style.cssText = 'width:100%;height:100%;background:#35c759;transition:width 120ms linear,background 120ms linear';

    track.appendChild(_bossHpFill);
    _bossHpRoot.appendChild(_bossHpName);
    _bossHpRoot.appendChild(track);
    document.body.appendChild(_bossHpRoot);
}

function _getBossHpColor(pct) {
    if (pct > 0.5) return '#35c759';
    if (pct > 0.25) return '#f4c542';
    return '#d64545';
}

function _showBossHpBar(boss = {}) {
    _ensureBossHpBar();
    const current = Number(boss.hp ?? 0);
    const max = Math.max(1, Number(boss.maxHp ?? 1));
    const pct = Math.max(0, Math.min(1, current / max));

    _activeBossBar = {
        id: boss.id ?? _activeBossBar?.id ?? null,
        monsterId: boss.monsterId ?? _activeBossBar?.monsterId ?? null,
        name: boss.name ?? _activeBossBar?.name ?? 'Boss',
        hp: current,
        maxHp: max,
    };

    _bossHpName.textContent = _activeBossBar.name;
    _bossHpFill.style.width = `${pct * 100}%`;
    _bossHpFill.style.background = _getBossHpColor(pct);
    _bossHpRoot.style.display = 'block';
}

function _hideBossHpBar() {
    if (!_bossHpRoot) return;
    _activeBossBar = null;
    _bossHpRoot.style.display = 'none';
}

function _onQuestBossSpawnRequest({ bossId } = {}) {
    if (!bossId) return;
    const bossNames = {
        boss_lord_knight: 'Boss Lord Knight',
        boss_high_wizard: 'Boss High Wizard',
        boss_sniper: 'Boss Sniper',
        boss_shadow_assassin: 'Boss Shadow Assassin',
    };
    const bossMaxHp = {
        boss_lord_knight: 1200,
        boss_high_wizard: 1050,
        boss_sniper: 980,
        boss_shadow_assassin: 990,
    };
    _showBossHpBar({
        monsterId: bossId,
        name: bossNames[bossId] ?? bossId,
        hp: bossMaxHp[bossId] ?? 1,
        maxHp: bossMaxHp[bossId] ?? 1,
    });
}

function _onDamageDealt({ target } = {}) {
    if (!target?.isBoss) return;
    _showBossHpBar({
        id: target.id,
        monsterId: target.monsterId,
        name: _activeBossBar?.name ?? target.monsterId ?? 'Boss',
        hp: target.hp,
        maxHp: target.maxHp,
    });
}

function _onMonsterDiedBoss(payload = {}) {
    if (!payload.isBoss) return;
    const sameBoss =
        (_activeBossBar?.id && payload.id && _activeBossBar.id === payload.id) ||
        (_activeBossBar?.monsterId && payload.monsterId && _activeBossBar.monsterId === payload.monsterId) ||
        (!_activeBossBar);
    if (!sameBoss) return;
    _hideBossHpBar();
}
// ─── construção DOM (diálogo) ────────────────────────────────────────────────

function _buildDialogWindow() {
    _dialogEl = document.createElement('div');
    _dialogEl.id = 'dialog-window';
    _dialogEl.style.cssText = `
        display: none;
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        width: 60vw;
        min-width: 320px;
        max-width: 860px;
        min-height: 25vh;
        background: rgba(10, 8, 5, 0.88);
        border: 2px solid #c8a227;
        border-radius: 8px;
        padding: 16px 20px 14px;
        box-sizing: border-box;
        z-index: 200;
        font-family: inherit;
        color: #f0e6c8;
        flex-direction: column;
        gap: 10px;
        pointer-events: auto;
        backdrop-filter: blur(4px);
    `;

    const nameEl = document.createElement('div');
    nameEl.id = 'dialog-npc-name';
    nameEl.style.cssText = `
        font-size: 13px;
        font-weight: bold;
        color: #c8a227;
        text-transform: uppercase;
        letter-spacing: 1px;
        border-bottom: 1px solid rgba(200, 162, 39, 0.35);
        padding-bottom: 8px;
    `;

    const textEl = document.createElement('div');
    textEl.id = 'dialog-text';
    textEl.style.cssText = `
        font-size: 14px;
        line-height: 1.6;
        flex: 1;
        color: #f0e6c8;
    `;

    const optionsEl = document.createElement('div');
    optionsEl.id = 'dialog-options';
    optionsEl.style.cssText = `
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-top: 4px;
    `;

    _dialogEl.appendChild(nameEl);
    _dialogEl.appendChild(textEl);
    _dialogEl.appendChild(optionsEl);
    document.body.appendChild(_dialogEl);
}

function _buildHintElement() {
    _hintEl = document.createElement('div');
    _hintEl.id = 'npc-hint';
    _hintEl.style.cssText = `
        display: none;
        position: fixed;
        bottom: 80px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(10, 8, 5, 0.75);
        border: 1px solid rgba(200, 162, 39, 0.6);
        border-radius: 4px;
        padding: 5px 14px;
        color: #c8a227;
        font-size: 12px;
        letter-spacing: 0.5px;
        pointer-events: none;
        z-index: 190;
        white-space: nowrap;
    `;
    document.body.appendChild(_hintEl);
}

// ─── controle do diálogo ─────────────────────────────────────────────────────

function _onDialogStarted({ npcId, npcName, dialogTree }) {
    _dialogOpen     = true;
    _currentNpcId   = npcId;
    _currentNpcName = npcName;
    _currentTree    = dialogTree;
    _currentNodeId  = dialogTree.root;

    _dialogEl.style.display = 'flex';
    _hintEl.style.display   = 'none';

    _renderDialogNode(_currentNodeId);
}

function _evaluateDialogCondition(condition) {
    if (!condition) return true;

    const { type, questId } = condition;
    if (!type) return true;

    if (type === 'questNotStarted') {
        return !Quests.isActive(questId) && !Quests.isCompleted(questId);
    }
    if (type === 'questActive') {
        return Quests.isActive(questId);
    }
    if (type === 'questCompletable') {
        return Quests.isCompletable(questId);
    }
    if (type === 'questCompleted') {
        return Quests.isCompleted(questId);
    }
    if (type === 'playerClassIs') {
        return Player.getState()?.class === condition.value;
    }

    return true;
}

function _renderDialogNode(nodeId) {
    const node = _currentTree.nodes[nodeId];
    if (!node) { _closeDialog(); return; }

    document.getElementById('dialog-npc-name').textContent = _currentNpcName;
    document.getElementById('dialog-text').textContent     = node.text;

    const optionsEl = document.getElementById('dialog-options');
    optionsEl.innerHTML = '';

    node.options.forEach((opt, index) => {
        if (!_evaluateDialogCondition(opt.condition)) return;

        const btn = document.createElement('button');
        btn.textContent = `› ${opt.text}`;
        btn.style.cssText = `
            background: transparent;
            border: none;
            border-left: 2px solid transparent;
            color: #d4c48a;
            font-size: 13px;
            text-align: left;
            padding: 4px 10px;
            cursor: pointer;
            transition: color 0.15s, border-color 0.15s;
            font-family: inherit;
        `;

        btn.addEventListener('mouseenter', () => {
            btn.style.color       = '#fff9e6';
            btn.style.borderColor = '#c8a227';
        });

        btn.addEventListener('mouseleave', () => {
            btn.style.color       = '#d4c48a';
            btn.style.borderColor = 'transparent';
        });

        btn.addEventListener('click', () => {
            Events.emit('dialogOptionSelected', {
                npcId:       _currentNpcId,
                nodeId:      _currentNodeId,
                optionIndex: index,
            });

            if (opt.next === 'end') {
                _closeDialog();
            } else {
                _currentNodeId = opt.next;
                _renderDialogNode(_currentNodeId);
            }
        });

        optionsEl.appendChild(btn);
    });
}

function _closeDialog() {
    if (!_dialogOpen) return;

    _dialogOpen = false;
    _dialogEl.style.display = 'none';

    Events.emit('dialogEnded', { npcId: _currentNpcId });

    _currentNpcId   = null;
    _currentNpcName = null;
    _currentTree    = null;
    _currentNodeId  = null;
}

function _onHintShow({ message }) {
    if (_dialogOpen) return;
    _hintEl.textContent   = message;
    _hintEl.style.display = 'block';
}

function _onHintHide() {
    _hintEl.style.display = 'none';
}

/**
 * Cria o painel HTML do Quest Log (oculto por padrão).
 */
function _createQuestLogPanel() {
    if (document.getElementById('quest-log')) return;

    const panel = document.createElement('div');
    panel.id = 'quest-log';
    panel.style.cssText = `
        display: none;
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 420px;
        max-height: 520px;
        background: rgba(10, 10, 10, 0.92);
        border: 1px solid #a08040;
        border-radius: 6px;
        padding: 16px;
        color: #e8d8a0;
        font-family: sans-serif;
        font-size: 14px;
        z-index: 900;
        overflow-y: auto;
        box-shadow: 0 4px 24px rgba(0,0,0,0.7);
    `;
    panel.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;
                    margin-bottom:12px;border-bottom:1px solid #a08040;padding-bottom:8px;">
          <span style="font-size:16px;font-weight:bold;">📋 Diário de Quests</span>
          <span style="cursor:pointer;font-size:18px;color:#a08040;"
                id="quest-log-close">✕</span>
        </div>
        <div id="quest-log-body"></div>
    `;
    document.body.appendChild(panel);

    document.getElementById('quest-log-close')
        .addEventListener('click', () => toggleQuestLog());
}

/**
 * Cria o container de notificações de quest (canto superior direito).
 */
function _createQuestNotificationContainer() {
    if (document.getElementById('quest-notifications')) return;

    const container = document.createElement('div');
    container.id = 'quest-notifications';
    container.style.cssText = `
        position: fixed;
        top: 80px;
        right: 16px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        z-index: 950;
        pointer-events: none;
    `;
    document.body.appendChild(container);
}
// ─── Pet Window ──────────────────────────────────────────────────────────────

function _createPetWindow() {
    if (_petWindowEl) return;

    const panel = document.createElement('div');
    panel.id = 'pet-window';
    panel.style.cssText = `
        display: none;
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 460px;
        max-width: 94vw;
        max-height: 85vh;
        overflow-y: auto;
        background: rgba(20, 18, 14, 0.97);
        border: 1px solid #5a4a2a;
        border-radius: 8px;
        padding: 16px;
        z-index: 920;
        color: #e8d8a0;
        font-family: monospace;
        font-size: 14px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.7);
        user-select: none;
    `;

    panel.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <span style="font-size:15px;font-weight:bold;">Coleção de Pets</span>
            <span id="ui-pet-close" style="cursor:pointer;font-size:18px;line-height:1;">×</span>
        </div>
        <div id="pet-window-summary" style="margin-bottom:12px;padding:10px;border:1px solid #4e3b1f;border-radius:6px;background:#21180d;color:#c8a84a;">
            Nenhum pet invocado.
        </div>
        <div id="pet-window-list" style="display:flex;flex-direction:column;gap:10px;"></div>
        <div style="margin-top:10px;font-size:11px;color:#8f7a4f;">P para abrir/fechar</div>
    `;

    document.body.appendChild(panel);
    _petWindowEl = panel;

    document.getElementById('ui-pet-close')?.addEventListener('click', togglePetWindow);
}

function _getPetXpToNext(level) {
    return Math.floor(50 * (1.3 ** (Math.max(1, Number(level ?? 1)) - 1)));
}

function _formatPetBonusesLine(bonuses) {
    if (!bonuses || typeof bonuses !== 'object') return 'Sem bônus passivos.';
    const parts = [];
    if (bonuses.maxHp) parts.push(`+${bonuses.maxHp} HP`);
    if (bonuses.maxMp) parts.push(`+${bonuses.maxMp} MP`);
    if (bonuses.def) parts.push(`+${bonuses.def} DEF`);
    if (bonuses.atk) parts.push(`+${bonuses.atk} ATK`);
    if (bonuses.agi) parts.push(`+${bonuses.agi} AGI`);
    if (bonuses.int) parts.push(`+${bonuses.int} INT`);
    if (bonuses.dex) parts.push(`+${bonuses.dex} DEX`);
    if (bonuses.mpRegen) parts.push(`+${bonuses.mpRegen} Regen MP`);
    return parts.length ? parts.join(' • ') : 'Sem bônus passivos.';
}

function _refreshPetWindowUI() {
    if (!_petWindowEl) return;

    const summaryEl = document.getElementById('pet-window-summary');
    const listEl = document.getElementById('pet-window-list');
    if (!summaryEl || !listEl) return;

    const collection = Pets.getCollection();
    const summoned = Pets.getSummonedPet();

    summaryEl.innerHTML = summoned
        ? `<div style="font-size:13px;color:#ffd27a;margin-bottom:4px;">Pet invocado</div>
           <div>${summoned.def?.name ?? summoned.petId} • Nv. ${summoned.level}</div>
           <div style="margin-top:4px;font-size:12px;color:#9f8e68;">${_formatPetBonusesLine(summoned.bonuses)}</div>`
        : 'Nenhum pet invocado.';

    if (!collection.length) {
        listEl.innerHTML = `<div style="padding:12px;border:1px solid #4e3b1f;border-radius:6px;background:#21180d;color:#a89368;">Nenhum pet capturado ainda.</div>`;
        return;
    }

    listEl.innerHTML = '';

    collection.forEach((entry, index) => {
        const def = Pets.getPetDef(entry.petId);
        if (!def) return;

        const level = Math.max(1, Number(entry.level ?? 1));
        const exp = Math.max(0, Number(entry.exp ?? 0));
        const xpToNext = _getPetXpToNext(level);
        const xpPct = level >= 20 ? 100 : Math.min(100, (exp / Math.max(1, xpToNext)) * 100);
        const isSummoned = summoned?.petId === entry.petId;

        const passiveBonuses = {};
        const statKeys = new Set([
            ...Object.keys(def.baseBonus ?? {}),
            ...Object.keys(def.bonusPerLevel ?? {})
        ]);
        for (const stat of statKeys) {
            const base = Number(def.baseBonus?.[stat] ?? 0);
            const perLevel = Number(def.bonusPerLevel?.[stat] ?? 0);
            const value = base + (perLevel * Math.max(0, level - 1));
            if (value) passiveBonuses[stat] = value;
        }

        const abilities = Array.isArray(def.abilities) ? def.abilities : [];
        const abilitiesHtml = abilities.length
            ? abilities.map(a => {
                const reqLv = Math.max(1, Number(a.unlockLevel ?? 1));
                const unlocked = level >= reqLv;
                return `<div style="padding:5px 8px;border-radius:4px;background:${unlocked ? '#1f4d2b' : '#2b2b2b'};color:${unlocked ? '#b8ffbf' : '#9a9a9a'};border:1px solid ${unlocked ? '#3f8f54' : '#4a4a4a'};font-size:11px;">
                    <span style="font-weight:bold;">${a.name}</span> — ${unlocked ? 'Desbloqueada' : `Nível ${reqLv}`}
                </div>`;
            }).join('')
            : '<div style="font-size:11px;color:#8f7a4f;">Sem habilidades.</div>';

        const row = document.createElement('div');
        row.style.cssText = `padding:12px;border:1px solid ${isSummoned ? '#6dff7a' : '#5a4a2a'};border-radius:8px;background:${isSummoned ? '#1d2a1d' : '#21180d'};box-shadow:${isSummoned ? '0 0 0 1px #6dff7a,0 0 18px rgba(109,255,122,0.25)' : 'none'};`;

        row.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
                <div style="flex:1;min-width:0;">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <span style="font-size:15px;color:#ffd27a;">${def.name}</span>
                        <span style="font-size:12px;color:${isSummoned ? '#b8ffbf' : '#c8a84a'};">${isSummoned ? 'Invocado' : 'Guardado'}</span>
                    </div>
                    <div style="margin-top:4px;font-size:12px;color:#b9a57a;">Nível ${level}</div>
                    <div style="margin-top:8px;">
                        <div style="display:flex;justify-content:space-between;font-size:11px;color:#a89368;margin-bottom:4px;">
                            <span>XP</span><span>${level >= 20 ? 'MAX' : `${exp} / ${xpToNext}`}</span>
                        </div>
                        <div style="height:8px;background:#2a2116;border:1px solid #4e3b1f;border-radius:999px;overflow:hidden;">
                            <div style="height:100%;width:${xpPct}%;background:${level >= 20 ? '#4caf50' : '#a08040'};"></div>
                        </div>
                    </div>
                    <div style="margin-top:10px;font-size:12px;color:#c8a84a;">Bônus passivos</div>
                    <div style="margin-top:4px;font-size:11px;color:#ddd1b2;">${_formatPetBonusesLine(passiveBonuses)}</div>
                    <div style="margin-top:10px;font-size:12px;color:#c8a84a;">Habilidades</div>
                    <div style="margin-top:6px;display:flex;flex-direction:column;gap:6px;">${abilitiesHtml}</div>
                </div>
                <div style="display:flex;align-items:center;">
                    <button class="ui-pet-btn" data-idx="${index}" style="min-width:80px;padding:8px 10px;border-radius:6px;border:1px solid ${isSummoned ? '#6dff7a' : '#8a6a2a'};background:${isSummoned ? '#234228' : '#2d2212'};color:${isSummoned ? '#d6ffe0' : '#f0d48a'};cursor:pointer;font-size:12px;">
                        ${isSummoned ? 'Guardar' : 'Invocar'}
                    </button>
                </div>
            </div>
        `;

        row.querySelector('.ui-pet-btn')?.addEventListener('click', () => {
            if (isSummoned) { Pets.unsummon(); } else { Pets.summon(index); }
            _refreshPetWindowUI();
        });

        listEl.appendChild(row);
    });
}

/**
 * Abre/fecha a janela de pets.
 */
export function togglePetWindow() {
    if (_dialogOpen) return;
    if (!_petWindowEl) return;

    _petWindowOpen = !_petWindowOpen;
    _petWindowEl.style.display = _petWindowOpen ? 'block' : 'none';

    if (_petWindowOpen) {
        _refreshPetWindowUI();
        Events.emit('uiWindowOpened', { id: 'pets', name: 'pets' });
    } else {
        Events.emit('uiWindowClosed', { id: 'pets', name: 'pets' });
    }
}
/**
 * Renderiza o conteúdo do Quest Log com as quests ativas.
 */
function _renderQuestLog() {
    const body = document.getElementById('quest-log-body');
    if (!body) return;

    const active = Quests.getActiveQuests();

    if (active.length === 0) {
        body.innerHTML = `<p style="color:#888;text-align:center;margin-top:16px;">Nenhuma quest ativa.</p>`;
        return;
    }

    body.innerHTML = active.map(({ definition: q, active: a }) => {
        const completable = Quests.isCompletable(q.id);

        const objectivesHtml = (q.objectives ?? []).map(obj => {
            const current = a?.progress?.[obj.id] ?? 0;
            const pct = obj.required > 0 ? Math.min((current / obj.required) * 100, 100) : 0;
            const barColor = pct >= 100 ? '#4caf50' : '#a08040';

            return `
                <div style="margin:6px 0;">
                  <div style="display:flex;justify-content:space-between;
                              font-size:12px;color:#bbb;margin-bottom:2px;">
                    <span>${obj.label}</span>
                    <span>${current}/${obj.required}</span>
                  </div>
                  <div style="background:#333;border-radius:3px;height:6px;overflow:hidden;">
                    <div style="width:${pct}%;height:100%;
                                background:${barColor};transition:width 0.3s;"></div>
                  </div>
                </div>
            `;
        }).join('');

        const turnInHint = completable
            ? `<div style="color:#4caf50;font-size:12px;margin-top:6px;">✔ Fale com o NPC para completar!</div>`
            : '';

        return `
            <div style="margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid #333;">
                <div style="font-weight:bold;margin-bottom:4px;color:${completable ? '#4caf50' : '#e8d8a0'};">
                    ${q.name}
                </div>
                <div style="font-size:12px;color:#aaa;margin-bottom:8px;line-height:1.4;">${q.description}</div>
                ${objectivesHtml}
                ${turnInHint}
            </div>
        `;
    }).join('');
}

/**
 * Retorna a cor e símbolo do indicador NPC com base no estado das quests.
 * @param {string} npcId
 * @returns {{ symbol: string, color: string }|null}
 */
function _getNpcIndicatorStyle(npcId) {
    if (Quests.getTurnInQuestForNpc(npcId)) {
        return { symbol: '?', color: '#f0c040' };
    }

    const active = Quests.getActiveQuests();
    const hasActiveQuest = active.some(({ definition: q }) => q.completer === npcId);
    if (hasActiveQuest) {
        return { symbol: '?', color: '#888888' };
    }

    if (Quests.getOfferableQuestForNpc(npcId)) {
        return { symbol: '!', color: '#f0c040' };
    }

    return null;
}

/**
 * Abre ou fecha o Quest Log.
 * @returns {void}
 */
export function toggleQuestLog() {
    const panel = document.getElementById('quest-log');
    if (!panel) return;

    _questLogOpen = !_questLogOpen;
    panel.style.display = _questLogOpen ? 'block' : 'none';

    if (_questLogOpen) {
        _renderQuestLog();
        Events.emit('uiWindowOpened', { id: 'questLog', name: 'questLog' });
    } else {
        Events.emit('uiWindowClosed', { id: 'questLog', name: 'questLog' });
    }
}

/**
 * Retorna true se o Quest Log estiver aberto.
 * @returns {boolean}
 */
export function isQuestLogOpen() {
    return _questLogOpen;
}

/**
 * Atualiza ou cria o indicador visual (! / ?) sobre um NPC.
 * @param {string} npcId
 * @param {THREE.Object3D} mesh
 * @param {THREE.Camera} camera
 * @param {THREE.WebGLRenderer} renderer
 * @returns {void}
 */
export function updateNpcQuestIndicator(npcId, mesh, camera, renderer) {
    let el = _npcIndicators.get(npcId);
    if (!el) {
        el = document.createElement('div');
        el.style.cssText = `
            position: fixed;
            pointer-events: none;
            font-size: 24px !important;
            font-weight: bold;
            text-shadow: 0 1px 4px #000, 0 0 8px #000;
            z-index: 500;
            transform: translate(-50%, -100%);
            transition: opacity 0.2s;
            user-select: none;
        `;
        document.body.appendChild(el);
        _npcIndicators.set(npcId, el);
    }

    const style = _getNpcIndicatorStyle(npcId);

    if (!style || !mesh) {
        el.style.display = 'none';
        return;
    }

    const pos3D = new THREE.Vector3();
    mesh.getWorldPosition(pos3D);
    pos3D.y += 0.9;
    pos3D.project(camera);

    const canvas = renderer.domElement;
    const screenX = (pos3D.x * 0.5 + 0.5) * canvas.clientWidth;
    const screenY = (pos3D.y * -0.5 + 0.5) * canvas.clientHeight;

    if (pos3D.z > 1) {
        el.style.display = 'none';
        return;
    }

    const playerPos3D = Player.getPosition();
    playerPos3D.y += 1.0;
    playerPos3D.project(camera);
    const playerScreenX = (playerPos3D.x * 0.5 + 0.5) * canvas.clientWidth;
    const playerScreenY = (playerPos3D.y * -0.5 + 0.5) * canvas.clientHeight;
    const dx = screenX - playerScreenX;
    const dy = screenY - playerScreenY;
    const screenDist = Math.sqrt(dx * dx + dy * dy);
    if (pos3D.z > playerPos3D.z && screenDist < 80) {
        el.style.display = 'none';
        return;
    }

    el.style.display = 'block';
    el.style.left = `${screenX}px`;
    el.style.top = `${screenY}px`;
    el.style.color = style.color;
    el.textContent = style.symbol;
}

/**
 * Exibe uma notificação de quest no canto superior direito por 3 segundos.
 * @param {string} message
 * @param {'quest-accepted'|'quest-progress'|'quest-completable'|'quest-completed'} type
 * @returns {void}
 */
export function showQuestNotification(message, type) {
    const container = document.getElementById('quest-notifications');
    if (!container) return;

    const colorMap = {
        'quest-accepted':    '#f0c040',
        'quest-progress':    '#4a9eda',
        'quest-completable': '#4caf50',
        'quest-completed':   '#4caf50',
    };
    const color = colorMap[type] ?? '#e8d8a0';

    const el = document.createElement('div');
    el.style.cssText = `
        background: rgba(10,10,10,0.88);
        border-left: 3px solid ${color};
        color: ${color};
        padding: 8px 14px;
        border-radius: 4px;
        font-family: sans-serif;
        font-size: 13px;
        max-width: 280px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.6);
        animation: questNotifIn 0.25s ease;
        pointer-events: none;
    `;
    el.textContent = message;
    container.appendChild(el);

    if (!document.getElementById('quest-notif-style')) {
        const style = document.createElement('style');
        style.id = 'quest-notif-style';
        style.textContent = `
            @keyframes questNotifIn {
                from { opacity: 0; transform: translateX(24px); }
                to   { opacity: 1; transform: translateX(0); }
            }
        `;
        document.head.appendChild(style);
    }

    setTimeout(() => {
        el.style.transition = 'opacity 0.3s';
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 320);
    }, 4000);
}

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

    if (_dirty.xp) {
        const pct = _xp.needed > 0 ? (_xp.current / _xp.needed) * 100 : 0;
        if (_elXPBar) _elXPBar.style.width = `${pct}%`;
        if (_elXP)    _elXP.textContent    = `${_xp.current}/${_xp.needed}`;
        _dirty.xp = false;
    }

    if (_questLogOpen) _renderQuestLog();
}

/**
 * Exibe notificação toast temporária (2.8s) e toca SFX de click.
 * @param {string} msg
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
 * Exibe uma janela de UI pelo id.
 * @param {string} id
 */
export function showWindow(id) {
    Events.emit('uiWindowOpened', { id });
}

/**
 * Fecha uma janela de UI pelo id.
 * @param {string} id
 */
export function hideWindow(id) {
    Events.emit('uiWindowClosed', { id });
}

/**
 * Retorna true se uma janela de diálogo de NPC estiver aberta.
 * @returns {boolean}
 */
export function isDialogOpen() {
    return _dialogOpen;
}

/**
 * Re-renderiza grid, equipment slots e ouro do painel de inventário.
 */
function _refreshInventoryUI() {
    const slots = Inventory.getSlots();
    const equip = Inventory.getEquipment();
    const gold  = Inventory.getGold();
    const grid  = document.getElementById('ui-inv-grid');
    const goldInv = document.getElementById('ui-gold-inv');
    const goldHud = document.getElementById('ui-gold-hud');

    if (goldInv) goldInv.textContent = gold;
    if (goldHud) goldHud.textContent = '🪙 ' + gold;

    if (grid) grid.innerHTML = '';

    for (let i = 0; i < 30; i++) {
        const slot = slots[i];
        const cell = document.createElement('div');
        cell.style.cssText = `
            width:64px;height:64px;border:1px solid #3a2a10;border-radius:3px;
            display:flex;align-items:center;justify-content:center;
            background:#1a1408;cursor:${slot ? 'pointer' : 'default'};
            font-size:10px;text-align:center;color:#c8a84a;position:relative;
            box-sizing:border-box;
        `;

        if (slot) {
            const def = Inventory.getItemDef(slot.itemId);
            const icon = def?.icon ?? (
                def?.type === 'weapon'     ? '⚔️' :
                def?.type === 'armor'      ? '🛡️' :
                def?.type === 'accessory'  ? '💍' :
                def?.type === 'card'       ? '🃏' :
                def?.type === 'consumable' ? '🧪' :
                def?.type === 'material'   ? '⛏️' :
                '📦');

            const refineLevel = slot.refineLevel ?? 0;
            const refinePrefix = refineLevel > 0 ? `+${refineLevel} ` : '';
            const refineColor = getRefineColor(refineLevel) || '#c8a84a';

            cell.innerHTML = `
                <span style="font-size:16px;">${icon}</span>
                <span style="position:absolute;left:2px;top:2px;font-size:9px;color:${refineColor};">${refineLevel > 0 ? `+${refineLevel}` : ''}</span>
            `;

            if (def?.type === 'card') {
                cell.style.background = 'linear-gradient(180deg, #3a1f3f, #1c1020)';
                cell.style.borderColor = '#c07cff';
                cell.style.boxShadow = 'inset 0 0 0 1px rgba(255,255,255,0.06)';
            }

            if ((def?.stack ?? 1) > 1 && slot.qty > 1) {
                const qtyEl = document.createElement('span');
                qtyEl.style.cssText = 'position:absolute;bottom:1px;right:3px;font-size:9px;color:#ffd700;';
                qtyEl.textContent = slot.qty;
                cell.appendChild(qtyEl);
            }

            const blocked = !!(def?.slot && !Inventory.canEquip(slot.itemId));
            if (blocked) cell.style.opacity = '0.4';
            const crList = Array.isArray(def?.classRestriction)
                ? def.classRestriction
                : (def?.classRestriction ? [def.classRestriction] : []);
            cell.title = `${refinePrefix}${def?.name ?? slot.itemId}${slot.qty > 1 ? ` x${slot.qty}` : ''}`
                + (blocked ? `\n⚠ Sua classe não pode equipar (requer: ${crList.join(', ')})` : '');

            cell.addEventListener('contextmenu', e => {
                e.preventDefault();
                const d = Inventory.getItemDef(slot.itemId);
                if (!d) return;

                if (d.type === 'consumable') {
                    Inventory.useItem(i);
                    Audio.playSFX('assets/audio/sfx/sfx_ui_click.ogg');
                } else if (
                    d.type === 'weapon' ||
                    d.type === 'armor' ||
                    d.type === 'accessory' ||
                    d.type === 'shield' ||
                    d.type === 'headgear' ||
                    d.type === 'garment' ||
                    d.type === 'footgear'
                ) {
                    Inventory.equipItem(i);
                    _refreshInventoryUI();
                }
            });
        }

        grid?.appendChild(cell);
    }

    document.querySelectorAll('#ui-inv-equip-grid .ui-equip-slot').forEach(el => {
        const slotName = el.dataset.slot;
        const meta = EQUIPMENT_SLOT_META.find(s => s.slot === slotName);

        const equipObj = equip[slotName];
        const itemId = equipObj?.itemId ?? (typeof equipObj === 'string' ? equipObj : null);
        const refineLevel = equipObj?.refineLevel ?? 0;

        if (itemId) {
            const def = Inventory.getItemDef(itemId);
            const icon = meta?.icon ?? '📦';
            const refinePrefix = refineLevel > 0 ? `+${refineLevel} ` : '';
            const refineColor = getRefineColor(refineLevel) || '#e8d8a0';

            el.innerHTML = `<span style="font-size:18px;">${icon}</span><br><span style="font-size:9px;color:${refineColor};">${refinePrefix}${def?.name ?? itemId}</span>`;
            el.style.borderColor = '#c8a84a';
        } else {
            el.textContent = meta?.slot === 'shield' ? _offhandLabel() : (meta?.label ?? slotName);
            el.style.borderColor = '#5a4a2a';
        }
    });
}

function _refreshEquipmentWindowUI() {
    if (!_equipmentWindowEl) return;

    const equip = Inventory.getEquipment();
    const activeSets = Equipment.getActiveSetBonuses?.() ?? { sets: [] };
    const socketsWrap = document.getElementById('ui-item-sockets');

    if (socketsWrap) {
        socketsWrap.innerHTML = '';

        EQUIPMENT_SLOT_META.forEach(meta => {
            const equipObj = equip[meta.slot];
            const itemId = equipObj?.itemId ?? (typeof equipObj === 'string' ? equipObj : null);

            const row = document.createElement('div');
            row.style.cssText = `
                padding:10px;border:1px solid #5a4a2a;border-radius:6px;background:#21180d;
            `;

            const header = document.createElement('div');
            header.style.cssText = `
                display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;
                color:#ffd27a;font-size:12px;
            `;
            header.innerHTML = `<span>${meta.slot === 'shield' ? _offhandLabel() : meta.title}</span><span>${itemId ? (Inventory.getItemDef(itemId)?.name ?? itemId) : 'Vazio'}</span>`;
            row.appendChild(header);

            const socketLine = document.createElement('div');
            socketLine.style.cssText = `
                display:flex;gap:6px;flex-wrap:wrap;
            `;

            const sockets = Array.isArray(equipObj?.sockets) ? equipObj.sockets : [];
            const socketCount = Math.max(0, sockets.length);

            if (!itemId || socketCount === 0) {
                const emptyMsg = document.createElement('div');
                emptyMsg.style.cssText = 'font-size:11px;color:#8f7a54;';
                emptyMsg.textContent = itemId ? 'Sem sockets neste item.' : 'Equipe um item para ver sockets.';
                row.appendChild(emptyMsg);
            } else {
                sockets.forEach((socketCardId, socketIndex) => {
                    const socketEl = document.createElement('div');
                    socketEl.dataset.slot = meta.slot;
                    socketEl.dataset.socketIndex = String(socketIndex);
                    socketEl.style.cssText = `
                        width:34px;height:34px;border-radius:50%;
                        border:1px solid ${socketCardId ? '#c8a84a' : '#666'};
                        display:flex;align-items:center;justify-content:center;
                        cursor:pointer;box-sizing:border-box;
                        background:${socketCardId ? '#392a12' : '#4b4b4b'};
                        color:${socketCardId ? '#ffd27a' : '#bbb'};
                        font-size:16px;user-select:none;
                    `;

                    if (socketCardId) {
                        const cardDef = Inventory.getItemDef(socketCardId);
                        socketEl.textContent = '🃏';
                        socketEl.title = cardDef?.name ?? socketCardId;
                    } else {
                        socketEl.textContent = '○';
                        socketEl.title = 'Socket vazio. Clique para inserir carta.';
                        socketEl.addEventListener('click', () => _openSocketPopup(meta.slot, socketIndex));
                    }

                    socketLine.appendChild(socketEl);
                });

                row.appendChild(socketLine);
            }

            socketsWrap.appendChild(row);
        });
    }
    _equipmentWindowEl.querySelectorAll('#ui-eq-grid .ui-equipment-slot').forEach(el => {
        const slotName = el.dataset.slot;
        const meta = EQUIPMENT_SLOT_META.find(s => s.slot === slotName);

        const equipObj = equip[slotName];
        const itemId = equipObj?.itemId ?? (typeof equipObj === 'string' ? equipObj : null);
        const refineLevel = equipObj?.refineLevel ?? 0;

        if (itemId) {
            const def = Inventory.getItemDef(itemId);
            const icon = meta?.icon ?? '📦';
            const refinePrefix = refineLevel > 0 ? `+${refineLevel} ` : '';
            const refineColor = getRefineColor(refineLevel) || '#e8d8a0';

            el.innerHTML = `<span style="font-size:18px;">${icon}</span><br><span style="font-size:9px;color:${refineColor};">${refinePrefix}${def?.name ?? itemId}</span>`;
            el.style.borderColor = '#c8a84a';
        } else {
            el.textContent = meta?.slot === 'shield' ? _offhandLabel() : (meta?.label ?? slotName);
            el.style.borderColor = '#5a4a2a';
        }
    });

    const setsWrap = document.getElementById('ui-active-sets');
    if (!setsWrap) return;

    if (!activeSets.sets.length) {
        setsWrap.innerHTML = `
            <div style="padding:10px;border:1px solid #4e3b1f;border-radius:6px;background:#21180d;color:#a89368;">
                Nenhum set ativo no momento.
            </div>
        `;
        return;
    }

    setsWrap.innerHTML = activeSets.sets.map(setInfo => {
        const setDef = Equipment.getSetDef(setInfo.setId);
        const tierColor = _getTierBadgeColor(setInfo.tier);
        const bonusText = _formatStatsLine(setInfo.activeBonus);

        const piecesHtml = setDef?.pieceSlots
            ?.map(slotName => {
                const slotMeta = EQUIPMENT_SLOT_META.find(s => s.slot === slotName);
                const equipped = setInfo.equippedSlots.includes(slotName);
                return `
                    <div style="
                        padding:6px 8px;
                        border:1px solid ${equipped ? '#c8a84a' : '#4e4e4e'};
                        border-radius:4px;
                        background:${equipped ? '#2d2210' : '#1b1b1b'};
                        color:${equipped ? '#f0e6d2' : '#9a9a9a'};
                        opacity:${equipped ? 1 : 0.4};
                        font-size:11px;
                    ">
                        ${slotMeta?.label ?? slotName}
                    </div>
                `;
            })
            .join('');

        return `
            <div style="padding:10px;border:1px solid #5a4a2a;border-radius:6px;background:#21180d;">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;">
                    <div style="font-size:14px;color:#ffd27a;font-weight:bold;">${setInfo.name}</div>
                    <div style="display:flex;align-items:center;gap:8px;">
                        <span style="font-size:10px;padding:2px 6px;border-radius:999px;background:${tierColor};color:#111;font-weight:bold;text-transform:uppercase;">
                            ${setInfo.tier}
                        </span>
                        <span style="font-size:11px;color:#c9b07a;">${setInfo.pieceCount}/4</span>
                    </div>
                </div>
                <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:8px;">
                    ${piecesHtml}
                </div>
                <div style="font-size:11px;color:#e7d7ad;">${bonusText}</div>
            </div>
        `;
    }).join('');
}

function _ensureRefineWindow() {
    if (_refineWindowEl) return;

    const style = document.createElement('style');
    style.id = 'lumie-refine-style';
    style.textContent = `
        #refine-window {
            display:none;
            position:fixed;
            top:50%;
            left:50%;
            transform:translate(-50%,-50%);
            width:920px;
            max-width:96vw;
            max-height:86vh;
            background:rgba(20,18,14,0.97);
            border:1px solid #5a4a2a;
            border-radius:8px;
            padding:16px;
            z-index:240;
            color:#e8d8a0;
            font-family:monospace;
            font-size:14px;
            box-shadow:0 8px 32px rgba(0,0,0,0.7);
            user-select:none;
            overflow:hidden;
        }
        #refine-window.refine-flash-success {
            box-shadow:0 0 0 2px rgba(76,175,80,0.85), 0 8px 32px rgba(0,0,0,0.7);
        }
        #refine-window.refine-flash-fail {
            box-shadow:0 0 0 2px rgba(244,67,54,0.85), 0 8px 32px rgba(0,0,0,0.7);
        }
        .refine-layout {
            display:grid;
            grid-template-columns: 1.15fr 0.85fr;
            gap:14px;
            min-height:480px;
        }
        .refine-list-wrap,
        .refine-detail {
            background:#17110a;
            border:1px solid #4b3920;
            border-radius:6px;
            padding:12px;
            min-height:0;
        }
        .refine-list-wrap {
            display:flex;
            flex-direction:column;
        }
        .refine-list {
            overflow:auto;
            display:flex;
            flex-direction:column;
            gap:8px;
            min-height:0;
            padding-right:4px;
        }
        .refine-item {
            border:1px solid #4b3920;
            border-radius:6px;
            background:#21180d;
            padding:10px;
            cursor:pointer;
            transition:background 0.12s, border-color 0.12s, transform 0.08s;
        }
        .refine-item:hover {
            background:#2a1e10;
            border-color:#8c6d34;
        }
        .refine-item.selected {
            border-color:#c8a84a;
            background:#2c210f;
        }
        .refine-item-row {
            display:flex;
            justify-content:space-between;
            align-items:center;
            gap:8px;
        }
        .refine-item-name {
            font-size:13px;
            font-weight:bold;
        }
        .refine-item-meta {
            font-size:11px;
            color:#a89368;
            margin-top:4px;
        }
        .refine-badge {
            font-size:10px;
            color:#111;
            background:#c8a84a;
            border-radius:999px;
            padding:2px 6px;
            font-weight:bold;
        }
        .refine-detail-empty {
            color:#9f8b62;
            font-size:12px;
            line-height:1.6;
        }
        .refine-title {
            font-size:15px;
            font-weight:bold;
            color:#ffd27a;
            margin-bottom:10px;
        }
        .refine-stat {
            font-size:12px;
            color:#d9c38b;
            margin-bottom:8px;
        }
        .refine-risk {
            margin-top:10px;
            color:#ff8a65;
            font-size:12px;
            font-weight:bold;
        }
        .refine-actions {
            display:flex;
            gap:8px;
            margin-top:14px;
        }
        .refine-btn {
            border:1px solid #7c6432;
            background:#2a2010;
            color:#f1dfb0;
            border-radius:6px;
            padding:8px 12px;
            cursor:pointer;
            font-family:inherit;
            font-size:12px;
        }
        .refine-btn:hover {
            background:#382914;
        }
        .refine-btn.primary {
            background:#6b4a16;
            border-color:#c8a84a;
            color:#fff4cc;
            font-weight:bold;
        }
        .refine-btn.primary:hover {
            background:#845a1a;
        }
        .refine-tabs {
            display:flex;
            gap:6px;
            margin-bottom:12px;
        }
        .refine-tab {
            border:1px solid #4b3920;
            background:#21180d;
            color:#c8a84a;
            border-radius:6px 6px 0 0;
            padding:8px 16px;
            cursor:pointer;
            font-family:inherit;
            font-size:12px;
            font-weight:bold;
        }
        .refine-tab:hover { background:#2a1e10; }
        .refine-tab.active {
            background:#6b4a16;
            border-color:#c8a84a;
            color:#fff4cc;
        }
        .forge-list {
            display:flex;
            flex-direction:column;
            gap:10px;
            max-height:520px;
            overflow:auto;
            padding-right:4px;
        }
        .forge-card {
            border:1px solid #4b3920;
            border-radius:6px;
            background:#17110a;
            padding:12px;
        }
        .forge-card-head {
            display:flex;
            align-items:center;
            gap:8px;
            margin-bottom:6px;
        }
        .forge-icon { font-size:18px; }
        .forge-name { font-size:14px; font-weight:bold; color:#ffd27a; flex:1; }
        .forge-tier {
            font-size:10px;
            font-weight:bold;
            border-radius:999px;
            padding:2px 8px;
            color:#111;
        }
        .forge-tier-normal { background:#c0c0c0; }
        .forge-tier-legendary { background:#d4af37; }
        .forge-tier-divine { background:#9b59b6; color:#fff; }
        .forge-stats {
            font-size:11px;
            color:#9fd39f;
            margin-bottom:8px;
        }
        .forge-mats {
            display:flex;
            flex-wrap:wrap;
            gap:6px;
            margin-bottom:10px;
        }
        .forge-mat {
            font-size:11px;
            border:1px solid #4b3920;
            border-radius:6px;
            padding:3px 7px;
            background:#21180d;
        }
        .forge-mat.ok { color:#a5d6a7; border-color:#3f6b3f; }
        .forge-mat.bad { color:#ef9a9a; border-color:#6b3f3f; }
        .forge-actions { display:flex; }
        .forge-btn {
            border:1px solid #7c6432;
            background:#2a2010;
            color:#f1dfb0;
            border-radius:6px;
            padding:8px 16px;
            cursor:pointer;
            font-family:inherit;
            font-size:12px;
            font-weight:bold;
        }
        .forge-btn.primary {
            background:#6b4a16;
            border-color:#c8a84a;
            color:#fff4cc;
        }
        .forge-btn.primary:hover { background:#845a1a; }
        .forge-btn:disabled { opacity:0.45; cursor:not-allowed; }
    `;
    document.head.appendChild(style);

    _refineWindowEl = document.createElement('div');
    _refineWindowEl.id = 'refine-window';
    _refineWindowEl.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <span style="font-size:15px;font-weight:bold;">🔨 Ferreiro Bram</span>
            <span id="ui-refine-close" style="cursor:pointer;font-size:18px;line-height:1;">✕</span>
        </div>

        <div class="refine-tabs">
            <button id="refine-tabbtn-refine" class="refine-tab active">🔧 Refino</button>
            <button id="refine-tabbtn-forge" class="refine-tab">⚒️ Forja</button>
        </div>

        <div id="refine-tab-refine">
            <div class="refine-layout">
                <div class="refine-list-wrap">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                        <div style="font-size:12px;color:#c8a84a;">ITENS REFINÁVEIS</div>
                        <div style="font-size:11px;color:#8f7a4f;">Selecione um item</div>
                    </div>
                    <div id="refine-list" class="refine-list"></div>
                </div>

                <div class="refine-detail">
                    <div id="refine-detail"></div>
                </div>
            </div>
        </div>

        <div id="refine-tab-forge" style="display:none;">
            <div style="font-size:12px;color:#c8a84a;margin-bottom:10px;">RECEITAS DE SET DA SUA CLASSE</div>
            <div id="forge-list" class="forge-list"></div>
        </div>
    `;
    document.body.appendChild(_refineWindowEl);

    document.getElementById('ui-refine-close').addEventListener('click', () => {
        _closeRefineWindow();
    });
    document.getElementById('refine-tabbtn-refine').addEventListener('click', () => _setRefineTab('refine'));
    document.getElementById('refine-tabbtn-forge').addEventListener('click', () => _setRefineTab('forge'));
}

/**
 * Alterna entre as abas REFINO (atual) e FORJA (craft de sets) do painel do ferreiro.
 * @param {'refine'|'forge'} tab
 */
function _setRefineTab(tab) {
    _refineActiveTab = tab;
    const refinePane = document.getElementById('refine-tab-refine');
    const forgePane = document.getElementById('refine-tab-forge');
    const refineBtn = document.getElementById('refine-tabbtn-refine');
    const forgeBtn = document.getElementById('refine-tabbtn-forge');
    if (refinePane) refinePane.style.display = tab === 'refine' ? 'block' : 'none';
    if (forgePane) forgePane.style.display = tab === 'forge' ? 'block' : 'none';
    refineBtn?.classList.toggle('active', tab === 'refine');
    forgeBtn?.classList.toggle('active', tab === 'forge');
    if (tab === 'refine') _renderRefineList();
    else _renderForgeList();
}

/** Rótulo PT-BR do tier de um set. @param {string} tier @returns {string} */
function _forgeTierLabel(tier) {
    return { normal: 'Normal', legendary: 'Lendário', divine: 'Divino' }[tier] ?? tier;
}

/** Mensagem de falha de forja por motivo. @param {string} reason @returns {string} */
function _forgeFailMsg(reason) {
    return {
        classe: 'Sua classe não pode forjar esta peça.',
        materiais: 'Materiais insuficientes.',
        ouro: 'Ouro insuficiente.',
        'inventario-cheio': 'Inventário cheio.',
    }[reason] ?? 'Não foi possível forjar.';
}

/** Renderiza a lista de receitas de set craftáveis pela classe atual do player. */
function _renderForgeList() {
    const listEl = document.getElementById('forge-list');
    if (!listEl) return;

    const cls = Player.getState?.()?.class;
    const recipes = Recipes.getRecipesForClass(cls);

    if (!recipes.length) {
        listEl.innerHTML = '<div class="shop-empty">Nenhuma receita disponível para sua classe.</div>';
        return;
    }

    listEl.innerHTML = '';
    for (const recipe of recipes) {
        const def = Inventory.getItemDef(recipe.result);
        const state = Recipes.getCraftState(recipe);

        const matsHtml = state.materials.map(m =>
            `<span class="forge-mat ${m.ok ? 'ok' : 'bad'}">${m.icon} ${m.name} ${m.have}/${m.need}</span>`
        ).join('');
        const goldHtml = `<span class="forge-mat ${state.gold.ok ? 'ok' : 'bad'}">🪙 ${state.gold.have}/${state.gold.need}</span>`;

        const card = document.createElement('div');
        card.className = 'forge-card';
        card.innerHTML = `
            <div class="forge-card-head">
                <span class="forge-icon">${def?.icon ?? '📦'}</span>
                <span class="forge-name">${def?.name ?? recipe.result}</span>
                <span class="forge-tier forge-tier-${recipe.tier}">${_forgeTierLabel(recipe.tier)}</span>
            </div>
            <div class="forge-stats">${_formatStatsLine(def?.stats)}</div>
            <div class="forge-mats">${matsHtml}${goldHtml}</div>
            <div class="forge-actions">
                <button class="forge-btn ${state.canCraft ? 'primary' : ''}" ${state.canCraft ? '' : 'disabled'}>Forjar</button>
            </div>
        `;
        card.querySelector('.forge-btn')?.addEventListener('click', () => {
            const result = Recipes.craft(recipe.id);
            if (result.ok) {
                showNotification(`Forjado: ${def?.name ?? result.itemId}!`, 'success');
                _flashRefineWindow('success');
            } else {
                showNotification(_forgeFailMsg(result.reason), 'warning');
                _flashRefineWindow('fail');
            }
            _renderForgeList();
        });
        listEl.appendChild(card);
    }
}

function _flashRefineWindow(type) {
    if (!_refineWindowEl) return;
    _refineWindowEl.classList.remove('refine-flash-success', 'refine-flash-fail');
    void _refineWindowEl.offsetWidth;
    _refineWindowEl.classList.add(type === 'success' ? 'refine-flash-success' : 'refine-flash-fail');
    setTimeout(() => {
        _refineWindowEl?.classList.remove('refine-flash-success', 'refine-flash-fail');
    }, 260);
}

function _getRefineEntries() {
    const entries = [];
    const slots = Inventory.getSlots();
    const equipment = Inventory.getEquipment();

    for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        const check = Refine.canRefine(slot);
        if (!check.ok) continue;

        const def = Inventory.getItemDef(slot.itemId);
        if (!def) continue;

        entries.push({
            key: `inv-${i}`,
            sourceLabel: `Inventário #${i + 1}`,
            itemId: slot.itemId,
            itemName: def.name ?? slot.itemId,
            refineLevel: slot.refineLevel ?? 0,
            target: { type: 'inventory', index: i },
            detailType: 'inventory'
        });
    }

    for (const meta of EQUIPMENT_SLOT_META) {
        const equipObj = equipment[meta.slot];
        const check = Refine.canRefine(equipObj);
        if (!check.ok) continue;

        const def = Inventory.getItemDef(equipObj.itemId);
        if (!def) continue;

        entries.push({
            key: `eq-${meta.slot}`,
            sourceLabel: `Equipado: ${meta.title}`,
            itemId: equipObj.itemId,
            itemName: def.name ?? equipObj.itemId,
            refineLevel: equipObj.refineLevel ?? 0,
            target: { type: 'equipment', slot: meta.slot },
            detailType: 'equipment'
        });
    }

    return entries;
}

function _formatRefineItemName(name, level) {
    const lv = Number(level ?? 0);
    return lv > 0 ? `+${lv} ${name}` : name;
}

function _renderRefineDetail(meta) {
    const detailEl = document.getElementById('refine-detail');
    if (!detailEl) return;

    if (!meta) {
        detailEl.innerHTML = `
            <div class="refine-title">Seleção</div>
            <div class="refine-detail-empty">
                Escolha um equipamento da lista para ver custo, chance e iniciar o refino.
            </div>
        `;
        return;
    }

    const cost = Refine.getRefineCost(meta.refineLevel);
    const baseRate = Refine.getSuccessRate(meta.refineLevel);
    const nextLevel = (meta.refineLevel ?? 0) + 1;
    const color = getRefineColor(meta.refineLevel) || '#f1dfb0';

    const slots = Inventory.getSlots();
    const hasEnriched = slots.some(slot => slot?.itemId === 'minerio_enriquecido' && (slot.qty ?? 0) > 0);
    const hasProtector = slots.some(slot => slot?.itemId === 'minerio_protetor' && (slot.qty ?? 0) > 0);
    const hasBlessed = slots.some(slot => slot?.itemId === 'minerio_abencoado' && (slot.qty ?? 0) > 0);

    let riskText = '';
    if (meta.refineLevel >= 13) {
        riskText = '⚠️ 70% de chance de quebra';
    } else if (meta.refineLevel >= 10) {
        riskText = '⚠️ 50% de chance de quebra';
    } else if (meta.refineLevel >= 7) {
        riskText = '⚠️ 25% de chance de quebra';
    }

    const helperHtml = `
        ${hasEnriched ? `
            <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:#d9c38b;margin-bottom:6px;cursor:pointer;">
                <input type="checkbox" id="refine-use-enriched">
                <span>Minério Enriquecido (+15% chance)</span>
            </label>
        ` : ''}
        ${hasProtector ? `
            <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:#d9c38b;margin-bottom:6px;cursor:pointer;">
                <input type="checkbox" id="refine-use-protector">
                <span>Minério Protetor (impede quebra)</span>
            </label>
        ` : ''}
        ${hasBlessed ? `
            <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:#d9c38b;margin-bottom:6px;cursor:pointer;">
                <input type="checkbox" id="refine-use-blessed">
                <span>Minério Abençoado (sem penalidade)</span>
            </label>
        ` : ''}
    `;

    detailEl.innerHTML = `
        <div class="refine-title" style="color:${color};">
            ${_formatRefineItemName(meta.itemName, meta.refineLevel)}
        </div>
        <div class="refine-stat"><strong>Origem:</strong> ${meta.sourceLabel}</div>
        <div class="refine-stat"><strong>Próximo nível:</strong> +${nextLevel}</div>
        <div class="refine-stat"><strong>Custo:</strong> ${cost.ore} Minério + ${cost.gold} gold</div>
        <div class="refine-stat" id="refine-chance-line"><strong>Chance:</strong> ${Math.round(baseRate * 100)}%</div>
        ${riskText ? `<div class="refine-risk">${riskText}</div>` : ''}
        <div style="margin-top:12px;margin-bottom:4px;">
            ${helperHtml}
        </div>
        <div class="refine-actions">
            <button id="refine-confirm-btn" class="refine-btn primary">Refinar</button>
            <button id="refine-cancel-btn" class="refine-btn">Fechar</button>
        </div>
    `;

    const enrichedEl = document.getElementById('refine-use-enriched');
    const protectorEl = document.getElementById('refine-use-protector');
    const blessedEl = document.getElementById('refine-use-blessed');
    const chanceLineEl = document.getElementById('refine-chance-line');

    const updateChanceLine = () => {
        const enrichedBonus = enrichedEl?.checked ? 0.15 : 0;
        const boostedRate = Math.min(1, baseRate + enrichedBonus);

        if (!chanceLineEl) return;

        if (enrichedEl?.checked) {
            chanceLineEl.innerHTML = `<strong>Chance:</strong> ${Math.round(baseRate * 100)}% → ${Math.round(boostedRate * 100)}%`;
        } else {
            chanceLineEl.innerHTML = `<strong>Chance:</strong> ${Math.round(baseRate * 100)}%`;
        }
    };

    enrichedEl?.addEventListener('change', updateChanceLine);
    protectorEl?.addEventListener('change', () => {});
    blessedEl?.addEventListener('change', () => {});
    updateChanceLine();

    document.getElementById('refine-confirm-btn')?.addEventListener('click', () => {
        if (!_selectedRefineTarget) return;

        const useEnriched = !!document.getElementById('refine-use-enriched')?.checked;
        const useProtector = !!document.getElementById('refine-use-protector')?.checked;
        const useBlessed = !!document.getElementById('refine-use-blessed')?.checked;

        const result = Refine.attemptRefine(_selectedRefineTarget, {
            useEnriched,
            useProtector,
            useBlessed
        });

        _flashRefineWindow(result.success ? 'success' : 'fail');
        _openRefineWindow();
    });

    document.getElementById('refine-cancel-btn')?.addEventListener('click', () => {
        _closeRefineWindow();
    });
}

function _renderRefineList() {
    const listEl = document.getElementById('refine-list');
    if (!listEl) return;

    const entries = _getRefineEntries();

    if (entries.length === 0) {
        _selectedRefineTarget = null;
        _selectedRefineMeta = null;
        listEl.innerHTML = `
            <div style="padding:10px;border:1px solid #4e3b1f;border-radius:6px;background:#21180d;color:#a89368;font-size:12px;">
                Nenhum item refinável disponível no momento.
            </div>
        `;
        _renderRefineDetail(null);
        return;
    }

    const selectedKey = _selectedRefineMeta?.key;
    const stillExists = entries.find(e => e.key === selectedKey);
    if (!stillExists) {
        _selectedRefineMeta = entries[0];
        _selectedRefineTarget = entries[0].target;
    } else {
        _selectedRefineMeta = stillExists;
        _selectedRefineTarget = stillExists.target;
    }

    listEl.innerHTML = '';

    entries.forEach(entry => {
        const color = getRefineColor(entry.refineLevel) || '#f1dfb0';
        const card = document.createElement('div');
        card.className = 'refine-item' + (_selectedRefineMeta?.key === entry.key ? ' selected' : '');
        card.innerHTML = `
            <div class="refine-item-row">
                <div class="refine-item-name" style="color:${color};">
                    ${_formatRefineItemName(entry.itemName, entry.refineLevel)}
                </div>
                <span class="refine-badge">${entry.detailType === 'equipment' ? 'Equipado' : 'Bolsa'}</span>
            </div>
            <div class="refine-item-meta">${entry.sourceLabel}</div>
        `;
        card.addEventListener('click', () => {
            _selectedRefineMeta = entry;
            _selectedRefineTarget = entry.target;
            _renderRefineList();
            _renderRefineDetail(entry);
        });
        listEl.appendChild(card);
    });

    _renderRefineDetail(_selectedRefineMeta);
}

function _openRefineWindow() {
    _ensureRefineWindow();
    _refineWindowEl.style.display = 'block';
    _setRefineTab(_refineActiveTab);
    Events.emit('uiWindowOpened', { id: 'refine' });
}

function _closeRefineWindow() {
    if (!_refineWindowEl) return;
    _refineWindowEl.style.display = 'none';
    _selectedRefineTarget = null;
    _selectedRefineMeta = null;
    Events.emit('uiWindowClosed', { id: 'refine' });
}

// ─── Loja (comprar / vender) ──────────────────────────────────────────────────

/** Constroi a janela de loja (uma vez). */
function _ensureShopWindow() {
    if (_shopWindowEl) return;

    const style = document.createElement('style');
    style.id = 'lumie-shop-style';
    style.textContent = `
        #shop-window {
            display:none; position:fixed; top:50%; left:50%;
            transform:translate(-50%,-50%);
            width:720px; max-width:95vw; max-height:86vh;
            background:rgba(20,18,14,0.97); border:1px solid #5a4a2a;
            border-radius:8px; padding:16px; z-index:240; color:#e8d8a0;
            font-family:monospace; font-size:14px;
            box-shadow:0 8px 32px rgba(0,0,0,0.7); user-select:none; overflow:hidden;
        }
        .shop-cols { display:grid; grid-template-columns:1fr 1fr; gap:14px; min-height:420px; }
        .shop-col { background:#17110a; border:1px solid #4b3920; border-radius:6px; padding:12px; display:flex; flex-direction:column; min-height:0; }
        .shop-col-title { font-size:13px; font-weight:bold; color:#ffd27a; margin-bottom:10px; }
        .shop-list { overflow:auto; display:flex; flex-direction:column; gap:8px; min-height:0; padding-right:4px; }
        .shop-item { display:flex; justify-content:space-between; align-items:center; gap:8px;
            border:1px solid #4b3920; border-radius:6px; background:#21180d; padding:8px 10px; cursor:pointer;
            transition:background 0.12s, border-color 0.12s; }
        .shop-item:hover { background:#2a1e10; border-color:#8c6d34; }
        .shop-item-left { display:flex; align-items:center; gap:8px; min-width:0; }
        .shop-item-name { font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .shop-price { font-size:12px; font-weight:bold; color:#ffd700; white-space:nowrap; }
        .shop-empty { color:#9f8b62; font-size:12px; padding:8px; }
    `;
    document.head.appendChild(style);

    _shopWindowEl = document.createElement('div');
    _shopWindowEl.id = 'shop-window';
    _shopWindowEl.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:12px;">
            <span style="font-size:15px;font-weight:bold;">🛒 Loja</span>
            <span style="font-size:13px;">🪙 <span id="ui-shop-gold">0</span></span>
            <span id="ui-shop-close" style="cursor:pointer;font-size:18px;line-height:1;">✕</span>
        </div>
        <div class="shop-cols">
            <div class="shop-col">
                <div class="shop-col-title">COMPRAR</div>
                <div id="shop-buy-list" class="shop-list"></div>
            </div>
            <div class="shop-col">
                <div class="shop-col-title">VENDER</div>
                <div id="shop-sell-list" class="shop-list"></div>
            </div>
        </div>
    `;
    document.body.appendChild(_shopWindowEl);
    document.getElementById('ui-shop-close').addEventListener('click', () => _closeShopWindow());
}

/** Abre a loja com o estoque do vendedor. @param {string[]} stock */
function _openShopWindow(stock) {
    _ensureShopWindow();
    _shopStock = Array.isArray(stock) ? stock : [];
    _shopWindowEl.style.display = 'block';
    _renderShop();
    Events.emit('uiWindowOpened', { id: 'shop' });
}

function _closeShopWindow() {
    if (!_shopWindowEl) return;
    _shopWindowEl.style.display = 'none';
    Events.emit('uiWindowClosed', { id: 'shop' });
}

/** Redesenha listas de comprar/vender e o ouro atual. */
function _renderShop() {
    if (!_shopWindowEl) return;
    const goldEl = document.getElementById('ui-shop-gold');
    if (goldEl) goldEl.textContent = Inventory.getGold();

    // COMPRAR: estoque do vendedor (infinito), mostra buyPrice.
    const buyEl = document.getElementById('shop-buy-list');
    if (buyEl) {
        buyEl.innerHTML = '';
        if (_shopStock.length === 0) buyEl.innerHTML = '<div class="shop-empty">Sem mercadorias.</div>';
        for (const itemId of _shopStock) {
            const def = Inventory.getItemDef(itemId);
            if (!def) continue;
            // Filtro proprio da loja: linha da classe ATUAL (lida direto do player) +
            // itens sem restricao. Nao usa canEquip (cujo fallback permissivo mostraria tudo).
            if (!_shopShowsForClass(itemId)) continue;
            const price = Inventory.getBuyPrice(itemId);
            const row = document.createElement('div');
            row.className = 'shop-item';
            row.innerHTML = `<span class="shop-item-left"><span>${def.icon ?? '📦'}</span><span class="shop-item-name">${def.name ?? itemId}</span></span><span class="shop-price">🪙 ${price}</span>`;
            row.addEventListener('click', () => _shopBuy(itemId));
            buyEl.appendChild(row);
        }
    }

    // VENDER: itens do inventario com valor de venda (ouro nao vendavel).
    const sellEl = document.getElementById('shop-sell-list');
    if (sellEl) {
        sellEl.innerHTML = '';
        const slots = Inventory.getSlots();
        let any = false;
        for (let i = 0; i < slots.length; i++) {
            const slot = slots[i];
            if (!slot) continue;
            const def = Inventory.getItemDef(slot.itemId);
            if (!def || def.type === 'currency') continue;
            const value = Inventory.getSellValue(slot.itemId);
            if (value <= 0) continue;
            any = true;
            const qtyTxt = (slot.qty ?? 1) > 1 ? ` x${slot.qty}` : '';
            const row = document.createElement('div');
            row.className = 'shop-item';
            row.innerHTML = `<span class="shop-item-left"><span>${def.icon ?? '📦'}</span><span class="shop-item-name">${def.name ?? slot.itemId}${qtyTxt}</span></span><span class="shop-price">🪙 ${value}</span>`;
            row.addEventListener('click', () => _shopSell(i));
            sellEl.appendChild(row);
        }
        if (!any) sellEl.innerHTML = '<div class="shop-empty">Nada para vender.</div>';
    }
}

/** Compra 1 unidade (se houver ouro e espaco). @param {string} itemId */
function _shopBuy(itemId) {
    const price = Inventory.getBuyPrice(itemId);
    if (Inventory.getGold() < price) {
        showNotification('Ouro insuficiente.', 'warning');
        return;
    }
    const added = Inventory.addItem(itemId, 1);
    if (added === false) return; // addItem ja emitiu 'inventoryFull'
    Inventory.setGold(Inventory.getGold() - price);
    Audio.playSFX('assets/audio/sfx/sfx_ui_click.ogg');
    _renderShop();
}

/** Vende 1 unidade do slot do inventario. @param {number} slotIndex */
function _shopSell(slotIndex) {
    const slot = Inventory.getSlots()[slotIndex];
    if (!slot) return;
    const def = Inventory.getItemDef(slot.itemId);
    if (!def || def.type === 'currency') return;
    const value = Inventory.getSellValue(slot.itemId);
    if (value <= 0) return;
    Inventory.removeItem(slotIndex, 1);
    Inventory.setGold(Inventory.getGold() + value);
    Audio.playSFX('assets/audio/sfx/sfx_ui_click.ogg');
    _renderShop();
}

/**
 * Exibe número de dano flutuante sobre a posição world do alvo.
 * @param {{ x: number, y: number, z: number }} worldPosition
 * @param {number} amount
 * @param {boolean} isCritical
 */
function showDamagePopup(worldPosition, amount, isCritical) {
    const camera = getCamera();
    const renderer = getRenderer();
    if (!camera || !renderer) return;

    const canvas = renderer.domElement;
    const vec = new THREE.Vector3(worldPosition.x, (worldPosition.y ?? 0) + 1.2, worldPosition.z);
    vec.project(camera);

    const hw = canvas.clientWidth / 2;
    const hh = canvas.clientHeight / 2;
    const sx = Math.round((vec.x * hw) + hw);
    const sy = Math.round((-vec.y * hh) + hh);

    const div = document.createElement('div');
    div.className = `lumie-dmg ${isCritical ? 'critical' : 'normal'}`;
    div.textContent = isCritical ? `${amount}!` : `${amount}`;
    div.style.left = `${sx}px`;
    div.style.top = `${sy}px`;

    const root = document.getElementById('ui-root') ?? document.body;
    root.appendChild(div);
    div.addEventListener('animationend', () => div.remove(), { once: true });
}
/**
 * Exibe popup de dano de skill (azul) sobre o alvo.
 * @param {{ x: number, y: number, z: number }} worldPosition
 * @param {number} amount
 */
function _showSkillDamagePopup(worldPosition, amount) {
    const camera = getCamera();
    const renderer = getRenderer();
    if (!camera || !renderer) return;

    const canvas = renderer.domElement;
    const vec = new THREE.Vector3(worldPosition.x, (worldPosition.y ?? 0) + 1.2, worldPosition.z);
    vec.project(camera);

    const hw = canvas.clientWidth / 2;
    const hh = canvas.clientHeight / 2;
    const sx = Math.round((vec.x * hw) + hw);
    const sy = Math.round((-vec.y * hh) + hh);

    const div = document.createElement('div');
    div.className = 'lumie-dmg skill';
    div.textContent = `${amount}`;
    div.style.left = `${sx}px`;
    div.style.top = `${sy}px`;
    div.style.color = '#ff4444';
    div.style.textShadow = '0 0 6px rgba(255,68,68,0.95), 0 0 12px rgba(255,68,68,0.55)';
    div.style.animationDuration = '1.8s';

    const root = document.getElementById('ui-root') ?? document.body;
    root.appendChild(div);
    div.addEventListener('animationend', () => div.remove(), { once: true });
}

/**
 * Exibe popup flutuante azul de consumo de MP sobre o player.
 * @param {number} amount
 */
function showMpPopup(amount) {
    const camera = getCamera();
    const renderer = getRenderer();
    if (!camera || !renderer) return;

    const worldPosition = Player.getPosition();
    if (!worldPosition) return;

    const canvas = renderer.domElement;
    const vec = new THREE.Vector3(worldPosition.x, (worldPosition.y ?? 0) + 1.6, worldPosition.z);
    vec.project(camera);

    const hw = canvas.clientWidth / 2;
    const hh = canvas.clientHeight / 2;
    const sx = Math.round((vec.x * hw) + hw);
    const sy = Math.round((-vec.y * hh) + hh);

    const div = document.createElement('div');
    div.className = 'lumie-dmg mp';
    div.textContent = `-${amount} MP`;
    div.style.left = `${sx}px`;
    div.style.top = `${sy}px`;
    div.style.color = '#4488ff';
    div.style.textShadow = '0 0 6px rgba(68,136,255,0.95), 0 0 12px rgba(68,136,255,0.55)';
    div.style.animationDuration = '1.8s';

    const root = document.getElementById('ui-root') ?? document.body;
    root.appendChild(div);
    div.addEventListener('animationend', () => div.remove(), { once: true });
}
// PROMPT 10 ────────────────────────────────────────────────────────────────

const _CLASS_COLORS = {
    swordman: '#e07a3a',
    mage: '#6a9fe8',
    archer: '#6db56d',
    assassin: '#b06ab3',
};

const _CLASS_DATA = [
    {
        id: 'swordman',
        name: 'Swordman',
        desc: 'Guerreiro resistente, mestre de espadas e lanças.',
        skills: ['Bash', 'Endure', 'Provoke']
    },
    {
        id: 'mage',
        name: 'Mage',
        desc: 'Conjurador de feitiços elementais devastadores.',
        skills: ['Fire Ball', 'Ice Bolt', 'Lightning']
    },
    {
        id: 'archer',
        name: 'Archer',
        desc: 'Atirador preciso com grande alcance de combate.',
        skills: ['Double Strike', 'Explosive Shot', 'Slow Shot']
    },
    {
        id: 'assassin',
        name: 'Assassin',
        desc: 'Especialista em golpes furtivos e venenos.',
        skills: ['Stealth Strike', 'Poison', 'Evasion']
    },
];

/**
 * Constrói o HTML da hotbar.
 */
function _buildHotbar() {
    if (_hotbarEl) return;

    _hotbarEl = document.createElement('div');
    _hotbarEl.id = 'hotbar';

    for (let i = 0; i < 4; i++) {
        const slot = document.createElement('div');
        slot.className = 'hotbar-slot empty';
        slot.dataset.slot = String(i);
        slot.innerHTML = `
            <span class="hb-key">${i + 1}</span>
            <span class="hb-mpcost"></span>
            <div class="hb-icon"></div>
            <div class="hb-cooldown-overlay"></div>
        `;
        _hotbarEl.appendChild(slot);
        _hotbarSlotEls.push(slot);
    }

    document.body.appendChild(_hotbarEl);
}

/**
 * Constrói a janela de skills.
 */
function _buildSkillWindow() {
    if (_skillWindowEl) return;

    _skillWindowEl = document.createElement('div');
    _skillWindowEl.id = 'skill-window';
    _skillWindowEl.style.display = 'none';
    _skillWindowEl.innerHTML = `
        <div class="sw-header">
            <span>Skills</span>
            <button class="sw-close" aria-label="Fechar">✕</button>
        </div>
        <div class="sw-hotbar-slots">
            <div class="sw-slot" data-slot="0"><span class="sw-slot-label">1</span><span class="sw-slot-name"></span><button class="sw-clear" data-slot="0">✕</button></div>
            <div class="sw-slot" data-slot="1"><span class="sw-slot-label">2</span><span class="sw-slot-name"></span><button class="sw-clear" data-slot="1">✕</button></div>
            <div class="sw-slot" data-slot="2"><span class="sw-slot-label">3</span><span class="sw-slot-name"></span><button class="sw-clear" data-slot="2">✕</button></div>
            <div class="sw-slot" data-slot="3"><span class="sw-slot-label">4</span><span class="sw-slot-name"></span><button class="sw-clear" data-slot="3">✕</button></div>
        </div>
        <div class="sw-skill-list" id="sw-skill-list"></div>
    `;
    document.body.appendChild(_skillWindowEl);

    _skillWindowEl.querySelector('.sw-close').addEventListener('click', toggleSkillWindow);

    _skillWindowEl.querySelectorAll('.sw-clear').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const slot = parseInt(e.currentTarget.dataset.slot, 10);
            _clearSkillSlot(slot);
        });
    });

    _skillWindowEl.querySelectorAll('.sw-slot').forEach(slotEl => {
        slotEl.addEventListener('click', () => {
            if (!_selectedSkillId) return;
            const slot = parseInt(slotEl.dataset.slot, 10);
            const state = Player.getState();
            if (!state) return;

            state.equippedSkills[slot] = _selectedSkillId;
            _selectedSkillId = null;

            _skillWindowEl.querySelectorAll('.sw-skill-item').forEach(el => el.classList.remove('selecting'));
            updateHotbar();
            _renderSkillWindowSlots(state);
        });
    });
}

/**
 * Injeta CSS da hotbar, janela de skills e modal.
 */
function _injectSkillStyles() {
    if (document.getElementById('lumie-skill-styles')) return;

    const style = document.createElement('style');
    style.id = 'lumie-skill-styles';
    style.textContent = `
        #hotbar {
            position: fixed;
            bottom: 18px;
            left: 50%;
            transform: translateX(-50%);
            display: flex;
            gap: 8px;
            z-index: 100;
        }
        .hotbar-slot {
            position: relative;
            width: 60px;
            height: 60px;
            background: rgba(10,10,10,0.72);
            border: 2px solid rgba(255,255,255,0.18);
            border-radius: 6px;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
            box-sizing: border-box;
        }
        .hotbar-slot.empty {
            border-style: dashed;
            border-color: rgba(255,255,255,0.10);
        }
        .hb-key {
            position: absolute;
            bottom: 3px;
            right: 5px;
            font-size: 10px;
            color: rgba(255,255,255,0.55);
            pointer-events: none;
            z-index: 2;
        }
        .hb-mpcost {
            position: absolute;
            top: 3px;
            left: 4px;
            font-size: 9px;
            color: #7ec8e3;
            pointer-events: none;
            z-index: 2;
        }
        .hb-icon {
            width: 40px;
            height: 40px;
            border-radius: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 15px;
            font-weight: bold;
            color: #fff;
            pointer-events: none;
        }
        .hb-cooldown-overlay {
            position: absolute;
            bottom: 0;
            left: 0;
            width: 100%;
            height: 0;
            background: rgba(0,0,0,0.62);
            pointer-events: none;
            z-index: 3;
            transition: height 0.05s linear;
        }
        #skill-window {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 320px;
            max-height: 480px;
            background: rgba(15,15,20,0.96);
            border: 1px solid rgba(255,255,255,0.15);
            border-radius: 8px;
            z-index: 200;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        .sw-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 14px;
            border-bottom: 1px solid rgba(255,255,255,0.10);
            font-size: 13px;
            font-weight: bold;
            color: #e0e0e0;
        }
        .sw-close {
            background: none;
            border: none;
            color: #aaa;
            cursor: pointer;
            font-size: 14px;
            padding: 2px 6px;
        }
        .sw-close:hover { color: #fff; }
        .sw-hotbar-slots {
            display: flex;
            gap: 6px;
            padding: 10px 14px;
            border-bottom: 1px solid rgba(255,255,255,0.08);
        }
        .sw-slot {
            flex: 1;
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(255,255,255,0.12);
            border-radius: 5px;
            padding: 5px 4px;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 2px;
            cursor: pointer;
        }
        .sw-slot-label {
            font-size: 9px;
            color: rgba(255,255,255,0.4);
        }
        .sw-slot-name {
            font-size: 10px;
            color: #e0e0e0;
            text-align: center;
            word-break: break-word;
        }
        .sw-clear {
            background: none;
            border: none;
            color: rgba(255,100,100,0.6);
            cursor: pointer;
            font-size: 9px;
            padding: 0;
            line-height: 1;
        }
        .sw-clear:hover { color: #ff6464; }
        .sw-skill-list {
            overflow-y: auto;
            flex: 1;
            padding: 8px 10px;
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .sw-skill-item {
            background: rgba(255,255,255,0.04);
            border: 1px solid rgba(255,255,255,0.09);
            border-radius: 5px;
            padding: 8px 10px;
            cursor: pointer;
            display: flex;
            flex-direction: column;
            gap: 2px;
            transition: background 0.15s;
        }
        .sw-skill-item:hover { background: rgba(255,255,255,0.10); }
        .sw-skill-item.selecting {
            border-color: #7ec8e3;
            background: rgba(126,200,227,0.10);
        }
        .sw-skill-name {
            font-size: 12px;
            font-weight: bold;
            color: #e8e8e8;
        }
        .sw-skill-desc {
            font-size: 10px;
            color: #999;
            line-height: 1.3;
        }
        .sw-skill-meta {
            font-size: 10px;
            color: #7ec8e3;
            margin-top: 1px;
        }
        #class-modal-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.88);
            z-index: 500;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        #class-modal {
            background: rgba(15,15,22,0.98);
            border: 1px solid rgba(255,255,255,0.12);
            border-radius: 12px;
            padding: 36px 32px 32px;
            width: min(95vw, 980px);
            max-height: 92vh;
            overflow-y: auto;
        }
        #class-modal h2 {
            text-align: center;
            color: #e8e8e8;
            margin-bottom: 28px;
            font-size: 26px;
            letter-spacing: 1px;
        }
        .class-cards {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
            gap: 20px;
        }
        .class-card {
            background: rgba(255,255,255,0.04);
            border: 1px solid rgba(255,255,255,0.12);
            border-radius: 10px;
            padding: 24px 20px;
            display: flex;
            flex-direction: column;
            gap: 10px;
            cursor: pointer;
            transition: background 0.18s, border-color 0.18s;
        }
        .class-card:hover {
            background: rgba(255,255,255,0.10);
            border-color: rgba(255,255,255,0.28);
        }
        .class-card-name {
            font-size: 20px;
            font-weight: bold;
            color: #e8e8e8;
            text-align: center;
            margin-bottom: 4px;
        }
        .class-card-desc {
            font-size: 13px;
            color: #b8b8b8;
            text-align: center;
            line-height: 1.5;
        }
        .class-card-skills {
            font-size: 13px;
            color: #7ec8e3;
            line-height: 1.7;
            margin-top: 8px;
            text-align: center;
        }
        .class-card-btn {
            margin-top: 14px;
            padding: 12px 0;
            background: rgba(126,200,227,0.15);
            border: 1px solid rgba(126,200,227,0.35);
            border-radius: 6px;
            color: #7ec8e3;
            font-size: 15px;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.15s;
            width: 100%;
        }
        .class-card-btn:hover { background: rgba(126,200,227,0.30); }
    `;
    document.head.appendChild(style);
}

/**
 * Dispara skill do slot.
 * @param {number} slotIndex
 */
function _triggerSkillSlot(slotIndex) {
    if (_dialogOpen) return;

    const state = Player.getState();
    if (!state || !Array.isArray(state.equippedSkills)) return;

    const skillId = state.equippedSkills[slotIndex];
    if (!skillId) return;

    const def = Classes.getSkillDef(skillId);
    if (!def) return;

    let target = null;
    if (def.targetType === 'enemy' || def.targetType === 'aoe') {
        target = Combat.findNearestTarget(state.position, def.range);
    }

    const result = Combat.castSkill(state, skillId, target);
    if (!result.ok) {
        showNotification(_skillFailMessage(result.reason), 'warning');
    }
}

/**
 * Mensagem amigável para falha de cast.
 * @param {string} reason
 * @returns {string}
 */
function _skillFailMessage(reason) {
    switch (reason) {
        case 'sem-alvo': return 'Sem alvo no alcance.';
        case 'fora-de-alcance': return 'Alvo fora de alcance.';
        case 'mp-insuficiente': return 'MP insuficiente.';
        case 'em-cooldown': return 'Skill em recarga.';
        case 'skill-nao-aprendida': return 'Skill não aprendida.';
        case 'classe-incorreta': return 'Skill de outra classe.';
        default: return 'Não foi possível usar a skill.';
    }
}

/**
 * Limpa skill de um slot.
 * @param {number} slotIndex
 */
function _clearSkillSlot(slotIndex) {
    const state = Player.getState();
    if (!state) return;
    state.equippedSkills[slotIndex] = null;
    updateHotbar();
    _renderSkillWindowSlots(state);
}

/**
 * Renderiza lista de skills aprendidas.
 * @param {Object} state
 */
function _renderSkillWindowList(state) {
    const list = document.getElementById('sw-skill-list');
    if (!list) return;

    list.innerHTML = '';
    _selectedSkillId = null;

    if (!Array.isArray(state.learnedSkills) || state.learnedSkills.length === 0) {
        list.innerHTML = `<p style="color:#666;font-size:11px;text-align:center;padding:16px;">Nenhuma skill aprendida.</p>`;
        return;
    }

    state.learnedSkills.forEach(skillId => {
        const def = Classes.getSkillDef(skillId);
        if (!def) return;

        const item = document.createElement('div');
        item.className = 'sw-skill-item';
        item.dataset.skillId = skillId;
        item.innerHTML = `
            <span class="sw-skill-name">${def.name}</span>
            <span class="sw-skill-desc">${def.description}</span>
            <span class="sw-skill-meta">MP ${def.mpCost} · CD ${def.cooldown}s · Alcance ${def.range ?? 0}u</span>
        `;

        item.addEventListener('click', () => {
            _skillWindowEl.querySelectorAll('.sw-skill-item').forEach(el => el.classList.remove('selecting'));

            if (_selectedSkillId === skillId) {
                _selectedSkillId = null;
                return;
            }

            _selectedSkillId = skillId;
            item.classList.add('selecting');
        });

        list.appendChild(item);
    });
}

/**
 * Renderiza nomes dos slots no topo da janela K.
 * @param {Object} state
 */
function _renderSkillWindowSlots(state) {
    if (!_skillWindowEl) return;

    _skillWindowEl.querySelectorAll('.sw-slot').forEach(slotEl => {
        const slot = parseInt(slotEl.dataset.slot, 10);
        const skillId = state.equippedSkills[slot];
        const nameEl = slotEl.querySelector('.sw-slot-name');
        if (nameEl) {
            const def = skillId ? Classes.getSkillDef(skillId) : null;
            nameEl.textContent = def ? def.name : '';
        }
    });
}

/**
 * Atualiza hotbar.
 */
export function updateHotbar() {
    const state = Player.getState();

    _hotbarSlotEls.forEach((slot, i) => {
        const skillId = state ? state.equippedSkills?.[i] : null;
        const def = skillId ? Classes.getSkillDef(skillId) : null;
        const iconEl = slot.querySelector('.hb-icon');
        const costEl = slot.querySelector('.hb-mpcost');

        if (def && state) {
            const color = _CLASS_COLORS[state.class] ?? '#888';
            iconEl.style.background = color;
            iconEl.textContent = def.name.charAt(0);
            costEl.textContent = def.mpCost;
            slot.classList.remove('empty');
        } else {
            iconEl.style.background = 'transparent';
            iconEl.textContent = '';
            costEl.textContent = '';
            slot.classList.add('empty');
        }
    });
}

/**
 * Atualiza overlay de cooldown da hotbar.
 * @param {number} _delta
 */
export function updateCooldownVisuals(_delta) {
    const state = Player.getState();
    if (!state || !state.cooldowns) {
        _hotbarSlotEls.forEach(slot => {
            const ov = slot.querySelector('.hb-cooldown-overlay');
            if (ov) ov.style.height = '0';
        });
        return;
    }

    const now = performance.now();

    _hotbarSlotEls.forEach((slot, i) => {
        const skillId = state.equippedSkills?.[i];
        const overlay = slot.querySelector('.hb-cooldown-overlay');
        if (!overlay) return;

        if (!skillId) {
            overlay.style.height = '0';
            return;
        }

        const def = Classes.getSkillDef(skillId);
        const cdEnd = state.cooldowns[skillId];

        if (!cdEnd || !def || now >= cdEnd) {
            overlay.style.height = '0';
            return;
        }

        const total = def.cooldown * 1000;
        const remaining = cdEnd - now;
        const pct = Math.min(100, (remaining / total) * 100);
        overlay.style.height = `${pct.toFixed(1)}%`;
    });
}

/**
 * Abre/fecha a janela de skills.
 */
export function toggleSkillWindow() {
    if (_dialogOpen) return;
    if (!_skillWindowEl) return;

    _skillWindowOpen = !_skillWindowOpen;

    if (_skillWindowOpen) {
        _skillWindowEl.style.display = 'flex';
        const state = Player.getState();
        if (state) {
            _renderSkillWindowList(state);
            _renderSkillWindowSlots(state);
        }
        Events.emit('uiWindowOpened', { windowId: 'skillWindow' });
    } else {
        _skillWindowEl.style.display = 'none';
        _selectedSkillId = null;
        Events.emit('uiWindowClosed', { windowId: 'skillWindow' });
    }
}




function _closeSocketPopup() {
    _socketPopupEl?.remove();
    _socketPopupEl = null;
    _socketPopupTarget = null;
}

function _openSocketPopup(slotName, socketIndex) {
    _closeSocketPopup();
    _socketPopupTarget = { type: 'equipment', slot: slotName, socketIndex };

    const cards = Inventory.getSlots()
        .map((slot, index) => ({ slot, index }))
        .filter(({ slot }) => {
            const def = Inventory.getItemDef(slot?.itemId);
            return def?.type === 'card';
        });

    const popup = document.createElement('div');
    popup.id = 'ui-socket-popup';
    popup.style.cssText = `
        position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);
        width:420px;max-width:92vw;max-height:70vh;overflow:auto;
        background:rgba(20,18,14,0.98);border:1px solid #5a4a2a;border-radius:8px;
        padding:14px;z-index:500;color:#e8d8a0;font-family:monospace;
        box-shadow:0 8px 32px rgba(0,0,0,0.8);
    `;

    popup.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <div style="font-weight:bold;color:#ffd27a;">Inserir carta</div>
            <span id="ui-socket-popup-close" style="cursor:pointer;font-size:18px;line-height:1;">✕</span>
        </div>
        <div style="font-size:11px;color:#b49a6a;margin-bottom:10px;">
            Selecione uma carta do inventário para o socket ${socketIndex + 1} de ${slotName}.
        </div>
        <div id="ui-socket-popup-list" style="display:flex;flex-direction:column;gap:8px;"></div>
    `;

    document.body.appendChild(popup);
    _socketPopupEl = popup;

    popup.querySelector('#ui-socket-popup-close')?.addEventListener('click', _closeSocketPopup);

    const list = popup.querySelector('#ui-socket-popup-list');
    if (!cards.length) {
        list.innerHTML = `<div style="padding:10px;border:1px solid #4e3b1f;border-radius:6px;background:#21180d;color:#a89368;">Nenhuma carta disponível no inventário.</div>`;
        return;
    }

    cards.forEach(({ slot, index }) => {
        const def = Inventory.getItemDef(slot.itemId);
        const row = document.createElement('div');
        row.style.cssText = `
            display:flex;justify-content:space-between;align-items:center;
            padding:10px;border:1px solid #4e3b1f;border-radius:6px;background:#21180d;
            cursor:pointer;
        `;
        row.innerHTML = `
            <div>
                <div style="color:#ffd27a;">${def?.name ?? slot.itemId}</div>
                <div style="font-size:11px;color:#8f7a54;">Clique para inserir</div>
            </div>
            <div style="font-size:18px;">🃏</div>
        `;

        row.addEventListener('click', () => {
            const result = Cards.insertCard({ type: 'equipment', slot: slotName }, socketIndex, slot.itemId);
            if (result) {
                Audio.playSFX('assets/audio/sfx/sfx_ui_click.ogg');
                _flashSocketSuccess(slotName, socketIndex);
                _refreshInventoryUI();
                _refreshEquipmentWindowUI();
                _closeSocketPopup();
            }
        });

        list.appendChild(row);
    });
}




function _flashSocketSuccess(slotName, socketIndex) {
    const socketEl = document.querySelector(
        `#ui-item-sockets [data-slot="${slotName}"][data-socket-index="${socketIndex}"]`
    );
    if (!socketEl) return;

    socketEl.style.transition = 'transform 120ms ease, box-shadow 120ms ease, background 120ms ease';
    socketEl.style.boxShadow = '0 0 0 2px #6dff7a, 0 0 12px rgba(109,255,122,0.95)';
    socketEl.style.background = '#1f5b27';
    socketEl.style.color = '#caffcf';
    socketEl.style.transform = 'scale(1.08)';

    setTimeout(() => {
        socketEl.style.boxShadow = '';
        socketEl.style.transform = '';
    }, 180);
}




export function isSkillWindowOpen() {
    return _skillWindowOpen;
}

/**
 * Exibe modal de escolha de classe.
 * @param {(classId: string) => void} onChosen
 */
export function showClassSelectionModal(onChosen) {
    if (_classModalEl) return;

    _classModalCb = onChosen;
    _classModalEl = document.createElement('div');
    _classModalEl.id = 'class-modal-overlay';

    const modal = document.createElement('div');
    modal.id = 'class-modal';
    modal.innerHTML = `<h2>Escolha sua Classe</h2><div class="class-cards"></div>`;

    const cardsEl = modal.querySelector('.class-cards');

    _CLASS_DATA.forEach(cls => {
        const card = document.createElement('div');
        card.className = 'class-card';
        card.innerHTML = `
            <div class="class-card-name">${cls.name}</div>
            <div class="class-card-desc">${cls.desc}</div>
            <div class="class-card-skills">${cls.skills.join('<br>')}</div>
            <button class="class-card-btn">Escolher</button>
        `;

        card.querySelector('.class-card-btn').addEventListener('click', () => {
            const cb = _classModalCb;
            _classModalEl.remove();
            _classModalEl = null;
            _classModalCb = null;
            if (cb) cb(cls.id);
        });

        cardsEl.appendChild(card);
    });

    _classModalEl.appendChild(modal);
    document.body.appendChild(_classModalEl);
}

// ─── Barras de HP de monstros ─────────────────────────────────────────────

/** @type {Map<string, HTMLDivElement>} */
const _monsterHpBars = new Map();

/**
 * Cria barra de HP flutuante.
 * @param {string} monsterId
 */
function _createMonsterHpBar(monsterId) {
    if (_monsterHpBars.has(monsterId)) return;

    const el = document.createElement('div');
    el.className = 'monster-hpbar';
    el.style.cssText = `
        position: fixed;
        width: 60px;
        height: auto;
        background: rgba(0,0,0,0.7);
        border: 1px solid rgba(0,0,0,0.85);
        border-radius: 2px;
        pointer-events: none;
        z-index: 90;
        transform: translate(-50%, -100%);

        display: none;
    `;
    const nameTag = document.createElement('div');
    nameTag.className = 'monster-hpbar-name';
    nameTag.style.cssText = 'color:#fff;font-size:10px;font-family:sans-serif;text-align:center;text-shadow:1px 1px 2px #000;white-space:nowrap;margin-bottom:2px;';
    el.appendChild(nameTag);
    const fill = document.createElement('div');
    fill.className = 'monster-hpbar-fill';
    fill.style.cssText = 'width:100%;height:6px;background:linear-gradient(to bottom,#ff5050,#c83232);transition:width 0.15s linear;border-radius:2px;';
    el.appendChild(fill);

     document.body.appendChild(el);
    _monsterHpBars.set(monsterId, el);
}

/**
 * Remove barra de HP do monstro.
 * @param {string} monsterId
 */
function _removeMonsterHpBar(monsterId) {
    const el = _monsterHpBars.get(monsterId);
    if (el) el.remove();
    _monsterHpBars.delete(monsterId);
}

/**
 * Atualiza barras de HP dos monstros.
 */
export function updateMonsterHpBars() {
    if (_monsterHpBars.size === 0) return;

    const camera = getCamera();
    const renderer = getRenderer();
    if (!camera || !renderer) return;

    const canvas = renderer.domElement;

    _monsterHpBars.forEach((el, monsterId) => {
        const monster = Monsters.getById(monsterId);
        if (!monster || !monster.mesh || monster.hp <= 0) {
            el.style.display = 'none';
            return;
        }

        const pos3D = new THREE.Vector3();
        monster.mesh.getWorldPosition(pos3D);
        pos3D.y += 1.2;
        pos3D.project(camera);

        if (pos3D.z > 1) {
            el.style.display = 'none';
            return;
        }

        const screenX = (pos3D.x * 0.5 + 0.5) * canvas.clientWidth;
        const screenY = (pos3D.y * -0.5 + 0.5) * canvas.clientHeight;

        el.style.display = 'block';
        el.style.left = `${screenX}px`;
        el.style.top = `${screenY}px`;

        const nameEl = el.querySelector('.monster-hpbar-name');
        const fill = el.querySelector('.monster-hpbar-fill');
        if (nameEl && !nameEl.textContent) {
            nameEl.textContent = monster.name ?? monster.monsterId ?? '???';
        }
        if (fill) {
            const pct = Math.max(0, Math.min(100, (monster.hp / monster.maxHp) * 100));
            fill.style.width = `${pct.toFixed(1)}%`;
        }
    });
}

// ─── Labels flutuantes de drops ───────────────────────────────────────────────

/** @type {Map<string, HTMLDivElement>} dropId -> elemento DOM do label */
const _dropLabels = new Map();

/** Cor do label por tipo de item (demais: branco). */
const _DROP_LABEL_COLORS = { currency: '#ffd700', card: '#d98cff' };

/**
 * Cria o label flutuante de um drop.
 * @param {string} dropId
 * @param {string} text
 * @param {string|null} type
 */
function _createDropLabel(dropId, text, type) {
    if (_dropLabels.has(dropId)) return;
    const el = document.createElement('div');
    el.className = 'drop-label';
    el.textContent = text;
    el.style.cssText = `
        position: fixed;
        color: ${_DROP_LABEL_COLORS[type] ?? '#ffffff'};
        font: bold 12px sans-serif;
        text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 5px rgba(0,0,0,0.9);
        white-space: nowrap;
        pointer-events: none;
        z-index: 91;
        transform: translate(-50%, -100%);
        display: none;
    `;
    document.body.appendChild(el);
    _dropLabels.set(dropId, el);
}

/**
 * Remove o label de um drop (coletado/removido). Evita elemento orfao no DOM.
 * @param {string} dropId
 */
function _removeDropLabel(dropId) {
    const el = _dropLabels.get(dropId);
    if (el) el.remove();
    _dropLabels.delete(dropId);
}

/**
 * Projeta os labels de drop (3D->2D) a cada frame, acompanhando o drop no chao.
 * Remove o label se o drop nao existir mais (coleta/timeout/troca de mapa).
 * @returns {void}
 */
export function updateDropLabels() {
    if (_dropLabels.size === 0) return;

    const camera = getCamera();
    const renderer = getRenderer();
    if (!camera || !renderer) return;

    const canvas = renderer.domElement;

    _dropLabels.forEach((el, dropId) => {
        const drop = Monsters.getDropById(dropId);
        if (!drop || !drop.mesh) {
            el.remove();
            _dropLabels.delete(dropId);
            return;
        }

        const pos3D = new THREE.Vector3();
        drop.mesh.getWorldPosition(pos3D);
        pos3D.y += 0.55; // logo acima do modelo do drop
        pos3D.project(camera);

        if (pos3D.z > 1) { el.style.display = 'none'; return; }

        el.style.display = 'block';
        el.style.left = `${(pos3D.x * 0.5 + 0.5) * canvas.clientWidth}px`;
        el.style.top  = `${(pos3D.y * -0.5 + 0.5) * canvas.clientHeight}px`;
    });
}