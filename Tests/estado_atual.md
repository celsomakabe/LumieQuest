# LumieQuest — Estado Atual

**Sessão atual:** 17 (FECHADA)
**Último PROMPT aprovado:** PROMPT 12 (Segunda Evolução Nível 70)
**saveVersion:** 7
**Próxima sessão:** 18 (TESTE D ou PROMPT 13 conforme mestre)

## Sessões fechadas

* PROMPT 1-4 (engine, scene, player, save)
* PROMPT 4.5 (Áudio Base) — saveVersion 2
* PROMPT 5 (Combate)
* PROMPT 6 (Monstros) — 5 slimes + 3 goblins
* TESTE B (Sessão 10) — player death adiado
* PROMPT 7 (Inventário) — saveVersion 3
* PROMPT 8 (NPCs e Diálogos) — 5 NPCs estáticos
* PROMPT 9 (Sistema de Quests) — saveVersion 4
* TESTE C (Sessão 14) — pulado
* PROMPT 10 (Classes Base e Skills) — saveVersion 5
* PROMPT 11 (Job Change Nível 30) — saveVersion 6
* **PROMPT 12 (Segunda Evolução Nível 70) — saveVersion 7** ← Sessão 17

## Arquivos existentes

js/core/        → main.js, events.js, save.js, input.js, assets.js, audio.js
js/world/       → scene.js, physics.js (stub)
js/entities/    → player.js, monsters.js, npcs.js
js/systems/     → classes.js, combat.js, inventory.js, quests.js
js/ui/          → ui.js
assets/data/    → monsters.json, items.json, npcs.json, quests.json, skills.json
assets/audio/bgm/ → bgm_city.ogg
assets/audio/sfx/ → 10 SFX (ui_click/hover, levelup, footsteps grass1/2, combat swing/hit/critical/miss)
tests/          → manualChecklist.md, estado_atual.md

## Exports públicos (atualizados na Sessão 17)

* core/events.js: on, off, emit, once

* core/save.js: init, save, load, deleteSave, migrateSave, getCurrentVersion (CURRENT_SAVE_VERSION = 7)

* core/input.js: init, getState, setBinding, getBinding
  → bindings: WASD, mouse, E, I, F, J, K, botão direito, skill1-4 (Digit1-4)

* core/audio.js: init, playBGM, stopBGM, playSFX, playSFX3D (stub), setVolume, getVolume

* core/assets.js: init, loadModel, loadTexture, loadAudio, preloadAll, getAudioContext

* world/scene.js: init, render, getScene, getCamera, getRenderer, add, remove, getGround, setGroundTexture

* world/physics.js: init, getGroundHeight, checkAABB, raycastGround, update

* entities/player.js: init, getState, getPosition, getInstance, takeDamage, heal, restoreMp, consumeMp, addExp, update, unlockJobChangeQuest, applyJobChange
  → HP/MP escalam por classe (jobModHP/jobModMP)
  → Cap de level 99
  → StatPoints por levelup: floor((lv-1)/5) + 3
  → Regen tick 6s: HP = floor(maxHp/200) + floor(vit/5); MP = 1 + floor(maxMp/100) + floor(int/6)
  → Fórmulas Ragnarok-like: maxHp = (35+lv*8)*(1+vit/100)*jobModHP; maxMp = (40+lv*5)*(1+int/100)*jobModMP
  → emit playerHpChanged/playerMpChanged em addExp e applyJobChange
  → **applyJobChange seta _data.title via meta.title** ← Sessão 17
  → **takeDamage corrigido (bug `let dmg = dmg` resolvido)** ← Sessão 17
  → **listener bossAbyssPoison para DoT de boss** ← Sessão 17

* entities/monsters.js: init, spawnMonster, spawnGroup, **spawnQuestBoss, despawnQuestBoss, getCatalog**, updateAll, getMesh, getById
  → **14 monstros no catálogo (10 normais + 4 mini-bosses gated)** ← Sessão 17
  → Spawn ativo no boot: 5 slimes + 3 goblins + 1 orc_warrior + 1 assassin_shadow (bosses NÃO spawnam no boot)
  → **Mini-bosses só via questBossSpawnRequest/questBossDespawnRequest events** ← Sessão 17
  → **Fases de boss 50%/25% HP com gatilhos específicos** ← Sessão 17
  → **Telegrafia visual AoE: 2s wind-up, scale 1.3x, cor vermelha** ← Sessão 17
  → **Geometrias diferenciadas por boss + anel dourado** ← Sessão 17

