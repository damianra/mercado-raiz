// @vitest-environment node
// Tests de POST /api/ordenes/batch (SPEC-16): todo-o-nada en una
// transacción, detalle por índice en el 400, secuencia OC-NNN
// continua. DB :memory: propia del archivo — seed completo.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { openDb } from './db.js';
import { seedData } from './seed-data.js';

let server;
let base;
const db = openDb(':memory:');

beforeEach(async () => {
  const app = await createApp();
  server = app.listen(0);
  base = `http://localhost:${server.address().port}`;
});

afterEach(() => server?.close());

const post = (body) =>
  fetch(`${base}/api/ordenes/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const PRODUCTO = seedData.productos[0].id;
const ORDENES_SEED = seedData.ordenes_compra.length;
const totalOrdenes = () =>
  db.prepare('SELECT COUNT(*) AS c FROM ordenes_compra').get().c;

describe('POST /api/ordenes/batch', () => {
  it('crea N órdenes en una transacción con OC-NNN secuenciales', async () => {
    const antes = totalOrdenes();
    const res = await post([
      { producto_id: PRODUCTO, cantidad: 5, requiere_aprobacion: false, analisis_ia: 't' },
      { producto_id: PRODUCTO, cantidad: 8, requiere_aprobacion: true },
      { producto_id: PRODUCTO, cantidad: 3 },
    ]);

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data).toHaveLength(3);
    // ids secuenciales y estados derivados como en POST individual
    const ids = body.data.map((o) => o.orden_id);
    expect(ids[1].slice(3)).toBe(String(Number(ids[0].slice(3)) + 1).padStart(3, '0'));
    expect(ids[2].slice(3)).toBe(String(Number(ids[0].slice(3)) + 2).padStart(3, '0'));
    expect(body.data[0].estado).toBe('APROBADA');
    expect(body.data[1].estado).toBe('PENDIENTE_APROBACION');
    // sin flag, el monto decide (>= UMBRAL_APROBACION → pendiente)
    const monto3 = body.data[2].monto_total;
    expect(body.data[2].estado).toBe(monto3 >= 100 ? 'PENDIENTE_APROBACION' : 'APROBADA');
    expect(totalOrdenes()).toBe(antes + 3);
  });

  it('item inválido → 400 con detalle por índice, cero persistidas', async () => {
    const antes = totalOrdenes();
    const res = await post([
      { producto_id: PRODUCTO, cantidad: 5 },
      { producto_id: PRODUCTO, cantidad: 0 }, // inválida
      { producto_id: PRODUCTO, cantidad: 9 },
    ]);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.detalle).toHaveLength(1);
    expect(body.detalle[0].indice).toBe(1);
    expect(totalOrdenes()).toBe(antes); // all-or-nothing
  });

  it('producto inexistente → 400 con detalle, cero persistidas', async () => {
    const antes = totalOrdenes();
    const res = await post([
      { producto_id: PRODUCTO, cantidad: 5 },
      { producto_id: 999999, cantidad: 3 },
    ]);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.detalle).toEqual([
      { indice: 1, producto_id: 999999, error: 'producto no encontrado' },
    ]);
    expect(totalOrdenes()).toBe(antes);
  });

  it('rechaza body no-array, array vacío y lote > 200', async () => {
    const antes = totalOrdenes();
    expect((await post({ producto_id: PRODUCTO, cantidad: 1 })).status).toBe(400);
    expect((await post([])).status).toBe(400);
    const gigante = Array.from({ length: 201 }, () => ({ producto_id: PRODUCTO, cantidad: 1 }));
    expect((await post(gigante)).status).toBe(400);
    expect(totalOrdenes()).toBe(antes);
  });
});
