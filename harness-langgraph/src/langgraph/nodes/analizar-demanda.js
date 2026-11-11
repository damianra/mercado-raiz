/**
 * NODO 2 — ANALIZAR DEMANDA (nodo con LLM)
 *
 * Lee del estado: productosBajos. Corre en dos fases:
 *
 *  Fase A (paralela, `prepararUno`): por cada producto trae sus
 *  ventas del backend (historial.client → GET /api/historial),
 *  calcula el hash del input (cache, SPEC-16) y aplica el triage
 *  por CV (SPEC-12): demanda estable → promedio histórico directo;
 *  input ya visto → respuesta del cache. Los volátiles sin cache
 *  quedan `pendiente`.
 *
 *  Fase B (lotes, `analizarLote`): los pendientes se agrupan en
 *  lotes de `config.demandaBatch` (SPEC-16) y cada lote es UNA
 *  llamada a `llmJsonBatch` (prompt array). Los items válidos se
 *  matchean por `producto_id`; los faltantes/inválidos — o el
 *  lote entero si la llamada falla — caen a `analisisIndividual`
 *  (llmJson + prompt por producto, el path pre-batch) en un solo
 *  pool que respeta `config.concurrencia`.
 *
 *  Si el LLM falla también en la llamada individual, usa un
 *  promedio de las ventas como fallback. Escribe:
 *  analisisPorProducto + hashPorProducto (y concatena en errores
 *  cuando hubo fallback).
 */
import { z } from 'zod';
import { config } from '../../config/env.js';
import { llmJson, llmJsonBatch } from '../../config/ollama.js';
import { ventasDeProducto } from '../../integrations/historial.client.js';
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
 * Coeficiente de variación (σ/μ) de las unidades vendidas por día.
 * Devuelve Infinity con menos de 3 días de datos — sin muestra
 * suficiente el CV no dice nada y el producto va al LLM.
 */
export function coeficienteVariacion(ventas) {
  const porDia = new Map();
  for (const v of ventas) {
    const dia = v.fecha.slice(0, 10);
    porDia.set(dia, (porDia.get(dia) ?? 0) + Math.abs(v.diferencia));
  }
  const valores = [...porDia.values()];
  if (valores.length < 3) return Infinity;
  const media = valores.reduce((a, x) => a + x, 0) / valores.length;
  if (media === 0) return Infinity;
  const varianza = valores.reduce((a, x) => a + (x - media) ** 2, 0) / valores.length;
  return Math.sqrt(varianza) / media;
}

/** Plan B sin LLM: promedio simple de unidades vendidas por día. */
function fallbackDesdeVentas(ventas) {
  const dias = new Set(ventas.map((v) => v.fecha.slice(0, 10))).size || 1;
  const unidades = ventas.reduce((acc, v) => acc + Math.abs(v.diferencia), 0);
  return {
    demanda_diaria: Math.max(0.5, Math.round((unidades / dias) * 10) / 10),
    tendencia: 'estable',
    observacion: 'Estimado por promedio histórico (análisis IA no disponible)',
  };
}

/**
 * Fase A — por producto: trae ventas, calcula hash, aplica el
 * triage CV y el cache. Devuelve el análisis resuelto o marca
 * `pendiente` con el contexto para la fase de LLM.
 */
async function prepararUno(p) {
  const ventas = await ventasDeProducto(p.id);
  // SPEC-16: el hash cubre ventas + producto + config — generar-
  // analisis lo reusa para cachear la justificación (mismo input).
  const hash = hashAnalisis(p, ventas);
  // SPEC-12: demanda estable (CV < UMBRAL_CV) → promedio histórico
  // directo; el LLM se reserva para los patrones volátiles.
  const cv = coeficienteVariacion(ventas);
  if (cv < config.umbralCv) {
    metrics.llmEvitada();
    log(`  ${p.sku}: demanda estable (CV=${cv.toFixed(2)}) — estimado heurístico, sin LLM`);
    return {
      id: p.id,
      hash,
      analisis: {
        ...fallbackDesdeVentas(ventas),
        observacion: `Demanda estable (CV=${cv.toFixed(2)}), estimado por promedio histórico`,
      },
    };
  }
  // SPEC-16: input idéntico al de una corrida anterior → la
  // respuesta también; reusarla ahorra la llamada.
  const cacheada = buscarDemanda(p.id, hash);
  if (cacheada) {
    metrics.cacheHit();
    log(`  ${p.sku}: análisis reusado del cache (input sin cambios)`);
    return { id: p.id, hash, analisis: cacheada };
  }
  return { id: p.id, hash, p, ventas, pendiente: true };
}

/** Llamada individual al LLM — fallback de items del lote. */
async function analisisIndividual({ p, ventas, hash }) {
  try {
    metrics.llamadaLlm();
    const respuesta = await conReintentos(
      async () => {
        const r = await llmJson.invoke(promptAnalisisDemanda(p, ventas));
        costTracker.registrar(r);
        return parseJsonResponse(r.content, schemaAnalisis);
      },
      { intentos: 2, etiqueta: `análisis de ${p.sku}` },
    );
    guardarDemanda(p.id, hash, respuesta);
    log(`  ${p.sku}: ~${respuesta.demanda_diaria} u/día, ${respuesta.tendencia} — ${respuesta.observacion}`);
    return { id: p.id, hash, analisis: respuesta };
  } catch (err) {
    metrics.fallback();
    log(`  ${p.sku}: LLM falló, usando promedio histórico`);
    return {
      id: p.id,
      hash,
      analisis: fallbackDesdeVentas(ventas),
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
    guardarDemanda(e.id, e.hash, analisis);
    log(`  ${e.p.sku}: ~${analisis.demanda_diaria} u/día, ${analisis.tendencia} — ${analisis.observacion} (lote)`);
    resueltos.push({ id: e.id, hash: e.hash, analisis });
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