* entities/npcs.js: init(scene), spawnFromConfig(config), updateAll(delta, playerPos), getAll
  → **17 NPCs estáticos (5 originais + 4 mestres lv30 + 4 grão-mestres lv70 + 4 intermediários)** ← Sessão 17
  → import * as Classes (R8 exception)

* systems/classes.js: init, getBaseStats, getSkills, canJobChange, setSkillDefs, getSkillDef, getAllSkillsForClass, executeSkill, getJobMeta
  → **JOBS_META: 12 classes (4 bases + 4 evos1 + 4 evos2 populadas)** ← Sessão 17
  → **SKILL_EFFECTS registry: 36 effects funcionais (12 base + 12 evo1 + 12 ultimate)** ← Sessão 17
  → Stats base não escalam com level (Ragnarok-style)
  → Cada job tem jobModHP/jobModMP + **title** ← Sessão 17
  → **getSkills retorna cadeia herdada base→evo1→evo2** ← Sessão 17
  → **canJobChange aceita base→evo1 (lv30) E evo1→evo2 (lv70)** ← Sessão 17
  → **doJobChange REMOVIDA (era órfã; npcs.js usa Player.applyJobChange)** ← Sessão 17

* systems/combat.js (NAMED): registerTarget, unregisterTarget, findNearestTarget, canAttack, attack, castSkill, update
  → **update() processa DoT: poison + deadly_poison + abyss_poison** ← Sessão 17

* systems/inventory.js (NAMED): init, addItem, removeItem, useItem, equipItem, unequipItem, getSlots, getEquipment, getGold, setGold, getItemDef, serialize, hydrate

* systems/quests.js: init, acceptQuest, getActiveQuests, getCompleted, isActive, isCompleted, isCompletable, completeQuest, abandonQuest, getQuestDef, getState, getOfferableQuestForNpc, getTurnInQuestForNpc
  → emite jobChangeUnlocked quando completeQuest com reward.jobChange
  → Wildcard target='any' em kill objectives
  → **acceptQuest valida reqLevel + reqClass (quests evo2)** ← Sessão 17
  → **_isCurrentObjective força progressão sequencial dos objetivos** ← Sessão 17
  → **_onObjectiveComplete dispara questBossSpawnRequest SÓ quando próximo obj é "kill" com bossId** ← Sessão 17
  → **suporta objective type "talkTo" via dialogEnded event** ← Sessão 17
  → **emite questBossSpawnRequest, questBossDespawnRequest** ← Sessão 17

* ui/ui.js: init, update, showNotification, showCenterMessage, setFPS, showWindow, hideWindow, isDialogOpen, toggleQuestLog, isQuestLogOpen, updateQuestIndicators, showQuestNotification, updateHotbar, updateCooldownVisuals, toggleSkillWindow, isSkillWindowOpen, showClassSelectionModal, updateMonsterHpBars
  → import * as Combat, Player, Classes, Monsters direto (R8 violation documentada)
  → _evaluateDialogCondition aceita: questNotStarted, questActive, questCompletable, questCompleted, playerClassIs
  → **_renderPlayerName() renderiza "[title] name" no hud-name** ← Sessão 17
  → **listener jobChanged atualiza HUD imediatamente** ← Sessão 17

Padrão de imports: main.js usa namespace (import * as X). THREE via importmap. combat.js e inventory.js usam NAMED exports.

## Schema do save (v7)

