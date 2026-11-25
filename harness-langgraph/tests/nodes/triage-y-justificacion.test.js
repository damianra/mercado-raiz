/**
 * Tests del flujo de demanda sobre estadísticas del backend
 * (SPEC-12 + SPEC-26):
 *  - triage heurístico en analizar-demanda
 *    (stats estables → demanda del backend sin LLM;
 *     sin ventas → demanda 0 determinística)
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

const estadisticaDemanda = vi.fn();
const estadisticasDemandaBulk = vi.fn();
vi.mock('../../src/integrations/estadisticas.client.js', () => ({
  estadisticaDemanda: (...a) => estadisticaDemanda(...a),
  estadisticasDemandaBulk: (...a) => estadisticasDemandaBulk(...a),
}));

// Sin el mock, buscarDemanda/guardarDemanda irían contra la tabla
// analisis_cache de Postgres — los callers hacen await/.catch(),
// así que el mock devuelve Promises como la impl real.
const cacheFns = {
  buscarDemanda: vi.fn(async () => null),
  buscarJustificacion: vi.fn(async () => null),
  guardarDemanda: vi.fn(async () => {}),
  guardarJustificacion: vi.fn(async () => {}),
  hashAnalisis: vi.fn(() => 'hash-fake'),
};
vi.mock('../../src/harness/analisis-cache.js', () => cacheFns);

const { analizarDemanda } = await import(
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
  costo_unitario: 10,
  proveedor: { nombre: 'Prov', tiempo_entrega_dias: 2 },
});

/** Respuesta de /api/estadisticas/demanda para fixtures. */
const stats = ({
  id = 1,
  demanda = 5,
  cv = 0.1,
  diasConVenta = 30,
  desvio = 1.5,
  zona = 'EN_RANGO',
  indice = 100,
} = {}) => ({
  producto_id: id,
  dias: 90,
  demanda_diaria: demanda,
  tendencia: 0.01,
  cv,
  desvio_demanda: desvio,
  dias_con_venta: diasConVenta,
  dias_en_quiebre: 0,
  ultima_venta: '2026-11-20',
  zona_precio: zona,
  indice_precio: indice,
});

/** El nodo lee el bulk — cada llamada recibe la lista de stats. */
const bulk = (...list) => estadisticasDemandaBulk.mockResolvedValue(list);

beforeEach(() => {
  vi.clearAllMocks();
  // mockClear no resetea implementaciones — restaurar los defaults
  // del módulo para que un mockResolvedValue no contamine el test
  // siguiente.
  cacheFns.buscarDemanda.mockResolvedValue(null);
  cacheFns.buscarJustificacion.mockResolvedValue(null);
  metrics.iniciarCorrida();
});

