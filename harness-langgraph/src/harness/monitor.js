/**
 * Exporta observarStream(stream): consume el stream de eventos que
 * LangGraph emite durante la ejecución del grafo (un evento por
 * nodo terminado, con los campos que actualizó el estado). Por cada
 * evento imprime una línea en consola con el nombre del nodo, su
 * duración aproximada y los campos tocados, y lo registra en
 * metrics. Lo llama el orchestrator en cada ejecución.
 */
import { log } from '../utils/logger.js';
import { metrics } from './metrics.js';

/**
 * Recorre el stream del grafo imprimiendo cada transición.
 * Devuelve la última actualización (para detectar interrupciones).
 */
export async function observarStream(stream) {
  let ultimo;
  let t0 = Date.now();
  for await (const evento of stream) {
    // evento: { nombreDelNodo: {campos que agregó al estado} }
    const ahora = Date.now();
    const [nodo, update] = Object.entries(evento)[0] ?? [];
    if (!nodo) continue;
    ultimo = evento;
    // La duración aproximada del nodo = tiempo desde el evento
    // anterior (los updates llegan al terminar cada nodo).
    const ms = ahora - t0;
    t0 = ahora;
    if (nodo === '__interrupt__') {
      log('⏸  INTERRUPCIÓN — el grafo pausó esperando al humano');
      continue;
    }
    const campos = update && typeof update === 'object' ? Object.keys(update) : [];
    log(`▶ nodo "${nodo}" terminó (${ms}ms) → estado: ${campos.join(', ') || '(sin cambios)'}`);
    metrics.nodoEjecutado(nodo, ms);
  }
  return ultimo;
}