player: {
  type: 'player', name, **title**, class, level (cap 99), jobLevel, exp, jobExp,
  hp, maxHp, mp, maxMp,
  baseStats: { str, agi, vit, int, dex, luk },
  statPoints, skillPoints, learnedSkills,
  equippedSkills: [string|null × 4],
  cooldowns: { [skillId]: timestamp },
  position: {x, y, z}, currentMap, playtime,
  inventory: { slots: Array(30), equipment: {weapon, armor, accessory}, gold },
  quests: { active: {}, completed: [] },
  jobHistory: [{ jobId, changedAt, level }],
  jobChangeQuestsCompleted: [string]
}

MIGRATIONS = {
  1: id, 2: id,
  3: zeny → inventory.gold,
  4: adiciona player.quests,
  5: adiciona player.equippedSkills + player.cooldowns,
  6: adiciona player.jobHistory + player.jobChangeQuestsCompleted,
  7: adiciona player.title (popula via mapping classe → título)  ← PROMPT 12
}

NPCs NÃO entram no save.
_activeBuffs do player NÃO persiste.

## Classes (12 jogáveis — todas funcionais)

### 1ª classe (escolha inicial)
| Classe | jobModHP | jobModMP | título | skills |
|--------|----------|----------|--------|--------|
| swordman | 1.0 | 0.8 | Espadachim | bash, endure, provoke |
| mage | 0.6 | 1.8 | Mago | fireball, iceBolt, lightning |
| archer | 0.9 | 1.0 | Arqueiro | doubleStrike, explosiveShot, slowShot |
| assassin | 1.0 | 1.0 | Assassino | stealthStrike, poison, evasion |

### 2ª classe (job change lv 30 + quest)
| Classe | base | jobModHP | jobModMP | statBonus | título | skills |
|--------|------|----------|----------|-----------|--------|--------|
| knight | swordman | 1.3 | 0.9 | str+3, vit+3 | Cavaleiro | bashStrong, shieldBash, auraBlade |
| wizard | mage | 0.7 | 2.2 | int+3, dex+3 | Bruxo | meteor, frostNova, chainLightning |
| hunter | archer | 1.0 | 1.1 | agi+3, dex+3 | Caçador | arrowRain, piercingShot, eagleEye |
| assassin_master | assassin | 1.2 | 1.1 | agi+3, luk+3 | Mestre Assassino | shadowClone, deadlyPoison, backstab |

### 3ª classe (job change lv 70 + quest épica — PROMPT 12)
| Classe | base | jobModHP | jobModMP | statBonus | título | skills |
|--------|------|----------|----------|-----------|--------|--------|
| lord_knight | knight | 1.6 | 0.9 | str+5, vit+5 | Lorde Cavaleiro | spiralPierce, berserk, holyCross |
| high_wizard | wizard | 0.8 | 2.6 | int+5, dex+3 | Grande Bruxo | meteorStorm, timeStop, arcaneExplosion |
| sniper | hunter | 1.1 | 1.2 | agi+5, dex+5 | Atirador de Elite | phantomArrow, sharpShoot, windWalk |
| shadow_assassin | assassin_master | 1.3 | 1.2 | agi+5, luk+3 | Assassino das Sombras | soulReap, abyssPoison, voidStep |

## Skills implementadas (36 total — 12 base + 12 evo1 + 12 ultimate)

Base e detalhes em assets/data/skills.json (schema: id, name, description, classId, mpCost, cooldown, range, targetType). Effects em classes.js SKILL_EFFECTS.

**Buffs:** endure, evasion, auraBlade, eagleEye, shadowClone, berserk, windWalk
**Debuffs:** provoked, slow_ice, slow_shot, slow_frost, poison, deadly_poison, stunned, frozen, knockback, abyss_poison
**Mecânicas especiais:** armorPierce (spiralPierce/phantomArrow/piercingShot), lifesteal (soulReap), criticoGarantido (sharpShoot), AoE multi-hit (meteorStorm)

## Monstros (14 total)

### Normais (10)
slime, goblin, lobo, besouro, esqueleto, golem-pequeno, fada-corrompida, lobisomem, orc_warrior, assassin_shadow

