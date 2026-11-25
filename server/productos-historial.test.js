// @vitest-environment node
// SPEC-32 (T32.6): GET /api/productos/:id/historial — sierra de
// stock. La serie diaria sale del replay compartido
// (stock-serie.js, mismo que dias_en_quiebre): posición al cierre
// de cada día, días pre-primer-movimiento heredan su
// cantidad_anterior, sin movimientos → serie null (R26.7).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { closeDb, openDb } from './db.js';
import { seedData } from './seed-data.js';
import { loginComo } from './test-auth.js';

const SCHEMA = 't_historial';
const db = await openDb({ searchPath: SCHEMA });

// Productos SIN movimientos del seed estático — el fixture controla
// la cadena completa (mismo criterio que estadisticas.test.js).
const idsConMovimientos = new Set(seedData.historial_stock.map((m) => m.producto_id));
const sinMovs = seedData.productos.filter((p) => !idsConMovimientos.has(p.id));
const PROD = sinMovs[0];
const SIN_MOVS = sinMovs[1];

let server;
let base;
let gerente;
let buyer;

beforeAll(async () => {
  const app = await createApp();
  server = app.listen(0);
  base = `http://localhost:${server.address().port}`;
  gerente = await loginComo(base, 'GERENTE');
  buyer = await loginComo(base, 'BUYER');

  // Sierra con quiebre: repo → ventas que agotan → días en cero →
  // conteo que reconcilia con el stock_actual declarado por el seed.
  const ins = (tipo, anterior, nueva, diasAtras) =>
    db.run(
      `INSERT INTO historial_stock
         (producto_id, tipo_movimiento, cantidad_anterior, cantidad_nueva,
          diferencia, referencia, fecha)
       VALUES (?, ?, ?, ?, ?, 'T-HIST', CURRENT_DATE - ?::int)`,
      [PROD.id, tipo, anterior, nueva, nueva - anterior, diasAtras],
    );
  await ins('REPOSICION', 10, 40, 60);
  await ins('VENTA', 40, 15, 30);
  await ins('VENTA', 15, 0, 10);
  await ins('AJUSTE', 0, PROD.stock_actual, 2);
});

afterAll(async () => {
  server?.close();
  await closeDb(true); // drop del schema de test
});

const getHistorial = (id, qs = '', sesion = gerente) =>
  fetch(`${base}/api/productos/${id}/historial${qs}`, { headers: sesion.headers });

describe('GET /api/productos/:id/historial — acceso y validación', () => {
  it('401 sin token; BUYER 403 (bloquearBuyer); APROBADOR entra', async () => {
    expect((await fetch(`${base}/api/productos/${PROD.id}/historial`)).status).toBe(401);
    expect((await getHistorial(PROD.id, '', buyer)).status).toBe(403);
    const aprobador = await loginComo(base, 'APROBADOR');
    expect((await getHistorial(PROD.id, '', aprobador)).status).toBe(200);
  });

  it.each([
    ['/api/productos/abc/historial', 'id no numérico'],
    ['/api/productos/0/historial', 'id cero'],
    [`/api/productos/${PROD.id}/historial?dias=3`, 'dias < 7'],
    [`/api/productos/${PROD.id}/historial?dias=999`, 'dias > 365'],
  ])('400 con %s (%s)', async (path) => {
    expect((await fetch(`${base}${path}`, { headers: gerente.headers })).status).toBe(400);
  });

  it('404 con producto inexistente', async () => {
    expect((await getHistorial(999999)).status).toBe(404);
  });
});

describe('GET /:id/historial — serie con movimientos', () => {
  it('devuelve metadatos + un punto por día; la última posición es stock_actual', async () => {
    const res = await getHistorial(PROD.id);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.producto_id).toBe(PROD.id);
    expect(body.sku).toBe(PROD.sku);
    expect(body.nombre).toBe(PROD.nombre);
    expect(body.dias).toBe(90);
    expect(body.stock_minimo).toBe(PROD.stock_minimo);
    expect(body.tiene_movimientos).toBe(true);

    expect(body.serie).toHaveLength(90);
    const { hoy } = await db.get('SELECT CURRENT_DATE::text AS hoy');
    expect(body.serie.at(-1).fecha).toBe(hoy);
    expect(body.serie.at(-1).stock).toBe(PROD.stock_actual);
  });

  it('el replay reproduce la sierra: pre-movimiento hereda anterior, quiebre en cero, cierre al conteo', async () => {
    const { serie } = await (await getHistorial(PROD.id)).json();
    const porFecha = new Map(serie.map((d) => [d.fecha, d.stock]));
    const fechaDe = async (n) =>
      (await db.get('SELECT (CURRENT_DATE - ?::int)::text AS f', [n])).f;

    // Antes del primer movimiento → cantidad_anterior del primero.
    expect(porFecha.get(await fechaDe(70))).toBe(10);
    // Día de la reposición y siguientes → 40.
    expect(porFecha.get(await fechaDe(60))).toBe(40);
    expect(porFecha.get(await fechaDe(31))).toBe(40);
    // Tras las ventas: 15 y luego quiebre en cero sostenido.
    expect(porFecha.get(await fechaDe(30))).toBe(15);
    expect(porFecha.get(await fechaDe(10))).toBe(0);
    expect(porFecha.get(await fechaDe(5))).toBe(0);
    // El conteo de hace 2 días reconcilia con stock_actual.
    expect(porFecha.get(await fechaDe(2))).toBe(PROD.stock_actual);
  });

  it('?dias=30 acota la ventana a 30 puntos', async () => {
    const body = await (await getHistorial(PROD.id, '?dias=30')).json();
    expect(body.dias).toBe(30);
    expect(body.serie).toHaveLength(30);
  });
});

describe('GET /:id/historial — sin movimientos', () => {
  it('serie null + tiene_movimientos false (fuente no confiable, nunca inventado)', async () => {
    const res = await getHistorial(SIN_MOVS.id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.producto_id).toBe(SIN_MOVS.id);
    expect(body.serie).toBeNull();
    expect(body.tiene_movimientos).toBe(false);
  });
});
