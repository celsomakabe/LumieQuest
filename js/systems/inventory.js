/**
 * @module Inventory
 * @description Sistema de inventário: 30 slots, equipamento, ouro, uso de itens.
 * Comunicação com player.js exclusivamente via event bus (R8).
 */

import { on, emit } from '../core/events.js';

// ─── Estado interno ───────────────────────────────────────────────────────────

/** @type {Array<{itemId: string, qty: number}|null>} */
let _slots = new Array(30).fill(null);

/** @type {{ weapon: string|null, armor: string|null, accessory: string|null }} */
let _equipment = { weapon: null, armor: null, accessory: null };

/** @type {number} */
let _gold = 0;

/** @type {Object.<string, Object>} */
let _catalogue = {};

/** @type {boolean} */
let _initialized = false;

// ─── Helpers internos ─────────────────────────────────────────────────────────

function _buildCatalogue(itemsArray) {
    _catalogue = {};
    for (const item of itemsArray) {
        _catalogue[item.id] = item;
    }
}

function _findEmptySlot() {
    return _slots.findIndex(s => s === null);
}

function _findStackableSlot(itemId) {
    const def = _catalogue[itemId];
    if (!def) return -1;
    return _slots.findIndex(s => s !== null && s.itemId === itemId && s.qty < def.stack);
}

// ─── API pública ──────────────────────────────────────────────────────────────

export async function init(saveData) {
    if (_initialized) return;

    const response = await fetch('assets/data/items.json');
    const json = await response.json();
    _buildCatalogue(json.items);

    _slots = new Array(30).fill(null);
    _equipment = { weapon: null, armor: null, accessory: null };
    _gold = 0;

    if (saveData) {
        hydrate(saveData);
    }

    _initialized = true;
}

export function hydrate(data) {
    if (Array.isArray(data.slots)) {
        for (let i = 0; i < 30; i++) {
            _slots[i] = data.slots[i] ?? null;
        }
    }
    if (data.equipment) {
        _equipment.weapon    = data.equipment.weapon    ?? null;
        _equipment.armor     = data.equipment.armor     ?? null;
        _equipment.accessory = data.equipment.accessory ?? null;
    }
    _gold = typeof data.gold === 'number' ? data.gold : 0;
}

export function addItem(itemId, qty = 1) {
if (itemId === 'gold') {
        _gold += qty;
        emit('goldChanged', { amount: qty, total: _gold });
        return true;
    }
    const def = _catalogue[itemId];
    if (!def) {
        console.warn('[Inventory] Item desconhecido:', itemId);
        return false;
    }

    if (def.type === 'currency') {
        _gold += qty;
        emit('goldChanged', { amount: qty, total: _gold });
        return true;
    }

    let remaining = qty;

    while (remaining > 0) {
        const stackIdx = _findStackableSlot(itemId);
        if (stackIdx !== -1) {
            const space = def.stack - _slots[stackIdx].qty;
            const toAdd = Math.min(space, remaining);
            _slots[stackIdx].qty += toAdd;
            remaining -= toAdd;
            emit('itemAdded', { itemId, qty: toAdd, slotIndex: stackIdx });
        } else {
            const emptyIdx = _findEmptySlot();
            if (emptyIdx === -1) {
                emit('inventoryFull', { itemId });
                return false;
            }
            const toAdd = Math.min(def.stack, remaining);
            _slots[emptyIdx] = { itemId, qty: toAdd };
            remaining -= toAdd;
            emit('itemAdded', { itemId, qty: toAdd, slotIndex: emptyIdx });
        }
    }

    return true;
}

export function removeItem(slotIndex, qty = 1) {
    const slot = _slots[slotIndex];
    if (!slot) return false;

    const removed = Math.min(slot.qty, qty);
    slot.qty -= removed;
    emit('itemRemoved', { itemId: slot.itemId, qty: removed, slotIndex });

    if (slot.qty <= 0) {
        _slots[slotIndex] = null;
    }
    return true;
}

export function useItem(slotIndex) {
    const slot = _slots[slotIndex];
    if (!slot) return false;

    const def = _catalogue[slot.itemId];
    if (!def || def.type !== 'consumable') return false;

    if (def.effect) {
        if (def.effect.type === 'heal') {
            emit('inventoryHealRequest', { amount: def.effect.amount });
        } else if (def.effect.type === 'restore_mp') {
            emit('inventoryRestoreMpRequest', { amount: def.effect.amount });
        }
    }

    removeItem(slotIndex, 1);
    emit('itemUsed', { itemId: slot.itemId, slotIndex });
    return true;
}

export function equipItem(slotIndex) {
    const slot = _slots[slotIndex];
    if (!slot) return false;

    const def = _catalogue[slot.itemId];
    if (!def || (def.type !== 'weapon' && def.type !== 'armor' && def.type !== 'accessory')) {
        return false;
    }

    const equipSlot = def.type;

    // Remove do inventário PRIMEIRO para abrir espaço ao item antigo
    const itemId = slot.itemId;
    _slots[slotIndex] = null;

    if (_equipment[equipSlot] !== null) {
        const oldItemId = _equipment[equipSlot];
        const returned = addItem(oldItemId, 1);
        if (!returned) {
            // rollback
            _slots[slotIndex] = { itemId, qty: 1 };
            emit('inventoryFull', { itemId: oldItemId });
            return false;
        }
        emit('itemUnequipped', { itemId: oldItemId, equipmentSlot: equipSlot });
    }

    _equipment[equipSlot] = itemId;

    emit('itemEquipped', { itemId, equipmentSlot: equipSlot });

    if (def.effect) {
        emit('inventoryEquipBonusRequest', { stats: def.effect });
    }

    return true;
}

export function unequipItem(equipmentSlot) {
    const itemId = _equipment[equipmentSlot];
    if (!itemId) return false;

    const returned = addItem(itemId, 1);
    if (!returned) {
        emit('inventoryFull', { itemId });
        return false;
    }

    _equipment[equipmentSlot] = null;
    emit('itemUnequipped', { itemId, equipmentSlot });
    return true;
}

export function getSlots() {
    return _slots.map(s => s ? { ...s } : null);
}

export function getEquipment() {
    return { ..._equipment };
}

export function getGold() {
    return _gold;
}

export function setGold(value) {
    const diff = value - _gold;
    _gold = value;
    emit('goldChanged', { amount: diff, total: _gold });
}

export function getItemDef(itemId) {
    return _catalogue[itemId];
}

export function serialize() {
    return {
        slots: _slots.map(s => s ? { ...s } : null),
        equipment: { ..._equipment },
        gold: _gold
    };
}