### Mini-bosses gated (4 — Sessão 17)
| Boss | Geometria | HP | Abilities | Linked Quest |
|------|-----------|----|-----------|--------------| 
| boss_lord_knight | OctahedronGeometry | 3000 | aoeWindup, summonAdds | quest_evo2_lord_knight |
| boss_high_wizard | IcosahedronGeometry | 2800 | teleportStrike, reflectShield | quest_evo2_high_wizard |
| boss_sniper | ConeGeometry | 2500 | invisibility, multishot | quest_evo2_sniper |
| boss_shadow_assassin | DodecahedronGeometry | 2600 | stealthStrikeFirst, spawnClones, abyssPoison | quest_evo2_shadow_assassin |

Bosses NÃO spawnam no boot. Só via questBossSpawnRequest event. Despawnam em questBossDespawnRequest (abandono/conclusão da quest). Sem respawn — quest fica completa via jobChangeQuestsCompleted.

## Items (14 total)

### Originais (10)
pocao-pequena, pocao-azul, espada-iniciante, machado-iniciante, arco-iniciante, adaga-iniciante, armadura-cloth, ouro, cristal-arcano, veneno-raro

### Fragments (4 — Sessão 17)
| Item | Type | Drop |
|------|------|------|
| fragment_lord_knight | material | orc_warrior (25%) |
| fragment_high_wizard | material | slime (20%) |
| fragment_sniper | material | goblin (20%) |
| fragment_shadow_assassin | material | assassin_shadow (30%) |

## NPCs (17 total)

### Originais (5)
mayor, blacksmith, guard, comerciante_lyra, etc.

### Mestres lv30 (4 — PROMPT 11)
mestre_knight, mestre_wizard, mestre_hunter, mestre_assassin

### Grão-mestres lv70 (4 — Sessão 17)
| ID | Posição | Quest |
|----|---------|-------|
| mestre_lord_knight | (15, 0, 8) | quest_evo2_lord_knight |
| mestre_high_wizard | (-15, 0, 8) | quest_evo2_high_wizard |
| mestre_sniper | (15, 0, -8) | quest_evo2_sniper |
| mestre_shadow_assassin | (-15, 0, -8) | quest_evo2_shadow_assassin |

### Intermediários (4 — Sessão 17, só respondem se quest_evo2_X ativa no obj 2)
| ID | Posição | Quest |
|----|---------|-------|
| eremita_kael | (25, 0, 15) | quest_evo2_lord_knight |
| oraculo_lyra | (-25, 0, 15) | quest_evo2_high_wizard |
| batedor_thorn | (25, 0, -15) | quest_evo2_sniper |
| informante_sable | (-25, 0, -15) | quest_evo2_shadow_assassin |

## Eventos do event bus

gameReady, sceneReady, saveLoaded, saveFailed, gamePaused, gameResumed
assetsProgress, assetsReady, assetLoadError, audioReady
keyPressed, keyReleased, mouseMoved, mouseClicked, mouseScrolled
playerSpawned, playerMoved, playerHpChanged, playerMpChanged, playerDied, levelUp
uiWindowOpened, uiWindowClosed, uiWindowToggle, dialogueOptionSelected
damageDealt, entityDied
monsterSpawned, monsterDied, monsterAttackRequest
itemAdded, itemRemoved, itemUsed, itemEquipped, itemUnequipped, itemDropped, itemPicked, inventoryFull, goldChanged
inventoryHealRequest, inventoryRestoreMpRequest, pickupRequest
dialogStarted, dialogEnded, dialogOptionSelected
uiHintShow, uiHintHide, npcsSpawned
questAccepted, questProgress, questCompletable, questCompleted, questAbandoned
skillCast, skillDamage, buffApplied, buffExpired, debuffApplied, mpConsumeRequest
jobChanged, jobChangeUnlocked
**questBossSpawnRequest, questBossDespawnRequest, bossAbyssPoison**  ← PROMPT 12
**reflectDamageRequest** (handler em player.js sem emitter ativo — pendência)  ← PROMPT 12

## Quests (11 total)

### Originais (3)
quest_slimes, quest_delivery, quest_forest

### Job change lv30 (4 — PROMPT 11)
quest_jobchange_knight, quest_jobchange_wizard, quest_jobchange_hunter, quest_jobchange_assassin

