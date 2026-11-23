/**
 * T26.8 — POST /run {limite: N}: leer-inventario recorta el lote
 * tras el fetch (la API no tiene muestreo) conservando el orden
 * del catálogo. Sin limite devuelve todo.
 */
import { describe, expect, it, vi } from 'vitest';

const listar = vi.fn();
vi.mock('../../src/integrations/productos.client.js', () => ({
  listarProductosAReponer: (...a) => listar(...a),
}));

const { leerInventario } = await import(
  '../../src/langgraph/nodes/leer-inventario.js'
);

const productos = (n) =>
  Array.from({ length: n }, (_, i) => ({ id: i + 1, sku: `SKU${i + 1}`, nombre: `P${i + 1}` }));

describe('leer-inventario — limite (T26.8)', () => {
  it('sin limite devuelve el lote completo', async () => {
    listar.mockResolvedValue(productos(5));
    const { productosBajos } = await leerInventario({});
    expect(productosBajos).toHaveLength(5);
  });

  it('limite recorta conservando el orden', async () => {
    listar.mockResolvedValue(productos(150));
    const { productosBajos } = await leerInventario({ limite: 100 });
    expect(productosBajos).toHaveLength(100);
    expect(productosBajos[0].id).toBe(1);
    expect(productosBajos.at(-1).id).toBe(100);
  });

  it('limite mayor que el lote no infla nada', async () => {
    listar.mockResolvedValue(productos(10));
    const { productosBajos } = await leerInventario({ limite: 100 });
    expect(productosBajos).toHaveLength(10);
  });

  it('limite inválido se ignora', async () => {
    listar.mockResolvedValue(productos(5));
    for (const limite of [0, -3, 'abc', null]) {
      const { productosBajos } = await leerInventario({ limite });
      expect(productosBajos).toHaveLength(5);
    }
  });
});
