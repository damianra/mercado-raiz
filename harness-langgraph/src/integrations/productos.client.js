/**
 * Consultas de productos al backend. La usa el nodo leer-inventario:
 * pide GET /api/productos?estado=STOCK_BAJO y ?estado=CRITICO (el
 * filtro acepta un solo estado, por eso son dos llamadas) y devuelve
 * la lista combinada.
 */
import { api } from './backend-client.js';

/**
 * Productos que necesitan reposición: STOCK_BAJO + CRITICO.
 * Son dos consultas porque el filtro acepta un solo estado.
 */
export async function listarProductosAReponer() {
  const [bajos, criticos] = await Promise.all([
    api.get('/productos?estado=STOCK_BAJO&limit=100'),
    api.get('/productos?estado=CRITICO&limit=100'),
  ]);
  return [...bajos.data, ...criticos.data];
}
