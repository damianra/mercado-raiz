/**
 * Estadísticas de demanda del backend (SPEC-26, R26.7). La usa el
 * nodo analizar-demanda: por cada producto pide
 * GET /api/estadisticas/demanda?producto_id=N&dias=D y devuelve
 * { demanda_diaria, tendencia, cv, desvio_demanda, dias_con_venta,
 *   dias_en_quiebre, ultima_venta } — la fuente única de demanda,
 * la misma que consume el dashboard. Reemplaza al cálculo ad-hoc
 * que se hacía sobre historial_stock.
 */
import { api } from './backend-client.js';
import { config } from '../config/env.js';

/** Estadísticas de demanda de un producto en la ventana configurada. */
export async function estadisticaDemanda(productoId) {
  return api.get(`/estadisticas/demanda?producto_id=${productoId}&dias=${config.demandaDias}`);
}

/**
 * SPEC-32 (T32.5): las mismas estadísticas de TODOS los productos
 * en una sola request (bulk, sin producto_id) — el nodo
 * analizar-demanda las usa para armar los candidatos y para el
 * guard anti-recompra (cada fila trae zona_precio, indice_precio,
 * ultima_venta y dias_con_venta). Devuelve el array `data` del
 * envelope — 1 request vs N.
 */
export async function estadisticasDemandaBulk() {
  const res = await api.get(`/estadisticas/demanda?dias=${config.demandaDias}`);
  return res.data ?? res;
}
