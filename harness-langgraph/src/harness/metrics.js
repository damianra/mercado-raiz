/**
 * Acumulador en memoria de métricas de la corrida: duración total,
 * tiempo por nodo, llamadas al LLM, reintentos y fallbacks usados.
 * Lo alimentan el monitor (tiempo por nodo) y los nodos con LLM;
 * lo leen GET /metrics (harness/server.js) y el resumen final que
 * imprime el orchestrator al terminar la corrida.
 */

const state = {
  inicio: null,
  fin: null,
  nodos: [], // { nombre, ms }
  llamadasLlm: 0,
  reintentos: 0,
  erroresFallback: 0, // veces que un nodo usó su plan B
};

export const metrics = {
  iniciarCorrida() {
    state.inicio = Date.now();
    state.fin = null;
    state.nodos = [];
    state.llamadasLlm = 0;
    state.reintentos = 0;
    state.erroresFallback = 0;
  },
  terminarCorrida() {
    state.fin = Date.now();
  },
  nodoEjecutado(nombre, ms) {
    state.nodos.push({ nombre, ms });
  },
  llamadaLlm() {
    state.llamadasLlm++;
  },
  reintento() {
    state.reintentos++;
  },
  fallback() {
    state.erroresFallback++;
  },
  resumen() {
    return {
      duracion_total_ms: state.fin && state.inicio ? state.fin - state.inicio : null,
      nodos_ejecutados: state.nodos,
      llamadas_llm: state.llamadasLlm,
      reintentos: state.reintentos,
      fallbacks_usados: state.erroresFallback,
    };
  },
};
