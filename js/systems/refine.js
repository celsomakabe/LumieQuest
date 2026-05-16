/**
 * @file refine.js
 * @description Sistema de refino para itens do inventário e equipamentos.
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

const MAX_REFINE_LEVEL = 15;
const BREAK_CHANCE_AT_10_PLUS_FAIL = 0.05;

/**
 * Inicializa o sistema de refino.
 * @returns {void}
 */
export function init() {
    // Sem listeners obrigatórios nesta parte.
}

/**
 * Retorna true se o item pode ser refinado.
 * @param {{ itemId?: string, qty?: number, refineLevel?: number }|null} slot
 * @returns {{ ok: boolean, reason: string|null, itemDef: Object|null, refineLevel: number }}
 */
export function canRefine(slot) {
    if (!slot || !slot.itemId) {
        return { ok: false, reason: 'slot_empty', itemDef: null, refineLevel: 0 };
    }

    const itemDef = getItemDef(slot.itemId);
    if (!itemDef) {
        return { ok: false, reason: 'item_invalid', itemDef: null, refineLevel: 0 };
    }

    if (itemDef.type !== 'weapon' && itemDef.type !== 'armor') {
        return { ok: false, reason: 'item_not_refinable', itemDef, refineLevel: slot.refineLevel ?? 0 };
    }

    if ((slot.qty ?? 1) !== 1) {
        return { ok: false, reason: 'stack_not_supported', itemDef, refineLevel: slot.refineLevel ?? 0 };
    }

    const refineLevel = Number(slot.refineLevel ?? 0);
    if (refineLevel >= MAX_REFINE_LEVEL) {
        return { ok: false, reason: 'max_refine_reached', itemDef, refineLevel };
    }

    return { ok: true, reason: null, itemDef, refineLevel };
}

/**
 * Retorna custo da tentativa com base no nível atual.
 * @param {number} refineLevel
 * @returns {{ ore: number, gold: number }}
 */
export function getRefineCost(refineLevel) {
    const level = Number(refineLevel ?? 0);
    return {
        ore: 1,
        gold: (level + 1) * 100
    };
}

/**
 * Retorna chance de sucesso da tentativa.
 * @param {number} refineLevel
 * @returns {number}
 */
export function getSuccessRate(refineLevel) {
    const level = Number(refineLevel ?? 0);

    if (level <= 3) return 1.00;
    if (level <= 6) return 0.80;
    if (level <= 9) return 0.60;
    if (level <= 12) return 0.40;
    return 0.20;
}

/**
 * Retorna bônus percentual acumulado do refino.
 * @param {number} refineLevel
 * @returns {{ bonusPercent: number }}
 */
export function getRefineBonus(refineLevel) {
    const level = Math.max(0, Number(refineLevel ?? 0));
    let bonusPercent = 0;

    for (let i = 1; i <= level; i++) {
        if (i <= 3) {
            bonusPercent += 0.05;
        } else if (i <= 6) {
            bonusPercent += 0.10;
        } else if (i <= 9) {
            bonusPercent += 0.15;
        } else if (i <= 12) {
            bonusPercent += 0.20;
        } else {
            bonusPercent += 0.25;
        }
    }

    return { bonusPercent };
}

/**
 * Tenta refinar um item do inventário ou equipamento.
 * @param {{ type: 'inventory', index: number } | { type: 'equipment', slot: string }} target
 * @returns {{
 *   ok: boolean,
 *   success: boolean,
 *   broke: boolean,
 *   reason: string|null,
 *   oldLevel: number,
 *   newLevel: number,
 *   itemId: string|null,
 *   target: { type: 'inventory', index: number } | { type: 'equipment', slot: string } | null
 * }}
 */
