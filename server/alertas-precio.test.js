// @vitest-environment node
// SPEC-32 (T32.4): alertas accionables de pricing alimentadas por
// precios_competencia + costo del proveedor principal, y DEAD_STOCK
// ponderada por capital inmovilizado. Schema aislado; fixtures
// controladas: el snapshot es append-only → insertamos filas con
// fecha_snapshot futura para que ganen el DISTINCT ON del vigente,
// y ventas mínimas para fabricar demanda (top seller = p80 de
// demanda_diaria entre productos con demanda > 0).
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { closeDb, openDb } from './db.js';
import { loginComo } from './test-auth.js';

const db = await openDb({ searchPath: 't_alertas_precio' });
let server;
let base;
let buyer;

// ---- Fixtures -------------------------------------------------
const prods = await db.all(
  `SELECT id, sku, nombre, precio_venta, stock_actual
     FROM productos WHERE stock_actual > 0 ORDER BY id`,
);
const [pPA, pPM, pFuera, pOpor, pDeadA, pDeadM, pDeadB, pDormida] = prods;
// Fillers con demanda chica: sin ellos el piso p80 caería sobre los
// propios protagonistas y dejaría de ser "top" al segundo.
const fillers = prods.slice(8, 21);

const CADENAS = ['DIA', 'COTO', 'CARREFOUR', 'LA_ANONIMA'];
const pc = (pid, cadena, precio, lista) =>
  db.run(
    `INSERT INTO precios_competencia
       (producto_id, cadena, sku_cadena, precio, precio_lista, fecha_snapshot)
     VALUES (?, ?, 'T324', ?, ?, CURRENT_DATE + 1)`,
    [pid, cadena, precio, lista],
  );
const venta = (pid, diasAtras, u) =>
  db.run(
    `INSERT INTO ventas (producto_id, fecha, unidades, canal)
     VALUES (?, CURRENT_DATE - ?::int, ?, 'POS')`,
    [pid, diasAtras, u],
  );

// PRESION_COMPETITIVA: DIA en promo −20% (ALTA) y −5% (MEDIA); el
// resto de las cadenas sin promo (precio = lista) para controlar la
// profundidad máxima del snapshot vigente.
await pc(pPA.id, 'DIA', 80, 100);
for (const c of CADENAS.slice(1)) await pc(pPA.id, c, 100, 100);
await pc(pPM.id, 'DIA', 95, 100);
for (const c of CADENAS.slice(1)) await pc(pPM.id, c, 100, 100);
for (let d = 1; d <= 5; d++) {
  await venta(pPA.id, d, 30);
  await venta(pPM.id, d, 25);
}
for (const f of fillers) await venta(f.id, 1, 1);

// Control negativo: promo idéntica pero SIN ventas → sin demanda,
// nunca es top seller, no debe generar PRESION_COMPETITIVA.
await pc(pDormida.id, 'DIA', 80, 100);

// PRECIO_FUERA_MERCADO: las 4 cadenas al 50% del precio propio →
// propio > max. Sin promos (precio = lista) y sin ventas → el mismo
// producto también sale DEAD_STOCK (son ortogonales).
for (const c of CADENAS) {
  await pc(pFuera.id, c, pFuera.precio_venta * 0.5, pFuera.precio_venta * 0.5);
}

// OPORTUNIDAD_MARGEN: mercado ~30% arriba del propio (propio <
// min×0.85) + demanda > 0 → BAJA.
for (const c of CADENAS) {
  await pc(pOpor.id, c, pOpor.precio_venta * 1.3, pOpor.precio_venta * 1.3);
}
for (let d = 1; d <= 3; d++) await venta(pOpor.id, d, 2);

