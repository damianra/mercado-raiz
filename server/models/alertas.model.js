import { openDb } from '../db.js';
import { estadisticasDemandaBulk } from './estadisticas.model.js';
import { competenciaBulk } from './competencia.model.js';
import { diasAlertaVencimiento } from '../seed-lotes.js';

// SPEC-29 (R29.3): motor de reglas determinísticas — sin LLM.
// Misma fuente de stats que agente/dashboard/métricas
// (estadisticasDemandaBulk): cero divergencia. La evaluación es
// lazy: GET /api/alertas la dispara si pasaron >60min (sin cron).
const DIAS_VENTANA = 90;
const EVAL_THROTTLE_MIN = 60;
const ORDEN_HORAS_UMBRAL = 48;
const DEDUP_HORAS = 24;

// SPEC-32 (T32.4): umbrales de las reglas de pricing y del
// DEAD_STOCK ponderado. Los de capital se midieron contra la base
// dev (distribución real de capital inmovilizado de los muertos:
// p50 ~$70k, p80 ~$159k, p90 ~$273k, p95 ~$380k, max ~$648k) —
// ALTA > $350k queda en ~top 6% de los muertos, MEDIA > $150k en
// ~p80. Documentados en SPEC.md (R32.5).
const CAPITAL_DEAD_ALTA = 350_000;
const CAPITAL_DEAD_MEDIA = 150_000;
// Promo de cadena "agresiva": más de 15% bajo el precio de lista.
const PROMO_ALTA_DESCUENTO = 0.15;
// Oportunidad de margen: precio propio < 85% del mínimo de mercado.
const FACTOR_OPORTUNIDAD = 0.85;

const money = (n) =>
  `$${Number(n).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`;

