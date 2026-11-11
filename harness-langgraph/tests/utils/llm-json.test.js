/**
 * parseJsonArrayResponse — el código más delicado de SPEC-16:
 * localiza el array de items en las 3 formas reales que devuelve
 * Ollama con format:'json' (desnudo, objeto-envuelto, suelto) y
 * tolera degradación sin corromper datos (SPEC-16, review PR#18).
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { parseJsonArrayResponse } from '../../src/utils/llm-json.js';

const schemaItem = z.object({
  producto_id: z.coerce.number(),
  demanda_diaria: z.number().nonnegative(),
  tendencia: z.enum(['subiendo', 'estable', 'bajando']),
});

const item = (id) => ({ producto_id: id, demanda_diaria: 3, tendencia: 'estable' });

describe('parseJsonArrayResponse (SPEC-16)', () => {
  it('array desnudo: devuelve todos los items válidos', () => {
    const { items, invalidos } = parseJsonArrayResponse(JSON.stringify([item(1), item(2)]), schemaItem);
    expect(items).toHaveLength(2);
    expect(invalidos).toBe(0);
  });

  it('objeto con "resultados": extrae el array de la key preferida', () => {
    const { items } = parseJsonArrayResponse(
      JSON.stringify({ resultados: [item(1), item(2)] }),
      schemaItem,
    );
    expect(items.map((i) => i.producto_id)).toEqual([1, 2]);
  });

  it('prefiere "resultados" aunque el objeto tenga otra propiedad array', () => {
    // el modelo podría agregar metadata en array — no debe elegirse
    // por sobre la key que pide el prompt
    const { items } = parseJsonArrayResponse(
      JSON.stringify({ meta: [1, 2, 3], resultados: [item(1)] }),
      schemaItem,
    );
    expect(items).toHaveLength(1);
    expect(items[0].producto_id).toBe(1);
  });

  it('objeto suelto de un item: se trata como array de 1', () => {
    const { items } = parseJsonArrayResponse(JSON.stringify(item(7)), schemaItem);
    expect(items).toHaveLength(1);
    expect(items[0].producto_id).toBe(7);
  });

  it('items inválidos no tiran el lote: se cuentan en invalidos', () => {
    const { items, invalidos } = parseJsonArrayResponse(
      JSON.stringify([item(1), { producto_id: 2, tendencia: '??' }, item(3)]),
      schemaItem,
    );
    expect(items.map((i) => i.producto_id)).toEqual([1, 3]);
    expect(invalidos).toBe(1);
  });

  it('JSON truncado: tira (→ el nodo reintenta / cae a individual)', () => {
    expect(() =>
      parseJsonArrayResponse('{"resultados": [{"producto_id": 1, "demanda_diaria": 3, "ten', schemaItem),
    ).toThrow();
  });

  it('texto sin ningún JSON: tira con mensaje descriptivo', () => {
    expect(() => parseJsonArrayResponse('no json at all', schemaItem)).toThrow(/no devolvió un array JSON/);
  });

  it('prosa + array embebido: lo rescata', () => {
    const { items } = parseJsonArrayResponse(
      `Acá está: [{"producto_id": 5, "demanda_diaria": 2, "tendencia": "bajando", "observacion": "ok"}] listo`,
      schemaItem,
    );
    expect(items).toHaveLength(1);
  });
});
