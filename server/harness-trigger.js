// SPEC-30 (T30.5): trigger por evento — una venta que deja
// stock <=0 es un quiebre recién nacido y el agente puede
// reordenarlo ya, no en la próxima corrida programada.
// Fire-and-forget: el POS no espera ni falla por el harness
// (si está caído, el quiebre lo ve la corrida programada).
const HARNESS_URL = process.env.HARNESS_URL || 'http://localhost:4110';

/** ids = producto_ids que quedaron <=0 tras la venta/batch. */
export function avisarQuiebreAlAgente(ids) {
  if (!ids?.length) return;
  fetch(`${HARNESS_URL}/trigger`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ motivo: 'stock0', producto_ids: ids }),
    signal: AbortSignal.timeout(2000),
  }).catch(() => {}); // harness caído no es problema de la caja
}
