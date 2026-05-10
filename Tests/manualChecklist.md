# LumieQuest — Manual Checklist

Documento de validação manual por sessão. Atualizar a cada TESTE.

## TESTE B — Combate (Sessão 10)

Escopo: Sistema de combate (PROMPT 5) + Monstros e IA (PROMPT 6).

| # | Item | Status | Como validar |
|---|------|--------|--------------|
| 1 | Player ataca monstros e causa dano | ✅ | Clique esquerdo em monstro a <3u; popup vermelho aparece |
| 2 | Monstros atacam player e causam dano | ✅ | Encostar em monstro; HP no HUD diminui |
| 3 | Crítico funciona (5%, x2 dano) | ✅ | 20+ ataques; popup amarelo com ★ aparece |
| 4 | Cooldown 1s impede spam de ataque | ✅ | Cliques rápidos só causam dano 1x/segundo |
| 5 | IA: idle → aggro → chase → attack | ✅ | Aproxima/encosta/afasta confirma transições |
| 6 | Respawn de monstro após 30s | ✅ | Mata monstro; reaparece após 30s |
| 7 | HP do player na HUD atualiza | ✅ | Visível durante combate |
| 8 | playerDied dispara quando HP=0 | ✅ | Listener temporário confirmou |
| 9 | Damage popups corretos (cor/posição) | ✅ | Vermelho normal, amarelo+★ crítico |
| 10 | SFX combate (swing/hit/critical/miss) | ✅ | Todos tocam corretamente |
| 11 | SFX monstro (hit/die/aggro) | N/A | Adiado — soundProfile vazio até audio.json existir |
| 12 | Múltiplos sons simultâneos sem distorcer | ✅ | 5 monstros + player atacando, sem estouro |
| 13 | Performance 60fps com 8 monstros | ✅ | HUD FPS estável |
| 14 | Estado de combate NÃO persiste no save | ✅ | F5 respawna todos os monstros mortos |
| 15 | Nenhum monstro preso em estado inválido | ✅ | 5min de teste sem comportamento anômalo |

## Bugs encontrados e corrigidos no TESTE B

| Bug | Módulo | Correção |
|-----|--------|----------|
| `playerDied` não emitia ao morrer | combat.js | Adicionado `if (target.hp <= 0) emit('playerDied')` após `playerHpChanged` |

## Bugs adiados

| Bug | Memória | Sessão alvo |
|-----|---------|-------------|
| Tratamento visual de morte do player | 14 | Sessão 11+ (Inventário/UI) ou polimento futuro |
| Colisão player-entidade | 10 | Sessão 24 (mundo) |
| Áudio de monstros (soundProfile) | 13 | Quando audio.json for criado |
| Câmera moderna (botão direito) | 11 | Sessão 11 ou 12 |

## Performance Budget (R6)

| Limite | Estado | OK |
|--------|--------|-----|
| 60 FPS | 60fps com 8 monstros + IA + áudio | ✅ |
| ≤ 100 entidades | 9 (1 player + 8 monstros) | ✅ |
| ≤ 50 draw calls | Não medido formalmente, sem regressão visual | ✅ |
| ≤ 16 áudios simultâneos | Pool de 16 SFX no audio.js | ✅ |

---

## PROMPT 10 — Classes Base e Skills
**saveVersion:** 5
**Data de aprovação:** ___/___/______
**Resultado geral:** ☐ Aprovado ☐ Reprovado (bugs pendentes)

> **Nota de debug:** Player é exposto em `window.Player` para inspeção via console (DevTools). Use `window.Player.getState()` em qualquer passo que peça consulta ao estado.

---

### P10-01 — Modal de classe (jogo novo)
- [ ] Apagar localStorage (`F12 → Application → Storage → Clear site data`)
- [ ] Recarregar página
- [ ] Modal de escolha de classe aparece sobre tela escura antes de qualquer spawn
- [ ] Modal contém exatamente 4 cards: Swordman, Mage, Archer, Assassin
- [ ] Cada card exibe nome, descrição curta e 3 skills listadas
- [ ] ESC **não** fecha o modal
- [ ] Não existe botão "Cancelar"

