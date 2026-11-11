/**
 * Tests de los nodos sin LLM ni HTTP: calcular-cantidad y
 * decidir-aprobacion. Reciben un estado de prueba y verifican la
 * cantidad calculada y el flag requiere_aprobacion — son las únicas
 * partes del agente que deben dar siempre el mismo resultado para
 * los mismos datos.
 */
import { describe, expect, it } from 'vitest';
import { calcularCantidad } from '../../src/langgraph/nodes/calcular-cantidad.js';
import { decidirAprobacion } from '../../src/langgraph/nodes/decidir-aprobacion.js';

const producto = (id, stock, minimo, precio, lead = 1) => ({
  id,
  sku: `SKU${id}`,
  nombre: `Producto ${id}`,
  stock_actual: stock,
  stock_minimo: minimo,
  precio_unitario: precio,
  proveedor: { nombre: 'Prov', tiempo_entrega_dias: lead },
});

describe('calcular-cantidad', () => {
  it('cubre demanda × (lead + 7) descontando stock actual', () => {
    const state = {
      productosBajos: [producto(1, 4, 20, 1.2)],
      analisisPorProducto: { 1: { demanda_diaria: 5 } },
    };
    const { decisionPorProducto } = calcularCantidad(state);
    // objetivo: ceil(5 * (1+7)) = 40 → 40 - 4 = 36; minimo: 40-4=36 → 36u
    expect(decisionPorProducto[1].cantidad).toBe(36);
    expect(decisionPorProducto[1].monto_total).toBeCloseTo(43.2);
  });

  it('nunca ordena menos que lo necesario para llegar a 2×mínimo', () => {
    const state = {
      productosBajos: [producto(1, 4, 20, 1)],
      analisisPorProducto: { 1: { demanda_diaria: 0.1 } },
    };
    // demanda casi nula: objetivo = 1 → pero minimo 40-4 = 36 domina
    const { decisionPorProducto } = calcularCantidad(state);
    expect(decisionPorProducto[1].cantidad).toBe(36);
  });
});

describe('decidir-aprobacion', () => {
  const state = {
    productosBajos: [producto(1, 0, 1, 1), producto(2, 0, 1, 1)],
    decisionPorProducto: {
      1: { cantidad: 10, monto_total: 99.99 },
      2: { cantidad: 10, monto_total: 100 },
    },
  };

  it('monto < umbral → auto-aprobable, monto >= umbral → humano', () => {
    const { decisionPorProducto } = decidirAprobacion(state);
    expect(decisionPorProducto[1].requiere_aprobacion).toBe(false);
    expect(decisionPorProducto[2].requiere_aprobacion).toBe(true);
  });
});
