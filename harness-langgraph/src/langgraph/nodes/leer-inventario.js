/**
 * NODO 1 — LEER INVENTARIO
 *
 * Llama al backend (productos.client → GET /api/productos por
 * estado) y devuelve la lista de productos que necesitan reposición.
 * Lee del estado: nada. Escribe: productosBajos.
 */
import { listarProductosAReponer } from '../../integrations/productos.client.js';
import { log } from '../../utils/logger.js';

export async function leerInventario(state) {
  const productos = await listarProductosAReponer();
  log(`  ${productos.length} productos necesitan reposición:`);
  for (const p of productos) {
    log(`    - ${p.nombre} (${p.sku}): stock ${p.stock_actual}/${p.stock_minimo} [${p.estado}]`);
  }
  return { productosBajos: productos };
}
