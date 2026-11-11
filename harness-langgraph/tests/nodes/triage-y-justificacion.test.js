/**
 * Tests del flujo nuevo de SPEC-12:
 *  - coeficienteVariacion + triage heurístico en analizar-demanda
 *    (ventas estables → promedio histórico sin LLM)
 *  - justificación condicional en generar-analisis
 *    (requiere_aprobacion → LLM; auto-aprobada → template)
 *  - router despuesDeCrearOrdenes (pendientes → notificar, si no → fin)
 *
 * El LLM y el backend se mockean — los tests no tocan Ollama ni la API.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeJson = vi.fn();
const invokeBatch = vi.fn();
const invokeTexto = vi.fn();
vi.mock('../../src/config/ollama.js', () => ({
  llmJson: { invoke: (...a) => invokeJson(...a) },
  llmJsonBatch: { invoke: (...a) => invokeBatch(...a) },
  llm: { invoke: (...a) => invokeTexto(...a) },
}));

const ventasDeProducto = vi.fn();
vi.mock('../../src/integrations/historial.client.js', () => ({
  ventasDeProducto: (...a) => ventasDeProducto(...a),
}));

// Sin el mock, guardarDemanda escribiría data/analisis-cache.json
// real y una segunda corrida del suite haría hit (suite flaky +
// contamina el cache del dev).
const cacheFns = {
  buscarDemanda: vi.fn(() => null),
  buscarJustificacion: vi.fn(() => null),
  guardarDemanda: vi.fn(),
  guardarJustificacion: vi.fn(),
  hashAnalisis: vi.fn(() => 'hash-fake'),
};
vi.mock('../../src/harness/analisis-cache.js', () => cacheFns);

const { coeficienteVariacion, analizarDemanda } = await import(
  '../../src/langgraph/nodes/analizar-demanda.js'
);
const { generarAnalisis } = await import('../../src/langgraph/nodes/generar-analisis.js');
const { despuesDeCrearOrdenes } = await import('../../src/langgraph/edges/router.js');
const { metrics } = await import('../../src/harness/metrics.js');

const producto = (id) => ({
  id,
  sku: `SKU${id}`,
  nombre: `Producto ${id}`,
  stock_actual: 5,
  stock_minimo: 20,
  precio_unitario: 10,
  proveedor: { nombre: 'Prov', tiempo_entrega_dias: 2 },
});

/** N días con las unidades dadas — diferencia negativa como en el seed. */
const ventas = (unidades) =>
  unidades.map((u, i) => ({ fecha: `2026-11-${String(i + 1).padStart(2, '0')}`, diferencia: -u }));

beforeEach(() => {
  vi.clearAllMocks();
  metrics.iniciarCorrida();
});

describe('coeficienteVariacion', () => {
  it('es 0 con demanda perfectamente estable', () => {
    expect(coeficienteVariacion(ventas([5, 5, 5, 5, 5]))).toBe(0);
  });
  it('crece con la dispersión', () => {
    const leve = coeficienteVariacion(ventas([4, 5, 6, 5, 5]));
    const volatil = coeficienteVariacion(ventas([2, 10, 3, 9, 1]));
    expect(leve).toBeLessThan(0.3);
    expect(volatil).toBeGreaterThan(0.3);
  });
  it('es Infinity con menos de 3 días o media 0 (va al LLM)', () => {
    expect(coeficienteVariacion(ventas([5, 5]))).toBe(Infinity);
    expect(coeficienteVariacion(ventas([0, 0, 0]))).toBe(Infinity);
    expect(coeficienteVariacion([])).toBe(Infinity);
  });
});

