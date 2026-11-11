import { capString } from '../security.js';
import { notificarResume } from '../harness-notify.js';
import {
  ESTADOS_ORDEN,
  SORT_COLUMNS,
  aprobarOrden,
  createOrden,
  getOrden,
  listOrdenes,
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

export function list(req, res) {
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
    listOrdenes({
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

export function detail(req, res) {
  const orden = getOrden(req.params.orden_id);
  if (!orden) return res.status(404).json({ error: 'orden no encontrada' });
  res.json(orden);
}

export function create(req, res) {
  const { producto_id, cantidad, requiere_aprobacion, analisis_ia } = req.body ?? {};

  if (!Number.isInteger(producto_id)) {
    return badRequest(res, 'producto_id es requerido y debe ser entero');
  }
  if (!Number.isInteger(cantidad) || cantidad <= 0) {
    return badRequest(res, 'cantidad es requerida y debe ser un entero > 0');
  }
  if (requiere_aprobacion !== undefined && typeof requiere_aprobacion !== 'boolean') {
    return badRequest(res, 'requiere_aprobacion debe ser boolean');
  }

  const orden = createOrden({
    productoId: producto_id,
    cantidad,
    requiereAprobacion: requiere_aprobacion,
    analisisIa: analisis_ia ? capString(analisis_ia, 2000) : null,
  });
  if (!orden) return res.status(404).json({ error: 'producto no encontrado' });

  res.status(201).json({
    success: true,
    message: `Orden ${orden.orden_id} creada exitosamente`,
    data: orden,
  });
}

// Solo se puede aprobar/rechazar desde PENDIENTE_APROBACION — otro
// estado es una transición inválida (409), no un error de validación.
function ordenPendienteOError(req, res) {
  const orden = getOrden(req.params.orden_id);
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

export function aprobar(req, res) {
  if (!ordenPendienteOError(req, res)) return;
  const aprobadoPor = capString(req.body?.aprobado_por, 200) || 'sistema';
  const orden = aprobarOrden(req.params.orden_id, aprobadoPor);
  // La decisión humana quedó persistida → señal al agente para que
  // reanude el grafo (si hay una corrida pausada esperándolo).
  notificarResume({ orden_id: orden.orden_id, decision: 'APROBADA', por: aprobadoPor });
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

export function rechazar(req, res) {
  const motivo = typeof req.body?.motivo === 'string' ? req.body.motivo.trim() : '';
  if (!motivo) return badRequest(res, 'motivo es requerido para rechazar una orden');
  if (!ordenPendienteOError(req, res)) return;
  const rechazadoPor = capString(req.body?.rechazado_por, 200) || 'sistema';
  const orden = rechazarOrden(req.params.orden_id, rechazadoPor, capString(motivo, 500));
  notificarResume({ orden_id: orden.orden_id, decision: 'RECHAZADA', por: rechazadoPor });
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
