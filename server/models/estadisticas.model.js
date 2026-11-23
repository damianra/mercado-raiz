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
function calcularStats({ productoId, dias, fechas, serie, movs, ultima, economia }) {
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
    // SPEC-27 (T27.2): economía del producto — margen unitario y
    // margen perdido por quiebres en la ventana (unidades que no se
    // vendieron × margen). null honesto si no hay precio de costo
    // o si dias_en_quiebre no es confiable — nunca inventado.
    costo_unitario: economia?.costo ?? null,
    margen_unitario:
      economia?.costo != null && economia?.venta != null
        ? Number((economia.venta - economia.costo).toFixed(2))
        : null,
    margen_perdido:
      economia?.costo != null && economia?.venta != null && quiebre.dias != null
        ? Number(
            ((economia.venta - economia.costo) * demanda_diaria * quiebre.dias).toFixed(2),
          )
        : null,
  };
}

export async function estadisticaDemanda(productoId, dias) {
  const db = await openDb();

  const prod = await db.get(
    `SELECT p.id, p.precio_venta, pp.costo_unitario AS costo FROM productos p
     LEFT JOIN producto_proveedor pp
       ON pp.producto_id = p.id AND pp.proveedor_id = p.proveedor_id AND pp.activo = 1
     WHERE p.id = ?`,
    [productoId],
  );
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
  return calcularStats({ productoId, dias, fechas, serie, movs, ultima,
    economia: { venta: prod.precio_venta, costo: prod.costo } });
}

// R26.9/T26.7 — las mismas estadísticas para TODOS los productos
// en una pasada (dashboard: columnas demanda/cobertura por orden).
// Cuatro queries totales en vez de 3×N: ventas y movimientos
// agrupados en SQL y el replay/cálculo en JS por producto — el
// mismo `calcularStats` que la ruta individual, así no divergen.
export async function estadisticasDemandaBulk(dias) {
  const db = await openDb();
  const { hoy } = await db.get('SELECT CURRENT_DATE::text AS hoy');
  const productos = await db.all(
    `SELECT p.id, p.precio_venta, pp.costo_unitario AS costo FROM productos p
     LEFT JOIN producto_proveedor pp
       ON pp.producto_id = p.id AND pp.proveedor_id = p.proveedor_id AND pp.activo = 1
     ORDER BY p.id`,
  );

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
      economia: { venta: p.precio_venta, costo: p.costo },
    });
  });
}

// SPEC-28 (R28.1): scorecard agregado — las preguntas operativas del
// dueño respondidas en una pasada. Reutiliza `estadisticasDemandaBulk`
// como única fuente de stats por producto (misma math que agente y
// dashboard); el resto es agregación sobre stock/costo/lead y
// agregados SQL de órdenes/proveedores. null honesto donde falta
// el dato — nunca inventado.
const EXCESO_COBERTURA_DIAS = 60;
const r2 = (n) => (n == null ? null : Number(n.toFixed(2)));

