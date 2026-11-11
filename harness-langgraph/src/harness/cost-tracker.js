/**
 * Acumulador en memoria del consumo del LLM: tokens de entrada y
 * salida, duraciones de inferencia y modelo usado por corrida.
 * Lo llaman los nodos con LLM después de cada invoke pasándole la
 * respuesta completa — lee `usage_metadata` (formato LangChain v1)
 * y `response_metadata` (crudo de Ollama: conteos y duraciones en
 * nanosegundos, que acá se convierten a ms).
 * Lo leen GET /metrics (campo `rendimiento_llm`) y el resumen final.
 * Con modelo local el costo en USD es 0 — el valor queda como
 * placeholder para una tarifa si se cambia a hosted.
 */

const state = {
  modelo: null,
  llamadas: 0,
  tokensPrompt: 0,
  tokensGeneracion: 0,
  // Sumas en ms — Ollama las reporta en nanosegundos (SPEC-10 §1)
  sumaCargaMs: 0,
  sumaPromptMs: 0,
  sumaGeneracionMs: 0,
  sumaTotalMs: 0,
};

const nsAms = (ns) => Math.round((ns ?? 0) / 1e6);

export const costTracker = {
  /**
   * Registrar una respuesta del LLM. Prioriza usage_metadata de
   * LangChain para tokens y response_metadata para todo lo demás.
   */
  registrar(respuesta) {
    const uso = respuesta?.usage_metadata;
    const meta = respuesta?.response_metadata ?? {};
    state.llamadas++;
    state.modelo = meta.model ?? state.modelo;
    state.tokensPrompt += uso?.input_tokens ?? meta.prompt_eval_count ?? 0;
    state.tokensGeneracion += uso?.output_tokens ?? meta.eval_count ?? 0;
    state.sumaCargaMs += nsAms(meta.load_duration);
    state.sumaPromptMs += nsAms(meta.prompt_eval_duration);
    state.sumaGeneracionMs += nsAms(meta.eval_duration);
    state.sumaTotalMs += nsAms(meta.total_duration);
  },
  /**
   * Resumen de la corrida o `null` si el LLM nunca se invocó —
   * GET /metrics lo expone tal cual en `rendimiento_llm`
   * (SPEC-10 §3: sin llamadas, el frontend no muestra tabla).
   */
  resumen() {
    if (state.llamadas === 0) return null;
    const prom = (suma) => Math.round(suma / state.llamadas);
    return {
      modelo: state.modelo,
      llamadas_totales: state.llamadas,
      tokens_prompt_acumulados: state.tokensPrompt,
      tokens_generacion_acumulados: state.tokensGeneracion,
      tiempo_carga_promedio_ms: prom(state.sumaCargaMs),
      tiempo_procesamiento_prompt_promedio_ms: prom(state.sumaPromptMs),
      tiempo_generacion_promedio_ms: prom(state.sumaGeneracionMs),
      tiempo_total_promedio_ms: prom(state.sumaTotalMs),
      costo_estimado_usd: 0, // modelo local — con hosted sería tokens * tarifa
    };
  },
  reset() {
    state.modelo = null;
    state.llamadas = 0;
    state.tokensPrompt = 0;
    state.tokensGeneracion = 0;
    state.sumaCargaMs = 0;
    state.sumaPromptMs = 0;
    state.sumaGeneracionMs = 0;
    state.sumaTotalMs = 0;
  },
};
