# BLUEPRINT TÉCNICO — LumieQuest v3.0

**Status:** Aprovado em [DATA]
**Versão:** 1.0 — Consolidada após revisão crítica
**Próximo prompt:** PROMPT 1 — Engine Base e Cena 3D

Este blueprint define a arquitetura completa do projeto LumieQuest. Todos os 27 prompts subsequentes devem respeitar as decisões aqui documentadas. Em caso de conflito entre este blueprint e qualquer prompt posterior, este blueprint prevalece — ajustes só com revisão humana explícita.

---

## 1. ARQUITETURA DE MÓDULOS

### CAMADA: core

| Módulo | Responsabilidade |
|---|---|
| `main.js` | Bootstrap do jogo: inicializa todos os módulos na ordem correta e dispara o game loop via `requestAnimationFrame` |
| `events.js` | Event bus global: canal único de comunicação assíncrona entre todos os módulos |
| `input.js` | Captura e normaliza teclado e mouse, expõe estado e emite eventos de ação |
| `assets.js` | Carrega e cacheia modelos GLTF, texturas e áudios via `THREE.LoadingManager` |
| `audio.js` | Gerencia BGM com fade in/out e pool de SFX 2D e 3D posicionais — consome AudioBuffers cacheados pelo `assets.js`, nunca os armazena diretamente |
| `save.js` | Serializa/deserializa o estado completo no LocalStorage com versionamento e migração |

#### `main.js`

**Exports públicos:**

| Nome | Assinatura | Descrição |
|---|---|---|
| `init` | `init(): void` | Inicializa todos os módulos e inicia o loop |
| `getGameState` | `getGameState(): string` | Retorna estado atual: `'loading'`, `'playing'`, `'paused'` |
| `pause` | `pause(): void` | Pausa o game loop |
| `resume` | `resume(): void` | Retoma o game loop |

**Dependências:** todos os módulos de todas as camadas (único módulo que importa tudo)

**Eventos que emite:** `gameReady`, `gamePaused`, `gameResumed`

**Eventos que escuta:** `assetsReady`, `saveLoaded`

#### `events.js`

**Exports públicos:**

| Nome | Assinatura | Descrição |
|---|---|---|
| `on` | `on(event: string, cb: Function): void` | Registra listener |
| `off` | `off(event: string, cb: Function): void` | Remove listener |
| `emit` | `emit(event: string, data?: any): void` | Dispara evento com payload opcional |
| `once` | `once(event: string, cb: Function): void` | Listener que auto-remove após primeira execução |

**Dependências:** nenhuma (módulo raiz)

**Eventos que emite/escuta:** nenhum (infraestrutura pura)

#### `input.js`

**Exports públicos:**

| Nome | Assinatura | Descrição |
|---|---|---|
| `init` | `init(): void` | Registra listeners de DOM |
| `getState` | `getState(): InputState` | Retorna snapshot: `{ keys, mouse }` |
| `setBinding` | `setBinding(action: string, key: string): void` | Redefine tecla de uma ação |
| `getBinding` | `getBinding(action: string): string` | Retorna tecla atual de uma ação |

**Dependências:** `events.js`

**Eventos que emite:** `keyPressed`, `keyReleased`, `mouseMoved`, `mouseClicked`, `mouseScrolled`

**Eventos que escuta:** nenhum

#### `assets.js`

**Exports públicos:**

| Nome | Assinatura | Descrição |
|---|---|---|
| `init` | `init(): void` | Cria `LoadingManager` interno |
| `loadModel` | `loadModel(url: string): Promise<GLTF>` | Carrega modelo GLTF com cache |
| `loadTexture` | `loadTexture(url: string): Promise<Texture>` | Carrega textura com cache |
| `loadAudio` | `loadAudio(url: string): Promise<AudioBuffer>` | Carrega áudio com cache |
| `preloadAll` | `preloadAll(list: AssetEntry[]): Promise<void>` | Preload em lote com progresso |

**Dependências:** `events.js`

**Eventos que emite:** `assetsProgress` (`{ loaded, total }`), `assetsReady`

**Eventos que escuta:** nenhum

#### `audio.js`

**Regra de cache:** `assets.js` é o único dono do cache de `AudioBuffer` (por URL). `audio.js` chama `assets.loadAudio(url)` e recebe o buffer pronto — nunca faz fetch ou armazenamento próprio. Isso evita dois caches paralelos do mesmo áudio consumindo memória dupla.

**Exports públicos:**

| Nome | Assinatura | Descrição |
|---|---|---|
| `init` | `init(camera: Camera): void` | Cria `AudioListener` e pool de `PositionalAudio` |
| `playBGM` | `playBGM(url: string, volume?: number): void` | Troca BGM com fade in/out |
| `stopBGM` | `stopBGM(): void` | Para BGM atual com fade out |
| `playSFX` | `playSFX(url: string, volume?: number): void` | Toca SFX 2D (UI, notificações) |
| `playSFX3D` | `playSFX3D(url: string, position: Vector3, volume?: number): void` | Toca SFX com posição espacial |
| `setVolume` | `setVolume(type: 'bgm'\|'sfx', value: number): void` | Ajusta volume global por tipo |

**Dependências:** `events.js`, `assets.js`

**Eventos que emite:** `audioReady`

**Eventos que escuta:** `assetsReady`, `playerMoved` (atualiza posição do listener)