export function attemptRefine(target) {
    const resolved = _resolveTarget(target);
    if (!resolved.ok) {
        return {
            ok: false,
            success: false,
            broke: false,
            reason: resolved.reason,
            oldLevel: 0,
            newLevel: 0,
            itemId: null,
            target: null
        };
    }

    const validation = canRefine(resolved.slotData);
    if (!validation.ok) {
        return {
            ok: false,
            success: false,
            broke: false,
            reason: validation.reason,
            oldLevel: validation.refineLevel ?? 0,
            newLevel: validation.refineLevel ?? 0,
            itemId: resolved.slotData?.itemId ?? null,
            target
        };
    }

    const oldLevel = validation.refineLevel;
    const itemId = resolved.slotData.itemId;
    const cost = getRefineCost(oldLevel);

    const oreIndex = _findOreSlotIndex();
    if (oreIndex < 0) {
        return {
            ok: false,
            success: false,
            broke: false,
            reason: 'missing_ore',
            oldLevel,
            newLevel: oldLevel,
            itemId,
            target
        };
    }

    const currentGold = getGold();
    if (currentGold < cost.gold) {
        return {
            ok: false,
            success: false,
            broke: false,
            reason: 'insufficient_gold',
            oldLevel,
            newLevel: oldLevel,
            itemId,
            target
        };
    }

    removeItem(oreIndex, 1);
    setGold(currentGold - cost.gold);
    console.log('SFX_STUB: sfx_refine_hammer');

    const successRate = getSuccessRate(oldLevel);
    const roll = Math.random();

    if (roll < successRate) {
        const newLevel = oldLevel + 1;
        _setTargetRefineLevel(target, newLevel);

        console.log('SFX_STUB: sfx_refine_success');

        if (newLevel === MAX_REFINE_LEVEL) {
            console.log('SFX_STUB: sfx_refine_max');
            Events.emit('refineMax', { itemId, refineLevel: newLevel, target });
        }

        Events.emit('refineSuccess', {
            itemId,
            oldLevel,
            newLevel,
            target
        });

        return {
            ok: true,
            success: true,
            broke: false,
            reason: null,
            oldLevel,
            newLevel,
            itemId,
            target
        };
    }

    if (oldLevel >= 10 && Math.random() < BREAK_CHANCE_AT_10_PLUS_FAIL) {
        _breakTargetItem(target);
        console.log('SFX_STUB: sfx_refine_fail_break');

        Events.emit('refineFail', {
            itemId,
            oldLevel,
            newLevel: 0,
            broke: true,
            target
        });

        return {
            ok: true,
            success: false,
            broke: true,
            reason: 'item_broken',
            oldLevel,
            newLevel: 0,
            itemId,
            target
        };
    }

    const downgradedLevel = Math.max(0, oldLevel - 1);
    _setTargetRefineLevel(target, downgradedLevel);
    console.log('SFX_STUB: sfx_refine_fail_minor');

    Events.emit('refineFail', {
        itemId,
        oldLevel,
        newLevel: downgradedLevel,
        broke: false,
        target
    });

    return {
        ok: true,
        success: false,
        broke: false,
        reason: 'refine_failed',
        oldLevel,
        newLevel: downgradedLevel,
        itemId,
        target
    };
}

/**
 * Resolve alvo de refino.
 * @param {{ type: 'inventory', index: number } | { type: 'equipment', slot: string }} target
 * @returns {{ ok: boolean, reason: string|null, slotData: Object|null }}
 */
function _resolveTarget(target) {
    if (!target || typeof target !== 'object') {
        return { ok: false, reason: 'invalid_target', slotData: null };
    }

    if (target.type === 'inventory') {
        const slots = getSlots();
        const slotData = slots?.[target.index] ?? null;
        return { ok: true, reason: null, slotData };
    }

    if (target.type === 'equipment') {
        const equipment = getEquipment();
        const slotData = equipment?.[target.slot] ?? null;
        return { ok: true, reason: null, slotData };
    }

    return { ok: false, reason: 'invalid_target_type', slotData: null };
}

/**
 * Procura slot de minério.
 * @returns {number}
 */
function _findOreSlotIndex() {
    const slots = getSlots();
    for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        if (slot?.itemId === 'minerio' && (slot.qty ?? 0) > 0) {
            return i;
        }
    }
    return -1;
}

/**
 * Atualiza refineLevel do alvo.
 * @param {{ type: 'inventory', index: number } | { type: 'equipment', slot: string }} target
 * @param {number} refineLevel
 * @returns {void}
 */
function _setTargetRefineLevel(target, refineLevel) {
    if (target.type === 'inventory') {
        setSlotRefineLevel(target.index, refineLevel);
        return;
    }

    if (target.type === 'equipment') {
        setEquipRefineLevel(target.slot, refineLevel);
    }
}

/**
 * Remove item quebrado do alvo.
 * @param {{ type: 'inventory', index: number } | { type: 'equipment', slot: string }} target
 * @returns {void}
 */
function _breakTargetItem(target) {
    if (target.type === 'inventory') {
        removeSlotItem(target.index);
        return;
    }

    if (target.type === 'equipment') {
        removeEquippedItem(target.slot);
    }
}