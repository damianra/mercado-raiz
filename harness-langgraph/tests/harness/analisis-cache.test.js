/**
 * Tests del cache incremental de análisis (SPEC-16, R16.1):
 *  - hashAnalisis: determinista y sensible a cada eje del input
 *  - buscarDemanda/buscarJustificacion: semántica del flag
 *    analisis_llm y la igualdad de análisis
 *  - persistencia: sobrevive a una importación fresca del módulo
 *
 * SPEC-25 (T25.3): el cache vive en la tabla `analisis_cache` de
 * Postgres. Los tests corren contra `mercadoraiz-db-test`
 * (DATABASE_URL_TEST / default) y truncan la tabla entre tests.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { poolPg, cerrarPg } from '../../src/harness/pg.js';
import * as cache from '../../src/harness/analisis-cache.js';

const producto = {
  id: 7,
  sku: 'SKU7',
  nombre: 'Fideos',
  stock_actual: 5,
  stock_minimo: 20,
  costo_unitario: 10,
  categoria: 'Almacén',
  proveedor: { nombre: 'Prov', tiempo_entrega_dias: 2 },
};
// Stats de /api/estadisticas/demanda (SPEC-26) — el input del hash.
const stats = {
  demanda_diaria: 5.2,
  tendencia: 0.01,
  cv: 0.4,
  desvio_demanda: 2.1,
  dias_con_venta: 60,
  dias_en_quiebre: 0,
  ultima_venta: '2026-11-20',
};
const analisis = { demanda_diaria: 6, tendencia: 'subiendo', observacion: 'ok' };

beforeEach(async () => {
  // La tabla la crea el módulo al primer uso (ensureTabla); este
  // insert+delete la fuerza y la deja limpia para cada test.
  await cache.guardarDemanda(7, 'setup', analisis);
  await poolPg().query('TRUNCATE analisis_cache');
});

afterAll(async () => {
  await poolPg().query('DROP TABLE IF EXISTS analisis_cache').catch(() => {});
  await cerrarPg();
});

describe('hashAnalisis', () => {
  it('es determinista para el mismo input', () => {
    expect(cache.hashAnalisis(producto, stats)).toBe(cache.hashAnalisis(producto, stats));
  });

  it('cambia si cambian las stats de demanda', () => {
    const otras = { ...stats, demanda_diaria: 7.8 };
    expect(cache.hashAnalisis(producto, otras)).not.toBe(cache.hashAnalisis(producto, stats));
  });

  it('cambia si cambia un campo del producto (un AJUSTE no toca stats)', () => {
    const ajustado = { ...producto, stock_actual: 8 };
    expect(cache.hashAnalisis(ajustado, stats)).not.toBe(cache.hashAnalisis(producto, stats));
  });

  it('cambia si cambia el precio o el lead time (cantidad/monto → justificación)', () => {
    expect(cache.hashAnalisis({ ...producto, costo_unitario: 12 }, stats))
      .not.toBe(cache.hashAnalisis(producto, stats));
    const otroProveedor = { ...producto, proveedor: { ...producto.proveedor, tiempo_entrega_dias: 5 } };
    expect(cache.hashAnalisis(otroProveedor, stats)).not.toBe(cache.hashAnalisis(producto, stats));
  });
});

describe('buscar/guardar demanda', () => {
  it('miss sin entrada; hit tras guardarDemanda', async () => {
    const hash = cache.hashAnalisis(producto, stats);
    expect(await cache.buscarDemanda(7, hash)).toBeNull();
    await cache.guardarDemanda(7, hash, analisis);
    expect(await cache.buscarDemanda(7, hash)).toEqual(analisis);
  });

  it('miss si el hash cambió (invalidación por input)', async () => {
    const hash = cache.hashAnalisis(producto, stats);
    await cache.guardarDemanda(7, hash, analisis);
    const otro = cache.hashAnalisis({ ...producto, stock_actual: 9 }, stats);
    expect(await cache.buscarDemanda(7, otro)).toBeNull();
  });

  it('guardarDemanda marca analisis_llm — una justificación sola no habilita demanda', async () => {
    const hash = cache.hashAnalisis(producto, stats);
    // justificación guardada sobre análisis heurístico (LLM de
    // demanda había fallado): la demanda NO queda cacheada.
    await cache.guardarJustificacion(7, hash, analisis, 'prosa sobre fallback');
    expect(await cache.buscarDemanda(7, hash)).toBeNull();
  });
});

describe('buscar/guardar justificación', () => {
  it('hit solo con mismo hash Y mismo análisis (la prosa cita sus cifras)', async () => {
    const hash = cache.hashAnalisis(producto, stats);
    await cache.guardarDemanda(7, hash, analisis);
    await cache.guardarJustificacion(7, hash, analisis, 'justificación X');

    expect(await cache.buscarJustificacion(7, hash, analisis)).toBe('justificación X');
    // mismo hash pero otro análisis (el LLM respondió distinto) → miss
    expect(await cache.buscarJustificacion(7, hash, { ...analisis, demanda_diaria: 9 })).toBeNull();
  });

  it('guardarDemanda invalida la justificación previa (input nuevo)', async () => {
    const hash = cache.hashAnalisis(producto, stats);
    await cache.guardarDemanda(7, hash, analisis);
    await cache.guardarJustificacion(7, hash, analisis, 'vieja');
    await cache.guardarDemanda(7, hash, { ...analisis, tendencia: 'bajando' });
    expect(await cache.buscarJustificacion(7, hash, analisis)).toBeNull();
  });
});

describe('persistencia', () => {
  it('sobrevive a una importación fresca del módulo (tabla, no memoria)', async () => {
    const hash = cache.hashAnalisis(producto, stats);
    await cache.guardarDemanda(7, hash, analisis);

    vi.resetModules();
    const cache2 = await import('../../src/harness/analisis-cache.js');
    const pg2 = await import('../../src/harness/pg.js');
    try {
      expect(await cache2.buscarDemanda(7, hash)).toEqual(analisis);
    } finally {
      await pg2.cerrarPg(); // pool del módulo fresco — no dejarlo colgado
    }
  });

  it('los datos del análisis se guardan como JSONB (roundtrip de objetos)', async () => {
    const hash = cache.hashAnalisis(producto, stats);
    const anidado = { ...analisis, detalle: { dias: [1, 2], ok: true } };
    await cache.guardarDemanda(7, hash, anidado);
    const { rows } = await poolPg().query(
      'SELECT analisis FROM analisis_cache WHERE producto_id = 7',
    );
    expect(rows[0].analisis).toEqual(anidado);
  });
});