### Job change lv70 evo2 (4 — PROMPT 12)
Estrutura: 3 objetivos sequenciais (collect → talkTo → kill). Boss spawna SÓ quando obj 2 completa. reqLevel: 70, reqClass: classe evo1.

quest_evo2_lord_knight, quest_evo2_high_wizard, quest_evo2_sniper, quest_evo2_shadow_assassin

## Controles

* WASD: movimento (bloqueado durante diálogo)
* Botão direito: rotaciona player Y
* Mouse livre: cursor solto
* Roda: zoom (CAM_ZOOM_MIN 3, MAX 20)
* Clique esquerdo: ataque (range 3u, bloqueado durante diálogo)
* E: pickup manual (raio 1.5u, bloqueado durante diálogo)
* I: abre/fecha inventário (bloqueado durante diálogo)
* F: interagir com NPC
* J: abre/fecha Quest Log (bloqueado durante diálogo)
* K: abre/fecha janela de Skills (bloqueado durante diálogo)
* 1, 2, 3, 4: dispara skill do slot (bloqueado durante diálogo)
* Auto-pickup 0.5s raio 1.5u

## Decisões registradas (PROMPT 12)

* Mini-bosses gated via event bus (questBossSpawnRequest/Despawn) — sem nova exceção R8
* `_isCurrentObjective` força progressão sequencial — não dá pra pular objetivos
* `_onObjectiveComplete` em quests.js dispara spawn de boss SÓ quando próximo obj é "kill" com bossId
* `_onDialogEnded` em quests.js suporta objective type "talkTo"
* Fragments usam type "material" no items.json (não "quest_item") pra compatibilidade
* Skills schema confirmado: classId, mpCost, cooldown, range, targetType
* Classes.doJobChange REMOVIDA (era órfã; npcs.js usa Player.applyJobChange)
* player.title persistido no save (v7), atualizado em applyJobChange via meta.title
* ui.js _renderPlayerName() lê Player.getState().title no playerSpawned event
* Bosses despawnam após morte/abandono (sem respawn) — quest fica em jobChangeQuestsCompleted
* Telegrafia AoE: 2s wind-up + scale 1.3x + cor vermelha + uiHintShow warning
* Geometrias diferenciadas: octahedron, icosahedron, cone, dodecahedron + anel dourado em todos
* Bug `let dmg = dmg` em takeDamage corrigido (afetava todos os danos recebidos do player)

## Alertas ativos

* BUG-02 (deferido): player.js importa combat.js direto (exceção R8 justificada)
* BUG-03 (deferido): playSFX3D é stub
* BUG-05 (baixa): _bindings em input.js incompleto — pickup (E) e inventory (I) hardcoded
* BUG-06 (baixa): targetId em skillCast undefined (monstros usam id, não instanceId)
* BUG-07 (baixa): HUD de MP desync no boot — não emite playerMpChanged ao carregar
* **BUG-08 (baixa — Sessão 17):** summonAdds do boss_lord_knight sem cap/cooldown — pode spammar goblins em combates longos
* Pendência colisão player-entidade (Sessão 24)
* Pendência tratamento visual morte do player
* Pendência áudio de monstros, quests, skills (audio.json não existe ainda)
* Pendência expansão slots equipamento Ragnarok (PROMPT 13)
* Pendência quest_explore — coords no HUD
* **Pendência cosmética (Sessão 17):** fases de boss usam uiHintShow (popup pequeno); avaliar trocar pra showCenterMessage
* **Pendência (Sessão 17):** reflectDamageRequest handler em player.js sem emitter integrado — implementar quando reflect shield virar mecânica completa
* **Pendência (Sessão 17):** textos de quests evo2 mencionam direções genéricas ("nordeste", "noroeste") que não correspondem às bossPositions reais — revisar narrativa
* **Pendência (Sessão 17):** AoE damage de boss não validado em player real (não foi possível forçar posição via console)
* RECORRÊNCIA: editores corrompem código JS convertendo "X.Y(" em "[X.Y](http://X.Y)(" — alertar Perplexity. PowerShell renderiza nomes-com-ponto como link na saída; sempre confirmar no arquivo real via VS Code.
