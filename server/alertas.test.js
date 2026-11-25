// @vitest-environment node
// SPEC-29: /api/alertas (BUYER exclusivo) + motor de reglas + el
// lockdown del rol BUYER en el resto del dominio. Schema aislado;
// ventas se pueblan por fixture como en estadisticas.test.js.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { closeDb, openDb } from './db.js';
import { seedData } from './seed-data.js';
import { loginComo } from './test-auth.js';

let server;
let base;
let buyer;
let admin;
const db = await openDb({ searchPath: 't_alertas' });

beforeEach(async () => {
  const app = await createApp();
  server = app.listen(0);
  base = `http://localhost:${server.address().port}`;
  buyer ??= await loginComo(base, 'BUYER');
  admin ??= await loginComo(base, 'ADMIN');
});

afterAll(async () => {
  server?.close();
  await db.run('DELETE FROM alertas');
  await db.run('DELETE FROM ventas');
  await closeDb(true);
});

const get = (path, sesion = buyer) =>
  fetch(`${base}/api${path}`, { headers: sesion.headers });
const patch = (path, sesion = buyer) =>
  fetch(`${base}/api${path}`, { method: 'PATCH', headers: sesion.headers });
const post = (path, sesion = buyer) =>
  fetch(`${base}/api${path}`, { method: 'POST', headers: sesion.headers });

describe('R29.1 — lockdown del rol BUYER', () => {
  it(
    'BUYER solo accede a /api/alertas: 403 en todo el dominio',
    { timeout: 60_000 }, // el GET dispara la lazy-eval: ~1.5k inserts
    async () => {
      for (const ruta of [
        '/ordenes',
        '/productos',
        '/proveedores',
        '/usuarios',
        '/ventas',
        '/estadisticas/demanda?dias=30',
        '/estadisticas/metricas?dias=30',
        '/dashboard/stats',
      ]) {
        const r = await get(ruta);
        expect(r.status, ruta).toBe(403);
      }
      // y sí entra a alertas
      expect((await get('/alertas')).status).toBe(200);
    },
  );

  it('T30.6: GET abierto a roles operativos; escrituras siguen siendo del comprador', async () => {
    const gerente = await loginComo(base, 'GERENTE');
    const aprobador = await loginComo(base, 'APROBADOR');
    // La campanita del Topbar consume el GET — GERENTE/APROBADOR leen.
    expect((await get('/alertas', gerente)).status).toBe(200);
    expect((await get('/alertas', aprobador)).status).toBe(200);
    expect((await get('/alertas', admin)).status).toBe(200);
    // Marcar/re-evaluar quedan para BUYER/ADMIN — su cola de trabajo.
    expect(
      (
        await fetch(`${base}/api/alertas/evaluar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...gerente.headers },
          body: '{}',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${base}/api/alertas/1/leida`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...aprobador.headers },
          body: '{}',
        })
      ).status,
    ).toBe(403);
    expect((await fetch(`${base}/api/alertas`)).status).toBe(401);
  });
});

