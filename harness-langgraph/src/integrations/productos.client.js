/**
 * Consultas de productos al backend. La usa el nodo leer-inventario:
 * pide GET /api/productos?estado=STOCK_BAJO y ?estado=CRITICO (el
 * filtro acepta un solo estado, por eso son dos llamadas) y devuelve
 * la lista combinada.
 */
import { api } from './backend-client.js';

const LIMIT_PAGINA = 100; // tope duro del backend (controller rechaza >100)

/**
 * Todas las páginas de un estado. Antes pedía solo page 1 → con más
 * de `limit` productos la lista se truncaba en silencio y el agente
 * nunca evaluaba el excedente (SPEC-14). Los GET están exentos del
 * rate limiter — las páginas restantes se piden en paralelo.
 * Si el envelope no trae `pagination`, devuelve `data` tal cual.
 */
async function listarTodos(estado) {
  const primera = await api.get(
    `/productos?estado=${estado}&limit=${LIMIT_PAGINA}&page=1`,
  );
  const totalPages = primera.pagination?.totalPages ?? 1;
  if (totalPages <= 1) return primera.data;
  const restantes = await Promise.all(
    Array.from({ length: totalPages - 1 }, (_, i) =>
      api.get(`/productos?estado=${estado}&limit=${LIMIT_PAGINA}&page=${i + 2}`),
    ),
  );
  return [primera, ...restantes].flatMap((r) => r.data);
}

/**
 * Productos que necesitan reposición: STOCK_BAJO + CRITICO.
 * Son dos consultas porque el filtro acepta un solo estado. La dedup
 * por id es defensiva: un producto no puede tener dos estados.
 */
export async function listarProductosAReponer() {
  const [bajos, criticos] = await Promise.all([
    listarTodos('STOCK_BAJO'),
    listarTodos('CRITICO'),
  ]);
  const vistos = new Set();
  return [...bajos, ...criticos].filter(
    (p) => !vistos.has(p.id) && vistos.add(p.id),
  );
}
