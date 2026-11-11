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

export function obtenerOrden(ordenId) {
  return api.get(`/ordenes/${encodeURIComponent(ordenId)}`);
}
