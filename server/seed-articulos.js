// MERCADO RAÍZ — catálogo interno de artículos (SPEC-22).
//
// Genera las filas de `productos` a partir de `data/articles_sample.csv`
// (muestra retail-radar, SPEC-21). Determinístico: mismo CSV → mismas
// filas. El pseudo-azar sale de un hash FNV-1a del EAN — nada de
// Math.random ni fechas, así el seed es reproducible entre entornos.
//
// Campos internos únicamente (sin vínculo a retail-radar):
// sku propio `MR#####`, nombre, marca, ean, categoría, precio propio,
// stock. El CSV queda como asset de referencia en `data/`.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CSV_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'data',
  'articles_sample.csv',
);
const COLUMNAS_CSV = 22;

// Categoría (top_category normalizado) → proveedor_id + pasillo.
// Los ids referencian `seedData.proveedores` de seed-data.js.
const CATEGORIAS = {
  'Almacén': { proveedor_id: 1, ubicacion: 'Pasillo 1' },
  'Desayuno y Merienda': { proveedor_id: 1, ubicacion: 'Pasillo 2' },
  Bebidas: { proveedor_id: 2, ubicacion: 'Pasillo 3' },
  Perfumería: { proveedor_id: 3, ubicacion: 'Pasillo 4' },
  Limpieza: { proveedor_id: 4, ubicacion: 'Pasillo 5' },
  Frescos: { proveedor_id: 5, ubicacion: 'Heladera 1' },
  Congelados: { proveedor_id: 6, ubicacion: 'Freezer 1' },
  'Frutas y Verduras': { proveedor_id: 7, ubicacion: 'Góndola F&V' },
};

const NORMALIZA_CATEGORIA = {
  'Desayuno y merienda': 'Desayuno y Merienda',
};

// FNV-1a 32-bit → entero sin signo. Estable entre procesos.
function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Pseudo-azar determinístico ∈ [0,1) por (ean, salt).
const rand = (ean, salt) => hash32(`${ean}:${salt}`) / 0xffffffff;

const round2 = (n) => Math.round(n * 100) / 100;

