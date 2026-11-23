import { openDb } from '../db.js';
import { estadisticasDemandaBulk } from './estadisticas.model.js';

// SPEC-29 (R29.3): motor de reglas determinísticas — sin LLM.
// Misma fuente de stats que agente/dashboard/métricas
// (estadisticasDemandaBulk): cero divergencia. La evaluación es
// lazy: GET /api/alertas la dispara si pasaron >60min (sin cron).
const DIAS_VENTANA = 90;
const EVAL_THROTTLE_MIN = 60;
const ORDEN_HORAS_UMBRAL = 48;
const DEDUP_HORAS = 24;

const money = (n) =>
  `$${Number(n).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`;

// Genera las alertas-candidata del momento. Función pura para
// testear las reglas sin tocar la tabla.
export function candidatas({ productos, stats, ordenes, corte }) {
  const statsPor = new Map(stats.map((s) => [s.producto_id, s]));
  const out = [];

  for (const p of productos) {
    const s = statsPor.get(p.id) ?? {};
    const demanda = s.demanda_diaria ?? 0;
    const etiqueta = `${p.nombre} (${p.sku})`;

    if (p.stock_actual === 0) {
      // En cero solo alerta si hay demanda real que se pierde; un
      // dormido sin stock no tiene capital inmovilizado que avisar.
      if (demanda > 0) {
        const margenDia =
          s.margen_unitario != null
            ? ` — se pierden ~${money(demanda * s.margen_unitario)}/día de margen`
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

    // Dead stock es por falta de ventas — independiente de la
    // demanda estimada (que justamente es 0 en los dormidos).
    if (s.ultima_venta == null || s.ultima_venta <= corte) {
      out.push({
        tipo: 'DEAD_STOCK',
        severidad: 'BAJA',
        producto_id: p.id,
        mensaje: `${etiqueta}: sin ventas en ${DIAS_VENTANA}d — ${p.stock_actual}u inmovilizadas`,
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
     WHERE leida = 0 OR fecha_creacion > now() - interval '24 hours'`,
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

export async function evaluarAlertas() {
  const db = await openDb();
  const [{ hoy }, stats, productos, ordenes] = await Promise.all([
    db.get('SELECT CURRENT_DATE::text AS hoy'),
    estadisticasDemandaBulk(DIAS_VENTANA),
    db.all(
      `SELECT p.id, p.sku, p.nombre, p.stock_actual, p.precio_venta,
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
  ]);
  const corte = new Date(Date.parse(`${hoy}T00:00:00Z`) - DIAS_VENTANA * 86400000)
    .toISOString()
    .slice(0, 10);
  const cands = candidatas({
    productos,
    stats,
    ordenes: ordenes.map((o) => ({ ...o, horas: Math.floor(o.horas_f) })),
    corte,
  });
  const nuevas = await insertarNuevas(db, cands);
  await db.run(
    `INSERT INTO alertas_meta (clave, valor) VALUES ('ultima_eval', now()::text)
     ON CONFLICT (clave) DO UPDATE SET valor = excluded.valor`,
  );
  return { evaluadas: cands.length, nuevas };
}

// Lazy eval (R29.3): corre las reglas si la última evaluación tiene
// más de EVAL_THROTTLE_MIN — sin scheduler.
async function evaluarSiToca(db) {
  const meta = await db.get(
    "SELECT valor FROM alertas_meta WHERE clave = 'ultima_eval'",
  );
  const vieja =
    !meta || Date.now() - Date.parse(meta.valor) > EVAL_THROTTLE_MIN * 60000;
  if (vieja) return evaluarAlertas();
  return null;
}

export async function listarAlertas({ leida, tipo }) {
  const db = await openDb();
  await evaluarSiToca(db);

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
