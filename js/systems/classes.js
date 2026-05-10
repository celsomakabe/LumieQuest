/**
 * @module classes
 * @description Atributos base por job. Stub mÃ­nimo â€” PROMPT 10 completa.
 * DependÃªncias: events.js
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
 * Metadata por job: skills disponÃ­veis e armas permitidas.
 * Apenas as 4 classes base sÃ£o populadas no PROMPT 10.
 * Os 8 jobs restantes (evo1/evo2) serÃ£o completados em PROMPTs 11 e 12.
 * @type {Record<string, { skills: string[], allowedWeapons: string[] }>}
 */
const JOBS_META = {
    swordman:        { skills: ['bash', 'endure', 'provoke'],                  allowedWeapons: ['sword', 'spear'], jobModHP: 1.0, jobModMP: 0.8 },
    knight:          { baseClass: 'swordman', skills: ['bashStrong', 'shieldBash', 'auraBlade'], allowedWeapons: ['sword', 'twohand_sword'], statBonus: { str: 3, vit: 3 }, jobModHP: 1.3, jobModMP: 0.9 },
    lord_knight:     { skills: [],                                             allowedWeapons: [], jobModHP: 1.5, jobModMP: 1.0 },
    mage:            { skills: ['fireball', 'iceBolt', 'lightning'],           allowedWeapons: ['staff', 'rod'], jobModHP: 0.6, jobModMP: 1.8 },
    wizard:          { baseClass: 'mage', skills: ['meteor', 'frostNova', 'chainLightning'], allowedWeapons: ['staff', 'rod'], statBonus: { int: 3, dex: 3 }, jobModHP: 0.7, jobModMP: 2.2 },
    high_wizard:     { skills: [],                                             allowedWeapons: [], jobModHP: 0.8, jobModMP: 2.5 },
    archer:          { skills: ['doubleStrike', 'explosiveShot', 'slowShot'],  allowedWeapons: ['bow'], jobModHP: 0.9, jobModMP: 1.0 },
    hunter:          { baseClass: 'archer', skills: ['arrowRain', 'piercingShot', 'eagleEye'], allowedWeapons: ['bow'], statBonus: { agi: 3, dex: 3 }, jobModHP: 1.0, jobModMP: 1.1 },
    sniper:          { skills: [],                                             allowedWeapons: [], jobModHP: 1.1, jobModMP: 1.2 },
    assassin:        { skills: ['stealthStrike', 'poison', 'evasion'],         allowedWeapons: ['dagger', 'katar'], jobModHP: 1.0, jobModMP: 1.0 },
    assassin_master: { baseClass: 'assassin', skills: ['shadowClone', 'deadlyPoison', 'backstab'], allowedWeapons: ['dagger', 'katar'], statBonus: { agi: 3, luk: 3 }, jobModHP: 1.2, jobModMP: 1.1 },
    shadow_assassin: { skills: [],                                             allowedWeapons: [], jobModHP: 1.4, jobModMP: 1.2 },
};

/**
 * Cache de skill definitions carregadas do skills.json.
 * Populado por setSkillDefs(), chamado em main.js apÃ³s o fetch.
 * @type {Array<{id:string,name:string,description:string,classId:string,mpCost:number,cooldown:number,range:number,targetType:string}>}
 */
let _skillDefs = [];

