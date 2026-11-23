// @vitest-environment node
// SPEC-26 (R26.5): CRUD /api/proveedores solo ADMIN. Schema aislado
// compartido por archivo — los fixtures propios se nombran 'ZZTest%'
// y se limpian por fila al final para no ensuciar el seed.
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { closeDb, openDb } from './db.js';
import { seedData } from './seed-data.js';
import { loginComo } from './test-auth.js';

let server;
let base;
let sesion; // ADMIN — el único rol que puede /api/proveedores
const db = await openDb({ searchPath: 't_proveedores' });

beforeEach(async () => {
  const app = await createApp();
  server = app.listen(0);
  base = `http://localhost:${server.address().port}`;
  sesion ??= await loginComo(base, 'ADMIN');
});

afterEach(() => server?.close());
afterAll(async () => {
  await db.run("DELETE FROM proveedores WHERE nombre LIKE 'ZZTest%'");
  await closeDb(true);
});

const req = (path, method = 'GET', body, headers = sesion.headers) =>
  fetch(`${base}/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json', ...headers } : headers,
    body: body ? JSON.stringify(body) : undefined,
  });

const PROVEEDORES_SEED = seedData.proveedores.length; // 7
const ESTADOS_VIVOS = ['PENDIENTE_APROBACION', 'ENVIADA'];
const provConOrdenViva = () =>
  seedData.ordenes_compra.find((o) => ESTADOS_VIVOS.includes(o.estado)).proveedor_id;
const provSinOrdenViva = () =>
  seedData.proveedores.find(
    (p) =>
      !seedData.ordenes_compra.some(
        (o) => o.proveedor_id === p.id && ESTADOS_VIVOS.includes(o.estado),
      ),
  );

const crearFixture = (over = {}) =>
  req('/proveedores', 'POST', {
    nombre: `ZZTest ${Date.now()}${Math.random().toString(16).slice(2)}`,
    tiempo_entrega_dias: 2,
    ...over,
  }).then((r) => r.json().then((b) => ({ status: r.status, body: b })));

describe('GET /api/proveedores — control de acceso', () => {
  it('401 sin token', async () => {
    const r = await fetch(`${base}/api/proveedores`);
    expect(r.status).toBe(401);
  });

  it.each(['GERENTE', 'APROBADOR', 'SERVICIO'])('403 con rol %s', async (rol) => {
    const otra = await loginComo(base, rol);
    const r = await req('/proveedores', 'GET', undefined, otra.headers);
    expect(r.status).toBe(403);
  });
});

describe('GET /api/proveedores', () => {
  it('lista los proveedores del seed con el contrato estándar', async () => {
    const r = await req('/proveedores');
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.pagination).toMatchObject({
      page: 1,
      limit: 20,
      total: PROVEEDORES_SEED,
    });
    expect(body.data).toHaveLength(PROVEEDORES_SEED);
    expect(body.data[0]).toMatchObject({
      id: expect.any(Number),
      nombre: expect.any(String),
      tiempo_entrega_dias: expect.any(Number),
      categorias_cubiertas: expect.any(Array),
      activo: 1,
    });
  });

  it('filtra por activo y search', async () => {
    const todos = await (await req('/proveedores?activo=1')).json();
    expect(todos.data.every((p) => p.activo === 1)).toBe(true);

    const buscado = await (
      await req(`/proveedores?search=${encodeURIComponent(seedData.proveedores[0].nombre)}`)
    ).json();
    expect(buscado.data).toHaveLength(1);
    expect(buscado.data[0].id).toBe(seedData.proveedores[0].id);

    const r = await req('/proveedores?activo=2');
    expect(r.status).toBe(400);
  });

  it('detalle por id, 404 y 400', async () => {
    const r = await req(`/proveedores/${seedData.proveedores[0].id}`);
    expect(r.status).toBe(200);
    expect((await r.json()).nombre).toBe(seedData.proveedores[0].nombre);
    expect((await req('/proveedores/9999')).status).toBe(404);
    expect((await req('/proveedores/abc')).status).toBe(400);
  });
});

describe('POST /api/proveedores', () => {
  it('crea con todos los campos comerciales (R26.4)', async () => {
    const { status, body } = await crearFixture({
      contacto: 'Contacto Test',
      telefono: '+54 11 0000-0000',
      email: 'test@proveedor.com',
      tiempo_entrega_min_dias: 1,
      tiempo_entrega_max_dias: 3,
      confiabilidad_pct: 90,
      pedido_minimo_monto: 50000,
      costo_envio: 3000,
      categorias_cubiertas: ['Almacén'],
    });
    expect(status).toBe(201);
    expect(body).toMatchObject({
      id: expect.any(Number),
      tiempo_entrega_min_dias: 1,
      tiempo_entrega_max_dias: 3,
      confiabilidad_pct: 90,
      pedido_minimo_monto: 50000,
      costo_envio: 3000,
      categorias_cubiertas: ['Almacén'],
      activo: 1,
    });
  });

  it.each([
    [{ tiempo_entrega_dias: 2 }, 'sin nombre'],
    [
      { nombre: 'ZZTest rango', tiempo_entrega_min_dias: 5, tiempo_entrega_max_dias: 2 },
      'min > max',
    ],
    [{ nombre: 'ZZTest conf', confiabilidad_pct: 101 }, 'confiabilidad > 100'],
    [{ nombre: 'ZZTest cats', categorias_cubiertas: 'Almacén' }, 'categorias no array'],
    [{ nombre: 'ZZTest lead', tiempo_entrega_dias: -1 }, 'lead negativo'],
    [{ nombre: 'ZZTest monto', pedido_minimo_monto: -5 }, 'monto negativo'],
  ])('400 con %s', async (body, _caso) => {
    const r = await req('/proveedores', 'POST', body);
    expect(r.status).toBe(400);
  });

  it('409 con nombre duplicado (case-insensitive)', async () => {
    const r = await req('/proveedores', 'POST', {
      nombre: seedData.proveedores[0].nombre.toLowerCase(),
    });
    expect(r.status).toBe(409);
  });
});

describe('PATCH /api/proveedores/:id', () => {
  it('actualiza campos y devuelve el proveedor', async () => {
    const { body: creado } = await crearFixture();
    const r = await req(`/proveedores/${creado.id}`, 'PATCH', {
      contacto: 'Nuevo Contacto',
      tiempo_entrega_max_dias: 6,
      costo_envio: 1234.5,
    });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({
      contacto: 'Nuevo Contacto',
      tiempo_entrega_max_dias: 6,
      costo_envio: 1234.5,
    });
  });

  it('valida el rango fusionado (patch parcial) y nada-que-actualizar', async () => {
    const { body: creado } = await crearFixture({ tiempo_entrega_min_dias: 4 });
    const rango = await req(`/proveedores/${creado.id}`, 'PATCH', {
      tiempo_entrega_max_dias: 2, // < min existente
    });
    expect(rango.status).toBe(400);
    expect((await req(`/proveedores/${creado.id}`, 'PATCH', {})).status).toBe(400);
    expect((await req('/proveedores/9999', 'PATCH', { nombre: 'X' })).status).toBe(404);
  });

  it('409 al renombrar pisando el nombre de otro proveedor', async () => {
    const { body: creado } = await crearFixture();
    const r = await req(`/proveedores/${creado.id}`, 'PATCH', {
      nombre: seedData.proveedores[0].nombre.toUpperCase(),
    });
    expect(r.status).toBe(409);
    // Renombrar a sí mismo (solo case) no choca consigo mismo.
    const self = await req(`/proveedores/${seedData.proveedores[0].id}`, 'PATCH', {
      nombre: seedData.proveedores[0].nombre.toLowerCase(),
    });
    expect(self.status).toBe(200);
    await req(`/proveedores/${seedData.proveedores[0].id}`, 'PATCH', {
      nombre: seedData.proveedores[0].nombre,
    }); // restaurar el nombre del seed
  });

  it('desactivar por PATCH corre el mismo guard de órdenes vivas', async () => {
    const id = provConOrdenViva();
    const r = await req(`/proveedores/${id}`, 'PATCH', { activo: 0 });
    expect(r.status).toBe(409);
  });

  it('reactiva un proveedor inactivo', async () => {
    const { body: creado } = await crearFixture();
    await req(`/proveedores/${creado.id}`, 'PATCH', { activo: 0 });
    const r = await req(`/proveedores/${creado.id}`, 'PATCH', { activo: 1 });
    expect(r.status).toBe(200);
    expect((await r.json()).activo).toBe(1);
  });
});

describe('DELETE /api/proveedores/:id', () => {
  it('409 si el proveedor tiene órdenes vivas (PENDIENTE/ENVIADA)', async () => {
    const id = provConOrdenViva();
    const r = await req(`/proveedores/${id}`, 'DELETE');
    expect(r.status).toBe(409);
    // No se tocó: sigue activo.
    expect((await (await req(`/proveedores/${id}`)).json()).activo).toBe(1);
  });

  it('soft delete (activo=0) cuando no hay órdenes vivas', async () => {
    // El seed puede no tener proveedor sin órdenes vivas — fallback a fixture.
    let id = provSinOrdenViva()?.id;
    let esFixture = false;
    if (id === undefined) {
      id = (await crearFixture()).body.id;
      esFixture = true;
    }
    const r = await req(`/proveedores/${id}`, 'DELETE');
    expect(r.status).toBe(200);
    expect((await r.json()).activo).toBe(0);
    // Idempotente: segundo DELETE devuelve 200 con activo=0.
    expect((await req(`/proveedores/${id}`, 'DELETE')).status).toBe(200);
    if (esFixture) await db.run('DELETE FROM proveedores WHERE id = ?', [id]);
    else await req(`/proveedores/${id}`, 'PATCH', { activo: 1 }); // restaurar el seed
  });

  it('404 y 400', async () => {
    expect((await req('/proveedores/9999', 'DELETE')).status).toBe(404);
    expect((await req('/proveedores/abc', 'DELETE')).status).toBe(400);
  });
});
