import { openDb } from '../db.js';
import { estadoProducto, leadEsperado } from './productos.model.js';

export const ESTADOS_ORDEN = [
  'PENDIENTE_APROBACION',
  'APROBADA',
  'RECHAZADA',
  'ENVIADA',
  'RECIBIDA',
];

// Monto a partir del cual una orden exige aprobación humana.
export const UMBRAL_APROBACION = 50000; // ARS — recalibrado en SPEC-22 (era 100, escala demo)

export const SORT_COLUMNS = {
  fecha_creacion: 'o.fecha_creacion',
  monto_total: 'o.monto_total',
  estado: 'o.estado',
};

// Las escrituras mandan el timestamp desde JS en ISO — timestamptz lo
// acepta tal cual y queda consistente con los cutoffs que calcula el
// dashboard.
const now = () => new Date().toISOString();

const FROM_ORDEN = `FROM ordenes_compra o
  JOIN productos p ON p.id = o.producto_id
  JOIN proveedores pr ON pr.id = o.proveedor_id`;

const SELECT_ORDEN = `SELECT o.id, o.orden_id, o.cantidad, o.precio_unitario, o.monto_total,
    o.estado, o.requiere_aprobacion, o.analisis_ia, o.aprobado_por,
    o.motivo_rechazo, o.fecha_aprobacion, o.fecha_creacion, o.fecha_actualizacion,
    p.id AS p_id, p.sku AS p_sku, p.nombre AS p_nombre, p.categoria AS p_categoria,
    p.stock_actual AS p_stock_actual, p.stock_minimo AS p_stock_minimo,
    p.precio_venta AS p_precio_venta, p.ubicacion AS p_ubicacion,
    pr.id AS pr_id, pr.nombre AS pr_nombre, pr.contacto AS pr_contacto,
    pr.telefono AS pr_telefono, pr.email AS pr_email,
    pr.tiempo_entrega_dias AS pr_tiempo_entrega_dias,
    pr.tiempo_entrega_min_dias AS pr_min, pr.tiempo_entrega_max_dias AS pr_max
  ${FROM_ORDEN}`;

function mapOrdenResumen(row) {
  return {
    id: row.id,
    orden_id: row.orden_id,
    producto: {
      id: row.p_id,
      sku: row.p_sku,
      nombre: row.p_nombre,
      stock_actual: row.p_stock_actual,
      stock_minimo: row.p_stock_minimo,
    },
    proveedor: {
      id: row.pr_id,
      nombre: row.pr_nombre,
      tiempo_entrega_dias: row.pr_tiempo_entrega_dias,
      tiempo_entrega_min_dias: row.pr_min,
      tiempo_entrega_max_dias: row.pr_max,
      lead_dias_esperado: leadEsperado(row),
    },
    cantidad: row.cantidad,
    precio_unitario: row.precio_unitario,
    monto_total: row.monto_total,
    estado: row.estado,
    requiere_aprobacion: !!row.requiere_aprobacion,
    analisis_ia: row.analisis_ia,
    fecha_creacion: row.fecha_creacion,
  };
}

function mapOrdenDetalle(row) {
  return {
    ...mapOrdenResumen(row),
    producto: {
      ...mapOrdenResumen(row).producto,
      categoria: row.p_categoria,
      precio_venta: row.p_precio_venta,
      ubicacion: row.p_ubicacion,
      estado: estadoProducto(row.p_stock_actual, row.p_stock_minimo),
    },
    proveedor: {
      id: row.pr_id,
      nombre: row.pr_nombre,
      contacto: row.pr_contacto,
      telefono: row.pr_telefono,
      email: row.pr_email,
      tiempo_entrega_dias: row.pr_tiempo_entrega_dias,
      tiempo_entrega_min_dias: row.pr_min,
      tiempo_entrega_max_dias: row.pr_max,
      lead_dias_esperado: leadEsperado(row),
    },
    aprobado_por: row.aprobado_por,
    motivo_rechazo: row.motivo_rechazo,
    fecha_aprobacion: row.fecha_aprobacion,
    fecha_actualizacion: row.fecha_actualizacion,
  };
}

const esSoloFecha = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);