// Split de línea CSV respetando campos entrecomillados (RFC-4180:
// comas dentro de "..." no separan; "" escapa una comilla).
function splitCsvLine(linea) {
  const campos = [];
  let campo = '';
  let enComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const ch = linea[i];
    if (enComillas) {
      if (ch === '"' && linea[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (ch === '"') {
        enComillas = false;
      } else {
        campo += ch;
      }
    } else if (ch === '"') {
      enComillas = true;
    } else if (ch === ',') {
      campos.push(campo);
      campo = '';
    } else {
      campo += ch;
    }
  }
  campos.push(campo);
  return campos;
}

function parseCsv() {
  const lineas = readFileSync(CSV_PATH, 'utf8').trim().split('\n');
  const header = splitCsvLine(lineas[0]);
  if (header.length !== COLUMNAS_CSV || header[0] !== 'product_id') {
    throw new Error(`CSV inesperado: header de ${header.length} columnas`);
  }
  return lineas.slice(1).map((linea, i) => {
    const c = splitCsvLine(linea);
    if (c.length !== COLUMNAS_CSV) {
      throw new Error(`CSV fila ${i + 2}: ${c.length} columnas, esperadas ${COLUMNAS_CSV}`);
    }
    const num = (v) => (v === '' ? null : Number(v));
    return {
      nombre: c[1].trim(),
      marca: c[2].trim() || null,
      ean: c[5].trim() || null,
      categoria: NORMALIZA_CATEGORIA[c[6].trim()] ?? c[6].trim(),
      min_price: num(c[19]),
      max_price: num(c[20]),
    };
  });
}

function articuloDeCsv(row, id) {
  const cat = CATEGORIAS[row.categoria];
  if (!cat) throw new Error(`Categoría sin proveedor: "${row.categoria}" (fila CSV ${id + 1})`);
  if (!Number.isFinite(row.min_price) || !Number.isFinite(row.max_price)) {
    throw new Error(`Artículo sin rango de precios: "${row.nombre}" (fila CSV ${id + 1})`);
  }

  // Precio propio: factor determinístico ∈ [0.88, 1.18) sobre el
  // punto medio del mercado — algunos artículos quedan por encima del
  // máximo observado (análisis de competitividad, SPEC-22).
  const base = (row.min_price + row.max_price) / 2;
  const precio_venta = round2(base * (0.88 + rand(row.ean, 'precio') * 0.3));

  const stock_minimo = 5 + Math.floor(rand(row.ean, 'min') * 16); // 5..20
  const rStock = rand(row.ean, 'stock');
  let stock_actual;
  if (rStock < 0.1) {
    stock_actual = 0; // CRITICO (único caso de estado por stock 0, R5.1)
  } else if (rStock < 0.3) {
    stock_actual = Math.max(1, Math.floor(stock_minimo * (0.3 + rand(row.ean, 'bajo') * 0.6)));
  } else {
    stock_actual = stock_minimo + Math.floor(rand(row.ean, 'ok') * stock_minimo * 3);
  }
  const estado =
    stock_actual === 0 ? 'CRITICO' : stock_actual < stock_minimo ? 'STOCK_BAJO' : 'OK';

  return {
    id,
    sku: `MR${String(id).padStart(5, '0')}`,
    nombre: row.nombre,
    marca: row.marca,
    ean: row.ean,
    categoria: row.categoria,
    stock_actual,
    stock_minimo,
    precio_venta,
    proveedor_id: cat.proveedor_id,
    ubicacion: cat.ubicacion,
    estado,
  };
}

export function generarArticulos() {
  return parseCsv().map((row, i) => articuloDeCsv(row, i + 1));
}

// SPEC-27 — markup objetivo por categoría (costo = venta/(1+markup)).
// El margen_pct resultante sobre venta queda en ~14–33%. Rangos
// realistas de supermercado argentino: perfumería/F&V márgenes altos,
// frescos bajos (rotación + merma).
const MARGEN_CATEGORIA = {
  'Almacén': 0.22,
  'Desayuno y Merienda': 0.28,
  Bebidas: 0.35,
  'Perfumería': 0.45,
  Limpieza: 0.3,
  Frescos: 0.18,
  Congelados: 0.25,
  'Frutas y Verduras': 0.4,
};

const PROVEEDOR_MAYORISTA = 8; // Distribuidora Nacional SA (seed-data)

/**
 * Filas de producto_proveedor por artículo:
 * - SIEMPRE el proveedor principal (el de la categoría): costo =
 *   venta / (1 + margen·jitter), jitter determinístico ∈ [0.9, 1.1).
 * - ~40% además el mayorista general: costo ±8% del principal y sin
 *   lead propio (usa el del proveedor, más largo) → costo vs lead.
 */
export function generarPreciosProveedor(articulos) {
  const filas = [];
  for (const a of articulos) {
    const margen = MARGEN_CATEGORIA[a.categoria];
    if (!margen) throw new Error(`Categoría sin margen: "${a.categoria}"`);
    const jitter = 0.9 + rand(a.ean, 'costo') * 0.2;
    const costoPpal = round2(a.precio_venta / (1 + margen * jitter));
    filas.push({
      producto_id: a.id,
      proveedor_id: a.proveedor_id,
      costo_unitario: costoPpal,
      lead_dias: null,
      es_principal: 1,
      activo: 1,
    });
    if (rand(a.ean, 'alt') < 0.4) {
      filas.push({
        producto_id: a.id,
        proveedor_id: PROVEEDOR_MAYORISTA,
        costo_unitario: round2(costoPpal * (0.92 + rand(a.ean, 'altcosto') * 0.16)),
        lead_dias: null,
        es_principal: 0,
        activo: 1,
      });
    }
  }
  return filas;
}
