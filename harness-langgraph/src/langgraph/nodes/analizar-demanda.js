/**
 * NODO 2 — ANALIZAR DEMANDA (nodo con LLM)
 *
 * Lee del estado: productosBajos. Por cada producto trae sus ventas
 * del backend (historial.client → GET /api/historial) y manda el
 * prompt de prompts/analisis-demanda al modelo (llmJson). La
 * respuesta se valida con zod (schemaAnalisis + utils/llm-json);
 * si falla tras reintentos, usa un promedio de las ventas como
 * fallback. Escribe: analisisPorProducto (y concatena en errores
 * cuando hubo fallback).
 */
import { z } from 'zod';
import { config } from '../../config/env.js';
import { llmJson } from '../../config/ollama.js';
import { ventasDeProducto } from '../../integrations/historial.client.js';
import { conReintentos } from '../../harness/error-handler.js';
import { costTracker } from '../../harness/cost-tracker.js';
import { metrics } from '../../harness/metrics.js';
import { buscarDemanda, guardarDemanda, hashAnalisis } from '../../harness/analisis-cache.js';
import { parseJsonResponse } from '../../utils/llm-json.js';
import { conLimite } from '../../utils/concurrencia.js';
import { promptAnalisisDemanda } from '../prompts/analisis-demanda.js';
import { log } from '../../utils/logger.js';

const schemaAnalisis = z.object({
  demanda_diaria: z.number().nonnegative(),
  tendencia: z.enum(['subiendo', 'estable', 'bajando']),
  observacion: z.string(),
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

async function analizarUno(p) {
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

export async function analizarDemanda(state) {
  // SPEC-16: hasta `concurrencia` productos en vuelo — gana si
  // Ollama corre con OLLAMA_NUM_PARALLEL >= ese valor.
  const resultados = await conLimite(state.productosBajos, config.concurrencia, analizarUno);

  const analisis = {};
  const hashes = {};
  const errores = [];
  for (const r of resultados) {
    analisis[r.id] = r.analisis;
    hashes[r.id] = r.hash;
    if (r.error) errores.push(r.error);
  }

  return { analisisPorProducto: analisis, hashPorProducto: hashes, errores };
}
