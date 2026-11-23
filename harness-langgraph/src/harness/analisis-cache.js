/**
 * Cache incremental de análisis IA por producto (SPEC-16, R16.1).
 *
 * El agente corre a diario y las ventas de hoy difieren de ayer en
 * un dato: si el input del LLM no cambió, la respuesta tampoco debe
 * cambiar — reusarla evita la llamada. El cache cubre las DOS
 * llamadas de un producto (demanda y justificación), porque ambas
 * derivan de los mismos inputs (ventas → demanda → cantidad →
 * monto, todo determinista).
 *
 * Persistencia (SPEC-25, T25.3): tabla `analisis_cache` en el mismo
 * Postgres que el backend — antes era un JSON local que se perdía
 * si el proceso corría en otra máquina/contenedor. Sigue siendo
 * descartable, no fuente de verdad: si se trunca solo hay más
 * llamadas LLM la próxima corrida.
 *
 * El hash cubre TODO lo que entra a los prompts: las estadísticas
 * de demanda del backend (SPEC-26 — cualquier cambio en la ventana
 * de ventas las mueve), campos del producto (sku, nombre, stock,
 * precio, lead — un movimiento AJUSTE cambia stock sin tocar
 * ventas) y la config que afecta el resultado (modelo, umbrales,
 * demanda_dias).
 *
 * `analisis_llm` marca que `analisis` la produjo el LLM (no el
 * fallback heurístico): buscarDemanda lo exige, así si ayer el
 * LLM falló y la justificación salió sobre el fallback, ese
 * fallback no se presenta hoy como demanda cacheada — se reintenta.
 * Las justificaciones sí pueden reusarse sobre análisis
 * heurísticos: son deterministas, mismo input → misma prosa.
 */
import { createHash } from 'node:crypto';
import { config } from '../config/env.js';
import { poolPg } from './pg.js';
import { diaUtc } from '../utils/fecha.js';

let tablaLista = null; // promise memoizada — CREATE idempotente

