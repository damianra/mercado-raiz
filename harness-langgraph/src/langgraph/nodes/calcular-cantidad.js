/**
 * NODO 3 — CALCULAR CANTIDAD ÓPTIMA
 *
 * Lee del estado: productosBajos + analisisPorProducto (la demanda
 * que estimó el LLM en el nodo anterior). Aplica la fórmula
 * "demanda × (lead time del proveedor + 7 días de buffer), nunca
 * por debajo de 2× el stock mínimo" y calcula el monto con el
 * precio_unitario. No usa el LLM: la cantidad es aritmética de
 * negocio — el modelo estima, el código calcula.
 * Escribe: decisionPorProducto {cantidad, monto_total}.
 */
import { log } from '../../utils/logger.js';

const DIAS_COBERTURA = 7;

export function calcularCantidad(state) {
  const decision = {};

  for (const p of state.productosBajos) {
    const analisis = state.analisisPorProducto[p.id];
    const lead = p.proveedor?.tiempo_entrega_dias ?? 1;
    const demanda = analisis?.demanda_diaria ?? 1;

    const objetivo = Math.ceil(demanda * (lead + DIAS_COBERTURA));
    const minimo = p.stock_minimo * 2; // nunca quedar bajo el mínimo tras la compra
    const cantidad = Math.max(objetivo - p.stock_actual, minimo - p.stock_actual, 1);
    const monto = Math.round(cantidad * p.precio_unitario * 100) / 100;

    decision[p.id] = { cantidad, monto_total: monto };
    log(`  ${p.sku}: ordenar ${cantidad} u → $${monto.toFixed(2)} (demanda ${demanda}/día, lead ${lead}d)`);
  }

  return { decisionPorProducto: decision };
}
