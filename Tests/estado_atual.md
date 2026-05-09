# Estado Atual — LumieQuest

**Sessão atual:** 14 (aguardando início)\
**Último PROMPT aprovado:** PROMPT 9 (Sistema de Quests)\
**saveVersion:** 4

## Sessões fechadas

* PROMPT 1-4 (engine, scene, player, save)
* PROMPT 4.5 (Áudio Base) — saveVersion 2
* PROMPT 5 (Combate)
* PROMPT 6 (Monstros) — 5 slimes + 3 goblins
* TESTE B (Sessão 10) — player death adiado para polimento futuro
* PROMPT 7 (Inventário) — saveVersion 3, migration zeny→inventory.gold
* PROMPT 8 (NPCs e Diálogos) — 5 NPCs estáticos, janela de diálogo, bloqueio Ragnarok-style
* PROMPT 9 (Sistema de Quests) — saveVersion 4, 3 quests, Quest Log (J), indicadores NPC, notificações

## Arquivos existentes

js/core/        → main.js, events.js, save.js, input.js, assets.js, audio.js\
js/world/       → scene.js, physics.js (stub)\
js/entities/    → player.js, monsters.js, npcs.js\
js/systems/     → classes.js, combat.js, inventory.js, quests.js\
js/ui/          → ui.js\
assets/data/    → monsters.json, items.json, npcs.json, quests.json\
assets/audio/bgm/ → bgm_city.ogg\
assets/audio/sfx/ → ui_click, ui_hover, levelup, footsteps_grass1, footsteps_grass2, combat_swing, combat_hit, combat_critical, combat_miss\
tests/          → manualChecklist.md, estado_atual.md

## Exports públicos

* core/events.js: on, off, emit, once

* core/save.js: init, save, load, deleteSave, migrateSave, getCurrentVersion (CURRENT_SAVE_VERSION = 4)

* core/input.js: init, getState, setBinding, getBinding\
  → binding adicionado: interact → 'KeyF'\
  → binding adicionado: questLog → 'KeyJ'

* core/audio.js: init, playBGM, stopBGM, playSFX, playSFX3D (stub), setVolume, getVolume

* core/assets.js: init, loadModel, loadTexture, loadAudio, preloadAll, getAudioContext

* world/scene.js: init, render, getScene, getCamera, getRenderer, add, remove, getGround, setGroundTexture

* world/physics.js: init, getGroundHeight, checkAABB, raycastGround, update

* entities/player.js: init(saveData), getState, getPosition, getInstance, takeDamage, heal, restoreMp, addExp, update(delta, inputState)\
  → bloqueio WASD/ataque via flag local _dialogOpen + Events.on('dialogStarted'/'dialogEnded')

* entities/monsters.js: init, spawnMonster, spawnGroup, updateAll

* entities/npcs.js: init(scene), spawnFromConfig(config), updateAll(delta, playerPos), getAll\
  → detecta proximidade (raio 2u), emite uiHintShow/uiHintHide\
  → ouve keyPressed { code: 'KeyF' } → emite dialogStarted\
  → flag local _dialogOpen via Events.on('dialogStarted'/'dialogEnded')\
  → _evaluateCondition: testa questAvailable, questActive, questCompletable contra Quests module\
  → _executeAction: executa acceptQuest e completeQuest via Quests module\
  → filtra nós do dialogTree por condition antes de exibir opções\
  → bloqueia tecla F durante diálogo ativo

* systems/classes.js: init, getBaseStats, getSkills, canJobChange, doJobChange

* systems/combat.js (NAMED): registerTarget, unregisterTarget, findNearestTarget, canAttack, attack

* systems/inventory.js (NAMED): init, addItem, removeItem, useItem, equipItem, unequipItem, getSlots, getEquipment, getGold, setGold, getItemDef, serialize, hydrate

