// @vitest-environment node
// SPEC-32 (T32.7): la fuente de competencia es un cliente DWH —
// hoy simulado sobre el CSV, mañana una API externa — y el
// re-import es un upsert append-only por (producto, cadena, fecha).
import { createServer } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { closeDb, openDb } from './db.js';
import { seedData } from './seed-data.js';
import { fetchSnapshotCompetencia } from './integrations/competencia-dwh.js';
import { sincronizarCompetencia } from './models/competencia.model.js';
import { loginComo } from './test-auth.js';

const SCHEMA = 't_compsync';
const db = await openDb({ searchPath: SCHEMA });
const PROD = seedData.productos[10]; // artículo cualquiera con ean
const FECHA_BASE = '2026-11-20';

let server;
let base;
let admin;
let servicio;
let gerente;
let buyer;
let dwh;

beforeAll(async () => {
  const app = await createApp();
  server = app.listen(0);
  base = `http://localhost:${server.address().port}`;
  admin = await loginComo(base, 'ADMIN');
  servicio = await loginComo(base, 'SERVICIO');
  gerente = await loginComo(base, 'GERENTE');
  buyer = await loginComo(base, 'BUYER');
});

afterEach(() => {
  delete process.env.COMPETENCIA_DWH_URL;
  dwh?.close();
  dwh = undefined;
});

afterAll(async () => {
  server?.close();
  await closeDb(true);
});

describe('cliente DWH simulado', () => {
  it('sin URL configurada sirve el CSV con el contrato del API', async () => {
    const snap = await fetchSnapshotCompetencia();
    expect(snap.fuente).toBe('csv-simulado');
    expect(snap.fecha_snapshot).toBe(FECHA_BASE);
    expect(snap.items).toHaveLength(1471 * 4);
    // El join al catálogo es por ean — el item lo tiene que traer.
    expect(snap.items.every((i) => i.ean && i.cadena)).toBe(true);
    // Preserva las ausencias: precio null = la cadena no lo tenía.
    expect(snap.items.some((i) => i.precio == null)).toBe(true);
  });
});

describe('sincronizarCompetencia', () => {
  it('re-sync de la misma fecha es no-op (append-only, R32.1)', async () => {
    const antes = await db.get(`SELECT COUNT(*) AS c FROM precios_competencia`);
    const res = await sincronizarCompetencia();
    expect(res.fuente).toBe('csv-simulado');
    expect(res.fecha_snapshot).toBe(FECHA_BASE);
    expect(res.recibidas).toBe(1471 * 4);
    expect(res.insertadas).toBe(0); // todas ya existían
    expect(res.sin_match).toBe(0);
    const despues = await db.get(`SELECT COUNT(*) AS c FROM precios_competencia`);
    expect(despues.c).toBe(antes.c);
  });

  it('re-inserta filas borradas (idempotente por la UNIQUE)', async () => {
    await db.run(`DELETE FROM precios_competencia WHERE producto_id = ?`, [PROD.id]);
    const res = await sincronizarCompetencia();
    expect(res.insertadas).toBe(4); // una por cadena
    const { c } = await db.get(
      `SELECT COUNT(*) AS c FROM precios_competencia WHERE producto_id = ?`,
      [PROD.id],
    );
    expect(c).toBe(4);
  });

  it('DWH real: inserta una fecha nueva sin tocar el snapshot anterior', async () => {
    const eanValido = PROD.ean;
    dwh = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          fecha_snapshot: '2026-11-27',
          items: [
            { ean: eanValido, cadena: 'DIA', sku_cadena: 'D-1', precio: 999, precio_lista: 1200 },
            { ean: eanValido, cadena: 'COTO', sku_cadena: 'C-1', precio: 1050, precio_lista: null },
            { ean: 'EAN-INEXISTENTE', cadena: 'DIA', sku_cadena: 'X', precio: 1, precio_lista: null },
          ],
        }),
      );
    });
    await new Promise((r) => dwh.listen(0, r));
    process.env.COMPETENCIA_DWH_URL = `http://localhost:${dwh.address().port}/snapshot`;

    const res = await sincronizarCompetencia();
    expect(res.fuente).toBe('dwh');
    expect(res.insertadas).toBe(2);
    expect(res.sin_match).toBe(1);
    const filas = await db.all(
      `SELECT * FROM precios_competencia
        WHERE producto_id = ? AND fecha_snapshot = '2026-11-27' ORDER BY cadena`,
      [PROD.id],
    );
    expect(filas).toHaveLength(2);
    expect(filas[0].sku_cadena).toBe('C-1');
    // El snapshot viejo sigue intacto — conviven (append-only).
    const { c } = await db.get(
      `SELECT COUNT(*) AS c FROM precios_competencia
        WHERE producto_id = ? AND fecha_snapshot = ?`,
      [PROD.id, FECHA_BASE],
    );
    expect(c).toBe(4);
  });

  it('payload inválido del DWH revienta la sync (no inserta basura)', async () => {
    dwh = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ items: 'no-es-array' }));
    });
    await new Promise((r) => dwh.listen(0, r));
    process.env.COMPETENCIA_DWH_URL = `http://localhost:${dwh.address().port}`;
    await expect(sincronizarCompetencia()).rejects.toThrow(/payload/);
  });
});

describe('POST /api/competencia/sync', () => {
  it('sin token → 401', async () => {
    const res = await fetch(`${base}/api/competencia/sync`, { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('BUYER y GERENTE → 403 (solo ADMIN/SERVICIO disparan el re-import)', async () => {
    for (const sesion of [buyer, gerente]) {
      const res = await fetch(`${base}/api/competencia/sync`, {
        method: 'POST',
        headers: sesion.headers,
      });
      expect(res.status).toBe(403);
    }
  });

  it('ADMIN → 200 con el resumen del sync', async () => {
    const res = await fetch(`${base}/api/competencia/sync`, {
      method: 'POST',
      headers: admin.headers,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fuente).toBe('csv-simulado');
    expect(body.recibidas).toBe(1471 * 4);
  });

  it('SERVICIO → 200 (la integración la dispara la cuenta del agente)', async () => {
    const res = await fetch(`${base}/api/competencia/sync`, {
      method: 'POST',
      headers: servicio.headers,
    });
    expect(res.status).toBe(200);
  });

  it('DWH caído → 502 con el error upstream', async () => {
    // URL apuntando a un puerto cerrado → fetch rechaza.
    process.env.COMPETENCIA_DWH_URL = 'http://localhost:1/nada';
    const res = await fetch(`${base}/api/competencia/sync`, {
      method: 'POST',
      headers: admin.headers,
    });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/Fuente de competencia/);
  });
});
