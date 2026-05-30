/**
 * scene.js â€” Cena 3D principal do LumieQuest.
 * ResponsÃ¡vel por: THREE.Scene, cÃ¢mera, luzes, chÃ£o e renderer.
 * NÃ£o importa entities nem systems (R8 â€” acoplamento zero com camadas superiores).
 */

import * as THREE from 'three';
import * as events from '../core/events.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
/** @type {THREE.Scene} */
let _scene;

/** @type {THREE.PerspectiveCamera} */
let _camera;

/** @type {THREE.WebGLRenderer} */
let _renderer;
let _composer = null;
let _renderPass = null;
let _bloomPass = null;
let _vignettePass = null;
/**
 * Mesh do chÃ£o. Mantido em escopo de mÃ³dulo para permitir aplicaÃ§Ã£o de textura
 * via setGroundTexture() apÃ³s o pipeline de assets ficar pronto (PROMPT 2).
 * @type {THREE.Mesh|null}
 */
let _ground = null;
let _sun = null;
let _hemiLight = null;

/**
 * Inicializa cena, cÃ¢mera, luzes, chÃ£o e renderer.
 * Deve ser chamado uma Ãºnica vez em main.js durante o boot.
 * Emite 'sceneReady' ao concluir.
 * @param {HTMLCanvasElement} canvas - Elemento canvas do DOM
 */
