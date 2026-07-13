// js/systems/combat.js
import { emit, on }    from '../core/events.js';
import { playSFX }     from '../core/audio.js';
import * as Classes    from './classes.js';
import * as VFX        from './vfx.js'; // R8 exceção: wiring VFX de skill
import { getFinalStats } from './stats.js'; // fonte única de stats finais (gear/refino/carta/set/pet)

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

// ─── VFX de projétil por skill ranged ────────────────────────────────
// Cor própria por skill (reconhecível em combate). O tamanho escala com o
// mpCost (força): skills mais caras/fortes = projétil maior e mais marcante.
const RANGED_SKILL_COLORS = {
  // archer
  doubleStrike:  0x88ff66, // verde-claro (tiro duplo rápido)
  explosiveShot: 0xff6a00, // laranja-fogo (explosivo)
  slowShot:      0x66ddff, // ciano-gelo (lentidão)
  // hunter
  arrowRain:     0xffcc33, // âmbar/ouro (saraivada)
  piercingShot:  0xff3366, // magenta-quente (perfurante)
  // sniper
  phantomArrow:  0xaa66ff, // violeta (espectral)
  sharpShoot:    0x66ffff, // branco-ciano intenso (crítico de precisão)
};
const RANGED_SKILL_DEFAULT_COLOR = 0x66ff66;

/**
 * Escala do projétil a partir do mpCost (proxy de força). Clamp [0.9, 2.8]:
 * doubleStrike(8)→~1.09 ... sharpShoot(70)→~2.58.
 * @param {number} mpCost
 * @returns {number}
 */
function _rangedSkillScale(mpCost) {
  const s = 0.9 + (Number(mpCost) || 0) * 0.024;
  return Math.max(0.9, Math.min(2.8, s));
}

// ─── Helpers internos ────────────────────────────────────────────────

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
function _applyDebuff(target, debuffData) {
  if (!target) return;
  if (!Array.isArray(target._activeDebuffs)) target._activeDebuffs = [];

  const now = performance.now();
  const existing = target._activeDebuffs.find(d => d.id === debuffData.id);

  const nextDebuff = {
    id: debuffData.id,
    damagePerTick: debuffData.damagePerTick ?? 0,
    tickRate: debuffData.tickRate ?? 2000,
    duration: debuffData.duration ?? 0,
    expiresAt: now + (debuffData.duration ?? 0),
    lastTick: now,
    sourceBossId: debuffData.sourceBossId ?? null,
    isPercentMaxHp: !!debuffData.isPercentMaxHp,
  };

  if (existing) {
    Object.assign(existing, nextDebuff);
  } else {
    target._activeDebuffs.push(nextDebuff);
  }

  emit('debuffApplied', {
    target,
    debuffId: nextDebuff.id,
    icon: nextDebuff.id,
    duration: nextDebuff.duration,
    tickRate: nextDebuff.tickRate,
    sourceBossId: nextDebuff.sourceBossId,
  });
}

function _applyReflectDamage(attacker, target, dealtDamage) {
  if (!attacker || !target) return;
  if (attacker.type !== 'player') return;
  if (!target.isBoss) return;
  if (!target._reflectShield) return;
  if (dealtDamage <= 0) return;

  const reflected = Math.max(1, Math.floor(dealtDamage * 0.5));
  attacker.hp = Math.max(0, attacker.hp - reflected);

  emit('damageReflected', {
    attacker,
    target,
    amount: reflected,
    source: 'reflectShield',
  });

  emit('playerHpChanged', {
    current: attacker.hp,
    max: attacker.maxHp,
  });

  // playerDied centralizado em player.js
}
// ─── API pública ─────────────────────────────────────────────────────

/**
 * Registra uma entidade como alvo atacável (monstro, etc.).
 * @param {object} entity - deve ter .position {x,y,z}, .hp, .def ou .baseStats.vit
 */
