/**
 * @module quests
 * @description Sistema de quests do LumieQuest.
 * PROMPT 12 Parte 3: suporte a objective type "talkTo"; hook _onObjectiveComplete
 * que dispara questBossSpawnRequest APENAS quando objetivo "kill" com bossId vira ativo.
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
 * @property {'kill'|'gather'|'reach'|'talkTo'} type
 * @property {string} target
 * @property {string} label
 * @property {number} required
 * @property {string}   [bossId]       - apenas objetivos kill com boss vinculado
 * @property {{x,y,z}} [bossPosition]  - posição de spawn do boss
 * @property {{ x: number, z: number }} [position]
 * @property {number}  [radius]
 */

/**
 * @typedef {Object} QuestDefinition
 * @property {string}  id
 * @property {string}  name
 * @property {string}  description
 * @property {string}  giver
 * @property {string}  completer
 * @property {string}  [reqClass]
 * @property {number}  [reqLevel]
 * @property {QuestObjective[]} objectives
 * @property {{ exp: number, gold: number, jobChange?: string, items?: {itemId:string,qty:number}[] }} rewards
 */

/**
 * @typedef {Object} ActiveQuest
 * @property {string} questId
 * @property {{ [objectiveId: string]: number }} progress
 * @property {number} startedAt
 */

// ─── Helpers privados ─────────────────────────────────────────────────────────

/**
 * @param {string} questId
 * @returns {QuestDefinition|undefined}
 */
function _getDef(questId) {
  return _definitions.find(q => q.id === questId);
}

/**
 * Retorna o índice do primeiro objetivo ainda incompleto.
 * @param {string} questId
 * @returns {number} -1 se todos completos
 */
function _activeObjectiveIndex(questId) {
  const active = _active[questId];
  if (!active) return -1;
  const quest = _getDef(questId);
  if (!quest) return -1;
  return quest.objectives.findIndex(
    obj => (active.progress[obj.id] ?? 0) < obj.required
  );
}

/**
 * Hook chamado quando um objetivo atinge o required.
 * Avalia se o PRÓXIMO objetivo é "kill" com bossId e, se sim,
 * emite questBossSpawnRequest — boss só spawna quando objetivo 3 vira ativo.
 * @param {string} questId
 * @param {number} completedIndex
 */
function _onObjectiveComplete(questId, completedIndex) {
  const quest = _getDef(questId);
  if (!quest) return;

  const nextIndex = completedIndex + 1;
  if (nextIndex >= quest.objectives.length) return;

  const nextObj = quest.objectives[nextIndex];
  if (nextObj.type === 'kill' && nextObj.bossId) {
    Events.emit('questBossSpawnRequest', {
      bossId:   nextObj.bossId,
      questId,
      position: nextObj.bossPosition ?? { x: 0, y: 0.5, z: 0 },
    });
  }
}

/**
 * Verifica se objectiveId é o objetivo atual (primeiro incompleto).
 * Garante progressão sequencial dos objetivos.
 * @param {string} questId
 * @param {string} objectiveId
 * @returns {boolean}
 */
function _isCurrentObjective(questId, objectiveId) {
  const quest = _getDef(questId);
  if (!quest) return false;
  const idx = _activeObjectiveIndex(questId);
  if (idx === -1) return false;
  return quest.objectives[idx].id === objectiveId;
}

/**
 * Avança o progresso de um objetivo. Chama _onObjectiveComplete quando completa.
 * @param {string} questId
 * @param {string} objectiveId
 * @param {number} [amount=1]
 */
function _advance(questId, objectiveId, amount = 1) {
  const active = _active[questId];
  if (!active) return;

  const quest = _getDef(questId);
  if (!quest) return;

  const objIndex = quest.objectives.findIndex(o => o.id === objectiveId);
  if (objIndex === -1) return;

  const obj     = quest.objectives[objIndex];
  const current = active.progress[objectiveId] ?? 0;
  if (current >= obj.required) return;

  const next = Math.min(current + amount, obj.required);
  active.progress[objectiveId] = next;

  Events.emit('questProgress', {
    questId,
    objectiveId,
    current:  next,
    required: obj.required,
    quest,
  });

  if (next >= obj.required) {
    _onObjectiveComplete(questId, objIndex);
  }

  if (isCompletable(questId)) {
    Events.emit('questCompletable', { questId, quest });
  }
}

