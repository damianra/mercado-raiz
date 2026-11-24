import { CANALES_VENTA, listVentas, registrarVenta, registrarVentasBatch } from '../models/ventas.model.js';
import { capString } from '../security.js';

const badRequest = (res, msg) => res.status(400).json({ error: msg });
// Cota razonable para un evento POS — ventas de bulto van por MAYOR.
const UNIDADES_MAX = 100_000;
const MAX_LOTE_VENTAS = 500;

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

// SPEC-30 (T30.2): validación sin coercion — Number(null)/Number('')
// /Number(true) convierten a valores "válidos" que no lo son (la misma
// convención estricta de validarItemOrden).
function validarItemVenta(raw) {
  const { producto_id, unidades, canal, fecha, referencia } = raw ?? {};
  if (!Number.isInteger(producto_id) || producto_id < 1) {
    return 'producto_id debe ser un entero positivo';
  }
  if (!Number.isInteger(unidades) || unidades < 1 || unidades > UNIDADES_MAX) {
    return `unidades debe ser un entero entre 1 y ${UNIDADES_MAX}`;
  }
  if (!CANALES_VENTA.includes(canal)) {
    return `canal inválido — válidos: ${CANALES_VENTA.join(', ')}`;
  }
  if (fecha !== undefined && !esFechaValida(fecha)) {
    return 'fecha debe ser una fecha YYYY-MM-DD válida';
  }
  return {
    productoId: producto_id,
    unidades,
    canal,
    fecha,
    referencia: referencia ? capString(referencia, 120) : undefined,
  };
}

// Punto de integración POS real — un evento de venta que descuenta
// stock + historial en la misma transacción.
export async function create(req, res) {
  const item = validarItemVenta(req.body);
  if (typeof item === 'string') return badRequest(res, item);

  const r = await registrarVenta({ ...item, usuario: req.usuario.email });
  if (r.status === 201) return res.status(201).json({ success: true, data: r.data });
  return res.status(r.status).json({ error: r.error });
}

// POST /api/ventas/batch — la integración POS manda el lote de un
// cierre/turno en UNA request (una escritura para el rate limiter —
// como /ordenes/batch). Todo o nada: cualquier item inválido o
// producto inexistente → 400 con detalle por índice y nada se persiste.
export async function createBatch(req, res) {
  const items = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return badRequest(res, 'el body debe ser un array de ventas no vacío');
  }
  if (items.length > MAX_LOTE_VENTAS) {
    return badRequest(res, `el lote supera el máximo de ${MAX_LOTE_VENTAS} ventas`);
  }

  const errores = [];
  const validados = items.map((raw, indice) => {
    const item = validarItemVenta(raw);
    if (typeof item === 'string') errores.push({ indice, error: item });
    return item;
  });
  if (errores.length) {
    return res.status(400).json({ error: 'items inválidos en el lote', detalle: errores });
  }

  const resultado = await registrarVentasBatch(validados, req.usuario.email);
  if (resultado.faltantes) {
    return res.status(400).json({
      error: 'productos inexistentes en el lote — no se registró ninguna venta',
      detalle: resultado.faltantes.map((f) => ({ ...f, error: 'producto no encontrado' })),
    });
  }

  res.status(201).json({
    success: true,
    message: `${resultado.ventas.length} ventas registradas`,
    data: resultado.ventas,
  });
}