---

### P10-02 — Escolha de Swordman
- [ ] Clicar "Escolher" no card Swordman
- [ ] Modal fecha imediatamente
- [ ] Player spawna sem erros no console
- [ ] `window.Player.getState().class` === `'swordman'`
- [ ] `window.Player.getState().learnedSkills` === `['bash', 'endure', 'provoke']`
- [ ] `window.Player.getState().equippedSkills` === `['bash', 'endure', 'provoke', null]`
- [ ] `window.Player.getState().cooldowns` === `{}` (objeto vazio)

---

### P10-03 — Hotbar visual
- [ ] Hotbar visível no rodapé centralizado com 4 slots
- [ ] Slots 1, 2, 3 com fundo laranja (cor swordman) e inicial da skill (B, E, P)
- [ ] Slot 4 vazio: borda tracejada, sem ícone
- [ ] Cada slot exibe número da tecla (1, 2, 3, 4) no canto inferior direito
- [ ] Slots 1, 2, 3 exibem mpCost no canto superior esquerdo (10, 8, 6)
- [ ] Hotbar não obstrui visão principal nem bloqueia cliques

---

### P10-04 — Skill Bash (hotkey 1, alvo no alcance)
- [ ] Aproximar de monstro (distância ≤ 3u)
- [ ] Pressionar `1`
- [ ] Monstro recebe dano (HP visível diminui)
- [ ] MP do player reduz em 10
- [ ] Barra de MP do HUD atualiza
- [ ] Overlay escuro sobe no slot 1 e decresce ao longo de 3s
- [ ] Console: `Events.on('skillCast', console.log)` mostra evento

---

### P10-05 — Skill sem alvo
- [ ] Afastar de todos os monstros (mais que 3u do mais próximo)
- [ ] Pressionar `1`
- [ ] Notificação "Sem alvo no alcance." aparece
- [ ] MP **não** é deduzido
- [ ] Cooldown **não** é ativado

---

### P10-06 — Skill durante cooldown
- [ ] Usar Bash com sucesso (P10-04)
- [ ] Imediatamente pressionar `1` novamente
- [ ] Notificação "Skill em recarga." aparece
- [ ] MP **não** é deduzido adicionalmente
- [ ] Overlay continua descendo normalmente

---

### P10-07 — Skill Endure (hotkey 2, self buff)
- [ ] Pressionar `2` (Endure)
- [ ] MP reduz em 8
- [ ] Skill funciona sem alvo (targetType: self)
- [ ] Console: `window.Player.getState()._activeBuffs` contém `{ id: 'endure', ... }`
- [ ] Receber dano de monstro nos próximos 5s: dano recebido ~50% do normal
- [ ] Após 5s: buff sai do array `_activeBuffs`, dano volta ao normal

---

### P10-08 — Skill Provoke (hotkey 3)
- [ ] Aproximar de monstro (distância ≤ 5u)
- [ ] Pressionar `3` (Provoke)
- [ ] MP reduz em 6
- [ ] Console: evento `debuffApplied` emitido com `{ debuffId: 'provoked', targetId: <instanceId>, ... }`
- [ ] `targetId` no payload **não é** `undefined`

---

### P10-09 — Janela de Skills (tecla K)
- [ ] Pressionar `K`
- [ ] Janela abre centralizada na tela
- [ ] Movimento WASD continua funcionando com janela aberta
- [ ] Lista exibe as 3 skills aprendidas com nome, descrição, MP e cooldown
- [ ] 4 slots no topo da janela mostram: Bash / Endure / Provoke / —
- [ ] Pressionar `K` novamente: janela fecha
- [ ] Reabrir janela e pressionar `ESC`: janela fecha

---