// â”€â”€â”€ SKILL_EFFECTS registry â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Cada effect recebe (caster, target, ctx) onde:
//   caster = estado mutÃ¡vel do player (Player.getState())
//   target = entidade do combat (monstro) ou null para self/aoe
//   ctx    = { now: number, emit: Function, getEntities: Function }
// Retorna { ok: boolean, message?: string, reason?: string }
const SKILL_EFFECTS = {

    // â”€â”€ SWORDMAN â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    /** Bash: golpe fÃ­sico 180% */
    bash(caster, target, ctx) {
        if (!target) return { ok: false, reason: 'sem_alvo' };
        const baseDamage = Math.floor((caster.baseStats.str * 2 + caster.level * 3) * 1.8);
        ctx.emit('skillDamage', { skillId: 'bash', target, damage: baseDamage, isCritical: false });
        _applyDamage(target, baseDamage, ctx);
        return { ok: true, message: `Bash causou ${baseDamage} de dano!` };
    },

    /** Endure: defesa +50% por 5s (self buff) */
    endure(caster, target, ctx) {
        const buff = { id: 'endure', expiresAt: ctx.now + 5000, modifier: { defenseMultiplier: 0.5 } };
        _applyBuff(caster, buff);
        ctx.emit('buffApplied', { buffId: 'endure', casterId: caster.name, expiresAt: buff.expiresAt });
        return { ok: true, message: 'Endure ativo: dano recebido reduzido em 50% por 5s.' };
    },

    /** Provoke: forÃ§a aggro no alvo por 4s */
    provoke(caster, target, ctx) {
        if (!target) return { ok: false, reason: 'sem_alvo' };
        const debuff = { id: 'provoked', expiresAt: ctx.now + 4000, forcedTargetId: caster.name };
        _applyDebuff(target, debuff);
        ctx.emit('debuffApplied', { debuffId: 'provoked', targetId: target.instanceId, expiresAt: debuff.expiresAt });
        return { ok: true, message: 'Alvo provocado por 4s.' };
    },

    // â”€â”€ MAGE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    /** Fire Ball: dano fogo 200% em AoE raio 2u */
    fireball(caster, target, ctx) {
        const baseDamage = Math.floor((caster.baseStats.int * 2.5 + caster.level * 4) * 2.0);
        const AOE_RADIUS = 2;
        const entities = ctx.getEntities();
        const origin = target ? target.position : caster.position;
        let hitCount = 0;
        entities.forEach(e => {
            if (!e || !e.position) return;
            const dx = e.position.x - origin.x;
            const dz = (e.position.z !== undefined ? e.position.z : e.position.y) -
                       (origin.z   !== undefined ? origin.z   : origin.y);
            const dist = Math.sqrt(dx * dx + dz * dz);
            if (dist <= AOE_RADIUS) {
                ctx.emit('skillDamage', { skillId: 'fireball', target: e, damage: baseDamage, isCritical: false });
                _applyDamage(e, baseDamage, ctx);
                hitCount++;
            }
        });
        return { ok: true, message: `Fire Ball atingiu ${hitCount} alvo(s) com ${baseDamage} de dano!` };
    },

    /** Ice Bolt: dano gelo 160% + slow 30% por 3s */
    iceBolt(caster, target, ctx) {
        if (!target) return { ok: false, reason: 'sem_alvo' };
        const baseDamage = Math.floor((caster.baseStats.int * 2.5 + caster.level * 4) * 1.6);
        ctx.emit('skillDamage', { skillId: 'iceBolt', target, damage: baseDamage, isCritical: false });
        _applyDamage(target, baseDamage, ctx);
        const debuff = { id: 'slow_ice', expiresAt: ctx.now + 3000, slowAmount: 0.3 };
        _applyDebuff(target, debuff);
        ctx.emit('debuffApplied', { debuffId: 'slow_ice', targetId: target.instanceId, expiresAt: debuff.expiresAt });
        return { ok: true, message: `Ice Bolt causou ${baseDamage} de dano e aplicou slow 30% por 3s.` };
    },

    /** Lightning: dano raio 220% single target */
    lightning(caster, target, ctx) {
        if (!target) return { ok: false, reason: 'sem_alvo' };
        const baseDamage = Math.floor((caster.baseStats.int * 2.5 + caster.level * 4) * 2.2);
        ctx.emit('skillDamage', { skillId: 'lightning', target, damage: baseDamage, isCritical: false });
        _applyDamage(target, baseDamage, ctx);
        return { ok: true, message: `Lightning causou ${baseDamage} de dano elÃ©trico!` };
    },

    // â”€â”€ ARCHER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    /** Double Strike: 2 hits de 90% cada */
    doubleStrike(caster, target, ctx) {
        if (!target) return { ok: false, reason: 'sem_alvo' };
        const hitDamage = Math.floor((caster.baseStats.dex * 2 + caster.level * 3) * 0.9);
        for (let i = 0; i < 2; i++) {
            ctx.emit('skillDamage', { skillId: 'doubleStrike', target, damage: hitDamage, isCritical: false, hitIndex: i });
            _applyDamage(target, hitDamage, ctx);
        }
        return { ok: true, message: `Double Strike: 2 hits de ${hitDamage} cada!` };
    },

    /** Explosive Shot: 150% dano no alvo + AoE 80% raio 2.5u */
    explosiveShot(caster, target, ctx) {
        if (!target) return { ok: false, reason: 'sem_alvo' };
        const mainDamage = Math.floor((caster.baseStats.dex * 2 + caster.level * 3) * 1.5);
        const aoeDamage  = Math.floor(mainDamage * 0.8);
        const AOE_RADIUS = 2.5;
        ctx.emit('skillDamage', { skillId: 'explosiveShot', target, damage: mainDamage, isCritical: false });
        _applyDamage(target, mainDamage, ctx);
        const entities = ctx.getEntities();
        entities.forEach(e => {
            if (!e || !e.position || e === target) return;
            const dx = e.position.x - target.position.x;
            const dz = (e.position.z   !== undefined ? e.position.z   : e.position.y) -
                       (target.position.z !== undefined ? target.position.z : target.position.y);
            const dist = Math.sqrt(dx * dx + dz * dz);
            if (dist <= AOE_RADIUS) {
                ctx.emit('skillDamage', { skillId: 'explosiveShot', target: e, damage: aoeDamage, isCritical: false });
                _applyDamage(e, aoeDamage, ctx);
            }
        });
        return { ok: true, message: `Explosive Shot causou ${mainDamage} no alvo e ${aoeDamage} em AoE!` };
    },

    /** Slow Shot: 110% dano + slow 50% por 4s */
    slowShot(caster, target, ctx) {
        if (!target) return { ok: false, reason: 'sem_alvo' };
        const baseDamage = Math.floor((caster.baseStats.dex * 2 + caster.level * 3) * 1.1);
        ctx.emit('skillDamage', { skillId: 'slowShot', target, damage: baseDamage, isCritical: false });
        _applyDamage(target, baseDamage, ctx);
        const debuff = { id: 'slow_shot', expiresAt: ctx.now + 4000, slowAmount: 0.5 };
        _applyDebuff(target, debuff);
        ctx.emit('debuffApplied', { debuffId: 'slow_shot', targetId: target.instanceId, expiresAt: debuff.expiresAt });
        return { ok: true, message: `Slow Shot causou ${baseDamage} de dano e aplicou slow 50% por 4s.` };
    },

    // â”€â”€ ASSASSIN â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    /** Stealth Strike: crÃ­tico garantido (300%) se primeiro hit no alvo */
    stealthStrike(caster, target, ctx) {
        if (!target) return { ok: false, reason: 'sem_alvo' };
        const isFirstHit = !target._wasHit;
        const multiplier = isFirstHit ? 3.0 : 1.5;
        const baseDamage = Math.floor((caster.baseStats.str + caster.baseStats.agi * 1.5 + caster.level * 3) * multiplier);
        ctx.emit('skillDamage', { skillId: 'stealthStrike', target, damage: baseDamage, isCritical: isFirstHit });
        _applyDamage(target, baseDamage, ctx);
        target._wasHit = true;
        return {
            ok: true,
            message: isFirstHit
                ? `Stealth Strike CRÃTICO: ${baseDamage} de dano!`
                : `Stealth Strike causou ${baseDamage} de dano.`
        };
    },

    /** Poison: DoT 20% dano base por tick a cada 1s por 5s */
    poison(caster, target, ctx) {
        if (!target) return { ok: false, reason: 'sem_alvo' };
        const tickDamage = Math.floor((caster.baseStats.str + caster.baseStats.agi + caster.level * 2) * 0.2);
        const debuff = { id: 'poison', expiresAt: ctx.now + 5000, tickRate: 1000, damagePerTick: tickDamage, lastTick: ctx.now };
        _applyDebuff(target, debuff);
        ctx.emit('debuffApplied', { debuffId: 'poison', targetId: target.instanceId, expiresAt: debuff.expiresAt });
        return { ok: true, message: `Alvo envenenado: ${tickDamage} de dano por segundo durante 5s.` };
    },

    /** Evasion: esquiva +50% por 4s (self buff) */
    evasion(caster, target, ctx) {
        const buff = { id: 'evasion', expiresAt: ctx.now + 4000, modifier: { evasionBonus: 0.5 } };
        _applyBuff(caster, buff);
        ctx.emit('buffApplied', { buffId: 'evasion', casterId: caster.name, expiresAt: buff.expiresAt });
        return { ok: true, message: 'Evasion ativo: esquiva +50% por 4s.' };
    },
// ── KNIGHT ───────────────────────────────────────────────────────────────────

    /** bashStrong: dano físico 280% */
    bashStrong(caster, target, ctx) {
        if (!target) return { ok: false, reason: 'sem_alvo' };
        const dmg = Math.floor((caster.baseStats.str * 2 + caster.level * 3) * 2.8);
        ctx.emit('skillDamage', { skillId: 'bashStrong', target, damage: dmg, isCritical: false });
        _applyDamage(target, dmg, ctx);
        return { ok: true, message: `Bash Strong causou ${dmg} de dano!` };
    },

    /** shieldBash: dano físico 150% + stun 2s */
    shieldBash(caster, target, ctx) {
        if (!target) return { ok: false, reason: 'sem_alvo' };
        const dmg = Math.floor((caster.baseStats.str * 2 + caster.level * 3) * 1.5);
        ctx.emit('skillDamage', { skillId: 'shieldBash', target, damage: dmg, isCritical: false });
        _applyDamage(target, dmg, ctx);
        const debuff = { id: 'stunned', expiresAt: ctx.now + 2000 };
        _applyDebuff(target, debuff);
        ctx.emit('debuffApplied', { debuffId: 'stunned', targetId: target.instanceId, expiresAt: debuff.expiresAt });
        return { ok: true, message: `Shield Bash causou ${dmg} e stunnou por 2s.` };
    },

    /** auraBlade: buff self atkMultiplier 1.5 por 8s */
    auraBlade(caster, target, ctx) {
        const buff = { id: 'auraBlade', expiresAt: ctx.now + 8000, modifier: { atkMultiplier: 1.5 } };
        _applyBuff(caster, buff);
        ctx.emit('buffApplied', { buffId: 'auraBlade', casterId: caster.name, expiresAt: buff.expiresAt });
        return { ok: true, message: 'Aura Blade: ATK +50% por 8s.' };
    },

    // ── WIZARD ───────────────────────────────────────────────────────────────────

    /** meteor: AoE raio 3u, dano mágico 280% */
    meteor(caster, target, ctx) {
        const dmg = Math.floor((caster.baseStats.int * 2.5 + caster.level * 4) * 2.8);
        const AOE_RADIUS = 3;
        const origin = target ? target.position : caster.position;
        let hits = 0;
        ctx.getEntities().forEach(e => {
            if (!e || !e.position) return;
            const dx = e.position.x - origin.x;
            const dz = (e.position.z !== undefined ? e.position.z : e.position.y) -
                       (origin.z !== undefined ? origin.z : origin.y);
            if (Math.sqrt(dx * dx + dz * dz) <= AOE_RADIUS) {
                ctx.emit('skillDamage', { skillId: 'meteor', target: e, damage: dmg, isCritical: false });
                _applyDamage(e, dmg, ctx);
                hits++;
            }
        });
        return { ok: true, message: `Meteor atingiu ${hits} alvo(s) com ${dmg}!` };
    },

    /** frostNova: AoE raio 2.5u em volta do caster, dano 150% + slow 50% 4s */
    frostNova(caster, target, ctx) {
        const dmg = Math.floor((caster.baseStats.int * 2.5 + caster.level * 4) * 1.5);
        const AOE_RADIUS = 2.5;
        ctx.getEntities().forEach(e => {
            if (!e || !e.position) return;
            const dx = e.position.x - caster.position.x;
            const dz = (e.position.z !== undefined ? e.position.z : e.position.y) -
                       (caster.position.z !== undefined ? caster.position.z : caster.position.y);
            if (Math.sqrt(dx * dx + dz * dz) <= AOE_RADIUS) {
                ctx.emit('skillDamage', { skillId: 'frostNova', target: e, damage: dmg, isCritical: false });
                _applyDamage(e, dmg, ctx);
                const debuff = { id: 'slow_frost', expiresAt: ctx.now + 4000, slowAmount: 0.5 };
                _applyDebuff(e, debuff);
                ctx.emit('debuffApplied', { debuffId: 'slow_frost', targetId: e.instanceId, expiresAt: debuff.expiresAt });
            }
        });
        return { ok: true, message: 'Frost Nova disparada!' };
    },

    /** chainLightning: 250% no alvo + 60% num segundo alvo a até 3u */
    chainLightning(caster, target, ctx) {
        if (!target) return { ok: false, reason: 'sem_alvo' };
        const dmg1 = Math.floor((caster.baseStats.int * 2.5 + caster.level * 4) * 2.5);
        ctx.emit('skillDamage', { skillId: 'chainLightning', target, damage: dmg1, isCritical: false });
        _applyDamage(target, dmg1, ctx);
        const dmg2 = Math.floor(dmg1 * 0.6);
        const CHAIN_RADIUS = 3;
        const second = ctx.getEntities().find(e => {
            if (!e || !e.position || e === target) return false;
            const dx = e.position.x - target.position.x;
            const dz = (e.position.z !== undefined ? e.position.z : e.position.y) -
                       (target.position.z !== undefined ? target.position.z : target.position.y);
            return Math.sqrt(dx * dx + dz * dz) <= CHAIN_RADIUS;
        });
        if (second) {
            ctx.emit('skillDamage', { skillId: 'chainLightning', target: second, damage: dmg2, isCritical: false });
            _applyDamage(second, dmg2, ctx);
        }
        return { ok: true, message: `Chain Lightning: ${dmg1} no alvo${second ? `, ${dmg2} em cadeia` : ''}.` };
    },

    // ── HUNTER ───────────────────────────────────────────────────────────────────

    /** arrowRain: AoE raio 3u, dano físico 200% */
    arrowRain(caster, target, ctx) {
        const dmg = Math.floor((caster.baseStats.dex * 2 + caster.level * 3) * 2.0);
        const AOE_RADIUS = 3;
        const origin = target ? target.position : caster.position;
        let hits = 0;
        ctx.getEntities().forEach(e => {
            if (!e || !e.position) return;
            const dx = e.position.x - origin.x;
            const dz = (e.position.z !== undefined ? e.position.z : e.position.y) -
                       (origin.z !== undefined ? origin.z : origin.y);
            if (Math.sqrt(dx * dx + dz * dz) <= AOE_RADIUS) {
                ctx.emit('skillDamage', { skillId: 'arrowRain', target: e, damage: dmg, isCritical: false });
                _applyDamage(e, dmg, ctx);
                hits++;
            }
        });
        return { ok: true, message: `Arrow Rain atingiu ${hits} alvo(s) com ${dmg}!` };
    },

    /** piercingShot: dano físico 320%, ignora 30% defesa */
    piercingShot(caster, target, ctx) {
        if (!target) return { ok: false, reason: 'sem_alvo' };
        const dmg = Math.floor((caster.baseStats.dex * 2 + caster.level * 3) * 3.2);
        ctx.emit('skillDamage', { skillId: 'piercingShot', target, damage: dmg, isCritical: false, armorPierce: 0.3 });
        _applyDamage(target, dmg, ctx);
        return { ok: true, message: `Piercing Shot causou ${dmg} ignorando 30% de defesa!` };
    },

    /** eagleEye: buff self critRateBonus 0.3 por 10s */
    eagleEye(caster, target, ctx) {
        const buff = { id: 'eagleEye', expiresAt: ctx.now + 10000, modifier: { critRateBonus: 0.3 } };
        _applyBuff(caster, buff);
        ctx.emit('buffApplied', { buffId: 'eagleEye', casterId: caster.name, expiresAt: buff.expiresAt });
        return { ok: true, message: 'Eagle Eye: chance de crítico +30% por 10s.' };
    },

    // ── ASSASSIN_MASTER ──────────────────────────────────────────────────────────

    /** shadowClone: buff self evasionBonus 0.7 + atkMultiplier 1.3 por 5s */
    shadowClone(caster, target, ctx) {
        const buff = {
            id: 'shadowClone',
            expiresAt: ctx.now + 5000,
            modifier: { evasionBonus: 0.7, atkMultiplier: 1.3 }
        };
        _applyBuff(caster, buff);
        ctx.emit('buffApplied', { buffId: 'shadowClone', casterId: caster.name, expiresAt: buff.expiresAt });
        return { ok: true, message: 'Shadow Clone: evasão +70% e ATK +30% por 5s.' };
    },

    /** deadlyPoison: DoT por 8s */
    deadlyPoison(caster, target, ctx) {
        if (!target) return { ok: false, reason: 'sem_alvo' };
        const tickDmg = Math.max(2, Math.floor((caster.baseStats.str + caster.baseStats.agi) * 0.15));
        const debuff = {
            id: 'deadly_poison',
            expiresAt: ctx.now + 8000,
            tickRate: 1000,
            damagePerTick: tickDmg,
            lastTick: ctx.now
        };
        _applyDebuff(target, debuff);
        ctx.emit('debuffApplied', { debuffId: 'deadly_poison', targetId: target.instanceId, expiresAt: debuff.expiresAt });
        return { ok: true, message: `Deadly Poison: ${tickDmg}/s por 8s.` };
    },

    /** backstab: 350% se alvo provocado/lento, senão 180% */
    backstab(caster, target, ctx) {
        if (!target) return { ok: false, reason: 'sem_alvo' };
        const isVulnerable = Array.isArray(target._activeDebuffs) &&
            target._activeDebuffs.some(d =>
                (d.id === 'provoked' || d.id === 'slow_shot' || d.id === 'slow_ice' || d.id === 'slow_frost') &&
                d.expiresAt > ctx.now
            );
        const multiplier = isVulnerable ? 3.5 : 1.8;
        const dmg = Math.floor(
            (caster.baseStats.str + caster.baseStats.agi * 1.5 + caster.level * 3) * multiplier
        );
        ctx.emit('skillDamage', { skillId: 'backstab', target, damage: dmg, isCritical: isVulnerable });
        _applyDamage(target, dmg, ctx);
        return {
            ok: true,
            message: isVulnerable
                ? `Backstab VULNERÁVEL: ${dmg} de dano!`
                : `Backstab causou ${dmg} de dano.`
        };
    },
};