#### `save.js`

**Exports públicos:**

| Nome | Assinatura | Descrição |
|---|---|---|
| `init` | `init(): void` | Verifica e migra save existente |
| `save` | `save(data: SavedGame): void` | Serializa e persiste no LocalStorage |
| `load` | `load(): SavedGame \| null` | Carrega e retorna save ou null |
| `deleteSave` | `deleteSave(): void` | Remove save do LocalStorage |
| `migrateSave` | `migrateSave(data: any): SavedGame` | Migra dados de versão anterior |
| `getCurrentVersion` | `getCurrentVersion(): number` | Retorna `CURRENT_SAVE_VERSION` |

**Dependências:** `events.js`

**Eventos que emite:** `saveLoaded`, `saveFailed`

**Eventos que escuta:** nenhum

---

### CAMADA: world

| Módulo | Responsabilidade |
|---|---|
| `scene.js` | Cria e mantém `THREE.Scene`, câmera, luzes e renderer; expõe helpers de adição/remoção de objetos |
| `world.js` | Gerencia mapas, regiões, transições, ciclo dia/noite e clima dinâmico |
| `physics.js` | Fornece detecção de colisão simples contra terreno (altura Y) e entre entidades (AABB player↔monstro, monstro↔monstro), prevenindo sobreposição visual em combate |

#### `scene.js`

**Exports públicos:**

| Nome | Assinatura | Descrição |
|---|---|---|
| `init` | `init(canvas: HTMLCanvasElement): void` | Cria `Scene`, `Renderer`, câmera perspectiva e luz direcional |
| `getScene` | `getScene(): THREE.Scene` | Retorna instância da cena |
| `getCamera` | `getCamera(): THREE.Camera` | Retorna câmera ativa |
| `getRenderer` | `getRenderer(): THREE.WebGLRenderer` | Retorna renderer |
| `add` | `add(obj: Object3D): void` | Adiciona objeto à cena |
| `remove` | `remove(obj: Object3D): void` | Remove objeto da cena |
| `render` | `render(delta: number): void` | Executa render frame (chamado pelo game loop) |

**Dependências:** `events.js`, `audio.js` (para posicionar listener)

**Eventos que emite:** `sceneReady`

**Eventos que escuta:** `gameReady`

#### `world.js`

**Exports públicos:**

| Nome | Assinatura | Descrição |
|---|---|---|
| `init` | `init(): void` | Carrega mapa inicial |
| `loadMap` | `loadMap(mapId: string): Promise<void>` | Carrega geometria e metadata de um mapa |
| `getCurrentMap` | `getCurrentMap(): MapData` | Retorna dados do mapa ativo |
| `getSpawnPoints` | `getSpawnPoints(type: string): Vector3[]` | Retorna posições de spawn por tipo |
| `getDayPhase` | `getDayPhase(): 'day'\|'night'\|'dusk'\|'dawn'` | Retorna fase atual do ciclo |

**Dependências:** `events.js`, `scene.js`, `assets.js`

**Eventos que emite:** `mapLoaded`, `mapTransitionStart`, `mapTransitionEnd`, `dayPhaseChanged`

**Eventos que escuta:** `saveLoaded`, `playerExitedZone`

#### `physics.js`

**Exports públicos:**

| Nome | Assinatura | Descrição |
|---|---|---|
| `init` | `init(): void` | Prepara estruturas de colisão |
| `getGroundHeight` | `getGroundHeight(x: number, z: number): number` | Retorna altura Y do terreno |
| `checkAABB` | `checkAABB(a: Box3, b: Box3): boolean` | Testa colisão entre dois volumes |
| `raycastGround` | `raycastGround(origin: Vector3, dir: Vector3): number` | Raycast contra terreno |
| `update` | `update(delta: number): void` | Atualiza hitboxes dinâmicos |

**Dependências:** `events.js`, `scene.js`

**Eventos que emite:** nenhum

**Eventos que escuta:** `mapLoaded`

---

### CAMADA: entities

| Módulo | Responsabilidade |
|---|---|
| `player.js` | Controla o personagem do jogador: movimento, atributos, animações e vida |
| `monsters.js` | Gerencia spawn pool, IA de combate, drops e ciclo de vida dos monstros |
| `npcs.js` | Gerencia NPCs estáticos com interação de diálogo e oferta de quests/loja |
| `pets.js` | Gerencia companheiros do jogador: comportamento, buffs e coleta automática |

#### `player.js`

**Exports públicos:**

| Nome | Assinatura | Descrição |
|---|---|---|
| `init` | `init(saveData?: PlayerData): void` | Spawna player com dados do save ou novo |
| `getState` | `getState(): PlayerData` | Retorna estado completo do player |
| `getPosition` | `getPosition(): Vector3` | Retorna posição atual |
| `takeDamage` | `takeDamage(amount: number, source: string): void` | Aplica dano ao player |
| `heal` | `heal(amount: number): void` | Restaura HP |
| `addExp` | `addExp(amount: number): void` | Adiciona XP e verifica level up |
| `update` | `update(delta: number, input: InputState): void` | Atualiza movimento e animação |

**Dependências:** `events.js`, `input.js`, `scene.js`, `physics.js`, `classes.js`

> **Nota:** `equipment.js` foi propositalmente removido das dependências. O player recebe bônus de equipamento escutando o evento `itemEquipped` — import direto criaria acoplamento desnecessário entre camadas entities e systems. A regra R8 (event bus para lógica entre múltiplos módulos) se aplica aqui.