// ─── Listeners de eventos ─────────────────────────────────────────────────────

/**
 * @param {{ monsterId: string, isBoss?: boolean, linkedQuestId?: string }} payload
 */
function _onMonsterDied({ monsterId, isBoss, linkedQuestId }) {
  if (!monsterId) return;

  for (const questId of Object.keys(_active)) {
    const quest = _getDef(questId);
    if (!quest) continue;

    for (const obj of quest.objectives) {
      if (obj.type !== 'kill') continue;

      if (isBoss && linkedQuestId) {
        if (
          questId === linkedQuestId &&
          obj.target === monsterId &&
          _isCurrentObjective(questId, obj.id)
        ) {
          _advance(questId, obj.id);
        }
        continue;
      }

      const matchesTarget = obj.target === monsterId || obj.target === 'any';
      if (matchesTarget && _isCurrentObjective(questId, obj.id)) {
        _advance(questId, obj.id);
      }
    }
  }
}

/**
 * @param {{ itemId: string, qty?: number }} payload
 */
function _onItemPicked({ itemId, qty = 1 }) {
  if (!itemId) return;
  for (const questId of Object.keys(_active)) {
    const quest = _getDef(questId);
    if (!quest) continue;
    for (const obj of quest.objectives) {
      if (
        obj.type === 'gather' &&
        obj.target === itemId &&
        _isCurrentObjective(questId, obj.id)
      ) {
        _advance(questId, obj.id, qty);
      }
    }
  }
}

/**
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
      if (!_isCurrentObjective(questId, obj.id)) continue;

      const current = _active[questId].progress[obj.id] ?? 0;
      if (current >= obj.required) continue;

      const dx   = position.x - obj.position.x;
      const dz   = position.z - obj.position.z;
      if (Math.sqrt(dx * dx + dz * dz) <= obj.radius) {
        _advance(questId, obj.id, 1);
      }
    }
  }
}

/**
 * Processa fim de diálogo — avança objetivos 'talkTo'.
 * ui.js já emite: Events.emit('dialogEnded', { npcId }) — nenhuma mudança em ui.js necessária.
 * @param {{ npcId: string }} payload
 */
