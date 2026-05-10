# Estado Atual — LumieQuest

**Sessão atual:** 16 (aguardando início)
**Último PROMPT aprovado:** PROMPT 10 (Classes Base e Skills)
**saveVersion:** 5

## Sessões fechadas

* PROMPT 1-4 (engine, scene, player, save)
* PROMPT 4.5 (Áudio Base) — saveVersion 2
* PROMPT 5 (Combate)
* PROMPT 6 (Monstros) — 5 slimes + 3 goblins
* TESTE B (Sessão 10) — player death adiado
* PROMPT 7 (Inventário) — saveVersion 3
* PROMPT 8 (NPCs e Diálogos) — 5 NPCs estáticos
* PROMPT 9 (Sistema de Quests) — saveVersion 4
* TESTE C (Sessão 14) — pulado (testes manuais individuais conforme "Como testar")
* PROMPT 10 (Classes Base e Skills) — saveVersion 5

## Arquivos existentes

js/core/        → main.js, events.js, save.js, input.js, assets.js, audio.js
js/world/       → scene.js, physics.js (stub)
js/entities/    → player.js, monsters.js, npcs.js
js/systems/     → classes.js, combat.js, inventory.js, quests.js
js/ui/          → ui.js
assets/data/    → monsters.json, items.json, npcs.json, quests.json, skills.json
assets/audio/bgm/ → bgm_city.ogg
assets/audio/sfx/ → ui_click, ui_hover, levelup, footsteps_grass1, footsteps_grass2, combat_swing, combat_hit, combat_critical, combat_miss
tests/          → manualChecklist.md, estado_atual.md

## Exports públicos

* core/events.js: on, off, emit, once

* core/save.js: init, save, load, deleteSave, migrateSave, getCurrentVersion (CURRENT_SAVE_VERSION = 5)

* core/input.js: init, getState, setBinding, getBinding
  → bindings: WASD, mouse, E (pickup), I (inventário), F (interact NPC), J (questLog), botão direito (camera)
  → bindings PROMPT 10: skill1='Digit1', skill2='Digit2', skill3='Digit3', skill4='Digit4', skillWindow='KeyK'

* core/audio.js: init, playBGM, stopBGM, playSFX, playSFX3D (stub), setVolume, getVolume

* core/assets.js: init, loadModel, loadTexture, loadAudio, preloadAll, getAudioContext

* world/scene.js: init, render, getScene, getCamera, getRenderer, add, remove, getGround, setGroundTexture

* world/physics.js: init, getGroundHeight, checkAABB, raycastGround, update

* entities/player.js: init(saveData), getState, getPosition, getInstance, takeDamage, heal, restoreMp, consumeMp, addExp, update(delta, inputState)
  → bloqueio WASD/ataque via _dialogOpen
  → listener mpConsumeRequest → consumeMp
  → _activeBuffs com expiração no update (emite buffExpired)
  → endure consultado em takeDamage (defenseMultiplier)
  → init: HP/MP restaurados pra max no boot (relogar = full)
  → regen passivo HP/MP a cada 6s (tick com mínimo 1)

* entities/monsters.js: init, spawnMonster, spawnGroup, updateAll, getMesh, getById

* entities/npcs.js: init(scene), spawnFromConfig(config), updateAll(delta, playerPos), getAll

* systems/classes.js: init, getBaseStats, getSkills, canJobChange, doJobChange, setSkillDefs, getSkillDef, getAllSkillsForClass, executeSkill
  → JOBS_META: skills + allowedWeapons (apenas 4 bases populadas; evos vazias)
  → SKILL_EFFECTS registry: 12 effects funcionais
  → _applyDamage helper (mexe em entity.hp direto, emite entityDied + monsterDied)
  → _applyBuff e _applyDebuff helpers

* systems/combat.js (NAMED): registerTarget, unregisterTarget, findNearestTarget, canAttack, attack, castSkill, update
  → attack() consulta _activeBuffs do target: evasion (esquiva) e endure (redução)
  → update(delta): tick de DoTs (poison) + expiração de debuffs em _targets
  → castSkill: valida classe/skill/MP/cooldown/range, emite mpConsumeRequest, registra cooldown, executa effect via Classes.executeSkill, emite skillCast

* systems/inventory.js (NAMED): init, addItem, removeItem, useItem, equipItem, unequipItem, getSlots, getEquipment, getGold, setGold, getItemDef, serialize, hydrate

* systems/quests.js: init, acceptQuest, getActive, getCompleted, isQuestAvailable, isQuestActive, isQuestCompletable, completeQuest, abandonQuest, getQuestDef, getState

* ui/ui.js: init, update, showNotification, showCenterMessage, setFPS, showWindow, hideWindow, isDialogOpen, toggleQuestLog, isQuestLogOpen, updateQuestIndicators, showQuestNotification, updateHotbar, updateCooldownVisuals, toggleSkillWindow, isSkillWindowOpen, showClassSelectionModal, updateMonsterHpBars
  → import * as Combat, Player, Classes, Monsters direto (R8 violation documentada)
  → Hotbar 4 slots, ícone colorido por classe + inicial, mpCost, overlay de cooldown
  → Janela K (toggle, lista skills aprendidas, equipar via clique skill→slot, limpar via ✕, ESC fecha)
  → Modal de classe (4 cards, sem ESC, callback onChosen)
  → Barras de HP flutuantes 3D sobre monstros (criadas em monsterSpawned, removidas em monsterDied, atualizadas no game loop)

