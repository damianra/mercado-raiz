// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

const withServer = async (fn) => {
  const app = await createApp();
  const server = app.listen(0);
  try {
    await fn(server.address().port);
  } finally {
    server.close();
  }
};

describe('api base', () => {
  it('GET /api/health responde ok', async () => {
    await withServer(async (port) => {
      const res = await fetch(`http://localhost:${port}/api/health`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    });
  });

  it('ruta /api desconocida devuelve 404 JSON', async () => {
    await withServer(async (port) => {
      const res = await fetch(`http://localhost:${port}/api/no-existe`);
      expect(res.status).toBe(404);
    });
  });
});

describe('seguridad', () => {
  it('headers de seguridad presentes en toda respuesta', async () => {
    await withServer(async (port) => {
      const res = await fetch(`http://localhost:${port}/api/health`);
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('x-frame-options')).toBe('DENY');
      expect(res.headers.get('referrer-policy')).toBeTruthy();
    });
  });

  it('rate limit: POSTs excedidos devuelven 429; los GET quedan libres', async () => {
    await withServer(async (port) => {
      const post = () =>
        fetch(`http://localhost:${port}/api/ordenes`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}', // inválido → 400, pero cuenta para el límite
        });
      let last;
      for (let i = 0; i < 21; i++) last = await post();
      expect(last.status).toBe(429);
      // los GET no consumen el límite
      const res = await fetch(`http://localhost:${port}/api/health`);
      expect(res.status).toBe(200);
    });
  });
});
