import { openDb } from '../db.js';

// Cutoffs calculados en JS — se pasan como params ISO y PG los castea
// a timestamptz al comparar contra la columna.
const isoDaysAgo = (d) => new Date(Date.now() - d * 86_400_000).toISOString();
const isoMonthStart = () => {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01T00:00:00`;
};

export async function getStats() {
  const db = await openDb();
  const count = (sql, ...params) => db.get(sql, params).then((r) => r.c);

  const ordenesPendientes = await count(
    "SELECT COUNT(*) AS c FROM ordenes_compra WHERE estado = 'PENDIENTE_APROBACION'",
  );
  const aprobadasSemana = await count(
    "SELECT COUNT(*) AS c FROM ordenes_compra WHERE estado = 'APROBADA' AND fecha_aprobacion >= ?",
    isoDaysAgo(7),
  );
  const aprobadasSemanaAnterior = await count(
    "SELECT COUNT(*) AS c FROM ordenes_compra WHERE estado = 'APROBADA' AND fecha_aprobacion >= ? AND fecha_aprobacion < ?",
    isoDaysAgo(14),
    isoDaysAgo(7),
  );
  const { v: valorTotalMes } = await db.get(
    "SELECT COALESCE(SUM(monto_total), 0) AS v FROM ordenes_compra WHERE estado = 'APROBADA' AND fecha_aprobacion >= ?",
    [isoMonthStart()],
  );
  const productosStockBajo = await count(
    'SELECT COUNT(*) AS c FROM productos WHERE stock_actual < stock_minimo AND stock_actual > 0',
  );
  const productosCriticos = await count(
    'SELECT COUNT(*) AS c FROM productos WHERE stock_actual = 0',
  );
  const hoy = isoDaysAgo(0).slice(0, 10);
  const ayer = isoDaysAgo(1).slice(0, 10);
  const pendientesHoy = await count(
    // El 'día' es UTC (AT TIME ZONE fija el calendario, igual que
    // cuando las fechas eran TEXT en SQLite) — sin eso date() usa
    // la TZ de sesión del servidor.
    "SELECT COUNT(*) AS c FROM ordenes_compra WHERE estado = 'PENDIENTE_APROBACION' AND date(fecha_creacion AT TIME ZONE 'UTC') = ?",
    hoy,
  );
  const pendientesAyer = await count(
    "SELECT COUNT(*) AS c FROM ordenes_compra WHERE estado = 'PENDIENTE_APROBACION' AND date(fecha_creacion AT TIME ZONE 'UTC') = ?",
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
