/**
 * @module Inventory
 * @description Sistema de inventário: 30 slots, equipamento, ouro, uso de itens.
 * Comunicação com player.js exclusivamente via event bus (R8).
 */

import { on, emit } from '../core/events.js';
import { hasPet, addPet } from './pets.js';
import { getClassLineage } from './classes.js';

let _slots = new Array(30).fill(null);

/** @type {{ weapon: { itemId: string, refineLevel?: number, sockets?: (string|null)[] }|null, shield: { itemId: string, refineLevel?: number, sockets?: (string|null)[] }|null, upper_headgear: { itemId: string, refineLevel?: number, sockets?: (string|null)[] }|null, mid_headgear: { itemId: string, refineLevel?: number, sockets?: (string|null)[] }|null, lower_headgear: { itemId: string, refineLevel?: number, sockets?: (string|null)[] }|null, armor: { itemId: string, refineLevel?: number, sockets?: (string|null)[] }|null, garment: { itemId: string, refineLevel?: number, sockets?: (string|null)[] }|null, footgear: { itemId: string, refineLevel?: number, sockets?: (string|null)[] }|null, accessory_left: { itemId: string, refineLevel?: number, sockets?: (string|null)[] }|null, accessory_right: { itemId: string, refineLevel?: number, sockets?: (string|null)[] }|null }} */
let _equipment = {
    weapon: null,
    shield: null,
    upper_headgear: null,
    mid_headgear: null,
    lower_headgear: null,
    armor: null,
    garment: null,
    footgear: null,
    accessory_left: null,
    accessory_right: null
};

let _gold = 0;
let _catalogue = {};
let _initialized = false;

const VALID_EQUIP_SLOTS = [
    'weapon', 'shield', 'upper_headgear', 'mid_headgear', 'lower_headgear',
    'armor', 'garment', 'footgear', 'accessory_left', 'accessory_right'
];

// Classe atual do player, cacheada via event bus (R8 — sem import de player.js).
// Registrado no escopo do modulo para captar o playerSpawned inicial.
let _playerClass = null;
on('playerSpawned', ({ class: cls } = {}) => { if (cls) _playerClass = cls; });
on('jobChanged',    ({ newClass } = {}) => {
    if (newClass) _playerClass = newClass;
    // Troca de classe em RUNTIME (job change legítimo E debugSetClass): revalida TODO o
    // gear com canEquip — mesma lógica do load, sem duplicar. A herança vale (knight
    // mantém o gear de swordman); só desequipa o que a nova classe realmente não pode usar.
    _autoUnequipIllegal();
});

/**
 * Indica se a classe atual do player pode equipar o item.
 * classRestriction null/vazio = livre. Caso contrario, o item e equipavel se algum
 * dos jobs listados estiver na LINHAGEM do player (heranca descendente: um evo veste
 * o gear dos ancestrais; o contrario nao). Classe ainda desconhecida = nao bloqueia.
 * @param {string} itemId
 * @returns {boolean}
 */
export function canEquip(itemId) {
    const def = _catalogue[itemId];
    if (!def) return false;
    const cr = def.classRestriction;
    if (cr == null || (Array.isArray(cr) && cr.length === 0)) return true;
    if (!_playerClass) return true;
    const list = Array.isArray(cr) ? cr : [cr];
    const lineage = getClassLineage(_playerClass); // inclui ancestrais + o proprio job
    return list.some(c => lineage.includes(c));
}

/**
 * Desequipa itens equipados que a classe atual nao pode usar (saves antigos), devolvendo
 * ao inventario. Se o inventario estiver cheio, mantem equipado (nao perde o item).
 * @returns {void}
 */
