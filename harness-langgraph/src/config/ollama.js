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
});
