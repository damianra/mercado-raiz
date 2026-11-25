import { openDb } from '../db.js';
import { estadoProducto, leadEsperado } from './productos.model.js';
import { crearLoteEnTx } from './lotes.model.js';

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
    o.enviado_por, o.fecha_envio, o.cantidad_recibida, o.recibido_por, o.fecha_recepcion,
    p.id AS p_id, p.sku AS p_sku, p.nombre AS p_nombre, p.categoria AS p_categoria,
    p.stock_actual AS p_stock_actual, p.stock_minimo AS p_stock_minimo,
    p.vida_util_dias AS p_vida_util_dias,
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
      // SPEC-33 (T33.4): la recepción ofrece cargar el vencimiento
      // del lote solo si el producto es perecedero.
      vida_util_dias: row.p_vida_util_dias,
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
    cantidad_recibida: row.cantidad_recibida,
    enviado_por: row.enviado_por,
    recibido_por: row.recibido_por,
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
    enviado_por: row.enviado_por,
    fecha_envio: row.fecha_envio,
    cantidad_recibida: row.cantidad_recibida,
    recibido_por: row.recibido_por,
    fecha_recepcion: row.fecha_recepcion,
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
   alerta_id, fecha_creacion, fecha_actualizacion)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

async function insertarOrden(
  t, ordenId, producto,
  { cantidad, requiereAprobacion, analisisIa, proveedorId, costoResuelto, alertaId }, ts,
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
    alertaId ?? null,
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

const SELECT_PRODUCTO_COSTO = `SELECT p.*, pp.costo_unitario FROM productos p
     LEFT JOIN producto_proveedor pp
       ON pp.producto_id = p.id AND pp.proveedor_id = p.proveedor_id AND pp.activo = 1
     WHERE p.id = ?`;

// Variante tx-aware (SPEC-30 T30.4): crea la OC dentro de una
// transacción ya abierta — el pedido del buyer marca la alerta
// leída y crea la OC atómicamente en la misma tx. Devuelve el
// orden_id, null (producto inexistente) o { sinPrecio }.
export async function crearOrdenEnTx(t, requerido) {
  const producto = await t.get(SELECT_PRODUCTO_COSTO, [requerido.productoId]);
  if (!producto) return null;
  const resolucion = await resolverCosto(t, producto, requerido.proveedorId);
  if (resolucion.sinPrecio) return { sinPrecio: resolucion.sinPrecio };
  // El MAX(orden_id) y el INSERT viven en la misma tx o dos
  // creaciones concurrentes podrían generar el mismo OC-NNN.
  const { maxid } = await t.prepare(PROXIMO_ID).get();
  const nextId = `OC-${String((maxid ?? 0) + 1).padStart(3, '0')}`;
  await insertarOrden(
    t, nextId, producto,
    { ...requerido, costoResuelto: resolucion.costoResuelto }, now(),
  );
  return nextId;
}

// Crea la orden: precio y proveedor salen del producto, el monto se
// calcula server-side y el orden_id es el próximo 'OC-NNN' secuencial.
// Devuelve null si el producto no existe (el controller → 404).
export async function createOrden(requerido) {
  const db = await openDb();
  const ordenId = await db.tx((t) => crearOrdenEnTx(t, requerido));
  if (ordenId == null || ordenId.sinPrecio) return ordenId;
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

// SPEC-30 (T30.1): APROBADA → ENVIADA — la OC ya se le mandó al
// proveedor. El AND estado='APROBADA' guarda la transición en el
// UPDATE mismo: si otra request ya la movió entre el check del
// controller y este write, changes=0 → null → 409 (no se puede
// regresar una RECIBIDA a ENVIADA por una request lenta).
export async function enviarOrden(ordenId, enviadoPor) {
  const db = await openDb();
  const ts = now();
  const r = await db.run(
    `UPDATE ordenes_compra
     SET estado = 'ENVIADA', enviado_por = ?, fecha_envio = ?, fecha_actualizacion = ?
     WHERE orden_id = ? AND estado = 'APROBADA'`,
    [enviadoPor, ts, ts, ordenId],
  );
  if (r.changes === 0) return null;
  return getOrden(ordenId);
}

// SPEC-30 (T30.1): ENVIADA → RECIBIDA — llegó el camión. En la
// misma transacción: la OC registra cuánto llegó (cantidad_recibida
// ≤ cantidad — el camión puede traer menos: el faltante queda
// medible) y el producto SUMA stock + historial_stock REPOSICION.
export async function recibirOrden(ordenId, cantidadRecibida, recibidoPor, fechaVencimiento) {
  const db = await openDb();
  const ts = now();
  const ok = await db.tx(async (t) => {
    // La race real: dos /recibir concurrentes pasan el check del
    // controller y se serializan acá — el segundo bloquea en FOR
    // UPDATE y, al commit del primero, re-lee la fila ya RECIBIDA
    // (READ COMMITTED). El estado se verifica DENTRO del lock y la
    // transición es atómica: AND estado='ENVIADA' → changes=0 →
    // null → 409. Sin esto la segunda request volvería a sumar
    // stock y a insertar otro REPOSICION.
    const o = await t.get(
      `SELECT id, producto_id, estado FROM ordenes_compra WHERE orden_id = ? FOR UPDATE`,
      [ordenId],
    );
    if (!o || o.estado !== 'ENVIADA') return false;
    await t.run(
      `UPDATE ordenes_compra
       SET estado = 'RECIBIDA', cantidad_recibida = ?, recibido_por = ?,
           fecha_recepcion = ?, fecha_actualizacion = ?
       WHERE orden_id = ?`,
      [cantidadRecibida, recibidoPor, ts, ts, ordenId],
    );
    const { stock_actual: anterior, vida_util_dias: vidaUtil } = await t.get(
      `SELECT stock_actual, vida_util_dias FROM productos WHERE id = ? FOR UPDATE`,
      [o.producto_id],
    );
    const nuevo = anterior + cantidadRecibida;
    await t.run(
      `UPDATE productos SET stock_actual = ?, fecha_actualizacion = ? WHERE id = ?`,
      [nuevo, ts, o.producto_id],
    );
    await t.run(
      `INSERT INTO historial_stock
         (producto_id, tipo_movimiento, cantidad_anterior, cantidad_nueva, diferencia, referencia, usuario)
       VALUES (?, 'REPOSICION', ?, ?, ?, ?, ?)`,
      [o.producto_id, anterior, nuevo, cantidadRecibida, ordenId, recibidoPor],
    );
    // SPEC-33 (T33.2/R33.4): el camión trae un lote — se crea con
    // la fecha del remito (body) o el default hoy+vida útil del
    // artículo (NULL en no perecederos). La OC queda linkeada.
    const vencimientoDefault = vidaUtil != null
      ? new Date(Date.parse(ts) + vidaUtil * 86400000).toISOString().slice(0, 10)
      : null;
    await crearLoteEnTx(t, {
      productoId: o.producto_id,
      codigo: ordenId,
      cantidad: cantidadRecibida,
      fechaVencimiento: fechaVencimiento ?? vencimientoDefault,
      origen: 'OC',
      ordenId: o.id,
    });
    return true;
  });
  if (!ok) return null;
  // getOrden va por el pool — leer DESPUÉS del commit, no dentro.
  return getOrden(ordenId);
}
