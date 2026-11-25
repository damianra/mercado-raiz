// @vitest-environment node
// SPEC-33 (T33.2): los movimientos de stock tienen espejo en lotes
// — ventas y mermas descuentan FEFO (lo que vence antes sale
// primero, sin-vencimiento último), el conteo positivo crea lote
// AJUSTE y la recepción de OC crea el lote del ingreso. Además
// GET /api/lotes expone el desglose con días restantes y valor.
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { closeDb, openDb } from './db.js';
import { loginComo } from './test-auth.js';

let server;
let base;
let gerente;
let aprobador;
let buyer;
const db = await openDb({ searchPath: 't_lotes_fefo' });

const P = {}; // productos de fixture (categorías reales del seed)
{
  const cats = await db.all(
    `SELECT categoria, array_agg(id ORDER BY id) AS ids FROM productos
     WHERE categoria IN ('Frescos', 'Perfumería', 'Almacén')
     GROUP BY categoria`,
  );
  for (const c of cats) P[c.categoria] = c.ids;
}

const dias = (n) =>
  new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

beforeEach(async () => {
  await db.query('TRUNCATE lotes RESTART IDENTITY');
  const app = await createApp();
  server = app.listen(0);
  base = `http://localhost:${server.address().port}`;
  gerente ??= await loginComo(base, 'GERENTE');
  aprobador ??= await loginComo(base, 'APROBADOR');
  buyer ??= await loginComo(base, 'BUYER');
});

afterEach(() => server?.close());
afterAll(() => closeDb(true));

const get = (path, sesion = gerente) =>
  fetch(`${base}/api${path}`, { headers: sesion.headers });