export async function metricasScorecard(dias) {
  const db = await openDb();
  const [{ hoy }, stats] = await Promise.all([
    db.get('SELECT CURRENT_DATE::text AS hoy'),
    estadisticasDemandaBulk(dias),
  ]);
  const statsPor = new Map(stats.map((s) => [s.producto_id, s]));
  // Corte de "sin venta en la ventana" para dead stock: ISO date
  // compara lexicográfico igual que cronológico.
  const corte = new Date(Date.parse(`${hoy}T00:00:00Z`) - dias * 86400000)
    .toISOString()
    .slice(0, 10);

  const productos = await db.all(
    `SELECT p.id, p.stock_actual, p.stock_minimo, p.precio_venta,
            pp.costo_unitario AS costo,
            COALESCE((pr.tiempo_entrega_min_dias + pr.tiempo_entrega_max_dias) / 2.0,
                     pr.tiempo_entrega_dias)::double precision AS lead_esperado
     FROM productos p
     JOIN proveedores pr ON pr.id = p.proveedor_id
     LEFT JOIN producto_proveedor pp
       ON pp.producto_id = p.id AND pp.proveedor_id = p.proveedor_id AND pp.activo = 1`,
  );

  const q = { skus_sin_stock: 0, skus_bajo_minimo: 0, venta: 0, margen: 0, hayMargen: false, perdido: 0, hayPerdido: false };
  const riesgo = { quiebre_seguro: 0, riesgo_alto: 0, riesgo_medio: 0, cubierto: 0, sin_demanda: 0 };
  const inv = { valorCosto: 0, hayCosto: false, valorVenta: 0, deadSkus: 0, deadValor: 0, excesoSkus: 0, excesoValor: 0 };
  let quiebreDias = 0;
  let skusHistorial = 0;

  for (const p of productos) {
    const s = statsPor.get(p.id) ?? {};
    const demanda = s.demanda_diaria ?? 0;
    const margen = s.margen_unitario;

    // Quiebres: venta y margen que se dejan de facturar por día.
    if (p.stock_actual === 0) {
      q.skus_sin_stock++;
      q.venta += demanda * p.precio_venta;
      if (margen != null) {
        q.margen += demanda * margen;
        q.hayMargen = true;
      }
    } else if (p.stock_actual < p.stock_minimo) {
      q.skus_bajo_minimo++;
    }
    if (s.margen_perdido != null) {
      q.perdido += s.margen_perdido;
      q.hayPerdido = true;
    }

    // Riesgo: cobertura vs lead esperado del proveedor principal.
    // stock 0 + demanda → quiebre seguro (ya está en la góndola vacía).
    if (demanda <= 0) {
      riesgo.sin_demanda++;
    } else {
      const cob = p.stock_actual / demanda;
      const lead = p.lead_esperado ?? 0;
      if (p.stock_actual === 0 || cob < lead) riesgo.quiebre_seguro++;
      else if (cob < lead * 1.5) riesgo.riesgo_alto++;
      else if (cob < lead * 2) riesgo.riesgo_medio++;
      else riesgo.cubierto++;
      if (cob > EXCESO_COBERTURA_DIAS) {
        inv.excesoSkus++;
        if (p.costo != null) inv.excesoValor += p.stock_actual * p.costo;
      }
    }

    // Inventario a costo (con null-tracking: si algún producto no
    // tiene costo, el total sería subestimado — se reporta igual
    // pero el front puede matizar).
    inv.valorVenta += p.stock_actual * p.precio_venta;
    if (p.costo != null) {
      inv.valorCosto += p.stock_actual * p.costo;
      inv.hayCosto = true;
    }

    // Dead stock: hay unidades y no vendió en toda la ventana.
    if (p.stock_actual > 0 && (s.ultima_venta == null || s.ultima_venta <= corte)) {
      inv.deadSkus++;
      if (p.costo != null) inv.deadValor += p.stock_actual * p.costo;
    }

    // Fill rate: % de SKU-días con stock sobre los confiables.
    if (s.dias_en_quiebre != null) {
      skusHistorial++;
      quiebreDias += s.dias_en_quiebre;
    }
  }

  const { c: pendientes, m: pendientesMonto } = await db.get(
    `SELECT COUNT(*)::int AS c, COALESCE(SUM(monto_total), 0) AS m
     FROM ordenes_compra WHERE estado = 'PENDIENTE_APROBACION'`,
  );

  const proveedores = await db.all(
    `SELECT pr.id, pr.nombre, pr.activo,
            COALESCE((pr.tiempo_entrega_min_dias + pr.tiempo_entrega_max_dias) / 2.0,
                     pr.tiempo_entrega_dias)::double precision AS lead_dias_esperado,
            pr.confiabilidad_pct,
            (SELECT COUNT(*)::int FROM productos p WHERE p.proveedor_id = pr.id) AS skus,
            (SELECT COUNT(*)::int FROM ordenes_compra o WHERE o.proveedor_id = pr.id) AS ordenes,
            (SELECT COALESCE(SUM(o.monto_total), 0) FROM ordenes_compra o
              WHERE o.proveedor_id = pr.id) AS monto,
            (SELECT COUNT(*)::int FROM ordenes_compra o
              WHERE o.proveedor_id = pr.id AND o.estado = 'PENDIENTE_APROBACION') AS pendientes,
            (SELECT COALESCE(SUM(o.monto_total), 0) FROM ordenes_compra o
              WHERE o.proveedor_id = pr.id AND o.estado = 'PENDIENTE_APROBACION') AS monto_pendiente
     FROM proveedores pr ORDER BY monto DESC, pr.id`,
  );
  for (const pr of proveedores) {
    pr.monto = r2(pr.monto);
    pr.monto_pendiente = r2(pr.monto_pendiente);
  }

  return {
    dias,
    quiebres: {
      skus_sin_stock: q.skus_sin_stock,
      skus_bajo_minimo: q.skus_bajo_minimo,
      venta_riesgo_dia: r2(q.venta),
      margen_riesgo_dia: q.hayMargen ? r2(q.margen) : null,
      margen_perdido_ventana: q.hayPerdido ? r2(q.perdido) : null,
    },
    riesgo,
    inventario: {
      valor_costo: inv.hayCosto ? r2(inv.valorCosto) : null,
      valor_venta: r2(inv.valorVenta),
      dead_stock_skus: inv.deadSkus,
      dead_stock_valor_costo: r2(inv.deadValor),
      exceso_skus: inv.excesoSkus,
      exceso_valor_costo: r2(inv.excesoValor),
      exceso_cobertura_dias: EXCESO_COBERTURA_DIAS,
    },
    servicio: {
      fill_rate_pct:
        skusHistorial > 0
          ? Number((100 * (1 - quiebreDias / (skusHistorial * dias))).toFixed(1))
          : null,
      skus_con_historial: skusHistorial,
    },
    ordenes: { pendientes, pendientes_monto: r2(pendientesMonto) },
    proveedores,
  };
}
