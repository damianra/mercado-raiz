/**
 * Tests de los acumuladores del harness (SPEC-10): costTracker
 * (tokens + duraciones Ollama ns→ms, resumen null sin llamadas) y
 * metrics (métricas de negocio volcadas desde el estado del grafo,
 * tasa_fallback, mensaje_sistema). Todo con objetos mock — no hace
 * falta Ollama ni el grafo real.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { costTracker } from '../../src/harness/cost-tracker.js';
import { metrics } from '../../src/harness/metrics.js';

/** Respuesta tipo LangChain + metadata cruda de Ollama (en ns). */
const respuestaOllama = (meta = {}, uso = null) => ({
  usage_metadata: uso,
  response_metadata: {
    model: 'qwen3:8b',
    prompt_eval_count: 100,
    eval_count: 20,
    load_duration: 2e9, // 2000 ms
    prompt_eval_duration: 4e8, // 400 ms
    eval_duration: 1e9, // 1000 ms
    total_duration: 5e9, // 5000 ms
    ...meta,
  },
});

beforeEach(() => {
  costTracker.reset();
  metrics.iniciarCorrida();
});

describe('costTracker', () => {
  it('devuelve null si el LLM nunca se invocó', () => {
    expect(costTracker.resumen()).toBeNull();
  });

  it('acumula tokens y convierte duraciones de ns a promedio en ms', () => {
    costTracker.registrar(respuestaOllama());
    costTracker.registrar(respuestaOllama({ load_duration: 1e9, total_duration: 3e9 }));
    const r = costTracker.resumen();
    expect(r.modelo).toBe('qwen3:8b');
    expect(r.llamadas_totales).toBe(2);
    expect(r.tokens_prompt_acumulados).toBe(200);
    expect(r.tokens_generacion_acumulados).toBe(40);
    expect(r.tiempo_carga_promedio_ms).toBe(1500); // (2000+1000)/2
    expect(r.tiempo_generacion_promedio_ms).toBe(1000);
    expect(r.tiempo_total_promedio_ms).toBe(4000); // (5000+3000)/2
  });

  it('prioriza usage_metadata de LangChain sobre response_metadata', () => {
    costTracker.registrar(
      respuestaOllama({}, { input_tokens: 7, output_tokens: 3 }),
    );
    const r = costTracker.resumen();
    expect(r.tokens_prompt_acumulados).toBe(7);
    expect(r.tokens_generacion_acumulados).toBe(3);
  });
});

describe('metrics', () => {
  const estadoGrafo = {
    productosBajos: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }],
    ordenesCreadas: [{ orden_id: 'OC-1' }, { orden_id: 'OC-2' }],
    decisionPorProducto: {
      1: { requiere_aprobacion: true },
      2: { requiere_aprobacion: false },
      3: { requiere_aprobacion: true },
    },
    errores: ['generar-analisis(SKU-99): respuesta corta, se usó template'],
  };

  it('vuelca las métricas de negocio desde el estado del grafo', () => {
    metrics.sincronizarEstadoGrafo(estadoGrafo);
    metrics.fallback();
    const m = metrics.resumen();
    expect(m.total_productos_evaluados).toBe(5);
    expect(m.ordenes_creadas).toBe(2);
    expect(m.ordenes_pausadas_hith).toBe(2);
    expect(m.conteo_fallbacks).toBe(1);
    expect(m.tasa_fallback).toBe(20);
    expect(m.errores_no_criticos).toEqual(estadoGrafo.errores);
  });

  it('tasa_fallback es 0 cuando no hubo productos (sin división por cero)', () => {
    metrics.sincronizarEstadoGrafo({ productosBajos: [] });
    expect(metrics.resumen().tasa_fallback).toBe(0);
  });

  it('mensaje_sistema refleja fase y contadores', () => {
    metrics.sincronizarEstadoGrafo(estadoGrafo);
    expect(metrics.mensajeSistema('pausado')).toBe(
      'Esperando aprobación humana de 2 órdenes.',
    );
    expect(metrics.mensajeSistema('terminado')).toBe('Ejecución completada.');
    metrics.fallback();
    expect(metrics.mensajeSistema('terminado')).toBe(
      'Ejecución completada con 1 fallback heurístico.',
    );
  });

  it('mensaje_sistema terminado sin productos no promete métricas de LLM', () => {
    expect(metrics.mensajeSistema('terminado')).toBe(
      'Ejecución completada: no había productos con stock bajo.',
    );
  });
});
