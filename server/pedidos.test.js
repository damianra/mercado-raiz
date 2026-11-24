// @vitest-environment node
// SPEC-29 T29.3: GET /api/pedidos/sugerencia (hoja de compra del
// modal) + POST /api/pedidos — stub: valida contra precios reales
// y loguea → 202 sin crear la OC. Roles: BUYER y ADMIN.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { closeDb, openDb } from './db.js';
import { cantidadSugerida } from './models/pedidos.model.js';
import { seedData } from './seed-data.js';
import { loginComo } from './test-auth.js';

let server;
let base;
let buyer;
let admin;
const db = await openDb({ searchPath: 't_pedidos' });

beforeEach(async () => {
  const app = await createApp();
  server = app.listen(0);
  base = `http://localhost:${server.address().port}`;
  buyer ??= await loginComo(base, 'BUYER');
  admin ??= await loginComo(base, 'ADMIN');
});

afterAll(async () => {
  server?.close();
  await closeDb(true);
});

const req = (path, { method = 'GET', sesion = buyer, body } = {}) =>
  fetch(`${base}/api${path}`, {
    method,
    headers: { ...sesion.headers, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

// Par producto/proveedor válido del seed (precio activo real).
const pp = seedData.producto_proveedor.find((x) => x.activo === 1);

describe('R29.7 — GET /api/pedidos/sugerencia', () => {
  it('devuelve producto + precios por proveedor con cantidad sugerida', async () => {
    const r = await req(`/pedidos/sugerencia?producto_id=${pp.producto_id}`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.producto.id).toBe(pp.producto_id);
    expect(body.precios.length).toBeGreaterThan(0);
    for (const p of body.precios) {
      expect(p.costo_unitario).toBeGreaterThan(0);
      expect(p.lead_efectivo).toBeGreaterThan(0);
      expect(p.cantidad_sugerida).toBeGreaterThanOrEqual(1);
    }
    // ordenadas por costo ASC — la primera es "más barato"
    const costos = body.precios.map((p) => p.costo_unitario);
    expect(costos).toEqual([...costos].sort((a, b) => a - b));
  });

  it('BUYER puede leerla aunque /api/productos esté bloqueado', async () => {
    expect((await req(`/pedidos/sugerencia?producto_id=${pp.producto_id}`)).status).toBe(200);
    expect((await req(`/productos/${pp.producto_id}`)).status).toBe(403);
  });

  it('400 en producto_id inválido y 404 en inexistente', async () => {
    expect((await req('/pedidos/sugerencia?producto_id=abc')).status).toBe(400);
    expect((await req('/pedidos/sugerencia?producto_id=999999')).status).toBe(404);
  });
});

describe('R29.7b — POST /api/pedidos (stub)', () => {
  it('202 con payload válido: valida contra precio real y devuelve resumen', async () => {
    const r = await req('/pedidos', {
      method: 'POST',
      body: { producto_id: pp.producto_id, proveedor_id: pp.proveedor_id, cantidad: 5 },
    });
    expect(r.status).toBe(202);
    const { ok, data } = await r.json();
    expect(ok).toBe(true);
    expect(data.sku).toBeTruthy();
    expect(data.proveedor).toBeTruthy();
    expect(data.cantidad).toBe(5);
    expect(data.monto_estimado).toBeCloseTo(5 * data.costo_unitario, 2);
    expect(data.solicitado_por).toBe('buyer@mercadorai.com');
  });

  it('400 en payload inválido y en proveedor sin precio para el producto', async () => {
    for (const body of [
      {},
      { producto_id: pp.producto_id },
      { producto_id: pp.producto_id, proveedor_id: pp.proveedor_id, cantidad: 0 },
      { producto_id: pp.producto_id, proveedor_id: pp.proveedor_id, cantidad: 2.5 },
      { producto_id: pp.producto_id, proveedor_id: pp.proveedor_id, cantidad: 5, alerta_id: -1 },
    ]) {
      expect((await req('/pedidos', { method: 'POST', body })).status).toBe(400);
    }
    expect(
      (
        await req('/pedidos', {
          method: 'POST',
          body: { producto_id: pp.producto_id, proveedor_id: 999999, cantidad: 5 },
        })
      ).status,
    ).toBe(400);
  });

  it('roles: BUYER y ADMIN entran, GERENTE y anónimo no', async () => {
    const body = { producto_id: pp.producto_id, proveedor_id: pp.proveedor_id, cantidad: 1 };
    expect((await req('/pedidos', { method: 'POST', sesion: admin, body })).status).toBe(202);
    const gerente = await loginComo(base, 'GERENTE');
    expect((await req('/pedidos', { method: 'POST', sesion: gerente, body })).status).toBe(403);
    expect((await fetch(`${base}/api/pedidos`, { method: 'POST' })).status).toBe(401);
  });
});

describe('cantidadSugerida — la math del automático', () => {
  it('objetivo = demanda×(lead+7) + z·σ·√lead; piso 2×mínimo', () => {
    // sin demanda ni desvío: solo el piso de mínimo
    expect(cantidadSugerida({ demanda: 0, desvio: 0, stock: 3, minimo: 10, lead: 5 })).toBe(17);
    // objetivo por encima del piso gana: 5×(4+7)=55 vs 20-10
    expect(cantidadSugerida({ demanda: 5, desvio: 0, stock: 10, minimo: 10, lead: 4 })).toBe(45);
    // más lead ⇒ más sugerencia para la misma demanda
    const corto = cantidadSugerida({ demanda: 2, desvio: 1, stock: 0, minimo: 0, lead: 2 });
    const largo = cantidadSugerida({ demanda: 2, desvio: 1, stock: 0, minimo: 0, lead: 8 });
    expect(largo).toBeGreaterThan(corto);
    // nunca menos de 1
    expect(cantidadSugerida({ demanda: 0, desvio: 0, stock: 100, minimo: 1, lead: 1 })).toBe(1);
  });
});