export async function listOrdenes({
  estado,
  requiereAprobacion,
  fechaDesde,
  fechaHasta,
  search,
  sort,
  order,
  page,
  limit,
}) {
  const db = await openDb();
  const where = [];
  const params = [];

  if (estado) {
    where.push('o.estado = ?');
    params.push(estado);
  }
  if (requiereAprobacion !== undefined) {
    where.push('o.requiere_aprobacion = ?');
    params.push(requiereAprobacion);
  }
  // Con fecha sin hora se compara por date() — un '<= 2026-10-31' a
  // pelo excluiría todo lo creado ese día después de las 00:00.
  // El 'día' es UTC: AT TIME ZONE fija la fecha al calendario UTC
  // (como era en SQLite) — sin eso date() usa la TZ de sesión.
  if (fechaDesde) {
    where.push(esSoloFecha(fechaDesde) ? "date(o.fecha_creacion AT TIME ZONE 'UTC') >= ?" : 'o.fecha_creacion >= ?');
    params.push(fechaDesde);
  }
  if (fechaHasta) {
    where.push(esSoloFecha(fechaHasta) ? "date(o.fecha_creacion AT TIME ZONE 'UTC') <= ?" : 'o.fecha_creacion <= ?');
    params.push(fechaHasta);
  }
  if (search) {
    // ILIKE — ver nota en productos.model.
    where.push('(o.orden_id ILIKE ? OR p.nombre ILIKE ? OR p.sku ILIKE ? OR pr.nombre ILIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }

  const fromWhere = `${FROM_ORDEN}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`;

  const { c: total } = await db.get(`SELECT COUNT(*) AS c ${fromWhere}`, params);
  const rows = await db.all(
    `${SELECT_ORDEN}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}
     ORDER BY ${SORT_COLUMNS[sort]} ${order}
     LIMIT ? OFFSET ?`,
    [...params, limit, (page - 1) * limit],
  );

  return {
    data: rows.map(mapOrdenResumen),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function getOrden(ordenId) {
  const db = await openDb();
  const row = await db.get(`${SELECT_ORDEN} WHERE o.orden_id = ?`, [ordenId]);
  return row ? mapOrdenDetalle(row) : null;
}

const INSERT_ORDEN = `INSERT INTO ordenes_compra
  (orden_id, producto_id, proveedor_id, cantidad, precio_unitario, monto_total,
   estado, requiere_aprobacion, analisis_ia, aprobado_por, fecha_aprobacion,
   fecha_creacion, fecha_actualizacion)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

async function insertarOrden(
  t, ordenId, producto,
  { cantidad, requiereAprobacion, analisisIa, proveedorId, costoResuelto }, ts,
) {
  // SPEC-27: la orden se precia con el costo del proveedor elegido
  // (item.proveedorId → su fila producto_proveedor ya validada); el
  // default es el principal. Fallback a precio_venta si el producto
  // no tiene fila de precios (insert manual en tests).
  const proveedor = proveedorId ?? producto.proveedor_id;
  const costo = costoResuelto ?? producto.costo_unitario ?? producto.precio_venta;
  const montoTotal = Math.round(cantidad * costo * 100) / 100;
  const requiere = requiereAprobacion ?? montoTotal >= UMBRAL_APROBACION;
  await t.prepare(INSERT_ORDEN).run(
    ordenId,
    producto.id,
    proveedor,
    cantidad,
    costo,
    montoTotal,
    requiere ? 'PENDIENTE_APROBACION' : 'APROBADA',
    requiere ? 1 : 0,
    analisisIa ?? null,
    requiere ? null : 'auto',
    requiere ? null : ts,
    ts,
    ts,
  );
}

const PROXIMO_ID =
  "SELECT MAX(CAST(SUBSTR(orden_id, 4) AS INTEGER)) AS maxId FROM ordenes_compra WHERE orden_id LIKE 'OC-%'";

// SPEC-27 (T27.3): si el item pide un proveedor alternativo, su
// costo sale de producto_proveedor (debe existir fila activa — sino
// 400). Devuelve { costoResuelto } o { sinPrecio }.
async function resolverCosto(db, producto, proveedorId) {
  if (proveedorId == null || proveedorId === producto.proveedor_id) {
    return { costoResuelto: null }; // usa la fila del JOIN principal
  }
  const pp = await db.get(
    `SELECT pp.costo_unitario FROM producto_proveedor pp
     JOIN proveedores pr ON pr.id = pp.proveedor_id AND pr.activo = 1
     WHERE pp.producto_id = ? AND pp.proveedor_id = ? AND pp.activo = 1`,
    [producto.id, proveedorId],
  );
  return pp
    ? { costoResuelto: pp.costo_unitario }
    : { sinPrecio: `proveedor ${proveedorId} sin precio activo para producto ${producto.id}` };
}

// Crea la orden: precio y proveedor salen del producto, el monto se
// calcula server-side y el orden_id es el próximo 'OC-NNN' secuencial.
// Devuelve null si el producto no existe (el controller → 404).
export async function createOrden(requerido) {
  const { productoId } = requerido;
  const db = await openDb();
  const producto = await db.get(
    `SELECT p.*, pp.costo_unitario FROM productos p
     LEFT JOIN producto_proveedor pp
       ON pp.producto_id = p.id AND pp.proveedor_id = p.proveedor_id AND pp.activo = 1
     WHERE p.id = ?`,
    [productoId],
  );
  if (!producto) return null;
  const resolucion = await resolverCosto(db, producto, requerido.proveedorId);
  if (resolucion.sinPrecio) return { sinPrecio: resolucion.sinPrecio };
  const item = { ...requerido, costoResuelto: resolucion.costoResuelto };

  // Transacción: el MAX(orden_id) y el INSERT deben ser atómicos o dos
  // creaciones concurrentes podrían generar el mismo OC-NNN.
  const ordenId = await db.tx(async (t) => {
    const { maxid } = await t.prepare(PROXIMO_ID).get();
    const nextId = `OC-${String((maxid ?? 0) + 1).padStart(3, '0')}`;
    await insertarOrden(t, nextId, producto, item, now());
    return nextId;
  });

  return getOrden(ordenId);
}

/**
 * Crea N órdenes en UNA transacción (SPEC-16): todo o nada — si un
 * item es inválido no se persiste ninguno. Primero verifica que
 * TODOS los productos existan (devuelve { faltantes } con detalle
 * por índice para el 400 del controller); después genera la
 * secuencia OC-NNN y los INSERT en una sola transacción.
 * items: [{ productoId, cantidad, requiereAprobacion?, analisisIa? }]
 */
export async function createOrdenesBatch(items) {
  const db = await openDb();
  const buscarProducto = db.prepare(`SELECT p.*, pp.costo_unitario FROM productos p
    LEFT JOIN producto_proveedor pp
      ON pp.producto_id = p.id AND pp.proveedor_id = p.proveedor_id AND pp.activo = 1
    WHERE p.id = ?`);

  const faltantes = [];
  const sinPrecio = [];
  const resueltos = [];
  for (const [indice, item] of items.entries()) {
    const producto = await buscarProducto.get(item.productoId);
    if (!producto) {
      faltantes.push({ indice, producto_id: item.productoId });
      resueltos.push({ item, producto });
      continue;
    }
    const resolucion = await resolverCosto(db, producto, item.proveedorId);
    if (resolucion.sinPrecio) {
      sinPrecio.push({ indice, producto_id: item.productoId, error: resolucion.sinPrecio });
    }
    resueltos.push({ item: { ...item, costoResuelto: resolucion.costoResuelto }, producto });
  }
  if (faltantes.length) return { faltantes };
  if (sinPrecio.length) return { sinPrecio };

  const ordenIds = await db.tx(async (t) => {
    const { maxid } = await t.prepare(PROXIMO_ID).get();
    let next = (maxid ?? 0) + 1;
    const ts = now();
    const ids = [];
    for (const { item, producto } of resueltos) {
      const ordenId = `OC-${String(next++).padStart(3, '0')}`;
      await insertarOrden(t, ordenId, producto, item, ts);
      ids.push(ordenId);
    }
    return ids;
  });

  const ordenes = [];
  for (const ordenId of ordenIds) ordenes.push(await getOrden(ordenId));
  return { ordenes };
}

// Las transiciones solo son válidas desde PENDIENTE_APROBACION — el
// controller verifica existencia/estado antes de llamar acá.
export async function aprobarOrden(ordenId, aprobadoPor) {
  const db = await openDb();
  const ts = now();
  await db.run(
    `UPDATE ordenes_compra
     SET estado = 'APROBADA', aprobado_por = ?, fecha_aprobacion = ?, fecha_actualizacion = ?
     WHERE orden_id = ?`,
    [aprobadoPor, ts, ts, ordenId],
  );
  return getOrden(ordenId);
}

export async function rechazarOrden(ordenId, rechazadoPor, motivo) {
  const db = await openDb();
  const ts = now();
  await db.run(
    `UPDATE ordenes_compra
     SET estado = 'RECHAZADA', aprobado_por = ?, motivo_rechazo = ?, fecha_aprobacion = ?, fecha_actualizacion = ?
     WHERE orden_id = ?`,
    [rechazadoPor, motivo, ts, ts, ordenId],
  );
  return getOrden(ordenId);
}
