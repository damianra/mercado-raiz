/**
 * NODO 3 — CALCULAR CANTIDAD ÓPTIMA
 *
 * Lee del estado: productosBajos + analisisPorProducto (la demanda
 * que estimó el nodo anterior). Aplica la fórmula
 * "demanda × (lead esperado del proveedor + 7 días de buffer) +
 * stock de seguridad z·σ·√lead" (SPEC-26, R26.8), nunca por debajo
 * de 2× el stock mínimo, y calcula el monto con el
 * precio_unitario. No usa el LLM: la cantidad es aritmética de
 * negocio — el modelo estima, el código calcula.
 * Escribe: decisionPorProducto {cantidad, monto_total}.
 */
import { log } from '../../utils/logger.js';
import { config } from '../../config/env.js';

const DIAS_COBERTURA = 7;

export function calcularCantidad(state) {
  const decision = {};

  for (const p of state.productosBajos) {
    const analisis = state.analisisPorProducto[p.id];
    // SPEC-26: media del rango min/max cuando existe; si no, el
    // lead nominal. El backend ya lo expone como lead_dias_esperado.
    const lead = p.proveedor?.lead_dias_esperado ?? p.proveedor?.tiempo_entrega_dias ?? 1;
    const demanda = analisis?.demanda_diaria ?? 1;
    const sigma = analisis?.desvio_demanda ?? 0;

    const seguridad = config.zSeguridad * sigma * Math.sqrt(lead);
    const objetivo = Math.ceil(demanda * (lead + DIAS_COBERTURA) + seguridad);
    const minimo = p.stock_minimo * 2; // nunca quedar bajo el mínimo tras la compra
    const cantidad = Math.max(objetivo - p.stock_actual, minimo - p.stock_actual, 1);
    const monto = Math.round(cantidad * p.precio_unitario * 100) / 100;

    decision[p.id] = { cantidad, monto_total: monto };
    log(`  ${p.sku}: ordenar ${cantidad} u → $${monto.toFixed(2)} (demanda ${demanda}/día, lead ${lead}d, SS ${seguridad.toFixed(1)}u)`);
  }

  return { decisionPorProducto: decision };
}
