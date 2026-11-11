import { openDb } from '../db.js';

// Modelo del historial de movimientos de stock. Lo consume el agente
// (harness-langgraph) para analizar demanda con ventas reales: sin
// esta ruta el LLM solo vería stock actual, sin historia.
export const TIPOS_MOVIMIENTO = ['VENTA', 'REPOSICION', 'AJUSTE', 'DEVOLUCION'];

const FROM_HISTORIAL = `FROM historial_stock h
  JOIN productos p ON p.id = h.producto_id`;

const SELECT_HISTORIAL = `SELECT h.id, h.producto_id, h.tipo_movimiento,
    h.cantidad_anterior, h.cantidad_nueva, h.diferencia,
    h.referencia, h.usuario, h.fecha,
    p.sku AS p_sku, p.nombre AS p_nombre
  ${FROM_HISTORIAL}`;

function mapMovimiento(row) {
  return {
    id: row.id,
    producto: { id: row.producto_id, sku: row.p_sku, nombre: row.p_nombre },
    tipo_movimiento: row.tipo_movimiento,
    cantidad_anterior: row.cantidad_anterior,
    cantidad_nueva: row.cantidad_nueva,
    diferencia: row.diferencia,
    referencia: row.referencia,
    usuario: row.usuario,
    fecha: row.fecha,
  };
}

export function listHistorial({ productoId, tipo, desde, hasta, page, limit }) {
  const db = openDb();
  const where = [];
  const params = [];

  if (productoId !== undefined) {
    where.push('h.producto_id = ?');
    params.push(productoId);
  }
  if (tipo) {
    where.push('h.tipo_movimiento = ?');
    params.push(tipo);
  }
  if (desde) {
    where.push('h.fecha >= ?');
    params.push(desde);
  }
  if (hasta) {
    where.push('h.fecha <= ?');
    params.push(hasta);
  }

  const fromWhere = `${FROM_HISTORIAL}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`;

  const { c: total } = db.prepare(`SELECT COUNT(*) AS c ${fromWhere}`).get(...params);
  const rows = db
    .prepare(`${SELECT_HISTORIAL}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}
       ORDER BY h.fecha DESC
       LIMIT ? OFFSET ?`)
    .all(...params, limit, (page - 1) * limit);

  return {
    data: rows.map(mapMovimiento),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}
