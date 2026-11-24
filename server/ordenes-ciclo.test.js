// @vitest-environment node
// Tests del ciclo OC hacia el proveedor (SPEC-30 T30.1):
// POST /api/ordenes/:id/enviar (APROBADA→ENVIADA) y /recibir
// (ENVIADA→RECIBIDA) — este último suma stock + historial_stock
// en la misma transacción, con cantidad_recibida parcial.
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { closeDb, openDb } from './db.js';
import { seedData } from './seed-data.js';
import { loginComo } from './test-auth.js';

let server;
let base;
let aprobador;
let servicio;
const db = await openDb({ searchPath: 't_ciclo' });

beforeEach(async () => {
  const app = await createApp();
  server = app.listen(0);
  base = `http://localhost:${server.address().port}`;
  aprobador ??= await loginComo(base, 'APROBADOR');
  servicio ??= await loginComo(base, 'SERVICIO');
});

afterEach(() => server?.close());
afterAll(() => closeDb(true));

const post = (path, body, sesion = aprobador) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...sesion.headers },
    body: JSON.stringify(body ?? {}),
  });

const enviar = (id, sesion) => post(`/api/ordenes/${id}/enviar`, {}, sesion);
const recibir = (id, cantidad, sesion) =>
  post(`/api/ordenes/${id}/recibir`, cantidad == null ? {} : { cantidad_recibida: cantidad }, sesion);

const ordenSeed = (estado) => seedData.ordenes_compra.find((o) => o.estado === estado).orden_id;

const stockDe = async (ordenId) => {
  const { producto_id } = await db
    .prepare('SELECT producto_id FROM ordenes_compra WHERE orden_id = ?')
    .get(ordenId);
  const { stock_actual } = await db
    .prepare('SELECT stock_actual FROM productos WHERE id = ?')
    .get(producto_id);
  return { producto_id, stock_actual };
};

describe('POST /api/ordenes/:id/enviar', () => {
  it('APROBADA → ENVIADA con enviado_por y fecha_envio', async () => {
    const id = ordenSeed('APROBADA');
    const res = await enviar(id);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.estado).toBe('ENVIADA');
    expect(body.data.enviado_por).toBe('maria.lopez@mercadorai.com');
    expect(body.data.fecha_envio).toBeTruthy();
  });

  it('rechaza estados inválidos con 409 (PENDIENTE, ENVIADA, RECHAZADA)', async () => {
    for (const estado of ['PENDIENTE_APROBACION', 'ENVIADA', 'RECHAZADA']) {
      const res = await enviar(ordenSeed(estado));
      expect(res.status).toBe(409);
      expect((await res.json()).estado).toBe(estado);
    }
  });

  it('devuelve 404 si la orden no existe', async () => {
    const res = await enviar('OC-999');
    expect(res.status).toBe(404);
  });

  it('exige rol aprobador: SERVICIO recibe 403 y sin auth 401', async () => {
    const id = ordenSeed('APROBADA');
    expect((await enviar(id, servicio)).status).toBe(403);
    const sinAuth = await fetch(`${base}/api/ordenes/${id}/enviar`, { method: 'POST' });
    expect(sinAuth.status).toBe(401);
  });
});

