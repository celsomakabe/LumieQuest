/**
 * @file refine.js
 * @description Sistema de refino de equipamentos com chance de sucesso, quebra,
 * penalidades e suporte a minérios auxiliares.
 */

import * as Events from '../core/events.js';
import {
    getSlots,
    getGold,
    setGold,
    removeItem,
    getItemDef,
    getEquipment,
    setEquipRefineLevel,
    removeEquippedItem,
    setSlotRefineLevel,
    removeSlotItem
} from './inventory.js';

/**
 * Inicializa listeners do sistema de refino.
 */
export function init() {
    return true;
}

/**
 * Retorna slot do inventário contendo itemId.
 * @param {string} itemId
 * @returns {{ index:number, slot:Object }|null}
 */
function _findInventoryItem(itemId) {
    const slots = getSlots();
    for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        if (slot?.itemId === itemId && (slot.qty ?? 0) > 0) {
            return { index: i, slot };
        }
    }
    return null;
}

/**
 * Lê alvo de refino.
 * @param {{type:'inventory', index:number}|{type:'equipment', slot:string}} target
 * @returns {{ ok:boolean, source?:string, slotData?:Object|null, itemDef?:Object|null, reason?:string }}
 */
function _resolveTarget(target) {
    if (!target || !target.type) {
        return { ok: false, reason: 'alvo-invalido' };
    }

    if (target.type === 'inventory') {
        const slots = getSlots();
        const slotData = slots[target.index];
        if (!slotData) return { ok: false, reason: 'slot-vazio' };

        const itemDef = getItemDef(slotData.itemId);
        if (!itemDef) return { ok: false, reason: 'item-invalido' };

        return { ok: true, source: 'inventory', slotData, itemDef };
    }

    if (target.type === 'equipment') {
        const equipment = getEquipment();
        const slotData = equipment[target.slot];
        if (!slotData) return { ok: false, reason: 'slot-vazio' };

        const itemId = slotData?.itemId ?? (typeof slotData === 'string' ? slotData : null);
        if (!itemId) return { ok: false, reason: 'item-invalido' };

        const itemDef = getItemDef(itemId);
        if (!itemDef) return { ok: false, reason: 'item-invalido' };

        const normalizedSlot = typeof slotData === 'string'
            ? { itemId: slotData, refineLevel: 0 }
            : slotData;

        return { ok: true, source: 'equipment', slotData: normalizedSlot, itemDef };
    }

    return { ok: false, reason: 'alvo-invalido' };
}

/**
 * Retorna true se o item pode ser refinado.
 * @param {Object|null} slot
 * @returns {{ ok:boolean, reason?:string }}
 */
export function canRefine(slot) {
    if (!slot?.itemId) return { ok: false, reason: 'slot-vazio' };

    const def = getItemDef(slot.itemId);
    if (!def) return { ok: false, reason: 'item-invalido' };

    if (def.type !== 'weapon' && def.type !== 'armor') {
        return { ok: false, reason: 'tipo-invalido' };
    }

    if ((slot.qty ?? 1) > 1) {
        return { ok: false, reason: 'item-stackado' };
    }

    const currentLevel = slot.refineLevel ?? 0;
    if (currentLevel >= 15) {
        return { ok: false, reason: 'refino-maximo' };
    }

    return { ok: true };
}

/**
 * Custo do próximo refino.
 * @param {number} currentLevel
 * @returns {{ ore:number, gold:number }}
 */
export function getRefineCost(currentLevel) {
    const level = Number(currentLevel ?? 0);
    return {
        ore: 1,
        gold: (level + 1) * 100
    };
}

/**
 * Chance base de sucesso do refino.
 * @param {number} currentLevel
 * @returns {number}
 */
export function getSuccessRate(currentLevel) {
    const level = Number(currentLevel ?? 0);

    if (level <= 3) return 1.00;
    if (level <= 6) return 0.75;
    if (level <= 9) return 0.50;
    if (level <= 12) return 0.30;
    return 0.15;
}

/**
 * Chance de quebra ao falhar.
 * @param {number} currentLevel
 * @returns {number}
 */
function _getBreakChance(currentLevel) {
    if (currentLevel <= 6) return 0;
    if (currentLevel <= 9) return 0.25;
    if (currentLevel <= 12) return 0.50;
    return 0.70;
}

/**
 * Bônus acumulado de refino.
 * @param {number} refineLevel
 * @returns {{ bonusPercent:number }}
 */
export function getRefineBonus(refineLevel) {
    const level = Math.max(0, Number(refineLevel ?? 0));
    let bonusPercent = 0;

    for (let i = 1; i <= level; i++) {
        if (i <= 3) bonusPercent += 0.05;
        else if (i <= 6) bonusPercent += 0.10;
        else if (i <= 9) bonusPercent += 0.15;
        else if (i <= 12) bonusPercent += 0.20;
        else bonusPercent += 0.25;
    }

    return { bonusPercent };
}

/**
 * Consome 1 unidade de um item material do inventário.
 * @param {string} itemId
 * @returns {boolean}
 */
function _consumeMaterial(itemId) {
    const found = _findInventoryItem(itemId);
    if (!found) return false;
    return removeItem(found.index, 1);
}

/**
 * Aplica nível de refino ao alvo.
 * @param {{type:'inventory', index:number}|{type:'equipment', slot:string}} target
 * @param {number} newLevel
 */
function _applyRefineLevel(target, newLevel) {
    if (target.type === 'inventory') {
        setSlotRefineLevel(target.index, newLevel);
        return;
    }

    if (target.type === 'equipment') {
        setEquipRefineLevel(target.slot, newLevel);
    }
}

/**
 * Remove item do alvo.
 * @param {{type:'inventory', index:number}|{type:'equipment', slot:string}} target
 */
