/**
 * Prueba de estrés del LLM (Ollama) sobre el pipeline real del agente.
 *
 * Genera N artículos sintéticos y los pasa por los dos nodos con LLM
 * que usa el grafo por producto: analizar-demanda (llmJson, JSON
 * validado con zod) y generar-analisis (llm, texto libre). No toca
 * backend ni DB — aísla el modelo para medir tiempos y cuellos de
 * botella por recursos.
 *
 * Por llamada registra: wall-clock, duraciones nativas de Ollama
 * (load/prompt_eval/eval/total, ns→ms), tokens y si hubo fallback.
 * Además muestrea RSS/CPU del proceso `ollama` cada --muestra-cada
 * artículos para ver consumo de recursos bajo carga.
 *
 * Reporta: throughput, percentiles de wall-clock por tipo de nodo,
 * errores/fallbacks, picos de recursos y el resumen del costTracker
 * (el mismo acumulador que expone GET /metrics, SPEC-10).
 *
 * Uso:
 *   node scripts/stress-llm.mjs --articulos 1000 --concurrencia 1
 *   node scripts/stress-llm.mjs --articulos 50 --concurrencia 8 --solo-demanda
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { z } from 'zod';
import { llm, llmJson } from '../src/config/ollama.js';
import { costTracker } from '../src/harness/cost-tracker.js';
import { promptAnalisisDemanda } from '../src/langgraph/prompts/analisis-demanda.js';
import { promptGenerarAnalisis } from '../src/langgraph/prompts/generar-analisis.js';
import { parseJsonResponse } from '../src/utils/llm-json.js';
import { config } from '../src/config/env.js';

// ---------- CLI ----------
const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, arr) => [a.replace(/^--/, ''), arr[i + 1]]),
);
const N_ARTICULOS = Number(args.articulos ?? 100);
const CONCURRENCIA = Math.max(1, Number(args.concurrencia ?? 1));
const SOLO_DEMANDA = 'solo-demanda' in args;
const MUESTRA_CADA = Math.max(1, Number(args['muestra-cada'] ?? 25));
const REPORTE = args.reporte ?? null;

// Mismo schema que valida el nodo analizar-demanda (state real del grafo).
const schemaAnalisis = z.object({
  demanda_diaria: z.number().nonnegative(),
  tendencia: z.enum(['subiendo', 'estable', 'bajando']),
  observacion: z.string(),
});

// ---------- Datos sintéticos ----------
const PLANTILLAS = [
  ['Leche Entera 1L', 'Lácteos'], ['Yogur Natural 500g', 'Lácteos'], ['Queso Cremoso 250g', 'Lácteos'],
  ['Pan de Molde Integral', 'Panadería'], ['Medialunas x6', 'Panadería'], ['Pan Rustico 400g', 'Panadería'],
  ['Aceite de Girasol 1L', 'Aceites'], ['Aceite de Oliva 500ml', 'Aceites'],
  ['Huevos Docena', 'Granja'], ['Pollo Entero kg', 'Granja'], ['Miel Pura 500g', 'Granja'],
  ['Arroz Largo 1kg', 'Almacén'], ['Fideos Tallarines 500g', 'Almacén'], ['Harina 0000 1kg', 'Almacén'],
  ['Tomate Triturado 400g', 'Conservas'], ['Atún en Lata 170g', 'Conservas'], ['Lentejas 500g', 'Almacén'],
  ['Yerba Mate 1kg', 'Almacén'], ['Café Molido 250g', 'Almacén'], ['Azúcar 1kg', 'Almacén'],
];

let seq = 0;
function articulo() {
  const [nombre, categoria] = PLANTILLAS[seq % PLANTILLAS.length];
  seq++;
  const base = 2 + (seq % 18); // demandas variadas
  return {
    id: 10000 + seq,
    sku: `ST-${String(seq).padStart(4, '0')}`,
    nombre: `${nombre} (${seq})`,
    categoria,
    stock_actual: seq % 9,
    stock_minimo: 10 + (seq % 15),
    precio_unitario: 1 + (seq % 40) * 0.37,
    proveedor: { nombre: `Proveedor ${(seq % 6) + 1}`, tiempo_entrega_dias: 1 + (seq % 5) },
    ventas: Array.from({ length: 4 + (seq % 6) }, (_, i) => ({
      fecha: `2026-11-${String(1 + ((seq + i) % 9)).padStart(2, '0')}`,
      diferencia: -(base + ((seq + i) % 4)),
    })),
  };
}

// ---------- Recursos del proceso ollama ----------
function recursosOllama() {
  try {
    const out = execSync("ps -o rss=,pcpu= -C ollama 2>/dev/null || true", { encoding: 'utf8' });
    const lineas = out.trim().split('\n').filter(Boolean);
    let rss = 0, cpu = 0;
    for (const l of lineas) {
      const [r, c] = l.trim().split(/\s+/).map(Number);
      rss += r; cpu += c;
    }
    return { rss_mb: Math.round(rss / 1024), cpu_pct: Math.round(cpu) };
  } catch {
    return null;
  }
}

// ---------- Métricas por llamada ----------
const llamadas = []; // { tipo, wallMs, totalMs, loadMs, promptMs, genMs, tokIn, tokOut }
const recursos = [];
let procesados = 0;
let fallbacks = 0;
const errores = [];

const nsAms = (ns) => Math.round((ns ?? 0) / 1e6);

async function llamada(tipo, instancia, prompt) {
  const t0 = performance.now();
  const r = await instancia.invoke(prompt);
  const wallMs = Math.round(performance.now() - t0);
  costTracker.registrar(r);
  const m = r.response_metadata ?? {};
  llamadas.push({
    tipo, wallMs,
    totalMs: nsAms(m.total_duration),
    loadMs: nsAms(m.load_duration),
    promptMs: nsAms(m.prompt_eval_duration),
    genMs: nsAms(m.eval_duration),
    tokIn: r.usage_metadata?.input_tokens ?? m.prompt_eval_count ?? 0,
    tokOut: r.usage_metadata?.output_tokens ?? m.eval_count ?? 0,
  });
  return r;
}

function fallbackDemanda(p) {
  const dias = new Set(p.ventas.map((v) => v.fecha)).size || 1;
  const unidades = p.ventas.reduce((a, v) => a + Math.abs(v.diferencia), 0);
  return { demanda_diaria: Math.max(0.5, Math.round((unidades / dias) * 10) / 10), tendencia: 'estable', observacion: 'fallback' };
}

async function procesarArticulo(p) {
  let analisis;
  try {
    const r = await llamada('demanda', llmJson, promptAnalisisDemanda(p, p.ventas));
    analisis = parseJsonResponse(r.content, schemaAnalisis);
  } catch (e) {
    fallbacks++;
    errores.push(`${p.sku}/demanda: ${e.message.slice(0, 80)}`);
    analisis = fallbackDemanda(p);
  }
  if (SOLO_DEMANDA) return;

  // Misma aritmética que el nodo calcular-cantidad (demanda × (lead+7) − stock)
  const objetivo = Math.ceil(analisis.demanda_diaria * (p.proveedor.tiempo_entrega_dias + 7));
  const cantidad = Math.max(objetivo - p.stock_actual, p.stock_minimo * 2 - p.stock_actual, 1);
  const monto = Math.round(cantidad * p.precio_unitario * 100) / 100;
  try {
    const r = await llamada('justificacion', llm, promptGenerarAnalisis(p, analisis, cantidad, monto));
    const texto = String(r.content).trim();
    if (texto.length < 20) throw new Error('justificación demasiado corta');
  } catch (e) {
    fallbacks++;
    errores.push(`${p.sku}/justificacion: ${e.message.slice(0, 80)}`);
  }
}

// ---------- Runner con pool de concurrencia ----------
const articulos = Array.from({ length: N_ARTICULOS }, articulo);
const inicio = Date.now();
console.log(`Stress LLM — ${N_ARTICULOS} artículos, concurrencia ${CONCURRENCIA}, modo ${SOLO_DEMANDA ? 'solo-demanda' : 'completo (2 llamadas/artículo)'}`);
console.log(`Modelo: ${config.ollamaModel} @ ${config.ollamaBaseUrl}`);

let cursor = 0;
async function worker() {
  while (cursor < articulos.length) {
    const p = articulos[cursor++];
    try {
      await procesarArticulo(p);
    } catch (e) {
      errores.push(`${p.sku}: ${e.message.slice(0, 80)}`);
    }
    procesados++;
    if (procesados % MUESTRA_CADA === 0 || procesados === articulos.length) {
      const el = (Date.now() - inicio) / 1000;
      const rec = recursosOllama();
      if (rec) recursos.push({ articulo: procesados, ...rec });
      console.log(`  ${procesados}/${articulos.length} artículos — ${el.toFixed(0)}s — ${(procesados / el * 60).toFixed(0)} art/min — ollama ${rec?.rss_mb ?? '?'}MB ${rec?.cpu_pct ?? '?'}%cpu`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCIA }, worker));

// ---------- Reporte ----------
const wallTotal = Date.now() - inicio;
const pct = (arr, q) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((q / 100) * s.length))];
};
const porTipo = (tipo) => {
  const l = llamadas.filter((x) => x.tipo === tipo);
  const w = l.map((x) => x.wallMs);
  return {
    llamadas: l.length,
    wall_ms: { p50: pct(w, 50), p95: pct(w, 95), p99: pct(w, 99), max: Math.max(0, ...w) },
    ollama_total_ms_prom: l.length ? Math.round(l.reduce((a, x) => a + x.totalMs, 0) / l.length) : 0,
    tokens_in: l.reduce((a, x) => a + x.tokIn, 0),
    tokens_out: l.reduce((a, x) => a + x.tokOut, 0),
  };
};

const reporte = {
  config: { articulos: N_ARTICULOS, concurrencia: CONCURRENCIA, modo: SOLO_DEMANDA ? 'solo-demanda' : 'completo', modelo: config.ollamaModel },
  duracion_total_s: Math.round(wallTotal / 100) / 10,
  throughput: {
    articulos_por_min: Math.round((N_ARTICULOS / (wallTotal / 60000)) * 10) / 10,
    llamadas_por_min: Math.round((llamadas.length / (wallTotal / 60000)) * 10) / 10,
  },
  por_tipo: { demanda: porTipo('demanda'), justificacion: porTipo('justificacion') },
  resiliencia: { fallbacks, errores: errores.length, muestra_errores: errores.slice(0, 5) },
  recursos_ollama: recursos.length
    ? {
        rss_mb: { min: Math.min(...recursos.map((r) => r.rss_mb)), max: Math.max(...recursos.map((r) => r.rss_mb)) },
        cpu_pct: { min: Math.min(...recursos.map((r) => r.cpu_pct)), max: Math.max(...recursos.map((r) => r.cpu_pct)) },
      }
    : null,
  cost_tracker: costTracker.resumen(),
};

console.log('\n=== REPORTE ===');
console.log(JSON.stringify(reporte, null, 2));
if (REPORTE) writeFileSync(REPORTE, JSON.stringify(reporte, null, 2));