function _autoUnequipIllegal() {
    for (const slot of VALID_EQUIP_SLOTS) {
        const eq = _equipment[slot];
        const itemId = eq?.itemId ?? (typeof eq === 'string' ? eq : null);
        if (!itemId || canEquip(itemId)) continue;

        const idx = addItem(itemId, 1);
        if (idx === false) continue; // inventario cheio: nao desequipa para nao perder

        if (_slots[idx]) {
            _slots[idx].refineLevel = eq?.refineLevel ?? 0;
            const sk = _cloneSockets(eq?.sockets ?? []);
            if (sk.length > 0) _slots[idx].sockets = sk;
        }
        _equipment[slot] = null;
        emit('equipmentAutoUnequipped', { itemId, equipmentSlot: slot });
    }
}

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
function _cloneSockets(sockets) {
    return Array.isArray(sockets) ? sockets.map(cardId => cardId ?? null) : [];
}
export async function init(saveData) {
    if (_initialized) return;
    const response = await fetch('assets/data/items.json');
    const json = await response.json();
    _buildCatalogue(json.items);
    _slots = new Array(30).fill(null);
    _equipment = {
        weapon: null, shield: null, upper_headgear: null, mid_headgear: null,
        lower_headgear: null, armor: null, garment: null, footgear: null,
        accessory_left: null, accessory_right: null
    };
    _gold = 0;
    if (saveData) { hydrate(saveData); }
    _autoUnequipIllegal(); // saves antigos: remove itens equipados incompativeis com a classe
    _initialized = true;
}

export function hydrate(data) {
    if (Array.isArray(data.slots)) {
        for (let i = 0; i < 30; i++) {
            const rawSlot = data.slots[i] ?? null;
            if (!rawSlot) {
                _slots[i] = null;
                continue;
            }

            _slots[i] = {
                ...rawSlot,
                sockets: _cloneSockets(rawSlot.sockets ?? [])
            };
        }
    }

    for (const slot of VALID_EQUIP_SLOTS) {
        _equipment[slot] = data.equipment?.[slot] ?? null;

        if (typeof _equipment[slot] === 'string') {
            _equipment[slot] = { itemId: _equipment[slot] };
        }

        if (_equipment[slot] && typeof _equipment[slot] === 'object') {
            _equipment[slot] = {
                ..._equipment[slot],
                sockets: _cloneSockets(_equipment[slot].sockets ?? [])
            };
        }
    }

    _gold = typeof data.gold === 'number' ? data.gold : 0;
}

export function addItem(itemId, qty = 1, meta = null) {
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
    let lastIndex = -1;

    while (remaining > 0) {
        const stackIdx = _findStackableSlot(itemId);
        if (stackIdx !== -1) {
            const space = def.stack - _slots[stackIdx].qty;
            const toAdd = Math.min(space, remaining);
            _slots[stackIdx].qty += toAdd;
            remaining -= toAdd;
            lastIndex = stackIdx;
            emit('itemAdded', { itemId, qty: toAdd, slotIndex: stackIdx });
        } else {
            const emptyIdx = _findEmptySlot();
            if (emptyIdx === -1) {
                console.warn('[inventory] inventoryFull em addItem — bag sem slot livre para', itemId,
                    '(vem de dar item/pickup/craft, NAO de equipar)');
                emit('inventoryFull', { itemId, source: 'addItem' });
                return false;
            }
            const toAdd = Math.min(def.stack, remaining);
            _slots[emptyIdx] = { itemId, qty: toAdd };

            if (meta?.refineLevel != null) {
                _slots[emptyIdx].refineLevel = meta.refineLevel;
            }

            if (Array.isArray(meta?.sockets) && meta.sockets.length > 0) {
                _slots[emptyIdx].sockets = _cloneSockets(meta.sockets);
            }
            remaining -= toAdd;
            lastIndex = emptyIdx;
            emit('itemAdded', { itemId, qty: toAdd, slotIndex: emptyIdx });
        }
    }

    return lastIndex;
}

export function removeItem(slotIndex, qty = 1) {
    const slot = _slots[slotIndex];
    if (!slot) return false;
    const removed = Math.min(slot.qty, qty);
    slot.qty -= removed;
    emit('itemRemoved', { itemId: slot.itemId, qty: removed, slotIndex });
    if (slot.qty <= 0) { _slots[slotIndex] = null; }
    return true;
}

