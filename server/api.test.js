// @vitest-environment node
// Tests de la API del dominio contra una DB SQLite en memoria — el
// singleton de db.js seedea schema.sql + seed-data.js en ':memory:'.
// Server fresco por test: el rate limit de POSTs (20/min por IP, en
// una closure por instancia de app) no se comparte entre tests; la DB
// sí persiste (singleton), así que los describes están ordenados:
// primero lecturas, después mutaciones.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { openDb } from './db.js';
import { seedData } from './seed-data.js';
import { UMBRAL_APROBACION } from './models/ordenes.model.js';
import { loginComo } from './test-auth.js';

let server;
let base;
let sesion; // 1 login por archivo — el JWT es stateless (SPEC-23)
const db = openDb(':memory:');

beforeEach(async () => {
  const app = await createApp();
  server = app.listen(0);
  base = `http://localhost:${server.address().port}`;
  // GERENTE: aprueba órdenes — la suite ejercita ese camino.
  sesion ??= await loginComo(base, 'GERENTE');
});

afterEach(() => server?.close());

const get = (path) => fetch(`${base}/api${path}`, { headers: sesion.headers });
const post = (path, body) =>
  fetch(`${base}/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...sesion.headers },
    body: JSON.stringify(body),
  });

const ORDENES_SEED = seedData.ordenes_compra.length; // 11
const PENDIENTES_SEED = seedData.ordenes_compra.filter(
  (o) => o.estado === 'PENDIENTE_APROBACION',
).length; // 4

describe('GET /api/ordenes', () => {
  it('lista todas las órdenes con paginación por defecto', async () => {
    const res = await get('/ordenes');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(ORDENES_SEED);
    expect(body.pagination).toEqual({
      page: 1,
      limit: 20,
      total: ORDENES_SEED,
      totalPages: 1,
    });
    // shape del contrato: producto{} y proveedor{} anidados
    const orden = body.data[0];
    expect(orden.orden_id).toMatch(/^OC-\d{3}$/);
    expect(orden.producto).toMatchObject({ sku: expect.any(String), nombre: expect.any(String) });
    expect(orden.proveedor).toMatchObject({ nombre: expect.any(String) });
  });

  it('filtra por estado', async () => {
    const res = await get('/ordenes?estado=PENDIENTE_APROBACION');
    const body = await res.json();
    expect(body.data).toHaveLength(PENDIENTES_SEED);
    expect(body.data.every((o) => o.estado === 'PENDIENTE_APROBACION')).toBe(true);
  });

  it('filtra por requiere_aprobacion y por búsqueda', async () => {
    const res = await get('/ordenes?requiere_aprobacion=true');
    const body = await res.json();
    const esperadas = ORDENES_SEED - seedData.ordenes_compra.filter((o) => !o.requiere_aprobacion).length;
    expect(body.pagination.total).toBe(esperadas);
    expect(body.data.every((o) => o.requiere_aprobacion === true)).toBe(true);

    // Búsqueda por nombre de proveedor — el de OC-002 sale del seed
    // (SPEC-22: proveedores reales por categoría, no hay 'Granja').
    const oc2 = seedData.ordenes_compra.find((o) => o.orden_id === 'OC-002');
    const provOc2 = seedData.proveedores.find((p) => p.id === oc2.proveedor_id).nombre;
    const resSearch = await get(`/ordenes?search=${encodeURIComponent(provOc2)}`);
    const bodySearch = await resSearch.json();
    expect(bodySearch.data.length).toBeGreaterThan(0);
    expect(bodySearch.data.every((o) => o.proveedor.nombre === provOc2)).toBe(true);
    expect(bodySearch.data.some((o) => o.orden_id === 'OC-002')).toBe(true);
  });

  it('filtra por rango de fechas', async () => {
    const res = await get('/ordenes?fecha_desde=2026-10-31');
    const body = await res.json();
    // OC-001..OC-004 fueron creadas el 31 — fecha sin hora incluye todo el día
    expect(body.pagination.total).toBe(4);

    const resHasta = await get('/ordenes?fecha_hasta=2026-10-30');
    expect((await resHasta.json()).pagination.total).toBe(ORDENES_SEED - 4);
  });

  it('ordena por monto_total ASC/DESC', async () => {
    const montos = seedData.ordenes_compra.map((o) => o.monto_total);
    const desc = await (await get('/ordenes?sort=monto_total&order=DESC')).json();
    expect(desc.data[0].monto_total).toBe(Math.max(...montos));
    const asc = await (await get('/ordenes?sort=monto_total&order=ASC')).json();
    expect(asc.data[0].monto_total).toBe(Math.min(...montos));
  });

  it('pagina con page/limit', async () => {
    const p2 = await (await get('/ordenes?limit=5&page=2')).json();
    expect(p2.data).toHaveLength(5);
    expect(p2.pagination).toMatchObject({ page: 2, limit: 5, total: ORDENES_SEED, totalPages: 3 });
    const p3 = await (await get('/ordenes?limit=5&page=3')).json();
    expect(p3.data).toHaveLength(ORDENES_SEED - 10);
  });

  it('rechaza parámetros inválidos con 400', async () => {
    for (const q of [
      'estado=INVENTADO',
      'sort=DROP_TABLE',
      'order=SIDEWAYS',
      'page=0',
      'limit=0',
      'limit=101',
      'requiere_aprobacion=quiza',
    ]) {
      const res = await get(`/ordenes?${q}`);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBeTruthy();
    }
  });
});

describe('GET /api/ordenes/:orden_id', () => {
  it('devuelve el detalle completo con producto y proveedor', async () => {
    const res = await get('/ordenes/OC-002');
    expect(res.status).toBe(200);
    const orden = await res.json();
    expect(orden.orden_id).toBe('OC-002');
    // OC-002 del seed apunta a un artículo real generado (SPEC-22) —
    // las expectativas se derivan del propio seed.
    const oc2 = seedData.ordenes_compra.find((o) => o.orden_id === 'OC-002');
    const prodOc2 = seedData.productos.find((p) => p.id === oc2.producto_id);
    const provOc2 = seedData.proveedores.find((p) => p.id === oc2.proveedor_id);
    expect(orden.producto).toMatchObject({
      sku: prodOc2.sku,
      nombre: prodOc2.nombre,
      stock_actual: prodOc2.stock_actual,
      stock_minimo: prodOc2.stock_minimo,
      estado: prodOc2.estado,
    });
    expect(orden.proveedor).toMatchObject({
      nombre: provOc2.nombre,
      tiempo_entrega_dias: provOc2.tiempo_entrega_dias,
    });
    expect(orden.monto_total).toBe(oc2.monto_total);
    expect(orden.analisis_ia).toBeTruthy();
  });

  it('devuelve 404 para una orden inexistente', async () => {
    const res = await get('/ordenes/OC-999');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/productos', () => {
  it('lista productos con estado recalculado desde stock', async () => {
    const res = await get('/productos');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pagination.total).toBe(seedData.productos.length);
    for (const p of body.data) {
      const esperado =
        p.stock_actual === 0 ? 'CRITICO' : p.stock_actual < p.stock_minimo ? 'STOCK_BAJO' : 'OK';
      expect(p.estado).toBe(esperado);
      expect(p.proveedor.nombre).toBeTruthy();
    }
  });

  it('filtra por estado, categoria, proveedor y búsqueda', async () => {
    // Catálogo real de 1.471 artículos (SPEC-22) — los conteos salen
    // del seed, no de valores hardcodeados.
    const esperadosCriticos = seedData.productos.filter((p) => p.stock_actual === 0).length;
    const critico = await (await get('/productos?estado=CRITICO&limit=100')).json();
    expect(critico.pagination.total).toBe(esperadosCriticos);
    expect(critico.data.every((p) => p.stock_actual === 0)).toBe(true);

    const bajo = await (await get('/productos?estado=STOCK_BAJO&limit=100')).json();
    const esperadosBajos = seedData.productos.filter(
      (p) => p.stock_actual < p.stock_minimo && p.stock_actual > 0,
    ).length;
    expect(bajo.pagination.total).toBe(esperadosBajos);
    expect(bajo.data.every((p) => p.stock_actual < p.stock_minimo && p.stock_actual > 0)).toBe(true);

    const cat = 'Almacén';
    const almacen = await (await get(`/productos?categoria=${encodeURIComponent(cat)}`)).json();
    expect(almacen.pagination.total).toBe(
      seedData.productos.filter((p) => p.categoria === cat).length,
    );

    const prov = await (await get('/productos?proveedor_id=2&limit=100')).json();
    expect(prov.pagination.total).toBe(
      seedData.productos.filter((p) => p.proveedor_id === 2).length,
    );

    const search = await (await get('/productos?search=yerba&limit=100')).json();
    const yerbas = seedData.productos.filter((p) => /yerba/i.test(p.nombre));
    expect(search.pagination.total).toBe(yerbas.length);
    expect(search.data.every((p) => /yerba/i.test(p.nombre))).toBe(true);
  });

  it('rechaza parámetros inválidos con 400', async () => {
    for (const q of ['estado=ROTO', 'proveedor_id=abc', 'page=-1']) {
      expect((await get(`/productos?${q}`)).status).toBe(400);
    }
  });
});

describe('GET /api/dashboard/stats', () => {
  it('devuelve los KPIs calculados sobre el seed', async () => {
    const res = await get('/dashboard/stats');
    expect(res.status).toBe(200);
    const stats = await res.json();

    expect(stats.ordenes_pendientes).toBe(PENDIENTES_SEED);
    expect(stats.productos_stock_bajo).toBe(
      seedData.productos.filter((p) => p.stock_actual < p.stock_minimo && p.stock_actual > 0).length,
    );
    expect(stats.productos_criticos).toBe(
      seedData.productos.filter((p) => p.stock_actual === 0).length,
    );

    // KPIs dependientes de la fecha — mismos cutoffs que el modelo
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 19);
    const monthStart = `${new Date().toISOString().slice(0, 7)}-01T00:00:00`;
    const aprobadasSemana = seedData.ordenes_compra.filter(
      (o) => o.estado === 'APROBADA' && o.fecha_aprobacion >= weekAgo,
    ).length;
    const valorMes = seedData.ordenes_compra
      .filter((o) => o.estado === 'APROBADA' && o.fecha_aprobacion >= monthStart)
      .reduce((s, o) => s + o.monto_total, 0);
    expect(stats.ordenes_aprobadas_semana).toBe(aprobadasSemana);
    expect(stats.valor_total_mes).toBeCloseTo(valorMes, 2);

    expect(stats.tendencia).toMatchObject({
      ordenes_pendientes_vs_ayer: expect.any(Number),
      ordenes_aprobadas_vs_semana_anterior: expect.any(Number),
    });
  });
});

// --- Mutaciones: van después de las lecturas para no mover los totales ---

describe('POST /api/ordenes', () => {
  // Precios reales ARS (SPEC-22): el umbral es $50.000 — 1 unidad de
  // cualquier artículo queda por debajo y auto-aprueba.
  const prod1 = seedData.productos.find((p) => p.id === 1);
  const cantidadSobreUmbral = Math.ceil(UMBRAL_APROBACION / prod1.precio_unitario);

  it('crea una orden bajo el umbral ($50.000) auto-aprobada con orden_id secuencial', async () => {
    const res = await post('/ordenes', { producto_id: 1, cantidad: 1 });
    expect(res.status).toBe(201);
    const { success, data } = await res.json();
    expect(success).toBe(true);
    expect(data.orden_id).toBe('OC-012'); // sigue al OC-011 del seed
    expect(data.monto_total).toBeCloseTo(prod1.precio_unitario, 2);
    expect(data.estado).toBe('APROBADA');
    expect(data.requiere_aprobacion).toBe(false);
    expect(data.aprobado_por).toBe('auto');
    expect(data.proveedor.id).toBe(prod1.proveedor_id); // proveedor tomado del producto
  });

  it('crea una orden sobre el umbral que queda PENDIENTE_APROBACION', async () => {
    const res = await post('/ordenes', {
      producto_id: 1,
      cantidad: cantidadSobreUmbral,
      analisis_ia: 'test',
    });
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.orden_id).toBe('OC-013');
    expect(data.monto_total).toBeGreaterThanOrEqual(UMBRAL_APROBACION);
    expect(data.estado).toBe('PENDIENTE_APROBACION');
    expect(data.requiere_aprobacion).toBe(true);
    expect(data.aprobado_por).toBeNull();
  });

  it('respeta el override explícito de requiere_aprobacion', async () => {
    const res = await post('/ordenes', { producto_id: 1, cantidad: 1, requiere_aprobacion: true });
    const { data } = await res.json();
    expect(data.monto_total).toBeCloseTo(prod1.precio_unitario, 2);
    expect(data.estado).toBe('PENDIENTE_APROBACION');
  });

  it('valida el body (400) y producto inexistente (404)', async () => {
    for (const body of [
      {},
      { producto_id: 'x', cantidad: 5 },
      { producto_id: 2 },
      { producto_id: 2, cantidad: 0 },
      { producto_id: 2, cantidad: -3 },
      { producto_id: 2, cantidad: 5, requiere_aprobacion: 'si' },
    ]) {
      expect((await post('/ordenes', body)).status).toBe(400);
    }
    expect((await post('/ordenes', { producto_id: 999999, cantidad: 5 })).status).toBe(404);
  });
});

describe('POST /api/ordenes/:orden_id/aprobar y /rechazar', () => {
  const crearPendiente = async () => {
    // requiere_aprobacion explícito: no depende del monto ni del umbral
    const res = await post('/ordenes', {
      producto_id: 3,
      cantidad: 40,
      requiere_aprobacion: true,
    });
    const { data } = await res.json();
    return data.orden_id;
  };

  it('aprueba una orden pendiente registrando aprobado_por y fecha', async () => {
    const ordenId = await crearPendiente();
    const res = await post(`/ordenes/${ordenId}/aprobar`, {
      aprobado_por: 'carlos.martinez@mercadorai.com',
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.estado).toBe('APROBADA');
    expect(data.aprobado_por).toBe('carlos.martinez@mercadorai.com');
    expect(data.fecha_aprobacion).toBeTruthy();
  });

  it('rechaza una orden pendiente con motivo', async () => {
    const ordenId = await crearPendiente();
    const res = await post(`/ordenes/${ordenId}/rechazar`, {
      rechazado_por: 'maria.lopez@mercadorai.com',
      motivo: 'Stock suficiente',
    });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.estado).toBe('RECHAZADA');
    expect(data.motivo).toBe('Stock suficiente');
  });

  it('exige motivo para rechazar (400)', async () => {
    const ordenId = await crearPendiente();
    expect((await post(`/ordenes/${ordenId}/rechazar`, {})).status).toBe(400);
    expect((await post(`/ordenes/${ordenId}/rechazar`, { motivo: '  ' })).status).toBe(400);
  });

  it('devuelve 409 al aprobar/rechazar una orden ya resuelta', async () => {
    const ordenId = await crearPendiente();
    await post(`/ordenes/${ordenId}/aprobar`, { aprobado_por: 'test' });
    const res = await post(`/ordenes/${ordenId}/aprobar`, { aprobado_por: 'test' });
    expect(res.status).toBe(409);
    expect((await res.json()).estado).toBe('APROBADA');
    expect(
      (await post(`/ordenes/${ordenId}/rechazar`, { motivo: 'tarde' })).status,
    ).toBe(409);
    // orden del seed ya auto-aprobada → también 409
    expect((await post('/ordenes/OC-001/aprobar', {})).status).toBe(409);
  });

  it('devuelve 404 para una orden inexistente', async () => {
    expect((await post('/ordenes/OC-999/aprobar', {})).status).toBe(404);
    expect((await post('/ordenes/OC-999/rechazar', { motivo: 'x' })).status).toBe(404);
  });
});

describe('estado de producto recalculado al leer', () => {
  it('un UPDATE de stock se refleja sin tocar la columna estado', async () => {
    // El artículo queda persistido como 'OK' pero le vaciamos el
    // stock — la API debe reportar CRITICO recalculando, no el valor
    // viejo de la columna.
    const prod = seedData.productos.find((p) => p.estado === 'OK');
    db.prepare('UPDATE productos SET stock_actual = 0 WHERE sku = ?').run(prod.sku);
    const res = await get(`/productos?search=${prod.sku}`);
    const body = await res.json();
    expect(body.data[0].estado).toBe('CRITICO');
  });
});
