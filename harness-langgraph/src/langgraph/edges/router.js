/**
 * Funciones de edge condicional: LangGraph las llama con el estado
 * actual y el string que devuelven es el NOMBRE del nodo siguiente
 * (los nombres válidos se declaran en addConditionalEdges de
 * graph.js). Son las únicas dos ramas del grafo.
 */

/** Sale de crear-orden: hay órdenes esperando al humano → notificar; si no → fin. */
export function despuesDeCrearOrdenes(state) {
  return state.ordenesPendientes.length > 0 ? 'notificar' : 'fin';
}
