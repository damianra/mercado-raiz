/**
 * NODO 7 — NOTIFICAR AL APROBADOR
 *
 * Lee ordenesPendientes y las loguea. Es un stub: no envía nada —
 * en producción acá iría el email/Slack/push al aprobador. En esta
 * app la notificación real es que la orden ya aparece pendiente en
 * el dashboard del frontend.
 */
import { log } from '../../utils/logger.js';

export function notificar(state) {
  log(`  🔔 ${state.ordenesPendientes.length} orden(es) esperan al humano:`);
  for (const id of state.ordenesPendientes) {
    log(`    - ${id} — visible en el dashboard (en producción: email/Slack)`);
  }
  return {};
}
