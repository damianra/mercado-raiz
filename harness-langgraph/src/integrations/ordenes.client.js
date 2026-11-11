/**
 * Operaciones con órdenes de compra al backend:
 *  - crearOrden() → POST /api/ordenes — la usa el nodo crear-orden.
 *    Manda requiere_aprobacion explícito (la decisión la toma el
 *    nodo decidir-aprobacion; el backend la re-deriva solo si no
 *    viene el flag).
 *  - obtenerOrden() → GET /api/ordenes/:orden_id — consulta puntual
 *    del estado de una orden (APROBADA / RECHAZADA / pendiente).
 */
import { api } from './backend-client.js';

export function crearOrden({ productoId, cantidad, requiereAprobacion, analisisIa }) {
  return api.post('/ordenes', {
    producto_id: productoId,
    cantidad,
    requiere_aprobacion: requiereAprobacion,
    analisis_ia: analisisIa,
  });
}

/**
 * POST /api/ordenes/batch — N órdenes en una request y una
 * transacción (SPEC-16). Una sola escritura para el rate limiter.
 * Todo o nada: si el backend devuelve 400 por un item, ninguna
 * se persistió — el nodo decide el fallback a llamadas sueltas.
 * items: [{ producto_id, cantidad, requiere_aprobacion, analisis_ia }]
 */
export function crearOrdenesBatch(items) {
  return api.post('/ordenes/batch', items);
}

export function obtenerOrden(ordenId) {
  return api.get(`/ordenes/${encodeURIComponent(ordenId)}`);
}
