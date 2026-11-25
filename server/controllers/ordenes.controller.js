import { capString } from '../security.js';
import {
  ESTADOS_ORDEN,
  SORT_COLUMNS,
  aprobarOrden,
  createOrden,
  createOrdenesBatch,
  enviarOrden,
  getOrden,
  listOrdenes,
  recibirOrden,
  rechazarOrden,
} from '../models/ordenes.model.js';

const badRequest = (res, msg) => res.status(400).json({ error: msg });

// page/limit: enteros ≥1; limit tope 100. Cualquier otra cosa → 400.
function parsePaginacion(req, res) {
  const { page = '1', limit = '20' } = req.query;
  const p = Number(page);
  const l = Number(limit);
  if (!Number.isInteger(p) || p < 1 || !Number.isInteger(l) || l < 1 || l > 100) {
    badRequest(res, 'page/limit deben ser enteros positivos (limit ≤ 100)');
    return null;
  }
  return { page: p, limit: l };
}

function parseRequiere(v) {
  if (v === undefined) return undefined;
  if (v === 'true' || v === '1') return 1;
  if (v === 'false' || v === '0') return 0;
  return null;
}

export async function list(req, res) {
  const pag = parsePaginacion(req, res);
  if (!pag) return;

  const { estado, requiere_aprobacion, fecha_desde, fecha_hasta, search, sort = 'fecha_creacion', order = 'DESC' } = req.query;

  if (estado && !ESTADOS_ORDEN.includes(estado)) {
    return badRequest(res, `estado inválido — válidos: ${ESTADOS_ORDEN.join(', ')}`);
  }
  const reqAp = parseRequiere(requiere_aprobacion);
  if (reqAp === null) return badRequest(res, 'requiere_aprobacion debe ser true/false');
  if (!SORT_COLUMNS[sort]) {
    return badRequest(res, `sort inválido — válidos: ${Object.keys(SORT_COLUMNS).join(', ')}`);
  }
  const ord = String(order).toUpperCase();
  if (ord !== 'ASC' && ord !== 'DESC') return badRequest(res, 'order debe ser ASC o DESC');

  res.json(
    await listOrdenes({
      estado: estado || undefined,
      requiereAprobacion: reqAp,
      fechaDesde: fecha_desde || undefined,
      fechaHasta: fecha_hasta || undefined,
      search: search ? capString(search, 100) : undefined,
      sort,
      order: ord,
      ...pag,
    }),
  );
}

export async function detail(req, res) {
  const orden = await getOrden(req.params.orden_id);
  if (!orden) return res.status(404).json({ error: 'orden no encontrada' });
  res.json(orden);
}

// Valida un item de orden y lo normaliza al shape del model.
// Devuelve el item listo o un string con el error de validación.
function validarItemOrden({ producto_id, cantidad, requiere_aprobacion, analisis_ia, proveedor_id } = {}) {
  if (!Number.isInteger(producto_id)) {
    return 'producto_id es requerido y debe ser entero';
  }
  if (!Number.isInteger(cantidad) || cantidad <= 0) {
    return 'cantidad es requerida y debe ser un entero > 0';
  }
  if (requiere_aprobacion !== undefined && typeof requiere_aprobacion !== 'boolean') {
    return 'requiere_aprobacion debe ser boolean';
  }
  if (proveedor_id !== undefined && (!Number.isInteger(proveedor_id) || proveedor_id < 1)) {
    return 'proveedor_id debe ser un entero positivo';
  }
  return {
    productoId: producto_id,
    proveedorId: proveedor_id,
    cantidad,
    requiereAprobacion: requiere_aprobacion,
    analisisIa: analisis_ia ? capString(analisis_ia, 2000) : null,
  };
}

export async function create(req, res) {
  const item = validarItemOrden(req.body ?? {});
  if (typeof item === 'string') return badRequest(res, item);

  const orden = await createOrden(item);
  if (!orden) return res.status(404).json({ error: 'producto no encontrado' });
  if (orden.sinPrecio) {
    return res.status(400).json({ error: orden.sinPrecio });
  }

  res.status(201).json({
    success: true,
    message: `Orden ${orden.orden_id} creada exitosamente`,
    data: orden,
  });
}

/**
 * POST /api/ordenes/batch — array de órdenes en una transacción
 * (SPEC-16). Todo o nada: si CUALQUIER item no valida (forma o
 * producto inexistente) → 400 con detalle por índice y no se
 * persiste nada. Una request = una escritura para el rate
 * limiter, por eso el harness la usa para sus corridas.
 */
const MAX_LOTE_ORDENES = 200;

export async function createBatch(req, res) {
  const items = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return badRequest(res, 'el body debe ser un array de órdenes no vacío');
  }
  if (items.length > MAX_LOTE_ORDENES) {
    return badRequest(res, `el lote supera el máximo de ${MAX_LOTE_ORDENES} órdenes`);
  }

  const errores = [];
  const validados = items.map((raw, indice) => {
    const item = validarItemOrden(raw ?? {});
    if (typeof item === 'string') errores.push({ indice, error: item });
    return item;
  });
  if (errores.length) {
    return res.status(400).json({ error: 'items inválidos en el lote', detalle: errores });
  }

  const resultado = await createOrdenesBatch(validados);
  if (resultado.faltantes) {
    return res.status(400).json({
      error: 'productos inexistentes en el lote — no se creó ninguna orden',
      detalle: resultado.faltantes.map((f) => ({ ...f, error: 'producto no encontrado' })),
    });
  }
  if (resultado.sinPrecio) {
    return res.status(400).json({
      error: 'proveedores sin precio para el producto — no se creó ninguna orden',
      detalle: resultado.sinPrecio,
    });
  }

  res.status(201).json({
    success: true,
    message: `${resultado.ordenes.length} órdenes creadas exitosamente`,
    data: resultado.ordenes,
  });
}

