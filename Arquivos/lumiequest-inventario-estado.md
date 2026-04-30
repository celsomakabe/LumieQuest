---
name: lumiequest-inventario-estado
description: Faz inventário do estado atual do projeto LumieQuest baseado no conteúdo de tests/estado_atual.md ou nos arquivos JS colados pelo usuário. Use quando o usuário disser "inventário", "INV", "estado do projeto", "antes de começar prompt N", "começar nova sessão" ou colar arquivos de código pedindo análise. Não modifica nada — apenas inventaria arquivos por camada (core/world/entities/systems/ui), exports públicos, schema do save, eventos do bus, estado de implementação (completo/parcial/stub) e confirma o próximo prompt do documento mestre. Aplica REGRAS_PERMANENTES R1-R10.
---

# Inventário de Estado LumieQuest

Esta habilidade executa o PROMPT INV do documento mestre LumieQuest 3.0. É o snapshot que ancora o contexto antes de qualquer prompt de feature.

## Quando esta habilidade é acionada

O usuário vai pedir o inventário em uma destas situações:

1. **Início de uma nova sessão de trabalho** — antes de qualquer prompt de feature numerado (1 a 20) ou de TESTE (A a F).
2. **Retomada de projeto após pausa** — sempre que o usuário voltar ao projeto após mais de 24h.
3. **Nova janela de chat** — sempre que o histórico anterior tiver sido perdido.
4. **Suspeita de contexto poluído** — quando respostas anteriores estiverem ignorando código existente.

## Como executar

O usuário vai colar uma destas duas formas de input:

### Modo A — Resumo (mais comum)
Conteúdo do arquivo `tests/estado_atual.md` do projeto, com formato:

```
# Estado Atual do Projeto LumieQuest
## Última atualização
Data: [DATA]
Último prompt aprovado: PROMPT [N]
saveVersion atual: [VERSÃO]

## Arquivos por camada
### core/
- main.js (completo)
- ...

## Eventos do bus em uso
- playerSpawned, playerMoved, ...

## Próximo prompt previsto
PROMPT [N+1] — [Título]
```

### Modo B — Arquivos completos
Conteúdo bruto dos arquivos `.js` do projeto, identificados por nome ou caminho.

## O que entregar

Sempre responda com estas 6 seções, na ordem, sem código novo:

### 1. Arquivos existentes por camada

Liste os arquivos confirmados, agrupados nas 5 camadas da arquitetura:

- **core/** : main, events, input, assets, audio, save
- **world/** : scene, world, physics
- **entities/** : player, monsters, npcs, pets
- **systems/** : combat, inventory, classes, equipment, refine, cards, quests
- **ui/** : ui

Indique se cada arquivo está presente ou ausente.

### 2. Exports públicos

Para cada módulo presente, liste:
- Nome da export (função, classe ou constante)
- Assinatura (parâmetros e retorno)
- 1 frase descrevendo o que faz

Se não tiver acesso ao código completo, indique "exports inferidos pelo estado_atual.md" e liste o que dá para deduzir.

### 3. Schema do save

Confirme:
- saveVersion atual
- Campos do objeto savedGame
- Migrações registradas em MIGRATIONS

### 4. Eventos do bus em uso

Liste todos os eventos que aparecem no projeto até o momento. Use os nomes exatos (camelCase): playerMoved, monsterDied, itemDropped, questCompleted, audioReady, etc.

### 5. Estado de implementação

Para cada módulo, classifique:
- **completo** — funcional e testado
- **parcial** — implementado mas não cobre tudo do escopo previsto
- **stub** — placeholder, não funcional ainda
- **ausente** — não existe ainda

### 6. Próximo prompt

- Confirme qual prompt do documento mestre está em fila para execução
- Liste os módulos que esse prompt deve criar ou modificar
- Sinalize qualquer dependência que ainda não esteja pronta (ex: "PROMPT 9 precisa do PROMPT 8 completo, mas npcs.js está apenas parcial")

## Restrições

- **NÃO escreva código.** Esta habilidade é puramente analítica.
- **NÃO proponha mudanças.** Apenas inventarie.
- **NÃO assuma.** Se algo não estiver claro no input, pergunte ou marque como "não verificável com o material fornecido".
- **Aplicar REGRAS_PERMANENTES R1-R10** do documento mestre como contexto, especialmente R7 (respeitar arquitetura de 20 módulos) e R10 (formato de entrega).

## Formato de saída

Use cabeçalhos `##` para cada uma das 6 seções. Use listas com bullets ou tabelas conforme apropriado. Termine sempre com a Seção 6 confirmando o próximo passo, para o usuário poder seguir direto para o próximo prompt.