**Eventos que emite:** `playerSpawned`, `playerMoved`, `playerHpChanged`, `playerMpChanged`, `playerDied`, `levelUp`, `playerAttacked`

**Eventos que escuta:** `damageDealt`, `itemEquipped`, `jobChanged`, `mapLoaded`

#### `monsters.js`

**Exports públicos:**

| Nome | Assinatura | Descrição |
|---|---|---|
| `init` | `init(): void` | Cria pool de instâncias e registra templates |
| `spawnMonster` | `spawnMonster(templateId: string, position: Vector3): MonsterInstance` | Ativa instância do pool |
| `getVisible` | `getVisible(): MonsterInstance[]` | Retorna monstros dentro do frustum |
| `update` | `update(delta: number): void` | Atualiza IA, movimento e estado de todos os monstros ativos |
| `despawnAll` | `despawnAll(): void` | Devolve todos ao pool (troca de mapa) |

**Dependências:** `events.js`, `scene.js`, `physics.js`, `combat.js`, `inventory.js`

**Eventos que emite:** `monsterSpawned`, `monsterDied`, `monsterAggroed`, `itemDropped`

**Eventos que escuta:** `mapLoaded`, `playerMoved`, `damageDealt`

#### `npcs.js`

**Exports públicos:**

| Nome | Assinatura | Descrição |
|---|---|---|
| `init` | `init(): void` | Carrega NPCs do mapa atual |
| `getNearby` | `getNearby(position: Vector3, radius: number): NpcInstance[]` | Retorna NPCs próximos |
| `interact` | `interact(npcId: string): DialogueTree` | Inicia interação com NPC |
| `update` | `update(delta: number): void` | Anima NPCs (idle, olhar para player) |

**Dependências:** `events.js`, `scene.js`, `quests.js`

**Eventos que emite:** `npcInteracted`, `dialogueStarted`, `dialogueEnded`, `shopOpened`

**Eventos que escuta:** `mapLoaded`, `questCompleted`

#### `pets.js`

**Exports públicos:**

| Nome | Assinatura | Descrição |
|---|---|---|
| `init` | `init(saveData?: PetData[]): void` | Inicializa pets do save |
| `getActivePet` | `getActivePet(): PetInstance \| null` | Retorna pet ativo |
| `summon` | `summon(petId: string): void` | Sumona um pet |
| `dismiss` | `dismiss(): void` | Dispensa pet ativo |
| `update` | `update(delta: number): void` | Atualiza comportamento, buffs e coleta |

**Dependências:** `events.js`, `scene.js`, `player.js`, `inventory.js`

**Eventos que emite:** `petSummoned`, `petDismissed`, `petCollectedItem`, `petBuffApplied`

**Eventos que escuta:** `itemDropped`, `playerHpChanged`, `monsterDied`

---

### CAMADA: systems

| Módulo | Responsabilidade |
|---|---|
| `combat.js` | Calcula dano, crítico, elemental, aplica efeitos e gerencia cooldowns de skills |
| `inventory.js` | Gerencia slots de inventário, stack de itens, uso e descarte |
| `classes.js` | Define atributos base por job, skills disponíveis e lógica de job change |
| `equipment.js` | Aplica bônus de equipamentos e sets, valida slots disponíveis |
| `refine.js` | Lógica de refino +1 a +15, cálculo de custo, chance de sucesso e efeitos visuais |
| `cards.js` | Sistema de sockets, inserção de cartas e cálculo de bônus de build |
| `quests.js` | Rastreia progresso de quests, condições de conclusão e recompensas |

#### `combat.js`

**Exports públicos:**

| Nome | Assinatura | Descrição |
|---|---|---|
| `init` | `init(): void` | Registra listeners de combate |
| `calcDamage` | `calcDamage(attacker: Entity, defender: Entity, skill?: SkillDef): DamageResult` | Calcula dano com crítico e elemental |
| `applyDamage` | `applyDamage(target: Entity, result: DamageResult): void` | Aplica dano e emite evento |
| `useSkill` | `useSkill(entity: Entity, skillId: string): void` | Verifica MP e cooldown, dispara skill |
| `isOnCooldown` | `isOnCooldown(entity: Entity, skillId: string): boolean` | Verifica cooldown de uma skill |
| `update` | `update(delta: number): void` | Atualiza cooldowns e efeitos ativos |

**Dependências:** `events.js`, `classes.js`, `equipment.js`, `cards.js`

**Eventos que emite:** `damageDealt`, `skillUsed`, `entityDied`, `criticalHit`, `elementalHit`

**Eventos que escuta:** `playerAttacked`, `monsterAggroed`

#### `inventory.js`

**Exports públicos:**

| Nome | Assinatura | Descrição |
|---|---|---|
| `init` | `init(saveData?: InventoryData): void` | Carrega inventário do save |
| `addItem` | `addItem(item: ItemInstance): boolean` | Adiciona item, retorna false se cheio |
| `removeItem` | `removeItem(itemId: string, qty?: number): boolean` | Remove item ou quantidade |
| `useItem` | `useItem(itemId: string): void` | Usa item (poção, consumível) |
| `getItems` | `getItems(): ItemInstance[]` | Retorna todos os itens |
| `getState` | `getState(): InventoryData` | Retorna estado serializável |

