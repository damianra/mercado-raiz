// @vitest-environment node
// Tests de movimientos de stock (SPEC-30 T30.2):
// POST /api/ventas — descuenta stock + historial VENTA en la misma
// tx (stock negativo permitido: la venta es hecho físico).
// POST /api/stock/ajuste — merma/rotura (delta) o conteo físico
// (cantidad_nueva) con motivo estructurado → historial AJUSTE.
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { closeDb, openDb } from './db.js';
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
  ])('400 en payload inválido: %s', async (body) => {
    const res = await ajustar(P(14), body);
    expect(res.status).toBe(400);
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