const post = (path, body, sesion = gerente) =>
  fetch(`${base}/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...sesion.headers },
    body: JSON.stringify(body ?? {}),
  });

const insertLote = (productoId, codigo, cantidad, vencimiento, origen = 'SEED') =>
  db
    .prepare(
      `INSERT INTO lotes
         (producto_id, codigo, cantidad_inicial, cantidad_actual,
          fecha_vencimiento, origen)
       VALUES (?, ?, ?, ?, ?::date, ?)`,
    )
    .run(productoId, codigo, cantidad, cantidad, vencimiento, origen);

const lotesDe = (productoId) =>
  db.all(
    `SELECT codigo, cantidad_actual, fecha_vencimiento::text AS vto,
            origen, orden_id
     FROM lotes WHERE producto_id = ? ORDER BY codigo`,
    [productoId],
  );

const setStock = (productoId, stock) =>
  db.prepare('UPDATE productos SET stock_actual = ? WHERE id = ?').run(stock, productoId);

const vidaDe = async (productoId) =>
  (await db.get('SELECT vida_util_dias FROM productos WHERE id = ?', [productoId]))
    .vida_util_dias;

describe('FEFO en ventas (POST /api/ventas)', () => {
  it('descuenta del lote que vence antes; el sin-vencimiento sale último', async () => {
    const pid = P['Frescos'][0];
    await setStock(pid, 20);
    // Sin-orden-de-inserción: el FEFO es por fecha, no por id.
    await insertLote(pid, 'L-MEDIO', 5, dias(5));
    await insertLote(pid, 'L-ANTES', 5, dias(2));
    await insertLote(pid, 'L-SINFECHA', 10, null);

    const res = await post('/ventas', {
      producto_id: pid,
      unidades: 7,
      canal: 'POS',
    });
    expect(res.status).toBe(201);
    const lotes = await lotesDe(pid);
    const por = Object.fromEntries(lotes.map((l) => [l.codigo, l.cantidad_actual]));
    expect(por).toEqual({ 'L-ANTES': 0, 'L-MEDIO': 3, 'L-SINFECHA': 10 });
  });

  it('venta mayor a la suma de lotes: todos quedan en 0, el remanente va al contador', async () => {
    const pid = P['Frescos'][1];
    await setStock(pid, 5); // divergencia deliberada: contador < lotes
    await insertLote(pid, 'L-1', 10, dias(3));
    const res = await post('/ventas', {
      producto_id: pid,
      unidades: 15,
      canal: 'POS',
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.stock_nuevo).toBe(-10); // sobreventa T30.2
    expect((await lotesDe(pid))[0].cantidad_actual).toBe(0);
  });

  it('producto sin lotes: la venta igual descuenta el contador (compat)', async () => {
    const pid = P['Almacén'][0];
    await setStock(pid, 8);
    const res = await post('/ventas', {
      producto_id: pid,
      unidades: 3,
      canal: 'POS',
    });
    expect(res.status).toBe(201);
    expect((await res.json()).data.stock_nuevo).toBe(5);
  });

  it('batch con el mismo producto dos veces descuenta acumulado FEFO', async () => {
    const pid = P['Frescos'][2];
    await setStock(pid, 12);
    await insertLote(pid, 'L-A', 4, dias(1));
    await insertLote(pid, 'L-B', 8, dias(9));
    const res = await post('/ventas/batch', [
      { producto_id: pid, unidades: 3, canal: 'POS' },
      { producto_id: pid, unidades: 4, canal: 'WEB' },
    ]);
    expect(res.status).toBe(201);
    const por = Object.fromEntries(
      (await lotesDe(pid)).map((l) => [l.codigo, l.cantidad_actual]),
    );
    expect(por).toEqual({ 'L-A': 0, 'L-B': 5 }); // 4+3 en FEFO
  });
});

describe('Ajustes (POST /api/stock/ajuste)', () => {
  it('la baja sale en FEFO (la merma se cobra al que vence antes)', async () => {
    const pid = P['Frescos'][3];
    await setStock(pid, 15);
    await insertLote(pid, 'L-LEJOS', 10, dias(30));
    await insertLote(pid, 'L-CERCA', 5, dias(2));
    const res = await post('/stock/ajuste', {
      producto_id: pid,
      motivo: 'MERMA',
      delta: -4,
    });
    expect(res.status).toBe(201);
    const por = Object.fromEntries(
      (await lotesDe(pid)).map((l) => [l.codigo, l.cantidad_actual]),
    );
    expect(por).toEqual({ 'L-CERCA': 1, 'L-LEJOS': 10 });
  });

  it('el conteo que encuentra unidades crea lote AJUSTE sin vencimiento', async () => {
    const pid = P['Frescos'][4];
    await setStock(pid, 5);
    await insertLote(pid, 'L-1', 5, dias(4));
    const res = await post('/stock/ajuste', {
      producto_id: pid,
      motivo: 'CONTEO',
      cantidad_nueva: 9,
    });
    expect(res.status).toBe(201);
    const lotes = await lotesDe(pid);
    const nuevo = lotes.find((l) => l.origen === 'AJUSTE');
    expect(nuevo).toBeTruthy();
    expect(nuevo.cantidad_actual).toBe(4);
    expect(nuevo.vto).toBeNull();
    expect(nuevo.codigo).toMatch(/^AJU-\d+$/);
  });
});

describe('Recepción de OC (POST /api/ordenes/:id/recibir)', () => {
  const crearOcEnviada = async (productoId, ordenId) => {
    const prov = await db.get(
      'SELECT proveedor_id FROM productos WHERE id = ?',
      [productoId],
    );
    await db
      .prepare(
        `INSERT INTO ordenes_compra
           (orden_id, producto_id, proveedor_id, cantidad, precio_unitario,
            monto_total, estado, requiere_aprobacion, enviado_por, fecha_envio)
         VALUES (?, ?, ?, 10, 100, 1000, 'ENVIADA', 1, 'test', now())`,
      )
      .run(ordenId, productoId, prov.proveedor_id);
  };

  it('crea el lote del ingreso con la fecha del remito y la OC linkeada', async () => {
    const pid = P['Frescos'][5];
    await setStock(pid, 0);
    await crearOcEnviada(pid, 'OC-501');
    const res = await post(
      '/ordenes/OC-501/recibir',
      { cantidad_recibida: 10, fecha_vencimiento: dias(6) },
      aprobador,
    );
    expect(res.status).toBe(200);
    const [lote] = await lotesDe(pid);
    expect(lote.codigo).toBe('OC-501');
    expect(lote.cantidad_actual).toBe(10);
    expect(lote.vto).toBe(dias(6));
    expect(lote.origen).toBe('OC');
    expect(lote.orden_id).toBeGreaterThan(0);
  });

  it('sin fecha usa el default hoy + vida_util_dias (perecedero)', async () => {
    const pid = P['Frescos'][6];
    await crearOcEnviada(pid, 'OC-502');
    const res = await post(
      '/ordenes/OC-502/recibir',
      {},
      aprobador,
    );
    expect(res.status).toBe(200);
    const [lote] = await lotesDe(pid);
    expect(lote.vto).toBe(dias(await vidaDe(pid)));
  });

  it('no perecedero: el lote nace sin fecha_vencimiento', async () => {
    const pid = P['Perfumería'][0];
    await crearOcEnviada(pid, 'OC-503');
    const res = await post(
      '/ordenes/OC-503/recibir',
      {},
      aprobador,
    );
    expect(res.status).toBe(200);
    const [lote] = await lotesDe(pid);
    expect(lote.vto).toBeNull();
  });

  it('rechaza fecha_vencimiento con formato inválido (400)', async () => {
    const pid = P['Frescos'][7];
    await crearOcEnviada(pid, 'OC-504');
    const res = await post(
      '/ordenes/OC-504/recibir',
      { fecha_vencimiento: 'mañana' },
      aprobador,
    );
    expect(res.status).toBe(400);
    // La OC sigue ENVIADA — el 400 no la recibió a medias.
    const { estado } = await db.get(
      "SELECT estado FROM ordenes_compra WHERE orden_id = 'OC-504'",
    );
    expect(estado).toBe('ENVIADA');
  });
});

describe('GET /api/lotes', () => {
  it('lista con estado calculado, días restantes y valor en riesgo', async () => {
    const pid = P['Frescos'][8];
    await insertLote(pid, 'L-VENCIDO', 3, dias(-2));
    await insertLote(pid, 'L-PROXIMO', 4, dias(1));
    await insertLote(pid, 'L-SANO', 5, dias(60));
    await insertLote(pid, 'L-SIN', 6, null);

    const res = await get(`/lotes?producto_id=${pid}&limit=10`);
    expect(res.status).toBe(200);
    const body = await res.json();
    const por = Object.fromEntries(body.data.map((l) => [l.codigo, l]));
    expect(por['L-VENCIDO'].estado).toBe('VENCIDO');
    expect(por['L-VENCIDO'].dias_restantes).toBe(-2);
    expect(por['L-PROXIMO'].estado).toBe('PROXIMO'); // Frescos ventana 5d
    expect(por['L-SANO'].estado).toBe('VIGENTE');
    expect(por['L-SIN'].estado).toBe('VIGENTE');
    expect(por['L-SIN'].dias_restantes).toBeNull();
    // valor_en_riesgo = cantidad × costo principal — existe fila pp.
    expect(por['L-VENCIDO'].valor_en_riesgo).toBeGreaterThan(0);
    // Orden: lo accionable primero por fecha, sin-vencimiento atrás.
    expect(body.data[0].codigo).toBe('L-VENCIDO');
    expect(body.data.at(-1).codigo).toBe('L-SIN');
  });

  it('filtra por estado y pagina', async () => {
    const pid = P['Almacén'][1];
    await insertLote(pid, 'L-A', 2, dias(3));
    await insertLote(pid, 'L-B', 2, dias(400));
    const prox = await get(`/lotes?producto_id=${pid}&estado=PROXIMO`);
    const body = await prox.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].codigo).toBe('L-A');
    expect(body.pagination.total).toBe(1);
    const bad = await get(`/lotes?estado=CUALQUIERA`);
    expect(bad.status).toBe(400);
  });

  it('exige auth: 401 sin sesión, 403 BUYER', async () => {
    const sinAuth = await fetch(`${base}/api/lotes`);
    expect(sinAuth.status).toBe(401);
    expect((await get('/lotes', buyer)).status).toBe(403);
  });
});
