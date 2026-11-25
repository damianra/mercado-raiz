// SPEC-32 (T32.1): lectura del snapshot `precios_competencia`
// (retail-radar, una fila por artículo × cadena con fecha_snapshot).
// El "snapshot vigente" es la fila más reciente por (producto,
// cadena) — hoy hay una sola fecha, pero la tabla es append-only y
// los re-imports conviven (R32.1), así que siempre se consulta la
// más nueva, nunca "la tabla entera".
import { openDb } from '../db.js';

export const CADENAS = ['DIA', 'COTO', 'CARREFOUR', 'LA_ANONIMA'];

export const ZONAS = ['BAJO_MIN', 'EN_RANGO', 'SOBRE_MAX', 'SIN_DATOS'];

// Zona del precio propio contra el rango de mercado [min, max]:
// <= min → iguala o está por debajo del más barato (BAJO_MIN);
// > max → más caro que todas las cadenas (SOBRE_MAX); sin datos de
// mercado → SIN_DATOS (nunca inventado, R26.7-style).
export function posicionPrecio(precio, min, max) {
  if (precio == null || min == null || max == null) return 'SIN_DATOS';
  if (precio <= min) return 'BAJO_MIN';
  if (precio > max) return 'SOBRE_MAX';
  return 'EN_RANGO';
}

// Índice de competitividad: precio propio sobre el mínimo del
// mercado ×100 — 100 = empatado con el más barato, <100 más
// barato que todos, >100 premium. null sin datos.
export function indicePrecio(precio, min) {
  if (precio == null || min == null || min === 0) return null;
  return Math.round((precio / min) * 1000) / 10;
}

const round1 = (n) => Math.round(n * 10) / 10;

// Posición competitiva de un producto: filas vigentes por cadena
// (con flag en_promo = precio < lista) + rango de mercado + zona.
export async function competenciaProducto(productoId) {
  const db = await openDb();
  const p = await db.get(
    `SELECT id, precio_venta, categoria, stock_actual FROM productos WHERE id = ?`,
    [productoId],
  );
  if (!p) return null;
  const rows = await db.all(
    `SELECT DISTINCT ON (cadena) cadena, sku_cadena, precio, precio_lista,
            fecha_snapshot::text AS fecha_snapshot
       FROM precios_competencia
      WHERE producto_id = ?
      ORDER BY cadena, fecha_snapshot DESC`,
    [productoId],
  );
  const cadenas = rows
    .map((r) => ({
      ...r,
      en_promo: r.precio != null && r.precio_lista != null && r.precio < r.precio_lista,
    }))
    .sort((a, b) => CADENAS.indexOf(a.cadena) - CADENAS.indexOf(b.cadena));
  const precios = cadenas.map((c) => c.precio).filter((v) => v != null);
  const min = precios.length ? Math.min(...precios) : null;
  const max = precios.length ? Math.max(...precios) : null;
  return {
    producto_id: p.id,
    precio_venta: p.precio_venta,
    min_mercado: min,
    max_mercado: max,
    indice: indicePrecio(p.precio_venta, min),
    zona: posicionPrecio(p.precio_venta, min, max),
    cadenas,
  };
}

// Resumen de competitividad del catálogo contra el snapshot vigente:
// - vsMercado: conteo por zona (band min–max entre cadenas)
// - porCadena: en cuántos artículos somos más baratos/iguales que esa
//   cadena, y en cuántos la cadena tiene promo activa (precio < lista)
// - porCategoria: zonas agrupadas por categoría (mismo cómputo)
export async function resumenCompetitividad() {
  const db = await openDb();
  const rows = await db.all(
    `SELECT p.id AS producto_id, p.precio_venta, p.categoria,
            pc.cadena, pc.precio, pc.precio_lista, pc.fecha_snapshot::text AS fecha_snapshot
       FROM productos p
       LEFT JOIN (SELECT DISTINCT ON (producto_id, cadena)
                    producto_id, cadena, precio, precio_lista, sku_cadena, fecha_snapshot
               FROM precios_competencia
              ORDER BY producto_id, cadena, fecha_snapshot DESC) pc
         ON pc.producto_id = p.id`,
  );
  const porProducto = new Map();
  let fechaSnapshot = null;
  for (const r of rows) {
    if (!fechaSnapshot || r.fecha_snapshot > fechaSnapshot) fechaSnapshot = r.fecha_snapshot;
    let lista = porProducto.get(r.producto_id);
    if (!lista) porProducto.set(r.producto_id, (lista = []));
    lista.push(r);
  }

  const vsMercado = { BAJO_MIN: 0, EN_RANGO: 0, SOBRE_MAX: 0, SIN_DATOS: 0 };
  const porCategoria = new Map();
  const cadenaAgg = new Map(
    CADENAS.map((c) => [c, { cadena: c, mas_barato_n: 0, con_dato_n: 0, en_promo_n: 0 }]),
  );

  for (const lista of porProducto.values()) {
    const { precio_venta, categoria } = lista[0];
    const precios = lista.map((r) => r.precio).filter((v) => v != null);
    const min = precios.length ? Math.min(...precios) : null;
    const max = precios.length ? Math.max(...precios) : null;
    const zona = posicionPrecio(precio_venta, min, max);
    vsMercado[zona]++;
    const cat = porCategoria.get(categoria) ?? { categoria, BAJO_MIN: 0, EN_RANGO: 0, SOBRE_MAX: 0, SIN_DATOS: 0 };
    cat[zona]++;
    porCategoria.set(categoria, cat);
    for (const r of lista) {
      if (r.cadena == null) continue; // LEFT JOIN: producto sin snapshot
      const agg = cadenaAgg.get(r.cadena);
      if (r.precio == null) continue; // cadena sin dato del SKU
      agg.con_dato_n++;
      if (precio_venta <= r.precio) agg.mas_barato_n++;
      if (r.precio_lista != null && r.precio < r.precio_lista) agg.en_promo_n++;
    }
  }

  const total = porProducto.size;
  return {
    fecha_snapshot: fechaSnapshot,
    total_productos: total,
    vsMercado,
    porCadena: [...cadenaAgg.values()].map((a) => ({
      ...a,
      mas_barato_pct: a.con_dato_n ? round1((a.mas_barato_n / a.con_dato_n) * 100) : null,
    })),
    porCategoria: [...porCategoria.values()].sort((a, b) =>
      a.categoria.localeCompare(b.categoria)),
  };
}
