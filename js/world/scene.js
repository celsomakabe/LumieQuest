/**
 * scene.js — Cena 3D principal do LumieQuest.
 * Responsável por: THREE.Scene, câmera, luzes, chão e renderer.
 * Não importa entities nem systems (R8 — acoplamento zero com camadas superiores).
 */

import * as THREE from 'three';
import * as events from '../core/events.js';

/** @type {THREE.Scene} */
let _scene;

/** @type {THREE.PerspectiveCamera} */
let _camera;

/** @type {THREE.WebGLRenderer} */
let _renderer;

/**
 * Mesh do chão. Mantido em escopo de módulo para permitir aplicação de textura
 * via setGroundTexture() após o pipeline de assets ficar pronto (PROMPT 2).
 * @type {THREE.Mesh|null}
 */
let _ground = null;

/**
 * Inicializa cena, câmera, luzes, chão e renderer.
 * Deve ser chamado uma única vez em main.js durante o boot.
 * Emite 'sceneReady' ao concluir.
 * @param {HTMLCanvasElement} canvas - Elemento canvas do DOM
 */
export function init(canvas) {
  // --- Renderer ---
  _renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  _renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Máx 2x para poupar GPU (R6)
  _renderer.setSize(window.innerWidth, window.innerHeight);
  _renderer.shadowMap.enabled = true;
  _renderer.shadowMap.type = THREE.PCFSoftShadowMap; // Sombras suaves sem custo excessivo
  _renderer.setClearColor(0x87CEEB); // Azul céu

  // --- Cena ---
  _scene = new THREE.Scene();
  _scene.fog = new THREE.Fog(0x87CEEB, 60, 200); // Névoa distante combina com céu

  // --- Câmera perspectiva ---
  _camera = new THREE.PerspectiveCamera(
    38,                                     // FOV: 75°
    window.innerWidth / window.innerHeight, // Aspect ratio
    0.1,                                    // Near plane
    1000                                    // Far plane
  );
    _camera.position.set(0, 14, 14);
    _camera.lookAt(0, 0, 0);

  // --- Luz ambiente (HemisphereLight) ---
  // Céu azul de cima, reflexo verde do chão de baixo — mais natural que AmbientLight puro
  const hemiLight = new THREE.HemisphereLight(
    0xb0d8ff, // skyColor: azul claro
    0x4a7c3a, // groundColor: verde grama
    0.4       // intensidade baixa — o sol faz o trabalho principal
  );
  _scene.add(hemiLight);

  // --- Sol (DirectionalLight com shadow map limitado a 30m) ---
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.0); // Luz solar levemente quente
  sun.position.set(10, 20, 10);
  sun.castShadow = true;

  // Shadow map de 1024x1024 — boa qualidade sem explodir a VRAM (R6)
  sun.shadow.mapSize.width = 1024;
  sun.shadow.mapSize.height = 1024;

  // Raio de sombra de 30m centrado na origem (conforme blueprint R6)
  sun.shadow.camera.left   = -30;
  sun.shadow.camera.right  =  30;
  sun.shadow.camera.top    =  30;
  sun.shadow.camera.bottom = -30;
  sun.shadow.camera.near   = 0.5;
  sun.shadow.camera.far    = 100;
  sun.shadow.bias = -0.001; // Elimina shadow acne no chão

  _scene.add(sun);
  _scene.add(sun.target); // Target padrão na origem (0,0,0)

  // --- Chão verde (PlaneGeometry 20×20) ---
  // Atribuído a _ground (escopo de módulo) para permitir setGroundTexture() depois.
  const groundGeo = new THREE.PlaneGeometry(20, 20);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x4a7c3a, // Verde grama (será resetado para branco quando textura for aplicada)
    roughness: 0.9,
    metalness: 0.0,
  });
  _ground = new THREE.Mesh(groundGeo, groundMat);
  _ground.rotation.x = -Math.PI / 2; // Rotaciona para horizontal (XZ)
  _ground.receiveShadow = true;
  _scene.add(_ground);

  // --- Resize handler ---
  window.addEventListener('resize', _onResize);

  events.emit('sceneReady');
}

/**
 * Atualiza câmera e renderer quando a janela é redimensionada.
 * @private
 */
function _onResize() {
  _camera.aspect = window.innerWidth / window.innerHeight;
  _camera.updateProjectionMatrix();
  _renderer.setSize(window.innerWidth, window.innerHeight);
}

/**
 * Executa um frame de render. Chamado pelo game loop a cada requestAnimationFrame.
 * @param {number} delta - Tempo desde o último frame em ms (não usado aqui ainda)
 */
export function render(delta) {
  _renderer.render(_scene, _camera);
}

/**
 * Retorna a instância da THREE.Scene.
 * @returns {THREE.Scene}
 */
export function getScene() { return _scene; }

/**
 * Retorna a câmera perspectiva ativa.
 * @returns {THREE.PerspectiveCamera}
 */
export function getCamera() { return _camera; }

/**
 * Retorna o WebGLRenderer.
 * @returns {THREE.WebGLRenderer}
 */
export function getRenderer() { return _renderer; }

/**
 * Adiciona um Object3D à cena.
 * @param {THREE.Object3D} obj - Objeto a adicionar
 */
export function add(obj) { _scene.add(obj); }

/**
 * Remove um Object3D da cena.
 * @param {THREE.Object3D} obj - Objeto a remover
 */
export function remove(obj) { _scene.remove(obj); }

/**
 * Retorna o mesh do chão para inspeção externa (usado por physics e debug).
 * @returns {THREE.Mesh|null} Retorna null se init() ainda não foi chamado.
 */
export function getGround() {
  return _ground;
}

/**
 * Aplica uma textura ao material do chão.
 * Configura repeat e wrapping para tile correto em terrenos grandes.
 * Chamado por main.js após o pipeline de assets emitir 'assetsReady'.
 * @param {THREE.Texture} texture - Textura carregada via assets.loadTexture()
 * @returns {void}
 */
export function setGroundTexture(texture) {
  if (!_ground) {
    console.warn('[scene] setGroundTexture: mesh do chão não encontrado (init() chamado?)');
    return;
  }
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(8, 8); // Tile 8x8 sobre o plano de 20×20 unidades
  _ground.material.map = texture;
  _ground.material.color.set(0xffffff); // Reseta cor para branco para não tingir a textura
  _ground.material.needsUpdate = true;
}