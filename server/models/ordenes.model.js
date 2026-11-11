import { openDb } from '../db.js';
import { estadoProducto } from './productos.model.js';

export const ESTADOS_ORDEN = [
  'PENDIENTE_APROBACION',
  'APROBADA',
  'RECHAZADA',
  'ENVIADA',
  'RECIBIDA',
];

// Monto a partir del cual una orden exige aprobación humana.
export const UMBRAL_APROBACION = 100;

export const SORT_COLUMNS = {
  fecha_creacion: 'o.fecha_creacion',
  monto_total: 'o.monto_total',
  estado: 'o.estado',
};

// Formato consistente con el seed ('YYYY-MM-DDTHH:MM:SS') — mezclarlo
// con el datetime('now') de SQLite (espacio en vez de 'T') rompería el
// orden lexicográfico que usan los filtros de fecha y el sort.
const now = () => new Date().toISOString().slice(0, 19);

const FROM_ORDEN = `FROM ordenes_compra o
  JOIN productos p ON p.id = o.producto_id
  JOIN proveedores pr ON pr.id = o.proveedor_id`;

const SELECT_ORDEN = `SELECT o.id, o.orden_id, o.cantidad, o.precio_unitario, o.monto_total,
    o.estado, o.requiere_aprobacion, o.analisis_ia, o.aprobado_por,
    o.motivo_rechazo, o.fecha_aprobacion, o.fecha_creacion, o.fecha_actualizacion,
    p.id AS p_id, p.sku AS p_sku, p.nombre AS p_nombre, p.categoria AS p_categoria,
    p.stock_actual AS p_stock_actual, p.stock_minimo AS p_stock_minimo,
    p.precio_unitario AS p_precio_unitario, p.ubicacion AS p_ubicacion,
    pr.id AS pr_id, pr.nombre AS pr_nombre, pr.contacto AS pr_contacto,
    pr.telefono AS pr_telefono, pr.email AS pr_email,
    pr.tiempo_entrega_dias AS pr_tiempo_entrega_dias
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
      precio_unitario: row.p_precio_unitario,
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
    },
    aprobado_por: row.aprobado_por,
    motivo_rechazo: row.motivo_rechazo,
    fecha_aprobacion: row.fecha_aprobacion,
    fecha_actualizacion: row.fecha_actualizacion,
  };
}

const esSoloFecha = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);

export function listOrdenes({
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
  const db = openDb();
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
  if (fechaDesde) {
    where.push(esSoloFecha(fechaDesde) ? 'date(o.fecha_creacion) >= ?' : 'o.fecha_creacion >= ?');
    params.push(fechaDesde);
  }
  if (fechaHasta) {
    where.push(esSoloFecha(fechaHasta) ? 'date(o.fecha_creacion) <= ?' : 'o.fecha_creacion <= ?');
    params.push(fechaHasta);
  }
  if (search) {
    where.push('(o.orden_id LIKE ? OR p.nombre LIKE ? OR p.sku LIKE ? OR pr.nombre LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }

  const fromWhere = `${FROM_ORDEN}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`;

  const { c: total } = db.prepare(`SELECT COUNT(*) AS c ${fromWhere}`).get(...params);
  const rows = db
    .prepare(`${SELECT_ORDEN}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}
       ORDER BY ${SORT_COLUMNS[sort]} ${order}
       LIMIT ? OFFSET ?`)
    .all(...params, limit, (page - 1) * limit);

  return {
    data: rows.map(mapOrdenResumen),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export function getOrden(ordenId) {
  const row = openDb().prepare(`${SELECT_ORDEN} WHERE o.orden_id = ?`).get(ordenId);
  return row ? mapOrdenDetalle(row) : null;
}

const INSERT_ORDEN = `INSERT INTO ordenes_compra
  (orden_id, producto_id, proveedor_id, cantidad, precio_unitario, monto_total,
   estado, requiere_aprobacion, analisis_ia, aprobado_por, fecha_aprobacion,
   fecha_creacion, fecha_actualizacion)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function insertarOrden(db, ordenId, producto, { cantidad, requiereAprobacion, analisisIa }, ts) {
  const montoTotal = Math.round(cantidad * producto.precio_unitario * 100) / 100;
  const requiere = requiereAprobacion ?? montoTotal >= UMBRAL_APROBACION;
  db.prepare(INSERT_ORDEN).run(
    ordenId,
    producto.id,
    producto.proveedor_id,
    cantidad,
    producto.precio_unitario,
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

// Crea la orden: precio y proveedor salen del producto, el monto se
// calcula server-side y el orden_id es el próximo 'OC-NNN' secuencial.
// Devuelve null si el producto no existe (el controller → 404).
export function createOrden({ productoId, cantidad, requiereAprobacion, analisisIa }) {
  const db = openDb();
  const producto = db.prepare('SELECT * FROM productos WHERE id = ?').get(productoId);
  if (!producto) return null;

  // Transacción: el MAX(orden_id) y el INSERT deben ser atómicos o dos
  // creaciones concurrentes podrían generar el mismo OC-NNN.
  const ordenId = db.transaction(() => {
    const { maxId } = db
      .prepare(
        "SELECT MAX(CAST(SUBSTR(orden_id, 4) AS INTEGER)) AS maxId FROM ordenes_compra WHERE orden_id LIKE 'OC-%'",
      )
      .get();
    const nextId = `OC-${String((maxId ?? 0) + 1).padStart(3, '0')}`;
    insertarOrden(db, nextId, producto, { cantidad, requiereAprobacion, analisisIa }, now());
    return nextId;
  })();

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
export function createOrdenesBatch(items) {
  const db = openDb();
  const buscarProducto = db.prepare('SELECT * FROM productos WHERE id = ?');

  const faltantes = [];
  const resueltos = items.map((item, indice) => {
    const producto = buscarProducto.get(item.productoId);
    if (!producto) faltantes.push({ indice, producto_id: item.productoId });
    return { item, producto };
  });
  if (faltantes.length) return { faltantes };

  const ordenIds = db.transaction(() => {
    const { maxId } = db
      .prepare(
        "SELECT MAX(CAST(SUBSTR(orden_id, 4) AS INTEGER)) AS maxId FROM ordenes_compra WHERE orden_id LIKE 'OC-%'",
      )
      .get();
    let next = (maxId ?? 0) + 1;
    const ts = now();
    return resueltos.map(({ item, producto }) => {
      const ordenId = `OC-${String(next++).padStart(3, '0')}`;
      insertarOrden(db, ordenId, producto, item, ts);
      return ordenId;
    });
  })();

  return { ordenes: ordenIds.map(getOrden) };
}

// Las transiciones solo son válidas desde PENDIENTE_APROBACION — el
// controller verifica existencia/estado antes de llamar acá.
export function aprobarOrden(ordenId, aprobadoPor) {
  const ts = now();
  openDb()
    .prepare(
      `UPDATE ordenes_compra
       SET estado = 'APROBADA', aprobado_por = ?, fecha_aprobacion = ?, fecha_actualizacion = ?
       WHERE orden_id = ?`,
    )
    .run(aprobadoPor, ts, ts, ordenId);
  return getOrden(ordenId);
}

export function rechazarOrden(ordenId, rechazadoPor, motivo) {
  const ts = now();
  openDb()
    .prepare(
      `UPDATE ordenes_compra
       SET estado = 'RECHAZADA', aprobado_por = ?, motivo_rechazo = ?, fecha_aprobacion = ?, fecha_actualizacion = ?
       WHERE orden_id = ?`,
    )
    .run(rechazadoPor, motivo, ts, ts, ordenId);
  return getOrden(ordenId);
}
