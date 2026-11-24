// @vitest-environment node
// Tests de movimientos de stock (SPEC-30 T30.2):
// POST /api/ventas — descuenta stock + historial VENTA en la misma
// tx (stock negativo permitido: la venta es hecho físico).
// POST /api/stock/ajuste — merma/rotura (delta) o conteo físico
// (cantidad_nueva) con motivo estructurado → historial AJUSTE.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { closeDb, openDb } from './db.js';
import { estadoProducto } from './models/productos.model.js';
import { seedData } from './seed-data.js';
import { loginComo } from './test-auth.js';

let server;
let base;
let gerente;
let aprobador;
let buyer;
const db = await openDb({ searchPath: 't_stock' });

beforeEach(async () => {
  const app = await createApp();
  server = app.listen(0);
  base = `http://localhost:${server.address().port}`;
  gerente ??= await loginComo(base, 'GERENTE');
  aprobador ??= await loginComo(base, 'APROBADOR');
  buyer ??= await loginComo(base, 'BUYER');
});

afterEach(() => server?.close());
afterAll(() => closeDb(true));

const post = (path, body, sesion = gerente) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...sesion.headers },
    body: JSON.stringify(body ?? {}),
  });

const vender = (p, body, sesion) =>
  post('/api/ventas', { producto_id: p.id, canal: 'POS', ...body }, sesion);
const ajustar = (p, body, sesion) =>
  post('/api/stock/ajuste', { producto_id: p.id, ...body }, sesion);

const stockDe = (id) =>
  db.prepare('SELECT stock_actual FROM productos WHERE id = ?').get(id);

const movimientosDe = (id) =>
  db
    .prepare(
      `SELECT * FROM historial_stock WHERE producto_id = ? ORDER BY id DESC`,
    )
    .all(id);

// Cada test usa un producto distinto — comparten el schema.
const P = (i) => seedData.productos[i];

