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
  /** URL base del backend MVC (Express + Postgres). */
  backendUrl: required('BACKEND_URL', 'http://localhost:4000'),

  /**
   * Cuenta de servicio del agente (SPEC-23): el backend exige JWT
   * desde T23.1 — backend-client hace login con estas credenciales
   * y re-login ante 401/expiración. El usuario `agente@` viene en
   * el seed con rol SERVICIO (sin permisos de aprobación).
   */
  agenteEmail: required('AGENTE_EMAIL', 'agente@mercadorai.com'),
  agentePassword: required('AGENTE_PASSWORD', 'demo-agente-2026'),

  /**
   * Postgres del harness (SPEC-25): checkpoints de LangGraph +
   * cache de análisis. Default = el compose dev (misma
   * `mercadoraiz-db` del backend). En tests gana
   * DATABASE_URL_TEST — ver src/harness/pg.js.
   */
  databaseUrl: required('DATABASE_URL', 'postgres://mercadoraiz:dev-local-2026@localhost:5432/mercadoraiz-db'),

  /** Servidor Ollama local. */
  ollamaBaseUrl: required('OLLAMA_BASE_URL', 'http://localhost:11434'),
  ollamaModel: required('OLLAMA_MODEL', 'qwen3:8b'),

  /** Puerto del servidor HTTP del harness (recibe POST /resume). */
  harnessPort: Number(required('HARNESS_PORT', '4110')),

  /**
   * Monto a partir del cual una orden exige aprobación humana.
   * Lo usa el nodo decidir-aprobacion para marcar
   * requiere_aprobacion. Espejo de UMBRAL_APROBACION del backend
   * (server/models/ordenes.model.js) — el backend lo re-deriva si
   * el flag no viene; mantener ambos valores iguales.
   */
  umbralAprobacion: Number(required('UMBRAL_APROBACION', '50000')),

  /**
   * Triage heurístico (SPEC-12/R26.8): si el coeficiente de
   * variación de las ventas diarias (lo calcula el backend en
   * /api/estadisticas/demanda) es menor a este umbral, la demanda
   * ponderada del backend se usa tal cual sin llamar al LLM.
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

  /**
   * Ventana de días para las estadísticas de demanda (SPEC-26):
   * el parámetro `dias` de /api/estadisticas/demanda.
   */
  demandaDias: Math.min(365, Math.max(7, Number(required('DEMANDA_DIAS', '90')) || 90)),

  /**
   * Factor z del stock de seguridad (SPEC-26, R26.8):
   * z·σ_demanda·√lead_esperado. 1.65 ≈ 95% de nivel de servicio.
   */
  zSeguridad: Number(required('Z_SEGURIDAD', '1.65')),

  /**
   * Watchdog del agente (SPEC-30, T30.5): corrida automática cada
   * N minutos. 0 = desactivado (el agente solo corre por POST /run
   * o POST /trigger). No dispara si hay corrida en curso o pausada.
   */
  agenteIntervaloMin: Math.max(0, Number(required('AGENTE_INTERVALO_MIN', '60')) || 0),

  /**
   * Cooldown del trigger por evento (T30.5): un POST /trigger que
   * llega a menos de N min del inicio de la última corrida se
   * debouncea — un cierre de caja puede reportar muchos quiebres
   * seguidos y la corrida reciente ya los cubrió o los verá la
   * próxima. 0 = sin cooldown (cada trigger dispara).
   */
  triggerCooldownMin: Math.max(0, Number(required('AGENTE_TRIGGER_COOLDOWN_MIN', '15')) || 0),
};