### P10-10 — Equipar skill via janela K
- [ ] Abrir janela K
- [ ] Clicar em "Bash" na lista: item fica destacado (borda azul claro)
- [ ] Clicar no slot 4 no topo da janela
- [ ] `window.Player.getState().equippedSkills[3]` === `'bash'`
- [ ] Slot 4 da hotbar atualiza visualmente (cor + inicial + mpCost)
- [ ] Pressionar `4` com monstro no alcance: Bash dispara

---

### P10-11 — Limpar slot via janela K
- [ ] Com slot 4 preenchido (P10-10)
- [ ] Abrir janela K e clicar no ✕ do slot 4
- [ ] `window.Player.getState().equippedSkills[3]` === `null`
- [ ] Slot 4 da hotbar volta para estado vazio (borda tracejada)

---

### P10-12 — Persistência de save (v5)
- [ ] Estado: Swordman com skills equipadas nos slots 1-3
- [ ] Aguardar auto-save (≥ 30s) ou mover player
- [ ] Recarregar página (`F5`)
- [ ] Modal de classe **não** aparece (player.class já definido)
- [ ] `window.Player.getState().class` === `'swordman'` após reload
- [ ] `equippedSkills` e `learnedSkills` persistidos

---

### P10-13 — Migration v4 → v5
- [ ] Apagar localStorage primeiro
- [ ] Criar save v4 manual no console:
```js
  localStorage.setItem('lumiequest_save', JSON.stringify({
    saveVersion: 4,
    player: {
      name: 'Teste', class: 'swordman', level: 5,
      jobLevel: 1, exp: 0, jobExp: 0,
      hp: 100, maxHp: 100, mp: 50, maxMp: 50,
      baseStats: { str:5, agi:3, vit:4, int:1, dex:2, luk:1 },
      statPoints: 0, skillPoints: 0,
      learnedSkills: ['bash','endure','provoke'],
      position: { x:0, y:0, z:0 }, currentMap: 'city01', playtime: 0,
      inventory: { slots: [], equipment: { weapon:null, armor:null, accessory:null }, gold: 0 },
      quests: { active: {}, completed: [] }
    }
  }));
```
- [ ] Recarregar página
- [ ] Modal de classe **não** aparece (class já definido)
- [ ] `window.Player.getState().equippedSkills` === `[null, null, null, null]`
- [ ] `window.Player.getState().cooldowns` === `{}`
- [ ] Level, exp, gold, quests intactos
- [ ] `JSON.parse(localStorage.getItem('lumiequest_save')).saveVersion` === `5` após próximo save

---

### P10-14 — Classe Mage
- [ ] Apagar localStorage, recarregar, escolher Mage
- [ ] `learnedSkills` === `['fireball', 'iceBolt', 'lightning']`
- [ ] Hotbar com fundo azul (cor mage)
- [ ] Pressionar `1` com monstro no alcance (range 6u): Fire Ball dispara em AoE raio 2u
- [ ] Pressionar `2` (Ice Bolt): dano + `debuffApplied` com `debuffId: 'slow_ice'`
- [ ] Pressionar `3` (Lightning): dano elétrico aplicado

---

### P10-15 — Classe Archer
- [ ] Apagar localStorage, recarregar, escolher Archer
- [ ] Pressionar `1` (Double Strike): 2 eventos `skillDamage` emitidos no console
- [ ] Pressionar `2` (Explosive Shot): dano principal + dano AoE em monstros adjacentes (raio 2.5u)
- [ ] Pressionar `3` (Slow Shot): dano + `debuffApplied` com `debuffId: 'slow_shot'`

---

### P10-16 — Classe Assassin
- [ ] Apagar localStorage, recarregar, escolher Assassin
- [ ] Pressionar `1` (Stealth Strike) **no primeiro hit** de monstro fresco: payload com `isCritical: true`
- [ ] Pressionar `1` novamente no mesmo monstro: `isCritical: false`
- [ ] Pressionar `2` (Poison): `debuffApplied` com `debuffId: 'poison'`
- [ ] Aguardar 5s: HP do monstro decresce 1× por segundo (DoT)
- [ ] Após 5s: debuff `poison` removido (verificar `monster._activeDebuffs`)
- [ ] Pressionar `3` (Evasion): `_activeBuffs` contém `evasion`
- [ ] Receber ataques por 4s: alguns evadidos (50% chance), com `damageDealt` payload `evaded: true, amount: 0`
- [ ] Após 4s: buff sai do array

