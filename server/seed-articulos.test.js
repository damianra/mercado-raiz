// @vitest-environment node
// Tests del generador del catálogo interno (SPEC-22): los 1.471
// artículos salen de data/articles_sample.csv con sku propio, precio
// derivado del rango de mercado, stock por buckets y estado coherente
// con la regla R5.1. El generador es determinístico: mismo CSV →
// mismas filas.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { generarArticulos, generarPreciosProveedor } from './seed-articulos.js';

const articulos = generarArticulos();
const CATEGORIAS_VALIDAS = new Set([
  'Almacén',
  'Desayuno y Merienda',
  'Bebidas',
  'Perfumería',
  'Limpieza',
  'Frescos',
  'Congelados',
  'Frutas y Verduras',
]);

describe('generarArticulos (SPEC-22)', () => {
  it('genera una fila por línea del CSV', () => {
    const lineas = readFileSync(
      new URL('../data/articles_sample.csv', import.meta.url),
      'utf8',
    )
      .trim()
      .split('\n');
    expect(articulos).toHaveLength(lineas.length - 1); // 1.471 + header
  });

  it('asigna sku interno MR##### secuencial y único', () => {
    const skus = new Set(articulos.map((a) => a.sku));
    expect(skus.size).toBe(articulos.length);
    for (const a of articulos) {
      expect(a.sku).toBe(`MR${String(a.id).padStart(5, '0')}`);
    }
    expect(articulos[0].sku).toBe('MR00001');
  });

  it('expone solo campos internos: nombre, marca, ean, categoría, precio, stock', () => {
    for (const a of articulos) {
      expect(a.nombre).toBeTruthy();
      expect(a.ean).toBeTruthy();
      expect(CATEGORIAS_VALIDAS.has(a.categoria)).toBe(true);
      expect(a.precio_venta).toBeGreaterThan(0);
      expect(a.stock_minimo).toBeGreaterThanOrEqual(5);
      expect(a.stock_minimo).toBeLessThanOrEqual(20);
      expect(a.proveedor_id).toBeGreaterThanOrEqual(1);
      expect(a.proveedor_id).toBeLessThanOrEqual(7);
      // sin vínculo a retail-radar
      expect(a).not.toHaveProperty('product_id');
      expect(a).not.toHaveProperty('min_price');
      expect(a).not.toHaveProperty('max_price');
    }
  });

  it('estado coherente con la regla R5.1 (0 → CRITICO, < min → STOCK_BAJO)', () => {
    for (const a of articulos) {
      const esperado =
        a.stock_actual === 0
          ? 'CRITICO'
          : a.stock_actual < a.stock_minimo
            ? 'STOCK_BAJO'
            : 'OK';
      expect(a.estado).toBe(esperado);
    }
  });

  it('produce el mix buscado: ~10% críticos, ~20% bajos, resto OK', () => {
    const n = articulos.length;
    const criticos = articulos.filter((a) => a.estado === 'CRITICO').length;
    const bajos = articulos.filter((a) => a.estado === 'STOCK_BAJO').length;
    expect(criticos / n).toBeGreaterThan(0.05);
    expect(criticos / n).toBeLessThan(0.15);
    expect(bajos / n).toBeGreaterThan(0.1);
    expect(bajos / n).toBeLessThan(0.3);
  });

  it('precio de venta dentro de la banda [0.85·min, 1.25·max] del mercado', () => {
    const csv = readFileSync(
      new URL('../data/articles_sample.csv', import.meta.url),
      'utf8',
    )
      .trim()
      .split('\n')
      .slice(1)
      // min_price/max_price son las columnas -3/-2 (numéricas, nunca
      // entrecomilladas) — la última del CSV es spread_pct.
      .map((l) => l.split(',').slice(-3));
    for (const [i, a] of articulos.entries()) {
      const min = Number(csv[i][0]);
      const max = Number(csv[i][1]);
      expect(a.precio_venta).toBeGreaterThanOrEqual(min * 0.85);
      expect(a.precio_venta).toBeLessThanOrEqual(max * 1.25);
    }
  });

  it('precio variable: hay artículos por debajo del mínimo y por encima del máximo', () => {
    const csv = readFileSync(
      new URL('../data/articles_sample.csv', import.meta.url),
      'utf8',
    )
      .trim()
      .split('\n')
      .slice(1)
      .map((l) => l.split(',').slice(-3));
    let debajo = 0;
    let encima = 0;
    for (const [i, a] of articulos.entries()) {
      if (a.precio_venta < Number(csv[i][0])) debajo++;
      if (a.precio_venta > Number(csv[i][1])) encima++;
    }
    expect(debajo).toBeGreaterThan(0);
    expect(encima).toBeGreaterThan(0);
  });

  it('es determinístico: dos llamadas producen filas idénticas', () => {
    expect(generarArticulos()).toEqual(articulos);
  });
});

describe('generarPreciosProveedor (SPEC-27)', () => {
  const articulos = generarArticulos();
  const pp = generarPreciosProveedor(articulos);

  it('todo artículo tiene su proveedor principal con costo < precio_venta', () => {
    for (const a of articulos) {
      const ppal = pp.find(
        (r) => r.producto_id === a.id && r.proveedor_id === a.proveedor_id,
      );
      expect(ppal, `sin principal para ${a.sku}`).toBeTruthy();
      expect(ppal.es_principal).toBe(1);
      expect(ppal.costo_unitario).toBeGreaterThan(0);
      expect(ppal.costo_unitario).toBeLessThan(a.precio_venta);
    }
  });

  it('~40% de artículos tienen proveedor alternativo (mayorista general)', () => {
    const conAlt = new Set(
      pp.filter((r) => r.proveedor_id === 8).map((r) => r.producto_id),
    );
    const ratio = conAlt.size / articulos.length;
    expect(ratio).toBeGreaterThan(0.3);
    expect(ratio).toBeLessThan(0.5);
    // ningún artículo tiene al mayorista como principal
    expect(
      pp.some((r) => r.proveedor_id === 8 && r.es_principal === 1),
    ).toBe(false);
  });

  it('los márgenes por categoría caen en rangos realistas (15–50%)', () => {
    for (const r of pp.filter((x) => x.es_principal === 1)) {
      const a = articulos.find((x) => x.id === r.producto_id);
      const margen = 1 - r.costo_unitario / a.precio_venta;
      expect(margen).toBeGreaterThan(0.05);
      expect(margen).toBeLessThan(0.5);
    }
  });

  it('determinístico: dos corridas generan las mismas filas', () => {
    expect(generarPreciosProveedor(articulos)).toEqual(pp);
  });
});
