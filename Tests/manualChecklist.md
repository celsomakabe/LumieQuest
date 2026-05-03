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