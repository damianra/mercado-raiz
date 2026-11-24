// SPEC-30 (T30.3): historial_stock reconstruido desde las ventas
// del seed — la cadena de posiciones que quiebreDesde (estadisticas)
// necesita para dias_en_quiebre, fill rate y margen_perdido en TODO
// el catálogo (hoy solo el fixture de 7 filas la tiene).
//
// Modelo: sierra de reabastecimiento real — el producto entra a la
// ventana abastecido a `objetivo` (el `cantidad_anterior` del primer
// movimiento declara la posición pre-ventana); cada venta descuenta
// (puede ir negativo — semántica T30.2); cuando cae a/bajo el
// mínimo y no hay reposición en tránsito, llega una a los `lead`
// días (determinístico por hash del EAN, como seed-ventas) — en su
// propia fecha, haya o no venta ese día (un camión es su propio
// movimiento). Si la demanda agota antes, quedan días de quiebre
// reales. Al final, un AJUSTE CONTEO reconcilia con el stock_actual
// declarado por el seed. Referencia 'SEED-RECONSTRUCCION' marca lo
// sintético.
import { seedData } from './seed-data.js';

// FNV-1a 32-bit — idéntica a seed-ventas/seed-articulos (mismo eje).
function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
const rand = (ean, salt) => hash32(`${ean}:${salt}`) / 0xffffffff;

const DIAS = 90;
const REF = 'SEED-RECONSTRUCCION';

const mov = (p, tipo, anterior, nueva, referencia, fecha, hora, motivo) => ({
  producto_id: p.id,
  tipo_movimiento: tipo,
  cantidad_anterior: anterior,
  cantidad_nueva: nueva,
  diferencia: nueva - anterior,
  referencia,
  usuario: 'sistema',
  fecha: `${typeof fecha === 'string' ? fecha : fecha.toISOString().slice(0, 10)}T${String(hora).padStart(2, '0')}:00:00Z`,
  motivo: motivo ?? null,
});

/**
 * Cadena de movimientos de UN producto. Pura (sin DB) — testeable
 * por separado. `ventas` = filas del producto ordenadas por fecha
 * asc; se clampean a fecha <= hoy (POST /ventas admite fecha
 * futura — rompería el cierre de la cadena en stock_actual).
 */
