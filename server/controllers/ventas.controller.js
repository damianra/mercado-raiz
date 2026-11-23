import { CANALES_VENTA, listVentas } from '../models/ventas.model.js';
import { capString } from '../security.js';

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function list(req, res) {
  const { producto_id, canal, desde, hasta, page = '1', limit = '50' } = req.query;

  const p = Number(page);
  const l = Number(limit);
  if (!Number.isInteger(p) || p < 1 || !Number.isInteger(l) || l < 1 || l > 100) {
    return res.status(400).json({ error: 'page/limit deben ser enteros positivos (limit ≤ 100)' });
  }
  if (canal && !CANALES_VENTA.includes(canal)) {
    return res.status(400).json({ error: `canal inválido — válidos: ${CANALES_VENTA.join(', ')}` });
  }
  for (const [nombre, valor] of [['desde', desde], ['hasta', hasta]]) {
    if (valor && !FECHA_RE.test(valor)) {
      return res.status(400).json({ error: `${nombre} debe ser YYYY-MM-DD` });
    }
  }
  let productoId;
  if (producto_id !== undefined) {
    productoId = Number(producto_id);
    if (!Number.isInteger(productoId) || productoId < 1) {
      return res.status(400).json({ error: 'producto_id debe ser un entero positivo' });
    }
  }

  res.json(
    await listVentas({
      productoId,
      canal: canal || undefined,
      desde: desde ? capString(desde, 10) : undefined,
      hasta: hasta ? capString(hasta, 10) : undefined,
      page: p,
      limit: l,
    }),
  );
}
