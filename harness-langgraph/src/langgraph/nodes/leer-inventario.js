/**
 * NODO 1 — LEER INVENTARIO
 *
 * Llama al backend (productos.client → GET /api/productos por
 * estado) y devuelve la lista de productos que necesitan reposición.
 * Lee del estado: limite (T26.8). Escribe: productosBajos.
 */
import { listarProductosAReponer } from '../../integrations/productos.client.js';
import { log } from '../../utils/logger.js';

export async function leerInventario(state) {
  let productos = await listarProductosAReponer();
  // T26.8: corridas de validación — POST /run {limite: N} recorta el
  // lote. El corte es post-fetch (la API no tiene parámetro de
  // muestreo); conserva el orden del catálogo.
  const limite = Number(state?.limite);
  if (Number.isInteger(limite) && limite > 0 && productos.length > limite) {
    log(`  limite=${limite}: recortando ${productos.length} → ${limite} productos (validación)`);
    productos = productos.slice(0, limite);
  }
  log(`  ${productos.length} productos necesitan reposición:`);
  for (const p of productos) {
    log(`    - ${p.nombre} (${p.sku}): stock ${p.stock_actual}/${p.stock_minimo} [${p.estado}]`);
  }
  return { productosBajos: productos };
}
