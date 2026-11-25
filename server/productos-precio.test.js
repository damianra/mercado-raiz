// @vitest-environment node
// SPEC-32 (T32.2): PATCH /api/productos/:id/precio — único write
// path de precio_venta con auditoría y guard de costo; y
// GET /:id/competencia que alimenta el modal.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { closeDb, openDb } from './db.js';
import { seedData } from './seed-data.js';
import { loginComo } from './test-auth.js';

const SCHEMA = 't_precio';
const db = await openDb({ searchPath: SCHEMA });
const PROD = seedData.productos[200]; // artículo cualquiera del catálogo

let server;
let base;
let gerente;
let admin;
let aprobador;
let buyer;

beforeAll(async () => {
  const app = await createApp();
  server = app.listen(0);
  base = `http://localhost:${server.address().port}`;
  gerente = await loginComo(base, 'GERENTE');
  admin = await loginComo(base, 'ADMIN');
  aprobador = await loginComo(base, 'APROBADOR');
  buyer = await loginComo(base, 'BUYER');
});

afterAll(async () => {
  server?.close();
  await closeDb(true);
});

const patchPrecio = (id, body, sesion = gerente) =>
  fetch(`${base}/api/productos/${id}/precio`, {
    method: 'PATCH',
    headers: { ...sesion.headers, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('PATCH /api/productos/:id/precio — roles', () => {
  it('GERENTE y ADMIN escriben; APROBADOR y BUYER no', async () => {
    expect((await patchPrecio(PROD.id, { precio: 9999, motivo: 'AJUSTE_MERCADO' })).status).toBe(200);
    expect((await patchPrecio(PROD.id, { precio: 9999, motivo: 'AJUSTE_MERCADO' }, admin)).status).toBe(200);
    expect((await patchPrecio(PROD.id, { precio: 9999, motivo: 'AJUSTE_MERCADO' }, aprobador)).status).toBe(403);
    expect((await patchPrecio(PROD.id, { precio: 9999, motivo: 'AJUSTE_MERCADO' }, buyer)).status).toBe(403);
  });
});

describe('PATCH — validaciones', () => {
  it('rechaza precio inválido y motivo desconocido', async () => {
    expect((await patchPrecio(PROD.id, { precio: 0, motivo: 'PROMO' })).status).toBe(400);
    expect((await patchPrecio(PROD.id, { precio: -5, motivo: 'PROMO' })).status).toBe(400);
    expect((await patchPrecio(PROD.id, { precio: 'abc', motivo: 'PROMO' })).status).toBe(400);
    expect((await patchPrecio(PROD.id, { precio: 100, motivo: 'X' })).status).toBe(400);
    expect((await patchPrecio(999999, { precio: 100, motivo: 'PROMO' })).status).toBe(404);
  });
});

describe('PATCH — cambio y auditoría', () => {
  it('actualiza precio_venta y audita anterior→nuevo con motivo y usuario', async () => {
    const pid = PROD.id;
    const { precio_venta: antes } = await db.get(
      `SELECT precio_venta FROM productos WHERE id = ?`, [pid]);
    const nuevo = Math.round(antes * 1.1 * 100) / 100;
    const res = await patchPrecio(pid, { precio: nuevo, motivo: 'AJUSTE_MERCADO' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.precio_anterior).toBe(antes);
    expect(body.precio_nuevo).toBe(nuevo);

    const { precio_venta } = await db.get(
      `SELECT precio_venta FROM productos WHERE id = ?`, [pid]);
    expect(precio_venta).toBe(nuevo);

    const aud = await db.get(
      `SELECT * FROM precios_historial WHERE producto_id = ? ORDER BY id DESC LIMIT 1`,
      [pid]);
    expect(aud.precio_anterior).toBe(antes);
    expect(aud.precio_nuevo).toBe(nuevo);
    expect(aud.motivo).toBe('AJUSTE_MERCADO');
    expect(aud.usuario_email).toBe('carlos.martinez@mercadorai.com');
  });
});

describe('PATCH — guard de costo', () => {
  it('409 sin confirmación cuando el precio queda bajo el costo; 200 con confirmar_bajo_costo', async () => {
    const pid = seedData.productos[300].id;
    const pp = await db.get(
      `SELECT costo_unitario FROM producto_proveedor
        WHERE producto_id = ? AND es_principal = 1`, [pid]);
    const bajoCosto = Math.round(pp.costo_unitario * 0.8 * 100) / 100;

    const r1 = await patchPrecio(pid, { precio: bajoCosto, motivo: 'LIQUIDACION' });
    expect(r1.status).toBe(409);
    const b1 = await r1.json();
    expect(b1.requiere_confirmacion).toBe(true);
    expect(b1.costo_unitario).toBe(pp.costo_unitario);
    // No escribió ni auditó.
    const { n } = await db.get(
      `SELECT COUNT(*) AS n FROM precios_historial WHERE producto_id = ?`, [pid]);
    expect(Number(n)).toBe(0);

    const r2 = await patchPrecio(pid, {
      precio: bajoCosto,
      motivo: 'LIQUIDACION',
      confirmar_bajo_costo: true,
    });
    expect(r2.status).toBe(200);
    const { motivo } = await db.get(
      `SELECT motivo FROM precios_historial WHERE producto_id = ?`, [pid]);
    expect(motivo).toBe('LIQUIDACION');
  });
});

describe('GET /api/productos/:id/competencia', () => {
  it('devuelve posición: 4 cadenas, rango, zona, costo y stock', async () => {
    const res = await fetch(`${base}/api/productos/1/competencia`, {
      headers: gerente.headers,
    });
    expect(res.status).toBe(200);
    const pos = await res.json();
    expect(pos.cadenas).toHaveLength(4);
    expect(pos.min_mercado).toBeLessThanOrEqual(pos.max_mercado);
    expect(pos.costo_unitario).toBeGreaterThan(0);
    expect(pos.costo_unitario).toBeLessThan(pos.precio_venta); // margen positivo en el seed
    expect(pos.fecha_snapshot).toBe('2026-11-20');
  });

  it('BUYER queda fuera (bloquearBuyer)', async () => {
    const res = await fetch(`${base}/api/productos/1/competencia`, {
      headers: buyer.headers,
    });
    expect(res.status).toBe(403);
  });
});
