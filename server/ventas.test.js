// @vitest-environment node
// SPEC-26 (R26.1/R26.2/R26.3): tabla ventas + GET /api/ventas +
// generador determinístico. Mismo patrón que api.test.js: schema
// aislado en mercadoraiz-db-test; las ventas no se siembran en
// schemas de test (ver db.js) — se insertan fixtures explícitas.
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { closeDb, openDb } from './db.js';
import { loginComo } from './test-auth.js';
import { ventasDeProducto } from './seed-ventas.js';

let server;
let base;
let sesion;
const db = await openDb({ searchPath: 't_ventas' });

beforeEach(async () => {
  await db.query('TRUNCATE ventas RESTART IDENTITY'); // fixtures por test
  const app = await createApp();
  server = app.listen(0);
  base = `http://localhost:${server.address().port}`;
  sesion ??= await loginComo(base, 'GERENTE');
});

afterEach(() => server?.close());
afterAll(() => closeDb(true));

const get = (path) => fetch(`${base}/api${path}`, { headers: sesion.headers });

// Fixture mínima: 3 ventas del producto 1 en días conocidos.
async function fixtures() {
  await db.prepare(
    `INSERT INTO ventas (producto_id, fecha, unidades, canal, referencia)
     VALUES (1, '2026-11-20', 5, 'POS', 'T-1'),
            (1, '2026-11-21', 8, 'WEB', 'T-2'),
            (1, '2026-11-22', 3, 'MAYOR', 'T-3'),
            (2, '2026-11-21', 2, 'POS', 'T-4')`,
  ).run();
}

describe('GET /api/ventas', () => {
  it('lista con paginación y shape del item', async () => {
    await fixtures();
    const res = await get('/ventas?limit=10');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pagination.total).toBe(4);
    expect(body.data[0]).toMatchObject({
      producto: { id: expect.any(Number), sku: expect.any(String), nombre: expect.any(String) },
      unidades: expect.any(Number),
      canal: expect.stringMatching(/POS|WEB|MAYOR/),
    });
    // ORDER BY fecha DESC — la del 22 va primero.
    expect(body.data[0].referencia).toBe('T-3');
  });

  it('filtra por producto_id', async () => {
    await fixtures();
    const res = await get('/ventas?producto_id=2');
    const body = await res.json();
    expect(body.pagination.total).toBe(1);
    expect(body.data[0].producto.id).toBe(2);
    expect(body.data[0].unidades).toBe(2);
  });

  it('filtra por rango desde/hasta (inclusive, día calendario)', async () => {
    await fixtures();
    const res = await get('/ventas?desde=2026-11-21&hasta=2026-11-21');
    const body = await res.json();
    expect(body.pagination.total).toBe(2); // T-2 y T-4
    expect(body.data.every((v) => v.fecha.startsWith('2026-11-21'))).toBe(true);
  });

  it('filtra por canal', async () => {
    await fixtures();
    const res = await get('/ventas?canal=WEB');
    const body = await res.json();
    expect(body.pagination.total).toBe(1);
    expect(body.data[0].canal).toBe('WEB');
  });

  it('400 ante params inválidos', async () => {
    for (const q of ['?canal=OTRO', '?desde=ayer', '?hasta=2026/11/01', '?producto_id=abc', '?limit=0']) {
      const res = await get(`/ventas${q}`);
      expect(res.status).toBe(400);
    }
  });

  it('401 sin sesión', async () => {
    const res = await fetch(`${base}/api/ventas`);
    expect(res.status).toBe(401);
  });
});

describe('ventasDeProducto (seed determinístico)', () => {
  const p = { id: 9, sku: 'MR00009', ean: '779000000009', categoria: 'Almacén' };
  const hoy = new Date('2026-11-23T00:00:00Z');

  it('es determinístico: mismo EAN → mismas filas', () => {
    expect(ventasDeProducto(p, hoy)).toEqual(ventasDeProducto(p, hoy));
  });

  it('90 días de ventana, unidades >0, canales válidos, referencia armada', () => {
    const filas = ventasDeProducto(p, hoy);
    expect(filas.length).toBeGreaterThan(0);
    const fechas = new Set(filas.map((f) => f.fecha));
    for (const f of filas) {
      expect(f.fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(f.fecha < hoy.toISOString().slice(0, 10)).toBe(true); // nunca a futuro
      expect(f.fecha >= '2026-08-25').toBe(true); // ventana 90d
      expect(f.unidades).toBeGreaterThan(0);
      expect(['POS', 'WEB', 'MAYOR']).toContain(f.canal);
      expect(f.referencia).toContain('MR00009');
    }
    expect(fechas.size).toBe(filas.length); // una fila por día con venta
  });

  it('los perfiles difieren por categoría: Frescos rota más que Perfumería', () => {
    // mismo ean/categoría no basta — comparo sobre muchos SKUs
    // determinísticos para que la media converja al perfil.
    const media = (cat) => {
      let uds = 0, dias = 0;
      for (let i = 0; i < 60; i++) {
        const filas = ventasDeProducto({ id: i, ean: `e${i}`, categoria: cat }, hoy);
        uds += filas.reduce((a, f) => a + f.unidades, 0);
        dias += 90;
      }
      return uds / dias;
    };
    expect(media('Frescos')).toBeGreaterThan(media('Perfumería'));
  });

  it('existe una fracción de SKUs sin ventas (~12%)', () => {
    const sinVentas = Array.from({ length: 200 }, (_, i) =>
      ventasDeProducto({ id: i, ean: `x${i}`, categoria: 'Almacén' }, hoy).length === 0,
    ).filter(Boolean).length;
    expect(sinVentas).toBeGreaterThan(5); // existen
    expect(sinVentas).toBeLessThan(60); // pero no son la mayoría
  });
});
