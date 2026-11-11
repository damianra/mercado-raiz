/**
 * Tests del nodo crear-orden (SPEC-16, R16.4):
 *  - lote batch exitoso → una sola request, cero llamadas
 *    individuales, ordenesCreadas/Pendientes correctos
 *  - lote que falla → fallback a crearOrden por producto
 *    (los válidos se crean, los rotos registran error por SKU)
 * El backend se mockea — los tests no tocan la API.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const postBatch = vi.fn();
const postUno = vi.fn();
vi.mock('../../src/integrations/ordenes.client.js', () => ({
  crearOrdenesBatch: (...a) => postBatch(...a),
  crearOrden: (...a) => postUno(...a),
}));

const { crearOrdenes } = await import('../../src/langgraph/nodes/crear-orden.js');

const producto = (id) => ({ id, sku: `SKU${id}`, nombre: `Producto ${id}` });
const decision = (requiere) => ({
  cantidad: 10,
  monto_total: requiere ? 500 : 50,
  requiere_aprobacion: requiere,
  analisis_ia: 'texto',
});

// api.post devuelve el body parseado — data es el payload.
const ordenCreada = (id, estado) => ({
  orden_id: `OC-0${id}`,
  estado,
  cantidad: 10,
  producto: { id },
});

const stateDe = (items) => ({
  productosBajos: items.map(([id]) => producto(id)),
  decisionPorProducto: Object.fromEntries(
    items.map(([id, req]) => [id, decision(req)]),
  ),
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('crear-orden — persistencia en lote (SPEC-16)', () => {
  it('lote exitoso: una request batch, cero individuales', async () => {
    postBatch.mockResolvedValue({
      data: [ordenCreada(1, 'PENDIENTE_APROBACION'), ordenCreada(2, 'APROBADA')],
    });

    const { ordenesCreadas, ordenesPendientes, errores } = await crearOrdenes(
      stateDe([[1, true], [2, false]]),
    );

    expect(postBatch).toHaveBeenCalledTimes(1);
    expect(postBatch.mock.calls[0][0]).toEqual([
      { producto_id: 1, cantidad: 10, requiere_aprobacion: true, analisis_ia: 'texto' },
      { producto_id: 2, cantidad: 10, requiere_aprobacion: false, analisis_ia: 'texto' },
    ]);
    expect(postUno).not.toHaveBeenCalled(); // nada cayó a individual
    expect(ordenesCreadas.map((o) => o.orden_id)).toEqual(['OC-01', 'OC-02']);
    expect(ordenesPendientes).toEqual(['OC-01']); // solo la PENDIENTE_APROBACION
    expect(errores).toEqual([]);
  });

  it('lote que falla: fallback individual por producto', async () => {
    postBatch.mockRejectedValue(new Error('HTTP 400 items inválidos'));
    postUno
      .mockResolvedValueOnce({ data: ordenCreada(1, 'APROBADA') })
      .mockRejectedValueOnce(new Error('HTTP 400 cantidad inválida'));

    const { ordenesCreadas, errores } = await crearOrdenes(
      stateDe([[1, false], [2, false]]),
    );

    expect(postUno).toHaveBeenCalledTimes(2); // una por producto
    expect(ordenesCreadas.map((o) => o.orden_id)).toEqual(['OC-01']);
    // el error del lote + el del producto que falló individual
    expect(errores).toHaveLength(2);
    expect(errores[1]).toContain('SKU2');
  });
});