* systems/quests.js: init, acceptQuest, getActive, getCompleted, isQuestAvailable, isQuestActive, isQuestCompletable, completeQuest, abandonQuest, getQuestDef, getState (11 exports)\
  → init(saveData): carrega quests ativas e concluídas do save\
  → escuta monsterDied → atualiza objetivos kill\
  → escuta itemAdded → atualiza objetivos collect\
  → escuta playerMoved → atualiza objetivos reach\
  → emite questAccepted, questProgress, questCompletable, questCompleted, questAbandoned\
  → getState(): retorna { active: {}, completed: [] } serializável para save

* ui/ui.js: init, update, showNotification, showCenterMessage, setFPS, showWindow, hideWindow, isDialogOpen, toggleQuestLog, isQuestLogOpen, updateQuestIndicators, showQuestNotification\
  → janela de diálogo: abre em dialogStarted, fecha em ESC ou opção terminal\
  → emite dialogEnded, dialogOptionSelected\
  → ouve uiHintShow / uiHintHide para hint dourado na base da tela\
  → Quest Log (J): painel lateral com lista de quests ativas e barras de progresso individuais\
  → toggleQuestLog(): bloqueado se isDialogOpen() for true\
  → ESC com Quest Log aberto → fecha via evento uiWindowClosed\
  → indicadores NPC sobre mesh: ! amarelo (quest disponível), ? cinza (quest ativa), ? amarelo (quest completável)\
  → símbolo NPC: pos3D.y += 0.9 (valor confirmado em teste manual)\
  → showQuestNotification(): toast com nome da quest ao aceitar/completar\
  → updateQuestIndicators(): atualiza sprites de indicador ao receber questAccepted/questCompletable/questCompleted

Padrão de imports: main.js usa namespace (import * as X). THREE via importmap. combat.js e inventory.js usam NAMED exports.

## Schema do save (v4)

player: {\
  type: 'player', name, class, level, jobLevel, exp, jobExp,\
  hp, maxHp, mp, maxMp,\
  baseStats: { str, agi, vit, int, dex, luk },\
  statPoints, skillPoints, learnedSkills,\
  position: {x, y, z}, currentMap, playtime,\
  inventory: {\
    slots: Array(30) — null OU { itemId, qty },\
    equipment: { weapon: null, armor: null, accessory: null },\
    gold: number\
  },\
  quests: {\
    active: { [questId]: { progress: { [objectiveId]: number }, acceptedAt: ISO-8601 } },\
    completed: [ questId, ... ]\
  }\
}

MIGRATIONS = {\
  1: id,\
  2: id,\
  3: move player.zeny → player.inventory.gold,\
  4: adiciona player.quests = { active: {}, completed: [] }\
}

NPCs NÃO entram no save (estáticos).

## Quests implementadas (assets/data/quests.json)

| ID | Nome | Tipo | Objetivo | Status |
|---|---|---|---|---|
| quest_slimes | Caçada aos Slimes | kill | Matar 5 slimes | ✅ Funcional |
| quest_delivery | Entrega Urgente | collect | Coletar 1 pacote_prefeito | ✅ Funcional |
| quest_explore | Exploração da Floresta | reach | Chegar ao ponto de observação | ⏳ Adiado — sem coords visíveis no HUD |

## Eventos do event bus

gameReady, sceneReady, saveLoaded, saveFailed, gamePaused, gameResumed\
assetsProgress, assetsReady, assetLoadError, audioReady\
keyPressed, keyReleased, mouseMoved, mouseClicked, mouseScrolled\
playerSpawned, playerMoved (com previousPosition), playerHpChanged, playerMpChanged, playerDied, levelUp\
uiWindowOpened, uiWindowClosed, uiWindowToggle, dialogueOptionSelected\
damageDealt ({ attacker, target, amount, isCritical }), entityDied ({ entity })\
monsterSpawned, monsterDied, monsterAttackRequest\
itemAdded, itemRemoved, itemUsed, itemEquipped, itemUnequipped, itemDropped, itemPicked, inventoryFull, goldChanged\
inventoryHealRequest, inventoryRestoreMpRequest, pickupRequest\
dialogStarted { npcId, npcName, dialogTree }\
dialogEnded { npcId }\
dialogOptionSelected { npcId, nodeId, optionIndex }\
uiHintShow { message }\
uiHintHide {}\
npcsSpawned { count }\
questAccepted { questId }\
questProgress { questId, objectiveId, current, required }\
questCompletable { questId }\
questCompleted { questId, rewards }\
questAbandoned { questId }

