import { openDb } from '../db.js';

// Estado derivado del stock — la columna `estado` puede quedar vieja
// tras ventas/ajustes, así que siempre se recalcula al leer.
export const ESTADO_PRODUCTO_EXPR = `CASE
  WHEN p.stock_actual <= 0 THEN 'CRITICO'
  WHEN p.stock_actual < p.stock_minimo THEN 'STOCK_BAJO'
  ELSE 'OK' END`;

export function estadoProducto(stockActual, stockMinimo) {
  if (stockActual <= 0) return 'CRITICO';
  if (stockActual < stockMinimo) return 'STOCK_BAJO';
  return 'OK';
}

export const ESTADOS_PRODUCTO = ['OK', 'STOCK_BAJO', 'CRITICO'];

// R26.4: lead esperado = (min+max)/2 cuando hay rango, si no el lead
// nominal. Compartido por los mappers de productos y ordenes — es la
// convención que consumirá el agente en T26.6.
export function leadEsperado(row) {
  return row.pr_min != null && row.pr_max != null
    ? (row.pr_min + row.pr_max) / 2
    : row.pr_tiempo_entrega_dias;
}

function mapProducto(row) {
  return {
    id: row.id,
    sku: row.sku,
    nombre: row.nombre,
    marca: row.marca,
    ean: row.ean,
    categoria: row.categoria,
    stock_actual: row.stock_actual,
    stock_minimo: row.stock_minimo,
    precio_venta: row.precio_venta,
    costo_unitario: row.pp_costo ?? null,
    margen_pct:
      row.pp_costo != null && row.precio_venta > 0
        ? Math.round(((row.precio_venta - row.pp_costo) / row.precio_venta) * 1000) / 10
        : null,
    proveedor: {
      id: row.pr_id,
      nombre: row.pr_nombre,
      tiempo_entrega_dias: row.pr_tiempo_entrega_dias,
      tiempo_entrega_min_dias: row.pr_min,
      tiempo_entrega_max_dias: row.pr_max,
      lead_dias_esperado: leadEsperado(row),
    },
    precios: row.precios ?? [],
    ubicacion: row.ubicacion,
    estado: estadoProducto(row.stock_actual, row.stock_minimo),
    fecha_actualizacion: row.fecha_actualizacion,
  };
}

export async function listProductos({ estado, categoria, proveedorId, search, page, limit }) {
  const db = await openDb();
  const where = [];
  const params = [];

  if (estado) {
    where.push(`${ESTADO_PRODUCTO_EXPR} = ?`);
    params.push(estado);
  }
  if (categoria) {
    where.push('p.categoria = ?');
    params.push(categoria);
  }
  if (proveedorId !== undefined) {
    where.push('p.proveedor_id = ?');
    params.push(proveedorId);
  }
  if (search) {
    // ILIKE: el LIKE de SQLite era case-insensitive (ASCII) — PG es
    // case-sensitive, ILIKE conserva el comportamiento del search.
    where.push('(p.nombre ILIKE ? OR p.sku ILIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }

  const fromWhere = `FROM productos p
    JOIN proveedores pr ON pr.id = p.proveedor_id
    LEFT JOIN producto_proveedor pp
      ON pp.producto_id = p.id AND pp.proveedor_id = p.proveedor_id AND pp.activo = 1${
    where.length ? ` WHERE ${where.join(' AND ')}` : ''
  }`;

  const { c: total } = await db.get(`SELECT COUNT(*) AS c ${fromWhere}`, params);
  const rows = await db.all(
    `SELECT p.id, p.sku, p.nombre, p.marca, p.ean, p.categoria, p.stock_actual, p.stock_minimo,
            p.precio_venta, p.ubicacion, p.fecha_actualizacion,
            pp.costo_unitario AS pp_costo,
            (SELECT json_agg(json_build_object(
               'proveedor_id', pp2.proveedor_id, 'proveedor', pr2.nombre,
               'costo_unitario', pp2.costo_unitario,
               'lead_efectivo', COALESCE(pp2.lead_dias,
                 (pr2.tiempo_entrega_min_dias + pr2.tiempo_entrega_max_dias) / 2.0,
                 pr2.tiempo_entrega_dias)::double precision,
               'es_principal', pp2.es_principal) ORDER BY pp2.costo_unitario)
             FROM producto_proveedor pp2
             JOIN proveedores pr2 ON pr2.id = pp2.proveedor_id
             WHERE pp2.producto_id = p.id AND pp2.activo = 1 AND pr2.activo = 1) AS precios,
            pr.id AS pr_id, pr.nombre AS pr_nombre,
            pr.tiempo_entrega_dias AS pr_tiempo_entrega_dias,
            pr.tiempo_entrega_min_dias AS pr_min, pr.tiempo_entrega_max_dias AS pr_max
     ${fromWhere}
     ORDER BY p.nombre ASC
     LIMIT ? OFFSET ?`,
    [...params, limit, (page - 1) * limit],
  );

  return {
    data: rows.map(mapProducto),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

/**
 * SPEC-27 (T27.2): detalle de un producto con TODOS sus precios por
 * proveedor (producto_proveedor + datos del proveedor). `lead_dias`
 * es el override por par; null → usa el del proveedor.
 * Devuelve null si el producto no existe.
 */
export async function getProducto(id) {
  const db = await openDb();
  const row = await db.get(
    `SELECT p.id, p.sku, p.nombre, p.marca, p.ean, p.categoria, p.stock_actual, p.stock_minimo,
            p.precio_venta, p.ubicacion, p.fecha_actualizacion,
            pp.costo_unitario AS pp_costo,
            (SELECT json_agg(json_build_object(
               'proveedor_id', pp2.proveedor_id, 'proveedor', pr2.nombre,
               'costo_unitario', pp2.costo_unitario,
               'lead_efectivo', COALESCE(pp2.lead_dias,
                 (pr2.tiempo_entrega_min_dias + pr2.tiempo_entrega_max_dias) / 2.0,
                 pr2.tiempo_entrega_dias)::double precision,
               'es_principal', pp2.es_principal) ORDER BY pp2.costo_unitario)
             FROM producto_proveedor pp2
             JOIN proveedores pr2 ON pr2.id = pp2.proveedor_id
             WHERE pp2.producto_id = p.id AND pp2.activo = 1 AND pr2.activo = 1) AS precios,
            pr.id AS pr_id, pr.nombre AS pr_nombre,
            pr.tiempo_entrega_dias AS pr_tiempo_entrega_dias,
            pr.tiempo_entrega_min_dias AS pr_min, pr.tiempo_entrega_max_dias AS pr_max
     FROM productos p
     JOIN proveedores pr ON pr.id = p.proveedor_id
     LEFT JOIN producto_proveedor pp
       ON pp.producto_id = p.id AND pp.proveedor_id = p.proveedor_id AND pp.activo = 1
     WHERE p.id = ?`,
    [id],
  );
  if (!row) return null;
  const precios = await db.all(
    `SELECT pp.proveedor_id, pr.nombre AS proveedor, pp.costo_unitario,
            pp.lead_dias,
            COALESCE(pp.lead_dias, (pr.tiempo_entrega_min_dias + pr.tiempo_entrega_max_dias) / 2.0,
                     pr.tiempo_entrega_dias)::double precision AS lead_efectivo,
            pp.es_principal, pp.activo
     FROM producto_proveedor pp
     JOIN proveedores pr ON pr.id = pp.proveedor_id
     WHERE pp.producto_id = ?
     ORDER BY pp.es_principal DESC, pp.costo_unitario ASC, pp.id`,
    [id],
  );
  return { ...mapProducto(row), precios };
}
