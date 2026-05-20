import { on, emit } from '../core/events.js';
import * as Inventory from './inventory.js';

const _cards = new Map();

const SOCKET_RANGES = {
  weapon: { min: 1, max: 3 },
  armor: { min: 0, max: 2 },
  garment: { min: 0, max: 2 },
  footgear: { min: 0, max: 2 },
  upper_headgear: { min: 0, max: 2 },
  shield: { min: 0, max: 1 },
  mid_headgear: { min: 0, max: 1 },
  lower_headgear: { min: 0, max: 1 },
  accessory_left: { min: 0, max: 1 },
  accessory_right: { min: 0, max: 1 }
};

let _initialized = false;

/**
 * Inicializa o sistema de cartas carregando definições do catálogo e registrando listeners.
 * @returns {Promise<boolean>}
 */
export async function init() {
  if (_initialized) return true;

  _cards.clear();

  try {
    const response = await fetch('assets/data/items.json');
    if (!response.ok) {
      throw new Error(`Falha ao carregar items.json: ${response.status}`);
    }

    const data = await response.json();
    const items = Array.isArray(data) ? data : data.items ?? [];

    for (const item of items) {
      if (item?.type === 'card' && item.id) {
        _cards.set(item.id, _cloneCardDef(item));
      }
    }

    on('itemUnequipped', _handleItemUnequipped);

    _initialized = true;
    return true;
  } catch (error) {
    console.error('[Cards] init error:', error);
    return false;
  }
}

/**
 * Retorna a definição de uma carta pelo ID.
 * @param {string} cardId
 * @returns {object|null}
 */
export function getCardDef(cardId) {
  if (!cardId || !_cards.has(cardId)) return null;
  return _cloneCardDef(_cards.get(cardId));
}

/**
 * Retorna todas as definições de cartas carregadas.
 * @returns {object[]}
 */
export function getAllCards() {
  return Array.from(_cards.values(), _cloneCardDef);
}

/**
 * Retorna o range de sockets para um tipo de slot.
 * @param {string} slotType
 * @returns {{ min: number, max: number }}
 */
export function getSocketRange(slotType) {
  const range = SOCKET_RANGES[slotType];
  if (!range) return { min: 0, max: 0 };
  return { min: range.min, max: range.max };
}

/**
 * Gera um array de sockets vazios para um slot de equipamento.
 * @param {string} slotType
 * @returns {(string|null)[]}
 */
export function generateSockets(slotType) {
  const { min, max } = getSocketRange(slotType);
  if (max <= 0) return [];

  const count = _randomInt(min, max);
  if (count <= 0) return [];

  return Array.from({ length: count }, () => null);
}

/**
 * Encaixa uma carta em um socket de item equipado.
 * @param {{ type: 'equipment', slot: string }} target
 * @param {number} socketIndex
 * @param {string} cardId
 * @returns {boolean}
 */
export function insertCard(target, socketIndex, cardId) {
  if (!_isValidEquipmentTarget(target)) return false;
  if (!Number.isInteger(socketIndex) || socketIndex < 0) return false;

  const cardDef = getCardDef(cardId);
  if (!cardDef) return false;

  const equipment = Inventory.getEquipment();
  const equipObj = equipment?.[target.slot];

  if (!equipObj?.itemId) return false;

  const sockets = Array.isArray(equipObj.sockets) ? [...equipObj.sockets] : [];
  if (socketIndex >= sockets.length) return false;
  if (sockets[socketIndex] != null) return false;

  const cardSlotIndex = _findCardInInventory(cardId);
  if (cardSlotIndex < 0) return false;

  const removed = Inventory.removeItem(cardSlotIndex, 1);
  if (!removed) return false;

  const updated = Inventory.setEquipCardSocket(target.slot, socketIndex, cardId);
  if (!updated) {
    Inventory.addItem(cardId, 1);
    return false;
  }

  emit('cardInserted', {
    slot: target.slot,
    socketIndex,
    cardId
  });

  emit('cardBonusChanged', {
    source: 'insert',
    slot: target.slot,
    cardId
  });

  return true;
}

/**
 * Retorna os IDs das cartas encaixadas em um alvo.
 * @param {{ type: 'equipment', slot: string }} target
 * @returns {string[]}
 */
export function getInsertedCards(target) {
  if (!_isValidEquipmentTarget(target)) return [];

  const equipment = Inventory.getEquipment();
  const equipObj = equipment?.[target.slot];
  const sockets = Array.isArray(equipObj?.sockets) ? equipObj.sockets : [];

  return sockets.filter((cardId) => typeof cardId === 'string' && cardId.length > 0);
}

