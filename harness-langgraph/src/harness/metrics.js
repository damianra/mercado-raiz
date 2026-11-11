/**
 * Acumulador en memoria de métricas de la corrida: duración total,
 * tiempo por nodo, llamadas al LLM, reintentos, fallbacks usados y
 * métricas de negocio (productos evaluados, órdenes creadas y
 * pausadas, errores no críticos — SPEC-10 §2).
 * Lo alimentan el monitor (tiempo por nodo), los nodos con LLM y el
 * orchestrator, que vuelca el estado final del grafo tras cada
 * ejecutar() — así los contadores de negocio no se duplican en el
 * estado serializado a checkpoints.sqlite.
 * Lo leen GET /metrics (harness/server.js) y el resumen final que
 * imprime el orchestrator al terminar la corrida.
 */

const state = {
  inicio: null,
  fin: null,
  nodos: [], // { nombre, ms }
  llamadasLlm: 0,
  reintentos: 0,
  erroresFallback: 0, // veces que un nodo usó su plan B
  llmEvitadas: 0, // llamadas LLM evitadas deliberadamente (triage/condicional SPEC-12)
  cacheHits: 0, // llamadas LLM evitadas por cache incremental (SPEC-16)
  // Métricas de negocio — las escribe sincronizarEstadoGrafo()
  productosEvaluados: 0,
  ordenesCreadas: 0,
  ordenesPausadas: 0,
  erroresNoCriticos: [],
};

export const metrics = {
  iniciarCorrida() {
    state.inicio = Date.now();
    state.fin = null;
    state.nodos = [];
    state.llamadasLlm = 0;
    state.reintentos = 0;
    state.erroresFallback = 0;
    state.llmEvitadas = 0;
    state.cacheHits = 0;
    state.productosEvaluados = 0;
    state.ordenesCreadas = 0;
    state.ordenesPausadas = 0;
    state.erroresNoCriticos = [];
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
  llmEvitada() {
    state.llmEvitadas++;
  },
  cacheHit() {
    state.cacheHits++;
  },
  /**
   * Vuelca los valores del estado del grafo (values de getState) a
   * las métricas de negocio. `ordenesPausadas` cuenta el flag
   * `requiere_aprobacion` de decisionPorProducto — estable durante
   * toda la corrida, a diferencia de `ordenesPendientes`, que se
   * achica a medida que el humano resuelve.
   */
  sincronizarEstadoGrafo(values) {
    if (!values) return;
    state.productosEvaluados = values.productosBajos?.length ?? 0;
    state.ordenesCreadas = values.ordenesCreadas?.length ?? 0;
    state.ordenesPausadas = Object.values(values.decisionPorProducto ?? {}).filter(
      (d) => d?.requiere_aprobacion,
    ).length;
    state.erroresNoCriticos = values.errores ?? [];
  },
  /**
   * Frase derivada de los contadores + fase de la corrida para el
   * frontend (SPEC-10 §3 — no la genera el LLM).
   */
  mensajeSistema(fase) {
    const plural = (n, s, p) => (n === 1 ? s : p);
    const sufijo =
      state.erroresFallback > 0
        ? ` con ${state.erroresFallback} ${plural(state.erroresFallback, 'fallback heurístico', 'fallbacks heurísticos')}`
        : '';
    switch (fase) {
      case 'terminado':
        return state.productosEvaluados === 0
          ? 'Ejecución completada: no había productos con stock bajo.'
          : `Ejecución completada${sufijo}.`;
      case 'corriendo':
        return 'Corrida en curso…';
      case 'pausado':
        return `Esperando aprobación humana de ${state.ordenesPausadas} ${plural(state.ordenesPausadas, 'orden', 'órdenes')}.`;
      case 'error':
        return 'La corrida terminó con error.';
      default:
        return 'Sin corridas registradas todavía.';
    }
  },
  resumen() {
    return {
      duracion_total_ms: state.fin && state.inicio ? state.fin - state.inicio : null,
      nodos_ejecutados: state.nodos,
      llamadas_llm: state.llamadasLlm,
      reintentos: state.reintentos,
      // Métricas de negocio (SPEC-10 §2/§3)
      total_productos_evaluados: state.productosEvaluados,
      ordenes_creadas: state.ordenesCreadas,
      ordenes_pausadas_hith: state.ordenesPausadas,
      conteo_fallbacks: state.erroresFallback,
      llm_evitadas: state.llmEvitadas,
      cache_hits: state.cacheHits,
      tasa_fallback:
        state.productosEvaluados > 0
          ? Math.round((state.erroresFallback / state.productosEvaluados) * 1000) / 10
          : 0,
      errores_no_criticos: state.erroresNoCriticos,
    };
  },
};
