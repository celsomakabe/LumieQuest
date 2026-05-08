/**
 * @module quests
 * @description Sistema de quests do LumieQuest.
 * Gerencia ciclo de vida: aceitar, progredir, completar e abandonar quests.
 * Comunica-se exclusivamente via event bus (R8).
 */

import * as Events from '../core/events.js';


// ─── Estado interno ───────────────────────────────────────────────────────────

/** @type {QuestDefinition[]} */
let _definitions = [];

/** @type {{ [questId: string]: ActiveQuest }} */
let _active = {};

/** @type {string[]} */
let _completed = [];

// ─── Tipos (JSDoc) ────────────────────────────────────────────────────────────

/**
 * @typedef {Object} QuestObjective
 * @property {string} id
 * @property {'kill'|'gather'|'reach'} type
 * @property {string} target
 * @property {string} label
 * @property {number} required
 * @property {{ x: number, z: number }} [position]
 * @property {number} [radius]
 */

/**
 * @typedef {Object} QuestDefinition
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {string} giver
 * @property {string} completer
 * @property {QuestObjective[]} objectives
 * @property {{ exp: number, gold: number, items?: {itemId:string, qty:number}[] }} rewards
 */

/**
 * @typedef {Object} ActiveQuest
 * @property {string} questId
 * @property {{ [objectiveId: string]: number }} progress
 * @property {number} startedAt
 */

// ─── Helpers privados ─────────────────────────────────────────────────────────

/**
 * Retorna a definição de uma quest pelo id.
 * @param {string} questId
 * @returns {QuestDefinition|undefined}
 */
function _getDef(questId) {
  return _definitions.find(q => q.id === questId);
}

/**
 * Avança o progresso de um objetivo e emite eventos de progresso / completável.
 * @param {string} questId
 * @param {string} objectiveId
 * @param {number} [amount=1]
 */
function _advance(questId, objectiveId, amount = 1) {
  const active = _active[questId];
  if (!active) return;

  const quest = _getDef(questId);
  if (!quest) return;

  const obj = quest.objectives.find(o => o.id === objectiveId);
  if (!obj) return;

  const current = active.progress[objectiveId] ?? 0;
  if (current >= obj.required) return; // já completo

  const next = Math.min(current + amount, obj.required);
  active.progress[objectiveId] = next;

  Events.emit('questProgress', {
    questId,
    objectiveId,
    current: next,
    required: obj.required,
    quest
  });

  if (isCompletable(questId)) {
    Events.emit('questCompletable', { questId, quest });
  }
}

// ─── Listeners de eventos ─────────────────────────────────────────────────────

/**
 * Processa morte de entidade — avança objetivos do tipo 'kill'.
 * @param {{ entity: { type: string } }} payload
 */
function _onMonsterDied({ monsterId }) {
  if (!monsterId) return;
  for (const questId of Object.keys(_active)) {
    const quest = _getDef(questId);
    if (!quest) continue;
    for (const obj of quest.objectives) {
      if (obj.type === 'kill' && obj.target === monsterId) {
        _advance(questId, obj.id);
      }
    }
  }
}

/**
 * Processa coleta de item — avança objetivos do tipo 'gather'.
 * @param {{ itemId: string, qty: number }} payload
 */
function _onItemPicked({ itemId, qty = 1 }) {
  if (!itemId) return;
  for (const questId of Object.keys(_active)) {
    const quest = _getDef(questId);
    if (!quest) continue;
    for (const obj of quest.objectives) {
      if (obj.type === 'gather' && obj.target === itemId) {
        _advance(questId, obj.id, qty);
      }
    }
  }
}

/**
 * Processa movimento do player — avança objetivos do tipo 'reach'.
 * @param {{ position: { x: number, y: number, z: number } }} payload
 */
function _onPlayerMoved({ position }) {
  if (!position) return;
  for (const questId of Object.keys(_active)) {
    const quest = _getDef(questId);
    if (!quest) continue;
    for (const obj of quest.objectives) {
      if (obj.type !== 'reach') continue;
      if (!obj.position || obj.radius == null) continue;

      const current = _active[questId].progress[obj.id] ?? 0;
      if (current >= obj.required) continue;

      const dx = position.x - obj.position.x;
      const dz = position.z - obj.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist <= obj.radius) {
        _advance(questId, obj.id, 1);
      }
    }
  }
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Inicializa o módulo: carrega quests.json, restaura estado do save
 * e registra listeners de eventos.
 * @param {{ active: Object, completed: string[] }|null} playerQuestsSave
 * @returns {Promise<void>}
 */
