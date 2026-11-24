import { openDb } from '../db.js';
import { avisarQuiebreAlAgente } from '../harness-trigger.js';

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

// SPEC-30 (T30.2): la venta es un hecho físico (la caja ya vendió).
// Si el stock teórico no alcanza, el dato ya divergía — la corrección
// es el conteo físico (POST /stock/ajuste), no rechazar la venta.
// Por eso stock_actual puede quedar negativo: señal de divergencia.
// En la misma tx: descuento + fila ventas + historial_stock VENTA.
// `p` viene ya lockeada (FOR UPDATE) por el caller.
async function aplicarVentaEnTx(t, p, { productoId, unidades, canal, fecha, referencia, usuario }, ts) {
  const anterior = p.stock_actual;
  const nuevo = anterior - unidades;
  await t.run(
    `UPDATE productos SET stock_actual = ?, fecha_actualizacion = ? WHERE id = ?`,
    [nuevo, ts, productoId],
  );
  const v = await t.get(
    `INSERT INTO ventas (producto_id, fecha, unidades, canal, referencia)
     VALUES (?, ?::date, ?, ?, ?) RETURNING id`,
    [productoId, fecha ?? ts.slice(0, 10), unidades, canal, referencia ?? null],
  );
  await t.run(
    `INSERT INTO historial_stock
       (producto_id, tipo_movimiento, cantidad_anterior, cantidad_nueva, diferencia, referencia, usuario)
     VALUES (?, 'VENTA', ?, ?, ?, ?, ?)`,
    [productoId, anterior, nuevo, -unidades, referencia ?? `VTA-${v.id}`, usuario],
  );
  return { venta_id: v.id, stock_anterior: anterior, stock_nuevo: nuevo };
}

export async function registrarVenta(item) {
  const db = await openDb();
  const ts = new Date().toISOString();
  const r = await db.tx(async (t) => {
    const p = await t.get(
      `SELECT stock_actual FROM productos WHERE id = ? FOR UPDATE`,
      [item.productoId],
    );
    if (!p) return { status: 404, error: 'producto no encontrado' };
    return { status: 201, data: await aplicarVentaEnTx(t, p, item, ts) };
  });
  // T30.5: quiebre recién nacido → candidato inmediato del agente.
  // Post-commit (el aviso refleja estado ya commiteado) y
  // fire-and-forget — la venta nunca depende del harness.
  if (r.status === 201 && r.data.stock_nuevo <= 0) {
    avisarQuiebreAlAgente([item.productoId]);
  }
  return r;
}

// POST /ventas/batch (T30.2): lote POS en una sola request — todo o
// nada. Fase 1: se lockean los productos distintos EN ORDEN (dos
// lotes concurrentes con el mismo set no pueden intercalar locks →
// sin deadlock) y se verifica existencia — un faltante aborta antes
// de escribir nada. Fase 2: cada item re-lee el stock dentro del
// lock ya tomado — la tx ve sus propios writes, así que el mismo
// producto repetido en el lote descuenta acumulado y la cadena
// anterior→nueva del historial queda continua.
export async function registrarVentasBatch(items, usuario) {
  const db = await openDb();
  const ts = new Date().toISOString();
  const r = await db.tx(async (t) => {
    const ids = [...new Set(items.map((it) => it.productoId))].sort((a, b) => a - b);
    const existentes = new Set();
    for (const id of ids) {
      const p = await t.get(`SELECT id FROM productos WHERE id = ? FOR UPDATE`, [id]);
      if (p) existentes.add(id);
    }
    const faltantes = items.flatMap((it, indice) =>
      existentes.has(it.productoId) ? [] : [{ indice, producto_id: it.productoId }],
    );
    if (faltantes.length) return { faltantes };
    const ventas = [];
    for (const it of items) {
      const p = await t.get(
        `SELECT stock_actual FROM productos WHERE id = ? FOR UPDATE`,
        [it.productoId],
      );
      ventas.push({
        producto_id: it.productoId,
        ...(await aplicarVentaEnTx(t, p, { ...it, usuario }, ts)),
      });
    }
    return { ventas };
  });
  // T30.5: un cierre de caja puede dejar varios quiebres — un solo
  // trigger con todos (el harness debuncea corridas por cooldown).
  if (r.ventas) {
    const quiebres = [
      ...new Set(r.ventas.filter((v) => v.stock_nuevo <= 0).map((v) => v.producto_id)),
    ];
    avisarQuiebreAlAgente(quiebres);
  }
  return r;
}
