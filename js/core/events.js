/**
 * events.js — Event bus global do LumieQuest.
 * Canal único de comunicação assíncrona entre módulos (R8).
 * Sem dependências externas — módulo raiz da arquitetura.
 */

/** @type {Object.<string, Set<Function>>} Mapa interno de listeners */
const _listeners = {};

/**
 * Registra um listener para o evento especificado.
 * @param {string} event - Nome do evento (ex: 'playerMoved')
 * @param {Function} cb - Callback chamado quando o evento for emitido
 */
export function on(event, cb) {
  if (!_listeners[event]) _listeners[event] = new Set();
  _listeners[event].add(cb);
}

/**
 * Remove um listener de um evento.
 * @param {string} event - Nome do evento
 * @param {Function} cb - Referência ao mesmo callback passado em on()
 */
export function off(event, cb) {
  _listeners[event]?.delete(cb);
}

/**
 * Dispara um evento, chamando todos os listeners registrados.
 * @param {string} event - Nome do evento
 * @param {*} [data] - Payload opcional passado a cada listener
 */
export function emit(event, data) {
  _listeners[event]?.forEach(cb => {
    try { cb(data); }
    catch (err) { console.error(`[events] Erro no listener de '${event}':`, err); }
  });
}

/**
 * Registra listener que se auto-remove após a primeira execução.
 * @param {string} event - Nome do evento
 * @param {Function} cb - Callback chamado uma única vez
 */
export function once(event, cb) {
  const wrapper = (data) => { cb(data); off(event, wrapper); };
  on(event, wrapper);
}
