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
  log(`  Errores no fatales: ${state.errores.length}`);
  try {
    const stats = await obtenerStats();
    log(`  Dashboard: ${JSON.stringify(stats.data ?? stats)}`);
  } catch {
    log('  (no se pudieron leer los KPIs del dashboard)');
  }
  return {};
}
