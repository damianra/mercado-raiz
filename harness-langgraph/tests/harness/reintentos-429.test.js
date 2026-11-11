/**
 * Tests del contrato rate-limit SPEC-13:
 *  - conReintentos: honra err.retryAfter del 429, reintenta 5xx con
 *    backoff, NO reintenta 4xx, corta al agotar intentos, cuenta
 *    cada reintento en metrics sin tocar contadores de LLM/fallback.
 *  - api.post (fetch mockeado): parsea Retry-After del 429 y espera
 *    eso, no el backoff por defecto.
 *  - Integración acotada: una mini-app Express con el middleware
 *    rateLimit REAL de server/security.js (ventana corta) — api.post
 *    absorbe la ráfaga esperando lo que el server indica.
 *
 * El backend real y Ollama no participan — la mini-app usa el
 * limiter real con windowMs=2000/max=3 para no esperar 60s.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

const { conReintentos } = await import('../../src/harness/error-handler.js');
const { metrics } = await import('../../src/harness/metrics.js');
const { costTracker } = await import('../../src/harness/cost-tracker.js');
const { rateLimit } = await import('../../../server/security.js');

const errorHttp = (status, retryAfter = null) => {
  const err = new Error(`HTTP ${status}`);
  err.status = status;
  err.retryAfter = retryAfter;
  return err;
};

beforeEach(() => {
  metrics.iniciarCorrida();
  costTracker.reset();
});

describe('conReintentos — política de reintento', () => {
  it('honra retryAfter del error 429 antes de reintentar', async () => {
    const t0 = Date.now();
    let llamadas = 0;
    const res = await conReintentos(
      async () => {
        llamadas++;
        if (llamadas === 1) throw errorHttp(429, 0.05); // 50 ms
        return 'ok';
      },
      { intentos: 3, esperaMs: 10_000, etiqueta: 'test' },
    );
    expect(res).toBe('ok');
    expect(llamadas).toBe(2);
    // Esperó el retryAfter (~50ms), no el backoff fijo de 10s
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(metrics.resumen().reintentos).toBe(1);
  });

  it('reintenta 5xx con backoff (sin retryAfter usa esperaMs * i)', async () => {
    let llamadas = 0;
    const res = await conReintentos(
      async () => {
        llamadas++;
        if (llamadas < 3) throw errorHttp(503);
        return 'ok';
      },
      { intentos: 3, esperaMs: 10 },
    );
    expect(res).toBe('ok');
    expect(llamadas).toBe(3);
    expect(metrics.resumen().reintentos).toBe(2);
  });

  it('NO reintenta 4xx que no sean 429 — el error es nuestro', async () => {
    let llamadas = 0;
    await expect(
      conReintentos(
        async () => {
          llamadas++;
          throw errorHttp(400);
        },
        { intentos: 3, esperaMs: 10 },
      ),
    ).rejects.toThrow('HTTP 400');
    expect(llamadas).toBe(1); // un solo intento
    expect(metrics.resumen().reintentos).toBe(0);
  });

  it('agota los intentos y propaga el último error', async () => {
    let llamadas = 0;
    await expect(
      conReintentos(
        async () => {
          llamadas++;
          throw errorHttp(429, 0.001);
        },
        { intentos: 4, esperaMs: 10 },
      ),
    ).rejects.toThrow('HTTP 429');
    expect(llamadas).toBe(4);
    expect(metrics.resumen().reintentos).toBe(3); // reintenta n-1 veces
  });

  it('los reintentos 429 no tocan contadores de LLM ni fallbacks', async () => {
    await expect(
      conReintentos(
        async () => {
          throw errorHttp(429, 0.001);
        },
        { intentos: 2, esperaMs: 10 },
      ),
    ).rejects.toThrow();
    const m = metrics.resumen();
    expect(m.reintentos).toBe(1);
    expect(m.conteo_fallbacks).toBe(0);
    // costTracker (llamadas_llm) intacto — los 429 son transporte
    expect(costTracker.resumen()).toBeNull();
  });
});

describe('api.post — Retry-After end-to-end (fetch mockeado)', () => {
  const respuesta = (status, body, retryAfter = null) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: { get: (k) => (k.toLowerCase() === 'retry-after' ? retryAfter : null) },
  });

  it('espera el Retry-After del 429, no el backoff por defecto', async () => {
    let llamadas = 0;
    // retry-after 0.05s → si no se parseara, esperaría esperaMs*1 = 1s
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        llamadas++;
        return llamadas === 1
          ? respuesta(429, { error: 'demasiadas solicitudes' }, '0.05')
          : respuesta(201, { data: { id: 1 } });
      }),
    );
    try {
      const t0 = Date.now();
      const { api } = await import('../../src/integrations/backend-client.js');
      const res = await api.post('/ordenes', { x: 1 });
      expect(res).toEqual({ data: { id: 1 } });
      expect(llamadas).toBe(2);
      expect(Date.now() - t0).toBeLessThan(800); // ~50ms, no ~1000ms
      expect(metrics.resumen().reintentos).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('no reintenta un 400 — un solo fetch', async () => {
    let llamadas = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        llamadas++;
        return respuesta(400, { error: 'datos inválidos' });
      }),
    );
    try {
      const { api } = await import('../../src/integrations/backend-client.js');
      await expect(api.post('/ordenes', {})).rejects.toThrow('datos inválidos');
      expect(llamadas).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('integración — limiter real (server/security.js) + api.post', () => {
  it('absorbe una ráfaga sobre el límite esperando Retry-After', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api', rateLimit({ windowMs: 2000, max: 3 }));
    let recibidos = 0;
    app.post('/api/ordenes', (req, res) => {
      recibidos++;
      res.status(201).json({ data: { id: recibidos } });
    });
    const server = app.listen(0);
    try {
      const port = server.address().port;
      process.env.BACKEND_URL = `http://localhost:${port}`;
      vi.resetModules();
      const { api: apiLocal } = await import('../../src/integrations/backend-client.js');
      const { metrics: metricsLocal } = await import('../../src/harness/metrics.js');
      metricsLocal.iniciarCorrida();

      // 5 POSTs con límite de 3/2s: el 4to recibe 429 con Retry-After
      // ~1-2s → conReintentos espera y reintenta dentro de la nueva ventana.
      for (let i = 0; i < 5; i++) {
        await apiLocal.post('/ordenes', { i });
      }
      expect(recibidos).toBe(5); // ninguna escritura perdida
      expect(metricsLocal.resumen().reintentos).toBeGreaterThanOrEqual(1);
    } finally {
      server.close();
      delete process.env.BACKEND_URL;
      vi.resetModules();
    }
  }, 30_000);
});
