/**
 * Tests del worker pool conLimite (SPEC-16, R16.2):
 *  - nunca supera `limite` tareas en vuelo
 *  - preserva el orden de los resultados
 *  - aborta al primer error (items posteriores no arrancan)
 */
import { describe, expect, it, vi } from 'vitest';
import { conLimite } from '../../src/utils/concurrencia.js';

const items = (n) => Array.from({ length: n }, (_, i) => i);

describe('conLimite', () => {
  it('respeta el límite de tareas en vuelo', async () => {
    let enVuelo = 0;
    let maxVuelo = 0;
    const tarea = async (i) => {
      enVuelo += 1;
      maxVuelo = Math.max(maxVuelo, enVuelo);
      await new Promise((r) => setTimeout(r, 5));
      enVuelo -= 1;
      return i;
    };

    await conLimite(items(12), 3, tarea);
    expect(maxVuelo).toBe(3);
  });

  it('devuelve los resultados en el orden de los items', async () => {
    // los últimos resuelven primero — el orden igual se preserva
    const res = await conLimite(items(8), 8, async (i) => {
      await new Promise((r) => setTimeout(r, (8 - i) * 2));
      return i * 10;
    });
    expect(res).toEqual([0, 10, 20, 30, 40, 50, 60, 70]);
  });

  it('aborta al primer error como el for secuencial', async () => {
    const procesados = [];
    const tarea = vi.fn(async (i) => {
      procesados.push(i);
      if (i === 1) throw new Error('boom'); // falla inmediata
      await new Promise((r) => setTimeout(r, 10));
      return i;
    });

    await expect(conLimite(items(10), 2, tarea)).rejects.toThrow('boom');
    // con límite 2 se tomaron los índices 0 y 1 antes del fallo;
    // tras el rechazo ningún item posterior arrancó
    expect(procesados).toEqual([0, 1]);
  });

  it('límite mayor que los items arranca un worker por item', async () => {
    let maxVuelo = 0;
    let enVuelo = 0;
    await conLimite(items(4), 50, async (i) => {
      enVuelo += 1;
      maxVuelo = Math.max(maxVuelo, enVuelo);
      await new Promise((r) => setTimeout(r, 5));
      enVuelo -= 1;
      return i;
    });
    expect(maxVuelo).toBe(4);
  });

  it('lista vacía resuelve a array vacío', async () => {
    expect(await conLimite([], 3, vi.fn())).toEqual([]);
  });
});