// â”€â”€â”€ helpers internos de buff/debuff â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
/**
 * Aplica dano direto a uma entidade. Mexe em entity.hp e dispara unregister
 * + entityDied + monsterDied via combat.js quando hp â‰¤ 0.
 * @param {Object} entity - target com .hp, .maxHp, opcionalmente .id, .xp, .monsterId
 * @param {number} amount
 * @param {Object} ctx - { emit }
 */
function _applyDamage(entity, amount, ctx) {
    if (!entity || typeof entity.hp !== 'number') return;
    entity.hp = Math.max(0, entity.hp - amount);
    if (entity.hp <= 0 && entity.id) {
        ctx.emit('entityDied', { entity });
        ctx.emit('monsterDied', { id: entity.id, monsterId: entity.monsterId, xp: entity.xp });
    }
}
/**
 * Aplica buff ao caster, substituindo se mesmo id jÃ¡ existir.
 * @param {Object} caster
 * @param {{ id:string, expiresAt:number, modifier:Object }} buff
 */
function _applyBuff(caster, buff) {
    if (!Array.isArray(caster._activeBuffs)) caster._activeBuffs = [];
    caster._activeBuffs = caster._activeBuffs.filter(b => b.id !== buff.id);
    caster._activeBuffs.push(buff);
}