describe('analizar-demanda — triage heurístico (SPEC-12)', () => {
  it('ventas estables: estima por promedio sin llamar al LLM', async () => {
    ventasDeProducto.mockResolvedValue(ventas([5, 5, 5, 5, 5]));
    const state = { productosBajos: [producto(1)] };

    const { analisisPorProducto, errores } = await analizarDemanda(state);

    expect(invokeJson).not.toHaveBeenCalled();
    expect(analisisPorProducto[1].demanda_diaria).toBe(5);
    expect(analisisPorProducto[1].observacion).toContain('Demanda estable');
    expect(errores).toEqual([]); // triage no es error ni fallback
    expect(metrics.resumen().llm_evitadas).toBe(1);
    expect(metrics.resumen().conteo_fallbacks).toBe(0);
    // el triage no toca el cache — el input no pasó por el LLM
    expect(cacheFns.guardarDemanda).not.toHaveBeenCalled();
  });

  it('ventas volátiles: una llamada en lote resuelve el análisis', async () => {
    ventasDeProducto.mockResolvedValue(ventas([2, 10, 3, 9, 1]));
    invokeBatch.mockResolvedValue({
      content: '[{"producto_id": 1, "demanda_diaria": 4, "tendencia": "subiendo", "observacion": "pico"}]',
      response_metadata: {},
    });
    const state = { productosBajos: [producto(1)] };

    const { analisisPorProducto } = await analizarDemanda(state);

    expect(invokeBatch).toHaveBeenCalledTimes(1); // SPEC-16: 1 lote = 1 llamada
    expect(invokeJson).not.toHaveBeenCalled(); // sin fallback individual
    expect(analisisPorProducto[1].demanda_diaria).toBe(4);
    expect(metrics.resumen().llm_evitadas).toBe(0);
    // el análisis LLM queda cacheado para la próxima corrida
    expect(cacheFns.guardarDemanda).toHaveBeenCalledTimes(1);
    expect(cacheFns.guardarDemanda.mock.calls[0][2].demanda_diaria).toBe(4);
  });

  it('lote con item faltante: solo ese producto cae a llamada individual', async () => {
    ventasDeProducto.mockResolvedValue(ventas([2, 10, 3, 9, 1]));
    invokeBatch.mockResolvedValue({
      // el modelo devuelve solo el producto 2 — el 1 falta
      content: '[{"producto_id": 2, "demanda_diaria": 7, "tendencia": "estable", "observacion": "ok"}]',
      response_metadata: {},
    });
    invokeJson.mockResolvedValue({
      content: '{"demanda_diaria": 4, "tendencia": "subiendo", "observacion": "pico"}',
      response_metadata: {},
    });
    const state = { productosBajos: [producto(1), producto(2)] };

    const { analisisPorProducto } = await analizarDemanda(state);

    expect(invokeBatch).toHaveBeenCalledTimes(1); // mismo lote
    expect(invokeJson).toHaveBeenCalledTimes(1); // solo el faltante
    expect(analisisPorProducto[1].demanda_diaria).toBe(4); // vía individual
    expect(analisisPorProducto[2].demanda_diaria).toBe(7); // vía lote
  });

  it('lote entero inválido: todos caen a llamada individual', async () => {
    ventasDeProducto.mockResolvedValue(ventas([2, 10, 3, 9, 1]));
    invokeBatch.mockResolvedValue({ content: 'no json at all', response_metadata: {} });
    invokeJson.mockResolvedValue({
      content: '{"demanda_diaria": 4, "tendencia": "estable", "observacion": "ok"}',
      response_metadata: {},
    });
    const state = { productosBajos: [producto(1), producto(2)] };

    await analizarDemanda(state);

    expect(invokeBatch).toHaveBeenCalledTimes(2); // 1 intento + 1 reintento
    expect(invokeJson).toHaveBeenCalledTimes(2); // 1 por producto
  });

  it('pocos datos (<3 días): va al LLM, no al heurístico', async () => {
    ventasDeProducto.mockResolvedValue(ventas([5, 5]));
    invokeBatch.mockResolvedValue({
      content: '[{"producto_id": 1, "demanda_diaria": 5, "tendencia": "estable", "observacion": "ok"}]',
      response_metadata: {},
    });
    await analizarDemanda({ productosBajos: [producto(1)] });
    expect(invokeBatch).toHaveBeenCalledTimes(1);
  });
});

describe('generar-analisis — justificación condicional (SPEC-12)', () => {
  const stateBase = (requiere) => ({
    productosBajos: [producto(1)],
    analisisPorProducto: { 1: { demanda_diaria: 5, tendencia: 'estable', observacion: 'ok' } },
    decisionPorProducto: { 1: { cantidad: 30, monto_total: requiere ? 300 : 30, requiere_aprobacion: requiere } },
  });

  it('orden >= umbral: invoca al LLM y guarda la prosa', async () => {
    invokeTexto.mockResolvedValue({
      content: 'La demanda diaria de 5 unidades justifica reponer 30.',
      response_metadata: {},
    });

    const { decisionPorProducto } = await generarAnalisis(stateBase(true));

    expect(invokeTexto).toHaveBeenCalledTimes(1);
    expect(decisionPorProducto[1].analisis_ia).toContain('demanda');
    expect(metrics.resumen().llm_evitadas).toBe(0);
  });

  it('orden auto-aprobada: template marcado, sin llamar al LLM', async () => {
    const { decisionPorProducto } = await generarAnalisis(stateBase(false));

    expect(invokeTexto).not.toHaveBeenCalled();
    expect(decisionPorProducto[1].analisis_ia).toContain('(estimación automática)');
    expect(decisionPorProducto[1].analisis_ia).toContain('30 unidades');
    expect(metrics.resumen().llm_evitadas).toBe(1);
  });

  it('mixto: solo las pendientes consumen LLM', async () => {
    const state = {
      productosBajos: [producto(1), producto(2)],
      analisisPorProducto: {
        1: { demanda_diaria: 5, tendencia: 'estable' },
        2: { demanda_diaria: 7, tendencia: 'subiendo' },
      },
      decisionPorProducto: {
        1: { cantidad: 30, monto_total: 30, requiere_aprobacion: false },
        2: { cantidad: 40, monto_total: 400, requiere_aprobacion: true },
      },
    };
    invokeTexto.mockResolvedValue({ content: 'Justificación de la orden grande.', response_metadata: {} });

    const { decisionPorProducto } = await generarAnalisis(state);

    expect(invokeTexto).toHaveBeenCalledTimes(1);
    expect(decisionPorProducto[1].analisis_ia).toContain('automática');
    expect(decisionPorProducto[2].analisis_ia).toContain('Justificación');
  });
});

describe('router — despuesDeCrearOrdenes (grafo sin interrupt)', () => {
  it('pendientes → notificar (la pausa ya no existe)', () => {
    expect(despuesDeCrearOrdenes({ ordenesPendientes: ['OC-1'] })).toBe('notificar');
  });
  it('sin pendientes → fin directo', () => {
    expect(despuesDeCrearOrdenes({ ordenesPendientes: [] })).toBe('fin');
  });
});
