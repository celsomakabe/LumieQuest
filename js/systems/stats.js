/**
 * @file stats.js
 * @description Fonte ÚNICA de verdade dos stats FINAIS do player (str/agi/vit/int/dex/luk):
 * base (baseStats) + equipamento + refino + cartas + bônus de set + pet.
 *
 * Por que aqui (camada systems, R7): combat.js e classes.js precisam dos stats finais e
 * NÃO devem importar player.js (baixo nível). Este módulo agrega os bônus lendo os
 * sistemas donos de cada fonte (equipment/cards/pets/refine/inventory) e é consumido por
 * combat.js. Acoplamento só via imports diretos de dados (análogo a refine.js) + event
 * bus (R8) para invalidar o cache.
 *
 * IMPORTANTE (não-duplicação): HP/MP continuam calculados em player.js (_calcMaxHp/Mp),
 * que já somam base+set+carta+pet para vit→HP e int→MP. Este módulo NÃO alimenta HP/MP —
 * ele só entrega os 6 atributos finais para o dano de combate. São consumidores distintos,
 * então não há contagem em dobro.
 *
 * R6 (60fps): getFinalStats é chamado a cada ataque/skill. O bônus do player é cacheado e
 * só recomputado (lazy) quando algum evento de mudança invalida o cache.
 */

import { on } from '../core/events.js';
import * as Equipment from './equipment.js';
import * as Cards from './cards.js';
import * as Pets from './pets.js';
import { getRefineBonus } from './refine.js';
import { getEquipment, getItemDef } from './inventory.js';

/** @type {string[]} Os 6 atributos primários. */
const STAT_KEYS = ['str', 'agi', 'vit', 'int', 'dex', 'luk'];

/**
 * Cache do bônus TOTAL não-base do player (equip+set+refino+carta+pet). null = sujo.
 * @type {{ str:number, agi:number, vit:number, int:number, dex:number, luk:number }|null}
 */
let _playerBonusCache = null;

/** @returns {{str:number,agi:number,vit:number,int:number,dex:number,luk:number}} */
function _emptyStats() {
    return { str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0 };
}

/**
 * Recomputa do zero o bônus não-base do player somando todas as fontes.
 * @returns {{str:number,agi:number,vit:number,int:number,dex:number,luk:number}}
 */
function _computePlayerBonus() {
    const total = _emptyStats();

    // Equipamento (stats das peças) + limiares de set — já somados por equipment.js.
    const setBonus = Equipment.getActiveSetBonuses?.() ?? { totalStats: {} };
    for (const k of STAT_KEYS) total[k] += Number(setBonus.totalStats?.[k] || 0);

    // Refino: % do getRefineBonus aplicado aos stats da PRÓPRIA peça equipada (finalmente
    // consome o refino, que hoje era decorativo). Só peças com `stats` e refineLevel > 0.
    const equip = getEquipment();
    for (const slot of Object.keys(equip)) {
        const eq = equip[slot];
        const itemId = eq?.itemId ?? (typeof eq === 'string' ? eq : null);
        if (!itemId) continue;
        const lvl = Number(eq?.refineLevel || 0);
        if (lvl <= 0) continue;
        const def = getItemDef(itemId);
        if (!def?.stats) continue;
        const pct = Number(getRefineBonus(lvl)?.bonusPercent || 0);
        if (pct <= 0) continue;
        for (const k of STAT_KEYS) {
            if (def.stats[k]) total[k] += Number(def.stats[k]) * pct;
        }
    }

    // Cartas encaixadas nos sockets.
    const cardBonus = Cards.getCardBonuses?.() ?? { stats: {} };
    for (const k of STAT_KEYS) total[k] += Number(cardBonus.stats?.[k] || 0);

    // Pet invocado (só as chaves que casam com os 6 atributos; maxHp/def/atk/… ficam de
    // fora — esses alimentam HP/MP/outros via player.js, não os atributos).
    const petBonus = Pets.getPetBonuses?.() ?? {};
    for (const k of STAT_KEYS) total[k] += Number(petBonus[k] || 0);

    // Refino pode gerar fração — normaliza para inteiro (piso).
    for (const k of STAT_KEYS) total[k] = Math.floor(total[k]);

    return total;
}

/** @returns {{str:number,agi:number,vit:number,int:number,dex:number,luk:number}} */
function _getPlayerBonus() {
    if (_playerBonusCache === null) _playerBonusCache = _computePlayerBonus();
    return _playerBonusCache;
}

/**
 * Invalida o cache de bônus do player (recomputa lazy no próximo getFinalStats).
 * @returns {void}
 */
export function invalidate() {
    _playerBonusCache = null;
}

/**
 * Registra a invalidação do cache via event bus. Idempotente.
 * @returns {boolean}
 */
