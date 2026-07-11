// js/entities/npcs.js
// Camada: entities
// Dependências: THREE (importmap), events.js (event bus), ui.js (isDialogOpen via import direto — R8 exceção justificada: consulta síncrona de estado de UI necessária no update loop)

import * as THREE from 'three';
import * as Events from '../core/events.js';
import * as Quests from '../systems/quests.js';
import * as Classes from '../systems/classes.js';
import { updateNpcQuestIndicator } from '../ui/ui.js';
import * as Scene from '../world/scene.js';
import { playSFX3D } from '../core/audio.js';
import * as Models from '../core/models.js';
/** @type {Array<NPCInstance>} */
const _npcs = [];

let _scene = null;

/**
 * @typedef {Object} NPCInstance
 * @property {string} id
 * @property {string} name
 * @property {THREE.Mesh} mesh
 * @property {THREE.Vector3} position
 * @property {Object} dialogTree
 * @property {boolean} playerInRange
 */

// ─── indicador de proximidade ───────────────────────────────────────────────

/** NPC que está atualmente com player no raio */
let _nearestInRange = null;
let _dialogOpen = false;
/** Intervalo mínimo entre emissões do hint (ms) */
const HINT_COOLDOWN = 1500;
let _lastHintTime = 0;

const INTERACT_RADIUS = 2;        // unidades
const INTERACT_RADIUS_SQ = INTERACT_RADIUS * INTERACT_RADIUS;

// ─── geometria compartilhada ─────────────────────────────────────────────────
// Uma geometria e um material por cor economiza draw calls (R6)
let _sharedGeo = null;
let _sharedMat = null;

function _getSharedAssets() {
  if (!_sharedGeo) {
    // Three.js r169 tem CapsuleGeometry nativo
    _sharedGeo = new THREE.CapsuleGeometry(0.35, 0.9, 4, 8);
  }
  if (!_sharedMat) {
    _sharedMat = new THREE.MeshLambertMaterial({ color: 0xFFD700 });
  }
  return { geo: _sharedGeo, mat: _sharedMat };
}
// --- helpers 3D (Sessao 25D) ---

function _findIdleClip(clips) {
  if (!Array.isArray(clips) || clips.length === 0) return null;
  const byName = ['idle', 'Idle', 'IDLE', 'idle_01', 'Idle_01'];
  for (const wanted of byName) {
    const clip = clips.find(c => c?.name === wanted);
    if (clip) return clip;
  }
  const partial = clips.find(c => /idle/i.test(c?.name ?? ''));
  if (partial) return partial;
  return clips[0] ?? null;
}

function _prepareModelRoot(root, npcId) {
  root.traverse((child) => {
    child.userData = child.userData ?? {};
    child.userData.npcId = npcId;
    if (child.isMesh || child.isSkinnedMesh) {
      child.castShadow = true;
      child.receiveShadow = false;
    }
  });
}

async function _createNpcVisual(def) {
  if (def?.modelFile) {
    try {
      const gltf = await Models.loadModel(def.modelFile);
      const model = gltf?.scene ?? null;
      if (model) {
        _prepareModelRoot(model, def.id);
        model.scale.set(1.0, 1.0, 1.0);
        const mixer = Models.createMixer(model);
        const clips = Models.getAnimationClips(gltf);
        const idleClip = _findIdleClip(clips);
        let idleAction = null;
        if (idleClip) {
          idleAction = mixer.clipAction(idleClip);
          idleAction.reset();
          idleAction.play();
        }
        return { mesh: model, mixer, idleAction };
      }
    } catch (err) {
      console.warn('[npcs] Falha ao carregar modelFile de ' + def.id + ': ' + def.modelFile, err);
    }
  }
  const { geo, mat } = _getSharedAssets();
  const fallback = new THREE.Mesh(geo, mat);
  fallback.castShadow = true;
  fallback.userData.npcId = def.id;
  return { mesh: fallback, mixer: null, idleAction: null };
}
// ─── API pública ─────────────────────────────────────────────────────────────

/**
 * Inicializa o módulo de NPCs.
 * Deve ser chamado após scene.init().
 * @param {THREE.Scene} scene - cena Three.js ativa
 */
export function init(scene) {
  _scene = scene;

  // Escuta tecla F para iniciar diálogo
  Events.on('keyPressed', _onKeyPressed);
  Events.on('dialogStarted', () => { _dialogOpen = true; });
  Events.on('dialogEnded',   () => { _dialogOpen = false; });
}

/**
 * Cria meshes e registra NPCs a partir do JSON de configuração.
 * @param {Object} config - conteúdo parseado de assets/data/npcs.json
 */
