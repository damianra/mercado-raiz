import { estadisticaDemanda, estadisticasDemandaBulk } from '../models/estadisticas.model.js';

// R26.7: GET /api/estadisticas/demanda?producto_id=&dias=90 —
// un producto. R26.9/T26.7: sin producto_id devuelve las mismas
// stats de TODOS los productos (dashboard: demanda/cobertura).
export async function demanda(req, res) {
  const dias = req.query.dias === undefined ? 90 : Number(req.query.dias);
  if (!Number.isInteger(dias) || dias < 7 || dias > 365) {
    return res.status(400).json({ error: 'dias debe ser un entero entre 7 y 365' });
  }

  if (req.query.producto_id === undefined) {
    return res.json({ data: await estadisticasDemandaBulk(dias) });
  }

  const productoId = Number(req.query.producto_id);
  if (!Number.isInteger(productoId) || productoId < 1) {
    return res.status(400).json({ error: 'producto_id debe ser un entero positivo' });
  }

  const r = await estadisticaDemanda(productoId, dias);
  if (r.error) return res.status(r.status).json({ error: r.error });
  res.json(r);
}