export async function init(playerQuestsSave) {
  // Carregar definições
  const response = await fetch('assets/data/quests.json');
  _definitions = await response.json();

  // Restaurar estado do save
  if (playerQuestsSave) {
    _active    = playerQuestsSave.active    ?? {};
    _completed = playerQuestsSave.completed ?? [];
  } else {
    _active    = {};
    _completed = [];
  }

  // Registrar listeners via event bus (R8)
  Events.on('monsterDied',  _onMonsterDied);
  Events.on('itemPicked',   _onItemPicked);
  Events.on('playerMoved',  _onPlayerMoved);
}

/**
 * Aceita uma quest. No-op se já ativa ou completada.
 * @param {string} questId
 * @returns {boolean} true se aceita com sucesso
 */
export function acceptQuest(questId) {
  if (_active[questId])          return false;
  if (_completed.includes(questId)) return false;

  const quest = _getDef(questId);
  if (!quest) return false;

  // Inicializar progresso zerado para todos os objetivos
  const progress = {};
  for (const obj of quest.objectives) {
    progress[obj.id] = 0;
  }

  _active[questId] = {
    questId,
    progress,
    startedAt: Date.now()
  };

  // TODO: audio.playSFX('sfx_quest_accepted'); // audio.json não existe ainda

  Events.emit('questAccepted', { questId, quest });
  return true;
}

/**
 * Completa uma quest. Só executa se isCompletable(questId) for true.
 * Entrega recompensas via eventos.
 * @param {string} questId
 * @returns {boolean} true se completada com sucesso
 */
export function completeQuest(questId) {
  if (!isCompletable(questId)) return false;

  const quest = _getDef(questId);
  if (!quest) return false;

  delete _active[questId];
  _completed.push(questId);

  // TODO: audio.playSFX('sfx_quest_complete'); // audio.json não existe ainda

  Events.emit('questCompleted', {
    questId,
    quest,
    rewards: quest.rewards
  });

  return true;
}

/**
 * Abandona uma quest sem recompensa.
 * @param {string} questId
 * @returns {boolean} true se abandonada com sucesso
 */
export function abandonQuest(questId) {
  if (!_active[questId]) return false;

  delete _active[questId];

  Events.emit('questAbandoned', { questId });
  return true;
}

/**
 * Retorna snapshot do estado atual para persistência no save.
 * @returns {{ active: Object, completed: string[] }}
 */
export function getState() {
  return {
    active:    { ..._active },
    completed: [..._completed]
  };
}

/**
 * Retorna lista de quests ativas com definição mesclada.
 * @returns {Array<{ definition: QuestDefinition, active: ActiveQuest }>}
 */
export function getActiveQuests() {
  return Object.keys(_active).map(questId => ({
    definition: _getDef(questId),
    active:     _active[questId]
  })).filter(entry => entry.definition != null);
}

/**
 * Verifica se uma quest está ativa.
 * @param {string} questId
 * @returns {boolean}
 */
export function isActive(questId) {
  return !!_active[questId];
}

/**
 * Verifica se uma quest foi completada.
 * @param {string} questId
 * @returns {boolean}
 */
export function isCompleted(questId) {
  return _completed.includes(questId);
}

/**
 * Verifica se uma quest está completável (todos os objetivos atingidos).
 * Derivado em runtime — nunca salvo no estado.
 * @param {string} questId
 * @returns {boolean}
 */
export function isCompletable(questId) {
  const active = _active[questId];
  if (!active) return false;

  const quest = _getDef(questId);
  if (!quest) return false;

  return quest.objectives.every(obj =>
    (active.progress[obj.id] ?? 0) >= obj.required
  );
}

/**
 * Retorna a definição da quest que um NPC pode oferecer (giver),
 * ou null se não houver quest disponível para oferecer.
 * @param {string} npcId
 * @returns {QuestDefinition|null}
 */
export function getOfferableQuestForNpc(npcId) {
  return _definitions.find(q =>
    q.giver === npcId &&
    !_active[q.id] &&
    !_completed.includes(q.id)
  ) ?? null;
}

/**
 * Retorna a definição da quest que um NPC pode receber como turn-in (completer),
 * ou null se não houver quest completável para este NPC.
 * @param {string} npcId
 * @returns {QuestDefinition|null}
 */
export function getTurnInQuestForNpc(npcId) {
  return _definitions.find(q =>
    q.completer === npcId &&
    isCompletable(q.id)
  ) ?? null;
}