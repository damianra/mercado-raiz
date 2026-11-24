import { openDb } from '../db.js';

// SPEC-30 (T30.2): motivos del ajuste manual — el conteo físico de
// góndola/depósito es un motivo, no un tipo de movimiento (por eso
// tipo_movimiento queda AJUSTE y el motivo viaja en su columna).
export const MOTIVOS_AJUSTE = ['MERMA', 'ROTURA', 'CONTEO', 'OTRO'];

// Ajuste manual de stock. `cantidadNueva` (absoluta — "conté N
// unidades") o `delta` (signado — "se rompieron 2"), nunca ambos.
// Un delta que deje el stock negativo se rechaza: si el físico ya
// no alcanza, el ajuste correcto es un CONTEO con la cantidad real.
export async function ajustarStock({
  productoId,
  motivo,
  cantidadNueva,
  delta,
  referencia,
  usuario,
}) {
  const db = await openDb();
  const ts = new Date().toISOString();
  return db.tx(async (t) => {
    const p = await t.get(
      `SELECT stock_actual FROM productos WHERE id = ? FOR UPDATE`,
      [productoId],
    );
    if (!p) return { status: 404, error: 'producto no encontrado' };
    const anterior = p.stock_actual;
    const nuevo = cantidadNueva ?? anterior + delta;
    if (nuevo < 0) {
      return {
        status: 400,
        error: 'el ajuste dejaría el stock negativo — registrar un conteo (cantidad_nueva)',
      };
    }
    await t.run(
      `UPDATE productos SET stock_actual = ?, fecha_actualizacion = ? WHERE id = ?`,
      [nuevo, ts, productoId],
    );
    const h = await t.get(
      `INSERT INTO historial_stock
         (producto_id, tipo_movimiento, cantidad_anterior, cantidad_nueva, diferencia, referencia, usuario, motivo)
       VALUES (?, 'AJUSTE', ?, ?, ?, ?, ?, ?) RETURNING id`,
      [productoId, anterior, nuevo, nuevo - anterior, referencia ?? null, usuario, motivo],
    );
    return {
      status: 201,
      data: { movimiento_id: h.id, stock_anterior: anterior, stock_nuevo: nuevo },
    };
  });
}