describe('POST /api/ventas', () => {
  it('201: descuenta stock, crea la venta y el historial VENTA en la misma tx', async () => {
    const p = P(0);
    const { stock_actual: antes } = await stockDe(p.id);
    const res = await vender(p, { unidades: 3, fecha: '2026-01-15' });
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.data).toMatchObject({
      stock_anterior: antes,
      stock_nuevo: antes - 3,
    });
    expect(await stockDe(p.id)).toMatchObject({ stock_actual: antes - 3 });
    const venta = await db
      .prepare('SELECT * FROM ventas WHERE id = ?')
      .get(body.data.venta_id);
    expect(venta).toMatchObject({
      producto_id: p.id,
      unidades: 3,
      canal: 'POS',
      fecha: expect.anything(),
    });
    const [mov] = await movimientosDe(p.id);
    expect(mov).toMatchObject({
      tipo_movimiento: 'VENTA',
      cantidad_anterior: antes,
      cantidad_nueva: antes - 3,
      diferencia: -3,
      usuario: 'carlos.martinez@mercadorai.com',
      referencia: `VTA-${body.data.venta_id}`,
    });
  });

  it('permite stock negativo — la venta es hecho físico, la divergencia se corrige con conteo', async () => {
    const p = P(1);
    const { stock_actual: antes } = await stockDe(p.id);
    const res = await vender(p, { unidades: antes + 5 });
    expect(res.status).toBe(201);
    expect(await stockDe(p.id)).toMatchObject({ stock_actual: -5 });
  });

  it('acepta referencia del POS y la propaga al historial', async () => {
    const p = P(2);
    const res = await vender(p, { unidades: 1, referencia: 'POS-9999' });
    expect(res.status).toBe(201);
    const [mov] = await movimientosDe(p.id);
    expect(mov.referencia).toBe('POS-9999');
  });

  it('dos ventas concurrentes descuentan ambas (FOR UPDATE serializa — sin lost update)', async () => {
    const p = P(3);
    const { stock_actual: antes } = await stockDe(p.id);
    const [r1, r2] = await Promise.all([vender(p, { unidades: 2 }), vender(p, { unidades: 4 })]);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(await stockDe(p.id)).toMatchObject({ stock_actual: antes - 6 });
  });

  it.each([
    [{ unidades: 0 }, 'unidades'],
    [{ unidades: 'abc' }, 'unidades'],
    [{ unidades: '3' }, 'unidades string — sin coercion'],
    [{ unidades: true }, 'unidades boolean — Number(true)=1'],
    [{ unidades: 1, canal: 'MAIL' }, 'canal'],
    [{ unidades: 1, fecha: '2026-99-99' }, 'fecha'],
    [{ producto_id: -1, unidades: 1 }, 'producto_id'],
  ])('400 en payload inválido: %s', async (extra) => {
    const res = await vender(P(4), extra);
    expect(res.status).toBe(400);
  });

  it('404 producto inexistente', async () => {
    const res = await vender({ id: 999999 }, { unidades: 1 });
    expect(res.status).toBe(404);
  });

  it('403 para BUYER (lockdown)', async () => {
    const res = await vender(P(5), { unidades: 1 }, buyer);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/ventas/batch', () => {
  const venderLote = (items, sesion) => post('/api/ventas/batch', items, sesion);

  it('201: aplica todas las ventas del lote en una tx', async () => {
    const p1 = P(6);
    const p2 = P(7);
    const [a1, a2] = await Promise.all([stockDe(p1.id), stockDe(p2.id)]);
    const res = await venderLote([
      { producto_id: p1.id, unidades: 2, canal: 'POS' },
      { producto_id: p2.id, unidades: 5, canal: 'WEB' },
    ]);
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.data).toHaveLength(2);
    expect(await stockDe(p1.id)).toMatchObject({ stock_actual: a1.stock_actual - 2 });
    expect(await stockDe(p2.id)).toMatchObject({ stock_actual: a2.stock_actual - 5 });
    expect(body.data[0]).toMatchObject({ stock_anterior: a1.stock_actual });
    expect(body.data[1]).toMatchObject({ stock_anterior: a2.stock_actual });
  });

  it('400 con faltante por índice → no se persiste nada', async () => {
    const p = P(8);
    const { stock_actual: antes } = await stockDe(p.id);
    const res = await venderLote([
      { producto_id: p.id, unidades: 2, canal: 'POS' },
      { producto_id: 999999, unidades: 1, canal: 'POS' },
    ]);
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.detalle).toMatchObject([{ indice: 1, producto_id: 999999 }]);
    // todo-o-nada: ni el stock ni la venta del primer item quedaron
    expect(await stockDe(p.id)).toMatchObject({ stock_actual: antes });
    const { c } = await db
      .prepare(`SELECT COUNT(*) AS c FROM ventas WHERE producto_id = ?`)
      .get(p.id);
    expect(c).toBe(0);
  });

  it('mismo producto repetido en el lote descuenta acumulado y la cadena queda continua', async () => {
    const p = P(20);
    const { stock_actual: antes } = await stockDe(p.id);
    const res = await venderLote([
      { producto_id: p.id, unidades: 2, canal: 'POS' },
      { producto_id: p.id, unidades: 3, canal: 'POS' },
    ]);
    const body = await res.json();
    expect(res.status).toBe(201);
    // sin re-leer dentro del lock: el 2do item vería el stock viejo
    // y escribiría antes-3 (lost update) — quedan antes-5.
    expect(await stockDe(p.id)).toMatchObject({ stock_actual: antes - 5 });
    expect(body.data[0].stock_anterior).toBe(antes);
    expect(body.data[1].stock_anterior).toBe(antes - 2);
    const [m2, m1] = await movimientosDe(p.id);
    expect(m1.cantidad_nueva).toBe(antes - 2);
    expect(m2.cantidad_anterior).toBe(antes - 2);
    expect(m2.cantidad_nueva).toBe(antes - 5);
  });

  it('400 con item de forma inválida → detalle por índice', async () => {
    const res = await venderLote([
      { producto_id: P(9).id, unidades: 1, canal: 'POS' },
      { producto_id: P(9).id, unidades: 0, canal: 'POS' },
    ]);
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.detalle[0].indice).toBe(1);
  });
});

