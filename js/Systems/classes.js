/**
 * @module classes
 * @description Atributos base por job. Stub mínimo — PROMPT 10 completa.
 * Dependências: events.js
 */

import { emit } from '../core/events.js';

/** @type {Record<string, {str:number,agi:number,vit:number,int:number,dex:number,luk:number}>} */
const _baseStatsByJob = {
    swordman:        { str: 10, agi: 8,  vit: 12, int: 5,  dex: 7,  luk: 5  },
    knight:          { str: 14, agi: 9,  vit: 15, int: 5,  dex: 8,  luk: 5  },
    lord_knight:     { str: 18, agi: 11, vit: 18, int: 5,  dex: 10, luk: 6  },
    mage:            { str: 4,  agi: 6,  vit: 6,  int: 15, dex: 10, luk: 6  },
    wizard:          { str: 4,  agi: 7,  vit: 7,  int: 20, dex: 12, luk: 7  },
    high_wizard:     { str: 5,  agi: 8,  vit: 8,  int: 26, dex: 15, luk: 8  },
    archer:          { str: 7,  agi: 14, vit: 7,  int: 6,  dex: 15, luk: 8  },
    hunter:          { str: 8,  agi: 16, vit: 8,  int: 7,  dex: 18, luk: 9  },
    sniper:          { str: 9,  agi: 19, vit: 9,  int: 8,  dex: 22, luk: 11 },
    assassin:        { str: 11, agi: 15, vit: 8,  int: 5,  dex: 10, luk: 12 },
    assassin_master: { str: 13, agi: 18, vit: 9,  int: 6,  dex: 12, luk: 15 },
    shadow_assassin: { str: 15, agi: 22, vit: 10, int: 7,  dex: 14, luk: 18 },
};

/**
 * Inicializa o módulo de classes.
 * @returns {void}
 */
export function init() {
    // PROMPT 10: carregar ClassData do save e registrar listeners de levelUp
}

/**
 * Retorna atributos base de um job em determinado nível.
 * Bônus linear: +1 em todos os stats a cada 10 níveis.
 * @param {string} job
 * @param {number} level
 * @returns {{ str:number, agi:number, vit:number, int:number, dex:number, luk:number }}
 */
export function getBaseStats(job, level) {
    const base  = _baseStatsByJob[job] ?? _baseStatsByJob['swordman'];
    const bonus = Math.floor((level - 1) / 10);
    return {
        str: base.str + bonus,
        agi: base.agi + bonus,
        vit: base.vit + bonus,
        int: base.int + bonus,
        dex: base.dex + bonus,
        luk: base.luk + bonus,
    };
}

/**
 * Retorna skills disponíveis para um job.
 * @param {string} _job
 * @returns {Array}
 */
export function getSkills(_job) {
    // PROMPT 10: implementar árvore de skills por job
    return [];
}

/**
 * Verifica requisitos de job change.
 * @param {Object} _playerData
 * @returns {boolean}
 */
export function canJobChange(_playerData) {
    // PROMPT 10: verificar jobLevel mínimo e quests de pré-requisito
    return false;
}

/**
 * Executa troca de job.
 * @param {Object} _playerData
 * @param {string} targetJob
 * @returns {void}
 */
export function doJobChange(_playerData, targetJob) {
    // PROMPT 10: reset de skills, recalcular stats, persistir no save
    emit('jobChanged', { newJob: targetJob });
}