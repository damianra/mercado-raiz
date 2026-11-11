/**
 * Acumulador en memoria del consumo del LLM: tokens de entrada y
 * salida por corrida. Lo llaman los nodos con LLM después de cada
 * invoke pasándole la respuesta (lee usage_metadata de LangChain o
 * el response_metadata de Ollama); lo leen GET /metrics y el
 * resumen final. Con modelo local el costo en USD es 0 — el valor
 * queda como placeholder para una tarifa si se cambia a hosted.
 */

const state = { tokensEntrada: 0, tokensSalida: 0, llamadas: 0 };

export const costTracker = {
  /**
   * Registrar una respuesta del LLM. Lee usage_metadata si existe
   * (formato LangChain v1) y cae al response_metadata de Ollama.
   */
  registrar(respuesta) {
    const uso = respuesta?.usage_metadata;
    const meta = respuesta?.response_metadata;
    const entrada = uso?.input_tokens ?? meta?.prompt_eval_count ?? 0;
    const salida = uso?.output_tokens ?? meta?.eval_count ?? 0;
    state.tokensEntrada += entrada;
    state.tokensSalida += salida;
    state.llamadas++;
  },
  resumen() {
    return {
      tokens_entrada: state.tokensEntrada,
      tokens_salida: state.tokensSalida,
      tokens_total: state.tokensEntrada + state.tokensSalida,
      llamadas_llm: state.llamadas,
      costo_estimado_usd: 0, // modelo local — con hosted sería tokens * tarifa
    };
  },
  reset() {
    state.tokensEntrada = 0;
    state.tokensSalida = 0;
    state.llamadas = 0;
  },
};
