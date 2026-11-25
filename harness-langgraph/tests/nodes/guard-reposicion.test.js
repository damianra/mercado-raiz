/**
 * Tests del guard anti-recompra (SPEC-32, T32.5): los productos
 * DEAD_STOCK (sin ventas en la ventana) o SOBRE_MAX (precio sobre
 * el máximo de mercado) no entran como candidatos de OC — re-poner
 * stock muerto inmoviliza capital y re-poner sobre-preciado
 * alimenta ventas lentas. Excepción: SOBRE_MAX en quiebre real
 * (stock ≤0 con demanda viva) sigue candidato pero la OC anota
 * `revision_precio`. También cubre la carga bulk de stats y su
 * fallback a fetch por producto.
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

const cacheFns = {
  buscarDemanda: vi.fn(async () => null),
  buscarJustificacion: vi.fn(async () => null),
  guardarDemanda: vi.fn(async () => {}),
  guardarJustificacion: vi.fn(async () => {}),
  hashAnalisis: vi.fn(() => 'hash-fake'),
};
vi.mock('../../src/harness/analisis-cache.js', () => cacheFns);

const { analizarDemanda, clasificarCandidato } = await import(
  '../../src/langgraph/nodes/analizar-demanda.js'
);
const { generarAnalisis } = await import('../../src/langgraph/nodes/generar-analisis.js');
const { metrics } = await import('../../src/harness/metrics.js');

const producto = (id, { stock = 5 } = {}) => ({
  id,
  sku: `SKU${id}`,
  nombre: `Producto ${id}`,
  stock_actual: stock,
  stock_minimo: 20,
  costo_unitario: 10,
  proveedor: { nombre: 'Prov', tiempo_entrega_dias: 2 },
});

const stats = ({
  id = 1,
  demanda = 5,
  cv = 0.1,
  diasConVenta = 30,
  zona = 'EN_RANGO',
  indice = 100,
} = {}) => ({
  producto_id: id,
  dias: 90,
  demanda_diaria: demanda,
  tendencia: 0.01,
  cv,
  desvio_demanda: 1.5,
  dias_con_venta: diasConVenta,
  dias_en_quiebre: 0,
  ultima_venta: '2026-11-20',
  zona_precio: zona,
  indice_precio: indice,
});

const bulk = (...list) => estadisticasDemandaBulk.mockResolvedValue(list);

beforeEach(() => {
  vi.clearAllMocks();
  cacheFns.buscarDemanda.mockResolvedValue(null);
  cacheFns.buscarJustificacion.mockResolvedValue(null);
  metrics.iniciarCorrida();
});

describe('clasificarCandidato — criterio del guard (T32.5)', () => {
  it('DEAD_STOCK: sin ventas en la ventana → excluido', () => {
    const c = clasificarCandidato(producto(1), stats({ diasConVenta: 0, demanda: 0 }));
    expect(c.excluido_por).toBe('DEAD_STOCK');
    expect(c.detalle).toContain('sin ventas');
  });

  it('SOBRE_MAX con stock > 0 → excluido, el detalle cita el índice', () => {
    const c = clasificarCandidato(
      producto(1, { stock: 8 }),
      stats({ zona: 'SOBRE_MAX', indice: 118 }),
    );
    expect(c.excluido_por).toBe('SOBRE_MAX');
    expect(c.detalle).toContain('118');
  });

  it('SOBRE_MAX en quiebre real (stock 0 + demanda viva) → candidato con revisión', () => {
    const c = clasificarCandidato(
      producto(1, { stock: 0 }),
      stats({ zona: 'SOBRE_MAX', demanda: 6 }),
    );
    expect(c.excluido_por).toBeUndefined();
    expect(c.revision_precio).toBe(true);
  });

  it('SOBRE_MAX con stock 0 pero SIN demanda → DEAD_STOCK (gana el más severo)', () => {
    const c = clasificarCandidato(
      producto(1, { stock: 0 }),
      stats({ zona: 'SOBRE_MAX', diasConVenta: 0, demanda: 0 }),
    );
    expect(c.excluido_por).toBe('DEAD_STOCK');
  });

  it.each(['BAJO_MIN', 'EN_RANGO', 'SIN_DATOS'])('zona %s → candidato normal', (zona) => {
    expect(clasificarCandidato(producto(1), stats({ zona }))).toEqual({});
  });

  it('sin stats → sin decisión (el error path del nodo lo maneja)', () => {
    expect(clasificarCandidato(producto(1), undefined)).toEqual({});
  });
});

describe('analizar-demanda — guard aplicado a los candidatos (T32.5)', () => {
  it('SOBRE_MAX con stock: excluido de productosBajos, registrado con razón', async () => {
    bulk(stats({ zona: 'SOBRE_MAX', indice: 115 }));
    const { productosBajos, excluidos, analisisPorProducto } = await analizarDemanda({
      productosBajos: [producto(1)],
    });

    expect(productosBajos).toEqual([]);
    expect(analisisPorProducto).toEqual({});
    expect(excluidos[0]).toMatchObject({
      producto_id: 1,
      sku: 'SKU1',
      excluido_por: 'SOBRE_MAX',
    });
    expect(excluidos[0].detalle).toContain('máximo');
    expect(invokeBatch).not.toHaveBeenCalled();
  });

  it('SOBRE_MAX en quiebre real: sigue candidato, análisis marcado revision_precio', async () => {
    // demanda estable → path heurístico, sin LLM — el flag lo pone
    // el guard, no el modelo.
    bulk(stats({ zona: 'SOBRE_MAX', indice: 120, demanda: 6 }));
    const { productosBajos, excluidos, analisisPorProducto } = await analizarDemanda({
      productosBajos: [producto(1, { stock: 0 })],
    });

    expect(excluidos).toEqual([]);
    expect(productosBajos.map((p) => p.id)).toEqual([1]);
    expect(analisisPorProducto[1].revision_precio).toBe(true);
    expect(analisisPorProducto[1].zona_precio).toBe('SOBRE_MAX');
    expect(analisisPorProducto[1].indice_precio).toBe(120);
  });

  it('la posición competitiva viaja en el análisis para la justificación', async () => {
    bulk(stats({ zona: 'BAJO_MIN', indice: 88 }));
    const { analisisPorProducto } = await analizarDemanda({
      productosBajos: [producto(1)],
    });
    expect(analisisPorProducto[1]).toMatchObject({
      zona_precio: 'BAJO_MIN',
      indice_precio: 88,
    });
    expect(analisisPorProducto[1].revision_precio).toBeUndefined();
  });

  it('mixto: solo los candidatos sanos siguen al LLM', async () => {
    bulk(
      stats({ id: 1, cv: 0.6 }), // volátil → LLM
      stats({ id: 2, diasConVenta: 0, demanda: 0 }), // muerto → fuera
      stats({ id: 3, zona: 'SOBRE_MAX' }), // caro con stock → fuera
    );
    invokeBatch.mockResolvedValue({
      content: '[{"producto_id": 1, "demanda_diaria": 4, "tendencia": "estable", "observacion": "ok"}]',
      response_metadata: {},
    });
    const { productosBajos, excluidos, analisisPorProducto } = await analizarDemanda({
      productosBajos: [producto(1), producto(2), producto(3)],
    });

    expect(productosBajos.map((p) => p.id)).toEqual([1]);
    expect(excluidos.map((e) => e.excluido_por).sort()).toEqual(['DEAD_STOCK', 'SOBRE_MAX']);
    expect(analisisPorProducto[1].demanda_diaria).toBe(4);
    expect(invokeBatch).toHaveBeenCalledTimes(1);
  });

  it('producto ausente del bulk: demanda 0 + error, no tumba la corrida', async () => {
    bulk(); // bulk vacío
    const { analisisPorProducto, errores } = await analizarDemanda({
      productosBajos: [producto(1)],
    });
    expect(analisisPorProducto[1].demanda_diaria).toBe(0);
    expect(errores[0]).toContain('SKU1');
    expect(metrics.resumen().conteo_fallbacks).toBe(1);
  });

  it('bulk caído: degrada al fetch por producto (path previo)', async () => {
    estadisticasDemandaBulk.mockRejectedValue(new Error('HTTP 500'));
    estadisticaDemanda.mockResolvedValue(stats());
    const { analisisPorProducto } = await analizarDemanda({
      productosBajos: [producto(1)],
    });
    expect(estadisticaDemanda).toHaveBeenCalledWith(1);
    expect(analisisPorProducto[1].demanda_diaria).toBe(5);
    expect(metrics.resumen().conteo_fallbacks).toBe(1); // la caída del bulk
  });
});

describe('generar-analisis — nota de precio en la OC (T32.5)', () => {
  it('revision_precio: el template auto-aprobado exige revisar precio', async () => {
    const state = {
      productosBajos: [producto(1, { stock: 0 })],
      analisisPorProducto: {
        1: {
          demanda_diaria: 6,
          tendencia: 'estable',
          observacion: 'quiebre',
          desvio_demanda: 1,
          zona_precio: 'SOBRE_MAX',
          indice_precio: 120,
          revision_precio: true,
        },
      },
      hashPorProducto: {},
      decisionPorProducto: { 1: { cantidad: 30, monto_total: 30, requiere_aprobacion: false } },
    };
    const { decisionPorProducto } = await generarAnalisis(state);
    expect(invokeTexto).not.toHaveBeenCalled();
    expect(decisionPorProducto[1].analisis_ia).toContain('revisar precio');
  });

  it('los datos del backend (σ, zona, índice, revisión) se strippean del cache', async () => {
    cacheFns.buscarJustificacion.mockResolvedValue('Justificación cacheada.');
    const state = {
      productosBajos: [producto(1)],
      analisisPorProducto: {
        1: {
          demanda_diaria: 5,
          tendencia: 'estable',
          observacion: 'ok',
          desvio_demanda: 1.5,
          zona_precio: 'SOBRE_MAX',
          indice_precio: 120,
          revision_precio: true,
        },
      },
      hashPorProducto: { 1: 'hash-fake' },
      decisionPorProducto: { 1: { cantidad: 30, monto_total: 300, requiere_aprobacion: true } },
    };
    const { decisionPorProducto } = await generarAnalisis(state);
    expect(decisionPorProducto[1].analisis_ia).toBe('Justificación cacheada.');
    const [, , analisisConsultado] = cacheFns.buscarJustificacion.mock.calls[0];
    expect(analisisConsultado).toEqual({
      demanda_diaria: 5,
      tendencia: 'estable',
      observacion: 'ok',
    });
  });
});
