/**
 * Cliente HTTP hacia el backend MVC (`BACKEND_URL/api`). Exporta
 * `api.get` y `api.post`, que son las únicas vías por las que el
 * agente pega contra el sistema real — todos los demás archivos de
 * integrations/ las usan; nadie hace fetch directo.
 *
 * Resuelve tres cosas:
 *  1. El backend responde listas como { data, pagination } — acá se
 *     devuelve ese envelope tal cual y cada client toma lo suyo.
 *  2. /api limita escrituras a 20 req/min — todo pasa por
 *     conReintentos (harness/error-handler), que reintenta con
 *     backoff ante 429 o 5xx.
 *  3. Las respuestas de error se convierten en Error con `.status`,
 *     así el retry sabe que un 4xx no vale reintentar.
 */
import { config } from '../config/env.js';
import { conReintentos } from '../harness/error-handler.js';

async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${config.backendUrl}/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error ?? `HTTP ${res.status}`);
    err.status = res.status;
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
  post: (path, body) => conReintentos(() => request(path, { method: 'POST', body }), { etiqueta: `POST ${path}` }),
};
