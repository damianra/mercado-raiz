/**
 * NODO 4 — DECIDIR SI REQUIERE APROBACIÓN HUMANA
 *
 * Lee decisionPorProducto[].monto_total y aplica la regla
 * monto >= UMBRAL_APROBACION (.env) → marca requiere_aprobacion.
 * Ese flag es el que crear-orden manda en el POST /api/ordenes y el
 * que usa el router para decidir si el grafo pausa.
 * El backend tiene la misma regla (UMBRAL_APROBACION en
 * server/models/ordenes.model.js) como red de seguridad.
 */
import { config } from '../../config/env.js';
import { log } from '../../utils/logger.js';

export function decidirAprobacion(state) {
  const decision = { ...state.decisionPorProducto };

  for (const p of state.productosBajos) {
    const d = decision[p.id];
    const requiere = d.monto_total >= config.umbralAprobacion;
    decision[p.id] = { ...d, requiere_aprobacion: requiere };
    log(
      `  ${p.sku}: $${d.monto_total.toFixed(2)} → ` +
        (requiere ? 'requiere aprobación humana' : 'auto-aprobable'),
    );
  }

  return { decisionPorProducto: decision };
}