## Estado de implementação

* core/main.js: completo\
  → import NPCs, NPCs.init(Scene.getScene()), fetch npcs.json + NPCs.spawnFromConfig()\
  → NPCs.updateAll(delta, Player.getPosition()) no loop\
  → import Quests, Quests.init(saveData.player.quests)\
  → Quests.getState() sincronizado no ciclo de save\
  → listener questCompleted → entrega recompensas (exp, gold, items) ao player\
  → flag _dialogOpen local + Events.on('dialogStarted'/'dialogEnded')\
  → KeyE (pickupRequest) e KeyI (uiWindowToggle) bloqueados quando _dialogOpen

* core/events.js: completo

* core/save.js: completo (v4, migrations 1→4)

* core/input.js: completo — bindings: interact: 'KeyF', questLog: 'KeyJ'

* core/assets.js: completo

* core/audio.js: completo (playSFX3D = stub, BUG-03 ativo)

* world/scene.js: completo

* world/physics.js: stub (getGroundHeight retorna 0; AABB/raycast pendentes)

* entities/player.js: completo — WASD e ataque bloqueados via _dialogOpen local

* entities/monsters.js: completo (5 slimes + 3 goblins, IA idle/aggro/chase/attack, respawn 30s)

* entities/npcs.js: completo\
  → 5 NPCs estáticos, diálogo em árvore, hint HUD, bloqueio F durante diálogo\
  → _evaluateCondition e _executeAction integrados com quests.js via event bus\
  → indicadores de quest atualizados via updateQuestIndicators()

* systems/classes.js: completo (12 jobs)

* systems/combat.js: completo

* systems/inventory.js: completo (30 slots, 3 equip slots)

* systems/quests.js: completo\
  → 11 exports, 3 listeners (monsterDied, itemAdded, playerMoved)\
  → 5 eventos emitidos (questAccepted, questProgress, questCompletable, questCompleted, questAbandoned)\
  → persistência via getState() → save.js → localStorage

* ui/ui.js: completo\
  → Quest Log (J) com barras de progresso individuais por objetivo\
  → indicadores NPC (!/? coloridos) com altura pos3D.y += 0.9\
  → notificações de quest ao aceitar e completar\
  → isDialogOpen() bloqueia Quest Log\
  → ESC fecha Quest Log via uiWindowClosed\
  → hint HUD dourado na base da tela

## Controles

* WASD: movimento (bloqueado durante diálogo)
* Botão direito segurado: rotaciona player Y (livre durante diálogo)
* Mouse livre: cursor solto
* Roda: zoom (CAM_ZOOM_MIN 3, MAX 20) (livre durante diálogo)
* Clique esquerdo: ataque (range 3u) (bloqueado durante diálogo)
* E: pickup manual (raio 1.5u) (bloqueado durante diálogo)
* I: abre/fecha inventário (bloqueado durante diálogo)
* F: interagir com NPC (abre diálogo)
* J: abre/fecha Quest Log (bloqueado durante diálogo)
* Auto-pickup 0.5s raio 1.5u (não bloqueado durante diálogo)

## Alertas ativos

* BUG-02: player.js importa combat.js direto (exceção justificada à R8)
* BUG-03: playSFX3D é stub
* Pendência colisão player-entidade (Sessão 24)
* Pendência tratamento visual morte do player (polimento futuro)
* Pendência áudio de monstros (audio.json futuro)
* Pendência expansão slots equipamento Ragnarok (PROMPT 13)
* Pendência quest_explore — coordenada de destino depende de HUD com coords visíveis
* Editores corrompem código convertendo "Save.save(" em link markdown — alertar Perplexity para entregar JS puro
* TODO: SFX ao abrir diálogo (npcs.js linha 169) — aguarda audio.json
* TODO: SFX de quests comentados em quests.js — aguarda audio.json