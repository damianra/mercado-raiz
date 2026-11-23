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
import { config } from '../../src/config/env.js';

const producto = (id, stock, minimo, precio, lead = 1, leadEsperado) => ({
  id,
  sku: `SKU${id}`,
  nombre: `Producto ${id}`,
  stock_actual: stock,
  stock_minimo: minimo,
  costo_unitario: precio,
  proveedor: { nombre: 'Prov', tiempo_entrega_dias: lead, lead_dias_esperado: leadEsperado },
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

  it('usa lead_dias_esperado del rango cuando el proveedor lo trae (SPEC-26)', () => {
    const state = {
      productosBajos: [producto(1, 4, 20, 1, 1, 3)],
      analisisPorProducto: { 1: { demanda_diaria: 5 } },
    };
    const { decisionPorProducto } = calcularCantidad(state);
    // objetivo: ceil(5 * (3+7)) = 50 → 50 - 4 = 46 (con nominal 1d sería 36)
    expect(decisionPorProducto[1].cantidad).toBe(46);
  });

  it('suma stock de seguridad z·σ·√lead sobre la variabilidad (SPEC-26/R26.8)', () => {
    const state = {
      productosBajos: [producto(1, 4, 20, 1)],
      analisisPorProducto: { 1: { demanda_diaria: 5, desvio_demanda: 2 } },
    };
    const { decisionPorProducto } = calcularCantidad(state);
    // SS = z * 2 * sqrt(1); objetivo = ceil(40 + SS) → 40 + ceil(SS)
    // con z=1.65 → ceil(43.3) = 44 → 44 - 4 = 40
    const esperado = Math.ceil(40 + config.zSeguridad * 2 * Math.sqrt(1)) - 4;
    expect(decisionPorProducto[1].cantidad).toBe(esperado);
    expect(esperado).toBeGreaterThan(36); // más que sin seguridad
  });

  it('demanda 0 (sin ventas): ordena el mínimo garantizado', () => {
    const state = {
      productosBajos: [producto(1, 0, 16, 10)],
      analisisPorProducto: { 1: { demanda_diaria: 0, desvio_demanda: 0 } },
    };
    const { decisionPorProducto } = calcularCantidad(state);
    // objetivo = SS = 0 → minimo 2*16 - 0 = 32 domina
    expect(decisionPorProducto[1].cantidad).toBe(32);
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
  const u = config.umbralAprobacion;
  const state = {
    productosBajos: [producto(1, 0, 1, 1), producto(2, 0, 1, 1)],
    decisionPorProducto: {
      1: { cantidad: 10, monto_total: u - 0.01 },
      2: { cantidad: 10, monto_total: u },
    },
  };

  it('monto < umbral → auto-aprobable, monto >= umbral → humano', () => {
    const { decisionPorProducto } = decidirAprobacion(state);
    expect(decisionPorProducto[1].requiere_aprobacion).toBe(false);
    expect(decisionPorProducto[2].requiere_aprobacion).toBe(true);
  });
});


describe('calcular-cantidad — selección de proveedor (T27.3)', () => {
  const pBase = () => ({
    id: 1, sku: 'X', nombre: 'X', stock_actual: 4, stock_minimo: 20,
    precio_venta: 10,
    proveedor: { id: 1, nombre: 'Principal', lead_dias_esperado: 1 },
    precios: [
      { proveedor_id: 1, proveedor: 'Principal', costo_unitario: 10, lead_efectivo: 1, es_principal: 1 },
      { proveedor_id: 8, proveedor: 'Mayorista', costo_unitario: 8, lead_efectivo: 6, es_principal: 0 },
    ],
  });
  const stats = { analisisPorProducto: { 1: { demanda_diaria: 5, desvio_demanda: 0 } } };

  it('elige el alternativo si su total (costo×cantidad) es menor pese al lead', () => {
    const p = pBase();
    // ppal: ceil(5×8)=40−4=36u ×10 = 360; alt: ceil(5×13)=65−4=61u ×8 = 488
    // → ppal gana acá; bajar el costo alt para que gane
    p.precios[1].costo_unitario = 5; // 61×5=305 < 360
    const { decisionPorProducto } = calcularCantidad({ productosBajos: [p], ...stats });
    const d = decisionPorProducto[1];
    expect(d.proveedor_id).toBe(8);
    expect(d.cantidad).toBe(61); // lead 6 → más unidades
    expect(d.monto_total).toBeCloseTo(305);
    expect(d.motivo_proveedor).toMatch(/alternativo/);
  });

  it('elige el principal si el alternativo lento encarece el total', () => {
    const p = pBase(); // ppal 360 < alt 488
    const { decisionPorProducto } = calcularCantidad({ productosBajos: [p], ...stats });
    const d = decisionPorProducto[1];
    expect(d.proveedor_id).toBe(1);
    expect(d.cantidad).toBe(36);
    expect(d.motivo_proveedor).toMatch(/principal/);
  });

  it('sin precios usa el proveedor del producto (fallback)', () => {
    const p = { ...pBase(), precios: [] };
    const { decisionPorProducto } = calcularCantidad({ productosBajos: [p], ...stats });
    expect(decisionPorProducto[1].proveedor_id).toBe(1);
    expect(decisionPorProducto[1].monto_total).toBeCloseTo(360);
  });
});
