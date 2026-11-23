import { openDb } from '../db.js';

// SPEC-26 (R26.7): estadísticas de demanda por producto sobre la
// tabla `ventas`. La serie diaria se arma contra CURRENT_DATE de la
// DB (no el reloj del host) para que TZ del proceso no mueva la
// ventana. Los días en quiebre (stock 0) salen de la cadena de
// posiciones de historial_stock y NO cuentan como demanda 0 — si el
// producto no tiene movimientos, la fuente no es confiable y
// `dias_en_quiebre` responde null (R26.7, nunca inventado).
const HALF_LIFE_DIAS = 30; // media móvil ponderada por recencia

// Serie completa de la ventana: [d0 más viejo … hoy]. El ancla es
// `hoy` de la DB — Date UTC para no mezclar TZ.
function armarVentana(hoy, dias, porDia) {
  const hoyMs = Date.parse(`${hoy}T00:00:00Z`);
  const fechas = [];
  const serie = [];
  for (let i = dias - 1; i >= 0; i--) {
    const f = new Date(hoyMs - i * 86400000).toISOString().slice(0, 10);
    fechas.push(f);
    serie.push(porDia.get(f) ?? 0);
  }
  return { fechas, serie };
}

// Reconstruye la posición de stock día a día desde la cadena de
// movimientos (cantidad_anterior→cantidad_nueva, ya ordenados por
// fecha/id). Días antes del primer movimiento heredan su
// cantidad_anterior — aproximación documentada; sin movimientos la
// fuente no existe → dias: null.
function quiebreDesde(movs, fechas) {
  if (movs.length === 0) return { dias: null, indices: new Set() };

  // posición vigente al inicio de cada fecha de la ventana: el
  // cantidad_nueva del último movimiento ≤ ese día (o el
  // cantidad_anterior del primero si aún no hubo ninguno).
  let cursor = 0;
  let posicion = movs[0].cantidad_anterior;
  let dias = 0;
  const indices = new Set();

  for (let i = 0; i < fechas.length; i++) {
    while (cursor < movs.length && movs[cursor].f <= fechas[i]) {
      posicion = movs[cursor].cantidad_nueva;
      cursor++;
    }
    if (posicion === 0) {
      dias++;
      indices.add(i);
    }
  }
  return { dias, indices };
}

// El cálculo puro, compartido por la ruta individual y la bulk:
// misma serie + mismos quiebres → mismas stats (una fuente de
// verdad para agente y dashboard, R26.9).
function calcularStats({ productoId, dias, fechas, serie, movs, ultima }) {
  const quiebre = quiebreDesde(movs, fechas);

  // Días elegibles para los denominadores: todo menos quiebres.
  const elegibles = serie.filter((_, i) => !quiebre.indices.has(i));
  const n = elegibles.length;

  // demanda_diaria: media ponderada exponencial (half-life 30d —
  // las últimas semanas pesan más que el arranque de la ventana).
  let wSum = 0;
  let dSum = 0;
  for (let i = 0; i < serie.length; i++) {
    if (quiebre.indices.has(i)) continue;
    const edad = serie.length - 1 - i; // días atrás
    const w = 0.5 ** (edad / HALF_LIFE_DIAS);
    wSum += w;
    dSum += w * serie[i];
  }
  const demanda_diaria = wSum > 0 ? dSum / wSum : 0;

  // cv y tendencia sobre la serie elegible (días sin quiebre).
  const media = n > 0 ? elegibles.reduce((a, b) => a + b, 0) / n : 0;
  const desvio =
    n > 0 ? Math.sqrt(elegibles.reduce((s, v) => s + (v - media) ** 2, 0) / n) : 0;
  const cv = media > 0 ? desvio / media : null;

  // Pendiente OLS sobre el índice de día REAL de la ventana (no el
  // comprimido): con quiebres, el tiempo entre días elegibles se
  // conserva y la pendiente no se infla.
  let tendencia = 0;
  if (n > 1) {
    const xs = [];
    const ys = [];
    for (let i = 0; i < serie.length; i++) {
      if (quiebre.indices.has(i)) continue;
      xs.push(i);
      ys.push(serie[i]);
    }
    const xMean = xs.reduce((a, b) => a + b, 0) / n;
    const num = xs.reduce((s, x, i) => s + (x - xMean) * (ys[i] - media), 0);
    const den = xs.reduce((s, x) => s + (x - xMean) ** 2, 0);
    tendencia = den > 0 ? num / den : 0;
  }

  const diasConVenta = serie.reduce((a, v) => a + (v > 0 ? 1 : 0), 0);
  return {
    producto_id: productoId,
    dias,
    demanda_diaria: Number(demanda_diaria.toFixed(4)),
    tendencia: Number(tendencia.toFixed(4)),
    cv: cv == null ? null : Number(cv.toFixed(4)),
    // σ de la demanda diaria sobre días elegibles — el stock de
    // seguridad del agente lo usa en z·σ·√lead (R26.8).
    desvio_demanda: Number(desvio.toFixed(4)),
    dias_con_venta: diasConVenta,
    dias_en_quiebre: quiebre.dias,
    // MAX global (no acotado a la ventana): distingue venta
    // reciente de producto dormido.
    ultima_venta: ultima,
  };
}

