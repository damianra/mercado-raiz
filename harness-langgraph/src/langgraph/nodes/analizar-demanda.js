/**
 * NODO 2 — ANALIZAR DEMANDA (nodo con LLM)
 *
 * Lee del estado: productosBajos. Escribe: productosBajos (recortado
 * por el guard), excluidos, analisisPorProducto, hashPorProducto,
 * errores. Corre en tres fases:
 *
 *  Fase 0 — stats + guard (T32.5): `cargarStats` trae las
 *  estadísticas de demanda de TODOS los productos en UNA request
 *  (GET /api/estadisticas/demanda bulk — si falla, degrada al
 *  fetch por producto). Con ellas `clasificarCandidato` aplica el
 *  guard anti-recompra antes de cualquier LLM:
 *   - DEAD_STOCK (dias_con_venta === 0 en la ventana): excluido —
 *     re-poner stock muerto inmoviliza más capital;
 *   - SOBRE_MAX (precio sobre el máximo del mercado): excluido —
 *     re-poner un producto sobre-preciado alimenta ventas lentas;
 *   - EXCEPCIÓN: SOBRE_MAX en quiebre real (stock ≤0 con demanda
 *     viva, demanda_diaria > 0) SIGUE candidato — la góndola vacía
 *     pierde ventas hoy — pero la OC marca `revision_precio` para
 *     que el análisis/justificación recomiende revisar el precio.
 *  Los excluidos salen de productosBajos (nunca llegan a
 *  calcular-cantidad) y quedan registrados en `excluidos` con
 *  `excluido_por` + detalle — decisión auditable, no descarte
 *  silencioso.
 *
 *  Fase A (paralela, `prepararUno`): por cada candidato calcula el
 *  hash del input (cache, SPEC-16) y aplica el triage
 *  (SPEC-12/R26.8):
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
 *  stock de seguridad (z·σ·√lead) — y `zona_precio`/`indice_precio`
 *  (T32.5: generar-analisis lo menciona en la justificación).
 */
import { z } from 'zod';
import { config } from '../../config/env.js';
import { llmJson, llmJsonBatch } from '../../config/ollama.js';
import { estadisticaDemanda, estadisticasDemandaBulk } from '../../integrations/estadisticas.client.js';
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
 * Fase 0 — stats de todos los productos en UNA request bulk
 * (T32.5). Devuelve Map producto_id → { stats } | { error }; si el
 * bulk falla degrada al fetch individual por producto (el path
 * previo) — un backend caído registra el error por producto, no
 * tira la corrida.
 */
async function cargarStats(productos) {
  try {
    const data = await estadisticasDemandaBulk();
    return new Map(data.map((s) => [s.producto_id, { stats: s }]));
  } catch (err) {
    metrics.fallback();
    log(`  estadísticas bulk fallaron (${err.message}) — fetch individual por producto`);
    const pares = await conLimite(productos, config.concurrencia, async (p) => {
      try {
        return [p.id, { stats: await estadisticaDemanda(p.id) }];
      } catch (e) {
        return [p.id, { error: e.message }];
      }
    });
    return new Map(pares);
  }
}

/**
 * Guard anti-recompra (T32.5) — pura y exportada para tests.
 * Decide si un producto bajo entra como candidato de OC según sus
 * stats del bulk:
 *  - DEAD_STOCK: sin ventas en la ventana (dias_con_venta === 0)
 *    → excluido: re-poner stock muerto inmoviliza más capital.
 *  - SOBRE_MAX: precio propio sobre el máximo de mercado →
 *    excluido: re-poner un sobre-preciado alimenta ventas lentas.
 *  - Salvo quiebre real: SOBRE_MAX con stock ≤0 Y demanda viva
 *    (demanda_diaria > 0) sigue candidato pero con
 *    `revision_precio` — la OC anota la revisión de precio.
 * Sin stats (fila ausente en el bulk) no se decide acá: el error
 * path de prepararUno lo maneja.
 */
export function clasificarCandidato(p, stats) {
  if (!stats) return {};
  if (stats.dias_con_venta === 0) {
    return {
      excluido_por: 'DEAD_STOCK',
      detalle: `sin ventas en ${config.demandaDias}d — re-poner inmoviliza capital`,
    };
  }
  if (stats.zona_precio === 'SOBRE_MAX') {
    const quiebreReal = (p.stock_actual ?? 0) <= 0 && (stats.demanda_diaria ?? 0) > 0;
    if (!quiebreReal) {
      return {
        excluido_por: 'SOBRE_MAX',
        detalle:
          `precio sobre el máximo del mercado` +
          (stats.indice_precio != null ? ` (índice ${stats.indice_precio})` : '') +
          ' — revisar precio antes de reponer',
      };
    }
    return { revision_precio: true };
  }
  return {};
}

