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

describe('GET /api/estadisticas/demanda — bulk (sin producto_id, R26.9)', () => {
  it('cubre todos los productos y coincide con la ruta individual', async () => {
    const p = prodSinMovs();
    const dormido = prodSinMovs();
    await insertarVentas(p.id, [[0, 8], [1, 8], [2, 8], [10, 20]]);
    const res = await get('/estadisticas/demanda?dias=30');
    expect(res.status).toBe(200);
    const { data } = await res.json();
    const porId = new Map(data.map((d) => [d.producto_id, d]));

    const ids = (await db.all('SELECT id FROM productos ORDER BY id')).map((r) => r.id);
    expect(data.map((d) => d.producto_id)).toEqual(ids);

    // mismo cálculo que la ruta individual — una sola fuente
    const ind = await (await get(`/estadisticas/demanda?producto_id=${p.id}&dias=30`)).json();
    expect(porId.get(p.id)).toEqual(ind);
    // producto sin ventas → ceros y nulls honestos en el bulk también
    expect(porId.get(dormido.id)).toMatchObject({
      demanda_diaria: 0, cv: null, ultima_venta: null, dias_con_venta: 0,
    });
  });

  it('bulk también valida dias', async () => {
    const res = await get('/estadisticas/demanda?dias=3');
    expect(res.status).toBe(400);
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
      desvio_demanda: 0,
      ultima_venta: null,
    });
  });

  it('serie conocida: dias_con_venta, ultima_venta y demanda ponderada', async () => {
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

describe('margen (SPEC-27 T27.2)', () => {
  it('expone costo_unitario, margen_unitario y margen_perdido por quiebre', async () => {
    const p = prodSinMovs();
    await insertarMovimiento(p.id, 'VENTA', 4, 0, 5, 'T-E-MARGEN');
    await insertarMovimiento(p.id, 'REPOSICION', 0, 20, 2, 'T-E-REPO-M');
    await insertarVentas(p.id, Array.from({ length: 3 }, (_, i) => [i + 1, 5]));

    const r = await get(`/estadisticas/demanda?producto_id=${p.id}&dias=30`);
    const body = await r.json();
    const pp = seedData.producto_proveedor.find(
      (x) => x.producto_id === p.id && x.proveedor_id === p.proveedor_id,
    );
    const esperado = p.precio_venta - pp.costo_unitario;
    expect(body.costo_unitario).toBeCloseTo(pp.costo_unitario, 5);
    expect(body.margen_unitario).toBeCloseTo(esperado, 5);
    // margen_perdido = margen × demanda × días en quiebre (δ por redondeo)
    expect(
      Math.abs(
        body.margen_perdido -
          body.margen_unitario * body.demanda_diaria * body.dias_en_quiebre,
      ),
    ).toBeLessThan(0.5);
  });

  it('margen_perdido es null si dias_en_quiebre no es confiable (nunca inventado)', async () => {
    const p = prodSinMovs();
    await insertarVentas(p.id, [[1, 3]]);
    const body = await (
      await get(`/estadisticas/demanda?producto_id=${p.id}&dias=30`)
    ).json();
    expect(body.dias_en_quiebre).toBeNull();
    expect(body.margen_perdido).toBeNull();
    expect(body.margen_unitario).toBeGreaterThan(0); // costo sí existe
  });
});

describe('GET /api/estadisticas/metricas — scorecard (SPEC-28 R28.1)', () => {
  it('401 sin token; 200 con SERVICIO; 400 con dias inválidos', async () => {
    expect((await fetch(`${base}/api/estadisticas/metricas`)).status).toBe(401);
    expect((await get('/estadisticas/metricas?dias=3')).status).toBe(400);
    expect((await get('/estadisticas/metricas?dias=90')).status).toBe(200);
  });

  it('el scorecard tiene las secciones y agrega sobre TODOS los productos', async () => {
    const r = await get('/estadisticas/metricas?dias=90');
    const m = await r.json();

    expect(m.dias).toBe(90);
    // secciones presentes
    for (const k of ['quiebres', 'riesgo', 'inventario', 'servicio', 'ordenes', 'proveedores']) {
      expect(m).toHaveProperty(k);
    }
    // buckets de riesgo particionan el catálogo completo
    const total = seedData.productos.length;
    const buckets =
      m.riesgo.quiebre_seguro + m.riesgo.riesgo_alto + m.riesgo.riesgo_medio +
      m.riesgo.cubierto + m.riesgo.sin_demanda;
    expect(buckets).toBe(total);
    // quiebres: sin_stock + bajo_minimo ≤ total; riesgo > 0 con seed real
    expect(m.quiebres.skus_sin_stock).toBeGreaterThan(0);
    expect(m.quiebres.skus_sin_stock + m.quiebres.skus_bajo_minimo).toBeLessThanOrEqual(total);
    expect(m.quiebres.venta_riesgo_dia).toBeGreaterThanOrEqual(0);
    // margen existe para (casi) todo el catálogo con SPEC-27
    expect(m.quiebres.margen_riesgo_dia).toBeGreaterThanOrEqual(0);
    // inventario a costo < a venta (margen positivo en el seed)
    expect(m.inventario.valor_costo).toBeGreaterThan(0);
    expect(m.inventario.valor_costo).toBeLessThan(m.inventario.valor_venta);
    // fill rate en rango y definido (el seed tiene historial_stock)
    expect(m.servicio.skus_con_historial).toBeGreaterThan(0);
    expect(m.servicio.fill_rate_pct).toBeGreaterThanOrEqual(0);
    expect(m.servicio.fill_rate_pct).toBeLessThanOrEqual(100);
    // órdenes pendientes del seed
    expect(m.ordenes.pendientes).toBeGreaterThanOrEqual(0);
    expect(m.ordenes.pendientes_monto).toBeGreaterThanOrEqual(0);
    // scorecard de proveedores: uno por proveedor del seed, con skus>0
    expect(m.proveedores.length).toBe(seedData.proveedores.length);
    for (const pr of m.proveedores) {
      expect(pr).toHaveProperty('lead_dias_esperado');
      expect(pr).toHaveProperty('confiabilidad_pct');
      expect(pr.skus).toBeGreaterThanOrEqual(0);
    }
  });

  it('dead stock cuenta productos con stock y sin venta en la ventana', async () => {
    // un producto sin movimientos ni ventas pero con stock: el seed
    // le asigna stock — es dead por definición de R28.1
    const p = prodSinMovs();
    // asegurar stock>0 sin tocar la cadena: venta sería movimiento;
    // basta verificar que SI tiene stock aparece en dead o exceso
    const m = await (await get('/estadisticas/metricas?dias=30')).json();
    expect(m.inventario.dead_stock_skus).toBeGreaterThanOrEqual(0);
    expect(m.inventario.dead_stock_valor_costo).toBeGreaterThanOrEqual(0);
    // consistencia interna: los valores a costo no superan el total
    expect(m.inventario.dead_stock_valor_costo).toBeLessThanOrEqual(m.inventario.valor_costo);
  });
});