// Genera las alertas-candidata del momento. Función pura para
// testear las reglas sin tocar la tabla. `lotes` trae las filas con
// cantidad > 0 y vencimiento ≤ hoy+15d (la ventana máxima posible —
// cada producto aplica la suya, relativa a su vida útil).
export function candidatas({ productos, stats, ordenes, corte, competencia, lotes }) {
  const statsPor = new Map(stats.map((s) => [s.producto_id, s]));
  const compPor = competencia ?? new Map();
  const out = [];

  // SPEC-33 (T33.3): agrupación por producto — la alerta actúa
  // sobre el SKU, no sobre la fila de lote (R33.6).
  const lotesPor = new Map();
  for (const l of lotes ?? []) {
    const g = lotesPor.get(l.producto_id);
    if (g) g.push(l);
    else lotesPor.set(l.producto_id, [l]);
  }

  // "Top seller" para PRESION_COMPETITIVA (T32.4): demanda_diaria
  // ≥ p80 de los productos con rotación real — criterio simple: el
  // quintil superior del catálogo que se mueve. Un SKU sin demanda
  // nunca entra aunque la cadena lo tenga en promo.
  const demandas = stats
    .map((s) => s.demanda_diaria ?? 0)
    .filter((d) => d > 0)
    .sort((a, b) => a - b);
  const pisoTop = demandas.length
    ? demandas[Math.floor(demandas.length * 0.8)]
    : Infinity;

  for (const p of productos) {
    const s = statsPor.get(p.id) ?? {};
    const demanda = s.demanda_diaria ?? 0;
    const comp = compPor.get(p.id);
    const etiqueta = `${p.nombre} (${p.sku})`;

    // T33.3 — VENCIMIENTO: el lote vence igual aunque el contador
    // haya divergido por sobreventa, así que se evalúa antes del
    // `continue` de stock≤0. Severidad por el lote más próximo:
    // ALTA ≤3d (o ya vencido), MEDIA ≤7d, BAJA hasta la ventana del
    // producto (min(15, 40%·vida) — NULL cae a 15d como PROXIMO en
    // listarLotes: fecha cargada a mano en un seco).
    const ventanaVto =
      p.vida_util_dias != null ? diasAlertaVencimiento(p.vida_util_dias) : 15;
    const enVentana = (lotesPor.get(p.id) ?? []).filter((l) => l.dias <= ventanaVto);
    if (enVentana.length) {
      const minDias = Math.min(...enVentana.map((l) => l.dias));
      const vencidas = enVentana
        .filter((l) => l.dias < 0)
        .reduce((a, l) => a + l.cantidad, 0);
      const porVencer = enVentana
        .filter((l) => l.dias >= 0)
        .reduce((a, l) => a + l.cantidad, 0);
      const severidad = minDias <= 3 ? 'ALTA' : minDias <= 7 ? 'MEDIA' : 'BAJA';
      const detalle = [
        vencidas > 0 && `${vencidas}u vencidas`,
        porVencer > 0 && `${porVencer}u por vencer (más próximo en ${Math.max(0, minDias)}d)`,
      ]
        .filter(Boolean)
        .join(' — ');
      const capTxt =
        comp?.costo != null
          ? ` (~${money((vencidas + porVencer) * comp.costo)} en riesgo)`
          : '';
      out.push({
        tipo: 'VENCIMIENTO',
        severidad,
        producto_id: p.id,
        mensaje: `${etiqueta}: ${detalle}${capTxt}`,
      });
    }

    if (p.stock_actual <= 0) {
      // En cero (o negativo por un ajuste mal cargado) solo alerta
      // si hay demanda real que se pierde; un dormido sin stock no
      // tiene capital inmovilizado que avisar.
      if (demanda > 0) {
        const margenDia =
          s.margen_unitario != null
            ? ` — se pierden ~${money(Math.max(0, demanda * s.margen_unitario))}/día de margen`
            : '';
        out.push({
          tipo: 'QUIEBRE',
          severidad: 'ALTA',
          producto_id: p.id,
          mensaje: `${etiqueta} sin stock${margenDia}`,
        });
      }
      continue;
    }

    // R32.5: capital inmovilizado = stock × costo del proveedor
    // principal (es_principal + activo, viene en el bulk). Sin
    // costo no se pondera — BAJA y el mensaje queda en unidades.
    const capital = comp?.costo != null ? p.stock_actual * comp.costo : null;

    // Dead stock es por falta de ventas — independiente de la
    // demanda estimada (que justamente es 0 en los dormidos).
    // T32.4: severidad ponderada por capital (ver umbrales arriba).
    if (s.ultima_venta == null || s.ultima_venta <= corte) {
      const severidad =
        capital == null
          ? 'BAJA'
          : capital > CAPITAL_DEAD_ALTA
            ? 'ALTA'
            : capital > CAPITAL_DEAD_MEDIA
              ? 'MEDIA'
              : 'BAJA';
      const capTxt = capital != null ? ` (~${money(capital)} de capital)` : '';
      out.push({
        tipo: 'DEAD_STOCK',
        severidad,
        producto_id: p.id,
        mensaje: `${etiqueta}: sin ventas en ${DIAS_VENTANA}d — ${p.stock_actual}u inmovilizadas${capTxt}`,
      });
    } else if (demanda > 0) {
      const cobertura = p.stock_actual / demanda;
      const lead = p.lead_esperado ?? 0;
      if (cobertura < lead) {
        out.push({
          tipo: 'RIESGO_LEAD',
          severidad: cobertura < lead / 2 ? 'ALTA' : 'MEDIA',
          producto_id: p.id,
          mensaje: `${etiqueta}: cobertura ${cobertura.toFixed(1)}d < lead ${lead}d — quiebra antes de que llegue el pedido`,
        });
      }
    }

    // T32.4 — reglas de pricing contra el snapshot vigente de
    // competencia. Sin datos de cadena para el SKU no se inventa
    // alerta (comp.min null = todas las filas sin precio o sin
    // snapshot). Son ortogonales al estado de stock: un muerto con
    // precio > max también recibe PRECIO_FUERA_MERCADO (diagnóstico
    // de posición, R32.4); las que piden rotación exigen demanda.
    if (comp?.min != null) {
      // Cadena en promo sobre un top seller propio → presión
      // competitiva donde más duele. promos[0] es la más profunda.
      if (comp.promos.length > 0 && demanda >= pisoTop) {
        const promo = comp.promos[0];
        const pct = Math.round(promo.descuento * 100);
        out.push({
          tipo: 'PRESION_COMPETITIVA',
          severidad: promo.descuento > PROMO_ALTA_DESCUENTO ? 'ALTA' : 'MEDIA',
          producto_id: p.id,
          mensaje: `${etiqueta}: ${promo.cadena} en promo a ${money(promo.precio)} (−${pct}% vs lista) sobre un top seller propio (~${demanda.toFixed(1)}u/día)`,
        });
      }
      if (p.precio_venta > comp.max) {
        out.push({
          tipo: 'PRECIO_FUERA_MERCADO',
          severidad: 'MEDIA',
          producto_id: p.id,
          mensaje: `${etiqueta}: precio ${money(p.precio_venta)} por encima del máximo de mercado (${money(comp.max)})`,
        });
      }
      if (demanda > 0 && p.precio_venta < comp.min * FACTOR_OPORTUNIDAD) {
        out.push({
          tipo: 'OPORTUNIDAD_MARGEN',
          severidad: 'BAJA',
          producto_id: p.id,
          mensaje: `${etiqueta}: ${money(p.precio_venta)} quedó >15% bajo el mínimo de mercado (${money(comp.min)}) — margen regalado en producto que rota`,
        });
      }
    }
  }

  for (const o of ordenes) {
    out.push({
      tipo: 'ORDEN_PENDIENTE',
      severidad: 'MEDIA',
      orden_id: o.id,
      mensaje: `${o.orden_id} (${o.producto}) lleva ${o.horas}h sin aprobación — ${money(o.monto_total)}`,
    });
  }
  return out;
}

