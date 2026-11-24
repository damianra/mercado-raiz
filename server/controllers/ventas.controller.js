import { CANALES_VENTA, listVentas, registrarVenta } from '../models/ventas.model.js';
import { capString } from '../security.js';

const badRequest = (res, msg) => res.status(400).json({ error: msg });
// Cota razonable para un evento POS — ventas de bulto van por MAYOR.
const UNIDADES_MAX = 100_000;

// Valida forma YYYY-MM-DD y que sea una fecha real — '2026-99-99'
// pasaría el regex pero reventaría el cast ::date con un 500.
const esFechaValida = (v) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

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
    if (valor && !esFechaValida(valor)) {
      return res.status(400).json({ error: `${nombre} debe ser una fecha YYYY-MM-DD válida` });
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

// SPEC-30 (T30.2): punto de integración POS real — un evento de
// venta que descuenta stock + historial en la misma transacción.
export async function create(req, res) {
  const { producto_id, unidades, canal, fecha, referencia } = req.body ?? {};
  const productoId = Number(producto_id);
  const uds = Number(unidades);
  if (!Number.isInteger(productoId) || productoId < 1) {
    return badRequest(res, 'producto_id debe ser un entero positivo');
  }
  if (!Number.isInteger(uds) || uds < 1 || uds > UNIDADES_MAX) {
    return badRequest(res, `unidades debe ser un entero entre 1 y ${UNIDADES_MAX}`);
  }
  if (!CANALES_VENTA.includes(canal)) {
    return badRequest(res, `canal inválido — válidos: ${CANALES_VENTA.join(', ')}`);
  }
  if (fecha !== undefined && !esFechaValida(fecha)) {
    return badRequest(res, 'fecha debe ser una fecha YYYY-MM-DD válida');
  }

  const r = await registrarVenta({
    productoId,
    unidades: uds,
    canal,
    fecha,
    referencia: referencia ? capString(referencia, 120) : undefined,
    usuario: req.usuario.email,
  });
  if (r.status === 201) return res.status(201).json({ success: true, data: r.data });
  return res.status(r.status).json({ error: r.error });
}