describe('analizar-demanda — triage heurístico (SPEC-12/R26.8)', () => {
  it('stats estables: usa la demanda del backend sin llamar al LLM', async () => {
    bulk(stats());
    const state = { productosBajos: [producto(1)] };

    const { analisisPorProducto, errores } = await analizarDemanda(state);

    expect(invokeJson).not.toHaveBeenCalled();
    expect(invokeBatch).not.toHaveBeenCalled();
    expect(analisisPorProducto[1].demanda_diaria).toBe(5);
    expect(analisisPorProducto[1].desvio_demanda).toBe(1.5);
    expect(analisisPorProducto[1].observacion).toContain('Demanda estable');
    expect(errores).toEqual([]); // triage no es error ni fallback
    expect(metrics.resumen().llm_evitadas).toBe(1);
    expect(metrics.resumen().conteo_fallbacks).toBe(0);
    // el triage no toca el cache — el input no pasó por el LLM
    expect(cacheFns.guardarDemanda).not.toHaveBeenCalled();
  });

  it('cache hit: reuso del análisis con σ fresco del stats actual', async () => {
    bulk(stats({ cv: 0.6, desvio: 3.3 }));
    cacheFns.buscarDemanda.mockResolvedValue({
      demanda_diaria: 7, tendencia: 'bajando', observacion: 'cacheada',
    });
    const { analisisPorProducto } = await analizarDemanda({ productosBajos: [producto(1)] });

    expect(invokeJson).not.toHaveBeenCalled();
    expect(invokeBatch).not.toHaveBeenCalled();
    expect(analisisPorProducto[1].demanda_diaria).toBe(7);
    expect(analisisPorProducto[1].desvio_demanda).toBe(3.3); // σ del stats actual, no del cache
    expect(metrics.resumen().cache_hits).toBe(1);
  });

  it('sin ventas en la ventana: el guard DEAD_STOCK lo excluye antes del LLM (T32.5)', async () => {
    bulk(stats({ demanda: 0, cv: null, diasConVenta: 0, desvio: 0 }));
    const state = { productosBajos: [producto(1)] };

    const { analisisPorProducto, excluidos, productosBajos, errores } =
      await analizarDemanda(state);

    expect(invokeJson).not.toHaveBeenCalled();
    expect(invokeBatch).not.toHaveBeenCalled();
    // No hay OC ni análisis: queda fuera de productosBajos, auditado
    expect(productosBajos).toEqual([]);
    expect(analisisPorProducto).toEqual({});
    expect(excluidos).toHaveLength(1);
    expect(excluidos[0]).toMatchObject({ producto_id: 1, excluido_por: 'DEAD_STOCK' });
    expect(errores).toEqual([]);
    // ni siquiera se consulta el cache — nunca llegó al triage
    expect(cacheFns.buscarDemanda).not.toHaveBeenCalled();
  });

  it('ventas volátiles: una llamada en lote resuelve el análisis', async () => {
    bulk(stats({ cv: 0.6 }));
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
    bulk(stats({ cv: 0.6 }), stats({ id: 2, cv: 0.6 }));
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

  it('respuesta envuelta en objeto {"resultados": [...]}: se extrae el array', async () => {
    bulk(stats({ cv: 0.6 }));
    invokeBatch.mockResolvedValue({
      // con format:'json' Ollama sesga a objetos — el modelo suele
      // envolver el array en lugar de devolverlo desnudo
      content: '{"resultados": [{"producto_id": 1, "demanda_diaria": 4, "tendencia": "subiendo", "observacion": "pico"}]}',
      response_metadata: {},
    });
    const state = { productosBajos: [producto(1)] };

    const { analisisPorProducto } = await analizarDemanda(state);

    expect(invokeBatch).toHaveBeenCalledTimes(1);
    expect(invokeJson).not.toHaveBeenCalled();
    expect(analisisPorProducto[1].demanda_diaria).toBe(4);
  });

  it('objeto suelto de un item: resuelve ese producto y el resto cae a individual', async () => {
    bulk(stats({ cv: 0.6 }), stats({ id: 2, cv: 0.6 }));
    invokeBatch.mockResolvedValue({
      // el modelo respondió solo un producto sin array (formato
      // real observado con qwen3:8b + format:'json')
      content: '{"producto_id": 2, "demanda_diaria": 7, "tendencia": "estable", "observacion": "ok"}',
      response_metadata: {},
    });
    invokeJson.mockResolvedValue({
      content: '{"demanda_diaria": 4, "tendencia": "subiendo", "observacion": "pico"}',
      response_metadata: {},
    });
    const state = { productosBajos: [producto(1), producto(2)] };

    const { analisisPorProducto } = await analizarDemanda(state);

    expect(invokeBatch).toHaveBeenCalledTimes(1); // 1 llamada, sin reintentos
    expect(invokeJson).toHaveBeenCalledTimes(1); // solo el faltante
    expect(analisisPorProducto[1].demanda_diaria).toBe(4); // vía individual
    expect(analisisPorProducto[2].demanda_diaria).toBe(7); // vía lote
  });

  it('lote entero inválido: todos caen a llamada individual', async () => {
    bulk(stats({ cv: 0.6 }), stats({ id: 2, cv: 0.6 }));
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

  it('pocos datos (<3 días con venta): va al LLM, no al heurístico', async () => {
    bulk(stats({ diasConVenta: 2 }));
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
    analisisPorProducto: { 1: { demanda_diaria: 5, tendencia: 'estable', observacion: 'ok', desvio_demanda: 1.5 } },
    hashPorProducto: { 1: 'hash-fake' },
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

  it('σ se excluye del cache de justificación — el cache guarda solo output LLM', async () => {
    // El análisis en estado lleva desvio_demanda (dato del backend) —
    // si se pasara tal cual al cache, mismoAnalisis nunca matchearía
    // contra la demanda cacheada (sin σ) y ambos caches quedarían
    // ciegos. El strip es la regresión cubierta acá.
    cacheFns.buscarJustificacion.mockResolvedValue('Justificación cacheada.');
    const { decisionPorProducto } = await generarAnalisis(stateBase(true));

    expect(decisionPorProducto[1].analisis_ia).toBe('Justificación cacheada.');
    const [, , analisisConsultado] = cacheFns.buscarJustificacion.mock.calls[0];
    expect(analisisConsultado).not.toHaveProperty('desvio_demanda');
    expect(analisisConsultado).toMatchObject({ demanda_diaria: 5, tendencia: 'estable' });
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
