/**
 * @module equipment
 * @description Sistema de sets e bônus por threshold 2/3/4 para equipamentos.
 */

import { emit, on } from '../core/events.js';
import * as Inventory from './inventory.js';
import * as Classes from './classes.js';

const SET_PIECE_SLOTS = ['upper_headgear', 'armor', 'garment', 'footgear', 'weapon', 'shield', 'accessory_left', 'accessory_right'];

/** @type {Array<Object>} */
let _setsCatalogue = [];

/** @type {Object.<string, Object>} */
let _setsById = {};

/** @type {Object.<string, number>} */
let _lastPieceCounts = {};

/** @type {boolean} */
let _initialized = false;

/**
 * Normaliza objeto de stats-base.
 * @returns {{ str:number, agi:number, vit:number, int:number, dex:number, luk:number }}
 */
function _createEmptyStats() {
    return {
        str: 0,
        agi: 0,
        vit: 0,
        int: 0,
        dex: 0,
        luk: 0
    };
}

/**
 * Soma stats válidos no acumulador.
 * @param {{ str:number, agi:number, vit:number, int:number, dex:number, luk:number }} target
 * @param {Object|null|undefined} source
 */
function _addBaseStats(target, source) {
    if (!source) return;
    target.str += Number(source.str || 0);
    target.agi += Number(source.agi || 0);
    target.vit += Number(source.vit || 0);
    target.int += Number(source.int || 0);
    target.dex += Number(source.dex || 0);
    target.luk += Number(source.luk || 0);
}

/**
 * Formata a lista de slots equipados de um set.
 * @param {Object} equipment
 * @param {string[]} pieceSlots
 * @returns {string[]}
 */
function _getEquippedSlotsForSet(equipment, pieceSlots) {
    const equipped = [];

    for (const slotName of pieceSlots) {
        const equipObj = equipment[slotName];
        const itemId = equipObj?.itemId ?? (typeof equipObj === 'string' ? equipObj : null);
        if (!itemId) continue;

        const def = Inventory.getItemDef(itemId);
        if (!def || !def.setId) continue;

        equipped.push(slotName);
    }

    return equipped;
}

/**
 * Recalcula estado atual dos sets e emite eventos derivados.
 */
function _recalculateAndEmit() {
    const active = getActiveSetBonuses(null);

    emit('setBonusChanged', {
        active: active.sets,
        totalStats: { ...active.totalStats },
        hpPctBonus: active.hpPctBonus,
        mpPctBonus: active.mpPctBonus
    });

    const nextCounts = {};
    for (const setInfo of active.sets) {
        nextCounts[setInfo.setId] = setInfo.pieceCount;
    }

    for (const setDef of _setsCatalogue) {
        const setId = setDef.id;
        const prevCount = _lastPieceCounts[setId] ?? 0;
        const nextCount = nextCounts[setId] ?? 0;

        if (prevCount < 4 && nextCount >= 4) {
            emit('setAuraActivated', { setId });
            console.log(`[equipment] Aura set ${setId} ativa — SESSÃO 26: implementar mesh aura visual`);
        } else if (prevCount >= 4 && nextCount < 4) {
            emit('setAuraDeactivated', { setId });
        }
    }

    _lastPieceCounts = nextCounts;
}

/**
 * Registra catálogo de sets carregado de assets/data/sets.json.
 * @param {Array<Object>} setsArray
 */
export function setCatalogue(setsArray) {
    _setsCatalogue = Array.isArray(setsArray) ? setsArray.map(set => ({ ...set })) : [];
    _setsById = {};

    for (const set of _setsCatalogue) {
        _setsById[set.id] = set;
    }

    _lastPieceCounts = {};
}

/**
 * Retorna a definição de um set pelo id.
 * @param {string} setId
 * @returns {Object|null}
 */
export function getSetDef(setId) {
    return _setsById[setId] ?? null;
}

/**
 * Retorna todos os sets registrados.
 * @returns {Array<Object>}
 */
export function getAllSets() {
    return _setsCatalogue.map(set => ({ ...set }));
}

/**
 * Verifica se um item pode ser equipado pela classe informada.
 * classRestriction null/undefined aceita qualquer classe.
 * classRestriction string usa linhagem completa via reqJob.
 * @param {string} itemId
 * @param {string} playerClass
 * @returns {boolean}
 */
export function canEquip(itemId, playerClass) {
    const def = Inventory.getItemDef(itemId);
    if (!def) return false;
    if (def.classRestriction === null || def.classRestriction === undefined) return true;

    const lineage = Classes.getClassLineage(playerClass);
    if (typeof def.classRestriction === 'string') {
        return lineage.includes(def.classRestriction);
    }

    if (Array.isArray(def.classRestriction)) {
        return def.classRestriction.some(classId => lineage.includes(classId) || classId === playerClass);
    }

    return false;
}

