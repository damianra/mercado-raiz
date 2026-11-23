import { openDb } from '../db.js';

// Estado derivado del stock — la columna `estado` puede quedar vieja
// tras ventas/ajustes, así que siempre se recalcula al leer.
export const ESTADO_PRODUCTO_EXPR = `CASE
  WHEN p.stock_actual = 0 THEN 'CRITICO'
  WHEN p.stock_actual < p.stock_minimo THEN 'STOCK_BAJO'
  ELSE 'OK' END`;

export function estadoProducto(stockActual, stockMinimo) {
  if (stockActual === 0) return 'CRITICO';
  if (stockActual < stockMinimo) return 'STOCK_BAJO';
  return 'OK';
}

export const ESTADOS_PRODUCTO = ['OK', 'STOCK_BAJO', 'CRITICO'];

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
    precio_unitario: row.precio_unitario,
    proveedor: { id: row.pr_id, nombre: row.pr_nombre },
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

  const fromWhere = `FROM productos p JOIN proveedores pr ON pr.id = p.proveedor_id${
    where.length ? ` WHERE ${where.join(' AND ')}` : ''
  }`;

  const { c: total } = await db.get(`SELECT COUNT(*) AS c ${fromWhere}`, params);
  const rows = await db.all(
    `SELECT p.id, p.sku, p.nombre, p.marca, p.ean, p.categoria, p.stock_actual, p.stock_minimo,
            p.precio_unitario, p.ubicacion, p.fecha_actualizacion,
            pr.id AS pr_id, pr.nombre AS pr_nombre
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
