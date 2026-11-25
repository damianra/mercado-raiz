// @vitest-environment node
// SPEC-32 (T32.1): el snapshot de precios por cadena se persiste
// (4 filas por artículo, NULL donde la cadena no tenía dato) y el
// modelo de lectura clasifica la posición propia vs el mercado.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  competenciaProducto,
  indicePrecio,
  posicionPrecio,
  resumenCompetitividad,
  CADENAS,
} from './models/competencia.model.js';
import {
  FECHA_SNAPSHOT_COMPETENCIA,
  generarCompetencia,
} from './seed-articulos.js';
import { closeDb, openDb } from './db.js';

const SCHEMA = 't_comp';

describe('generarCompetencia (seed)', () => {
  it('4 filas por artículo — 1471 × 4 = 5884', () => {
    const filas = generarCompetencia();
    expect(filas).toHaveLength(1471 * 4);
    const porProducto = new Map();
    for (const f of filas) {
      porProducto.set(f.producto_id, (porProducto.get(f.producto_id) ?? 0) + 1);
    }
    expect([...porProducto.values()].every((n) => n === 4)).toBe(true);
    expect(porProducto.size).toBe(1471);
  });

  it('preserva NULLs de cadenas sin dato (no inventa precios)', () => {
    const filas = generarCompetencia();
    const nulas = filas.filter((f) => f.precio == null);
    expect(nulas.length).toBeGreaterThan(0);
    // Las filas sin dato igual llevan cadena + fecha — son
    // distinguibles de "fila ausente" (R32.1).
    expect(nulas.every((f) => f.cadena && f.fecha_snapshot)).toBe(true);
  });

  it('determinístico y con la fecha del extracto', () => {
    expect(generarCompetencia()).toEqual(generarCompetencia());
    expect(
      generarCompetencia().every(
        (f) => f.fecha_snapshot === FECHA_SNAPSHOT_COMPETENCIA,
      ),
    ).toBe(true);
  });
});

describe('posicionPrecio / indicePrecio (puras)', () => {
  it('clasifica las zonas del mercado', () => {
    expect(posicionPrecio(80, 100, 200)).toBe('BAJO_MIN');
    expect(posicionPrecio(100, 100, 200)).toBe('BAJO_MIN'); // empatar al más barato = más barato
    expect(posicionPrecio(150, 100, 200)).toBe('EN_RANGO');
    expect(posicionPrecio(200, 100, 200)).toBe('EN_RANGO'); // al máximo = dentro
    expect(posicionPrecio(201, 100, 200)).toBe('SOBRE_MAX');
    expect(posicionPrecio(150, null, null)).toBe('SIN_DATOS');
  });

  it('índice: 100 = empatado con el más barato', () => {
    expect(indicePrecio(100, 100)).toBe(100);
    expect(indicePrecio(50, 100)).toBe(50);
    expect(indicePrecio(150, 100)).toBe(150);
    expect(indicePrecio(100, null)).toBeNull();
  });
});

describe('modelo sobre schema sembrado', () => {
  beforeAll(async () => {
    await openDb({ searchPath: SCHEMA });
  });
  afterAll(() => closeDb(true));

  it('la tabla queda poblada por el seed general', async () => {
    const db = await openDb();
    const { c } = await db.get(`SELECT COUNT(*) AS c FROM precios_competencia`);
    expect(Number(c)).toBe(1471 * 4);
  });

  it('competenciaProducto: 4 cadenas, rango y zona coherentes', async () => {
    const pos = await competenciaProducto(1);
    expect(pos.cadenas).toHaveLength(CADENAS.length);
    expect(pos.cadenas.map((c) => c.cadena)).toEqual(CADENAS);
    expect(pos.min_mercado).toBeLessThanOrEqual(pos.max_mercado);
    expect(pos.zona).toBe(posicionPrecio(pos.precio_venta, pos.min_mercado, pos.max_mercado));
    expect(pos.cadenas.every((c) => c.fecha_snapshot === FECHA_SNAPSHOT_COMPETENCIA)).toBe(true);
    // en_promo coherente con precio < lista
    for (const c of pos.cadenas) {
      expect(c.en_promo).toBe(
        c.precio != null && c.precio_lista != null && c.precio < c.precio_lista,
      );
    }
  });

  it('resumenCompetitividad: zonas cubren el catálogo y respetan la banda de SPEC-22', async () => {
    const r = await resumenCompetitividad();
    expect(r.total_productos).toBe(1471);
    const zonas = Object.values(r.vsMercado).reduce((a, b) => a + b, 0);
    expect(zonas).toBe(1471);
    // Distribución sembrada ~8% bajo min / ~71% en rango / ~21% sobre
    // max (SPEC-22). El `<=` de BAJO_MIN absorbe empates → tolerancia.
    const pct = (n) => (n / 1471) * 100;
    expect(pct(r.vsMercado.BAJO_MIN)).toBeGreaterThanOrEqual(5);
    expect(pct(r.vsMercado.BAJO_MIN)).toBeLessThanOrEqual(15);
    expect(pct(r.vsMercado.EN_RANGO)).toBeGreaterThanOrEqual(60);
    expect(pct(r.vsMercado.SOBRE_MAX)).toBeGreaterThanOrEqual(12);
    expect(r.porCadena).toHaveLength(4);
    for (const c of r.porCadena) {
      expect(c.con_dato_n).toBeGreaterThan(1400);
      expect(c.mas_barato_n).toBeLessThanOrEqual(c.con_dato_n);
      expect(c.mas_barato_pct).toBeGreaterThan(0);
    }
    // Coto y Carrefour tienen SKUs sin dato → con_dato < total.
    const coto = r.porCadena.find((c) => c.cadena === 'COTO');
    expect(coto.con_dato_n).toBeLessThan(1471);
    expect(r.porCategoria.length).toBe(8);
  });
});
