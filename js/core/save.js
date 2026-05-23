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
const CURRENT_SAVE_VERSION = 9;

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
    /**
     * v3 → v4: inicializa player.quests se ausente.
     */
    4: (save) => {
        if (!save.player.quests) {
            save.player.quests = {
                active:    {},
                completed: []
            };
        }
        return save;
    },

    /**
     * v4 → v5: adiciona player.equippedSkills (4 slots) e player.cooldowns.
     * Idempotente: não sobrescreve se já existir (newGame pode popular antes da migration).
     */
    5: (data) => {
        if (data.player) {
            if (!Array.isArray(data.player.equippedSkills)) {
                data.player.equippedSkills = [null, null, null, null];
            }
            if (!data.player.cooldowns || typeof data.player.cooldowns !== 'object') {
                data.player.cooldowns = {};
            }
}
        return data;
    },
    6: (data) => {
        if (data.player) {
            if (!Array.isArray(data.player.jobHistory)) {
                data.player.jobHistory = [];
            }
            if (!Array.isArray(data.player.jobChangeQuestsCompleted)) {
                data.player.jobChangeQuestsCompleted = [];
            }
        }
        return data;
    },
    /**
     * v6 → v7: adiciona player.title baseado na classe atual.
     */
    7: (data) => {
        if (data.player) {
            const titleByClass = {
                swordman: 'Espadachim',
                knight: 'Cavaleiro',
                lord_knight: 'Lorde Cavaleiro',
                mage: 'Mago',
                wizard: 'Bruxo',
                high_wizard: 'Grande Bruxo',
                archer: 'Arqueiro',
                hunter: 'Caçador',
                sniper: 'Atirador de Elite',
                assassin: 'Assassino',
                assassin_master: 'Mestre Assassino',
                shadow_assassin: 'Assassino das Sombras',
            };
            if (typeof data.player.title !== 'string' || data.player.title.trim() === '') {
                data.player.title = titleByClass[data.player.class] ?? '';
            }
        }
        return data;
    },
        /**
     * v7 → v8: expande equipment de 3 slots para 10 slots Ragnarok-completo.
     * weapon e armor mantêm nome. accessory vai para accessory_left.
     * Novos slots iniciam null.
     */
    8: (data) => {
        const eq = data.player?.inventory?.equipment ?? {};
        const newEq = {
            weapon: eq.weapon ?? null,
            shield: null,
            upper_headgear: null,
            mid_headgear: null,
            lower_headgear: null,
            armor: eq.armor ?? null,
            garment: null,
            footgear: null,
            accessory_left: eq.accessory ?? null,
            accessory_right: null
        };

        if (!data.player) data.player = {};
        if (!data.player.inventory) data.player.inventory = {};
        data.player.inventory.equipment = newEq;

        return data;
    },
    /**
     * v8 → v9: adiciona bloco player.pets para o Sistema de Pets.
     */
    9: (data) => {
        if (!data.player) data.player = {};
        if (!data.player.pets || typeof data.player.pets !== 'object') {
            data.player.pets = {
                collection: [],
                summonedIndex: null
            };
        }
        return data;
    },
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
 * Retorna CURRENT_SAVE_VERSION (9).
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