describe('POST /api/stock/ajuste', () => {
  it('201 conteo: cantidad_nueva fija el stock absoluto + motivo en historial', async () => {
    const p = P(10);
    const { stock_actual: antes } = await stockDe(p.id);
    const res = await ajustar(p, {
      motivo: 'CONTEO',
      cantidad_nueva: 37,
      referencia: 'conteo semanal góndola 4',
    });
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.data).toMatchObject({ stock_anterior: antes, stock_nuevo: 37 });
    expect(await stockDe(p.id)).toMatchObject({ stock_actual: 37 });
    const [mov] = await movimientosDe(p.id);
    expect(mov).toMatchObject({
      tipo_movimiento: 'AJUSTE',
      motivo: 'CONTEO',
      cantidad_anterior: antes,
      cantidad_nueva: 37,
      diferencia: 37 - antes,
      usuario: 'carlos.martinez@mercadorai.com',
    });
  });

  it('201 delta negativo (merma) descuenta', async () => {
    const p = P(11);
    const { stock_actual: antes } = await stockDe(p.id);
    const res = await ajustar(p, { motivo: 'MERMA', delta: -2 });
    expect(res.status).toBe(201);
    expect(await stockDe(p.id)).toMatchObject({ stock_actual: antes - 2 });
    const [mov] = await movimientosDe(p.id);
    expect(mov).toMatchObject({ motivo: 'MERMA', diferencia: -2 });
  });

  it('201 delta positivo (reposición manual) suma', async () => {
    const p = P(12);
    const { stock_actual: antes } = await stockDe(p.id);
    const res = await ajustar(p, { motivo: 'OTRO', delta: 10 });
    expect(res.status).toBe(201);
    expect(await stockDe(p.id)).toMatchObject({ stock_actual: antes + 10 });
  });

  it('400 si el delta dejaría stock negativo — corresponde un conteo', async () => {
    const p = P(13);
    const { stock_actual: antes } = await stockDe(p.id);
    const res = await ajustar(p, { motivo: 'ROTURA', delta: -(antes + 1) });
    expect(res.status).toBe(400);
    expect(await stockDe(p.id)).toMatchObject({ stock_actual: antes });
  });

  it.each([
    [{ motivo: 'CONTEO' }, 'sin cantidad'],
    [{ motivo: 'CONTEO', cantidad_nueva: 5, delta: -1 }, 'ambos modos'],
    [{ motivo: 'MAGIA', delta: -1 }, 'motivo'],
    [{ motivo: 'MERMA', delta: 0 }, 'delta 0'],
    [{ motivo: 'CONTEO', cantidad_nueva: -3 }, 'negativo'],
    [{ motivo: 'CONTEO', cantidad_nueva: '' }, 'string vacío — Number()→0'],
    [{ motivo: 'CONTEO', cantidad_nueva: '37' }, 'string — sin coercion'],
    [{ motivo: 'MERMA', delta: 3e9 }, 'fuera de int4'],
    [{ motivo: 'ROTURA', delta: true }, 'boolean'],
  ])('400 en payload inválido: %s', async (body) => {
    const res = await ajustar(P(14), body);
    expect(res.status).toBe(400);
  });

  it('null = campo ausente: {cantidad_nueva: null, delta: -1} aplica el delta', async () => {
    const p = P(16);
    const { stock_actual: antes } = await stockDe(p.id);
    const res = await ajustar(p, { motivo: 'MERMA', cantidad_nueva: null, delta: -1 });
    expect(res.status).toBe(201);
    expect(await stockDe(p.id)).toMatchObject({ stock_actual: antes - 1 });
  });

  it('stock negativo queda clasificado CRITICO (no STOCK_BAJO)', async () => {
    const p = P(17);
    const { stock_actual: antes } = await stockDe(p.id);
    await vender(p, { unidades: antes + 4 });
    expect((await stockDe(p.id)).stock_actual).toBe(-4);
    expect(estadoProducto(-4, p.stock_minimo)).toBe('CRITICO');
    const res = await fetch(
      `${base}/api/productos?estado=CRITICO&search=${p.sku}`,
      { headers: gerente.headers },
    );
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ id: p.id, estado: 'CRITICO' });
  });

  it('403 para APROBADOR (firma compras, no inventario) y BUYER', async () => {
    expect((await ajustar(P(15), { motivo: 'MERMA', delta: -1 }, aprobador)).status).toBe(403);
    expect((await ajustar(P(15), { motivo: 'MERMA', delta: -1 }, buyer)).status).toBe(403);
  });

  it('404 producto inexistente', async () => {
    const res = await ajustar({ id: 999999 }, { motivo: 'CONTEO', cantidad_nueva: 1 });
    expect(res.status).toBe(404);
  });
});

