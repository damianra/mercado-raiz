/**
 * Consultas al historial de movimientos de stock. La usa el nodo
 * analizar-demanda: por cada producto pide
 * GET /api/historial?producto_id=N&tipo=VENTA y devuelve sus ventas
 * recientes — es la materia prima que se le pasa al LLM para estimar
 * demanda.
 */
import { api } from './backend-client.js';

/** Últimas ventas de un producto (más recientes primero). */
export async function ventasDeProducto(productoId, limit = 50) {
  const res = await api.get(`/historial?producto_id=${productoId}&tipo=VENTA&limit=${limit}`);
  return res.data;
}
