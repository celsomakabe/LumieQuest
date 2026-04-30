/**
 * save.js — Persistência do estado do jogo via localStorage.
 * Gerencia serialização, versionamento e migração de saves.
 */

import * as events from './events.js';

/** Versão atual do schema de save. Incrementar a cada mudança de schema. */
export const CURRENT_SAVE_VERSION = 1;

/**
 * Mapa de funções de migração. Chave = versão DESTINO.
 * Vazio agora — salvo inicial é v1 e não precisa migrar para si mesmo.
 * Primeira entrada real será MIGRATIONS[2], adicionada no PROMPT 13.
 * @type {Object.<number, function(Object): Object>}
 */
export const MIGRATIONS = {};

/** Chave usada no localStorage para persistência */
const STORAGE_KEY = 'lumiequest_save';

/**
 * Inicializa o módulo de save.
 * Se houver save existente no localStorage, emite 'saveLoaded'.
 */
export function init() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const data = migrateSave(JSON.parse(raw));
      events.emit('saveLoaded', data);
    } catch (err) {
      console.warn('[save] Save corrompido ou ilegível. Ignorando.', err);
    }
  }
}

/**
 * Serializa e persiste o estado completo no localStorage.
 * Adiciona saveVersion e lastSaved automaticamente.
 * @param {Object} data - Estado completo do jogo (estrutura SavedGame)
 */
export function save(data) {
  const payload = {
    ...data,
    saveVersion: CURRENT_SAVE_VERSION,
    lastSaved: new Date().toISOString(),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.error('[save] Falha ao salvar (localStorage cheio?).', err);
  }
}

/**
 * Carrega o save do localStorage, aplica migração e retorna o objeto.
 * @returns {Object|null} Estado migrado, ou null se não houver save
 */
export function load() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return migrateSave(JSON.parse(raw));
  } catch (err) {
    console.warn('[save] Falha ao carregar save.', err);
    return null;
  }
}

/**
 * Remove o save do localStorage permanentemente.
 */
export function deleteSave() {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Migra dados de versão anterior até CURRENT_SAVE_VERSION.
 * Loop encadeado: aplica MIGRATIONS[nextVersion] até atingir a versão atual.
 * Se MIGRATIONS[nextVersion] não existir, interrompe com erro (não silencia bugs).
 * @param {Object} rawData - Objeto do save em qualquer versão
 * @returns {Object} Objeto migrado para CURRENT_SAVE_VERSION
 */
export function migrateSave(rawData) {
  let current = { ...rawData };

  // Garante que saveVersion existe (segurança para saves muito antigos)
  if (typeof current.saveVersion !== 'number') {
    current.saveVersion = 1;
  }

  while (current.saveVersion < CURRENT_SAVE_VERSION) {
    const nextVersion = current.saveVersion + 1;
    if (typeof MIGRATIONS[nextVersion] !== 'function') {
      console.error(
        `[save] Migração v${current.saveVersion}→v${nextVersion} não encontrada. ` +
        `Verifique MIGRATIONS[${nextVersion}] em save.js.`
      );
      break;
    }
    current = MIGRATIONS[nextVersion](current);
    current.saveVersion = nextVersion;
  }

  return current;
}

/**
 * Retorna a constante CURRENT_SAVE_VERSION.
 * @returns {number}
 */
export function getCurrentVersion() {
  return CURRENT_SAVE_VERSION;
}
