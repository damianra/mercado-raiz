// SPEC-33 (T33.1): desglose del stock inicial en lotes con fecha
// de vencimiento — la capa física de `stock_actual` (SPEC-33:
// invariante stock = SUM(cantidad_actual) salvo sobreventa).
// Determinístico como seed-ventas/seed-articulos: pseudo-azar por
// hash FNV-1a del EAN, ventana móvil anclada a hoy.
//
// Distribución pensada para que las reglas tengan datos reales:
// - 1–3 lotes por producto con stock > 0, sumando exacto.
// - Perecederos (vida_util_dias != null): ~2% de los productos con
//   un lote YA vencido (alerta ALTA desde el primer eval) y ~10%
//   con uno ≤ 15 días; el resto repartido sano en [25%, 100%] de la
//   vida útil. fecha_ingreso = vencimiento − vida_util.
// - No perecederos: fecha_vencimiento NULL (nunca alertan), ingreso
//   reciente 1–60 días.

function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
const rand = (semilla, salt) => hash32(`${semilla}:${salt}`) / 0xffffffff;

const dia = (hoy, offsetDias) => {
  const d = new Date(hoy);
  d.setUTCDate(d.getUTCDate() + offsetDias);
  return d;
};
const ymd = (d) => d.toISOString().slice(0, 10);

// Reparte `total` en `n` porciones positivas determinísticas
// (pesos ∊ [0.3, 1.3) normalizados; el resto va a la última).
function repartir(semilla, total, n) {
  const pesos = Array.from(
    { length: n },
    (_, i) => 0.3 + rand(semilla, `lotes:w:${i}`),
  );
  const suma = pesos.reduce((a, w) => a + w, 0);
  const partes = pesos.map((w) => Math.max(1, Math.floor((total * w) / suma)));
  partes[n - 1] += total - partes.reduce((a, q) => a + q, 0);
  return partes;
}

/**
 * Lotes de UN producto para el stock inicial. Pura (sin DB) —
 * testeable por separado. `p` necesita { id, sku|ean, stock_actual,
 * vida_util_dias }; sin ean cae al sku/id como semilla. Devuelve []
 * con stock_actual ≤ 0 (quiebre = sin físico que descomponer).
 */
export function lotesDeProducto(p, hoy = new Date()) {
  if (p.stock_actual <= 0) return [];
  const semilla = p.ean || p.sku || String(p.id);
  const vida = p.vida_util_dias ?? null;
  // Un lote nunca puede quedar en 0 (CHECK cantidad_inicial > 0):
  // stock 2 no se reparte en 3 — el tope es el propio stock.
  const n = Math.min(p.stock_actual, 1 + Math.floor(rand(semilla, 'lotes:n') * 3));
  const partes = repartir(semilla, p.stock_actual, n);

  // Caso del producto (afecta al primer lote): vencido real o
  // próximo a vencer — el motor de alertas arranca con material.
  const rCaso = rand(semilla, 'lotes:caso');
  const filas = [];
  for (let i = 0; i < n; i++) {
    let vencimiento = null;
    let ingreso;
    if (vida == null) {
      ingreso = dia(hoy, -(1 + Math.floor(rand(semilla, `lotes:ing:${i}`) * 60)));
    } else {
      let diasRestantes;
      if (i === 0 && rCaso < 0.02) {
        diasRestantes = -(1 + Math.floor(rand(semilla, 'lotes:vencido') * 10));
      } else if (i === 0 && rCaso < 0.12) {
        diasRestantes = 1 + Math.floor(rand(semilla, 'lotes:proximo') * 15);
      } else {
        diasRestantes = Math.max(
          16,
          Math.floor(vida * (0.25 + rand(semilla, `lotes:vida:${i}`) * 0.75)),
        );
      }
      const v = dia(hoy, diasRestantes);
      vencimiento = ymd(v);
      ingreso = dia(v, -vida);
    }
    filas.push({
      producto_id: p.id,
      codigo: `L-${String(p.id).padStart(5, '0')}-${i + 1}`,
      cantidad_inicial: partes[i],
      cantidad_actual: partes[i],
      fecha_vencimiento: vencimiento,
      fecha_ingreso: ingreso.toISOString(),
      origen: 'SEED',
      orden_id: null,
    });
  }
  return filas;
}

const COLS = [
  'producto_id',
  'codigo',
  'cantidad_inicial',
  'cantidad_actual',
  'fecha_vencimiento',
  'fecha_ingreso',
  'origen',
  'orden_id',
];

/**
 * Si `lotes` está vacía la puebla para todo el catálogo con stock
 * (productos ya seedeados). Inserta en una sola tx por tandas de
 * 400 filas — mismo patrón que seedVentas.
 */
export async function seedLotes(db) {
  const { c } = await db.get('SELECT COUNT(*)::int AS c FROM lotes');
  if (c > 0) return 0;
  const productos = await db.all(
    `SELECT id, sku, ean, categoria, stock_actual, vida_util_dias
     FROM productos ORDER BY id`,
  );
  const filas = productos.flatMap((p) => lotesDeProducto(p));
  if (!filas.length) return 0;
  await db.tx(async (t) => {
    for (let i = 0; i < filas.length; i += 400) {
      const tanda = filas.slice(i, i + 400);
      const valores = tanda
        .map(() => `(${COLS.map(() => '?').join(', ')})`)
        .join(', ');
      await t.query(
        `INSERT INTO lotes (${COLS.join(', ')}) VALUES ${valores}`,
        tanda.flatMap((f) => COLS.map((col) => f[col])),
      );
    }
  });
  return filas.length;
}
