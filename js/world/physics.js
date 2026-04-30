/**
 * physics.js — Stub de detecção de colisão do LumieQuest.
 * Implementação completa: PROMPT 5+.
 * Terreno plano (y=0) e AABB desativado por enquanto.
 */

/**
 * Inicializa as estruturas de colisão.
 * Stub — sem lógica ainda; será populado no PROMPT 5.
 */
export function init() {
  // Stub: grid de colisão e hitboxes serão preparados no PROMPT 5
}

/**
 * Retorna a altura Y do terreno na posição (x, z).
 * Stub: terreno sempre plano em y = 0.
 * @param {number} x - Coordenada X no mundo
 * @param {number} z - Coordenada Z no mundo
 * @returns {number} Altura Y do terreno (0 = plano)
 */
export function getGroundHeight(x, z) {
  return 0;
}

/**
 * Testa colisão AABB entre dois volumes.
 * Stub — retorna false até o PROMPT 5.
 * @param {import('three').Box3} a - Volume A
 * @param {import('three').Box3} b - Volume B
 * @returns {boolean} true se houver sobreposição
 */
export function checkAABB(a, b) {
  return false;
}

/**
 * Raycast contra o terreno a partir de uma origem e direção.
 * Stub — retorna 0 até o PROMPT 5.
 * @param {import('three').Vector3} origin - Ponto de origem do raio
 * @param {import('three').Vector3} dir - Direção normalizada do raio
 * @returns {number} Distância até o terreno, ou 0 se stub
 */
export function raycastGround(origin, dir) {
  return 0;
}

/**
 * Atualiza hitboxes dinâmicos a cada frame.
 * Stub — sem lógica até o PROMPT 5.
 * @param {number} delta - Tempo desde o último frame em ms
 */
export function update(delta) {
  // Stub: resolução de colisões dinâmicas implementada no PROMPT 5
}
