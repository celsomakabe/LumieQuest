# Estado Atual do Projeto LumieQuest

## Última atualização
- Data: 01/05/2026
- Último prompt aprovado: PROMPT 2 — Loader de Assets e Input Centralizado
- saveVersion atual: 1
- Próximo prompt previsto: PROMPT 3 — Player Controller e Movimento

## Arquivos por camada

### core/
- main.js ✅ completo — bootstrap, loop com delta cap, assets+input integrados, textura procedural no chão, fluxo assetsReady→gameReady→loop
- events.js ✅ completo — event bus (on, off, emit, once)
- save.js ✅ completo — CURRENT_SAVE_VERSION=1, MIGRATIONS={}, save/load/migrateSave
- input.js ✅ completo — keydown/up, mousemove (throttle 16ms), click, wheel, bindings configuráveis, getState()
- assets.js ✅ completo — LoadingManager, GLTFLoader, TextureLoader, Web Audio API, cache por URL, preloadAll com progress/error, único dono do cache AudioBuffer
- audio.js ❌ não implementado (PROMPT 4.5)

### world/
- scene.js ✅ completo — THREE.Scene, câmera, HemisphereLight, sol com sombra 30m, chão verde, fog; getGround() e setGroundTexture() adicionados
- physics.js ✅ stub — getGroundHeight retorna 0, demais funções são stubs
- world.js ❌ não implementado

### entities/, systems/, ui/ — todas vazias

## Eventos do bus em uso
- gameReady        — emitido por main após assetsReady
- sceneReady       — emitido por scene (sem listeners ainda)
- saveLoaded       — emitido por save (sem listeners ainda)
- gamePaused       — emitido por main
- gameResumed      — emitido por main
- assetsProgress   — emitido por assets { loaded, total }; escutado por main (log)
- assetsReady      — emitido por assets; escutado por main (once)
- assetLoadError   — emitido por assets { url, error }; escutado por main (log)
- keyPressed       — emitido por input { code, action } — VALIDADO via debug
- keyReleased      — emitido por input { code, action } — VALIDADO via debug
- mouseMoved       — emitido por input { x, y, dx, dy } (throttle 16ms) — VALIDADO via debug
- mouseClicked     — emitido por input { button, x, y, action }
- mouseScrolled    — emitido por input { deltaY }

## Schema do save em uso
- saveVersion: 1
- MIGRATIONS: {} vazio
- STORAGE_KEY: "lumiequest_save"

## Dependências
- Three.js 0.169.0 via jsdelivr CDN + importmap
- importmap inclui "three/addons/" para GLTFLoader

## Notas técnicas e correções
- main.js: auto-bootstrap adicionado manualmente ao final do arquivo, pois o agente do Perplexity entregou init() exportada sem chamada de execução. O bloco usa DOMContentLoaded check para garantir DOM pronto antes de init().

## Observações de teste manual (Prompt 2)
- WASD: keyPressed/keyReleased validados via listener de debug no console
- Mouse: mouseMoved com throttle funcionando, dx/dy coerentes
- Pipeline de assets: 1/1 carregado, gameReady emitido após assetsReady
- Textura procedural visível no chão (ruído verde 64x64)
- FPS: 60 estável
- DOMContentLoaded: 353ms, Load: 515ms (dentro do budget)
- Aviso conhecido: "Violation: requestAnimationFrame handler took ~100ms" no primeiro frame, provavelmente devido à compilação de shader inicial. Não bloqueia. Investigar no PROMPT 20 (Otimização).