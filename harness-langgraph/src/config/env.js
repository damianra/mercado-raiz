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
};
