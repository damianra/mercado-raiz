/**
 * NODO 4 — GENERAR ANÁLISIS (nodo con LLM)
 *
 * Lee del estado: productosBajos, analisisPorProducto y
 * decisionPorProducto (cantidad + monto ya calculados). Manda el
 * prompt de prompts/generar-analisis al modelo (llm) y guarda el
 * texto resultante en decisionPorProducto[].analisis_ia — ese texto
 * viaja al backend en el POST /api/ordenes y es lo que lee el
 * aprobador en el modal del dashboard. Si el LLM falla, usa un
 * template con los mismos datos.
 */
import { llm } from '../../config/ollama.js';
import { conReintentos } from '../../harness/error-handler.js';
import { costTracker } from '../../harness/cost-tracker.js';
import { metrics } from '../../harness/metrics.js';
import { buscarJustificacion, guardarJustificacion } from '../../harness/analisis-cache.js';
import { promptGenerarAnalisis } from '../prompts/generar-analisis.js';
import { conLimite } from '../../utils/concurrencia.js';
import { config } from '../../config/env.js';
import { log } from '../../utils/logger.js';

function fallbackTexto(p, analisis, cantidad, monto) {
  return (
    `Stock en ${p.stock_actual} unidades (mínimo ${p.stock_minimo}). ` +
    `Demanda estimada: ${analisis.demanda_diaria} u/día (${analisis.tendencia}). ` +
    `Se recomienda ordenar ${cantidad} unidades por $${monto.toFixed(2)}.`
  );
}

async function justificarUno(state, p) {
  const analisis = state.analisisPorProducto[p.id];
  const { cantidad, monto_total } = state.decisionPorProducto[p.id];
  // SPEC-12: la prosa solo la lee el humano cuando la orden supera
  // el umbral — las auto-aprobadas reciben el template determinista.
  if (!state.decisionPorProducto[p.id].requiere_aprobacion) {
    metrics.llmEvitada();
    return {
      id: p.id,
      decision: { ...state.decisionPorProducto[p.id], analisis_ia: fallbackTexto(p, analisis, cantidad, monto_total) + ' (estimación automática)' },
    };
  }
  // SPEC-16: mismo input (ventas + producto + config → misma
  // demanda → misma cantidad/monto) → la justificación también es
  // la misma; reusarla ahorra la llamada más cara del grafo.
  const hash = state.hashPorProducto?.[p.id];
  const cacheada = hash ? buscarJustificacion(p.id, hash, analisis) : null;
  if (cacheada) {
    metrics.cacheHit();
    log(`  ${p.sku}: justificación reusada del cache (input sin cambios)`);
    return { id: p.id, decision: { ...state.decisionPorProducto[p.id], analisis_ia: cacheada } };
  }
  try {
    metrics.llamadaLlm();
    const respuesta = await conReintentos(
      async () => {
        const r = await llm.invoke(promptGenerarAnalisis(p, analisis, cantidad, monto_total));
        costTracker.registrar(r);
        const texto = String(r.content).trim().replace(/^["']|["']$/g, '');
        if (texto.length < 20) throw new Error('justificación demasiado corta');
        return texto.slice(0, 1900); // el backend capea en 2000
      },
      { intentos: 2, etiqueta: `justificación de ${p.sku}` },
    );
    if (hash) guardarJustificacion(p.id, hash, analisis, respuesta);
    return { id: p.id, decision: { ...state.decisionPorProducto[p.id], analisis_ia: respuesta } };
  } catch (err) {
    metrics.fallback();
    log(`  ${p.sku}: LLM falló en la justificación, usando template`);
    return {
      id: p.id,
      decision: { ...state.decisionPorProducto[p.id], analisis_ia: fallbackTexto(p, analisis, cantidad, monto_total) },
      error: `generar-analisis(${p.sku}): ${err.message} — se usó template`,
    };
  }
}

export async function generarAnalisis(state) {
  // SPEC-16: hasta `concurrencia` justificaciones en vuelo — gana
  // si Ollama corre con OLLAMA_NUM_PARALLEL >= ese valor.
  const resultados = await conLimite(
    state.productosBajos,
    config.concurrencia,
    (p) => justificarUno(state, p),
  );

  const decision = { ...state.decisionPorProducto };
  const errores = [];
  for (const r of resultados) {
    decision[r.id] = r.decision;
    if (r.error) errores.push(r.error);
  }

  return { decisionPorProducto: decision, errores };
}