export function init() {
    const bust = () => { _playerBonusCache = null; };
    // Equipar / desequipar (inclui auto-desequipe por classe).
    on('itemEquipped', bust);
    on('itemUnequipped', bust);
    on('equipmentAutoUnequipped', bust);
    // Recalculo de set (equipment.js reemite ao equipar/desequipar).
    on('setBonusChanged', bust);
    // Cartas nos sockets.
    on('cardBonusChanged', bust);
    // Pet invocado/trocado/upado.
    on('petBonusChanged', bust);
    // Refino: sucesso ou falha muda o refineLevel.
    on('refineSuccess', bust);
    on('refineFail', bust);
    // Job change pode zerar peças por classRestriction.
    on('jobChanged', bust);
    // Alocação/reset de pontos de status (Etapa C) — a UI/preview lê stats finais.
    on('statPointsChanged', bust);
    return true;
}

/**
 * Detecta MONSTRO por marca confiável (monstros têm monsterId; muitos também type
 * 'monster'/isBoss). O player não tem nenhuma dessas. Detectar o MONSTRO (e não o player)
 * é robusto: se o objeto do player chegar sem `type` por algum caminho (pendência antiga),
 * ele NÃO é confundido com monstro e continua recebendo o gear.
 * @param {Object} entity
 * @returns {boolean}
 */
function _isMonster(entity) {
    return !!entity && (entity.monsterId != null || entity.type === 'monster' || entity.isBoss === true);
}

/**
 * Stats FINAIS de uma entidade. MONSTRO (sem equipamento) → baseStats cru. Qualquer
 * atacante NÃO-monstro (o player) → baseStats + bônus de gear/refino/carta/set/pet.
 *
 * IMPORTANTE: a detecção é pelo MONSTRO, não por `type === 'player'`. Antes o default era o
 * ramo do monstro; se o objeto do player chegasse sem `type`, o gear era ignorado em
 * silêncio e a espada divina batia igual à mão vazia (bug da Sessão 36B). Agora só quem é
 * comprovadamente monstro cai no cru.
 * @param {{ type?:string, monsterId?:string, isBoss?:boolean, baseStats?:Object }} entity
 * @returns {{ str:number, agi:number, vit:number, int:number, dex:number, luk:number }}
 */
export function getFinalStats(entity) {
    const base = entity?.baseStats ?? {};

    if (_isMonster(entity)) {
        return {
            str: Number(base.str || 0), agi: Number(base.agi || 0), vit: Number(base.vit || 0),
            int: Number(base.int || 0), dex: Number(base.dex || 0), luk: Number(base.luk || 0),
        };
    }

    // allocatedStats (Etapa C): pontos distribuídos, guardados SEPARADOS do base da classe.
    // Entram aqui UMA vez (o base cru fica no baseStats; o gear no cache). Sem dupla contagem.
    const alloc = entity?.allocatedStats ?? {};
    const bonus = _getPlayerBonus();
    const out = {};
    for (const k of STAT_KEYS) out[k] = Number(base[k] || 0) + Number(alloc[k] || 0) + Number(bonus[k] || 0);
    return out;
}

/**
 * Atalho para um único atributo final.
 * @param {Object} entity
 * @param {string} name - str|agi|vit|int|dex|luk
 * @returns {number}
 */
export function getStat(entity, name) {
    return getFinalStats(entity)[name] ?? 0;
}

/**
 * [DEBUG] Instrumentação: devolve o bônus do player QUEBRADO por fonte, exatamente como
 * este módulo o enxerga (usando SUAS próprias imports de Equipment/Cards/Pets/Refine/
 * Inventory). Serve para ver onde a cadeia quebra no jogo real, sem mock.
 * @returns {Object}
 */
export function getBreakdown() {
    const setBonus = Equipment.getActiveSetBonuses?.() ?? null;

    const equip = getEquipment();
    const pieces = [];
    const refine = _emptyStats();
    for (const slot of Object.keys(equip)) {
        const eq = equip[slot];
        const itemId = eq?.itemId ?? (typeof eq === 'string' ? eq : null);
        if (!itemId) continue;
        const def = getItemDef(itemId);
        const lvl = Number(eq?.refineLevel || 0);
        const pct = lvl > 0 ? Number(getRefineBonus(lvl)?.bonusPercent || 0) : 0;
        pieces.push({
            slot, itemId, refineLevel: lvl,
            defFound: !!def, hasStats: !!def?.stats,
            stats: def?.stats ?? null, refinePct: pct,
        });
        if (def?.stats && pct > 0) {
            for (const k of STAT_KEYS) if (def.stats[k]) refine[k] += Number(def.stats[k]) * pct;
        }
    }
    for (const k of STAT_KEYS) refine[k] = Math.floor(refine[k]);

    return {
        cacheDirty: _playerBonusCache === null,
        cachedBonus: _playerBonusCache,
        equipmentTotalStats: setBonus?.totalStats ?? null,
        equipmentSets: (setBonus?.sets ?? []).map(s => ({
            setId: s.setId, pieceCount: s.pieceCount, activeBonus: s.activeBonus,
        })),
        pieces,
        refineBonus: refine,
        cardBonus: Cards.getCardBonuses?.() ?? null,
        petBonus: Pets.getPetBonuses?.() ?? null,
        recomputedTotal: _computePlayerBonus(),
    };
}
