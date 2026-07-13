/**
 * @file recipes.js
 * @description Sistema de receitas de forja (craft das peças de set de classe).
 * As receitas vivem em assets/data/recipes.json (um dataset por arquivo, como
 * items.json/sets.json). Cada receita: item resultante + materiais (itemId+qty) +
 * custo em ouro. Só peças de set (com setId) são craftáveis; o consumo é atômico.
 * Comunicação com o resto do jogo via event bus (R8), exceto imports diretos de
 * inventory.js/classes.js (dependência de dados, análoga a refine.js).
 */

import { emit } from '../core/events.js';
import { getClassLineage } from './classes.js';
import {
    getSlots,
    getItemDef,
    getGold,
    setGold,
    addItem,
    removeItem,
    canEquip
} from './inventory.js';

/** @type {Array<{id:string,result:string,setId:string,tier:string,gold:number,materials:Array<{itemId:string,qty:number}>}>} */
let _recipes = [];
/** @type {Map<string, Object>} índice result → receita */
let _byResult = new Map();

/**
 * Inicializa o sistema (reservado para simetria com os demais módulos).
 * @returns {boolean}
 */
export function init() {
    return true;
}

/**
 * Recebe as receitas carregadas de recipes.json. Chamado por main.js após fetch.
 * @param {Array<Object>} list
 */
export function setRecipes(list) {
    _recipes = Array.isArray(list) ? list : [];
    _byResult = new Map(_recipes.map(r => [r.result, r]));
}

/** @returns {Array<Object>} cópia rasa de todas as receitas. */
export function getAllRecipes() {
    return _recipes.slice();
}

/**
 * @param {string} recipeId
 * @returns {Object|null}
 */
export function getRecipe(recipeId) {
    return _recipes.find(r => r.id === recipeId) || null;
}

/**
 * @param {string} itemId id do item resultante
 * @returns {Object|null}
 */
export function getRecipeForResult(itemId) {
    return _byResult.get(itemId) || null;
}

/**
 * Receitas craftáveis pela linha da classe (mesma regra do filtro da loja): o item
 * resultante é liberado se algum job do classRestriction estiver na LINHAGEM da classe.
 * Herança descendente: um evo forja o gear dos ancestrais; o contrário nunca.
 * @param {string} classId
 * @returns {Array<Object>}
 */
export function getRecipesForClass(classId) {
    if (!classId) return [];
    const lineage = getClassLineage(classId);
    return _recipes.filter(recipe => {
        const def = getItemDef(recipe.result);
        const cr = def?.classRestriction;
        if (cr == null || (Array.isArray(cr) && cr.length === 0)) return true;
        const list = Array.isArray(cr) ? cr : [cr];
        return list.some(c => lineage.includes(c));
    });
}

/**
 * Soma total de um itemId espalhado pelos slots.
 * @param {Array<Object|null>} slots
 * @param {string} itemId
 * @returns {number}
 */
function _countItem(slots, itemId) {
    let total = 0;
    for (const s of slots) {
        if (s && s.itemId === itemId) total += (s.qty ?? 0);
    }
    return total;
}

/**
 * Estado de craft para a UI: o que o jogador TEM vs. PRECISA (materiais + ouro),
 * validade de classe e se pode forjar agora.
 * @param {Object} recipe
 * @returns {{ materials:Array<{itemId,name,icon,need,have,ok}>, gold:{have,need,ok}, classOk:boolean, canCraft:boolean }}
 */
export function getCraftState(recipe) {
    const slots = getSlots();
    const gold = getGold();
    const materials = (recipe.materials || []).map(m => {
        const def = getItemDef(m.itemId);
        const have = _countItem(slots, m.itemId);
        return {
            itemId: m.itemId,
            name: def?.name ?? m.itemId,
            icon: def?.icon ?? '📦',
            need: m.qty,
            have,
            ok: have >= m.qty
        };
    });
    const goldOk = gold >= (recipe.gold || 0);
    const materialsOk = materials.every(m => m.ok);
    const classOk = canEquip(recipe.result);
    return {
        materials,
        gold: { have: gold, need: recipe.gold || 0, ok: goldOk },
        classOk,
        canCraft: goldOk && materialsOk && classOk
    };
}

/**
 * Prevê se sobrará slot para a peça resultante (stack 1 → exige 1 slot vazio).
 * Sem slot vazio, só há espaço se algum material for INTEGRALMENTE consumido (libera o slot).
 * @param {Array<Object|null>} slots
 * @param {Array<{itemId,qty}>} materials
 * @returns {boolean}
 */
function _willHaveRoom(slots, materials) {
    if (slots.some(s => s === null)) return true;
    return materials.some(m => _countItem(slots, m.itemId) === m.qty);
}

/**
 * Consome `qty` unidades de um material, possivelmente espalhadas por vários slots.
 * @param {string} itemId
 * @param {number} qty
 */
function _consume(itemId, qty) {
    let remaining = qty;
    const slots = getSlots();
    for (let i = 0; i < slots.length && remaining > 0; i++) {
        const s = slots[i];
        if (!s || s.itemId !== itemId) continue;
        const take = Math.min(s.qty ?? 0, remaining);
        if (take > 0) {
            removeItem(i, take);
            remaining -= take;
        }
    }
}

/**
 * Forja uma peça de set. Transação atômica: valida classe + materiais + ouro + espaço
 * ANTES de consumir; em qualquer falha, não consome nada. Emite craftSuccess/craftFailed.
 * @param {string} recipeId
 * @returns {{ ok:boolean, itemId?:string, reason?:string }}
 */
export function craft(recipeId) {
    const recipe = getRecipe(recipeId);
    if (!recipe) return { ok: false, reason: 'receita-invalida' };

    const def = getItemDef(recipe.result);
    if (!def || !def.setId) return { ok: false, reason: 'resultado-invalido' };

    // Classe: evo forja o gear do ancestral; o contrário nunca (regra de linhagem).
    if (!canEquip(recipe.result)) {
        emit('craftFailed', { recipeId, reason: 'classe' });
        return { ok: false, reason: 'classe' };
    }

    const slots = getSlots();

    for (const m of recipe.materials) {
        if (_countItem(slots, m.itemId) < m.qty) {
            emit('craftFailed', { recipeId, reason: 'materiais' });
            return { ok: false, reason: 'materiais' };
        }
    }

    if (getGold() < (recipe.gold || 0)) {
        emit('craftFailed', { recipeId, reason: 'ouro' });
        return { ok: false, reason: 'ouro' };
    }

    if (!_willHaveRoom(slots, recipe.materials)) {
        emit('craftFailed', { recipeId, reason: 'inventario-cheio' });
        return { ok: false, reason: 'inventario-cheio' };
    }

    // Compromisso: consome materiais + ouro e entrega a peça.
    for (const m of recipe.materials) _consume(m.itemId, m.qty);
    setGold(getGold() - (recipe.gold || 0));

    const added = addItem(recipe.result, 1);
    if (added === false) {
        // Salvaguarda: _willHaveRoom já garantiu espaço; reverte se algo escapou.
        for (const m of recipe.materials) addItem(m.itemId, m.qty);
        setGold(getGold() + (recipe.gold || 0));
        emit('craftFailed', { recipeId, reason: 'inventario-cheio' });
        return { ok: false, reason: 'inventario-cheio' };
    }

    emit('craftSuccess', { recipeId, itemId: recipe.result });
    return { ok: true, itemId: recipe.result };
}
