/**
 * Crea las conexiones al modelo de lenguaje (Ollama en
 * OLLAMA_BASE_URL, modelo OLLAMA_MODEL). Exporta dos instancias:
 *
 *  - `llm`: texto libre — la usa el nodo generar-analisis.
 *  - `llmJson`: respuesta forzada en JSON (format:'json' de Ollama)
 *    — la usa el nodo analizar-demanda.
 *
 * Son los únicos dos nodos que llaman al modelo; el resto del grafo
 * es código puro. Las respuestas se validan antes de usarse
 * (utils/llm-json.js + schema zod del nodo).
 */
import { ChatOllama } from '@langchain/ollama';
import { config } from './env.js';

/**
 * Modelo para respuestas de texto libre (justificaciones).
 */
export const llm = new ChatOllama({
  baseUrl: config.ollamaBaseUrl,
  model: config.ollamaModel,
  temperature: 0.3, // bajo: queremos análisis consistentes, no creatividad
  think: false, // modelos con razonamiento (qwen3): sin think el bloque <think> quedaría dentro del texto
  numCtx: 2048, // prompts ~250 tok + salida ~160 — libera KV-cache para paralelismo (SPEC-12)
  numPredict: 160, // tope de generación: evita outliers de latencia (p99 benchmark)
});

/**
 * Modelo que SIEMPRE responde JSON (Ollama `format: 'json'`).
 * Se usa cuando el nodo necesita datos estructurados para seguir.
 */
export const llmJson = new ChatOllama({
  baseUrl: config.ollamaBaseUrl,
  model: config.ollamaModel,
  temperature: 0.1,
  format: 'json',
  think: false,
  numCtx: 2048,
  numPredict: 300, // JSON de 3 campos corto; margen sobre los ~43 tok típicos
});

/**
 * Modelo JSON para llamadas en lote (SPEC-16, R16.3): un prompt
 * con DEMANDA_BATCH productos espera un array de análisis.
 * numPredict y numCtx escalan con el tamaño del lote (~100 tok de
 * salida por item — la observación suele ser lo más verboso —
 * ~250 tok de input por producto + scaffold).
 */
export const llmJsonBatch = new ChatOllama({
  baseUrl: config.ollamaBaseUrl,
  model: config.ollamaModel,
  temperature: 0.1,
  format: 'json',
  think: false,
  numCtx: Math.max(2048, 512 + 320 * config.demandaBatch),
  numPredict: 100 * config.demandaBatch,
});
