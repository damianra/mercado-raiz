// Cliente único del backend — todo fetch a /api pasa por apiFetch
// (manejo centralizado de errores: red caída, JSON inválido o error
// del servidor terminan en ApiError con mensaje legible para toast).
// SPEC-23: adjunta el Bearer de la sesión en memoria y ante un 401
// intenta un silent refresh + reintento único; si el refresh falla
// la sesión queda null y el Root vuelve a /login.
import { getSession, refrescarSesion } from './auth.js';

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function apiFetch(path, options = {}, reintento = false) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  const token = getSession()?.accessToken;
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`/api${path}`, { ...options, headers });
  } catch {
    throw new ApiError('No se pudo conectar con el servidor');
  }

  // Token vencido/revocado → un refresh y un solo reintento.
  if (res.status === 401 && !reintento) {
    const sesion = await refrescarSesion();
    if (sesion) return apiFetch(path, options, true);
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

// La identidad del aprobador sale del JWT (SPEC-23 R23.6) — no se
// manda más en el body.
export const aprobarOrden = (ordenId) =>
  apiFetch(`/ordenes/${encodeURIComponent(ordenId)}/aprobar`, {
    method: 'POST',
    body: '{}',
  });

export const rechazarOrden = (ordenId, motivo) =>
  apiFetch(`/ordenes/${encodeURIComponent(ordenId)}/rechazar`, {
    method: 'POST',
    body: JSON.stringify({ motivo }),
  });

// SPEC-24: gestión de usuarios — todos estos endpoints exigen rol
// ADMIN en el backend; el front además oculta la sección a otros
// roles (regla UI n°2).
export const getUsuarios = ({ page = 1, search = '', rol = '', activo = '' } = {}) => {
  const qs = new URLSearchParams({ page: String(page), limit: '20' });
  if (search) qs.set('search', search);
  if (rol) qs.set('rol', rol);
  if (activo !== '') qs.set('activo', activo);
  return apiFetch(`/usuarios?${qs}`);
};

export const crearUsuario = ({ email, nombre, rol, password }) =>
  apiFetch('/usuarios', {
    method: 'POST',
    body: JSON.stringify({ email, nombre, rol, password }),
  });

export const editarUsuario = (id, cambios) =>
  apiFetch(`/usuarios/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(cambios),
  });

export const borrarUsuario = (id) =>
  apiFetch(`/usuarios/${id}`, { method: 'DELETE' });
