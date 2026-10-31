// Cliente único del backend — todo fetch a /api pasa por apiFetch
// (manejo centralizado de errores: red caída, JSON inválido o error
// del servidor terminan en ApiError con mensaje legible para toast).
export const USUARIO_DEMO = 'carlos.martinez@mercadorai.com';

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function apiFetch(path, options = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
  } catch {
    throw new ApiError('No se pudo conectar con el servidor');
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    // Respuesta sin JSON — se reporta por status abajo.
  }
  if (!res.ok) {
    throw new ApiError(body?.error ?? `Error ${res.status} del servidor`, res.status);
  }
  return body;
}

// Adapta la respuesta del backend (producto{}/proveedor{} anidados,
// estados PENDIENTE_APROBACION/APROBADA/RECHAZADA/ENVIADA/RECIBIDA)
// a la shape plana que renderizan OrdersTable/OrderModal.
export function mapOrden(o) {
  const autoAprobada = o.estado === 'APROBADA' && !o.requiere_aprobacion;
  const estado =
    {
      PENDIENTE_APROBACION: 'PENDIENTE_APROBACION',
      APROBADA: autoAprobada ? 'APROBADO_AUTO' : 'APROBADO',
      RECHAZADA: 'RECHAZADO',
      ENVIADA: 'ENVIADA',
      RECIBIDA: 'RECIBIDA',
    }[o.estado] ?? 'PENDIENTE_APROBACION';
  const stockActual = o.producto?.stock_actual ?? 0;
  return {
    id: o.orden_id,
    producto: o.producto?.nombre ?? '—',
    sku: o.producto?.sku ?? '',
    proveedor: o.proveedor?.nombre ?? '—',
    cantidad: o.cantidad,
    precioUnitario: o.precio_unitario,
    monto: o.monto_total,
    estado,
    fecha: o.fecha_creacion,
    stockActual,
    stockMinimo: o.producto?.stock_minimo ?? 0,
    entregaDias: o.proveedor?.tiempo_entrega_dias ?? null,
    urgente: o.estado === 'PENDIENTE_APROBACION' && stockActual === 0,
    analisisIA: o.analisis_ia ?? 'Sin análisis disponible.',
  };
}

export const getOrdenes = () =>
  apiFetch('/ordenes?limit=100&sort=fecha_creacion&order=DESC');

export const getProductos = () => apiFetch('/productos?limit=100');

export const getDashboardStats = () => apiFetch('/dashboard/stats');

export const crearOrden = ({ productoId, cantidad, requiereAprobacion }) =>
  apiFetch('/ordenes', {
    method: 'POST',
    body: JSON.stringify({
      producto_id: productoId,
      cantidad,
      ...(requiereAprobacion !== undefined && {
        requiere_aprobacion: requiereAprobacion,
      }),
    }),
  });

export const aprobarOrden = (ordenId) =>
  apiFetch(`/ordenes/${encodeURIComponent(ordenId)}/aprobar`, {
    method: 'POST',
    body: JSON.stringify({ aprobado_por: USUARIO_DEMO }),
  });

export const rechazarOrden = (ordenId, motivo) =>
  apiFetch(`/ordenes/${encodeURIComponent(ordenId)}/rechazar`, {
    method: 'POST',
    body: JSON.stringify({ rechazado_por: USUARIO_DEMO, motivo }),
  });