/**
 * Aplica debuff ao target, substituindo se mesmo id jÃ¡ existir.
 * @param {Object} target
 * @param {{ id:string, expiresAt:number }} debuff
 */
function _applyDebuff(target, debuff) {
    if (!Array.isArray(target._activeDebuffs)) target._activeDebuffs = [];
    target._activeDebuffs = target._activeDebuffs.filter(d => d.id !== debuff.id);
    target._activeDebuffs.push(debuff);
}

/**
 * Inicializa o mÃ³dulo de classes.
 * @returns {void}
 */
export function init() {
    // PROMPT 10: carregar ClassData do save e registrar listeners de levelUp
}

/**
 * Retorna atributos base de um job em determinado nÃ­vel.
 * BÃ´nus linear: +1 em todos os stats a cada 10 nÃ­veis.
 * @param {string} job
 * @param {number} level
 * @returns {{ str:number, agi:number, vit:number, int:number, dex:number, luk:number }}
 */
export function getBaseStats(job, _level) {
    // Ragnarok-style: stats base não escalam com level.
    // Player ganha statPoints por levelup e investe manualmente.
    const base = _baseStatsByJob[job] ?? _baseStatsByJob['swordman'];
    return {
        str: base.str,
        agi: base.agi,
        vit: base.vit,
        int: base.int,
        dex: base.dex,
        luk: base.luk,
    };
}