export async function estadisticaDemanda(productoId, dias) {
  const db = await openDb();

  const prod = await db.get('SELECT id FROM productos WHERE id = ?', [productoId]);
  if (!prod) return { status: 404, error: 'producto no encontrado' };

  const { hoy } = await db.get('SELECT CURRENT_DATE::text AS hoy');
  const ventas = await db.all(
    `SELECT fecha::text AS fecha, SUM(unidades)::int AS unidades
     FROM ventas
     WHERE producto_id = ? AND fecha > CURRENT_DATE - ?::int AND fecha <= CURRENT_DATE
     GROUP BY fecha ORDER BY fecha`,
    [productoId, dias],
  );
  const porDia = new Map(ventas.map((v) => [v.fecha, v.unidades]));
  const { fechas, serie } = armarVentana(hoy, dias, porDia);

  const movs = await db.all(
    `SELECT (fecha AT TIME ZONE 'UTC')::date::text AS f, cantidad_anterior, cantidad_nueva
     FROM historial_stock WHERE producto_id = ?
     ORDER BY fecha ASC, id ASC`,
    [productoId],
  );
  const { ultima } = await db.get(
    'SELECT MAX(fecha)::text AS ultima FROM ventas WHERE producto_id = ?',
    [productoId],
  );
  return calcularStats({ productoId, dias, fechas, serie, movs, ultima });
}

// R26.9/T26.7 — las mismas estadísticas para TODOS los productos
// en una pasada (dashboard: columnas demanda/cobertura por orden).
// Cuatro queries totales en vez de 3×N: ventas y movimientos
// agrupados en SQL y el replay/cálculo en JS por producto — el
// mismo `calcularStats` que la ruta individual, así no divergen.
export async function estadisticasDemandaBulk(dias) {
  const db = await openDb();
  const { hoy } = await db.get('SELECT CURRENT_DATE::text AS hoy');
  const productos = await db.all('SELECT id FROM productos ORDER BY id');

  const ventas = await db.all(
    `SELECT producto_id, fecha::text AS fecha, SUM(unidades)::int AS unidades
     FROM ventas
     WHERE fecha > CURRENT_DATE - ?::int AND fecha <= CURRENT_DATE
     GROUP BY producto_id, fecha`,
    [dias],
  );
  const ventasPor = new Map();
  for (const v of ventas) {
    let m = ventasPor.get(v.producto_id);
    if (!m) ventasPor.set(v.producto_id, (m = new Map()));
    m.set(v.fecha, v.unidades);
  }

  const ultimas = new Map(
    (await db.all('SELECT producto_id, MAX(fecha)::text AS ultima FROM ventas GROUP BY producto_id'))
      .map((r) => [r.producto_id, r.ultima]),
  );

  const movsPor = new Map();
  const movRows = await db.all(
    `SELECT producto_id, (fecha AT TIME ZONE 'UTC')::date::text AS f,
            cantidad_anterior, cantidad_nueva
     FROM historial_stock ORDER BY producto_id, fecha ASC, id ASC`,
  );
  for (const m of movRows) {
    let arr = movsPor.get(m.producto_id);
    if (!arr) movsPor.set(m.producto_id, (arr = []));
    arr.push(m);
  }

  return productos.map((p) => {
    const porDia = ventasPor.get(p.id) ?? new Map();
    const { fechas, serie } = armarVentana(hoy, dias, porDia);
    return calcularStats({
      productoId: p.id,
      dias,
      fechas,
      serie,
      movs: movsPor.get(p.id) ?? [],
      ultima: ultimas.get(p.id) ?? null,
    });
  });
}