Padrão de imports: main.js usa namespace (import * as X). THREE via importmap. combat.js e inventory.js usam NAMED exports.

## Schema do save (v5)

player: {
  type: 'player', name, class, level, jobLevel, exp, jobExp,
  hp, maxHp, mp, maxMp,
  baseStats: { str, agi, vit, int, dex, luk },
  statPoints, skillPoints, learnedSkills,
  equippedSkills: [string|null × 4],   ← PROMPT 10
  cooldowns: { [skillId]: timestamp },  ← PROMPT 10 (sempre zerado no boot)
  position: {x, y, z}, currentMap, playtime,
  inventory: { slots, equipment, gold },
  quests: { active, completed }
}

MIGRATIONS = {
  1: id, 2: id,
  3: zeny → inventory.gold,
  4: adiciona player.quests,
  5: adiciona player.equippedSkills + player.cooldowns
}

NPCs NÃO entram no save (estáticos).
_activeBuffs do player NÃO persiste.

## Skills implementadas (assets/data/skills.json)

| ID | Classe | mpCost | CD | Range | Tipo |
|---|---|---|---|---|---|
| bash | swordman | 10 | 3 | 3 | enemy |
| endure | swordman | 8 | 12 | 1.5 | self |
| provoke | swordman | 6 | 8 | 5 | enemy |
| fireball | mage | 12 | 4 | 6 | aoe |
| iceBolt | mage | 10 | 3 | 7 | enemy |
| lightning | mage | 12 | 5 | 7 | enemy |
| doubleStrike | archer | 8 | 3 | 7 | enemy |
| explosiveShot | archer | 12 | 6 | 7 | aoe |
| slowShot | archer | 8 | 5 | 7 | enemy |
| stealthStrike | assassin | 10 | 6 | 2 | enemy |
| poison | assassin | 8 | 8 | 2 | enemy |
| evasion | assassin | 6 | 10 | 1.5 | self |

Buffs/debuffs implementados:
- Buffs: endure (defenseMultiplier 0.5, 5s), evasion (evasionBonus 0.5, 4s)
- Debuffs: provoked (4s), slow_ice (slowAmount 0.3, 3s), slow_shot (0.5, 4s), poison (DoT 1s tick, 5s)

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
skillCast { skillId, casterId, targetId, success }              ← PROMPT 10
skillDamage { skillId, target, damage, isCritical }              ← PROMPT 10
buffApplied { buffId, casterId, expiresAt }                       ← PROMPT 10
buffExpired { buffId, casterId }                                  ← PROMPT 10
debuffApplied { debuffId, targetId, expiresAt }                   ← PROMPT 10
mpConsumeRequest { amount }                                       ← PROMPT 10

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
* K: abre/fecha janela de Skills (bloqueado durante diálogo) ← PROMPT 10
* 1, 2, 3, 4: dispara skill do slot (bloqueado durante diálogo, alvo via Combat.findNearestTarget) ← PROMPT 10
* Auto-pickup 0.5s raio 1.5u

## Debug

* `window.Player` exposto no boot para inspeção via DevTools
* `getState()` retorna CÓPIA (spread). Para mutar valores reais, importe Player diretamente: `await import('./js/entities/player.js')`

## Alertas ativos

* BUG-02 (deferido): player.js importa combat.js direto (exceção R8 justificada)
* BUG-03 (deferido): playSFX3D é stub
* BUG-05 (NOVO, baixa): _bindings em input.js está incompleto — falta pickup (E) e inventory (I), que estão hardcoded em ui.js/main.js. Não impacta funcionalidade.
* BUG-06 (NOVO, baixa): targetId em skillCast vem undefined porque monstros usam `id` (não `instanceId` como o briefing assumia). Investigar/normalizar em sessão futura.
* BUG-07 (NOVO, baixa): HUD de MP desync no boot — não emite playerMpChanged ao carregar player. Visualmente fica em valor stale até primeira mudança.
* Pendência colisão player-entidade (Sessão 24)
* Pendência tratamento visual morte do player (polimento futuro)
* Pendência áudio de monstros e quests (audio.json não existe ainda)
* Pendência expansão slots equipamento Ragnarok (PROMPT 13)
* Pendência quest_explore — coordenada de destino depende de HUD com coords visíveis
* Editores corrompem código convertendo "Save.save(" em link markdown — alertar Perplexity para entregar JS puro

## Decisões registradas (PROMPT 10)

* ui.js importa Combat/Player/Classes/Monsters direto (exceção R8, decisão B(a) da Sessão 15)
* Combat → Player via evento mpConsumeRequest (preserva R8 entre systems e entities)
* Skill effects são funções em classes.js indexadas por skillId (SKILL_EFFECTS registry); skills.json contém apenas dados serializáveis
* Modal de classe só dispara se player.class vazio; save existente respeitado
* mp/maxMp mantidos (não renomear pra sp); skill.mpCost no JSON (não spCost)
* equippedSkills [4 slots fixos], cooldowns {} sempre zerado no boot (performance.now reinicia)
* Hotkeys 1-4 e K bloqueados durante _dialogOpen
* Alvo de skill resolvido via Combat.findNearestTarget na hora do cast (Ragnarok-style)
* HP/MP restaurados pra max no Player.init (estilo MMO: relogar = full)
* Regen passivo HP/MP tick 6s, fórmula Ragnarok com mínimo 1 garantido
* SKILL_EFFECTS usa _applyDamage(entity, amount, ctx) em vez de target.takeDamage (monstros não tinham método)