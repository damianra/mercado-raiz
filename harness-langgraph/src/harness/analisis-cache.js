/**
 * Cache incremental de análisis IA por producto (SPEC-16, R16.1).
 *
 * El agente corre a diario y las ventas de hoy difieren de ayer en
 * un dato: si el input del LLM no cambió, la respuesta tampoco debe
 * cambiar — reusarla evita la llamada. El cache cubre las DOS
 * llamadas de un producto (demanda y justificación), porque ambas
 * derivan de los mismos inputs (ventas → demanda → cantidad →
 * monto, todo determinista).
 *
 * Persistencia: JSON local en data/analisis-cache.json — es
 * descartable, no fuente de verdad (si se borra solo hay más
 * llamadas LLM la próxima corrida). Está en .gitignore.
 *
 * El hash cubre TODO lo que entra a los prompts: ventas de la
 * ventana, campos del producto (sku, nombre, stock, precio, lead
 * time — un movimiento AJUSTE cambia stock sin tocar ventas) y la
 * config que afecta el resultado (modelo, umbrales).
 *
 * `analisis_llm` marca que `entrada.analisis` la produjo el LLM
 * (no el fallback heurístico): buscarDemanda lo exige, así si ayer
 * el LLM falló y la justificación salió sobre el fallback, ese
 * fallback no se presenta hoy como demanda cacheada — se reintenta.
 * Las justificaciones sí pueden reusarse sobre análisis
 * heurísticos: son deterministas, mismo input → misma prosa.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config/env.js';

const here = dirname(fileURLToPath(import.meta.url));
const ARCHIVO = join(here, '../../data/analisis-cache.json');

let cache = null; // lazy-load una vez por proceso

function cargar() {
  if (cache) return cache;
  try {
    cache = existsSync(ARCHIVO)
      ? JSON.parse(readFileSync(ARCHIVO, 'utf8'))
      : {};
  } catch {
    cache = {}; // archivo corrupto → cache vacío, no aborta la corrida
  }
  return cache;
}

function persistir() {
  mkdirSync(dirname(ARCHIVO), { recursive: true });
  writeFileSync(ARCHIVO, JSON.stringify(cache));
}

/**
 * Hash del input completo del LLM para un producto. Cualquier
 * diferencia en ventas, campos del producto o config → otra clave →
 * cache miss (invalidación implícita, no hay TTL que mantener).
 */
export function hashAnalisis(producto, ventas) {
  const input = {
    ventas: ventas.map((v) => [v.fecha.slice(0, 10), Math.abs(v.diferencia)]),
    producto: [
      producto.sku,
      producto.nombre,
      producto.stock_actual,
      producto.stock_minimo,
      producto.precio_unitario,
      producto.categoria,
      producto.proveedor?.nombre,
      producto.proveedor?.tiempo_entrega_dias,
    ],
    modelo: config.ollamaModel,
    umbral_aprobacion: config.umbralAprobacion,
    umbral_cv: config.umbralCv,
  };
  return createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 16);
}

/**
 * Demanda cacheada si el hash coincide; null si no existe, si el
 * input cambió, o si la entrada solo tiene justificación (producto
 * estable — su demanda nunca pasó por el LLM).
 */
export function buscarDemanda(productoId, hash) {
  const entrada = cargar()[productoId];
  return entrada?.hash === hash && entrada.analisis_llm === true
    ? entrada.analisis
    : null;
}

/**
 * Justificación cacheada. Exige hash + mismo análisis: la prosa
 * cita cantidad/monto derivados del análisis, así que si el análisis
 * actual difiere del que la produjo (ej: ayer el LLM de demanda
 * cayó a fallback y hoy respondió distinto) el texto es inválido.
 * Los análisis heurísticos son deterministas → comparar basta.
 */
export function buscarJustificacion(productoId, hash, analisis) {
  const entrada = cargar()[productoId];
  if (entrada?.hash !== hash || !entrada.analisis_ia) return null;
  return JSON.stringify(entrada.analisis) === JSON.stringify(analisis)
    ? entrada.analisis_ia
    : null;
}

/**
 * Guarda la demanda estimada para un producto (borra la
 * justificación previa — si el hash cambió, era de inputs viejos).
 * No se cachea el analisis del fallback heurístico: si el LLM
 * falló queremos reintentarlo en la próxima corrida.
 */
export function guardarDemanda(productoId, hash, analisis) {
  cargar();
  cache[productoId] = { hash, analisis, analisis_llm: true, analisis_ia: null };
  persistir();
}

/**
 * Guarda la justificación junto con el análisis que la produjo —
 * buscarJustificacion lo exige para no reusar texto con cifras
 * viejas. `analisis_llm` solo se conserva si el análisis guardado
 * sigue siendo el que el LLM cacheó (hit de demanda o
 * guardarDemanda previo en esta misma corrida); si la justificación
 * se generó sobre el fallback heurístico, el flag se pierde y el
 * LLM de demanda se reintenta en la próxima corrida.
 */
export function guardarJustificacion(productoId, hash, analisis, analisis_ia) {
  cargar();
  const entrada = cache[productoId];
  const analisisEsDeLlm = entrada?.hash === hash
    && entrada.analisis_llm === true
    && JSON.stringify(entrada.analisis) === JSON.stringify(analisis);
  cache[productoId] = { hash, analisis, analisis_llm: analisisEsDeLlm, analisis_ia };
  persistir();
}
