import { openDb } from '../db.js';

// Cutoffs calculados en JS con el mismo formato 'YYYY-MM-DDTHH:MM:SS'
// que usan las filas — comparar contra datetime('now') de SQLite (con
// espacio) daría bordes de día incorrectos por orden lexicográfico.
const isoNow = () => new Date().toISOString().slice(0, 19);
const isoDaysAgo = (d) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 19);
const isoMonthStart = () => {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01T00:00:00`;
};

const count = (db, sql, ...params) => db.prepare(sql).get(...params).c;

export function getStats() {
  const db = openDb();

  const ordenesPendientes = count(
    db,
    "SELECT COUNT(*) AS c FROM ordenes_compra WHERE estado = 'PENDIENTE_APROBACION'",
  );
  const aprobadasSemana = count(
    db,
    "SELECT COUNT(*) AS c FROM ordenes_compra WHERE estado = 'APROBADA' AND fecha_aprobacion >= ?",
    isoDaysAgo(7),
  );
  const aprobadasSemanaAnterior = count(
    db,
    "SELECT COUNT(*) AS c FROM ordenes_compra WHERE estado = 'APROBADA' AND fecha_aprobacion >= ? AND fecha_aprobacion < ?",
    isoDaysAgo(14),
    isoDaysAgo(7),
  );
  const { v: valorTotalMes } = db
    .prepare(
      "SELECT COALESCE(SUM(monto_total), 0) AS v FROM ordenes_compra WHERE estado = 'APROBADA' AND fecha_aprobacion >= ?",
    )
    .get(isoMonthStart());
  const productosStockBajo = count(
    db,
    'SELECT COUNT(*) AS c FROM productos WHERE stock_actual < stock_minimo AND stock_actual > 0',
  );
  const productosCriticos = count(
    db,
    'SELECT COUNT(*) AS c FROM productos WHERE stock_actual = 0',
  );
  const hoy = isoNow().slice(0, 10);
  const ayer = isoDaysAgo(1).slice(0, 10);
  const pendientesHoy = count(
    db,
    "SELECT COUNT(*) AS c FROM ordenes_compra WHERE estado = 'PENDIENTE_APROBACION' AND date(fecha_creacion) = ?",
    hoy,
  );
  const pendientesAyer = count(
    db,
    "SELECT COUNT(*) AS c FROM ordenes_compra WHERE estado = 'PENDIENTE_APROBACION' AND date(fecha_creacion) = ?",
    ayer,
  );

  return {
    ordenes_pendientes: ordenesPendientes,
    ordenes_aprobadas_semana: aprobadasSemana,
    valor_total_mes: Math.round(valorTotalMes * 100) / 100,
    productos_stock_bajo: productosStockBajo,
    productos_criticos: productosCriticos,
    tendencia: {
      ordenes_pendientes_vs_ayer: pendientesHoy - pendientesAyer,
      ordenes_aprobadas_vs_semana_anterior: aprobadasSemana - aprobadasSemanaAnterior,
    },
  };
}