**Dependências:** `events.js`, `equipment.js`

**Eventos que emite:** `itemAdded`, `itemRemoved`, `itemUsed`, `inventoryFull`

**Eventos que escuta:** `itemDropped`, `itemEquipped`

#### `classes.js`

**Exports públicos:**

| Nome | Assinatura | Descrição |
|---|---|---|
| `init` | `init(saveData?: ClassData): void` | Carrega dados de classe do save |
| `getBaseStats` | `getBaseStats(job: string, level: number): StatBlock` | Retorna atributos base |
| `getSkills` | `getSkills(job: string): SkillDef[]` | Retorna skills disponíveis para job |
| `canJobChange` | `canJobChange(player: PlayerData): boolean` | Verifica requisitos de job change |
| `doJobChange` | `doJobChange(player: PlayerData, targetJob: string): void` | Executa troca de job |

**Dependências:** `events.js`

**Eventos que emite:** `jobChanged`, `skillUnlocked`

**Eventos que escuta:** `levelUp`

#### `equipment.js`

**Exports públicos:**

| Nome | Assinatura | Descrição |
|---|---|---|
| `init` | `init(saveData?: EquipData): void` | Carrega equipamentos do save |
| `equip` | `equip(itemId: string, slot: string): boolean` | Equipa item no slot |
| `unequip` | `unequip(slot: string): ItemInstance \| null` | Desequipa e retorna item |
| `getStats` | `getStats(): StatBlock` | Retorna total de bônus dos equipamentos |
| `getSetBonus` | `getSetBonus(): StatBlock` | Retorna bônus de set ativo |
| `getEquipped` | `getEquipped(): EquipData` | Retorna estado serializável |

**Dependências:** `events.js`, `cards.js`, `refine.js`

**Eventos que emite:** `itemEquipped`, `itemUnequipped`, `setBonusActivated`

**Eventos que escuta:** `itemAdded`, `refineCompleted`, `cardInserted`

#### `refine.js`

**Exports públicos:**

| Nome | Assinatura | Descrição |
|---|---|---|
| `init` | `init(): void` | Carrega tabelas de refino |
| `getRefineInfo` | `getRefineInfo(item: ItemInstance): RefineInfo` | Retorna custo, chance e bônus do próximo nível |
| `tryRefine` | `tryRefine(itemId: string): RefineResult` | Tenta refino, retorna sucesso/falha/quebra |
| `getRefineBonus` | `getRefineBonus(item: ItemInstance): StatBlock` | Retorna bônus de refino atual |

**Dependências:** `events.js`, `inventory.js`

**Eventos que emite:** `refineCompleted`, `refineFailed`, `refineDestroyed`

**Eventos que escuta:** nenhum

#### `cards.js`

**Exports públicos:**

| Nome | Assinatura | Descrição |
|---|---|---|
| `init` | `init(): void` | Carrega definições de cartas |
| `insertCard` | `insertCard(cardId: string, itemId: string, socket: number): boolean` | Insere carta em socket |
| `removeCard` | `removeCard(itemId: string, socket: number): CardInstance \| null` | Remove carta do socket |
| `getCardBonus` | `getCardBonus(item: ItemInstance): StatBlock` | Calcula bônus total das cartas |
| `getAvailableSockets` | `getAvailableSockets(item: ItemInstance): number` | Retorna quantidade de sockets |

**Dependências:** `events.js`, `inventory.js`

**Eventos que emite:** `cardInserted`, `cardRemoved`

**Eventos que escuta:** nenhum

#### `quests.js`

**Exports públicos:**

| Nome | Assinatura | Descrição |
|---|---|---|
| `init` | `init(saveData?: QuestData): void` | Carrega estado de quests do save |
| `acceptQuest` | `acceptQuest(questId: string): boolean` | Aceita quest se disponível |
| `getActive` | `getActive(): QuestState[]` | Retorna quests em andamento |
| `getCompleted` | `getCompleted(): string[]` | Retorna IDs de quests concluídas |
| `checkProgress` | `checkProgress(event: string, data: any): void` | Atualiza progresso baseado em evento |
| `getState` | `getState(): QuestData` | Retorna estado serializável |

**Dependências:** `events.js`

**Eventos que emite:** `questAccepted`, `questProgressUpdated`, `questCompleted`, `questFailed`

**Eventos que escuta:** `monsterDied`, `itemAdded`, `npcInteracted`, `mapLoaded`, `playerHpChanged`

---

### CAMADA: ui

#### `ui.js`

**Responsabilidade:** Renderiza e atualiza toda a interface: HUD (HP/MP/XP), hotbar de skills, janelas de inventário/equipamentos, diálogos, minimapa e notificações.

**Exports públicos:**

| Nome | Assinatura | Descrição |
|---|---|---|
| `init` | `init(): void` | Cria estrutura DOM de HUD e janelas |
| `showWindow` | `showWindow(id: string): void` | Exibe janela (inventário, equipamento, quest) |
| `hideWindow` | `hideWindow(id: string): void` | Fecha janela |
| `showNotification` | `showNotification(msg: string, type: string): void` | Exibe toast temporário |
| `showDialogue` | `showDialogue(tree: DialogueTree): void` | Exibe árvore de diálogo |
| `update` | `update(delta: number): void` | Atualiza valores de HUD no frame |

**Dependências:** `events.js`

