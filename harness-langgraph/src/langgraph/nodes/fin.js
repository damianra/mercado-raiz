/**
 * NODO 8 — CIERRE
 *
 * Lee ordenesCreadas, ordenesPendientes y errores para loguear el
 * resumen de la corrida, y pide GET /api/dashboard/stats para
 * mostrar los KPIs del tablero después de la ejecución. No escribe
 * en el estado ni modifica el backend.
 */
import { obtenerStats } from '../../integrations/dashboard.client.js';
import { log } from '../../utils/logger.js';

export async function fin(state) {
  log(`  Órdenes creadas: ${state.ordenesCreadas.length}`);
  log(`  Pendientes de aprobación humana: ${state.ordenesPendientes.length}`);
  // T32.5: productos que el guard sacó de la reposición — quedan
  // visibles en el resumen, no son error.
  if (state.excluidos?.length) {
    log(`  Excluidos por el guard anti-recompra: ${state.excluidos.length}`);
    for (const e of state.excluidos) {
      log(`    - ${e.sku}: ${e.excluido_por} — ${e.detalle}`);
    }
  }
  log(`  Errores no fatales: ${state.errores.length}`);
  try {
    const stats = await obtenerStats();
    log(`  Dashboard: ${JSON.stringify(stats.data ?? stats)}`);
  } catch {
    log('  (no se pudieron leer los KPIs del dashboard)');
  }
  return {};
}
