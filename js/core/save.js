/**
 * @module save
 * @description Serializa/deserializa estado do jogo no LocalStorage com versionamento.
 * Dependências: events.js
 */

import { emit } from './events.js';

const STORAGE_KEY = 'lumiequest_save';

/**
 * v1 — PROMPT 0: schema base
 * v2 — PROMPT 3: adiciona bloco "player"
 * @type {number}
 */
const CURRENT_SAVE_VERSION = 3;

/** @type {Record<number, (data: Object) => Object>} */
const MIGRATIONS = {
    /**
     * v1 → v2: injeta bloco player padrão (swordman nível 1).
     * HP = 100 + vit(12)*5 = 160 | MP = 50 + int(5)*3 = 65
     */
    2: (data) => ({
        ...data,
        player: {
            name: 'Hero', class: 'swordman', level: 1, jobLevel: 1,
            exp: 0, jobExp: 0, hp: 160, maxHp: 160, mp: 65, maxMp: 65,
            baseStats: { str: 10, agi: 8, vit: 12, int: 5, dex: 7, luk: 5 },
            statPoints: 0, skillPoints: 0, learnedSkills: [],
            position: { x: 0, y: 0, z: 0 },
          currentMap: 'city01', playtime: 0,
        },
    }),/**
     * v2 → v3: cria bloco inventory (30 slots, equipment, gold) e migra zeny → inventory.gold.
     */
    3: (data) => {
        const goldFromZeny = (data.player && typeof data.player.zeny === 'number')
            ? data.player.zeny
            : 0;
        if (data.player) {
            data.player.inventory = {
                slots: new Array(30).fill(null),
                gold: goldFromZeny,
                equipment: { weapon: null, armor: null, accessory: null },
            };
            delete data.player.zeny;
        }
        return data;
    },
// v4 — PROMPT 13: setId e grade nos equipamentos
    // v5 — PROMPT 14: refineLevel nos equipamentos
    // v6 — PROMPT 15: cards[] e sockets nos equipamentos
    // v7 — PROMPT 16: bloco pets
};

/**
 * Carrega save existente, migra se necessário e emite saveLoaded.
 * @returns {void}
 */
export function init() {
    const raw = _readRaw();
    if (!raw) {
        emit('saveLoaded', null);
        return;
    }
    try {
        const migrated = migrateSave(raw);
        emit('saveLoaded', migrated);
        console.log(`[save] v${raw.saveVersion} carregado (atual: v${CURRENT_SAVE_VERSION})`);
    } catch (err) {
        console.error('[save] Falha ao migrar — resetando:', err);
        emit('saveFailed', { error: err });
    }
}

/**
 * Persiste SavedGame no LocalStorage.
 * @param {Object} data
 * @returns {void}
 */
export function save(data) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            ...data,
            saveVersion: CURRENT_SAVE_VERSION,
            lastSaved:   new Date().toISOString(),
        }));
    } catch (err) {
        console.error('[save] Falha ao salvar:', err);
        emit('saveFailed', { error: err });
    }
}

/**
 * Carrega e retorna save migrado, ou null.
 * @returns {Object|null}
 */
export function load() {
    const raw = _readRaw();
    if (!raw) return null;
    try { return migrateSave(raw); }
    catch (err) { console.error('[save] Falha ao carregar:', err); return null; }
}

/**
 * Remove save do LocalStorage.
 * @returns {void}
 */
export function deleteSave() {
    localStorage.removeItem(STORAGE_KEY);
    console.log('[save] Save deletado');
}

/**
 * Aplica migrações sequenciais até CURRENT_SAVE_VERSION.
 * Indexa sempre pelo nextVersion (destino) — nunca pela versão atual.
 * @param {Object} data
 * @returns {Object}
 */
export function migrateSave(data) {
    let current = { ...data };
    while (current.saveVersion < CURRENT_SAVE_VERSION) {
        const nextVersion = current.saveVersion + 1;
        const fn          = MIGRATIONS[nextVersion];
        if (!fn) throw new Error(
            `[save] MIGRATIONS[${nextVersion}] não encontrada. Adicione antes de incrementar CURRENT_SAVE_VERSION.`
        );
        console.log(`[save] Migrando v${current.saveVersion} → v${nextVersion}…`);
        current             = fn(current);
        current.saveVersion = nextVersion;
    }
    return current;
}

/**
 * Retorna CURRENT_SAVE_VERSION.
 * @returns {number}
 */
export function getCurrentVersion() {
    return CURRENT_SAVE_VERSION;
}

/** @returns {Object|null} */
function _readRaw() {
    try {
        const json = localStorage.getItem(STORAGE_KEY);
        return json ? JSON.parse(json) : null;
    } catch (err) {
        console.error('[save] JSON inválido no LocalStorage:', err);
        return null;
    }
}