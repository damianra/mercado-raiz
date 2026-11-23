// SPEC-26 (R26.3): seed determinístico de ventas — 90 días por SKU.
// Mismo mecanismo que seed-articulos.js: pseudo-azar por hash FNV-1a
// del EAN (reproducible entre entornos y entre re-seeds; solo cambia
// la ventana móvil, anclada a hoy). Perfil por categoría (alta en
// Frescos y frescos afines, media en Almacén/Bebidas, baja en
// Perfumería/Limpieza), ruido determinístico por día, efecto fin de
// semana, tendencia leve por SKU (crece/cae/estable), canal
// ponderado POS/WEB/MAYOR y ~12% de SKUs sin ventas — mantienen
// honesto el camino "demanda 0" del agente (R26.10).

// FNV-1a 32-bit — idéntica a seed-articulos.js (mismo eje de azar).
function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
const rand = (ean, salt) => hash32(`${ean}:${salt}`) / 0xffffffff;

// Rotación base en unidades/día esperadas por categoría.
const ROTACION = {
  Frescos: 6,
  'Frutas y Verduras': 7,
  Congelados: 4,
  'Desayuno y Merienda': 4,
  'Almacén': 3,
  Bebidas: 3.5,
  'Perfumería': 1,
  'Limpieza': 1.2,
};
const ROTACION_DEFAULT = 2;

const DIAS = 90;
// Efecto fin de semana sobre la rotación del día (0=dom, 6=sáb).
const factorFinde = (dow) => (dow === 6 ? 1.3 : dow === 0 ? 1.15 : 1);
// Canal ponderado: POS 70% / WEB 20% / MAYOR 10%.
const canalDe = (r) => (r < 0.7 ? 'POS' : r < 0.9 ? 'WEB' : 'MAYOR');
// Tendencia por SKU en tercios del hash: crece / cae / estable.
const tendenciaDe = (r, t) =>
  r < 0.33 ? 1 + 0.35 * t : r < 0.66 ? 1 - 0.3 * t : 1;

/**
 * Genera las filas de venta de un producto para la ventana
 * [hoy-DIAS, hoy-1]. Puras (sin DB) — testeable por separado.
 * `producto` necesita { id, ean, categoria }; sin ean cae al sku/id
 * como semilla (mismo determinismo).
 */
export function ventasDeProducto(producto, hoy = new Date()) {
  const semilla = producto.ean || producto.sku || String(producto.id);
  // ~12% del catálogo sin ventas: SKUs nuevos o sin rotación real.
  if (rand(semilla, 'ventas:nulo') < 0.12) return [];
  const base = ROTACION[producto.categoria] ?? ROTACION_DEFAULT;
  const rTendencia = rand(semilla, 'ventas:tendencia');
  const filas = [];
  for (let d = DIAS; d >= 1; d--) {
    const fecha = new Date(hoy);
    fecha.setUTCDate(fecha.getUTCDate() - d);
    const ymd = fecha.toISOString().slice(0, 10);
    const t = (DIAS - d) / DIAS; // 0 ≈ hace 90d → 1 ≈ ayer
    const esperado = base * tendenciaDe(rTendencia, t) * factorFinde(fecha.getUTCDay());
    // Ruido ±50% determinístico por (sku, día) — días sin venta
    // salen natural al redondear a 0 en SKUs de baja rotación.
    const ruido = 0.5 + rand(semilla, `ventas:dia:${ymd}`);
    const unidades = Math.round(esperado * ruido);
    if (unidades < 1) continue;
    filas.push({
      producto_id: producto.id,
      fecha: ymd,
      unidades,
      canal: canalDe(rand(semilla, `ventas:canal:${ymd}`)),
      referencia: `VTA-${producto.sku ?? producto.id}-${ymd.replaceAll('-', '')}`,
    });
  }
  return filas;
}

/**
 * Si `ventas` está vacía la puebla para todo el catálogo (productos
 * ya seedeados). Inserta en una sola tx por lotes de 400 filas —
 * ~60k inserts por fila serían lentos por round-trip.
 */
export async function seedVentas(db) {
  const { c } = await db.get('SELECT COUNT(*)::int AS c FROM ventas');
  if (c > 0) return 0;
  const productos = await db.all(
    'SELECT id, sku, ean, categoria FROM productos ORDER BY id',
  );
  const filas = productos.flatMap((p) => ventasDeProducto(p));
  if (!filas.length) return 0;
  const COLS = ['producto_id', 'fecha', 'unidades', 'canal', 'referencia'];
  await db.tx(async (t) => {
    for (let i = 0; i < filas.length; i += 400) {
      const lote = filas.slice(i, i + 400);
      const valores = lote
        .map(() => `(${COLS.map(() => '?').join(', ')})`)
        .join(', ');
      await t.query(
        `INSERT INTO ventas (${COLS.join(', ')}) VALUES ${valores}`,
        lote.flatMap((f) => COLS.map((c) => f[c])),
      );
    }
  });
  return filas.length;
}
