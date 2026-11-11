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
import { llmJson } from '../../config/ollama.js';
import { ventasDeProducto } from '../../integrations/historial.client.js';
import { conReintentos } from '../../harness/error-handler.js';
import { costTracker } from '../../harness/cost-tracker.js';
import { metrics } from '../../harness/metrics.js';
import { parseJsonResponse } from '../../utils/llm-json.js';
import { promptAnalisisDemanda } from '../prompts/analisis-demanda.js';
import { log } from '../../utils/logger.js';

const schemaAnalisis = z.object({
  demanda_diaria: z.number().nonnegative(),
  tendencia: z.enum(['subiendo', 'estable', 'bajando']),
  observacion: z.string(),
});

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

export async function analizarDemanda(state) {
  const analisis = {};
  const errores = [];

  for (const p of state.productosBajos) {
    const ventas = await ventasDeProducto(p.id);
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
      analisis[p.id] = respuesta;
      log(`  ${p.sku}: ~${respuesta.demanda_diaria} u/día, ${respuesta.tendencia} — ${respuesta.observacion}`);
    } catch (err) {
      metrics.fallback();
      analisis[p.id] = fallbackDesdeVentas(ventas);
      errores.push(`analizar-demanda(${p.sku}): ${err.message} — se usó fallback heurístico`);
      log(`  ${p.sku}: LLM falló, usando promedio histórico`);
    }
  }

  return { analisisPorProducto: analisis, errores };
}