**Eventos que emite:** `uiWindowOpened`, `uiWindowClosed`, `dialogueOptionSelected`

**Eventos que escuta:** `playerHpChanged`, `playerMpChanged`, `levelUp`, `jobChanged`, `itemAdded`, `questProgressUpdated`, `questCompleted`, `monsterDied`, `dialogueStarted`, `dayPhaseChanged`

> **Nota:** `dayPhaseChanged` aciona atualização visual do minimapa e do indicador de ciclo dia/noite no HUD.

---

## 2. ARQUITETURA DE DADOS (Schemas JSON)

### player (saveVersion: 1)

```json
{
  "saveVersion": 1,
  "player": {
    "name": "string",
    "class": "swordman | knight | lord_knight | mage | wizard | high_wizard | archer | hunter | sniper | assassin | assassin_master | shadow_assassin",
    "level": 1,
    "jobLevel": 1,
    "exp": 0,
    "jobExp": 0,
    "hp": 100,
    "maxHp": 100,
    "mp": 50,
    "maxMp": 50,
    "baseStats": {
      "str": 1, "agi": 1, "vit": 1,
      "int": 1, "dex": 1, "luk": 1
    },
    "statPoints": 0,
    "skillPoints": 0,
    "learnedSkills": ["skillId"],
    "position": { "x": 0, "y": 0, "z": 0 },
    "currentMap": "city01",
    "zeny": 0,
    "playtime": 0
  }
}
```

### monster — template

```json
{
  "id": "poring",
  "name": "Poring",
  "level": 1,
  "element": "water | fire | earth | wind | none",
  "race": "plant | beast | undead | demon | angel | human",
  "size": "small | medium | large",
  "hp": 50,
  "atk": 7,
  "def": 5,
  "exp": 10,
  "jobExp": 3,
  "moveSpeed": 1.5,
  "aggroRadius": 5,
  "attackRadius": 1.5,
  "attackCooldown": 2.0,
  "dropTable": [
    { "itemId": "apple", "chance": 0.5, "qty": [1, 1] },
    { "itemId": "poring_card", "chance": 0.001, "qty": [1, 1] }
  ],
  "modelUrl": "assets/models/poring.glb",
  "sfxHit": "assets/audio/sfx/poring_hit.ogg",
  "sfxDie": "assets/audio/sfx/poring_die.ogg",
  "aiType": "passive | aggressive | assist",
  "region": ["city01", "forest01"]
}
```

### monster — instância (runtime, não persistida)

```json
{
  "instanceId": "uuid",
  "templateId": "poring",
  "hp": 50,
  "maxHp": 50,
  "state": "idle | moving | attacking | dying | dead",
  "targetId": "player | null",
  "position": { "x": 0, "y": 0, "z": 0 },
  "mesh": "THREE.Object3D (runtime only)"
}
```

### item genérico

```json
{
  "id": "apple",
  "type": "consumable | equipment | card | material | misc",
  "name": "Maçã",
  "description": "Restaura 50 HP.",
  "iconUrl": "assets/textures/icons/apple.png",
  "weight": 2,
  "price": 15,
  "stackable": true,
  "maxStack": 99
}
```

### equipamento (extends item)

```json
{
  "id": "iron_sword",
  "type": "equipment",
  "slot": "weapon | shield | helm | armor | shoes | accessory1 | accessory2",
  "jobRestriction": ["swordman", "knight"],
  "levelReq": 1,
  "stats": { "atk": 25, "def": 0 },
  "refineLevel": 0,
  "sockets": 0,
  "cards": [null, null, null, null],
  "setId": "iron_set | null",
  "grade": "normal | legendary | divine",
  "modelUrl": "assets/models/items/iron_sword.glb"
}
```

### carta (extends item)

```json
{
  "id": "poring_card",
  "type": "card",
  "name": "Carta de Poring",
  "slotType": "weapon | shield | helm | armor | shoes | accessory",
  "bonus": {
    "stat": "luk",
    "value": 5
  },
  "specialBonus": "description string | null"
}
```

### poção (extends item)

```json
{
  "id": "red_potion",
  "type": "consumable",
  "effect": {
    "type": "heal_hp | heal_mp | buff",
    "value": 50,
    "duration": 0
  },
  "cooldown": 1.0
}
```

### quest — definição

```json
{
  "id": "quest_poring_hunt",
  "type": "main | side | hunt | job | secret",
  "name": "A Praga dos Porings",
  "description": "Derrote 10 Porings na floresta.",
  "giver": "npcId_blacksmith",
  "requirements": {
    "minLevel": 1,
    "prerequisiteQuests": []
  },
  "objectives": [
    {
      "id": "obj1",
      "type": "kill | collect | talk | reach",
      "target": "poring",
      "qty": 10
    }
  ],
  "rewards": {
    "exp": 500,
    "zeny": 200,
    "items": [{ "itemId": "red_potion", "qty": 5 }]
  },
  "dialogueAccept": "dialogueId_accept",
  "dialogueComplete": "dialogueId_complete"
}
```

### quest — estado (save)

```json
{
  "questId": "quest_poring_hunt",
  "status": "available | active | completed | failed",
  "objectives": [
    { "id": "obj1", "current": 3, "required": 10 }
  ],
  "startedAt": "ISO-8601 | null",
  "completedAt": "ISO-8601 | null"
}
```

### npc

