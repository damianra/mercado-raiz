import { TIPOS_MOVIMIENTO, listHistorial } from '../models/historial.model.js';
import { capString } from '../security.js';

export function list(req, res) {
  const { producto_id, tipo, desde, hasta, page = '1', limit = '50' } = req.query;

  const p = Number(page);
  const l = Number(limit);
  if (!Number.isInteger(p) || p < 1 || !Number.isInteger(l) || l < 1 || l > 100) {
    return res.status(400).json({ error: 'page/limit deben ser enteros positivos (limit ≤ 100)' });
  }
  if (tipo && !TIPOS_MOVIMIENTO.includes(tipo)) {
    return res.status(400).json({ error: `tipo inválido — válidos: ${TIPOS_MOVIMIENTO.join(', ')}` });
  }
  let productoId;
  if (producto_id !== undefined) {
    productoId = Number(producto_id);
    if (!Number.isInteger(productoId) || productoId < 1) {
      return res.status(400).json({ error: 'producto_id debe ser un entero positivo' });
    }
  }

  res.json(
    listHistorial({
      productoId,
      tipo: tipo || undefined,
      desde: desde ? capString(desde, 30) : undefined,
      hasta: hasta ? capString(hasta, 30) : undefined,
      page: p,
      limit: l,
    }),
  );
}