describe('R29.3/R29.4 — motor de reglas y endpoints', () => {
  it('evaluar genera alertas por tipo según los datos del seed', async () => {
    // Fixtures: el schema de test no siembra ventas (db.js las
    // saltea) — un stock-0 con ventas → QUIEBRE, uno con poco stock
    // y demanda alta → RIESGO_LEAD.
    const prodCero = seedData.productos.find((x) => x.stock_actual === 0);
    // RIESGO_LEAD necesita cobertura < lead del proveedor — con la
    // demanda ponderada (~2.2u/día por 5 ventas de 20) hace falta un
    // proveedor de lead largo y poco stock.
    const leadDe = (p) => {
      const pr = seedData.proveedores.find((x) => x.id === p.proveedor_id);
      return pr.tiempo_entrega_min_dias != null
        ? (pr.tiempo_entrega_min_dias + pr.tiempo_entrega_max_dias) / 2
        : pr.tiempo_entrega_dias;
    };
    const prodBajo = seedData.productos.find(
      (x) => x.stock_actual > 0 && x.stock_actual <= leadDe(x) * 0.5 && leadDe(x) >= 4.5,
    );
    await db.run(
      `INSERT INTO ventas (producto_id, fecha, unidades, canal)
       VALUES (?, CURRENT_DATE - 1, 5, 'POS')`,
      [prodCero.id],
    );
    for (let d = 1; d <= 5; d++) {
      await db.run(
        `INSERT INTO ventas (producto_id, fecha, unidades, canal)
         VALUES (?, CURRENT_DATE - ?::int, 20, 'POS')`,
        [prodBajo.id, d],
      );
    }

    const r = await post('/alertas/evaluar');
    expect(r.status).toBe(200);
    const { evaluadas, nuevas } = await r.json();
    expect(evaluadas).toBeGreaterThan(0);
    expect(nuevas).toBeGreaterThan(0);
    expect(nuevas).toBeLessThanOrEqual(evaluadas);

    const { data, resumen } = await (await get('/alertas')).json();
    // El GET del test de lockdown ya disparó la lazy-eval (creó los
    // DEAD_STOCK del catálogo sin ventas) — `nuevas` solo cuenta las
    // del fixture, el total acumula.
    expect(resumen.total).toBeGreaterThan(0);
    expect(resumen.no_leidas).toBe(resumen.total);
    expect(resumen.total).toBeGreaterThanOrEqual(nuevas);
    const tipos = new Set(data.map((a) => a.tipo));
    // sin ventas sembradas, todo el catálogo con stock>0 es dead
    // stock; el fixture genera QUIEBRE y RIESGO_LEAD
    expect(tipos.has('QUIEBRE')).toBe(true);
    expect(tipos.has('DEAD_STOCK')).toBe(true);
    expect(tipos.has('RIESGO_LEAD')).toBe(true);
    for (const a of data) {
      expect(['ALTA', 'MEDIA', 'BAJA']).toContain(a.severidad);
      expect(a.mensaje.length).toBeGreaterThan(10);
      expect(a.leida).toBe(0);
    }
    // ordenadas: ALTA primero
    expect(data[0].severidad).toBe('ALTA');
  });

  it('dedup: una segunda evaluación no duplica alertas no leídas', async () => {
    const { nuevas } = await (await post('/alertas/evaluar')).json();
    expect(nuevas).toBe(0);
  });

  it('filtros leida/tipo + marcar leída + leer-todas', async () => {
    const { data } = await (await get('/alertas?leida=0&tipo=QUIEBRE')).json();
    expect(data.length).toBeGreaterThan(0);
    expect(data.every((a) => a.tipo === 'QUIEBRE' && a.leida === 0)).toBe(true);

    // marcar una leída
    const r1 = await patch(`/alertas/${data[0].id}/leida`);
    expect(r1.status).toBe(200);
    const { resumen } = await (await get('/alertas')).json();
    expect(resumen.no_leidas).toBe(resumen.total - 1);

    // leer-todas
    const r2 = await patch('/alertas/leer-todas');
    expect((await r2.json()).marcadas).toBe(resumen.no_leidas);
    const { resumen: fin } = await (await get('/alertas')).json();
    expect(fin.no_leidas).toBe(0);
  });

  it('404 con id inexistente; 400 con params inválidos', async () => {
    expect((await patch('/alertas/999999/leida')).status).toBe(404);
    expect((await patch('/alertas/abc/leida')).status).toBe(400);
    expect((await get('/alertas?leida=2')).status).toBe(400);
    expect((await get('/alertas?tipo=FOO')).status).toBe(400);
  });

  it('QUIEBRE menciona margen perdido/día cuando hay costo', async () => {
    // fixture: un producto del seed con stock 0 y ventas → la regla
    // debe generar QUIEBRE con $/día en el mensaje
    const p = seedData.productos.find((x) => x.stock_actual === 0);
    if (!p) return; // seed sin stock 0 — nada que verificar
    await db.run(
      `INSERT INTO ventas (producto_id, fecha, unidades, canal)
       VALUES (?, CURRENT_DATE - 1, 5, 'POS')`,
      [p.id],
    );
    await post('/alertas/evaluar');
    // sin filtro leida — el test anterior ya corrió leer-todas
    const { data } = await (await get('/alertas?tipo=QUIEBRE')).json();
    const mia = data.find((a) => a.producto_id === p.id);
    expect(mia).toBeDefined();
    expect(mia.severidad).toBe('ALTA');
    expect(mia.mensaje).toContain('$');
  });
});

describe('lazy eval — throttle de 60min', () => {
  it('meta vieja → re-evalúa; meta reciente → no; basura → re-evalúa y cura', async () => {
    // meta reciente → el GET no evalúa (nada cambia)
    await post('/alertas/evaluar'); // fija ultima_eval
    const a = await (await get('/alertas')).json();
    const { nuevas: n1 } = await (await post('/alertas/evaluar')).json();
    expect(n1).toBe(0); // dedup — nada nuevo que crear

    // meta vieja (2h atrás) → el GET re-evalúa
    await db.run(
      `UPDATE alertas_meta SET valor = (EXTRACT(EPOCH FROM now()) - 7200)::text
       WHERE clave = 'ultima_eval'`,
    );
    await get('/alertas');
    const meta = await db.get(
      "SELECT valor FROM alertas_meta WHERE clave = 'ultima_eval'",
    );
    expect(Date.now() / 1000 - Number(meta.valor)).toBeLessThan(120);

    // meta basura → re-evalúa y auto-cura
    await db.run("UPDATE alertas_meta SET valor = 'basura' WHERE clave = 'ultima_eval'");
    await get('/alertas');
    const meta2 = await db.get(
      "SELECT valor FROM alertas_meta WHERE clave = 'ultima_eval'",
    );
    expect(Number.isFinite(Number(meta2.valor))).toBe(true);
  });
});