/**
 * Fase A — por candidato: calcula hash, aplica el triage y el
 * cache. `entrada` es lo que resolvió cargarStats: { stats },
 * { error } o undefined (producto ausente del bulk).
 */
async function prepararUno(p, entrada) {
  const stats = entrada?.stats;
  if (!stats) {
    // Un producto borrado o un endpoint caído no debe tumbar la
    // corrida: demanda 0 + error visible, el pedido mínimo lo
    // decide calcular-cantidad. hash null → generar-analisis
    // saltea el cache (no hay input que comparar).
    const msg = entrada?.error ?? 'sin fila en estadísticas bulk';
    metrics.fallback();
    log(`  ${p.sku}: sin estadísticas (${msg}) — demanda 0`);
    return {
      id: p.id,
      hash: null,
      analisis: {
        demanda_diaria: 0,
        tendencia: 'estable',
        observacion: 'Estadísticas de demanda no disponibles',
        desvio_demanda: 0,
      },
      error: `analizar-demanda(${p.sku}): ${msg} — se usó demanda 0`,
    };
  }
  // SPEC-16: el hash cubre stats + producto + config — generar-
  // analisis lo reusa para cachear la justificación (mismo input).
  const hash = hashAnalisis(p, stats);

  // (Los sin-ventas de la ventana ya quedaron excluidos por el
  // guard DEAD_STOCK — no llegan a esta fase.)

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
  if (!state.productosBajos?.length) {
    return { productosBajos: [], excluidos: [], errores: [] };
  }
  // Fase 0 — stats bulk + guard anti-recompra (T32.5): los
  // excluidos salen de productosBajos ANTES de cualquier llamada
  // al LLM y quedan auditados en `excluidos`.
  const statsPorId = await cargarStats(state.productosBajos);
  const candidatos = [];
  const excluidos = [];
  const conRevisionPrecio = new Set();
  for (const p of state.productosBajos) {
    const c = clasificarCandidato(p, statsPorId.get(p.id)?.stats);
    if (c.excluido_por) {
      excluidos.push({
        producto_id: p.id,
        sku: p.sku,
        nombre: p.nombre,
        excluido_por: c.excluido_por,
        detalle: c.detalle,
      });
      log(`  ${p.sku}: excluido de la reposición (${c.excluido_por}) — ${c.detalle}`);
      continue;
    }
    if (c.revision_precio) {
      conRevisionPrecio.add(p.id);
      log(`  ${p.sku}: SOBRE_MAX pero en quiebre real — sigue candidato, la OC anota revisión de precio`);
    }
    candidatos.push(p);
  }
  if (excluidos.length) {
    log(`  guard anti-recompra: ${excluidos.length} producto(s) excluido(s), ${candidatos.length} candidato(s) siguen`);
  }

  // SPEC-16: hasta `concurrencia` tareas en vuelo — gana si
  // Ollama corre con OLLAMA_NUM_PARALLEL >= ese valor.
  const preparados = await conLimite(candidatos, config.concurrencia, (p) =>
    prepararUno(p, statsPorId.get(p.id)));

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
    const stats = statsPorId.get(r.id)?.stats;
    // T32.5: la posición competitiva viaja con el análisis — el
    // prompt de justificación la menciona y revision_precio fuerza
    // la nota de "revisar precio" en la OC (quiebre real sobre
    // el máximo de mercado). Son datos del backend, no output del
    // LLM: generar-analisis los strippea antes de comparar cache.
    analisis[r.id] = {
      ...r.analisis,
      zona_precio: stats?.zona_precio ?? null,
      indice_precio: stats?.indice_precio ?? null,
      ...(conRevisionPrecio.has(r.id) ? { revision_precio: true } : {}),
    };
    hashes[r.id] = r.hash;
    if (r.error) errores.push(r.error);
  }

  return {
    productosBajos: candidatos,
    excluidos,
    analisisPorProducto: analisis,
    hashPorProducto: hashes,
    errores,
  };
}
