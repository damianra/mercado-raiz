import { openDb } from '../db.js';
import { crearLoteEnTx, descontarFefo } from './lotes.model.js';

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
  fechaVencimiento,
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
    // Una fecha informada no se puede honrar en una baja (nada que
    // etiquetar — la merma sale FEFO); rechazar antes de escribir:
    // un return dentro de tx COMMITea el update/historial.
    if (fechaVencimiento !== undefined && nuevo <= anterior) {
      return {
        status: 400,
        error: 'fecha_vencimiento solo aplica a ajustes positivos (crea el lote encontrado)',
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
    // SPEC-33 (T33.2): espejo en lotes del ajuste — una baja sale
    // en FEFO (la merma física se cobra al que vence antes); un
    // conteo que encuentra unidades crea lote AJUSTE sin
    // vencimiento (el físico encontrado no trae etiqueta — SPEC-33,
    // decisión "ajuste positivo sin fecha").
    if (nuevo < anterior) {
      await descontarFefo(t, productoId, anterior - nuevo);
    } else if (nuevo > anterior) {
      await crearLoteEnTx(t, {
        productoId,
        codigo: `AJU-${h.id}`,
        cantidad: nuevo - anterior,
        fechaVencimiento,
        origen: 'AJUSTE',
      });
    }
    return {
      status: 201,
      data: { movimiento_id: h.id, stock_anterior: anterior, stock_nuevo: nuevo },
    };
  });
}
