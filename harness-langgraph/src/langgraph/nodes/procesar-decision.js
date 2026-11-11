/**
 * NODO 9 — PROCESAR LA DECISIÓN HUMANA
 *
 * Lee ordenesPendientes y consulta el estado REAL de cada una al
 * backend (ordenes.client → GET /api/ordenes/:id) — la decisión del
 * humano la toma del sistema, no del payload del resume. Las que ya
 * están APROBADA/RECHAZADA pasan a ordenesResueltas; las que siguen
 * pendientes quedan en ordenesPendientes y el router manda el grafo
 * a otra pausa.
 */
import { obtenerOrden } from '../../integrations/ordenes.client.js';
import { log } from '../../utils/logger.js';

export async function procesarDecision(state) {
  const pendientes = [];
  const resueltas = [...state.ordenesResueltas];

  for (const ordenId of state.ordenesPendientes) {
    const orden = await obtenerOrden(ordenId);
    if (orden.estado === 'PENDIENTE_APROBACION') {
      pendientes.push(ordenId);
      log(`  ${ordenId}: todavía pendiente`);
    } else {
      resueltas.push(orden);
      log(
        `  ${ordenId}: ${orden.estado}` +
          (orden.aprobado_por ? ` por ${orden.aprobado_por}` : '') +
          (orden.motivo_rechazo ? ` — motivo: ${orden.motivo_rechazo}` : ''),
      );
    }
  }

  return { ordenesPendientes: pendientes, ordenesResueltas: resueltas };
}