```json
{
  "id": "blacksmith_01",
  "name": "Ferreiro Armand",
  "type": "quest | shop | refine | job_change | info",
  "position": { "x": 10, "y": 0, "z": 5 },
  "map": "city01",
  "modelUrl": "assets/models/npcs/blacksmith.glb",
  "dialogues": {
    "default": "dialogueId_default",
    "quest_poring_hunt_available": "dialogueId_quest_offer",
    "quest_poring_hunt_active": "dialogueId_quest_progress",
    "quest_poring_hunt_completed": "dialogueId_quest_complete"
  },
  "shopInventory": ["iron_sword", "red_potion"],
  "refineEnabled": true
}
```

### dialogue tree

```json
{
  "id": "dialogueId_quest_offer",
  "nodes": [
    {
      "id": "node1",
      "speaker": "Ferreiro Armand",
      "text": "Você parece forte. Me ajudaria com um problema?",
      "options": [
        { "text": "Claro! Qual é o problema?", "next": "node2" },
        { "text": "Não tenho tempo.", "next": null }
      ]
    },
    {
      "id": "node2",
      "speaker": "Ferreiro Armand",
      "text": "Preciso de você para derrotar 10 Porings!",
      "action": "acceptQuest:quest_poring_hunt",
      "options": []
    }
  ]
}
```

### pet

```json
{
  "id": "baby_dragon",
  "name": "Dragãozinho",
  "type": "combat | support | collector | healer",
  "level": 1,
  "exp": 0,
  "loyalty": 0,
  "hunger": 100,
  "skills": ["fireball_small"],
  "passiveBuffs": [{ "stat": "atk", "value": 5 }],
  "behaviorRadius": 8,
  "modelUrl": "assets/models/pets/baby_dragon.glb",
  "food": "pet_biscuit",
  "evolvesAt": 50
}
```

### savedGame (estrutura completa LocalStorage)

```json
{
  "saveVersion": 1,
  "lastSaved": "2026-04-29T22:00:00.000Z",
  "player": { "...": "PlayerData" },
  "inventory": {
    "slots": 40,
    "items": [
      { "itemId": "iron_sword", "qty": 1, "instanceData": { "...": "..." } }
    ]
  },
  "equipment": {
    "weapon": { "itemId": "iron_sword", "refineLevel": 3, "cards": ["..."] },
    "helm": null,
    "armor": null,
    "shield": null,
    "shoes": null,
    "accessory1": null,
    "accessory2": null
  },
  "quests": {
    "active": [{ "...": "QuestState[]" }],
    "completed": ["quest_tutorial"],
    "failed": []
  },
  "world": {
    "currentMap": "city01",
    "visitedMaps": ["city01"],
    "dayTime": 720
  },
  "pets": {
    "owned": [{ "...": "PetData[]" }],
    "active": "baby_dragon | null"
  },
  "settings": {
    "bgmVolume": 0.8,
    "sfxVolume": 1.0,
    "bindings": { "moveUp": "KeyW", "attack": "Mouse0" }
  }
}
```

---

## 3. GAME LOOP

```
requestAnimationFrame(loop)
│
├── calcDelta() ← tempo desde último frame (cap: 100ms)
│
├── INPUT ← input.getState()
│   └── emite eventos de ação se tecla pressionada
│
├── PHYSICS ← physics.update(delta)
│   ├── atualiza hitboxes dinâmicos
│   └── resolve colisão player/terreno
│
├── ENTITIES UPDATE ← executado em ordem fixa
│   ├── player.update(delta, inputState)
│   │   ├── aplica movimento (WASD + física)
│   │   ├── atualiza câmera (orbit follow)
│   │   └── dispara playerMoved se posição mudou
│   ├── monsters.update(delta)
│   │   ├── IA: idle → patrol → aggro → attack
│   │   ├── colisão com player (AABB)
│   │   └── frustum check → despawn se fora
│   ├── npcs.update(delta)
│   │   └── animação idle
│   └── pets.update(delta)
│       ├── follow player
│       ├── coleta drops próximos
│       └── dispara habilidades passivas
│
├── SYSTEMS ← processamento de regras de jogo
│   ├── combat.update(delta) ← atualiza cooldowns, efeitos DoT
│   └── quests.checkProgress() ← verifica objetivos pendentes
│
├── RENDER ← scene.render(delta)
│   ├── THREE.WebGLRenderer.render(scene, camera)
│   └── atualiza partículas e efeitos visuais
│
└── UI UPDATE ← ui.update(delta)
    ├── atualiza barras HP/MP/XP se dirty flag
    ├── atualiza hotbar cooldowns
    └── processa fila de notificações
```

**Notas de performance:**

- `delta` é limitado a 100ms (evita spiral of death após tab switch)
- Entities só rodam update se dentro de raio de 50m do player
- UI usa dirty flag — só redesenha elementos que mudaram de valor
- Render usa frustum culling nativo do Three.js

---

## 4. EVENT BUS — Eventos Principais

