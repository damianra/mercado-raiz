// @vitest-environment node
// Tests de POST /api/ordenes/batch (SPEC-16): todo-o-nada en una
// transacción, detalle por índice en el 400, secuencia OC-NNN
// continua. DB :memory: propia del archivo — seed completo.
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { closeDb, openDb } from './db.js';
import { seedData } from './seed-data.js';
import { UMBRAL_APROBACION } from './models/ordenes.model.js';
import { loginComo } from './test-auth.js';

let server;
let base;
let sesion;
const db = await openDb({ searchPath: 't_batch' });

beforeEach(async () => {
  const app = await createApp();
  server = app.listen(0);
  base = `http://localhost:${server.address().port}`;
  // SERVICIO: la cuenta del agente también crea órdenes (SPEC-23).
  sesion ??= await loginComo(base, 'SERVICIO');
});

afterEach(() => server?.close());
afterAll(() => closeDb(true));

const post = (body) =>
  fetch(`${base}/api/ordenes/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...sesion.headers },
    body: JSON.stringify(body),
  });

const PRODUCTO = seedData.productos[0].id;
const ORDENES_SEED = seedData.ordenes_compra.length;
const totalOrdenes = async () =>
  (await db.prepare('SELECT COUNT(*) AS c FROM ordenes_compra').get()).c;

describe('POST /api/ordenes/batch', () => {
  it('crea N órdenes en una transacción con OC-NNN secuenciales', async () => {
    const antes = await totalOrdenes();
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
    expect(body.data[2].estado).toBe(
      monto3 >= UMBRAL_APROBACION ? 'PENDIENTE_APROBACION' : 'APROBADA',
    );
    expect(await totalOrdenes()).toBe(antes + 3);
  });

  it('item inválido → 400 con detalle por índice, cero persistidas', async () => {
    const antes = await totalOrdenes();
    const res = await post([
      { producto_id: PRODUCTO, cantidad: 5 },
      { producto_id: PRODUCTO, cantidad: 0 }, // inválida
      { producto_id: PRODUCTO, cantidad: 9 },
    ]);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.detalle).toHaveLength(1);
    expect(body.detalle[0].indice).toBe(1);
    expect(await totalOrdenes()).toBe(antes); // all-or-nothing
  });

  it('producto inexistente → 400 con detalle, cero persistidas', async () => {
    const antes = await totalOrdenes();
    const res = await post([
      { producto_id: PRODUCTO, cantidad: 5 },
      { producto_id: 999999, cantidad: 3 },
    ]);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.detalle).toEqual([
      { indice: 1, producto_id: 999999, error: 'producto no encontrado' },
    ]);
    expect(await totalOrdenes()).toBe(antes);
  });

  it('proveedor sin precio para el producto → 400, cero persistidas (SPEC-27)', async () => {
    const antes = await totalOrdenes();
    const res = await post([
      { producto_id: PRODUCTO, cantidad: 5 },
      { producto_id: PRODUCTO, proveedor_id: 3, cantidad: 3 }, // no vende prod 1
    ]);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/sin precio/);
    expect(body.detalle[0].indice).toBe(1);
    expect(await totalOrdenes()).toBe(antes);
  });

  it('lote con proveedor alternativo válido crea con su costo y proveedor', async () => {
    const conAlt = seedData.producto_proveedor.find(
      (pp) => pp.proveedor_id === 8 && pp.es_principal === 0,
    );
    const res = await post([
      { producto_id: conAlt.producto_id, proveedor_id: 8, cantidad: 2 },
    ]);
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data[0].proveedor.id).toBe(8);
    expect(data[0].precio_unitario).toBeCloseTo(conAlt.costo_unitario, 2);
  });

  it('rechaza body no-array, array vacío y lote > 200', async () => {
    const antes = await totalOrdenes();
    expect((await post({ producto_id: PRODUCTO, cantidad: 1 })).status).toBe(400);
    expect((await post([])).status).toBe(400);
    const gigante = Array.from({ length: 201 }, () => ({ producto_id: PRODUCTO, cantidad: 1 }));
    expect((await post(gigante)).status).toBe(400);
    expect(await totalOrdenes()).toBe(antes);
  });
});
