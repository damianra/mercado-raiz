/**
 * NODO 2 — ANALIZAR DEMANDA (nodo con LLM)
 *
 * Lee del estado: productosBajos. Corre en dos fases:
 *
 *  Fase A (paralela, `prepararUno`): por cada producto trae las
 *  estadísticas de demanda del backend (estadisticas.client →
 *  GET /api/estadisticas/demanda, SPEC-26), calcula el hash del
 *  input (cache, SPEC-16) y aplica el triage (SPEC-12/R26.8):
 *   - sin ventas en la ventana → demanda 0 determinística, sin LLM;
 *   - ≥3 días con venta y CV < umbral → estimado heurístico: la
 *     demanda ponderada del backend se usa tal cual, sin LLM;
 *   - resto (volátiles o pocos datos) → quedan `pendiente` para el
 *     LLM — primero se prueba el cache (mismo input → misma clave).
 *
 *  Fase B (lotes, `analizarLote`): los pendientes se agrupan en
 *  lotes de `config.demandaBatch` (SPEC-16) y cada lote es UNA
 *  llamada a `llmJsonBatch` (prompt array). Los items válidos se
 *  matchean por `producto_id`; los faltantes/inválidos — o el
 *  lote entero si la llamada falla — caen a `analisisIndividual`
 *  (llmJson + prompt por producto, el path pre-batch) en un solo
 *  pool que respeta `config.concurrencia`.
 *
 *  Si el LLM falla también en la llamada individual, usa la
 *  demanda del backend como fallback. Todos los caminos adjuntan
 *  `desvio_demanda` al análisis — calcular-cantidad lo usa en el
 *  stock de seguridad (z·σ·√lead). Escribe: analisisPorProducto +
 *  hashPorProducto (y concatena en errores cuando hubo fallback).
 */
import { z } from 'zod';
import { config } from '../../config/env.js';
import { llmJson, llmJsonBatch } from '../../config/ollama.js';
import { estadisticaDemanda } from '../../integrations/estadisticas.client.js';
import { conReintentos } from '../../harness/error-handler.js';
import { costTracker } from '../../harness/cost-tracker.js';
import { metrics } from '../../harness/metrics.js';
import { buscarDemanda, guardarDemanda, hashAnalisis } from '../../harness/analisis-cache.js';
import { parseJsonArrayResponse, parseJsonResponse } from '../../utils/llm-json.js';
import { conLimite } from '../../utils/concurrencia.js';
import { promptAnalisisDemanda } from '../prompts/analisis-demanda.js';
import { promptAnalisisDemandaBatch } from '../prompts/analisis-demanda-batch.js';
import { log } from '../../utils/logger.js';

const schemaAnalisis = z.object({
  demanda_diaria: z.number().nonnegative(),
  tendencia: z.enum(['subiendo', 'estable', 'bajando']),
  observacion: z.string(),
});

// Item de respuesta en lote: mismo análisis + el id que el
// modelo repite para matchear respuesta ↔ producto (SPEC-16).
const schemaAnalisisBatch = schemaAnalisis.extend({
  producto_id: z.coerce.number(),
});

/**
 * La pendiente de la regresión (u/día²) → etiqueta. ±0.05 u/día²
 * es ruido frente a una demanda de unidades/día — debajo de eso
 * se reporta 'estable'.
 */
function tendenciaDesdePendiente(pendiente) {
  if (pendiente == null || Math.abs(pendiente) < 0.05) return 'estable';
  return pendiente > 0 ? 'subiendo' : 'bajando';
}

/** Plan B sin LLM: la demanda del backend tal cual (ya es honesta). */
function fallbackDesdeStats(stats) {
  return {
    demanda_diaria: Math.max(0, stats.demanda_diaria ?? 0),
    tendencia: tendenciaDesdePendiente(stats.tendencia),
    observacion: 'Estimado por estadísticas del backend (análisis IA no disponible)',
  };
}

/**
 * Fase A — por producto: trae stats, calcula hash, aplica el
 * triage y el cache. Devuelve el análisis resuelto o marca
 * `pendiente` con el contexto para la fase de LLM.
 */