describe('POST /api/ordenes/:id/recibir', () => {
  it('ENVIADA → RECIBIDA suma stock completo y escribe historial_stock', async () => {
    const id = ordenSeed('ENVIADA');
    const { cantidad } = await db
      .prepare('SELECT cantidad FROM ordenes_compra WHERE orden_id = ?')
      .get(id);
    const antes = await stockDe(id);
    const res = await recibir(id); // sin cantidad → llega todo
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.estado).toBe('RECIBIDA');
    expect(body.data.cantidad_recibida).toBe(cantidad);
    expect(body.data.faltante).toBe(0);
    expect(body.data.stock_actual).toBe(antes.stock_actual + cantidad);

    const mov = await db
      .prepare(
        `SELECT tipo_movimiento, cantidad_anterior, cantidad_nueva, diferencia, referencia, usuario
         FROM historial_stock WHERE producto_id = ? AND referencia = ?`,
      )
      .get(antes.producto_id, id);
    expect(mov).toMatchObject({
      tipo_movimiento: 'REPOSICION',
      cantidad_anterior: antes.stock_actual,
      cantidad_nueva: antes.stock_actual + cantidad,
      diferencia: cantidad,
      usuario: 'maria.lopez@mercadorai.com',
    });
  });

  it('recepción parcial registra el faltante medible', async () => {
    // Orden fresca APROBADA (sin aprobación) → enviar → recibir menos.
    const creada = await post('/api/ordenes', {
      producto_id: seedData.productos[2].id,
      cantidad: 10,
      requiere_aprobacion: false,
      analisis_ia: 'test ciclo',
    }, servicio);
    const { data: nueva } = await creada.json();
    await enviar(nueva.orden_id, aprobador);
    const antes = await stockDe(nueva.orden_id);

    const res = await recibir(nueva.orden_id, 7);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.cantidad_recibida).toBe(7);
    expect(body.data.faltante).toBe(3);
    expect(body.data.stock_actual).toBe(antes.stock_actual + 7);
  });

  it('valida cantidad_recibida: 0, > pedida o no entera → 400', async () => {
    // Una nueva ENVIADA para validar sin mutar el seed compartido.
    const creada = await post('/api/ordenes', {
      producto_id: seedData.productos[3].id,
      cantidad: 5,
      requiere_aprobacion: false,
    }, servicio);
    const { data: nueva } = await creada.json();
    await enviar(nueva.orden_id, aprobador);
    for (const mala of [0, -1, 6, 2.5, 'tres']) {
      expect((await recibir(nueva.orden_id, mala)).status).toBe(400);
    }
  });

  it('rechaza 409 en estados inválidos', async () => {
    expect((await recibir(ordenSeed('PENDIENTE_APROBACION'))).status).toBe(409);
    expect((await recibir(ordenSeed('RECHAZADA'))).status).toBe(409);
    expect((await recibir('OC-999')).status).toBe(404);
  });

  // Helper: orden ENVIADA propia por test (sin depender del orden
  // de ejecución ni de mutar seeds compartidos).
  const nuevaEnviada = async () => {
    const creada = await post('/api/ordenes', {
      producto_id: seedData.productos[4].id,
      cantidad: 4,
      requiere_aprobacion: false,
    }, servicio);
    const { data: nueva } = await creada.json();
    await enviar(nueva.orden_id, aprobador);
    return nueva.orden_id;
  };

  it('es idempotente: un segundo /recibir → 409 y el stock no sube de nuevo', async () => {
    const id = await nuevaEnviada();
    await recibir(id);
    const antes = await stockDe(id);
    const res = await recibir(id);
    expect(res.status).toBe(409);
    expect((await stockDe(id)).stock_actual).toBe(antes.stock_actual);
  });

  it('dos /recibir concurrentes: uno gana, el otro 409 — una sola suma', async () => {
    const id = await nuevaEnviada();
    const { cantidad } = await db
      .prepare('SELECT cantidad FROM ordenes_compra WHERE orden_id = ?')
      .get(id);
    const antes = await stockDe(id);
    const [a, b] = await Promise.all([recibir(id), recibir(id)]);
    const estados = [a.status, b.status].sort();
    expect(estados).toEqual([200, 409]);
    // Exactamente una suma — el guard de estado dentro del lock lo
    // garantiza (FOR UPDATE + verificación post-lock en la tx).
    expect((await stockDe(id)).stock_actual).toBe(antes.stock_actual + cantidad);
    const movs = await db
      .prepare(
        `SELECT COUNT(*) AS c FROM historial_stock h
         JOIN ordenes_compra o ON o.producto_id = h.producto_id
         WHERE o.orden_id = ? AND h.referencia = ? AND h.tipo_movimiento = 'REPOSICION'`,
      )
      .get(id, id);
    expect(movs.c).toBe(1);
  });
});
