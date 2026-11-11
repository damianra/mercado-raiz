/**
 * NODO 6 — CREAR ÓRDENES EN EL BACKEND
 *
 * Lee productosBajos + decisionPorProducto y hace un POST
 * /api/ordenes por cada producto (ordenes.client) con cantidad,
 * requiere_aprobacion y analisis_ia. Escribe: ordenesCreadas (todas
 * las respuestas) y ordenesPendientes (los orden_id que quedaron en
 * PENDIENTE_APROBACION — la lista que usa el router para decidir
 * si el grafo pasa por notificar antes de cerrar).
 */
import { crearOrden } from '../../integrations/ordenes.client.js';
import { log } from '../../utils/logger.js';

export async function crearOrdenes(state) {
  const creadas = [];
  const pendientes = [];
  const errores = [];

  for (const p of state.productosBajos) {
    const d = state.decisionPorProducto[p.id];
    try {
      const res = await crearOrden({
        productoId: p.id,
        cantidad: d.cantidad,
        requiereAprobacion: d.requiere_aprobacion,
        analisisIa: d.analisis_ia,
      });
      const orden = res.data;
      creadas.push(orden);
      if (orden.estado === 'PENDIENTE_APROBACION') pendientes.push(orden.orden_id);
      log(`  ✓ ${orden.orden_id} — ${p.nombre} x${d.cantidad} → ${orden.estado}`);
    } catch (err) {
      errores.push(`crear-orden(${p.sku}): ${err.message}`);
      log(`  ✗ ${p.sku}: no se pudo crear la orden (${err.message})`);
    }
  }

  return { ordenesCreadas: creadas, ordenesPendientes: pendientes, errores };
}