// Dedup (R29.3): salta candidatas que ya tienen alerta no leída del
// mismo tipo+entidad, o una creada en las últimas 24h (evita spam si
// la leen pero el problema sigue).
async function insertarNuevas(db, cands) {
  const existentes = await db.all(
    `SELECT tipo, producto_id, orden_id FROM alertas
     WHERE leida = 0 OR fecha_creacion > now() - interval '${DEDUP_HORAS} hours'`,
  );
  const clave = (a) => `${a.tipo}:${a.producto_id ?? ''}:${a.orden_id ?? ''}`;
  const vistas = new Set(existentes.map(clave));
  let nuevas = 0;
  for (const c of cands) {
    if (vistas.has(clave(c))) continue;
    await db.run(
      `INSERT INTO alertas (tipo, producto_id, orden_id, severidad, mensaje)
       VALUES (?, ?, ?, ?, ?)`,
      [c.tipo, c.producto_id ?? null, c.orden_id ?? null, c.severidad, c.mensaje],
    );
    vistas.add(clave(c));
    nuevas++;
  }
  return nuevas;
}

// Mutex in-process (la app corre single-process): dos evaluaciones
// concurrentes insertarían duplicados al leer `existentes` antes del
// commit del otro — las llamadas se encolan en una sola promesa.
let evalPromise = null;

export function evaluarAlertas() {
  evalPromise ??= evaluarAhora().finally(() => {
    evalPromise = null;
  });
  return evalPromise;
}