| # | Evento | Emitido por | Escutado por | Payload |
|---|---|---|---|---|
| 1 | `gameReady` | `main` | `scene`, `world`, `ui` | `{}` |
| 2 | `assetsReady` | `assets` | `main`, `audio` | `{}` |
| 3 | `audioReady` | `audio` | `main`, `ui` | `{}` |
| 4 | `saveLoaded` | `save` | `main`, `world`, `player`, `inventory`, `quests`, `pets` | `SavedGame` |
| 5 | `mapLoaded` | `world` | `monsters`, `npcs`, `physics`, `audio`, `quests` | `{ mapId }` |
| 6 | `playerSpawned` | `player` | `ui`, `camera` | `{ position }` |
| 7 | `playerMoved` | `player` | `audio`, `world`, `monsters`, `quests` | `{ position, mapId }` |
| 8 | `playerHpChanged` | `player` | `ui`, `quests` | `{ current, max }` |
| 9 | `playerMpChanged` | `player` | `ui` | `{ current, max }` |
| 10 | `playerDied` | `player` | `ui`, `main` | `{}` |
| 11 | `levelUp` | `player` | `classes`, `ui`, `audio` | `{ newLevel }` |
| 12 | `jobChanged` | `classes` | `player`, `equipment`, `ui`, `audio` | `{ newJob }` |
| 13 | `playerAttacked` | `player` | `combat` | `{ attackerId, targetId, skillId }` |
| 14 | `damageDealt` | `combat` | `player`, `monsters`, `ui` | `{ targetId, amount, isCrit, element }` |
| 15 | `entityDied` | `combat` | `monsters`, `player`, `quests` | `{ entityId, type }` |
| 16 | `monsterDied` | `monsters` | `player` (exp), `quests`, `inventory` | `{ monsterId, templateId, drops[] }` |
| 17 | `itemDropped` | `monsters` | `inventory`, `pets`, `ui` | `{ itemId, position }` |
| 18 | `itemAdded` | `inventory` | `ui`, `quests`, `equipment` | `{ itemId, qty }` |
| 19 | `itemEquipped` | `equipment` | `player`, `ui` | `{ itemId, slot }` |
| 20 | `questAccepted` | `quests` | `ui`, `npcs` | `{ questId }` |
| 21 | `questCompleted` | `quests` | `player` (reward), `ui`, `npcs`, `audio` | `{ questId, rewards }` |
| 22 | `refineCompleted` | `refine` | `equipment`, `ui`, `audio` | `{ itemId, newLevel }` |
| 23 | `refineFailed` | `refine` | `ui` | `{ itemId, level }` |
| 24 | `cardInserted` | `cards` | `equipment`, `ui` | `{ cardId, itemId, socket }` |
| 25 | `dayPhaseChanged` | `world` | `scene`, `audio`, `ui` | `{ phase: 'day'\|'night'\|'dusk'\|'dawn' }` |
| 26 | `skillUsed` | `combat` | `ui`, `audio` | `{ entityId, skillId, targetId }` |

**Total: 26 eventos.**

---

## 5. SAVE MIGRATION

### Estratégia

- Cada save armazena `saveVersion: N` no nível raiz
- `CURRENT_SAVE_VERSION` é uma constante em `save.js`, incrementada a cada prompt que altera o schema
- Ao carregar, se `saveVersion < CURRENT_SAVE_VERSION`, `migrateSave()` aplica transformações sequenciais: v1 → v2 → v3 → ... → N
- Cada migração é uma função pura que recebe o objeto da versão anterior e retorna o da versão seguinte
- Nunca se pula versão — mesmo que uma migração seja trivial, ela garante o encadeamento

### Mapa de versões planejadas

| Versão | Prompt que altera | O que muda |
|---|---|---|
| 1 | PROMPT 0 | Schema base (player, inventory, quests, world) |
| 2 | PROMPT 13 | Adiciona `setId` e `grade` nos equipamentos |
| 3 | PROMPT 14 | Adiciona `refineLevel` nos equipamentos |
| 4 | PROMPT 15 | Adiciona `cards[]` e `sockets` nos equipamentos |
| 5 | PROMPT 16 | Adiciona bloco `pets` no save |

### Função migrate (pseudocódigo descritivo)

```javascript
MIGRATIONS = {
  2: (data) => {  // migra v1 → v2
    return {
      ...data,
      equipment: mapearCadaItemEquipadoPara({ setId: null, grade: "normal" })
    }
  },
  3: (data) => {  // migra v2 → v3
    return {
      ...data,
      equipment: mapearCadaItemEquipadoPara({ refineLevel: 0 })
    }
  },
  4: (data) => {  // migra v3 → v4
    return {
      ...data,
      equipment: mapearCadaItemEquipadoPara({ cards: [null,null,null,null], sockets: 0 })
    }
  },
  5: (data) => {  // migra v4 → v5
    return {
      ...data,
      pets: { owned: [], active: null }
    }
  }
}

function migrateSave(rawData) {
  let current = rawData
  while (current.saveVersion < CURRENT_SAVE_VERSION) {
    let nextVersion = current.saveVersion + 1
    current = MIGRATIONS[nextVersion](current)  // ✅ chama migração da versão DESTINO
    current.saveVersion = nextVersion
  }
  return current
}
```

### Teste mental do loop

Save está em v1. `CURRENT_SAVE_VERSION = 5`. Loop entra pois 1 < 5.

- `nextVersion = 2` → chama `MIGRATIONS[2]` → adiciona setId e grade → saveVersion = 2 ✅
- `nextVersion = 3` → chama `MIGRATIONS[3]` → adiciona refineLevel → saveVersion = 3 ✅
- `nextVersion = 4` → chama `MIGRATIONS[4]` → adiciona cards[] e sockets → saveVersion = 4 ✅
- `nextVersion = 5` → chama `MIGRATIONS[5]` → adiciona bloco pets → saveVersion = 5 ✅
- `5 < 5` é falso → loop encerra. Save migrado com sucesso.

