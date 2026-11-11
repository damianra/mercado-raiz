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
import { promptGenerarAnalisis } from '../prompts/generar-analisis.js';
import { log } from '../../utils/logger.js';

function fallbackTexto(p, analisis, cantidad, monto) {
  return (
    `Stock en ${p.stock_actual} unidades (mínimo ${p.stock_minimo}). ` +
    `Demanda estimada: ${analisis.demanda_diaria} u/día (${analisis.tendencia}). ` +
    `Se recomienda ordenar ${cantidad} unidades por $${monto.toFixed(2)}.`
  );
}

export async function generarAnalisis(state) {
  const decision = { ...state.decisionPorProducto };
  const errores = [];

  for (const p of state.productosBajos) {
    const analisis = state.analisisPorProducto[p.id];
    const { cantidad, monto_total } = decision[p.id];
    // SPEC-12: la prosa solo la lee el humano cuando la orden supera
    // el umbral — las auto-aprobadas reciben el template determinista.
    if (!decision[p.id].requiere_aprobacion) {
      metrics.llmEvitada();
      decision[p.id] = { ...decision[p.id], analisis_ia: fallbackTexto(p, analisis, cantidad, monto_total) + ' (estimación automática)' };
      continue;
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
      decision[p.id] = { ...decision[p.id], analisis_ia: respuesta };
    } catch (err) {
      metrics.fallback();
      decision[p.id] = { ...decision[p.id], analisis_ia: fallbackTexto(p, analisis, cantidad, monto_total) };
      errores.push(`generar-analisis(${p.sku}): ${err.message} — se usó template`);
      log(`  ${p.sku}: LLM falló en la justificación, usando template`);
    }
  }

  return { decisionPorProducto: decision, errores };
}