/**
 * Retorna quantas peças equipadas do set informado o player possui.
 * @param {string} setId
 * @returns {number}
 */
export function getEquippedSetCount(setId) {
    const result = getActiveSetBonuses(null);
    const found = result.sets.find(set => set.setId === setId);
    return found ? found.pieceCount : 0;
}

/**
 * Calcula bônus ativos de sets e stats individuais das peças equipadas.
 * @param {Object|null} _player
 * @returns {{
 *   sets: Array<{ setId:string, name:string, tier:string, pieceCount:number, activeBonus:Object|null, allPieceSlots:string[], equippedSlots:string[] }>,
 *   totalStats: { str:number, agi:number, vit:number, int:number, dex:number, luk:number },
 *   hpPctBonus: number,
 *   mpPctBonus: number
 * }}
 */
export function getActiveSetBonuses(_player) {
    return getActiveSetBonusesFor(Inventory.getEquipment());
}

/**
 * Igual a getActiveSetBonuses, mas para um mapa de equipamento QUALQUER (não só o vivo).
 * Usado pelo preview de poder da tela do personagem (equipar hipotético sem alterar estado).
 * @param {Object} equipment - mapa slot -> {itemId, refineLevel, sockets}|null
 * @returns {{ sets:Array, totalStats:Object, hpPctBonus:number, mpPctBonus:number }}
 */
export function getActiveSetBonusesFor(equipment) {
    const grouped = {};
    const totalStats = _createEmptyStats();
    let hpPctBonus = 0;
    let mpPctBonus = 0;

    for (const slotName of SET_PIECE_SLOTS) {
        const equipObj = equipment[slotName];
        const itemId = equipObj?.itemId ?? (typeof equipObj === 'string' ? equipObj : null);
        if (!itemId) continue;

        const def = Inventory.getItemDef(itemId);
        if (!def) continue;

        if (def.stats) {
            _addBaseStats(totalStats, def.stats);
            hpPctBonus += Number(def.stats.hp_pct || 0);
            mpPctBonus += Number(def.stats.mp_pct || 0);
        }

        if (!def.setId) continue;

        if (!grouped[def.setId]) {
            const setDef = getSetDef(def.setId);
            grouped[def.setId] = {
                setId: def.setId,
                name: setDef?.name ?? def.setId,
                tier: setDef?.tier ?? 'normal',
                pieceCount: 0,
                activeBonus: null,
                allPieceSlots: Array.isArray(setDef?.pieceSlots) ? [...setDef.pieceSlots] : [...SET_PIECE_SLOTS],
                equippedSlots: []
            };
        }

        grouped[def.setId].pieceCount += 1;
        grouped[def.setId].equippedSlots.push(slotName);
    }

    const sets = Object.values(grouped)
        .filter(setInfo => setInfo.pieceCount >= 1)
        .map(setInfo => {
            const setDef = getSetDef(setInfo.setId);
            // Maior patamar de bonus cujo numero de pecas <= pecas equipadas.
            // Suporta qualquer conjunto de chaves (2/3/4/8...) sem cap fixo.
            const thresholds = Object.keys(setDef?.bonuses ?? {})
                .map(Number)
                .filter(n => n <= setInfo.pieceCount)
                .sort((a, b) => b - a);
            const activeBonus = thresholds.length ? (setDef.bonuses[String(thresholds[0])] ?? null) : null;

            if (activeBonus) {
                _addBaseStats(totalStats, activeBonus);
                hpPctBonus += Number(activeBonus.hp_pct || 0);
                mpPctBonus += Number(activeBonus.mp_pct || 0);
            }

            return {
                setId: setInfo.setId,
                name: setInfo.name,
                tier: setInfo.tier,
                pieceCount: setInfo.pieceCount,
                activeBonus,
                allPieceSlots: [...setInfo.allPieceSlots],
                equippedSlots: [...setInfo.equippedSlots]
            };
        });

    return {
        sets,
        totalStats,
        hpPctBonus,
        mpPctBonus
    };
}

/**
 * Inicializa listeners de atualização automática dos bônus de set.
 */
export function init() {
    if (_initialized) return;

    on('itemEquipped', () => {
        _recalculateAndEmit();
    });

    on('itemUnequipped', () => {
        _recalculateAndEmit();
    });

    // Auto-desequipe (troca de classe/load): recalcula o set-bonus para HP/MP refletirem.
    on('equipmentAutoUnequipped', () => {
        _recalculateAndEmit();
    });

    _initialized = true;
    _recalculateAndEmit();
}