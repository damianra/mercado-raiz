/**
 * Exporta conReintentos(fn): ejecuta una función async y, si falla,
 * la reintenta con espera creciente entre intentos. Lo usan
 * backend-client (todos los llamados HTTP al backend) y los nodos
 * que invocan al LLM. Solo reintenta errores transitorios (429 o
 * 5xx); un error con status 4xx se propaga sin reintentar. Cada
 * reintento se registra en metrics.
 */
import { log } from '../utils/logger.js';
import { metrics } from './metrics.js';

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Ejecuta `fn` reintentando hasta `intentos` veces.
 * Si el error trae status HTTP (del backend-client), solo reintenta
 * errores de servidor (5xx) o rate limit (429) — un 400 es culpa
 * nuestra y reintentarlo no arregla nada.
 */
export async function conReintentos(fn, { intentos = 3, esperaMs = 1000, etiqueta = 'operación' } = {}) {
  let ultimoError;
  for (let i = 1; i <= intentos; i++) {
    try {
      return await fn();
    } catch (err) {
      ultimoError = err;
      const reintentable = !err.status || err.status === 429 || err.status >= 500;
      if (!reintentable || i === intentos) break;
      metrics.reintento();
      // Si el server mandó Retry-After (429 del limiter), se espera
      // eso — un backoff fijo de 1-2s cae dentro de la misma ventana
      // saturada y agota los intentos sin llegar nunca a un slot libre.
      const espera = err.retryAfter ? Math.min(err.retryAfter * 1000, 60_000) : esperaMs * i;
      log(`  ⚠ ${etiqueta} falló (intento ${i}/${intentos}): ${err.message} — reintentando en ${espera}ms`);
      await esperar(espera);
    }
  }
  throw ultimoError;
}
