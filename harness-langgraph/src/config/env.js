/**
 * Lee las variables de entorno del agente desde .env (dotenv) y las
 * expone como el objeto `config`. Corre una sola vez, al arrancar el
 * proceso. El resto del código importa `config` de acá — URLs,
 * modelo y umbral nunca van hardcodeados.
 */
import 'dotenv/config';

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Falta la variable de entorno ${name} — ver .env.example`);
  }
  return value;
}

export const config = {
  /** URL base del backend MVC (Express + SQLite). */
  backendUrl: required('BACKEND_URL', 'http://localhost:4000'),

  /** Servidor Ollama local. */
  ollamaBaseUrl: required('OLLAMA_BASE_URL', 'http://localhost:11434'),
  ollamaModel: required('OLLAMA_MODEL', 'llama3.2:1b'),

  /** Puerto del servidor HTTP del harness (recibe POST /resume). */
  harnessPort: Number(required('HARNESS_PORT', '4110')),

  /**
   * Monto a partir del cual una orden exige aprobación humana.
   * Lo usa el nodo decidir-aprobacion para marcar
   * requiere_aprobacion. Espejo de UMBRAL_APROBACION del backend
   * (server/models/ordenes.model.js) — el backend lo re-deriva si
   * el flag no viene; mantener ambos valores iguales.
   */
  umbralAprobacion: Number(required('UMBRAL_APROBACION', '100')),

  /**
   * Triage heurístico (SPEC-12): si el coeficiente de variación de
   * las ventas diarias es menor a este umbral, la demanda se estima
   * por promedio histórico sin llamar al LLM.
   */
  umbralCv: Number(required('UMBRAL_CV', '0.3')),

  /**
   * Concurrencia del agente (SPEC-16): cuántos productos procesan
   * llamadas LLM en paralelo por nodo. Ojo — esto solo paraleliza
   * el LADO CLIENTE: para que Ollama atienda varias requests a la
   * vez, el servidor tiene que arrancar con OLLAMA_NUM_PARALLEL>=N
   * (env del proceso `ollama serve`, no del harness); si no, las
   * requests se encolan en Ollama y el speedup es mínimo.
   */
  concurrencia: Math.max(1, Number(required('AGENTE_CONCURRENCIA', '3')) || 3),

  /**
   * Tamaño de lote para prompts de demanda (SPEC-16): cuántos
   * productos volátiles se mandan por llamada al LLM en un array
   * JSON. Items inválidos/faltantes caen a llamada individual.
   * Ojo: lotes >6-7 agrandan numCtx (ver ollama.js, llmJsonBatch).
   */
  demandaBatch: Math.max(1, Number(required('DEMANDA_BATCH', '5')) || 5),
};
