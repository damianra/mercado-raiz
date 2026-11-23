import { openDb } from '../db.js';

// SPEC-26 (R26.2): ventas como hechos de negocio — lo consume el
// harness (demanda) y el endpoint de estadísticas. `fecha` es DATE
// (día calendario), `unidades` positivas — distinto de
// historial_stock que modela posiciones con diferencia ±.
export const CANALES_VENTA = ['POS', 'WEB', 'MAYOR'];

const FROM_VENTAS = `FROM ventas v
  JOIN productos p ON p.id = v.producto_id`;

// fecha::text — un DATE no tiene TZ: serializarlo como Date de
// node-pg lo manda como 'YYYY-MM-DDTHH:MM:SS.sssZ' con la hora
// corrida por la TZ del servidor. Como texto queda 'YYYY-MM-DD'.
const SELECT_VENTAS = `SELECT v.id, v.producto_id, v.fecha::text AS fecha, v.unidades,
    v.canal, v.referencia,
    p.sku AS p_sku, p.nombre AS p_nombre
  ${FROM_VENTAS}`;

function mapVenta(row) {
  return {
    id: row.id,
    producto: { id: row.producto_id, sku: row.p_sku, nombre: row.p_nombre },
    fecha: row.fecha,
    unidades: row.unidades,
    canal: row.canal,
    referencia: row.referencia,
  };
}

export async function listVentas({ productoId, canal, desde, hasta, page, limit }) {
  const db = await openDb();
  const where = [];
  const params = [];

  if (productoId !== undefined) {
    where.push('v.producto_id = ?');
    params.push(productoId);
  }
  if (canal) {
    where.push('v.canal = ?');
    params.push(canal);
  }
  // fecha es DATE: comparación por día calendario, sin TZ en juego.
  if (desde) {
    where.push('v.fecha >= ?::date');
    params.push(desde);
  }
  if (hasta) {
    where.push('v.fecha <= ?::date');
    params.push(hasta);
  }

  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';

  const { c: total } = await db.get(`SELECT COUNT(*) AS c ${FROM_VENTAS}${whereSql}`, params);
  const rows = await db.all(
    `${SELECT_VENTAS}${whereSql}
     ORDER BY v.fecha DESC, v.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, (page - 1) * limit],
  );

  return {
    data: rows.map(mapVenta),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}
