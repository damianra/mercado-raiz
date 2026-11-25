// @vitest-environment node
// SPEC-33 (T33.1): lotesDeProducto descompone stock_actual en 1–3
// lotes determinísticos con fecha de vencimiento por categoría —
// la capa física del invariante stock = SUM(cantidad_actual).
import { afterAll, describe, expect, it } from 'vitest';
import { generarArticulos, VIDA_UTIL_CATEGORIA } from './seed-articulos.js';
import { diasAlertaVencimiento, lotesDeProducto, seedLotes } from './seed-lotes.js';
import { closeDb, openDb } from './db.js';

const HOY = new Date('2026-11-25T12:00:00Z');
const hoyYmd = HOY.toISOString().slice(0, 10);
const articulos = generarArticulos();

const perecedero = { id: 9, sku: 'T9', ean: 't9', categoria: 'Frescos', vida_util_dias: 14, stock_actual: 20 };
const seco = { id: 10, sku: 'T10', ean: 't10', categoria: 'Perfumería', vida_util_dias: null, stock_actual: 15 };

const diasEntre = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

describe('lotesDeProducto (pura)', () => {
  it('determinística: mismo producto → mismos lotes', () => {
    expect(lotesDeProducto(perecedero, HOY)).toEqual(lotesDeProducto(perecedero, HOY));
  });

  it('los lotes suman exactamente stock_actual, 1–3 por producto, todos > 0', () => {
    for (const p of articulos) {
      const lotes = lotesDeProducto(p, HOY);
      if (p.stock_actual <= 0) {
        expect(lotes).toEqual([]);
        continue;
      }
      expect(lotes.length).toBeGreaterThanOrEqual(1);
      expect(lotes.length).toBeLessThanOrEqual(3);
      expect(lotes.reduce((a, l) => a + l.cantidad_actual, 0)).toBe(p.stock_actual);
      for (const l of lotes) {
        expect(l.cantidad_inicial).toBe(l.cantidad_actual);
        expect(l.cantidad_actual).toBeGreaterThan(0);
        expect(l.origen).toBe('SEED');
      }
    }
  });

  it('perecedero → todos los lotes con fecha_vencimiento; no perecedero → NULL', () => {
    for (const l of lotesDeProducto(perecedero, HOY)) {
      expect(l.fecha_vencimiento).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    for (const l of lotesDeProducto(seco, HOY)) {
      expect(l.fecha_vencimiento).toBeNull();
      expect(diasEntre(l.fecha_ingreso, hoyYmd)).toBeGreaterThanOrEqual(0);
    }
  });

  it('stock chico con muchos lotes: ninguna parte queda en 0 (CHECK cantidad_inicial)', () => {
    // Regresión: con pesos dispares el "resto a la última" podía
    // dejar una parte en 0 → violaba el CHECK y tumbaba el seed.
    for (let i = 0; i < 3000; i++) {
      for (const stock of [2, 3, 4]) {
        const p = { id: i, ean: `edge${i}`, stock_actual: stock, vida_util_dias: 14 };
        for (const l of lotesDeProducto(p, HOY)) {
          expect(l.cantidad_inicial).toBeGreaterThan(0);
          expect(l.cantidad_actual).toBeGreaterThan(0);
        }
        expect(
          lotesDeProducto(p, HOY).reduce((a, l) => a + l.cantidad_actual, 0),
        ).toBe(stock);
      }
    }
  });

  it('fecha_ingreso nunca es futura (vida restante ≤ vida útil)', () => {
    // Regresión: la ventana absoluta de 15d ponía ingresos futuros
    // en Frescos/F&V (vida útil < 15d → lote "recibido" mañana).
    for (const p of articulos.filter((a) => a.stock_actual > 0)) {
      for (const l of lotesDeProducto(p, HOY)) {
        expect(l.fecha_ingreso <= HOY.toISOString()).toBe(true);
      }
    }
  });

  it('vencimiento − ingreso = vida_util_dias del producto', () => {
    for (const p of articulos.filter((a) => a.vida_util_dias != null && a.stock_actual > 0).slice(0, 80)) {
      for (const l of lotesDeProducto(p, HOY)) {
        expect(diasEntre(l.fecha_ingreso, l.fecha_vencimiento)).toBe(p.vida_util_dias);
      }
    }
  });

  it('codigo único por producto', () => {
    const p = articulos.find((a) => a.stock_actual > 2 && lotesDeProducto(a, HOY).length > 1);
    const codigos = lotesDeProducto(p, HOY).map((l) => l.codigo);
    expect(new Set(codigos).size).toBe(codigos.length);
  });

  it('el catálogo arranca con material de alerta: ~2% vencidos, ~10% en su ventana', () => {
    const perecederos = articulos.filter((a) => a.vida_util_dias != null && a.stock_actual > 0);
    const con = (pred) =>
      perecederos.filter((p) => lotesDeProducto(p, HOY).some(pred)).length;
    const vencidos = con((l) => l.fecha_vencimiento && l.fecha_vencimiento < hoyYmd);
    // "Próximo" = dentro de la ventana relativa de su categoría
    // (min(15d, 40% de la vida útil) — misma regla que la alerta).
    const enVentana = con(
      (l) => l.fecha_vencimiento
        && diasEntre(hoyYmd, l.fecha_vencimiento) >= 0
        && diasEntre(hoyYmd, l.fecha_vencimiento)
          <= diasAlertaVencimiento(perecederos.find((a) => a.id === l.producto_id).vida_util_dias),
    );
    // Umbrales flojos pero con existencia real garantizada.
    expect(vencidos).toBeGreaterThan(0);
    expect(vencidos).toBeLessThan(perecederos.length * 0.08);
    expect(enVentana).toBeGreaterThan(perecederos.length * 0.04);
    expect(enVentana).toBeLessThan(perecederos.length * 0.25);
  });
});

const db = await openDb({ searchPath: 't_lotes_seed' });

describe('seedLotes (DB)', () => {
  afterAll(() => closeDb(true));

  it('puebla lotes sumando stock_actual y es idempotente', async () => {
    const n = await seedLotes(db);
    expect(n).toBeGreaterThan(0);
    const divergentes = await db.all(
      `SELECT p.id FROM productos p
       WHERE p.stock_actual > 0
         AND p.stock_actual <> COALESCE(
           (SELECT SUM(l.cantidad_actual) FROM lotes l WHERE l.producto_id = p.id), 0)`,
    );
    expect(divergentes).toEqual([]);
    const sinLotes = await db.get(
      `SELECT COUNT(*)::int AS c FROM productos p
       WHERE p.stock_actual > 0
         AND NOT EXISTS (SELECT 1 FROM lotes l WHERE l.producto_id = p.id)`,
    );
    expect(sinLotes.c).toBe(0);
    expect(await seedLotes(db)).toBe(0); // segunda pasada = no-op
  });

  it('vida_util_dias llegó al catálogo: perecederos con días, secos NULL', async () => {
    const filas = await db.all(
      `SELECT DISTINCT categoria, vida_util_dias FROM productos`,
    );
    for (const f of filas) {
      expect(f.vida_util_dias).toBe(VIDA_UTIL_CATEGORIA[f.categoria]);
    }
  });
});
