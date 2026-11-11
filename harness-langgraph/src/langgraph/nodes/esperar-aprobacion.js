/**
 * NODO 8 — ESPERAR APROBACIÓN HUMANA (interrupt)
 *
 * Lee ordenesPendientes y llama a interrupt(): LangGraph guarda el
 * estado completo en checkpoints.sqlite y corta la ejecución — el
 * grafo queda dormido. Cuando llega POST /resume al harness (lo
 * dispara el backend tras cada aprobar/rechazar), el grafo se
 * reanuda, este nodo vuelve a correr desde el inicio e interrupt()
 * devuelve el payload recibido.
 * Escribe: senalReanudacion.
 */
import { interrupt } from '@langchain/langgraph';
import { log } from '../../utils/logger.js';

export function esperarAprobacion(state) {
  log(`  ⏸  pausando — órdenes pendientes: ${state.ordenesPendientes.join(', ')}`);
  log('     reanudar con: curl -X POST http://localhost:4110/resume');

  const senal = interrupt({
    mensaje: 'Esperando decisión humana sobre órdenes pendientes',
    ordenes_pendientes: state.ordenesPendientes,
  });

  log(`  ▶ reanudado — señal recibida: ${JSON.stringify(senal)}`);
  return { senalReanudacion: senal };
}
