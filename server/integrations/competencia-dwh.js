// SPEC-32 (T32.7): cliente del data warehouse de competencia.
// En producción consulta la API externa (COMPETENCIA_DWH_URL);
// sin URL configurada SIMULA esa consulta leyendo el extracto
// local data/articles_sample.csv — el mismo archivo que retail-
// radar exportó, servido con el contrato del API real.
//
// Contrato del payload (lo que devuelve el DWH, real o simulado):
//   {
//     fecha_snapshot: 'YYYY-MM-DD',
//     items: [{ ean, cadena, sku_cadena, precio, precio_lista }]
//   }
// `precio` null = la cadena no tenía el SKU en esa fecha (el
// item igual existe — la fila registra la ausencia del dato).
// El join a `productos` es por `ean` (clave universal); los
// items cuyo ean no matchea se reportan como `sin_match`.
import { FECHA_SNAPSHOT_COMPETENCIA, parseCsv } from '../seed-articulos.js';

const TIMEOUT_MS = Number(process.env.COMPETENCIA_DWH_TIMEOUT_MS) || 10_000;

// La URL configurada es el endpoint del snapshot completo
// (GET → JSON con el contrato de arriba).
const urlDwh = () => process.env.COMPETENCIA_DWH_URL;

export const fuenteCompetencia = () => (urlDwh() ? 'dwh' : 'csv-simulado');

// Snapshot simulado: el CSV se lee con el mismo parser del seed
// y se re-mapea al contrato del API (flat, una fila por artículo
// × cadena — como las 4 filas que el DWH devolvería por SKU).
function snapshotSimulado() {
  const items = parseCsv().flatMap((row) =>
    Object.entries(row.cadenas).map(([cadena, c]) => ({
      ean: row.ean,
      cadena,
      sku_cadena: c.sku,
      precio: c.precio,
      precio_lista: c.lista,
    })),
  );
  return { fecha_snapshot: FECHA_SNAPSHOT_COMPETENCIA, items };
}

// Validación mínima del payload del DWH real — el sync falla
// ruidoso (502) antes que insertar basura en la tabla.
function validarPayload(payload) {
  if (!payload || typeof payload.fecha_snapshot !== 'string' || !Array.isArray(payload.items)) {
    throw new Error('DWH competencia: payload sin {fecha_snapshot, items[]}');
  }
  for (const it of payload.items) {
    if (typeof it.ean !== 'string' || typeof it.cadena !== 'string') {
      throw new Error('DWH competencia: item sin ean/cadena');
    }
  }
  return payload;
}

// GET al DWH real — la única parte que cambia cuando la API
// externa esté disponible: el resto del pipeline es idéntico.
async function snapshotRemoto(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`DWH competencia respondió ${res.status}`);
  return validarPayload(await res.json());
}

// Punto único de consulta — devuelve el snapshot con su fuente
// para que el sync lo reporte (y la UI/logs distingan simulado
// de real sin configuración extra).
export async function fetchSnapshotCompetencia() {
  const url = urlDwh();
  if (!url) return { fuente: 'csv-simulado', ...snapshotSimulado() };
  return { fuente: 'dwh', ...(await snapshotRemoto(url)) };
}
