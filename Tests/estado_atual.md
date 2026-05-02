# Estado Atual do Projeto LumieQuest

## Última atualização
- Data: 02/05/2026
- Último prompt aprovado: PROMPT 4.5 — Sistema de Áudio Base
- saveVersion atual: 2
- Próximo prompt: PROMPT 5 — Monstros e IA Base

## Arquivos por camada

### core/
- main.js ✅ — bootstrap, loop, FPS via UI.setFPS, auto-save 30s, fluxo assetsReady→loop, Audio.init + playBGM
- events.js ✅ — event bus
- save.js ✅ — CURRENT_SAVE_VERSION=2, MIGRATIONS={2}
- input.js ✅ — teclado/mouse, throttle 16ms
- assets.js ✅ — cache por URL, GLTFLoader, TextureLoader, Web Audio API (loadAudio)
- audio.js ✅ — BGM fade in/out, pool 16 SFX 2D, setVolume, playSFX3D stub

### world/
- scene.js ✅ — Scene, câmera, luzes, chão, fog, setGroundTexture, getGround
- physics.js ✅ stub
- world.js ❌

### entities/
- player.js ✅ — cápsula, WASD, rotação por mouse, câmera orbit

### systems/
- classes.js ✅ stub — getBaseStats funcional

### ui/
- ui.js ✅ — HUD HP/MP, nome, level, FPS, notificações toast, SFX em notif e levelUp

## Eventos do bus em uso
- gameReady, sceneReady, saveLoaded, saveFailed, gamePaused, gameResumed
- assetsProgress, assetsReady, assetLoadError
- audioReady
- keyPressed, keyReleased, mouseMoved, mouseClicked, mouseScrolled
- playerSpawned, playerMoved, playerHpChanged, playerMpChanged, playerDied, levelUp
- uiWindowOpened, uiWindowClosed, dialogueOptionSelected

## Schema do save em uso
- saveVersion: 2 (sem alteração neste prompt)
- player: { name, class, level, hp, maxHp, mp, maxMp, ... }

## Dependências
- Three.js 0.169.0 via jsdelivr CDN + importmap (com three/addons/)

## Assets disponíveis no projeto
- assets/audio/bgm/bgm_city.ogg
- assets/audio/sfx/sfx_ui_click.ogg
- assets/audio/sfx/sfx_ui_hover.ogg
- assets/audio/sfx/sfx_levelup.ogg

## Notas técnicas
- audio.js usa AudioContext único (reutiliza assets._getAudioCtx se exposto)
- Hierarquia de gain: source → slotGain → sfxGain → masterGain → destination
- BGM usa gainNode individual por source para fade isolado
- Pool de 16 GainNodes pré-alocados; AudioBufferSourceNode descartável por chamada
- playSFX3D é stub — implementação completa no PROMPT 17
- AudioContext resume automático no primeiro pointerdown/keydown (política autoplay)
- main.js tem auto-bootstrap manual (DOMContentLoaded check) — preservado
- player.js usa _lastMouseX para rotação — preservado
- assets.js é dono único de AudioBuffer cache (blueprint §1) — respeitado