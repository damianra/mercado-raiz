// @vitest-environment node
// Rate limit propio del login (SPEC-23 R23.5): archivo aparte porque
// el authLimiter vive en routes/auth.js a nivel módulo — cada archivo
// de Vitest tiene registry aislado, así acá el contador arranca limpio
// con AUTH_RATE_LIMIT=3: 3 intentos pasan, el 4º devuelve 429.
process.env.AUTH_RATE_LIMIT = '3';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { closeDb, openDb } from './db.js';
import { USUARIOS_TEST } from './test-auth.js';

await openDb({ searchPath: 't_authrl' });

let server;
let base;

beforeAll(async () => {
  const app = await createApp();
  server = app.listen(0);
  base = `http://localhost:${server.address().port}`;
});

afterAll(async () => {
  server?.close();
  await closeDb(true);
});

describe('rate limit de /api/auth/login', () => {
  it('permite AUTH_RATE_LIMIT intentos/min y devuelve 429 al exceder', async () => {
    const post = () =>
      fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: USUARIOS_TEST.ADMIN.email,
          password: 'password-equivocada',
        }),
      });
    // 3 intentos llegan al handler (401 credenciales, no 429).
    for (let i = 0; i < 3; i++) {
      expect((await post()).status).toBe(401);
    }
    const res = await post();
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBeTruthy();
  });
});
