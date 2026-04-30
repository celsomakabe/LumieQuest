---
name: lumiequest-validar-prompt
description: Faz análise crítica do resultado de um prompt do documento mestre LumieQuest 3.0. Use quando o usuário disser "validar prompt", "revisar resposta", "checar entrega" ou colar o resultado de um prompt pedindo verificação. Verifica conformidade com REGRAS_PERMANENTES R1-R10, arquivos modificados, exports coerentes com a arquitetura, presença de TODOs em código crítico, Performance Budget, incremento de saveVersion quando schema mudou, e instruções de teste manual. Lista problemas em ordem de gravidade com sugestões de correção específicas.
---

# Validar Prompt LumieQuest

Esta habilidade audita a qualidade da resposta da IA aos prompts do documento mestre. É o controle de qualidade antes de você colar o código no projeto.

## Quando usar esta habilidade

Após receber a resposta de qualquer prompt do documento mestre (1 a 20, 4.5, ou TESTES A-F), antes de:
- Colar o código nos arquivos do projeto
- Fazer commit no Git
- Marcar o prompt como aprovado

## Como executar

O usuário vai fornecer:
1. O número/título do prompt (ex: "PROMPT 5 — Combate Básico")
2. A resposta da IA com o código entregue
3. Opcionalmente: o estado anterior do projeto (estado_atual.md)

## O que verificar — checklist completa

Vá pelos 10 pontos abaixo, na ordem. Para cada um, indique APROVADO, FALHOU ou NÃO APLICÁVEL com justificativa.

### R1. Não reescreve o projeto do zero
- Verifique se a resposta usa o código existente ou se reinventa estruturas que já estavam funcionando
- Se for prompt de feature nova: confirme que módulos antigos não foram tocados sem motivo
- Se foi tocado um módulo existente: confirme que a justificativa foi dada

### R2. Atualiza apenas módulos necessários
- Confronte a lista "módulos tocados" do prompt com o que foi realmente entregue
- Sinalize módulos modificados que não estavam previstos no escopo do prompt

### R3. Imports e interfaces explícitas
- Para arquivos novos: confirme que a resposta indica EXATAMENTE onde importar (qual arquivo, qual linha aproximada)
- Para módulos novos: confirme que as exports públicas foram listadas com assinatura

### R4. Compatibilidade retroativa de saves
- Se o schema mudou: confirme que saveVersion foi incrementado
- Confirme que MIGRATIONS[N] foi adicionada para a nova versão
- Se o schema não mudou: confirme que saveVersion permaneceu igual

### R5. Sem placeholders TODO em código crítico
- Procure por: `// TODO`, `// FIXME`, `// implementar depois`, `pass`, `return null` em funções que deveriam ter lógica
- Funções vazias com comentário "vou implementar depois" são VIOLAÇÃO
- Stubs explícitos de testes ou de prompts futuros são aceitáveis se o prompt pediu stub

### R6. Performance Budget respeitado
- Confronte com os limites da Seção 4 do documento mestre:
  - 60 fps target, mínimo 30 fps
  - 100 entidades visíveis máximo
  - 50 draw calls máximo
  - 16 áudios simultâneos máximo
  - Bundle final 500 KB máximo
- Se a feature ameaça o budget: a resposta deveria ter sinalizado antes de implementar

### R7. Arquitetura de 20 módulos respeitada
- Novos módulos foram adicionados? Em qual camada?
- A camada respeita as regras de dependência?
  - core não importa de cima
  - world não importa entities
  - systems não importam entities (usam events)
  - ui lê estado via events, nunca modifica
- Módulos novos não previstos foram justificados?

### R8. Acoplamento via event bus
- Conexões entre módulos usam events.js?
- Há imports diretos onde deveria ter event?
- Eventos novos foram declarados com nome em camelCase?

### R9. JSDoc em funções públicas
- Toda export tem comentário JSDoc de pelo menos uma linha?
- Parâmetros e retornos estão documentados?

### R10. Entrega completa e instruções de teste
- A resposta lista os arquivos criados?
- Lista os arquivos modificados?
- Lista as novas exports?
- Inclui instruções de teste manual passo a passo?

## Verificações específicas para fluxo Perplexity

Adicione ao final destas verificações:

### Entrega em partes (quando aplicável)
- Se foi prompt pesado (5, 6, 9, 14, 17, 18): a IA dividiu em partes numeradas?
- Cada parte é um arquivo coeso ou bloco coerente?
- A última parte traz instruções de teste conforme R10?

### Truncamento
- Há sinais de resposta cortada (frase incompleta no final, função sem fechar)?
- Se truncada: indique exatamente onde parou para o usuário pedir continuação

## Formato de saída

Estruture a resposta assim:

### Resumo Executivo
- Status geral: APROVADO / APROVADO COM RESSALVAS / FALHOU
- Quantidade de R1-R10 violadas
- Bloqueador? (sim/não)

### Verificações por regra
Tabela ou lista numerada com R1 a R10, cada uma com:
- Status (APROVADO / FALHOU / NÃO APLICÁVEL)
- Justificativa em 1-2 frases
- Se FALHOU: linha aproximada e correção sugerida

### Problemas em ordem de gravidade
1. **Bloqueadores** — impedem commit
2. **Importantes** — devem ser corrigidos antes do próximo prompt
3. **Menores** — pode-se prosseguir mas registrar para ajuste futuro

### Correções específicas sugeridas
Para cada bloqueador/importante, dê o trecho exato a ser pedido à IA, no formato:
"Cole no Perplexity: 'A entrega do PROMPT N viola Rxx porque [motivo]. Refaça apenas o trecho [arquivo:função] aplicando [correção].'"

### Próximo passo
- Se APROVADO: "Pode colar nos arquivos e fazer commit. Atualize estado_atual.md."
- Se APROVADO COM RESSALVAS: "Pode colar mas anote os pontos menores no manualChecklist.md."
- Se FALHOU: "Não cole ainda. Peça as correções listadas acima e revalide."

## Restrições

- Seja específico: "linha 42 da função X" é melhor que "tem um bug em algum lugar"
- Não reescreva o código — apenas aponte o que está errado
- Aplicar REGRAS_PERMANENTES R1-R10 como critério principal
- Se faltar contexto para julgar (ex: você não viu o código anterior), peça ao usuário antes de declarar FALHOU