// Solo se puede aprobar/rechazar desde PENDIENTE_APROBACION — otro
// estado es una transición inválida (409), no un error de validación.
async function ordenPendienteOError(req, res) {
  const orden = await getOrden(req.params.orden_id);
  if (!orden) {
    res.status(404).json({ error: 'orden no encontrada' });
    return null;
  }
  if (orden.estado !== 'PENDIENTE_APROBACION') {
    res.status(409).json({
      error: `la orden no está pendiente de aprobación (estado actual: ${orden.estado})`,
      estado: orden.estado,
    });
    return null;
  }
  return orden;
}

export async function aprobar(req, res) {
  if (!(await ordenPendienteOError(req, res))) return;
  // aprobado_por sale del token (SPEC-23) — el body ya no lo setea.
  const aprobadoPor = req.usuario.email;
  const orden = await aprobarOrden(req.params.orden_id, aprobadoPor);
  res.json({
    success: true,
    message: `Orden ${orden.orden_id} aprobada exitosamente`,
    data: {
      orden_id: orden.orden_id,
      estado: orden.estado,
      aprobado_por: orden.aprobado_por,
      fecha_aprobacion: orden.fecha_aprobacion,
    },
  });
}

export async function rechazar(req, res) {
  const motivo = typeof req.body?.motivo === 'string' ? req.body.motivo.trim() : '';
  if (!motivo) return badRequest(res, 'motivo es requerido para rechazar una orden');
  if (!(await ordenPendienteOError(req, res))) return;
  const rechazadoPor = req.usuario.email; // del token (SPEC-23)
  const orden = await rechazarOrden(req.params.orden_id, rechazadoPor, capString(motivo, 500));
  res.json({
    success: true,
    message: `Orden ${orden.orden_id} rechazada`,
    data: {
      orden_id: orden.orden_id,
      estado: orden.estado,
      motivo: orden.motivo_rechazo,
    },
  });
}

// SPEC-30 (T30.1): APROBADA → ENVIADA. Guard de estado igual que
// aprobar/rechazar — 404 si no existe, 409 en transición inválida.
export async function enviar(req, res) {
  const orden = await getOrden(req.params.orden_id);
  if (!orden) return res.status(404).json({ error: 'orden no encontrada' });
  if (orden.estado !== 'APROBADA') {
    return res.status(409).json({
      error: `solo se puede enviar una orden aprobada (estado actual: ${orden.estado})`,
      estado: orden.estado,
    });
  }
  const o = await enviarOrden(req.params.orden_id, req.usuario.email);
  // null → otra request ya transicionó la orden (race): 409 honesto.
  if (!o) {
    return res.status(409).json({
      error: 'la orden ya cambió de estado — recargá y reintentá',
    });
  }
  res.json({
    success: true,
    message: `Orden ${o.orden_id} marcada como enviada`,
    data: { orden_id: o.orden_id, estado: o.estado, enviado_por: o.enviado_por, fecha_envio: o.fecha_envio },
  });
}

// SPEC-30 (T30.1): ENVIADA → RECIBIDA. cantidad_recibida opcional
// (default la pedida completa); parcial deja el faltante medible.
// La recepción suma stock + historial en la misma tx (model).
export async function recibir(req, res) {
  const orden = await getOrden(req.params.orden_id);
  if (!orden) return res.status(404).json({ error: 'orden no encontrada' });
  if (orden.estado !== 'ENVIADA') {
    return res.status(409).json({
      error: `solo se puede recibir una orden enviada (estado actual: ${orden.estado})`,
      estado: orden.estado,
    });
  }
  const recibida = req.body?.cantidad_recibida ?? orden.cantidad;
  if (!Number.isInteger(recibida) || recibida < 1 || recibida > orden.cantidad) {
    return badRequest(res, `cantidad_recibida debe ser un entero entre 1 y ${orden.cantidad}`);
  }
  // SPEC-33 (R33.4): el remito puede traer el vencimiento del lote —
  // opcional; sin ella el model aplica hoy+vida_util_dias.
  const venc = req.body?.fecha_vencimiento;
  if (venc !== undefined) {
    const d = typeof venc === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(venc)
      ? new Date(`${venc}T00:00:00Z`)
      : null;
    if (!d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== venc) {
      return badRequest(res, 'fecha_vencimiento debe ser una fecha YYYY-MM-DD válida');
    }
  }
  const o = await recibirOrden(
    req.params.orden_id,
    recibida,
    req.usuario.email,
    venc ?? undefined,
  );
  // null → carrera: otra request ya la recibió → el stock NO se
  // duplicó y esta es la respuesta honesta.
  if (!o) {
    return res.status(409).json({
      error: 'la orden ya fue recibida — el stock no se volvió a sumar',
    });
  }
  res.json({
    success: true,
    message: `Orden ${o.orden_id} recibida — stock actualizado`,
    data: {
      orden_id: o.orden_id,
      estado: o.estado,
      cantidad: o.cantidad,
      cantidad_recibida: o.cantidad_recibida,
      faltante: o.cantidad - o.cantidad_recibida,
      recibido_por: o.recibido_por,
      stock_actual: o.producto.stock_actual,
    },
  });
}