/**
 * Retorna skills disponÃ­veis para um job.
 * @param {string} _job
 * @returns {Array}
 */
/**
 * Retorna array de definiÃ§Ãµes completas das skills de um job.
 * LÃª os skillIds de JOBS_META[job].skills e mapeia em _skillDefs.
 * @param {string} job
 * @returns {Array<Object>}
 */
export function getSkills(job) {
    const meta = JOBS_META[job];
    if (!meta || !Array.isArray(meta.skills)) return [];
    return meta.skills.map(id => _skillDefs.find(s => s.id === id)).filter(Boolean);
}

/**
 * Verifica requisitos de job change.
 * @param {Object} _playerData
 * @returns {boolean}
 */
export function canJobChange(player) {
    const JOB_MAP = {
        swordman: 'knight',
        mage:     'wizard',
        archer:   'hunter',
        assassin: 'assassin_master'
    };
    const JOB_QUEST = {
        swordman: 'quest_jobchange_knight',
        mage:     'quest_jobchange_wizard',
        archer:   'quest_jobchange_hunter',
        assassin: 'quest_jobchange_assassin'
    };
    const targetJob = JOB_MAP[player.class] || null;
    if (!targetJob) {
        return { canChange: false, targetJob: null, reason: 'classe_nao_elegivel' };
    }
    if (player.level < 30) {
        return { canChange: false, targetJob, reason: 'nivel_insuficiente' };
    }
    const requiredQuest = JOB_QUEST[player.class];
    const completed = Array.isArray(player.jobChangeQuestsCompleted)
        ? player.jobChangeQuestsCompleted
        : [];
    if (!completed.includes(requiredQuest)) {
        return { canChange: false, targetJob, reason: 'quest_nao_completa' };
    }
    return { canChange: true, targetJob, reason: 'ok' };
}

