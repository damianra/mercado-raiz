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
  // Piso de liquidación: costo vigente del proveedor principal (R32.3).
  const pp = await db.get(
    `SELECT costo_unitario FROM producto_proveedor
      WHERE producto_id = ? AND es_principal = 1 AND activo = 1
      ORDER BY id LIMIT 1`,
    [productoId],
  );
  return {
    producto_id: p.id,
    precio_venta: p.precio_venta,
    stock_actual: p.stock_actual,
    costo_unitario: pp?.costo_unitario ?? null,
    min_mercado: min,
    max_mercado: max,
    indice: indicePrecio(p.precio_venta, min),
    zona: posicionPrecio(p.precio_venta, min, max),
    fecha_snapshot: cadenas.reduce(
      (acc, c) => (c.fecha_snapshot > acc ? c.fecha_snapshot : acc),
      cadenas[0]?.fecha_snapshot ?? null,
    ),
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

// SPEC-32 (T32.3): tabla de pricing accionable — productos fuera del
// rango de mercado con sugerido y diagnóstico (R32.4). Un muerto
// caro NO es "bajar al mínimo": es liquidar. Uno ya barato no tiene
// problema de precio → el sugerido es dejar de esperar.
export async function pricingAccionable(dias = 90, limite = 15) {
  const db = await openDb();
  const rows = await db.all(
    `SELECT p.id, p.sku, p.nombre, p.categoria, p.precio_venta, p.stock_actual,
            pp.costo_unitario,
            MIN(pc.precio) AS min_mercado, MAX(pc.precio) AS max_mercado,
            BOOL_OR(pc.precio < pc.precio_lista) AS promo_competencia,
            ult.u::text AS ultima_venta
       FROM productos p
       LEFT JOIN producto_proveedor pp
         ON pp.producto_id = p.id AND pp.es_principal = 1 AND pp.activo = 1
       LEFT JOIN (
         SELECT DISTINCT ON (producto_id, cadena)
                producto_id, precio, precio_lista
           FROM precios_competencia
          ORDER BY producto_id, cadena, fecha_snapshot DESC
       ) pc ON pc.producto_id = p.id
       LEFT JOIN (SELECT producto_id, MAX(fecha) AS u FROM ventas GROUP BY producto_id) ult
         ON ult.producto_id = p.id
      GROUP BY p.id, p.sku, p.nombre, p.categoria, p.precio_venta,
               p.stock_actual, pp.costo_unitario, ult.u`,
  );
  const { hoy } = await db.get(`SELECT CURRENT_DATE::text AS hoy`);
  const corte = new Date(Date.parse(`${hoy}T00:00:00Z`) - dias * 86400000)
    .toISOString().slice(0, 10);
  const r2 = (n) => (n == null ? null : Math.round(n * 100) / 100);

  const items = [];
  for (const r of rows) {
    const zona = posicionPrecio(r.precio_venta, r.min_mercado, r.max_mercado);
    if (zona === 'EN_RANGO' || zona === 'SIN_DATOS') continue;
    const muerto = r.ultima_venta == null || r.ultima_venta <= corte;
    let sugerido;
    let accion;
    if (muerto && r.stock_actual > 0) {
      if (r.promo_competencia) {
        sugerido = r.costo_unitario != null ? Math.min(r.costo_unitario, r.min_mercado) : r.min_mercado;
        accion = 'Liquidar sin competir precio — la cadena también lo está limpiando';
      } else if (zona === 'SOBRE_MAX' || r.precio_venta > r.min_mercado) {
        sugerido = r.min_mercado;
        accion = 'Promo al mínimo del mercado — te preció afuera';
      } else {
        sugerido = r.costo_unitario;
        accion = 'Liquidación al costo — el precio no es el problema';
      }
    } else if (zona === 'SOBRE_MAX') {
      sugerido = r2((r.min_mercado + r.max_mercado) / 2);
      accion = 'Bajar al punto medio del mercado';
    } else {
      sugerido = r.min_mercado;
      accion = 'Subir al mínimo — estás regalando margen';
    }
    items.push({
      producto_id: r.id,
      sku: r.sku,
      nombre: r.nombre,
      categoria: r.categoria,
      precio_venta: r.precio_venta,
      stock_actual: r.stock_actual,
      costo_unitario: r.costo_unitario,
      min_mercado: r.min_mercado,
      max_mercado: r.max_mercado,
      indice: indicePrecio(r.precio_venta, r.min_mercado),
      zona,
      muerto,
      promo_competencia: r.promo_competencia === true,
      sugerido: r2(sugerido),
      accion,
    });
  }
  // Caros primero (más índice = más fuera de mercado), luego los que
  // regalan margen (menor índice primero).
  items.sort((a, b) =>
    a.zona === b.zona
      ? a.zona === 'SOBRE_MAX'
        ? b.indice - a.indice
        : a.indice - b.indice
      : a.zona === 'SOBRE_MAX'
        ? -1
        : 1,
  );
  return { dias, items: items.slice(0, limite), total_fuera_de_rango: items.length };
}
