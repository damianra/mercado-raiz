/**
 * NODO 3 — CALCULAR CANTIDAD ÓPTIMA
 *
 * Lee del estado: productosBajos + analisisPorProducto (la demanda
 * que estimó el nodo anterior). Aplica la fórmula
 * "demanda × (lead esperado del proveedor + 7 días de buffer) +
 * stock de seguridad z·σ·√lead" (SPEC-26, R26.8), nunca por debajo
 * de 2× el stock mínimo, y calcula el monto con el
 * costo del proveedor (producto_proveedor). No usa el LLM: la cantidad es aritmética de
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
    const leadPpal = p.proveedor?.lead_dias_esperado ?? p.proveedor?.tiempo_entrega_dias ?? 1;
    const demanda = analisis?.demanda_diaria ?? 1;
    const sigma = analisis?.desvio_demanda ?? 0;

    // SPEC-27 (T27.3): el agente elige el proveedor que minimiza el
    // GASTO TOTAL (costo × cantidad), no solo el costo unitario —
    // un proveedor más barato pero más lento exige pedir más
    // unidades (demanda × lead extra), y puede salir más caro.
    // Fallback sin precios: el principal del producto.
    const opciones = p.precios?.length
      ? p.precios
      : [{
          proveedor_id: p.proveedor?.id,
          proveedor: p.proveedor?.nombre,
          costo_unitario: p.costo_unitario ?? p.precio_venta,
          lead_efectivo: leadPpal,
          es_principal: 1,
        }];

    let mejor;
    for (const o of opciones) {
      const lead = o.lead_efectivo ?? leadPpal;
      const seguridad = config.zSeguridad * sigma * Math.sqrt(lead);
      const objetivo = Math.ceil(demanda * (lead + DIAS_COBERTURA) + seguridad);
      const minimo = p.stock_minimo * 2; // nunca quedar bajo el mínimo tras la compra
      const cantidad = Math.max(objetivo - p.stock_actual, minimo - p.stock_actual, 1);
      const total = cantidad * o.costo_unitario;
      if (!mejor || total < mejor.total) {
        mejor = { ...o, lead, cantidad, total, seguridad };
      }
    }

    const monto = Math.round(mejor.total * 100) / 100;
    decision[p.id] = {
      cantidad: mejor.cantidad,
      monto_total: monto,
      proveedor_id: mejor.proveedor_id,
      proveedor_nombre: mejor.proveedor,
      motivo_proveedor: mejor.es_principal ? 'proveedor principal' : 'alternativo de menor costo total',
    };
    const alt = mejor.es_principal ? '' : ` ← ${mejor.proveedor} (alternativo)`;
    log(`  ${p.sku}: ordenar ${mejor.cantidad} u → $${monto.toFixed(2)} (demanda ${demanda}/día, lead ${mejor.lead}d, SS ${mejor.seguridad.toFixed(1)}u)${alt}`);
  }

  return { decisionPorProducto: decision };
}