async function prepararUno(p) {
  let stats;
  try {
    stats = await estadisticaDemanda(p.id);
  } catch (err) {
    // Un producto borrado o un endpoint caído no debe tumbar la
    // corrida: demanda 0 + error visible, el pedido mínimo lo
    // decide calcular-cantidad. hash null → generar-analisis
    // saltea el cache (no hay input que comparar).
    metrics.fallback();
    log(`  ${p.sku}: sin estadísticas (${err.message}) — demanda 0`);
    return {
      id: p.id,
      hash: null,
      analisis: {
        demanda_diaria: 0,
        tendencia: 'estable',
        observacion: 'Estadísticas de demanda no disponibles',
        desvio_demanda: 0,
      },
      error: `analizar-demanda(${p.sku}): ${err.message} — se usó demanda 0`,
    };
  }
  // SPEC-16: el hash cubre stats + producto + config — generar-
  // analisis lo reusa para cachear la justificación (mismo input).
  const hash = hashAnalisis(p, stats);

  // Sin ventas en la ventana: la demanda es 0 — el LLM no tiene
  // nada que estimar. calcular-cantidad asegura el pedido mínimo.
  if (stats.dias_con_venta === 0) {
    metrics.llmEvitada();
    log(`  ${p.sku}: sin ventas en ${config.demandaDias}d — demanda 0, sin LLM`);
    return {
      id: p.id,
      hash,
      analisis: {
        demanda_diaria: 0,
        tendencia: 'estable',
        observacion: `Sin ventas en ${config.demandaDias} días`,
        desvio_demanda: 0,
      },
    };
  }

  // SPEC-12/R26.8: muestra suficiente (≥3 días) y demanda estable
  // (CV < umbral) → el estimado ponderado del backend se usa tal
  // cual; el LLM se reserva para los patrones volátiles.
  if (stats.dias_con_venta >= 3 && stats.cv != null && stats.cv < config.umbralCv) {
    metrics.llmEvitada();
    log(`  ${p.sku}: demanda estable (CV=${stats.cv.toFixed(2)}) — estimado heurístico, sin LLM`);
    return {
      id: p.id,
      hash,
      analisis: {
        demanda_diaria: stats.demanda_diaria,
        tendencia: tendenciaDesdePendiente(stats.tendencia),
        observacion: `Demanda estable (CV=${stats.cv.toFixed(2)}), estimado por estadísticas del backend`,
        desvio_demanda: stats.desvio_demanda ?? 0,
      },
    };
  }
  // SPEC-16: input idéntico al de una corrida anterior → la
  // respuesta también; reusarla ahorra la llamada.
  // Cache fail-soft: un read caído es un miss, no aborta la corrida.
  const cacheada = await buscarDemanda(p.id, hash).catch(() => null);
  if (cacheada) {
    metrics.cacheHit();
    log(`  ${p.sku}: análisis reusado del cache (input sin cambios)`);
    return { id: p.id, hash, analisis: { ...cacheada, desvio_demanda: stats.desvio_demanda ?? 0 } };
  }
  return { id: p.id, hash, p, stats, pendiente: true };
}

/** Llamada individual al LLM — fallback de items del lote. */
async function analisisIndividual({ p, stats, hash }) {
  try {
    metrics.llamadaLlm();
    const respuesta = await conReintentos(
      async () => {
        const r = await llmJson.invoke(promptAnalisisDemanda(p, stats));
        costTracker.registrar(r);
        return parseJsonResponse(r.content, schemaAnalisis);
      },
      { intentos: 2, etiqueta: `análisis de ${p.sku}` },
    );
    // El write al cache va fuera del try del LLM: una falla de
    // Postgres no debe descartar la respuesta del modelo.
    await guardarDemanda(p.id, hash, respuesta).catch((e) =>
      log(`  ${p.sku}: cache write falló (${e.message}) — sigo sin cache`));
    log(`  ${p.sku}: ~${respuesta.demanda_diaria} u/día, ${respuesta.tendencia} — ${respuesta.observacion}`);
    return { id: p.id, hash, analisis: { ...respuesta, desvio_demanda: stats.desvio_demanda ?? 0 } };
  } catch (err) {
    metrics.fallback();
    log(`  ${p.sku}: LLM falló, usando estadísticas del backend`);
    return {
      id: p.id,
      hash,
      analisis: { ...fallbackDesdeStats(stats), desvio_demanda: stats.desvio_demanda ?? 0 },
      error: `analizar-demanda(${p.sku}): ${err.message} — se usó fallback heurístico`,
    };
  }
}

