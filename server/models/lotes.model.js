import { openDb } from '../db.js';

// SPEC-33 (T33.2): los lotes son el desglose físico de
// `stock_actual`. Toda mutación del contador toca lotes en la
// misma tx (R33.2) — estas dos primitivas son el único camino.
//
// FEFO (R33.3): lo que vence antes sale primero; el lote sin
// vencimiento sale último (no apura la rotación). Si la salida
// supera la suma de lotes, el remanente lo absorbe el contador
// (divergencia por sobreventa — el lote nunca queda negativo).
const FEFO_ORDER = `ORDER BY (l.fecha_vencimiento IS NULL),
  l.fecha_vencimiento, l.fecha_ingreso, l.id`;

/**
 * Descuenta `unidades` de los lotes del producto en orden FEFO
 * (FOR UPDATE — corre dentro de la tx del caller, que ya lockeó
 * el producto). Devuelve las unidades NO cubiertas por lotes:
 * el remanente de divergencia que el contador descuenta aparte.
 */
export async function descontarFefo(t, productoId, unidades) {
  let resto = unidades;
  const lotes = await t.all(
    `SELECT l.id, l.cantidad_actual FROM lotes l
     WHERE l.producto_id = ? AND l.cantidad_actual > 0
     ${FEFO_ORDER}
     FOR UPDATE`,
    [productoId],
  );
  for (const lote of lotes) {
    if (resto <= 0) break;
    const baja = Math.min(lote.cantidad_actual, resto);
    await t.run(
      'UPDATE lotes SET cantidad_actual = cantidad_actual - ? WHERE id = ?',
      [baja, lote.id],
    );
    resto -= baja;
  }
  return resto;
}

/**
 * Crea un lote dentro de una tx abierta (recepción de OC o ajuste
 * positivo). `codigo` único por producto lo arma el caller:
 * 'OC-NNN' para recepciones, 'AJU-<mov>' para ajustes.
 */
export async function crearLoteEnTx(
  t,
  { productoId, codigo, cantidad, fechaVencimiento, origen, ordenId },
) {
  const { id } = await t.get(
    `INSERT INTO lotes
       (producto_id, codigo, cantidad_inicial, cantidad_actual,
        fecha_vencimiento, origen, orden_id)
     VALUES (?, ?, ?, ?, ?::date, ?, ?) RETURNING id`,
    [
      productoId,
      codigo,
      cantidad,
      cantidad,
      fechaVencimiento ?? null,
      origen,
      ordenId ?? null,
    ],
  );
  return id;
}

export const ESTADOS_LOTE = ['VIGENTE', 'PROXIMO', 'VENCIDO', 'AGOTADO'];

const FROM_LOTES = `FROM lotes l
  JOIN productos p ON p.id = l.producto_id
  LEFT JOIN producto_proveedor pp
    ON pp.producto_id = l.producto_id AND pp.es_principal = 1 AND pp.activo = 1
  LEFT JOIN ordenes_compra o ON o.id = l.orden_id`;

// dias_restantes = fecha − hoy (PG date − date → entero de días;
// negativo = ya venció). Ventana PROXIMO relativa a la vida útil
// (diasAlertaVencimiento del seed, misma regla): min(15, 40% de la
// vida); COALESCE 15d cuando el lote tiene fecha pero el producto
// no declara vida útil (fecha cargada a mano en un seco).
const SELECT_LOTES = `SELECT l.id, l.producto_id, l.codigo,
    l.cantidad_inicial, l.cantidad_actual,
    l.fecha_vencimiento::text AS fecha_vencimiento,
    l.fecha_ingreso, l.origen,
    o.orden_id AS orden_codigo,
    p.sku AS p_sku, p.nombre AS p_nombre, p.categoria AS p_categoria,
    (l.fecha_vencimiento - CURRENT_DATE)::int AS dias_restantes,
    ROUND((l.cantidad_actual * pp.costo_unitario)::numeric, 2)::float8
      AS valor_en_riesgo,
    CASE
      WHEN l.cantidad_actual = 0 THEN 'AGOTADO'
      WHEN l.fecha_vencimiento IS NOT NULL
           AND l.fecha_vencimiento < CURRENT_DATE THEN 'VENCIDO'
      WHEN l.fecha_vencimiento IS NOT NULL
           AND l.fecha_vencimiento <= CURRENT_DATE +
             LEAST(15, GREATEST(1, FLOOR(COALESCE(p.vida_util_dias * 0.4, 15)))::int)
        THEN 'PROXIMO'
      ELSE 'VIGENTE'
    END AS estado
  ${FROM_LOTES}`;

function mapLote(row) {
  return {
    id: row.id,
    codigo: row.codigo,
    producto: {
      id: row.producto_id,
      sku: row.p_sku,
      nombre: row.p_nombre,
      categoria: row.p_categoria,
    },
    cantidad_inicial: row.cantidad_inicial,
    cantidad_actual: row.cantidad_actual,
    fecha_vencimiento: row.fecha_vencimiento,
    dias_restantes: row.dias_restantes,
    estado: row.estado,
    valor_en_riesgo: row.valor_en_riesgo,
    origen: row.origen,
    orden_id: row.orden_codigo,
    fecha_ingreso: row.fecha_ingreso,
  };
}

// R33.5: dias_restantes y valor_en_riesgo salen calculados del
// server — el front no hace la cuenta. Orden: lo accionable
// primero (vencidos/próximos por fecha), agotados al final.
export async function listarLotes({ productoId, estado, page, limit }) {
  const db = await openDb();
  const where = [];
  const params = [];

  if (productoId !== undefined) {
    where.push('l.producto_id = ?');
    params.push(productoId);
  }
  if (estado) {
    where.push(
      `CASE
         WHEN l.cantidad_actual = 0 THEN 'AGOTADO'
         WHEN l.fecha_vencimiento IS NOT NULL
              AND l.fecha_vencimiento < CURRENT_DATE THEN 'VENCIDO'
         WHEN l.fecha_vencimiento IS NOT NULL
              AND l.fecha_vencimiento <= CURRENT_DATE +
                LEAST(15, GREATEST(1, FLOOR(COALESCE(p.vida_util_dias * 0.4, 15)))::int)
           THEN 'PROXIMO'
         ELSE 'VIGENTE'
       END = ?`,
    );
    params.push(estado);
  }
  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';

  const { c: total } = await db.get(`SELECT COUNT(*) AS c ${FROM_LOTES}${whereSql}`, params);
  const rows = await db.all(
    `${SELECT_LOTES}${whereSql}
     ORDER BY (l.cantidad_actual = 0),
              (l.fecha_vencimiento IS NULL),
              l.fecha_vencimiento, l.id
     LIMIT ? OFFSET ?`,
    [...params, limit, (page - 1) * limit],
  );

  return {
    data: rows.map(mapLote),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}