export function init(canvas) {
  // --- Renderer ---
  _renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  _renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // MÃ¡x 2x para poupar GPU (R6)
  _renderer.setSize(window.innerWidth, window.innerHeight);
  _renderer.shadowMap.enabled = true;
  _renderer.shadowMap.type = THREE.PCFSoftShadowMap; // Sombras suaves sem custo excessivo
  _renderer.setClearColor(0x87CEEB); // Azul cÃ©u

  // --- Cena ---
  _scene = new THREE.Scene();
  _scene.fog = new THREE.FogExp2(0x87CEEB, 0.0015);

  // --- CÃ¢mera perspectiva ---
  _camera = new THREE.PerspectiveCamera(
    38,                                     // FOV: 75Â°
    window.innerWidth / window.innerHeight, // Aspect ratio
    0.1,                                    // Near plane
    1000                                    // Far plane
  );
    _camera.position.set(0, 14, 14);
    _camera.lookAt(0, 0, 0);
// --- EffectComposer + passes ---
  _composer = new EffectComposer(_renderer);
  _composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  _renderPass = new RenderPass(_scene, _camera);

  const bloomResolution = new THREE.Vector2(window.innerWidth, window.innerHeight);
  _bloomPass = new UnrealBloomPass(bloomResolution, 0.2, 0.4, 0.95);

  const VignetteShader = {
    uniforms: {
      tDiffuse: { value: null },
      offset:   { value: 1.0 },
      darkness: { value: 1.2 },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform float offset;
      uniform float darkness;
      uniform sampler2D tDiffuse;
      varying vec2 vUv;
      void main() {
        vec4 texel = texture2D( tDiffuse, vUv );
        vec2 uv = vUv - 0.5;
        float vignette = smoothstep(0.8, offset * 0.799, length(uv));
        vignette = mix(1.0, vignette, darkness);
        gl_FragColor = vec4(texel.rgb * vignette, texel.a);
      }
    `,
  };

  _vignettePass = new ShaderPass(VignetteShader);

  _composer.addPass(_renderPass);
  _composer.addPass(_bloomPass);
  _composer.addPass(_vignettePass);
  // --- HemisphereLight (substitui AmbientLight puro) ---
  _hemiLight = new THREE.HemisphereLight(
    0xb0d8ff,
    0x4a7c3a,
    0.4
  );
  _scene.add(_hemiLight);

  // --- Sol (DirectionalLight com shadow map limitado a 30m) ---
  _sun = new THREE.DirectionalLight(0xfff4e0, 1.0);
  _sun.position.set(10, 20, 10);
  _sun.castShadow = true;

  _sun.shadow.mapSize.width = 1024;
  _sun.shadow.mapSize.height = 1024;

  _sun.shadow.camera.left   = -30;
  _sun.shadow.camera.right  =  30;
  _sun.shadow.camera.top    =  30;
  _sun.shadow.camera.bottom = -30;
  _sun.shadow.camera.near   = 0.5;
  _sun.shadow.camera.far    = 100;
  _sun.shadow.bias = -0.001;

  _scene.add(_sun);
  _scene.add(_sun.target);

  // --- ChÃ£o verde (PlaneGeometry 20Ã—20) ---
  // AtribuÃ­do a _ground (escopo de mÃ³dulo) para permitir setGroundTexture() depois.
  const groundGeo = new THREE.PlaneGeometry(20, 20);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x4a7c3a, // Verde grama (serÃ¡ resetado para branco quando textura for aplicada)
    roughness: 0.9,
    metalness: 0.0,
  });
  _ground = new THREE.Mesh(groundGeo, groundMat);
  _ground.rotation.x = -Math.PI / 2; // Rotaciona para horizontal (XZ)
  _ground.receiveShadow = true;
  _scene.add(_ground);
  _ground.visible = false; // world.js cria terreno prÃ³prio

  // --- Resize handler ---
  window.addEventListener('resize', _onResize);

  events.emit('sceneReady');
}

/**
 * Atualiza cÃ¢mera e renderer quando a janela Ã© redimensionada.
 * @private
 */
function _onResize() {
  _camera.aspect = window.innerWidth / window.innerHeight;
  _camera.updateProjectionMatrix();
  _renderer.setSize(window.innerWidth, window.innerHeight);
  if (_composer) {
    _composer.setSize(window.innerWidth, window.innerHeight);
    _composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  }
}

/**
 * Executa um frame de render. Chamado pelo game loop a cada requestAnimationFrame.
 * @param {number} delta - Tempo desde o Ãºltimo frame em ms (nÃ£o usado aqui ainda)
 */
export function render(delta) {
  if (_composer) {
    _composer.render(delta);
  } else {
    _renderer.render(_scene, _camera);
  }
}

/**
 * Retorna a instÃ¢ncia da THREE.Scene.
 * @returns {THREE.Scene}
 */
export function getScene() { return _scene; }

/**
 * Retorna a cÃ¢mera perspectiva ativa.
 * @returns {THREE.PerspectiveCamera}
 */
export function getCamera() { return _camera; }

/**
 * Retorna o WebGLRenderer.
 * @returns {THREE.WebGLRenderer}
 */
export function getRenderer() { return _renderer; }
export function getComposer() { return _composer; }
export function getSun() { return _sun; }
export function getHemiLight() { return _hemiLight; }

/**
 * Atualiza cores e intensidades das luzes com base na fase do ciclo.
 * @param {'day'|'dawn'|'dusk'|'night'} cyclePhase
 * @param {number} cycleProgress
 * @param {Object} lightingConfig
 */
export function updateLighting(cyclePhase, cycleProgress, lightingConfig) {
  if (!_hemiLight || !_sun || !lightingConfig) return;

  const { day, night } = lightingConfig;
  if (!day || !night) return;

  let ambient, directional, intensity;

  if (cyclePhase === 'day') {
    ambient     = day.ambient;
    directional = day.directional;
    intensity   = day.intensity ?? 1.0;
  } else if (cyclePhase === 'night') {
    ambient     = night.ambient;
    directional = night.directional;
    intensity   = night.intensity ?? 0.6;
  } else if (cyclePhase === 'dawn') {
    ambient     = _lerpColorHex(night.ambient, day.ambient, cycleProgress);
    directional = _lerpColorHex(night.directional, day.directional, cycleProgress);
    intensity   = THREE.MathUtils.lerp(night.intensity ?? 0.6, day.intensity ?? 1.0, cycleProgress);
  } else {
    ambient     = _lerpColorHex(day.ambient, night.ambient, cycleProgress);
    directional = _lerpColorHex(day.directional, night.directional, cycleProgress);
    intensity   = THREE.MathUtils.lerp(day.intensity ?? 1.0, night.intensity ?? 0.6, cycleProgress);
  }

  if (ambient)     _hemiLight.color.set(ambient);
  if (directional) _sun.color.set(directional);
  if (typeof intensity === 'number') {
    _hemiLight.intensity = intensity * 1.4;
    _sun.intensity       = intensity;
  }

  if (_scene) {
    let bgI;
    if (cyclePhase === 'day') bgI = 1.0;
    else if (cyclePhase === 'night') bgI = 0.25;
    else if (cyclePhase === 'dawn') bgI = THREE.MathUtils.lerp(0.25, 1.0, cycleProgress);
    else bgI = THREE.MathUtils.lerp(1.0, 0.25, cycleProgress);
    _scene.backgroundIntensity = bgI;
  }

  if (_scene?.fog) {
    const fogColor = new THREE.Color(ambient ?? 0x87CEEB);
    _scene.fog.color.copy(fogColor);
    _renderer?.setClearColor(fogColor);
  }
}

function _lerpColorHex(fromHex, toHex, t) {
  const from = new THREE.Color(fromHex ?? '#ffffff');
  const to   = new THREE.Color(toHex   ?? '#ffffff');
  return '#' + from.lerp(to, THREE.MathUtils.clamp(t, 0, 1)).getHexString();
}

/**
 * Carrega e aplica skybox cubemap.
 * @param {string[]|null} urls - [px,nx,py,ny,pz,nz] ou null para resetar
 */
export function setSkybox(urls) {
  if (!_scene) return;

  if (!urls || urls.length < 6) {
    _scene.background = null;
    return;
  }

  const loader = new THREE.CubeTextureLoader();
  loader.load(
    urls,
    (cubeTexture) => {
      if (!_scene) return;
      _scene.background = cubeTexture;
      console.log('[scene] Skybox aplicado.');
    },
    undefined,
    (err) => {
      console.warn('[scene] Falha ao carregar skybox cubemap:', err);
    }
  );
}
/**
 * Adiciona um Object3D Ã  cena.
 * @param {THREE.Object3D} obj - Objeto a adicionar
 */
export function add(obj) { _scene.add(obj); }

/**
 * Remove um Object3D da cena.
 * @param {THREE.Object3D} obj - Objeto a remover
 */
export function remove(obj) { _scene.remove(obj); }

/**
 * Retorna o mesh do chÃ£o para inspeÃ§Ã£o externa (usado por physics e debug).
 * @returns {THREE.Mesh|null} Retorna null se init() ainda nÃ£o foi chamado.
 */
export function getGround() {
  return _ground;
}

/**
 * Aplica uma textura ao material do chÃ£o.
 * Configura repeat e wrapping para tile correto em terrenos grandes.
 * Chamado por main.js apÃ³s o pipeline de assets emitir 'assetsReady'.
 * @param {THREE.Texture} texture - Textura carregada via assets.loadTexture()
 * @returns {void}
 */
export function setGroundTexture(texture) {
  if (!_ground) {
    console.warn('[scene] setGroundTexture: mesh do chÃ£o nÃ£o encontrado (init() chamado?)');
    return;
  }
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(8, 8); // Tile 8x8 sobre o plano de 20Ã—20 unidades
  _ground.material.map = texture;
  _ground.material.color.set(0xffffff); // Reseta cor para branco para nÃ£o tingir a textura
  _ground.material.needsUpdate = true;
}