export function useItem(slotIndex) {
    const slot = _slots[slotIndex];
    if (!slot) return false;
    const def = _catalogue[slot.itemId];
    if (!def || def.type !== 'consumable') return false;

    // Tratamento de ovos de pet (useEffect)
    if (def.useEffect === 'hatchPet') {
        const pool = ['pet_bolinha', 'pet_lobinho', 'pet_sininho', 'pet_pedrao'];
        const missing = pool.filter(id => !hasPet(id));
        if (missing.length === 0) {
            emit('uiHintShow', { msg: 'Você já possui todos os pets deste ovo!', duration: 3000 });
            return false;
        }
        let petId = null;
        for (let i = 0; i < 10; i++) {
            const rolled = pool[Math.floor(Math.random() * pool.length)];
            if (!hasPet(rolled)) { petId = rolled; break; }
        }
        if (!petId) petId = missing[Math.floor(Math.random() * missing.length)];
        addPet(petId);
        removeItem(slotIndex, 1);
        emit('petObtained', { petId });
        emit('itemUsed', { itemId: slot.itemId, slotIndex });
        return true;
    }

    if (def.useEffect === 'hatchFenix') {
        if (hasPet('pet_fenix_sombria')) {
            emit('uiHintShow', { msg: 'Você já possui a Fênix Sombria!', duration: 3000 });
            return false;
        }
        addPet('pet_fenix_sombria');
        removeItem(slotIndex, 1);
        emit('petObtained', { petId: 'pet_fenix_sombria' });
        emit('uiHintShow', { msg: 'Você obteve: Fênix Sombria!', duration: 3000 });
        emit('itemUsed', { itemId: slot.itemId, slotIndex });
        return true;
    }

    // Tratamento de consumíveis normais (effect)
    if (def.effect) {
        if (def.effect.type === 'heal') {
            emit('inventoryHealRequest', { amount: def.effect.amount });
        } else if (def.effect.type === 'restore_mp') {
            emit('inventoryRestoreMpRequest', { amount: def.effect.amount });
        } else if (def.effect.type === 'reset_stats') {
            emit('inventoryResetStatsRequest', {});
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
    if (!def) return false;

    const equipSlot = def.slot;
    if (!def.slot || !VALID_EQUIP_SLOTS.includes(def.slot)) return false;

    if (!canEquip(slot.itemId)) {
        emit('equipBlocked', { itemId: slot.itemId, reason: 'class' });
        return false;
    }

    const itemId = slot.itemId;
    const refineLevel = slot.refineLevel ?? 0;
    const sockets = _cloneSockets(slot.sockets ?? []);
    _slots[slotIndex] = null;

    if (_equipment[equipSlot] !== null) {
        const oldEquipObj = _equipment[equipSlot];
        const oldItemId = oldEquipObj?.itemId ?? (typeof oldEquipObj === 'string' ? oldEquipObj : null);
        const addedIndex = addItem(oldItemId, 1);

        if (addedIndex === false) {
            _slots[slotIndex] = { itemId, qty: 1, refineLevel };
            if (sockets.length > 0) {
                _slots[slotIndex].sockets = _cloneSockets(sockets);
            }
            console.warn('[inventory] inventoryFull em equipItem(swap) — nao devolveu a peca antiga', oldItemId,
                '| peca antiga no catalogo?', !!_catalogue[oldItemId], '| slot liberado?', _slots[slotIndex] == null);
            emit('inventoryFull', { itemId: oldItemId, source: 'equip-swap' });
            return false;
        }

        if (_slots[addedIndex]) {
            _slots[addedIndex].refineLevel = oldEquipObj?.refineLevel ?? 0;

            const oldSockets = _cloneSockets(oldEquipObj?.sockets ?? []);
            if (oldSockets.length > 0) {
                _slots[addedIndex].sockets = oldSockets;
            }
        }

        emit('itemUnequipped', { itemId: oldItemId, equipmentSlot: equipSlot });
    }

    _equipment[equipSlot] = { itemId, refineLevel };
    if (sockets.length > 0) {
        _equipment[equipSlot].sockets = _cloneSockets(sockets);
    }
    emit('itemEquipped', { itemId, equipmentSlot: equipSlot });

    if (def.effect) {
        emit('inventoryEquipBonusRequest', { stats: def.effect });
    }

    return true;
}

export function unequipItem(equipmentSlot) {
    if (!VALID_EQUIP_SLOTS.includes(equipmentSlot)) return false;

    const equipObj = _equipment[equipmentSlot];
    const itemId = equipObj?.itemId ?? (typeof equipObj === 'string' ? equipObj : null);
    if (!itemId) return false;

    const addedIndex = addItem(itemId, 1);
    if (addedIndex === false) {
        console.warn('[inventory] inventoryFull em unequipItem — bag sem espaço para devolver', itemId, 'slot', equipmentSlot);
        emit('inventoryFull', { itemId, source: 'unequip' });
        return false;
    }

    if (_slots[addedIndex]) {
    _slots[addedIndex].refineLevel = equipObj?.refineLevel ?? 0;

    const equipSockets = _cloneSockets(equipObj?.sockets ?? []);
    if (equipSockets.length > 0) {
        _slots[addedIndex].sockets = equipSockets;
    }
}

    _equipment[equipmentSlot] = null;
    emit('itemUnequipped', { itemId, equipmentSlot });
    return true;
}

export function getSlots() {
    return _slots.map(s => s ? { ...s } : null);
}

export function getEquipment() {
    const clone = {};
    for (const slot of VALID_EQUIP_SLOTS) {
        const equipObj = _equipment[slot];
        clone[slot] = equipObj
            ? {
                ...equipObj,
                sockets: _cloneSockets(equipObj.sockets ?? [])
            }
            : null;
    }
    return clone;
}

export function getGold() { return _gold; }

export function setGold(value) {
    const diff = value - _gold;
    _gold = value;
    emit('goldChanged', { amount: diff, total: _gold });
}

export function getItemDef(itemId) { return _catalogue[itemId]; }

/** Retorna cópia rasa do catálogo de itens (debug/listagem). @returns {Object} */
export function getCatalogue() { return { ..._catalogue }; }

/**
 * Valor-base de um item para venda (sellPrice, com fallback em value). 0 se sem preco.
 * @param {string} itemId
 * @returns {number}
 */
export function getSellValue(itemId) {
    const def = _catalogue[itemId];
    if (!def) return 0;
    return Number(def.sellPrice ?? def.value ?? 0);
}

/**
 * Preco de compra derivado (loja): round(valor-base * 2.5). Regra central de preco.
 * @param {string} itemId
 * @returns {number}
 */
export function getBuyPrice(itemId) {
    return Math.round(getSellValue(itemId) * 2.5);
}

export function setEquipRefineLevel(equipSlot, level) {
    if (!VALID_EQUIP_SLOTS.includes(equipSlot)) return false;
    if (!_equipment[equipSlot] || typeof _equipment[equipSlot] !== 'object') return false;
    _equipment[equipSlot].refineLevel = level;
    return true;
}
/**
 * Define uma carta em um socket de item equipado.
 * @param {string} equipSlot
 * @param {number} socketIndex
 * @param {string|null} cardId
 * @returns {boolean}
 */
export function setEquipCardSocket(equipSlot, socketIndex, cardId) {
    if (!VALID_EQUIP_SLOTS.includes(equipSlot)) return false;
    if (!Number.isInteger(socketIndex) || socketIndex < 0) return false;
    if (!_equipment[equipSlot] || typeof _equipment[equipSlot] !== 'object') return false;

    const sockets = _cloneSockets(_equipment[equipSlot].sockets ?? []);
    if (socketIndex >= sockets.length) return false;

    sockets[socketIndex] = cardId ?? null;
    _equipment[equipSlot].sockets = sockets;
    return true;
}
export function removeEquippedItem(equipSlot) {
    if (!VALID_EQUIP_SLOTS.includes(equipSlot)) return false;

    const equipObj = _equipment[equipSlot];
    const itemId = equipObj?.itemId ?? (typeof equipObj === 'string' ? equipObj : null);
    if (!itemId) return false;

    _equipment[equipSlot] = null;
    emit('itemUnequipped', { itemId, equipmentSlot: equipSlot });
    return true;
}

export function setSlotRefineLevel(slotIndex, level) {
    if (!_slots[slotIndex]) return false;
    _slots[slotIndex].refineLevel = level;
    return true;
}

export function removeSlotItem(slotIndex) {
    const slot = _slots[slotIndex];
    if (!slot) return false;

    const itemId = slot.itemId;
    const qty = slot.qty ?? 1;
    _slots[slotIndex] = null;
    emit('itemRemoved', { itemId, qty, slotIndex });
    return true;
}

export function serialize() {
    return {
        slots: _slots.map(s => s ? {
            ...s,
            sockets: _cloneSockets(s.sockets ?? [])
        } : null),
        equipment: Object.fromEntries(
            VALID_EQUIP_SLOTS.map(slot => [
                slot,
                _equipment[slot]
                    ? {
                        ..._equipment[slot],
                        sockets: _cloneSockets(_equipment[slot].sockets ?? [])
                    }
                    : null
            ])
        ),
        gold: _gold
    };
}