function ensureTabla() {
  if (!tablaLista) {
    tablaLista = poolPg().query(`
      CREATE TABLE IF NOT EXISTS analisis_cache (
        producto_id   INTEGER PRIMARY KEY,
        hash          TEXT NOT NULL,
        analisis      JSONB,
        analisis_llm  BOOLEAN NOT NULL DEFAULT FALSE,
        analisis_ia   TEXT,
        actualizado   TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    // Si el CREATE falla (Postgres caído), no memorizar el rechazo:
    // el próximo acceso reintenta en vez de propagar el error viejo.
    tablaLista.catch(() => { tablaLista = null; });
  }
  return tablaLista;
}

async function entradaDe(productoId) {
  await ensureTabla();
  const { rows } = await poolPg().query(
    'SELECT hash, analisis, analisis_llm, analisis_ia FROM analisis_cache WHERE producto_id = $1',
    [productoId],
  );
  return rows[0];
}

/**
 * Stringify canónico (claves ordenadas, recursivo). JSONB reordena
 * las claves al persistir — un JSON.stringify directo del row vs el
 * objeto original daría "distinto" aunque el contenido sea idéntico.
 */
function canonico(valor) {
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(',')}]`;
  if (valor && typeof valor === 'object') {
    return `{${Object.keys(valor).sort()
      .map((k) => `${JSON.stringify(k)}:${canonico(valor[k])}`).join(',')}}`;
  }
  return JSON.stringify(valor);
}

const mismoAnalisis = (a, b) => canonico(a) === canonico(b);

/**
 * Hash del input completo del LLM para un producto. Cualquier
 * diferencia en stats, campos del producto o config → otra clave →
 * cache miss (invalidación implícita, no hay TTL que mantener).
 * Función pura — sync a propósito.
 */
export function hashAnalisis(producto, stats) {
  const input = {
    // SPEC-26: el input del LLM son las estadísticas de demanda del
    // backend (no las filas crudas del historial) — cualquier cambio
    // en la ventana de ventas mueve estos campos y desconfigura el hash.
    stats: [
      stats.demanda_diaria,
      stats.tendencia,
      stats.cv,
      stats.desvio_demanda,
      stats.dias_con_venta,
      stats.dias_en_quiebre,
      stats.ultima_venta,
    ],
    producto: [
      producto.sku,
      producto.nombre,
      producto.stock_actual,
      producto.stock_minimo,
      producto.costo_unitario ?? producto.precio_venta,
      // T27.3: los alternativos también entran en la decisión de
      // proveedor/cantidad → un cambio en ellos invalida el cache.
      producto.precios ?? null,
      producto.categoria,
      producto.proveedor?.nombre,
      producto.proveedor?.lead_dias_esperado ?? producto.proveedor?.tiempo_entrega_dias,
    ],
    modelo: config.ollamaModel,
    umbral_aprobacion: config.umbralAprobacion,
    umbral_cv: config.umbralCv,
    demanda_dias: config.demandaDias,
  };
  return createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 16);
}

/**
 * Demanda cacheada si el hash coincide; null si no existe, si el
 * input cambió, o si la entrada solo tiene justificación (producto
 * estable — su demanda nunca pasó por el LLM).
 */
export async function buscarDemanda(productoId, hash) {
  const entrada = await entradaDe(productoId);
  return entrada?.hash === hash && entrada.analisis_llm === true
    ? entrada.analisis
    : null;
}

/**
 * Justificación cacheada. Exige hash + mismo análisis: la prosa
 * cita cantidad/monto derivados del análisis, así que si el análisis
 * actual difiere del que la produjo (ej: ayer el LLM de demanda
 * cayó a fallback y hoy respondió distinto) el texto es inválido.
 * Los análisis heurísticos son deterministas → comparar basta.
 */
export async function buscarJustificacion(productoId, hash, analisis) {
  const entrada = await entradaDe(productoId);
  if (entrada?.hash !== hash || !entrada.analisis_ia) return null;
  return mismoAnalisis(entrada.analisis, analisis) ? entrada.analisis_ia : null;
}

/**
 * Guarda la demanda estimada para un producto (borra la
 * justificación previa — si el hash cambió, era de inputs viejos).
 * No se cachea el analisis del fallback heurístico: si el LLM
 * falló queremos reintentarlo en la próxima corrida.
 */
export async function guardarDemanda(productoId, hash, analisis) {
  await ensureTabla();
  await poolPg().query(
    `INSERT INTO analisis_cache (producto_id, hash, analisis, analisis_llm, analisis_ia, actualizado)
     VALUES ($1, $2, $3, TRUE, NULL, now())
     ON CONFLICT (producto_id) DO UPDATE
       SET hash = $2, analisis = $3, analisis_llm = TRUE,
           analisis_ia = NULL, actualizado = now()`,
    [productoId, hash, JSON.stringify(analisis)],
  );
}

/**
 * Guarda la justificación junto con el análisis que la produjo —
 * buscarJustificacion lo exige para no reusar texto con cifras
 * viejas. `analisis_llm` solo se conserva si el análisis guardado
 * sigue siendo el que el LLM cacheó (hit de demanda o
 * guardarDemanda previo en esta misma corrida); si la justificación
 * se generó sobre el fallback heurístico, el flag se pierde y el
 * LLM de demanda se reintenta en la próxima corrida.
 */
export async function guardarJustificacion(productoId, hash, analisis, analisis_ia) {
  const entrada = await entradaDe(productoId);
  const analisisEsDeLlm = entrada?.hash === hash
    && entrada.analisis_llm === true
    && mismoAnalisis(entrada.analisis, analisis);
  await poolPg().query(
    `INSERT INTO analisis_cache (producto_id, hash, analisis, analisis_llm, analisis_ia, actualizado)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (producto_id) DO UPDATE
       SET hash = $2, analisis = $3, analisis_llm = $4,
           analisis_ia = $5, actualizado = now()`,
    [productoId, hash, JSON.stringify(analisis), analisisEsDeLlm, analisis_ia],
  );
}
