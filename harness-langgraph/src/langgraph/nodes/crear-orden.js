/**
 * NODO 6 — CREAR ÓRDENES EN EL BACKEND
 *
 * Lee productosBajos + decisionPorProducto y persiste las órdenes
 * en el backend. SPEC-16: usa POST /api/ordenes/batch — hasta
 * LOTE_ORDENES por request en una transacción (una escritura para
 * el rate limiter). Si un lote falla (400 por item inválido, 429
 * agotado, backend viejo sin el endpoint) cae al path individual
 * por producto para no perder el trabajo de la corrida. Escribe:
 * ordenesCreadas (todas las respuestas) y ordenesPendientes (los
 * orden_id que quedaron en PENDIENTE_APROBACION — la lista que
 * usa el router para decidir si el grafo pasa por notificar).
 */
import { crearOrden, crearOrdenesBatch } from '../../integrations/ordenes.client.js';
import { log } from '../../utils/logger.js';

// Por debajo del tope del endpoint (200) — un lote fallido cae a
// individual y estos items se procesan sueltos.
const LOTE_ORDENES = 100;

function registrar(orden, p, cantidad, { creadas, pendientes }) {
  creadas.push(orden);
  if (orden.estado === 'PENDIENTE_APROBACION') pendientes.push(orden.orden_id);
  log(`  ✓ ${orden.orden_id} — ${p.nombre} x${cantidad} → ${orden.estado}`);
}

/** Path individual — fallback cuando el lote batch falla. */
async function crearIndividual(pedidos, salida) {
  for (const { p, d } of pedidos) {
    try {
      const res = await crearOrden({
        productoId: p.id,
        cantidad: d.cantidad,
        requiereAprobacion: d.requiere_aprobacion,
        analisisIa: d.analisis_ia,
      });
      registrar(res.data, p, d.cantidad, salida);
    } catch (err) {
      salida.errores.push(`crear-orden(${p.sku}): ${err.message}`);
      log(`  ✗ ${p.sku}: no se pudo crear la orden (${err.message})`);
    }
  }
}

export async function crearOrdenes(state) {
  const salida = { creadas: [], pendientes: [], errores: [] };
  const pedidos = state.productosBajos.map((p) => ({
    p,
    d: state.decisionPorProducto[p.id],
  }));

  for (let i = 0; i < pedidos.length; i += LOTE_ORDENES) {
    const lote = pedidos.slice(i, i + LOTE_ORDENES);
    try {
      const res = await crearOrdenesBatch(lote.map(({ p, d }) => ({
        producto_id: p.id,
        cantidad: d.cantidad,
        requiere_aprobacion: d.requiere_aprobacion,
        analisis_ia: d.analisis_ia,
      })));
      const porProducto = new Map(lote.map((e) => [e.p.id, e]));
      for (const orden of res.data) {
        const pedido = porProducto.get(orden.producto.id);
        registrar(orden, pedido?.p ?? orden.producto, pedido?.d.cantidad ?? orden.cantidad, salida);
      }
      log(`  lote de ${lote.length} órdenes persistido en una transacción`);
    } catch (err) {
      salida.errores.push(`crear-orden(lote de ${lote.length}): ${err.message} — fallback a individuales`);
      log(`  lote de ${lote.length} falló (${err.message}) — intentando una por una`);
      await crearIndividual(lote, salida);
    }
  }

  return {
    ordenesCreadas: salida.creadas,
    ordenesPendientes: salida.pendientes,
    errores: salida.errores,
  };
}
