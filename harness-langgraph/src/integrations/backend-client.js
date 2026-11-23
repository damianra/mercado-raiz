/**
 * Cliente HTTP hacia el backend MVC (`BACKEND_URL/api`). Exporta
 * `api.get` y `api.post`, que son las únicas vías por las que el
 * agente pega contra el sistema real — todos los demás archivos de
 * integrations/ las usan; nadie hace fetch directo.
 *
 * Resuelve cuatro cosas:
 *  1. Auth (SPEC-23): login perezoso de la cuenta de servicio — un
 *     401 del backend dispara login (`AGENTE_EMAIL`/`AGENTE_PASSWORD`
 *     → access JWT en memoria, nunca en disco) y un solo reintento
 *     del request original. Válido tanto para el primer request como
 *     para un token vencido/revocado a mitad de corrida.
 *  2. El backend responde listas como { data, pagination } — acá se
 *     devuelve ese envelope tal cual y cada client toma lo suyo.
 *  3. /api limita escrituras a 20 req/min — todo pasa por
 *     conReintentos (harness/error-handler), que ante 429 espera el
 *     Retry-After del server y ante 5xx hace backoff propio.
 *  4. Las respuestas de error se convierten en Error con `.status`,
 *     así el retry sabe que un 4xx no vale reintentar.
 */
import { config } from '../config/env.js';
import { conReintentos } from '../harness/error-handler.js';

// Access JWT en memoria del proceso (SPEC-23 R23.11). No hace falta
// persistirlo: si el proceso arranca sin token, loguea en el primer
// request; el agente es efímero por corrida.
let accessToken = null;
let loginEnCurso = null;

async function login() {
  // Corridas concurrentes: un solo login a la vez — los demás await
  // de la misma promesa (evita que N nodos disparen N logins).
  loginEnCurso ??= (async () => {
    const res = await fetch(`${config.backendUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: config.agenteEmail,
        password: config.agentePassword,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error ?? `HTTP ${res.status} en login`);
      err.status = res.status;
      throw err;
    }
    accessToken = data.access_token;
  })().finally(() => {
    loginEnCurso = null;
  });
  return loginEnCurso;
}

async function request(path, { method = 'GET', body } = {}, reintento = false) {
  const headers = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (body) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${config.backendUrl}/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  // 401 → token ausente, vencido o revocado: login de servicio y un
  // solo reintento del request original (antes de que lo vea el
  // retry de error-handler, que no reintenta 4xx). Credenciales
  // malas → el error del login propaga tal cual.
  if (res.status === 401 && !reintento) {
    accessToken = null;
    await login();
    return request(path, { method, body }, true);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error ?? `HTTP ${res.status}`);
    err.status = res.status;
    // El backend manda Retry-After en los 429 (R13.1) — conReintentos
    // lo usa para esperar lo que el limiter indica, no un fijo.
    err.retryAfter = Number(res.headers.get('retry-after')) || null;
    throw err;
  }
  return data;
}

/**
 * request() envuelto en reintentos: las lecturas y escrituras del
 * agente pasan todas por el mismo safety net.
 */
export const api = {
  get: (path) => conReintentos(() => request(path), { etiqueta: `GET ${path}` }),
  // POST con un intento extra: ante 429 cada reintento espera el
  // Retry-After del limiter (hasta ~60s), y una ráfaga puede necesitar
  // más de una ventana de espera.
  post: (path, body) => conReintentos(() => request(path, { method: 'POST', body }), { intentos: 4, etiqueta: `POST ${path}` }),
};
