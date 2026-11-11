/**
 * Tests de la paginación de listarProductosAReponer (SPEC-14):
 *  - itera todas las páginas cuando el envelope trae totalPages > 1
 *  - devuelve data tal cual si el envelope no trae pagination
 *  - dedup por id en el merge de estados (defensivo)
 *  - propaga el error si una página intermedia falla
 *
 * api.get se mockea — no se toca el backend real.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiGet = vi.fn();
vi.mock('../../src/integrations/backend-client.js', () => ({
  api: { get: (...a) => apiGet(...a) },
}));

const { listarProductosAReponer } = await import(
  '../../src/integrations/productos.client.js'
);

const pagina = (items, total, limit = 100) => ({
  data: items,
  pagination: {
    page: 1,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  },
});

const productos = (prefijo, n) =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefijo}-${i + 1}` }));

beforeEach(() => {
  apiGet.mockReset();
});

describe('listarProductosAReponer — paginación', () => {
  it('una sola página por estado: no pide más (hoy)', async () => {
    apiGet.mockImplementation(async (path) =>
      path.includes('STOCK_BAJO')
        ? pagina(productos('b', 3), 3)
        : pagina(productos('c', 2), 2),
    );
    const res = await listarProductosAReponer();
    expect(res).toHaveLength(5);
    expect(apiGet).toHaveBeenCalledTimes(2);
  });

  it('totalPages > 1: itera todas las páginas del estado', async () => {
    apiGet.mockImplementation(async (path) => {
      if (path.includes('CRITICO')) return pagina([], 0);
      const page = Number(new URLSearchParams(path.split('?')[1]).get('page'));
      if (page === 1) return pagina(productos('a', 100), 250);
      if (page === 2) return pagina(productos('b', 100), 250);
      return pagina(productos('c', 50), 250);
    });
    const res = await listarProductosAReponer();
    expect(res).toHaveLength(250);
    // page 1 + 2 fetches extra para STOCK_BAJO + 1 para CRITICO
    expect(apiGet).toHaveBeenCalledTimes(4);
    expect(res.map((p) => p.id)).toContain('c-50');
  });

  it('sin pagination en el envelope: devuelve data como fallback', async () => {
    apiGet.mockImplementation(async (path) => ({
      data: productos(path.includes('STOCK_BAJO') ? 'b' : 'c', 2),
    }));
    const res = await listarProductosAReponer();
    expect(res).toHaveLength(4);
    expect(apiGet).toHaveBeenCalledTimes(2); // no itera sin totalPages
  });

  it('dedup: un id repetido entre estados entra una sola vez', async () => {
    apiGet.mockImplementation(async (path) =>
      pagina(
        path.includes('STOCK_BAJO')
          ? [{ id: 'x' }, { id: 'y' }]
          : [{ id: 'y' }, { id: 'z' }],
        2,
      ),
    );
    const res = await listarProductosAReponer();
    expect(res.map((p) => p.id)).toEqual(['x', 'y', 'z']);
  });

  it('propaga el error si una página intermedia falla', async () => {
    apiGet.mockImplementation(async (path) => {
      if (path.includes('CRITICO')) return pagina([], 0);
      const page = Number(new URLSearchParams(path.split('?')[1]).get('page'));
      if (page === 2) throw new Error('HTTP 500');
      return pagina(productos('a', 100), 200);
    });
    await expect(listarProductosAReponer()).rejects.toThrow('HTTP 500');
  });
});