async function evaluarAhora() {
  const db = await openDb();
  const [{ hoy }, stats, productos, ordenes, competencia, lotes] = await Promise.all([
    db.get('SELECT CURRENT_DATE::text AS hoy'),
    estadisticasDemandaBulk(DIAS_VENTANA),
    db.all(
      `SELECT p.id, p.sku, p.nombre, p.stock_actual, p.precio_venta,
              p.vida_util_dias,
              COALESCE((pr.tiempo_entrega_min_dias + pr.tiempo_entrega_max_dias) / 2.0,
                       pr.tiempo_entrega_dias)::double precision AS lead_esperado
       FROM productos p JOIN proveedores pr ON pr.id = p.proveedor_id`,
    ),
    db.all(
      `SELECT o.id, o.orden_id, o.monto_total, p.nombre AS producto,
              EXTRACT(EPOCH FROM (now() - o.fecha_creacion)) / 3600 AS horas_f
       FROM ordenes_compra o JOIN productos p ON p.id = o.producto_id
       WHERE o.estado = 'PENDIENTE_APROBACION'
         AND o.fecha_creacion < now() - interval '${ORDEN_HORAS_UMBRAL} hours'`,
    ),
    // T32.4: una pasada — min/max de mercado, promos y costo
    // principal por producto (ver competenciaBulk).
    competenciaBulk(),
    // T33.3: lotes vivos con vencimiento dentro de la ventana
    // máxima (15d — cada producto recorta la suya en candidatas).
    // Lotes agotados o sin fecha nunca alertan.
    db.all(
      `SELECT producto_id,
              (fecha_vencimiento - CURRENT_DATE)::int AS dias,
              cantidad_actual AS cantidad
       FROM lotes
       WHERE cantidad_actual > 0
         AND fecha_vencimiento IS NOT NULL
         AND fecha_vencimiento <= CURRENT_DATE + 15`,
    ),
  ]);
  const corte = new Date(Date.parse(`${hoy}T00:00:00Z`) - DIAS_VENTANA * 86400000)
    .toISOString()
    .slice(0, 10);
  const cands = candidatas({
    productos,
    stats,
    ordenes: ordenes.map((o) => ({ ...o, horas: Math.floor(o.horas_f) })),
    corte,
    competencia,
    lotes,
  });
  const nuevas = await insertarNuevas(db, cands);
  await db.run(
    `INSERT INTO alertas_meta (clave, valor)
     VALUES ('ultima_eval', EXTRACT(EPOCH FROM now())::text)
     ON CONFLICT (clave) DO UPDATE SET valor = excluded.valor`,
  );
  return { evaluadas: cands.length, nuevas };
}

// Lazy eval (R29.3): corre las reglas si la última evaluación tiene
// más de EVAL_THROTTLE_MIN — sin scheduler. Un valor no parseable
// cuenta como vieja: peor caso re-evalúa y auto-cura la meta.
async function evaluarSiToca() {
  const db = await openDb();
  const meta = await db.get(
    "SELECT valor FROM alertas_meta WHERE clave = 'ultima_eval'",
  );
  const t = Number(meta?.valor);
  const vieja = !Number.isFinite(t) || Date.now() / 1000 - t > EVAL_THROTTLE_MIN * 60;
  if (vieja) return evaluarAlertas();
  return null;
}

export async function listarAlertas({ leida, tipo }) {
  const db = await openDb();
  await evaluarSiToca();

  const where = [];
  const params = [];
  if (leida !== undefined) {
    where.push('a.leida = ?');
    params.push(leida);
  }
  if (tipo) {
    where.push('a.tipo = ?');
    params.push(tipo);
  }
  const data = await db.all(
    `SELECT a.id, a.tipo, a.severidad, a.mensaje, a.leida,
            a.fecha_creacion, a.producto_id, a.orden_id,
            p.sku, p.nombre AS producto, o.orden_id AS orden_codigo
     FROM alertas a
     LEFT JOIN productos p ON p.id = a.producto_id
     LEFT JOIN ordenes_compra o ON o.id = a.orden_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY CASE a.severidad WHEN 'ALTA' THEN 0 WHEN 'MEDIA' THEN 1 ELSE 2 END,
              a.fecha_creacion DESC`,
    params,
  );
  const resumen = await db.get(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE leida = 0)::int AS no_leidas,
            COUNT(*) FILTER (WHERE leida = 0 AND severidad = 'ALTA')::int AS altas,
            COUNT(*) FILTER (WHERE leida = 0 AND severidad = 'MEDIA')::int AS medias,
            COUNT(*) FILTER (WHERE leida = 0 AND severidad = 'BAJA')::int AS bajas
     FROM alertas`,
  );
  return { data, resumen };
}

export async function marcarLeida(id) {
  const db = await openDb();
  const r = await db.run('UPDATE alertas SET leida = 1 WHERE id = ?', [id]);
  return r.changes > 0;
}

export async function leerTodas() {
  const db = await openDb();
  const r = await db.run('UPDATE alertas SET leida = 1 WHERE leida = 0');
  return r.changes;
}
