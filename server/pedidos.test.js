// @vitest-environment node
// SPEC-29 T29.3: GET /api/pedidos/sugerencia (hoja de compra del
// modal). SPEC-30 T30.4: POST /api/pedidos crea la OC real
// (PENDIENTE_APROBACION) y marca la alerta atendida atómicamente.
// Roles: BUYER y ADMIN.
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

// Fixture: alerta no leída sobre el producto del par pp (la que
// originaría el pedido del buyer). Devuelve el id.
const nuevaAlerta = async (productoId = pp.producto_id, leida = 0) => {
  const { id } = await db
    .prepare(
      `INSERT INTO alertas (tipo, producto_id, severidad, mensaje, leida)
       VALUES ('QUIEBRE', ?, 'ALTA', 'fixture pedido', ?) RETURNING id`,
    )
    .get(productoId, leida);
  return id;
};

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

describe('T30.4 — POST /api/pedidos crea la OC real', () => {
  it('201: crea la OC PENDIENTE_APROBACION y marca la alerta leída', async () => {
    const alertaId = await nuevaAlerta();
    const r = await req('/pedidos', {
      method: 'POST',
      body: {
        producto_id: pp.producto_id,
        proveedor_id: pp.proveedor_id,
        cantidad: 5,
        alerta_id: alertaId,
      },
    });
    expect(r.status).toBe(201);
    const { ok, data } = await r.json();
    expect(ok).toBe(true);
    // OC real: PENDIENTE_APROBACION forzada — el buyer pide, el
    // aprobador firma (no auto-aprueba aunque el monto sea bajo).
    expect(data.orden_id).toMatch(/^OC-/);
    expect(data.estado).toBe('PENDIENTE_APROBACION');
    expect(data.requiere_aprobacion).toBe(true);
    expect(data.cantidad).toBe(5);
    expect(data.proveedor.id).toBe(pp.proveedor_id);
    // La alerta quedó atendida en la misma tx.
    const { leida } = await db
      .prepare('SELECT leida FROM alertas WHERE id = ?')
      .get(alertaId);
    expect(leida).toBe(1);
    // Trazabilidad: la OC registra la alerta que la originó.
    const oc = await db
      .prepare('SELECT alerta_id FROM ordenes_compra WHERE orden_id = ?')
      .get(data.orden_id);
    expect(oc.alerta_id).toBe(alertaId);
  });

  it('idempotente: retry sobre la misma alerta → 409, sin segunda OC', async () => {
    const alertaId = await nuevaAlerta();
    const body = {
      producto_id: pp.producto_id,
      proveedor_id: pp.proveedor_id,
      cantidad: 3,
      alerta_id: alertaId,
    };
    expect((await req('/pedidos', { method: 'POST', body })).status).toBe(201);
    const antes = await db
      .prepare('SELECT COUNT(*) AS c FROM ordenes_compra WHERE alerta_id = ?')
      .get(alertaId);
    const r2 = await req('/pedidos', { method: 'POST', body });
    expect(r2.status).toBe(409);
    const despues = await db
      .prepare('SELECT COUNT(*) AS c FROM ordenes_compra WHERE alerta_id = ?')
      .get(alertaId);
    expect(despues.c).toBe(antes.c);
  });

  it('si la OC falla dentro de la tx, la alerta NO queda leída (rollback)', async () => {
    const alertaId = await nuevaAlerta();
    // Fuerzo el fallo post-marca: una OC previa ya reclamó esta
    // alerta_id → el INSERT choca contra idx_ordenes_alerta → la tx
    // hace rollback del UPDATE leida=1 también.
    await db
      .prepare(
        `INSERT INTO ordenes_compra
           (orden_id, producto_id, proveedor_id, cantidad, precio_unitario,
            monto_total, estado, requiere_aprobacion, alerta_id)
         VALUES ('OC-900', ?, ?, 1, 1, 1, 'PENDIENTE_APROBACION', 1, ?)`,
      )
      .run(pp.producto_id, pp.proveedor_id, alertaId);
    const r = await req('/pedidos', {
      method: 'POST',
      body: { producto_id: pp.producto_id, proveedor_id: pp.proveedor_id, cantidad: 2, alerta_id: alertaId },
    });
    expect(r.status).toBe(500);
    const { leida } = await db
      .prepare('SELECT leida FROM alertas WHERE id = ?')
      .get(alertaId);
    expect(leida).toBe(0); // rollback — queda reintentable
  });

  it('409 si la alerta ya estaba leída y 400 si no corresponde al producto', async () => {
    const leidaId = await nuevaAlerta(pp.producto_id, 1);
    const r = await req('/pedidos', {
      method: 'POST',
      body: { producto_id: pp.producto_id, proveedor_id: pp.proveedor_id, cantidad: 2, alerta_id: leidaId },
    });
    expect(r.status).toBe(409);

    const otroProducto = seedData.productos.find((p) => p.id !== pp.producto_id).id;
    const alertaOtro = await nuevaAlerta(otroProducto);
    const r2 = await req('/pedidos', {
      method: 'POST',
      body: { producto_id: pp.producto_id, proveedor_id: pp.proveedor_id, cantidad: 2, alerta_id: alertaOtro },
    });
    expect(r2.status).toBe(400);
  });

  it('400 en payload inválido, cota de cantidad y proveedor sin precio', async () => {
    for (const body of [
      {},
      { producto_id: pp.producto_id },
      { producto_id: pp.producto_id, proveedor_id: pp.proveedor_id, cantidad: 0 },
      { producto_id: pp.producto_id, proveedor_id: pp.proveedor_id, cantidad: 2.5 },
      { producto_id: pp.producto_id, proveedor_id: pp.proveedor_id, cantidad: 5, alerta_id: -1 },
      { producto_id: pp.producto_id, proveedor_id: pp.proveedor_id, cantidad: 10_001 },
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

  it('roles: BUYER y ADMIN crean, GERENTE y anónimo no', async () => {
    const body = { producto_id: pp.producto_id, proveedor_id: pp.proveedor_id, cantidad: 1 };
    expect((await req('/pedidos', { method: 'POST', sesion: admin, body })).status).toBe(201);
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
