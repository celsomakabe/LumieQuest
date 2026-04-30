---
name: lumiequest-buscar-asset-gratuito
description: Pesquisa assets gratuitos (áudio, modelo 3D, textura, ícone) para o projeto LumieQuest priorizando licenças permissivas. Use quando o usuário pedir SFX, BGM, modelo 3D, textura, sprite, ícone, asset, recurso ou similar. Busca prioritariamente em Kenney.nl (CC0), OpenGameArt.org, Freesound.org e Poly Pizza. Retorna nome, link direto, licença, tamanho aproximado e adequação ao Performance Budget. Nunca sugere recursos do Ragnarok original ou de jogos comerciais.
---

# Buscar Asset Gratuito LumieQuest

Esta habilidade encontra recursos visuais e sonoros gratuitos para o projeto, com foco em licenças permissivas (CC0 e CC-BY) que permitem uso pessoal sem violar direitos autorais.

## Quando usar esta habilidade

O usuário vai pedir assets em momentos específicos do projeto:

- **PROMPT 4.5 (Áudio Base):** SFX de UI, passos, BGM da cidade
- **PROMPT 5 (Combate):** SFX de swing, hit, critical, miss
- **PROMPT 6 (Monstros):** SFX de hit, die, aggro por monstro
- **PROMPT 14 (Refino):** SFX icônicos de martelo, sucesso, falha
- **PROMPT 17 (Mundo):** BGMs por região, ambient sounds, áudio espacial
- **PROMPT 18 (Bosses):** BGMs épicas, SFX dramáticos
- **PROMPT 19 (Polimento):** texturas, modelos 3D para substituir placeholders

## Hierarquia de fontes

Sempre busque nesta ordem de prioridade:

### 1. Kenney.nl (PRIMEIRA OPÇÃO)
- URL: https://kenney.nl/assets
- Licença: CC0 (domínio público) — uso totalmente livre
- Forte em: SFX de UI, packs de áudio para games, modelos 3D estilizados, ícones
- Buscar por: "RPG Audio", "UI Audio", "Impact Sounds", "Fantasy", "Music Loops"

### 2. OpenGameArt.org
- URL: https://opengameart.org/
- Licenças variadas — sempre verificar (preferir CC0 ou CC-BY)
- Forte em: música de fundo, sprites 2D, modelos 3D, sound effects
- Filtrar por licença antes de recomendar

### 3. Freesound.org
- URL: https://freesound.org/
- Licenças variadas — sempre verificar (preferir CC0)
- Forte em: SFX específicos, ambient sounds, gravações de campo
- Excelente para sons ambientais (chuva, vento, gotas, etc.)

### 4. Poly Pizza
- URL: https://poly.pizza/
- Licenças CC-BY ou CC0 (filtrar)
- Forte em: modelos 3D estilo low-poly, perfeitos para o budget de polígonos do projeto

### 5. Pixabay
- URL: https://pixabay.com/sound-effects/ ou https://pixabay.com/music/
- Licença Pixabay (uso livre comercial e pessoal)
- Forte em: música de fundo licenciada para uso livre

## O que retornar para cada asset

Para cada recurso recomendado, forneça:

1. **Nome do pack ou arquivo individual**
2. **Link direto** (URL completa)
3. **Licença explícita** (CC0, CC-BY, Pixabay License, etc.)
4. **Atribuição necessária** (sim/não — se sim, formato sugerido)
5. **Tamanho aproximado** (KB ou MB)
6. **Adequação ao Performance Budget:**
   - BGM por mapa: alvo 1 MB, máximo 2 MB (formato OGG)
   - SFX individual: alvo 50 KB, máximo 150 KB (formato OGG)
   - Modelo de monstro: ~800 polígonos alvo, máximo 1500
   - Modelo de equipamento: ~400 polígonos alvo, máximo 800
   - Texturas: potências de 2 (256, 512, 1024)
7. **Conversão necessária:**
   - MP3 → OGG (recomenda-se Audacity ou ffmpeg)
   - GLTF/FBX → GLB (mais leve para web)
   - PNG → otimização com TinyPNG

## Convenções de nome para o projeto

Sugira sempre nomes seguindo a convenção do documento mestre:

### Áudio
- `bgm_<contexto>.ogg` — ex: `bgm_city.ogg`, `bgm_forest.ogg`, `bgm_boss_hydra.ogg`
- `sfx_<categoria>_<acao>.ogg` — ex: `sfx_combat_hit.ogg`, `sfx_ui_click.ogg`, `sfx_refine_success.ogg`

### Modelos 3D
- `model_<categoria>_<id>.glb` — ex: `model_monster_slime.glb`, `model_weapon_sword01.glb`

### Texturas
- `tex_<categoria>_<id>.png` — ex: `tex_terrain_grass.png`, `tex_ui_button.png`

## Restrições obrigatórias

### NUNCA sugerir
- **Trilha sonora original do Ragnarok Online** (copyright SoundTeMP/Gravity)
- **Assets de jogos comerciais** (World of Warcraft, Final Fantasy, Diablo, etc.)
- **Sprites/modelos rippados** de jogos pagos
- **Música popular** ou trilhas de filmes/séries
- **Recursos com licença "non-commercial only"** sem alertar o usuário
- **Recursos sem licença explícita** (assumir que é proibido se não estiver claro)

### SEMPRE alertar
- Se o asset exigir atribuição (CC-BY): forneça o texto de atribuição pronto para incluir nos créditos do jogo
- Se o asset estiver acima do Performance Budget: avise antes
- Se o formato não for nativo da web: indique a conversão necessária

## Formato de saída

Estruture a resposta assim:

### Resumo da busca
1-2 frases sobre o que foi encontrado.

### Recomendações principais (3-5 opções)

Para cada uma, forneça uma tabela ou bloco assim:

```
**[Nome do asset]**
- Fonte: [site]
- Link: [URL]
- Licença: [CC0/CC-BY/Pixabay]
- Atribuição: [Sim, formato: "..." / Não]
- Tamanho: [X KB/MB]
- Performance Budget: [Dentro / Acima / Precisa otimização]
- Conversão necessária: [Não / Sim: descrever]
- Nome sugerido no projeto: [seguindo convenção]
- Por que recomendo: [1 frase]
```

### Notas sobre licenciamento
Se houver assets CC-BY: monte o bloco de créditos para o usuário copiar para um arquivo `CREDITS.md` no projeto.

### Próximos passos
- Como baixar
- Onde colocar no projeto (`assets/audio/`, `assets/models/`, etc.)
- Se precisa converter, qual ferramenta usar