/**
 * Executa troca de job.
 * @param {Object} _playerData
 * @param {string} targetJob
 * @returns {void}
 */
export function doJobChange(player, newJobId) {
    const check = canJobChange(player);
    if (!check.canChange) {
        console.warn('[Classes] doJobChange bloqueado:', check.reason);
        return false;
    }
    const meta = JOBS_META[newJobId];
    if (!meta) {
        console.warn('[Classes] doJobChange: JOBS_META não encontrado para', newJobId);
        return false;
    }
    const oldClass = player.class;

    player.class    = newJobId;
    player.jobLevel = 1;
    player.jobExp   = 0;
    player.statPoints += 5;

    if (meta.statBonus) {
        Object.keys(meta.statBonus).forEach(stat => {
            if (player.baseStats[stat] !== undefined) {
                player.baseStats[stat] += meta.statBonus[stat];
            }
        });
    }

    player.hp = player.maxHp;
    player.mp = player.maxMp;

    if (!Array.isArray(player.jobHistory)) player.jobHistory = [];
    player.jobHistory.push({ jobId: newJobId, changedAt: Date.now(), level: player.level });

    emit('jobChanged', { oldClass, newClass: newJobId, player });
    emit('levelUp', { newLevel: player.level });

    return true;
}
/**
 * Recebe as skill definitions carregadas do skills.json.
 * Chamado por main.js apÃ³s fetch de assets/data/skills.json.
 * @param {Array<Object>} defs
 * @returns {void}
 */