function registerTarget(entity) {
  _ensureCombatEventHooks();
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
  if (attacker?._isDead || target?._isDead) return false;
  const lastTime = _cooldowns.get(attacker) ?? 0;
  if (performance.now() - lastTime < ATTACK_COOLDOWN_MS) return false;

  // Range do ataque básico varia por classe (archer/hunter/sniper = 8, demais = 3).
  // Atacantes sem classe (monstros) caem no padrão corpo-a-corpo.
  const attackRange = Classes.getAttackRange(attacker?.class);
  if (_distXZ(attacker, target) > attackRange) {
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
  if (!attacker || !target) return null;
  if (attacker._isDead || target._isDead) return null;
  if (!canAttack(attacker, target)) return null;

  _cooldowns.set(attacker, performance.now());

  playSFX(SFX.swing);

  // ── Evasion: target com buff 'evasion' tem chance de esquivar ──
  if (Array.isArray(target._activeBuffs)) {
    const now = performance.now();
    const evasionBuff = target._activeBuffs.find(b => b.id === 'evasion' && b.expiresAt > now);
    if (evasionBuff && Math.random() < evasionBuff.modifier.evasionBonus) {
      playSFX(SFX.miss);
      emit('damageDealt', { attacker, target, amount: 0, isCritical: false, isSkill: false, evaded: true });
      return { amount: 0, isCritical: false, evaded: true };
    }
  }

  // Stats FINAIS: player soma gear/refino/carta/set/pet; monstro cai no baseStats cru.
  const str        = getFinalStats(attacker).str || attacker.str || 1;
  const def        = _getDef(target);
  const isCritical = Math.random() < 0.05;

  let effectiveStr = str;
  if (
    attacker.monsterId === 'boss_shadow_assassin' &&
    attacker._stealthUsed === false &&
    (attacker._invisible || attacker._surpriseStrikeReady || attacker._playerSawBoss === false)
  ) {
    effectiveStr = Math.floor(effectiveStr * 2);
    attacker._stealthUsed = true;
    attacker._surpriseStrikeReady = false;

    emit('bossAbilityUsed', {
      bossId: attacker.monsterId,
      ability: 'stealthStrikeFirst',
      data: {
        integratedByCombat: true,
        damageMultiplier: 2,
      },
    });
  }

  let amount = Math.max(1, effectiveStr - def);
  if (isCritical) amount = amount * 2;

  // ── Endure: target com buff 'endure' reduz dano recebido ──
  if (Array.isArray(target._activeBuffs)) {
    const now = performance.now();
    const endureBuff = target._activeBuffs.find(b => b.id === 'endure' && b.expiresAt > now);
    if (endureBuff && typeof endureBuff.modifier.defenseMultiplier === 'number') {
      amount = amount * endureBuff.modifier.defenseMultiplier;
    }
  }

  amount = Math.floor(amount);

  target.hp = Math.max(0, target.hp - amount);
  if (target.type === 'player') {
    emit('playerHpChanged', { current: target.hp, max: target.maxHp });
    // playerDied emitido por player.js
  }

  playSFX(isCritical ? SFX.critical : SFX.hit);

  emit('damageDealt', { attacker, target, amount, isCritical, isSkill: false });

  // VFX de projétil no ataque básico de classes ranged (archer/hunter/sniper).
  // Origem/destino vêm direto do fluxo de ataque; offset de altura para o tiro
  // sair na altura do tronco e chegar no corpo do alvo, não no chão.
  if (attacker.type === 'player' && Classes.isRangedClass(attacker.class) && target.position) {
    VFX.playProjectile(
      { x: attacker.position.x, y: (attacker.position.y ?? 0) + 1.2, z: attacker.position.z },
      { x: target.position.x,   y: (target.position.y ?? 0) + 0.8, z: target.position.z },
      { color: 0x66ff66, scale: 1.1, speed: 32, trail: true },
    );
  }

  _applyReflectDamage(attacker, target, amount);

  if (target.hp <= 0) {
    unregisterTarget(target);
    emit('entityDied', { entity: target });
  }

  return { amount, isCritical };
}
// ─── Skills ──────────────────────────────────────────────────────────

/**
 * Tenta lançar uma skill do player contra um alvo.
 * Valida classe, aprendizado, MP, cooldown e range. Emite mpConsumeRequest
 * para player.js consumir o MP via event bus (R8).
 * @param {Object} playerState - retorno de Player.getState()
 * @param {string} skillId
 * @param {Object|null} target - instância de monstro ou null para self/aoe
 * @returns {{ ok: boolean, reason?: string, message?: string }}
 */
function castSkill(playerState, skillId, target) {
  const skillDef = Classes.getSkillDef(skillId);
  if (!skillDef) return { ok: false, reason: 'skill_inexistente' };

  const skillType = skillDef.type ?? 'melee';

  if (skillDef.classId !== playerState.class) {
    return { ok: false, reason: 'classe_incorreta' };
  }

  if (!Array.isArray(playerState.learnedSkills) || !playerState.learnedSkills.includes(skillId)) {
    return { ok: false, reason: 'skill_nao_aprendida' };
  }

  if (playerState.mp < skillDef.mpCost) {
    return { ok: false, reason: 'mp_insuficiente' };
  }

  const now = performance.now();
  if (!playerState.cooldowns) playerState.cooldowns = {};
  if (playerState.cooldowns[skillId] && now < playerState.cooldowns[skillId]) {
    return { ok: false, reason: 'em_cooldown' };
  }

  if (skillDef.targetType === 'enemy') {
    if (!target) return { ok: false, reason: 'sem_alvo' };
    if (_distXZ({ position: playerState.position }, target) > skillDef.range) {
      return { ok: false, reason: 'fora_de_alcance' };
    }
  }

  // Consome MP via evento (R8 — sem import direto de Player)
  emit('mpConsumeRequest', { amount: skillDef.mpCost });

  // Registra cooldown (em ms a partir de agora)
  playerState.cooldowns[skillId] = now + skillDef.cooldown * 1000;

  // Wraps emit para marcar damageDealt de skill com isSkill: true
  const wrappedEmit = (event, data) => {
    if (event === 'damageDealt') {
      data.isSkill = true;
    }
    emit(event, data);
  };

  // Monta ctx e executa effect
  const ctx = {
    now,
    emit: wrappedEmit,
    // Skills do player miram o conjunto de inimigos — nunca o próprio player.
    // Sem este filtro, skills AoE (fireball, meteor, frostNova...) atingem o
    // player registrado como alvo e o matam quando não há inimigo no alcance.
    getEntities: () => Array.from(_targets).filter(t => t.type !== 'player'),
  };
  const _targetPos = target?.position ? { x: target.position.x, y: target.position.y, z: target.position.z } : null;
  // Injeta os stats FINAIS no caster: todas as fórmulas de skill (classes.js) leem
  // caster.baseStats — trocar só o baseStats por um objeto final faz as 36 skills usarem
  // gear/refino/carta/set/pet sem tocar em classes.js. playerState é cópia de getState()
  // (não muta o _data real); _activeBuffs/position/etc. preservados por spread.
  const casterFinal = { ...playerState, baseStats: getFinalStats(playerState) };
  const result = Classes.executeSkill(skillId, casterFinal, target, ctx);

  emit('skillCast', {
    skillId,
    skillType,
    success: result.ok,
    casterId: playerState.name,
    targetId: target ? target.instanceId : null,
    casterPosition: playerState.position
      ? { x: playerState.position.x, y: playerState.position.y, z: playerState.position.z }
      : null,
    targetPosition: _targetPos,
  });

  return result;
}

/**
 * Tick de DoTs e expiração de debuffs em todos os _targets registrados.
 * Chamado no game loop por main.js.
 * @param {number} _delta - tempo em ms desde o último frame (não usado; tick por timestamp absoluto)
 */
function update(_delta) {
  const now = performance.now();
  for (const entity of _targets) {
    if (!Array.isArray(entity._activeDebuffs)) continue;

    entity._activeDebuffs = entity._activeDebuffs.filter(debuff => {
      if (now >= debuff.expiresAt) return false;

      // Tick de poison
      if (debuff.id === 'poison' && debuff.damagePerTick && debuff.tickRate) {
        if (now - debuff.lastTick >= debuff.tickRate) {
          debuff.lastTick = now;
          entity.hp = Math.max(0, entity.hp - debuff.damagePerTick);
          emit('damageDealt', {
            attacker: null,
            target: entity,
            amount: debuff.damagePerTick,
            isCritical: false,
            source: 'poison',
          });
          if (entity.hp <= 0) {
            unregisterTarget(entity);
            emit('entityDied', { entity });
            return false;
          }
        }
      }

      // DoTs de boss (deadly_poison, abyss_poison)
      if (
        (debuff.id === 'deadly_poison' || debuff.id === 'abyss_poison') &&
        debuff.damagePerTick && debuff.tickRate
      ) {
        if (now - debuff.lastTick >= debuff.tickRate) {
          debuff.lastTick = now;

          const dotAmount = debuff.isPercentMaxHp
            ? Math.max(1, Math.floor((entity.maxHp ?? entity.hp ?? 1) * debuff.damagePerTick))
            : debuff.damagePerTick;

          entity.hp = Math.max(0, entity.hp - dotAmount);

          if (entity.type === 'player') {
            emit('playerHpChanged', { current: entity.hp, max: entity.maxHp });
          }

          emit('damageDealt', {
            attacker: null,
            target: entity,
            amount: dotAmount,
            isCritical: false,
            source: debuff.id,
          });

          if (entity.hp <= 0) {
            unregisterTarget(entity);
            emit('entityDied', { entity });
            return false;
          }
        }
      }

      return true;
    });
  }
}
// ─── Boss combat hooks ───────────────────────────────────────────────

let _bossCombatHooksRegistered = false;

function _onBossAbilityUsed({ bossId, ability, data } = {}) {
  if (bossId !== 'boss_shadow_assassin') return;
  if (ability !== 'abyssPoison') return;

  const player = Array.from(_targets).find(t => t.type === 'player');
  if (!player) return;

  _applyDebuff(player, {
    id: 'abyss_poison',
    damagePerTick: data?.damagePerTickValue ?? 0.05,
    tickRate: data?.tickRateMs ?? 2000,
    duration: data?.durationMs ?? 10000,
    sourceBossId: bossId,
    isPercentMaxHp: true,
  });
}

function _ensureCombatEventHooks() {
  if (_bossCombatHooksRegistered) return;
  _bossCombatHooksRegistered = true;
  on('bossAbilityUsed', _onBossAbilityUsed);

  // Wiring: VFX de skill via mesh-based effects
  on('skillCast', ({ success, skillId, skillType, casterPosition, targetPosition }) => {
    if (success !== true) return;

    // Skills ranged: projétil viajando do player até o alvo, com cor por skill e
    // tamanho escalando com a força (mpCost). Requer origem e destino.
    if (skillType === 'ranged' && casterPosition && targetPosition) {
      const def = Classes.getSkillDef(skillId);
      const color = RANGED_SKILL_COLORS[skillId] ?? RANGED_SKILL_DEFAULT_COLOR;
      const scale = _rangedSkillScale(def?.mpCost);
      VFX.playProjectile(
        { x: casterPosition.x, y: (casterPosition.y ?? 0) + 1.2, z: casterPosition.z },
        { x: targetPosition.x, y: (targetPosition.y ?? 0) + 0.8, z: targetPosition.z },
        { color, scale, speed: 34, trail: true },
      );
      return;
    }

    // melee / magic / buff (e ranged sem alvo): efeito estático no local.
    const pos = skillType === 'buff' ? casterPosition : targetPosition;
    if (!pos) return;
    VFX.playEffect(skillType, pos);
  });
}

// Balanceamento boss XP verificado: 4 bosses T2 com 500 XP cada (vs 8-72 XP monstros comuns).

// ─── Exports ─────────────────────────────────────────────────────────

export { registerTarget, unregisterTarget, findNearestTarget, canAttack, attack, castSkill, update };