---

### P10-17 — Bloqueio durante diálogo
- [ ] Iniciar diálogo com NPC (tecla F)
- [ ] Pressionar `1`, `2`, `3`, `4`: nenhuma skill dispara
- [ ] Pressionar `K`: janela de skills **não** abre
- [ ] Confirmar que WASD continua bloqueado (consistência com PROMPT 8)
- [ ] Fechar diálogo: hotkeys voltam a funcionar

---

### P10-18 — MP insuficiente
- [ ] Console: `window.Player.getState().mp = 0`
- [ ] Pressionar qualquer hotkey de skill com custo > 0
- [ ] Notificação "MP insuficiente." aparece
- [ ] Nenhum dano aplicado, cooldown não ativado

---

### P10-19 — Performance com skills ativas
- [ ] Com 8 monstros spawnados (poping natural na cidade)
- [ ] Usar Evasion (buff ativo) + Poison em 3 monstros + Endure simultâneos
- [ ] FPS ≥ 30 (idealmente 60) com buffs/debuffs ativos
- [ ] Nenhum erro no console

---

### Bugs encontrados no PROMPT 10
| # | Descrição | Severidade | Status |
|---|-----------|------------|--------|
|   |           |            |        |

---

### Observações
_Espaço livre para comportamentos inesperados, melhorias e pendências._

---

### Resumo PROMPT 10 — entrega real

**Arquivos modificados:**
- `assets/data/skills.json` (criado) — 12 skill definitions
- `js/systems/classes.js` — JOBS_META, SKILL_EFFECTS, getSkills populada, setSkillDefs, getSkillDef, getAllSkillsForClass, executeSkill
- `js/core/save.js` — CURRENT_SAVE_VERSION 4→5, MIGRATIONS[5] (equippedSkills + cooldowns)
- `js/core/input.js` — bindings skill1-4, skillWindow
- `js/systems/combat.js` — castSkill, update(delta) com DoT/expiração, evasion + endure em attack()
- `js/entities/player.js` — consumeMp, _activeBuffs, expiração em update, endure em takeDamage, listener mpConsumeRequest
- `js/ui/ui.js` — hotbar, janela K (com ESC), modal de classe, updateHotbar, updateCooldownVisuals, toggleSkillWindow, isSkillWindowOpen, showClassSelectionModal
- `js/core/main.js` — fetch skills.json, modal condicional, listener mpConsumeRequest, Combat.update + UI.updateCooldownVisuals no loop, window.Player exposto p/ debug
- `tests/manualChecklist.md` — testes P10-01 a P10-19

**Eventos novos no bus:**
| Evento | Emitido por | Payload |
|---|---|---|
| `skillCast` | combat.js | `{ skillId, casterId, targetId, success }` |
| `skillDamage` | classes.js (SKILL_EFFECTS) | `{ skillId, target, damage, isCritical }` |
| `buffApplied` | classes.js (SKILL_EFFECTS) | `{ buffId, casterId, expiresAt }` |
| `buffExpired` | player.js | `{ buffId, casterId }` |
| `debuffApplied` | classes.js (SKILL_EFFECTS) | `{ debuffId, targetId, expiresAt }` |
| `mpConsumeRequest` | combat.js (castSkill) | `{ amount }` |

**Compatibilidade retroativa (R4):** saves v4 migram para v5 sem perda.
**Performance budget (R6):** Iteração linear sobre `_targets` (<20 entidades), sem alocações por frame fora da expiração de buffs.
**R8:** ui.js importa Combat/Player/Classes diretamente (decisão B(a) registrada — exceção justificada). Combat.js → Classes.js mesmo padrão. Player.consumeMp via evento (mpConsumeRequest) preserva R8 entre combat e player.