export function setSkillDefs(defs) {
    _skillDefs = Array.isArray(defs) ? defs : [];
}

/**
 * Retorna a definiÃ§Ã£o serializada de uma skill pelo id.
 * @param {string} skillId
 * @returns {Object|undefined}
 */
export function getSkillDef(skillId) {
    return _skillDefs.find(s => s.id === skillId);
}

/**
 * Retorna todas as skill defs de uma classe pelo classId.
 * @param {string} classId
 * @returns {Array<Object>}
 */
export function getAllSkillsForClass(classId) {
    return _skillDefs.filter(s => s.classId === classId);
}

/**
 * Executa o effect de uma skill via SKILL_EFFECTS registry.
 * @param {string} skillId
 * @param {Object} caster - estado do player
 * @param {Object|null} target - entidade alvo ou null
 * @param {{ now:number, emit:Function, getEntities:Function }} ctx
 * @returns {{ ok:boolean, message?:string, reason?:string }}
 */
export function executeSkill(skillId, caster, target, ctx) {
    const effect = SKILL_EFFECTS[skillId];
    if (!effect) return { ok: false, reason: 'skill_desconhecida' };
    try {
        return effect(caster, target, ctx);
    } catch (err) {
        console.error('[Classes] executeSkill erro:', skillId, err);
        return { ok: false, reason: 'erro_interno' };
    }
}
/**
 * Retorna metadata pública de um job (skills, allowedWeapons, statBonus, baseClass).
 * Usado por Player.applyJobChange pra ler statBonus sem expor o objeto interno.
 * @param {string} jobId
 * @returns {Object|null}
 */
export function getJobMeta(jobId) {
    return JOBS_META[jobId] || null;
}