/**
 * Calcula os bônus agregados de todas as cartas equipadas.
 * @returns {{
 *   stats: { str: number, agi: number, vit: number, int: number, dex: number, luk: number },
 *   hp_pct: number,
 *   mp_pct: number,
 *   atk_pct: number,
 *   def_pct: number,
 *   elemental: Record<string, number>,
 *   statusChance: Record<string, number>
 * }}
 */
export function getCardBonuses() {
  const totals = _createEmptyBonuses();
  const equipment = Inventory.getEquipment();



  for (const equipObj of Object.values(equipment || {})) {
    const sockets = Array.isArray(equipObj?.sockets) ? equipObj.sockets : [];
    for (const cardId of sockets) {
      if (!cardId) continue;

      const cardDef = _cards.get(cardId);
      if (!cardDef?.effect) continue;

      const effects = Array.isArray(cardDef.effect) ? cardDef.effect : [cardDef.effect];
      for (const eff of effects) { _applyCardEffect(totals, eff); }
    }
  }

  return totals;
}

function _handleItemUnequipped() {
  emit('cardBonusChanged', {
    source: 'unequip'
  });
}

function _findCardInInventory(cardId) {
  const slots = Inventory.getSlots();
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (slot?.itemId === cardId) return i;
  }
  return -1;
}

function _applyCardEffect(target, effect) {
  if (!effect || typeof effect !== 'object') return;

  switch (effect.type) {
    case 'stat': {
      const statKey = effect.stat;
      const value = Number(effect.value) || 0;
      if (Object.prototype.hasOwnProperty.call(target.stats, statKey)) {
        target.stats[statKey] += value;
      }
      break;
    }
    case 'hp_pct':
      target.hp_pct += Number(effect.value) || 0;
      break;
    case 'mp_pct':
      target.mp_pct += Number(effect.value) || 0;
      break;
    case 'atk_pct':
      target.atk_pct += Number(effect.value) || 0;
      break;
    case 'def_pct':
      target.def_pct += Number(effect.value) || 0;
      break;
    case 'elemental':
      _mergeNumericMap(target.elemental, effect.elemental);
      break;
    case 'statusChance':
      _mergeNumericMap(target.statusChance, effect.statusChance);
      break;
    default:
      break;
  }

  if (effect.extraStat && effect.extraValue != null) {
    const extraKey = effect.extraStat;
    const extraValue = Number(effect.extraValue) || 0;
    if (Object.prototype.hasOwnProperty.call(target.stats, extraKey)) {
      target.stats[extraKey] += extraValue;
    }
  }

  if (effect.hp_pct_bonus != null) {
    target.hp_pct += Number(effect.hp_pct_bonus) || 0;
  }

  if (effect.mp_pct_bonus != null) {
    target.mp_pct += Number(effect.mp_pct_bonus) || 0;
  }
}

function _mergeNumericMap(target, source) {
  if (!source || typeof source !== 'object') return;

  for (const [key, value] of Object.entries(source)) {
    target[key] = (target[key] || 0) + (Number(value) || 0);
  }
}

function _createEmptyBonuses() {
  return {
    stats: {
      str: 0,
      agi: 0,
      vit: 0,
      int: 0,
      dex: 0,
      luk: 0
    },
    hp_pct: 0,
    mp_pct: 0,
    atk_pct: 0,
    def_pct: 0,
    elemental: {},
    statusChance: {}
  };
}

function _isValidEquipmentTarget(target) {
  return target?.type === 'equipment' && typeof target.slot === 'string' && target.slot.length > 0;
}

function _cloneCardDef(cardDef) {
  let effectClone;
  if (Array.isArray(cardDef?.effect)) {
    effectClone = cardDef.effect.map(e => ({ ...e,
      elemental: e.elemental ? { ...e.elemental } : undefined,
      statusChance: e.statusChance ? { ...e.statusChance } : undefined
    }));
  } else if (cardDef?.effect) {
    effectClone = {
      ...cardDef.effect,
      elemental: cardDef.effect.elemental ? { ...cardDef.effect.elemental } : undefined,
      statusChance: cardDef.effect.statusChance ? { ...cardDef.effect.statusChance } : undefined
    };
  }
  return { ...cardDef, effect: effectClone };
}

function _randomInt(min, max) {
  if (max < min) return min;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}