function _destroyTargetItem(target) {
    if (target.type === 'inventory') {
        removeSlotItem(target.index);
        return;
    }

    if (target.type === 'equipment') {
        removeEquippedItem(target.slot);
    }
}

/**
 * Tenta refinar um item.
 * @param {{ type:'inventory', index:number }|{ type:'equipment', slot:string }} target
 * @param {{ useEnriched?:boolean, useProtector?:boolean, useBlessed?:boolean }} [options={}]
 * @returns {{
 *   ok:boolean,
 *   success:boolean,
 *   broke:boolean,
 *   blessed:boolean,
 *   protected:boolean,
 *   newLevel?:number,
 *   reason?:string
 * }}
 */
export function attemptRefine(target, options = {}) {
    const resolved = _resolveTarget(target);
    if (!resolved.ok) {
        return {
            ok: false,
            success: false,
            broke: false,
            blessed: false,
            protected: false,
            reason: resolved.reason
        };
    }

    const slotData = resolved.slotData;
    const itemDef = resolved.itemDef;
    const currentLevel = slotData.refineLevel ?? 0;

    const check = canRefine(slotData);
    if (!check.ok) {
        if (check.reason === 'refino-maximo') {
            Events.emit('refineMax', { itemId: slotData.itemId, level: currentLevel });
        }

        return {
            ok: false,
            success: false,
            broke: false,
            blessed: false,
            protected: false,
            reason: check.reason
        };
    }

    const cost = getRefineCost(currentLevel);
    const oreEntry = _findInventoryItem('minerio');
    if (!oreEntry || (oreEntry.slot.qty ?? 0) < cost.ore) {
        return {
            ok: false,
            success: false,
            broke: false,
            blessed: false,
            protected: false,
            reason: 'minerio-insuficiente'
        };
    }

    const gold = getGold();
    if (gold < cost.gold) {
        return {
            ok: false,
            success: false,
            broke: false,
            blessed: false,
            protected: false,
            reason: 'gold-insuficiente'
        };
    }

    const useEnriched = !!options.useEnriched;
    const useProtector = !!options.useProtector;
    const useBlessed = !!options.useBlessed;

    if (useEnriched) {
        const enriched = _findInventoryItem('minerio_enriquecido');
        if (!enriched) {
            return {
                ok: false,
                success: false,
                broke: false,
                blessed: false,
                protected: false,
                reason: 'minerio-enriquecido-insuficiente'
            };
        }
    }

    if (useProtector) {
        const protector = _findInventoryItem('minerio_protetor');
        if (!protector) {
            return {
                ok: false,
                success: false,
                broke: false,
                blessed: false,
                protected: false,
                reason: 'minerio-protetor-insuficiente'
            };
        }
    }

    if (useBlessed) {
        const blessed = _findInventoryItem('minerio_abencoado');
        if (!blessed) {
            return {
                ok: false,
                success: false,
                broke: false,
                blessed: false,
                protected: false,
                reason: 'minerio-abencoado-insuficiente'
            };
        }
    }

    _consumeMaterial('minerio');
    if (useEnriched) _consumeMaterial('minerio_enriquecido');
    if (useProtector) _consumeMaterial('minerio_protetor');
    if (useBlessed) _consumeMaterial('minerio_abencoado');
    setGold(gold - cost.gold);

    const successRate = Math.min(1, getSuccessRate(currentLevel) + (useEnriched ? 0.15 : 0));
    const roll = Math.random();

    if (roll < successRate) {
        const newLevel = currentLevel + 1;
        _applyRefineLevel(target, newLevel);

        console.log('SFX_STUB: sfx_refine_success');
        Events.emit('refineSuccess', {
            itemId: slotData.itemId,
            newLevel,
            target
        });

        return {
            ok: true,
            success: true,
            broke: false,
            blessed: false,
            protected: false,
            newLevel
        };
    }

    if (useBlessed) {
        console.log('SFX_STUB: sfx_refine_blessed');
        Events.emit('refineFail', {
            itemId: slotData.itemId,
            newLevel: currentLevel,
            broke: false,
            blessed: true,
            protected: false,
            target
        });

        return {
            ok: true,
            success: false,
            broke: false,
            blessed: true,
            protected: false,
            newLevel: currentLevel
        };
    }

    const breakChance = _getBreakChance(currentLevel);
    const breakRoll = Math.random();
    const willBreak = breakRoll < breakChance;

    if (willBreak && !useProtector) {
        _destroyTargetItem(target);

        console.log('SFX_STUB: sfx_refine_break');
        Events.emit('refineFail', {
            itemId: slotData.itemId,
            newLevel: 0,
            broke: true,
            blessed: false,
            protected: false,
            target
        });

        return {
            ok: true,
            success: false,
            broke: true,
            blessed: false,
            protected: false,
            newLevel: 0
        };
    }

    const downgradedLevel = Math.max(0, currentLevel - 1);
    _applyRefineLevel(target, downgradedLevel);

    if (willBreak && useProtector) {
        console.log('SFX_STUB: sfx_refine_protected');
        Events.emit('refineFail', {
            itemId: slotData.itemId,
            newLevel: downgradedLevel,
            broke: false,
            blessed: false,
            protected: true,
            target
        });

        return {
            ok: true,
            success: false,
            broke: false,
            blessed: false,
            protected: true,
            newLevel: downgradedLevel
        };
    }

    console.log('SFX_STUB: sfx_refine_fail');
    Events.emit('refineFail', {
        itemId: slotData.itemId,
        newLevel: downgradedLevel,
        broke: false,
        blessed: false,
        protected: false,
        target
    });

    return {
        ok: true,
        success: false,
        broke: false,
        blessed: false,
        protected: false,
        newLevel: downgradedLevel
    };
}