function _onDialogEnded({ npcId }) {
  if (!npcId) return;
  for (const questId of Object.keys(_active)) {
    const quest = _getDef(questId);
    if (!quest) continue;
    for (const obj of quest.objectives) {
      if (
        obj.type === 'talkTo' &&
        obj.target === npcId &&
        _isCurrentObjective(questId, obj.id)
      ) {
        _advance(questId, obj.id, 1);
      }
    }
  }
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Inicializa o módulo, carrega quests.json e registra listeners.
 * @param {{ active: Object, completed: string[] }|null} playerQuestsSave
 * @returns {Promise<void>}
 */
export async function init(playerQuestsSave) {
  const response = await fetch('assets/data/quests.json');
  _definitions   = await response.json();

  if (playerQuestsSave) {
    _active    = playerQuestsSave.active    ?? {};
    _completed = playerQuestsSave.completed ?? [];
  } else {
    _active    = {};
    _completed = [];
  }

  Events.on('monsterDied', _onMonsterDied);
  Events.on('itemPicked',  _onItemPicked);
  Events.on('playerMoved', _onPlayerMoved);
  Events.on('dialogEnded', _onDialogEnded);
}

/**
 * Aceita uma quest. Valida reqLevel e reqClass para quests evo2.
 * @param {string} questId
 * @param {Object|null} [playerState]
 * @returns {boolean}
 */
export function acceptQuest(questId, playerState = null) {
  if (_active[questId])             return false;
  if (_completed.includes(questId)) return false;

  const quest = _getDef(questId);
  if (!quest) return false;

  if (playerState) {
    if (quest.reqLevel && (playerState.level ?? 0) < quest.reqLevel) {
      Events.emit('uiHintShow', {
        msg:      `Nível ${quest.reqLevel} necessário para esta quest.`,
        duration: 3000,
      });
      return false;
    }
    if (quest.reqClass && playerState.class !== quest.reqClass) {
      Events.emit('uiHintShow', {
        msg:      `Classe "${quest.reqClass}" necessária para esta quest.`,
        duration: 3000,
      });
      return false;
    }
  }

  const progress = {};
  for (const obj of quest.objectives) progress[obj.id] = 0;

  _active[questId] = { questId, progress, startedAt: Date.now() };
  Events.emit('questAccepted', { questId, quest });
  return true;
}

/**
 * Completa uma quest e entrega recompensas.
 * @param {string} questId
 * @returns {boolean}
 */
export function completeQuest(questId) {
  if (!isCompletable(questId)) return false;

  const quest = _getDef(questId);
  if (!quest) return false;

  delete _active[questId];
  _completed.push(questId);

  Events.emit('questCompleted', { questId, quest, rewards: quest.rewards });

  if (quest.rewards?.jobChange) {
    Events.emit('jobChangeUnlocked', { questId, jobId: quest.rewards.jobChange });
  }

  // Despawna boss vinculado se ainda estiver no mapa
  const bossObj = quest.objectives.find(o => o.type === 'kill' && o.bossId);
  if (bossObj) {
    Events.emit('questBossDespawnRequest', { bossId: bossObj.bossId });
  }

  return true;
}

/**
 * Abandona uma quest. Emite questBossDespawnRequest se boss estava ativo.
 * @param {string} questId
 * @returns {boolean}
 */
export function abandonQuest(questId) {
  if (!_active[questId]) return false;

  const quest = _getDef(questId);
  if (quest) {
    const bossObj = quest.objectives.find(o => o.type === 'kill' && o.bossId);
    if (bossObj) {
      const prevDone = quest.objectives
        .slice(0, quest.objectives.indexOf(bossObj))
        .every(o => (_active[questId].progress[o.id] ?? 0) >= o.required);
      const bossProgress = _active[questId].progress[bossObj.id] ?? 0;
      if (prevDone && bossProgress < bossObj.required) {
        Events.emit('questBossDespawnRequest', { bossId: bossObj.bossId });
      }
    }
  }

  delete _active[questId];
  Events.emit('questAbandoned', { questId });
  return true;
}

/**
 * Snapshot do estado para o save.
 * @returns {{ active: Object, completed: string[] }}
 */
export function getState() {
  return { active: { ..._active }, completed: [..._completed] };
}

/**
 * @returns {Array<{ definition: QuestDefinition, active: ActiveQuest }>}
 */
export function getActiveQuests() {
  return Object.keys(_active)
    .map(questId => ({ definition: _getDef(questId), active: _active[questId] }))
    .filter(e => e.definition != null);
}

/** @param {string} questId @returns {boolean} */
export function isActive(questId)     { return !!_active[questId]; }

/** @param {string} questId @returns {boolean} */
export function isCompleted(questId)  { return _completed.includes(questId); }

/**
 * @param {string} questId @returns {boolean}
 */
export function isCompletable(questId) {
  const active = _active[questId];
  if (!active) return false;
  const quest = _getDef(questId);
  if (!quest)  return false;
  return quest.objectives.every(obj =>
    (active.progress[obj.id] ?? 0) >= obj.required
  );
}

/** @param {string} npcId @returns {QuestDefinition|null} */
export function getOfferableQuestForNpc(npcId) {
  return _definitions.find(q =>
    q.giver === npcId && !_active[q.id] && !_completed.includes(q.id)
  ) ?? null;
}

/** @param {string} npcId @returns {QuestDefinition|null} */
export function getTurnInQuestForNpc(npcId) {
  return _definitions.find(q =>
    q.completer === npcId && isCompletable(q.id)
  ) ?? null;
}

/** @param {string} questId @returns {QuestDefinition|undefined} */
export function getQuestDef(questId)  { return _getDef(questId); }

/** @returns {string[]} */
export function getCompleted()        { return [..._completed]; }