// DEAD_STOCK ponderada: capital = stock × costo del principal.
// Controlamos ambos lados; sin ventas → muertos por definición.
const setCapital = async (pid, stock, costo) => {
  await db.run(`UPDATE productos SET stock_actual = ? WHERE id = ?`, [stock, pid]);
  await db.run(
    `UPDATE producto_proveedor SET costo_unitario = ?
      WHERE producto_id = ? AND es_principal = 1 AND activo = 1`,
    [costo, pid],
  );
};
await setCapital(pDeadA.id, 100, 5000); // $500.000 > $350k → ALTA
await setCapital(pDeadM.id, 100, 2000); // $200.000 > $150k → MEDIA
await setCapital(pDeadB.id, 100, 50); //   $5.000 → BAJA
// ---------------------------------------------------------------

beforeEach(async () => {
  const app = await createApp();
  server = app.listen(0);
  base = `http://localhost:${server.address().port}`;
  buyer ??= await loginComo(base, 'BUYER');
});

afterAll(async () => {
  server?.close();
  await closeDb(true);
});

const get = (path) => fetch(`${base}/api${path}`, { headers: buyer.headers });
const post = (path) =>
  fetch(`${base}/api${path}`, { method: 'POST', headers: buyer.headers });

describe('T32.4 — alertas de pricing + DEAD_STOCK ponderada', () => {
  it(
    'evaluar genera PRESION_COMPETITIVA con severidad por profundidad de promo',
    { timeout: 60_000 }, // primera eval del schema: ~1.4k inserts
    async () => {
      const r = await post('/alertas/evaluar');
      expect(r.status).toBe(200);
      const { evaluadas, nuevas } = await r.json();
      expect(evaluadas).toBeGreaterThan(0);
      expect(nuevas).toBeGreaterThan(0);

      const { data } = await (await get('/alertas?tipo=PRESION_COMPETITIVA')).json();
      const por = (pid) => data.find((a) => a.producto_id === pid);

      const alta = por(pPA.id);
      expect(alta).toBeDefined();
      expect(alta.severidad).toBe('ALTA'); // promo −20% > 15%
      expect(alta.mensaje).toContain('DIA');
      expect(alta.mensaje).toContain('$80');

      const media = por(pPM.id);
      expect(media).toBeDefined();
      expect(media.severidad).toBe('MEDIA'); // promo −5% ≤ 15%

      // Control: misma promo pero sin rotación → no es top seller.
      expect(por(pDormida.id)).toBeUndefined();
    },
  );

  it('PRECIO_FUERA_MERCADO: propio por encima del máximo de las cadenas', async () => {
    const { data } = await (await get('/alertas?tipo=PRECIO_FUERA_MERCADO')).json();
    const mia = data.find((a) => a.producto_id === pFuera.id);
    expect(mia).toBeDefined();
    expect(mia.severidad).toBe('MEDIA');
    expect(mia.mensaje).toContain('máximo');
    expect(mia.mensaje).toContain('$');
  });

  it('OPORTUNIDAD_MARGEN: propio >15% bajo el mínimo con demanda → BAJA', async () => {
    const { data } = await (await get('/alertas?tipo=OPORTUNIDAD_MARGEN')).json();
    const mia = data.find((a) => a.producto_id === pOpor.id);
    expect(mia).toBeDefined();
    expect(mia.severidad).toBe('BAJA');
    expect(mia.mensaje).toContain('mínimo');
  });

  it('DEAD_STOCK ponderada por capital: ALTA/MEDIA/BAJA según umbrales', async () => {
    const { data } = await (await get('/alertas?tipo=DEAD_STOCK')).json();
    const por = (pid) => data.find((a) => a.producto_id === pid);

    const alta = por(pDeadA.id);
    expect(alta).toBeDefined();
    expect(alta.severidad).toBe('ALTA');
    // El mensaje lleva el capital en plata, no solo unidades.
    expect(alta.mensaje).toContain('$500.000');

    expect(por(pDeadM.id).severidad).toBe('MEDIA');
    expect(por(pDeadB.id).severidad).toBe('BAJA');
  });

  it('el filtro ?tipo= acepta los tipos nuevos', async () => {
    for (const t of ['PRESION_COMPETITIVA', 'PRECIO_FUERA_MERCADO', 'OPORTUNIDAD_MARGEN']) {
      const r = await get(`/alertas?tipo=${t}`);
      expect(r.status, t).toBe(200);
    }
  });
});
