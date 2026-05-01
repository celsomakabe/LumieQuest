# Estado Atual do Projeto LumieQuest

## Última atualização
- Data: 01/05/2026
- Último prompt aprovado: PROMPT 4 — Sistema de UI/HUD
- saveVersion atual: 2
- Próximo prompt previsto: PROMPT 4.5 — Sistema de Áudio Base

## Arquivos por camada

### core/
- main.js ✅ — bootstrap, loop, FPS média móvel → UI.setFPS(), auto-save 30s
- events.js ✅ — event bus
- save.js ✅ — CURRENT_SAVE_VERSION=2, MIGRATIONS={2}
- input.js ✅ — teclado/mouse, throttle 16ms, bindings
- assets.js ✅ — cache por URL, GLTFLoader, TextureLoader, Web Audio API
- audio.js ❌ — PROMPT 4.5

### world/
- scene.js ✅ — Scene, câmera, luzes, chão, fog, setGroundTexture(), getGround()
- physics.js ✅ stub
- world.js ❌

### entities/
- player.js ✅ — cápsula azul, WASD, rotação por mouse, câmera orbit follow

### systems/
- classes.js ✅ stub — getBaseStats() funcional (12 jobs)

### ui/
- ui.js ✅ — HUD HP/MP, nome, level, FPS, notificações toast, mensagens centrais, hotbar placeholder

## Eventos do bus em uso
- gameReady, sceneReady, saveLoaded, saveFailed, gamePaused, gameResumed
- assetsProgress, assetsReady, assetLoadError
- keyPressed, keyReleased, mouseMoved, mouseClicked, mouseScrolled
- playerSpawned, playerMoved, playerHpChanged, playerMpChanged, playerDied, levelUp
- uiWindowOpened, uiWindowClosed, dialogueOptionSelected

## Schema do save em uso
- saveVersion: 2
- player: { name, class, level, hp, maxHp, mp, maxMp, ... }
- MIGRATIONS[2]: injeta player default em saves v1

## Dependências
- Three.js 0.169.0 via jsdelivr CDN + importmap (com three/addons/)

## Notas técnicas
- main.js: FPS counter migrado para ui.js; main.js calcula média móvel 30 frames e chama UI.setFPS()
- ui.js: dirty flag — só redesenha elemento se valor mudou
- ui.js: notificações via DOM puro, sem libs externas
- player.js: _lastMouseX para rotação correta
- Pastas js/entities/ e js/systems/ em minúsculas (case-sensitive)
- js/ui/ criada (nova pasta)