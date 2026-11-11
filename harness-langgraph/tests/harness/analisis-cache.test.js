/**
 * Tests del cache incremental de análisis (SPEC-16, R16.1):
 *  - hashAnalisis: determinista y sensible a cada eje del input
 *  - buscarDemanda/buscarJustificacion: semántica del flag
 *    analisis_llm y la igualdad de análisis
 *  - persistencia: roundtrip al archivo + archivo corrupto → {}
 * El archivo real queda afuera: ANALISIS_CACHE_PATH apunta a un
 * tmp por test.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let dir;
let archivo;
let cache;

const producto = {
  id: 7,
  sku: 'SKU7',
  nombre: 'Fideos',
  stock_actual: 5,
  stock_minimo: 20,
  precio_unitario: 10,
  categoria: 'Almacén',
  proveedor: { nombre: 'Prov', tiempo_entrega_dias: 2 },
};
const ventas = [
  { fecha: '2026-11-01', diferencia: -5 },
  { fecha: '2026-11-02', diferencia: -9 },
];
const analisis = { demanda_diaria: 6, tendencia: 'subiendo', observacion: 'ok' };

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'analisis-cache-'));
  archivo = join(dir, 'cache.json');
  vi.stubEnv('ANALISIS_CACHE_PATH', archivo);
  vi.resetModules();
  cache = await import('../../src/harness/analisis-cache.js');
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe('hashAnalisis', () => {
  it('es determinista para el mismo input', () => {
    expect(cache.hashAnalisis(producto, ventas)).toBe(cache.hashAnalisis(producto, ventas));
  });

  it('cambia si cambian las ventas', () => {
    const otras = [...ventas, { fecha: '2026-11-03', diferencia: -3 }];
    expect(cache.hashAnalisis(producto, otras)).not.toBe(cache.hashAnalisis(producto, ventas));
  });

  it('cambia si cambia un campo del producto (un AJUSTE no toca ventas)', () => {
    const ajustado = { ...producto, stock_actual: 8 };
    expect(cache.hashAnalisis(ajustado, ventas)).not.toBe(cache.hashAnalisis(producto, ventas));
  });

  it('cambia si cambia el precio o el lead time (cantidad/monto → justificación)', () => {
    expect(cache.hashAnalisis({ ...producto, precio_unitario: 12 }, ventas))
      .not.toBe(cache.hashAnalisis(producto, ventas));
    const otroProveedor = { ...producto, proveedor: { ...producto.proveedor, tiempo_entrega_dias: 5 } };
    expect(cache.hashAnalisis(otroProveedor, ventas)).not.toBe(cache.hashAnalisis(producto, ventas));
  });
});

describe('buscar/guardar demanda', () => {
  it('miss sin entrada; hit tras guardarDemanda', () => {
    const hash = cache.hashAnalisis(producto, ventas);
    expect(cache.buscarDemanda(7, hash)).toBeNull();
    cache.guardarDemanda(7, hash, analisis);
    expect(cache.buscarDemanda(7, hash)).toEqual(analisis);
  });

  it('miss si el hash cambió (invalidación por input)', () => {
    const hash = cache.hashAnalisis(producto, ventas);
    cache.guardarDemanda(7, hash, analisis);
    const otro = cache.hashAnalisis({ ...producto, stock_actual: 9 }, ventas);
    expect(cache.buscarDemanda(7, otro)).toBeNull();
  });

  it('guardarDemanda marca analisis_llm — una justificación sola no habilita demanda', () => {
    const hash = cache.hashAnalisis(producto, ventas);
    // justificación guardada sobre análisis heurístico (LLM de
    // demanda había fallado): la demanda NO queda cacheada.
    cache.guardarJustificacion(7, hash, analisis, 'prosa sobre fallback');
    expect(cache.buscarDemanda(7, hash)).toBeNull();
  });
});

describe('buscar/guardar justificación', () => {
  it('hit solo con mismo hash Y mismo análisis (la prosa cita sus cifras)', () => {
    const hash = cache.hashAnalisis(producto, ventas);
    cache.guardarDemanda(7, hash, analisis);
    cache.guardarJustificacion(7, hash, analisis, 'justificación X');

    expect(cache.buscarJustificacion(7, hash, analisis)).toBe('justificación X');
    // mismo hash pero otro análisis (el LLM respondió distinto) → miss
    expect(cache.buscarJustificacion(7, hash, { ...analisis, demanda_diaria: 9 })).toBeNull();
  });

  it('guardarDemanda invalida la justificación previa (input nuevo)', () => {
    const hash = cache.hashAnalisis(producto, ventas);
    cache.guardarDemanda(7, hash, analisis);
    cache.guardarJustificacion(7, hash, analisis, 'vieja');
    cache.guardarDemanda(7, hash, { ...analisis, tendencia: 'bajando' });
    expect(cache.buscarJustificacion(7, hash, analisis)).toBeNull();
  });
});

describe('persistencia', () => {
  it('persiste al archivo y lo relee en una importación fresca', async () => {
    const hash = cache.hashAnalisis(producto, ventas);
    cache.guardarDemanda(7, hash, analisis);

    vi.resetModules();
    const cache2 = await import('../../src/harness/analisis-cache.js');
    expect(cache2.buscarDemanda(7, hash)).toEqual(analisis);
  });

  it('archivo corrupto → cache vacío, no tira', async () => {
    writeFileSync(archivo, '{no-json!!');
    vi.resetModules();
    const cache2 = await import('../../src/harness/analisis-cache.js');
    const hash = cache2.hashAnalisis(producto, ventas);
    expect(cache2.buscarDemanda(7, hash)).toBeNull();
  });
});
