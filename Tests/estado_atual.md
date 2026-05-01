# Estado Atual do Projeto LumieQuest

## Última atualização
- Data: 01/05/2026
- Último prompt aprovado: PROMPT 3 — Player e Movimentação
- saveVersion atual: 2
- Próximo prompt previsto: PROMPT 4 — Mundo e Mapa

## Arquivos por camada

### core/
- main.js ✅ — bootstrap, loop, classes+player integrados, auto-save 30s
- events.js ✅ — event bus (on, off, emit, once)
- save.js ✅ — CURRENT_SAVE_VERSION=2, MIGRATIONS={2}, save/load/migrateSave
- input.js ✅ — teclado/mouse, throttle 16ms, bindings configuráveis
- assets.js ✅ — cache por URL, GLTFLoader, TextureLoader, Web Audio API
- audio.js ❌ — PROMPT 4.5

### world/
- scene.js ✅ — Scene, câmera, luzes, chão, fog, setGroundTexture(), getGround()
- physics.js ✅ stub — getGroundHeight retorna 0
- world.js ❌ — PROMPT 4

### entities/
- player.js ✅ — cápsula azul, WASD, rotação por mouse, câmera orbit follow,
  takeDamage, heal, addExp, getState(), auto-save via main.js

### systems/
- classes.js ✅ stub — getBaseStats() funcional (12 jobs), demais no PROMPT 10

### ui/ — vazia

## Eventos do bus em uso
- gameReady, sceneReady, saveLoaded, saveFailed, gamePaused, gameResumed
- assetsProgress { loaded, total }, assetsReady, assetLoadError { url, error }
- keyPressed { code, action }, keyReleased { code, action }
- mouseMoved { x, y, dx, dy }, mouseClicked { button, x, y, action }, mouseScrolled { deltaY }
- playerSpawned { position }, playerMoved { position, mapId }
- playerHpChanged { current, max }, playerMpChanged { current, max }
- playerDied {}, levelUp { newLevel }

## Schema do save (v2)
- saveVersion: 2
- player: { name, class, level, jobLevel, exp, jobExp, hp, maxHp, mp, maxMp,
            baseStats, statPoints, skillPoints, learnedSkills,
            position, currentMap, zeny, playtime }
- MIGRATIONS[2]: injeta bloco player padrão em saves v1

## Dependências
- Three.js 0.169.0 via jsdelivr CDN
- importmap com "three/addons/" para GLTFLoader

## Notas técnicas
- main.js: auto-bootstrap no final (DOMContentLoaded) — não remover
- player.js: _lastMouseX rastreia posição absoluta do mouse para evitar
  rotação contínua quando input.mouse.dx persiste entre frames
- Auto-save a cada 30s via _doSave() no loop