// SPEC-30 (T30.5): una venta que deja stock <=0 avisa al harness
// (POST /trigger, fire-and-forget) — quiebre recién nacido =
// candidato inmediato del agente. El fetch del emit se captura sin
// tocar el fetch real que usan los helpers del propio test.
describe('trigger al agente cuando la venta quiebra el stock', () => {
  const llamadas = [];
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    llamadas.length = 0;
    vi.stubGlobal('fetch', (url, opts) => {
      if (String(url).includes('/trigger')) {
        llamadas.push({ url: String(url), body: JSON.parse(opts.body) });
        return Promise.resolve({ ok: true });
      }
      return realFetch(url, opts);
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('venta a stock 0 → POST /trigger con el producto', async () => {
    const p = P(22);
    const { stock_actual } = await stockDe(p.id);
    const res = await vender(p, { unidades: stock_actual });
    expect(res.status).toBe(201);
    expect((await stockDe(p.id)).stock_actual).toBe(0);
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].url).toMatch(/:4110\/trigger$/);
    expect(llamadas[0].body).toMatchObject({
      motivo: 'stock0',
      producto_ids: [p.id],
    });
  });

  it('venta que deja negativo también dispara (quiebre es quiebre)', async () => {
    const p = P(23);
    const { stock_actual } = await stockDe(p.id);
    await vender(p, { unidades: stock_actual + 3 });
    expect((await stockDe(p.id)).stock_actual).toBe(-3);
    expect(llamadas).toHaveLength(1);
  });

  it('venta normal (queda stock positivo) → NO dispara', async () => {
    const p = P(24);
    const res = await vender(p, { unidades: 1 });
    expect(res.status).toBe(201);
    expect(llamadas).toHaveLength(0);
  });

  it('batch con varios quiebres → un solo trigger con todos los ids', async () => {
    const [a, b, c] = [P(25), P(26), P(27)];
    const { stock_actual: sa } = await stockDe(a.id);
    const { stock_actual: sb } = await stockDe(b.id);
    const res = await post('/api/ventas/batch', [
      { producto_id: a.id, unidades: sa, canal: 'POS' }, // → 0
      { producto_id: b.id, unidades: sb + 2, canal: 'POS' }, // → -2
      { producto_id: c.id, unidades: 1, canal: 'POS' }, // queda positivo
    ]);
    expect(res.status).toBe(201);
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].body.producto_ids.sort()).toEqual([a.id, b.id].sort());
  });

  it('404 producto inexistente → nada commiteó, no emite', async () => {
    const res = await vender({ id: 999999 }, { unidades: 1 });
    expect(res.status).toBe(404);
    expect(llamadas).toHaveLength(0);
  });

  it('batch con faltante → rollback total, no emite', async () => {
    const p = P(29);
    const { stock_actual } = await stockDe(p.id);
    const res = await post('/api/ventas/batch', [
      { producto_id: p.id, unidades: stock_actual, canal: 'POS' }, // iría a 0
      { producto_id: 999999, unidades: 1, canal: 'POS' }, // faltante
    ]);
    expect(res.status).toBe(400);
    expect(llamadas).toHaveLength(0);
  });

  it('el harness caído no rompe la venta (fire-and-forget)', async () => {
    vi.stubGlobal('fetch', (url, opts) => {
      if (String(url).includes('/trigger')) {
        return Promise.reject(new Error('ECONNREFUSED'));
      }
      return realFetch(url, opts);
    });
    const p = P(28);
    const { stock_actual } = await stockDe(p.id);
    const res = await vender(p, { unidades: stock_actual });
    expect(res.status).toBe(201); // la venta se completó igual
  });
});