/**
 * Fase B — un lote de pendientes en UNA llamada al LLM (SPEC-16,
 * R16.3). El modelo devuelve un array; los items válidos se
 * matchean por producto_id. Devuelve { resueltos, faltantes }:
 * los faltantes/inválidos — o el lote entero si la llamada
 * falla — los resuelve `analizarDemanda` con llamadas
 * individuales en un solo pool (así el límite de concurrencia
 * global se respeta también en el fallback).
 */
async function analizarLote(lote) {
  let items;
  try {
    metrics.llamadaLlm();
    items = await conReintentos(
      async () => {
        const r = await llmJsonBatch.invoke(promptAnalisisDemandaBatch(lote));
        costTracker.registrar(r);
        return parseJsonArrayResponse(r.content, schemaAnalisisBatch).items;
      },
      { intentos: 2, etiqueta: `lote de ${lote.length} productos` },
    );
  } catch (err) {
    log(`  lote de ${lote.length}: LLM falló (${err.message}) — llamadas individuales`);
    return { resueltos: [], faltantes: lote };
  }
  const porId = new Map(items.map((i) => [i.producto_id, i]));
  const resueltos = [];
  const faltantes = [];
  for (const e of lote) {
    const item = porId.get(e.id);
    if (!item) {
      faltantes.push(e);
      continue;
    }
    const analisis = {
      demanda_diaria: item.demanda_diaria,
      tendencia: item.tendencia,
      observacion: item.observacion,
    };
    await guardarDemanda(e.id, e.hash, analisis).catch((err) =>
      log(`  ${e.p.sku}: cache write falló (${err.message}) — sigo sin cache`));
    log(`  ${e.p.sku}: ~${analisis.demanda_diaria} u/día, ${analisis.tendencia} — ${analisis.observacion} (lote)`);
    // σ no va al cache: es dato del backend, se adjunta fresco del
    // stats de esta corrida (igual que en el cache hit de prepararUno).
    resueltos.push({ id: e.id, hash: e.hash, analisis: { ...analisis, desvio_demanda: e.stats.desvio_demanda ?? 0 } });
  }
  if (faltantes.length) {
    log(`  lote: ${faltantes.length} item(s) faltantes/inválidos — llamadas individuales`);
  }
  return { resueltos, faltantes };
}

export async function analizarDemanda(state) {
  // SPEC-16: hasta `concurrencia` tareas en vuelo — gana si
  // Ollama corre con OLLAMA_NUM_PARALLEL >= ese valor.
  const preparados = await conLimite(state.productosBajos, config.concurrencia, prepararUno);

  // Los pendientes se agrupan en lotes de `demandaBatch`; cada
  // lote es una sola llamada al LLM.
  const pendientes = preparados.filter((r) => r.pendiente);
  const lotes = [];
  for (let i = 0; i < pendientes.length; i += config.demandaBatch) {
    lotes.push(pendientes.slice(i, i + config.demandaBatch));
  }
  const porLote = await conLimite(lotes, config.concurrencia, analizarLote);

  // Fallback granular: todos los items que el LLM omitió o
  // devolvió inválidos (en cualquier lote) en un solo pool —
  // respeta el límite de concurrencia global.
  const faltantes = porLote.flatMap((r) => r.faltantes);
  const individuales = await conLimite(faltantes, config.concurrencia, analisisIndividual);

  const analisis = {};
  const hashes = {};
  const errores = [];
  const resueltos = [
    ...preparados.filter((r) => !r.pendiente),
    ...porLote.flatMap((r) => r.resueltos),
    ...individuales,
  ];
  for (const r of resueltos) {
    analisis[r.id] = r.analisis;
    hashes[r.id] = r.hash;
    if (r.error) errores.push(r.error);
  }

  return { analisisPorProducto: analisis, hashPorProducto: hashes, errores };
}
