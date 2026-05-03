// js/systems/combat.js
import { emit }    from '../core/events.js';
import { playSFX } from '../core/audio.js';

/** URLs dos SFX de combate */
const SFX = {
  swing:    'assets/audio/sfx/sfx_combat_swing.ogg',
  hit:      'assets/audio/sfx/sfx_combat_hit.ogg',
  critical: 'assets/audio/sfx/sfx_combat_critical.ogg',
  miss:     'assets/audio/sfx/sfx_combat_miss.ogg',
};

/** Cooldown mínimo entre ataques de uma mesma entidade (ms) */
const ATTACK_COOLDOWN_MS = 1000;

/** Distância máxima de ataque (unidades XZ) */
const ATTACK_RANGE = 3;

/** Map interno: entidade → timestamp do último ataque */
const _cooldowns = new Map();

/** Lista de alvos registrados (monstros, NPCs hostis, etc.) */
const _targets = new Set();

// ─── Helpers internos ────────────────────────────────────────────────────────

/**
 * Retorna a defesa efetiva de uma entidade.
 * @param {object} entity
 * @returns {number}
 */
function _getDef(entity) {
  if (typeof entity.def === 'number') return entity.def;
  if (entity.baseStats?.vit !== undefined) return Math.floor(entity.baseStats.vit / 2);
  return 0;
}

/**
 * Distância euclidiana no plano XZ entre duas entidades.
 * @param {object} a - entidade com .position {x,z}
 * @param {object} b - entidade com .position {x,z}
 * @returns {number}
 */
function _distXZ(a, b) {
  const dx = (a.position?.x ?? 0) - (b.position?.x ?? 0);
  const dz = (a.position?.z ?? 0) - (b.position?.z ?? 0);
  return Math.sqrt(dx * dx + dz * dz);
}

// ─── API pública ─────────────────────────────────────────────────────────────

/**
 * Registra uma entidade como alvo atacável (monstro, etc.).
 * @param {object} entity - deve ter .position {x,y,z}, .hp, .def ou .baseStats.vit
 */
function registerTarget(entity) {
  _targets.add(entity);
}

/**
 * Remove uma entidade da lista de alvos.
 * @param {object} entity
 */
function unregisterTarget(entity) {
  _targets.delete(entity);
  _cooldowns.delete(entity);
}

/**
 * Retorna o alvo registrado mais próximo dentro do range, ou null.
 * @param {{ x: number, z: number }} position - posição do atacante
 * @param {number} [range=ATTACK_RANGE]
 * @returns {object|null}
 */
function findNearestTarget(position, range = ATTACK_RANGE) {
  let nearest = null;
  let minDist = Infinity;
  const fakeAttacker = { position };
  for (const t of _targets) {
  if (t.hp <= 0) continue;
    if (t.type === 'player') continue;
    const d = _distXZ(fakeAttacker, t);
    if (d <= range && d < minDist) {
      minDist = d;
      nearest = t;
    }
  }
  return nearest;
}

/**
 * Verifica se o atacante pode atacar o alvo agora.
 * Toca sfx_combat_miss e retorna false se falhar.
 * @param {object} attacker
 * @param {object} target
 * @returns {boolean}
 */
function canAttack(attacker, target) {
  const lastTime = _cooldowns.get(attacker) ?? 0;
  if (performance.now() - lastTime < ATTACK_COOLDOWN_MS) return false;

  if (_distXZ(attacker, target) > ATTACK_RANGE) {
    playSFX(SFX.miss);
    return false;
  }

  if (target.hp <= 0) {
    playSFX(SFX.miss);
    return false;
  }

  return true;
}

/**
 * Executa um ataque de attacker contra target.
 * Emite "damageDealt" e, se o alvo morrer, "entityDied".
 * @param {object} attacker - deve ter .baseStats.str e .position
 * @param {object} target   - deve ter .hp e (.def ou .baseStats.vit) e .position
 * @returns {{ amount: number, isCritical: boolean }|null} null se canAttack falhar
 */
function attack(attacker, target) {
  if (!canAttack(attacker, target)) return null;

  _cooldowns.set(attacker, performance.now());

  playSFX(SFX.swing);

  const str        = attacker.baseStats?.str ?? 1;
  const def        = _getDef(target);
  const isCritical = Math.random() < 0.05;
  let amount       = Math.max(1, str - def);
  if (isCritical) amount = amount * 2;
  amount = Math.floor(amount);

  target.hp = Math.max(0, target.hp - amount);
if (target.type === 'player') {
    emit('playerHpChanged', { current: target.hp, max: target.maxHp });
    if (target.hp <= 0) emit('playerDied');
  }

  playSFX(isCritical ? SFX.critical : SFX.hit);

  emit('damageDealt', { attacker, target, amount, isCritical });

  if (target.hp <= 0) {
    unregisterTarget(target);
    emit('entityDied', { entity: target });
  }

  return { amount, isCritical };
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export { registerTarget, unregisterTarget, findNearestTarget, canAttack, attack };