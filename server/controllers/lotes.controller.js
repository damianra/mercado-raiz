import { ESTADOS_LOTE, listarLotes } from '../models/lotes.model.js';

const badRequest = (res, msg) => res.status(400).json({ error: msg });

// SPEC-33 (R33.5): listado de lotes — el desglose físico del
// stock con vencimiento, valor en riesgo y días restantes ya
// calculados server-side.
export async function list(req, res) {
  const { producto_id, estado, page = '1', limit = '50' } = req.query;

  const p = Number(page);
  const l = Number(limit);
  if (!Number.isInteger(p) || p < 1 || !Number.isInteger(l) || l < 1 || l > 100) {
    return badRequest(res, 'page/limit deben ser enteros positivos (limit ≤ 100)');
  }
  if (estado && !ESTADOS_LOTE.includes(estado)) {
    return badRequest(res, `estado inválido — válidos: ${ESTADOS_LOTE.join(', ')}`);
  }
  let productoId;
  if (producto_id !== undefined) {
    productoId = Number(producto_id);
    if (!Number.isInteger(productoId) || productoId < 1) {
      return badRequest(res, 'producto_id debe ser un entero positivo');
    }
  }

  res.json(await listarLotes({ productoId, estado, page: p, limit: l }));
}