> **Por que esta versão é correta:** o bug original chamava `MIGRATIONS[current.saveVersion]` na primeira iteração, que seria a identidade (não existe mais), causando erro silencioso ou `undefined is not a function`. A correção indexa sempre pelo `nextVersion` (destino), que é onde a transformação real está definida.

---

## 6. PERFORMANCE BUDGET — Confirmação de compliance arquitetural

| Métrica | Alvo | Como a arquitetura garante |
|---|---|---|
| 60 fps em Intel UHD | ✅ | Game loop usa `requestAnimationFrame` com delta cap; UI com dirty flag; sistemas não rodam se sem input relevante |
| 100 entidades visíveis | ✅ | `monsters.getVisible()` usa frustum culling nativo do Three.js; pool fixo de instâncias — sem new/delete por frame |
| 50 draw calls | ✅ | `InstancedMesh` para vegetação/pedras; materiais compartilhados por template de monstro; merge de geometrias estáticas por mapa |
| Pooling para drops | ✅ | Drops são Sprites reutilizáveis de um pool pré-alocado; partículas usam Points com buffer compartilhado |
| Pooling para partículas | ✅ | Pool de `THREE.Points` com `BufferGeometry` dinâmico; nunca se cria `new Mesh()` em runtime após init |

### Técnicas obrigatórias confirmadas

- **Object pooling:** pool de `MonsterInstance`, `DropSprite` e `ParticleEmitter` — alocados no init, reutilizados em runtime
- **Frustum culling:** habilitado por padrão no Three.js; `monsters.update()` só processa IA de monstros dentro do raio de 50m
- **Sombras restritas:** `DirectionalLight` com shadow map de raio 30m centrado no player; sem shadow casting em entidades distantes
- **Materiais compartilhados:** `assets.js` cacheia por URL; dois Porings usam o mesmo `MeshStandardMaterial`
- **Texturas em potência de 2:** validação no `assets.loadTexture()` — warning no console se textura não for 256/512/1024px
- **Áudio OGG:** pool de 16 `THREE.PositionalAudio` pré-criados; BGM em stream, SFX em buffer cacheado
- **LOD:** planejado para Prompt 19 via `THREE.LOD` — meshes de 3 níveis por monstro (800 / 400 / 150 tris)

---

## 7. RISCOS E DECISÕES TÉCNICAS

| # | Decisão | Motivo |
|---|---|---|
| 1 | Sem motor de física externo (Cannon.js, Rapier) — física implementada como AABB simples em `physics.js` | Motores de física adicionam 150–300KB ao bundle e complexidade de integração com Three.js. Para um RPG com terreno plano e colisão básica player/monstro, AABB customizado é suficiente e mantém o budget de 500KB. Revisitar no Prompt 19 se necessário. |
| 2 | Personagem do player como `THREE.Group` com animações via `AnimationMixer` em vez de modelos procedurais | Permite usar qualquer GLTF com armature/skinning (Kenney, Quaternius), facilitando substituição de assets sem alterar código. `AnimationMixer` é nativo do Three.js — sem dependência adicional. |
| 3 | Event bus único e global em vez de imports diretos entre módulos | Elimina dependências circulares (o maior risco em projetos Three.js incrementais). Permite adicionar novos sistemas (ex.: achievements) sem modificar módulos existentes — apenas registra listeners. Custo: levemente menos type-safe, mitigado com JSDoc. |
| 4 | Sem TypeScript — ES6 puro com JSDoc | TypeScript exigiria build step (Vite, esbuild), quebrando o fluxo de editar e abrir direto no browser via Live Server. JSDoc com `@param` e `@returns` oferece autocomplete no VS Code sem compilação. Revisitar se o projeto escalar além dos 20 prompts. |
| 5 | Save em LocalStorage em vez de IndexedDB | LocalStorage tem limite de ~5–10MB, suficiente para o schema definido (estimativa: ~50KB por save com todos os itens). IndexedDB é assíncrono e adiciona complexidade de callbacks/Promises em toda a camada de save. Se saves atingirem 3MB, migrar para IndexedDB no Prompt 20. |

---

## CHECKLIST DE APROVAÇÃO FINAL

- [x] 20 módulos presentes nas 5 camadas (core: 6, world: 3, entities: 4, systems: 7, ui: 1)
- [x] Cada módulo tem responsabilidade única
- [x] Schemas têm `saveVersion`
- [x] Event bus tem 15+ eventos (este tem 26)
- [x] Performance budget confirmado
- [x] BLOQUEADOR corrigido — `migrateSave` agora chama `MIGRATIONS[nextVersion]`
- [x] Ressalva 1 — `assets.js` é dono único do cache de `AudioBuffer`
- [x] Ressalva 2 — `equipment.js` removido das dependências de `player.js`
- [x] Ressalva 3 — `physics.js` inclui colisão entidade↔entidade na responsabilidade
- [x] Ressalva 4 — `ui.js` escuta `dayPhaseChanged`
- [x] Ressalva 5 — `audioReady` numerado na tabela de eventos (agora 26 eventos)

**Blueprint aprovado. Próximo passo: PROMPT 1 — Engine Base e Cena 3D.**
