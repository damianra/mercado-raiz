// @vitest-environment node
// SPEC-32 (T32.3): los insumos de la vista gráfica de Métricas —
// competitividad, ventas diarias, capital inmovilizado y pricing
// accionable con sugerido + diagnóstico.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { closeDb, openDb } from './db.js';
import { seedData } from './seed-data.js';
import { loginComo } from './test-auth.js';

const SCHEMA = 't_mgraf';
const db = await openDb({ searchPath: SCHEMA });

let server;
let base;
let admin;
let buyer;

beforeAll(async () => {
  const app = await createApp();
  server = app.listen(0);
  base = `http://localhost:${server.address().port}`;
  admin = await loginComo(base, 'ADMIN');
  buyer = await loginComo(base, 'BUYER');
});

afterAll(async () => {
  server?.close();
  await db.run('DELETE FROM ventas');
  await closeDb(true);
});

const get = (path, sesion = admin) =>
  fetch(`${base}/api${path}`, { headers: sesion.headers });

describe('GET /estadisticas/competitividad', () => {
  it('zonas cubren el catálogo + por-cadena coherente', async () => {
    const res = await get('/estadisticas/competitividad');
    expect(res.status).toBe(200);
    const j = await res.json();
    const total = Object.values(j.vsMercado).reduce((a, b) => a + b, 0);
    expect(total).toBe(1471);
    expect(j.vsMercado.BAJO_MIN).toBeGreaterThan(0);
    expect(j.vsMercado.SOBRE_MAX).toBeGreaterThan(0);
    expect(j.porCadena).toHaveLength(4);
    expect(j.fecha_snapshot).toBe('2026-11-20');
  });

  it('BUYER no entra', async () => {
    expect((await get('/estadisticas/competitividad', buyer)).status).toBe(403);
  });
});

describe('GET /estadisticas/ventas-diarias', () => {
  it('devuelve la serie diaria con facturación', async () => {
    const p = seedData.productos[10];
    const hoy = (await db.get(`SELECT CURRENT_DATE::text AS h`)).h;
    await db.run(
      `INSERT INTO ventas (producto_id, fecha, unidades, canal, referencia)
       VALUES (?, ?, 3, 'POS', 'T-MG1'), (?, ?, 2, 'WEB', 'T-MG2')`,
      [p.id, hoy, p.id, hoy],
    );
    const res = await get('/estadisticas/ventas-diarias?dias=30');
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.dias).toBe(30);
    const dia = j.serie.find((s) => s.fecha === hoy);
    expect(dia.unidades).toBe(5);
    expect(dia.facturacion).toBeCloseTo(5 * p.precio_venta, 0);
  });

  it('valida dias', async () => {
    expect((await get('/estadisticas/ventas-diarias?dias=3')).status).toBe(400);
  });
});

describe('GET /estadisticas/capital', () => {
  it('top ordenado por capital (stock×costo) y nunca inventa costo', async () => {
    const res = await get('/estadisticas/capital?dias=90');
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.skus).toBeGreaterThan(0);
    expect(j.capital_total).toBeGreaterThan(0);
    // orden descendente + capital = stock × costo en cada fila
    for (let i = 1; i < j.top.length; i++) {
      expect(j.top[i - 1].capital).toBeGreaterThanOrEqual(j.top[i].capital);
    }
    for (const it of j.top) {
      expect(it.capital).toBeCloseTo(it.stock_actual * it.costo_unitario, 2);
      expect(it.stock_actual).toBeGreaterThan(0);
    }
    expect(j.top.length).toBeLessThanOrEqual(15);
  });
});

describe('GET /estadisticas/pricing', () => {
  it('lista outliers con sugerido y diagnóstico', async () => {
    const res = await get('/estadisticas/pricing?dias=90');
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.items.length).toBeGreaterThan(0);
    expect(j.total_fuera_de_rango).toBeGreaterThanOrEqual(j.items.length);
    for (const it of j.items) {
      expect(['SOBRE_MAX', 'BAJO_MIN']).toContain(it.zona);
      expect(it.sugerido).toBeGreaterThan(0);
      expect(it.accion.length).toBeGreaterThan(10);
      expect(it.min_mercado).toBeLessThanOrEqual(it.max_mercado);
    }
    // SOBRE_MAX primero por índice descendente
    const sobres = j.items.filter((i) => i.zona === 'SOBRE_MAX');
    for (let i = 1; i < sobres.length; i++) {
      expect(sobres[i - 1].indice).toBeGreaterThanOrEqual(sobres[i].indice);
    }
  });

  it('un muerto caro sugiere liquidar, no "bajar al punto medio"', async () => {
    const j = await (await get('/estadisticas/pricing?dias=90')).json();
    const muertos = j.items.filter((i) => i.muerto);
    // Si algún muerto llega al top, su acción habla de liquidación/promo
    // y el sugerido no supera el mínimo de mercado.
    for (const m of muertos) {
      expect(m.accion).toMatch(/liquid|promo|competir/i);
      expect(m.sugerido).toBeLessThanOrEqual(Math.max(m.min_mercado, m.costo_unitario ?? 0));
    }
  });
});