export function historialDeProducto(p, ventas, hoy = new Date()) {
  const hoyStr = hoy.toISOString().slice(0, 10);
  const serie = ventas.filter((v) => v.fecha <= hoyStr);

  // Sin ventas (~12% del catálogo): la posición es constante — un
  // conteo de la reconstrucción (anterior=nueva: los días previos a
  // la ventana heredan stock_actual, no quiebre fantasma).
  if (!serie.length) {
    const inicio = new Date(hoy);
    inicio.setUTCDate(inicio.getUTCDate() - DIAS);
    return [
      mov(p, 'AJUSTE', p.stock_actual, p.stock_actual, REF, inicio, 7, 'CONTEO'),
    ];
  }

  const semilla = p.ean || p.sku || String(p.id);
  const mediaDiaria = serie.reduce((a, v) => a + v.unidades, 0) / DIAS;
  // Nivel de reposición: el mayor entre 3 mínimos y ~2 semanas de
  // demanda — el "pedir hasta acá" de un super.
  const objetivo = Math.max(p.stock_minimo * 3, Math.ceil(mediaDiaria * 14), 1);
  const lead = 2 + Math.floor(rand(semilla, 'hist:lead') * 5); // 2..6 días
  const trigger = Math.max(p.stock_minimo, 0);

  const movs = [];
  let pos = objetivo;
  let llegada = null; // ymd en que llega la reposición en tránsito

  for (const v of serie) {
    // El camión llega cuando llega — haya venta o no ese día (07:00,
    // antes de la venta de las 20:00). Igualdad estricta contra la
    // fecha de la venta dejaría entregas colgadas en días sin
    // movimiento y bloquearía toda reposición futura.
    if (llegada !== null && llegada <= v.fecha) {
      movs.push(mov(p, 'REPOSICION', pos, objetivo, REF, llegada, 7));
      pos = objetivo;
      llegada = null;
    }
    const nueva = pos - v.unidades;
    // El primer mov de la cadena declara anterior=objetivo: los días
    // pre-ventana (replay con dias>91) heredan "venía abastecido".
    movs.push(mov(p, 'VENTA', pos, nueva, v.referencia ?? REF, v.fecha, 20));
    pos = nueva;
    // Reposición al tocar el mínimo — una en tránsito a la vez
    // (como la supresión ORDEN_PENDIENTE del agente).
    if (pos <= trigger && !llegada) {
      const l = new Date(`${v.fecha}T00:00:00Z`);
      l.setUTCDate(l.getUTCDate() + lead);
      llegada = l.toISOString().slice(0, 10);
    }
  }

  // Reposición que llegó en un tramo final sin ventas (sigue siendo
  // un movimiento — fecha propia). Si llega después de hoy, queda
  // en tránsito: el ajuste reconcilia igual.
  if (llegada !== null && llegada <= hoyStr) {
    movs.push(mov(p, 'REPOSICION', pos, objetivo, REF, llegada, 7));
    pos = objetivo;
  }

  // La cadena simulada termina donde termina; un conteo inicial la
  // reconcilia con el stock_actual declarado por el seed. A las
  // 23:00 ordena después de cualquier VENTA de hoy (20:00).
  if (pos !== p.stock_actual) {
    movs.push(mov(p, 'AJUSTE', pos, p.stock_actual, REF, hoy, 23, 'CONTEO'));
  }
  return movs;
}

/**
 * Si `historial_stock` no tiene filas de reconstrucción, la genera
 * para todo el catálogo desde `ventas` (corre después de seedVentas
 * en el mismo path — solo DB real, no schemas de test). Los
 * productos del fixture seedData.historial_stock se saltean: su
 * cadena hecha a mano convive con las pruebas de estadísticas.
 */
export async function seedHistorial(db) {
  const { c } = await db.get(
    "SELECT COUNT(*)::int AS c FROM historial_stock WHERE referencia = ?",
    [REF],
  );
  if (c > 0) return 0;

  const hoy = new Date(); // un ancla — la misma ventana para todos
  const skip = new Set(seedData.historial_stock.map((m) => m.producto_id));
  const productos = await db.all(
    'SELECT id, sku, ean, stock_actual, stock_minimo FROM productos ORDER BY id',
  );
  const ventaRows = await db.all(
    `SELECT producto_id, fecha::text AS fecha, unidades, referencia
     FROM ventas ORDER BY producto_id, fecha ASC, id ASC`,
  );
  const ventasPor = new Map();
  for (const v of ventaRows) {
    let arr = ventasPor.get(v.producto_id);
    if (!arr) ventasPor.set(v.producto_id, (arr = []));
    arr.push(v);
  }

  const filas = productos
    .filter((p) => !skip.has(p.id))
    .flatMap((p) => historialDeProducto(p, ventasPor.get(p.id) ?? [], hoy));
  if (!filas.length) return 0;

  const COLS = [
    'producto_id',
    'tipo_movimiento',
    'cantidad_anterior',
    'cantidad_nueva',
    'diferencia',
    'referencia',
    'usuario',
    'fecha',
    'motivo',
  ];
  await db.tx(async (t) => {
    for (let i = 0; i < filas.length; i += 400) {
      const lote = filas.slice(i, i + 400);
      const valores = lote.map(() => `(${COLS.map(() => '?').join(', ')})`).join(', ');
      await t.query(
        `INSERT INTO historial_stock (${COLS.join(', ')}) VALUES ${valores}`,
        lote.flatMap((f) => COLS.map((c) => f[c])),
      );
    }
  });
  return filas.length;
}