export async function spawnFromConfig(config) {
  if (!_scene) {
    console.error('[npcs] init() deve ser chamado antes de spawnFromConfig()');
    return;
  }

  for (const def of config.npcs) {
    const { mesh, mixer, idleAction } = await _createNpcVisual(def);

    mesh.position.set(def.position.x, def.position.y, def.position.z);
    if (!mixer) {
      mesh.position.y += 0.95;
    }

    mesh.userData = mesh.userData ?? {};
    mesh.userData.npcId = def.id;

    _scene.add(mesh);

    const instance = {
      id:           def.id,
      name:         def.name,
      mesh,
      position:     new THREE.Vector3(def.position.x, def.position.y, def.position.z),
      dialogTree:   def.dialogTree,
      shop:         def.shop ?? null,
      playerInRange: false,
      mixer,
      idleAction,
      lastAmbientSfxAt: 0,
    };

    _npcs.push(instance);
  }

  Events.emit('npcsSpawned', { count: _npcs.length });
}

/**
 * Atualiza proximidade do player a cada frame.
 * Deve ser chamado no game loop principal com a posição atual do player.
 * @param {number} delta - tempo desde o último frame (segundos)
 * @param {THREE.Vector3} playerPos - posição atual do player
 */
export function updateAll(delta, playerPos) {
  if (!playerPos) return;
  const camera = Scene.getCamera();
  let closestNpc = null;
  let closestDistSq = Infinity;

  for (const npc of _npcs) {
    if (npc.mixer) npc.mixer.update(delta);
    const dx = playerPos.x - npc.position.x;
    const dz = playerPos.z - npc.position.z;
    const distSq = dx * dx + dz * dz;

    const wasInRange = npc.playerInRange;
    npc.playerInRange = distSq <= INTERACT_RADIUS_SQ;
    const now = performance.now();
    if (
        npc.id === 'blacksmith' &&
        distSq <= 225 &&
        now - (npc.lastAmbientSfxAt ?? 0) >= 30000
    ) {
        playSFX3D('assets/audio/sfx/sfx_npc_blacksmith_hammer.ogg', npc.mesh.position);
        npc.lastAmbientSfxAt = now;
    }

    if (npc.playerInRange && distSq < closestDistSq) {
      closestDistSq = distSq;
      closestNpc = npc;
    }

    // Pequena animação: NPC "olha" para o player quando próximo
    if (npc.playerInRange) {
      npc.mesh.lookAt(playerPos.x, npc.mesh.position.y, playerPos.z);
    }
  }

  // Exibe hint HUD se NPC próximo mudou ou cooldown expirou
  const now = performance.now();
  if (closestNpc && (closestNpc !== _nearestInRange || now - _lastHintTime > HINT_COOLDOWN)) {
    _nearestInRange = closestNpc;
    _lastHintTime = now;
    Events.emit('uiHintShow', { message: `Pressione F para falar com ${closestNpc.name}` });
  } else if (!closestNpc && _nearestInRange) {
    _nearestInRange = null;
    Events.emit('uiHintHide', {});
  }
    for (const npc of _npcs) {
    updateNpcQuestIndicator(npc.id, npc.mesh, camera, Scene.getRenderer());
  }
}

/**
 * Retorna array de todos os NPCs instanciados.
 * @returns {NPCInstance[]}
 */
export function getAll() {
  return _npcs;
}

// ─── handlers internos ───────────────────────────────────────────────────────

/**
 * Trata pressionamento de tecla F para iniciar diálogo.
 * @param {Object} payload - { key: string }
 */
function _onKeyPressed({ code, action, key }) {
  const isInteract =
    action === 'interact' ||
    code === 'KeyF' ||
    key === 'f' ||
    key === 'F';

  if (!isInteract) return;
  if (_dialogOpen) return;
  if (!_nearestInRange) return;

  const npc = _nearestInRange;

  // TODO: SFX quando audio.json existir — playSFX('sfx_dialog_open')

  Events.emit('dialogStarted', {
    npcId:      npc.id,
    npcName:    npc.name,
    dialogTree: npc.dialogTree,
  });
}/**
 * Executa a action de uma opção de diálogo.
 * @param {{ type: string, questId: string }} action
 */
function _executeAction(action, npc) {
    if (!action) return;
    const { type, questId } = action;

    if (type === 'shop') {
        Events.emit('uiWindowToggle', {
            id: 'shop',
            vendorId: npc?.id ?? null,
            stock: Array.isArray(npc?.shop) ? npc.shop : [],
        });
    }

    if (type === 'offerQuest') {
        import('../entities/player.js').then(PlayerMod => {
            Quests.acceptQuest(questId, PlayerMod.getState?.() ?? null);
        });
    }
    if (type === 'completeQuest') Quests.completeQuest(questId);
    if (type === 'doJobChange') {
        import('../entities/player.js').then(PlayerMod => {
            PlayerMod.applyJobChange(action.jobId);
        });
    }
    if (type === 'refine') {
        Events.emit('uiWindowToggle', { id: 'refine' });
    }
}

Events.on('dialogOptionSelected', ({ npcId, nodeId, optionIndex }) => {
    const npc = _npcs.find(n => n.id === npcId);
    if (!npc) return;

    const node = npc.dialogTree.nodes[nodeId];
    if (!node) return;

    const opt = node.options[optionIndex];
    if (opt?.action) _executeAction(opt.action, npc);
});