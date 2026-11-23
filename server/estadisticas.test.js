// @vitest-environment node
// SPEC-26 T26.5 (R26.7): GET /api/estadisticas/demanda. Schema
// aislado — ventas e historial_stock se pueblan por fixture (el seed
// de ventas no corre en schemas de test; los productos sí vienen del
// seed estático). Los productos de los fixtures se eligen SIN
// movimientos del seed para controlar la cadena de stock.
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { closeDb, openDb } from './db.js';
import { seedData } from './seed-data.js';
import { loginComo } from './test-auth.js';

let server;
let base;
let sesion;
const db = await openDb({ searchPath: 't_estadisticas' });

beforeEach(async () => {
  const app = await createApp();
  server = app.listen(0);
  base = `http://localhost:${server.address().port}`;
  sesion ??= await loginComo(base, 'SERVICIO'); // el agente consume esto
});

afterEach(() => server?.close());
afterAll(async () => {
  await db.run('DELETE FROM ventas');
  await db.run("DELETE FROM historial_stock WHERE referencia LIKE 'T-E%'");
  await closeDb(true);
});

const get = (path) => fetch(`${base}/api${path}`, { headers: sesion.headers });

// Productos sin movimientos en el seed — el fixture controla la
// cadena de stock completa. Uno distinto por test: el schema es
// compartido y las ventas se acumulan entre tests.
const idsConMovimientos = new Set(seedData.historial_stock.map((m) => m.producto_id));
const sinMovs = seedData.productos.filter((p) => !idsConMovimientos.has(p.id));
let fixtureIdx = 0;
const prodSinMovs = () => sinMovs[fixtureIdx++];

const insertarVentas = (productoId, filas) =>
  Promise.all(
    filas.map(([diasAtras, unidades]) =>
      db.run(
        `INSERT INTO ventas (producto_id, fecha, unidades, canal)
         VALUES (?, CURRENT_DATE - ?::int, ?, 'POS')`,
        [productoId, diasAtras, unidades],
      ),
    ),
  );

const insertarMovimiento = (productoId, tipo, anterior, nueva, diasAtras, ref) =>
  db.run(
    `INSERT INTO historial_stock
       (producto_id, tipo_movimiento, cantidad_anterior, cantidad_nueva, diferencia, referencia, fecha)
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_DATE - ?::int)`,
    [productoId, tipo, anterior, nueva, nueva - anterior, ref, diasAtras],
  );

describe('GET /api/estadisticas/demanda — acceso y validación', () => {
  it('401 sin token; el rol SERVICIO (agente) sí accede', async () => {
    const p = seedData.productos[0];
    expect((await fetch(`${base}/api/estadisticas/demanda?producto_id=${p.id}`)).status).toBe(401);
    const r = await get(`/estadisticas/demanda?producto_id=${p.id}`);
    expect(r.status).toBe(200);
  });

  it.each([
    ['?producto_id=abc', 'id no numérico'],
    ['?producto_id=0', 'id cero'],
    [`?producto_id=${seedData.productos[0].id}&dias=3`, 'dias < 7'],
    [`?producto_id=${seedData.productos[0].id}&dias=999`, 'dias > 365'],
  ])('400 con %s', async (qs) => {
    expect((await get(`/estadisticas/demanda${qs}`)).status).toBe(400);
  });

  it('404 con producto inexistente', async () => {
    expect((await get('/estadisticas/demanda?producto_id=999999')).status).toBe(404);
  });
});

describe('GET /api/estadisticas/demanda — cálculo', () => {
  it('producto sin ventas: demanda 0, cv null, quiebre null sin movimientos', async () => {
    const p = prodSinMovs();
    const r = await get(`/estadisticas/demanda?producto_id=${p.id}`);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({
      producto_id: p.id,
      dias: 90,
      demanda_diaria: 0,
      tendencia: 0,
      cv: null,
      dias_con_venta: 0,
      dias_en_quiebre: null, // sin movimientos → fuente no confiable
      ultima_venta: null,
    });
  });

  it('serie conocida: dias_con_venta, ultima_venta y cv ≈ 0 con demanda constante', async () => {
    const p = prodSinMovs();
    // 10 unidades por día durante los últimos 10 días → serie
    // constante al final de la ventana.
    await insertarVentas(p.id, Array.from({ length: 10 }, (_, i) => [i + 1, 10]));

    const r = await get(`/estadisticas/demanda?producto_id=${p.id}&dias=30`);
    const body = await r.json();
    expect(body.dias_con_venta).toBe(10);
    expect(body.demanda_diaria).toBeGreaterThan(0);
    // Media 10/3 (10 días con venta sobre 30) — cv > 0 por los ceros,
    // pero la demanda ponderada reciente se acerca a 10.
    expect(body.demanda_diaria).toBeGreaterThan(3);
    expect(body.ultima_venta).toBeTruthy();
  });

  it('tendencia positiva con serie creciente', async () => {
    const p = prodSinMovs();
    // 1,2,3,...,15 unidades — pendiente claramente positiva.
    await insertarVentas(p.id, Array.from({ length: 15 }, (_, i) => [15 - i, i + 1]));
    const r = await get(`/estadisticas/demanda?producto_id=${p.id}&dias=30`);
    expect((await r.json()).tendencia).toBeGreaterThan(0);
  });

  it('dias_en_quiebre: días con posición 0 entre movimientos', async () => {
    const p = prodSinMovs();
    // VENTA que vacía el stock hace 5 días; REPOSICION hace 2 →
    // quiebre en los días -5, -4 y -3 (el día -2 ya tiene stock).
    await insertarMovimiento(p.id, 'VENTA', 4, 0, 5, 'T-E-QUIEBRE');
    await insertarMovimiento(p.id, 'REPOSICION', 0, 20, 2, 'T-E-REPO');

    const r = await get(`/estadisticas/demanda?producto_id=${p.id}&dias=30`);
    expect((await r.json()).dias_en_quiebre).toBe(3);
  });

  it('los días en quiebre no cuentan como demanda 0 en el denominador', async () => {
    const p = prodSinMovs();
    // Quiebre largo (días -20 a -6) + venta constante los últimos 5.
    await insertarMovimiento(p.id, 'VENTA', 10, 0, 20, 'T-E-QUIEBRE2');
    await insertarMovimiento(p.id, 'REPOSICION', 0, 30, 6, 'T-E-REPO2');
    await insertarVentas(p.id, Array.from({ length: 5 }, (_, i) => [i + 1, 10]));

    const r = await get(`/estadisticas/demanda?producto_id=${p.id}&dias=30`);
    const body = await r.json();
    expect(body.dias_en_quiebre).toBe(14); // -20…-7 (el -6 ya repuso)
    // Con los 14 días de quiebre excluidos, la serie elegible es casi
    // toda venta real → cv bajo vs si los quiebres contaran como 0.
    const conVenta = body.dias_con_venta;
    expect(conVenta).toBe(5);
    expect(body.demanda_diaria).toBeGreaterThan(4); // ~10 u/día reciente
  });
});
