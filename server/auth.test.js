// @vitest-environment node
// Tests de autenticación (SPEC-23): login genérico sin oráculo,
// lockout, refresh rotativo con reuse detection + CSRF double-submit,
// logout, cambio de password (token_version), requireAuth y
// requireRole sobre rutas del dominio.
// AUTH_RATE_LIMIT alto para no estorbar las ~15 llamadas al login
// del archivo — el limit propio se prueba en auth-rate-limit.test.js
// (módulo aislado por archivo → contador limpio).
process.env.AUTH_RATE_LIMIT = '500';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { openDb } from './db.js';
import { USUARIOS_TEST, loginComo } from './test-auth.js';

let server;
let base;
const db = openDb(':memory:');

beforeEach(async () => {
  const app = await createApp();
  server = app.listen(0);
  base = `http://localhost:${server.address().port}`;
});

afterEach(() => server?.close());

const postAuth = (path, body, headers = {}) =>
  fetch(`${base}/api/auth${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
const getAuth = (path, headers = {}) => fetch(`${base}/api/auth${path}`, { headers });

describe('POST /api/auth/login', () => {
  it('devuelve access token + usuario y setea cookies refresh/csrf', async () => {
    const res = await postAuth('/login', USUARIOS_TEST.GERENTE);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.access_token).toBeTruthy();
    expect(body.usuario).toMatchObject({
      email: 'carlos.martinez@mercadorai.com',
      rol: 'GERENTE',
    });
    expect(body.usuario.password_hash).toBeUndefined();
    const cookies = res.headers.getSetCookie().join('; ');
    expect(cookies).toContain('mr_refresh=');
    expect(cookies).toContain('HttpOnly');
    expect(cookies).toContain('SameSite=Strict');
    expect(cookies).toContain('mr_csrf=');
  });

  it('401 genérica idéntica para email desconocido y password mala', async () => {
    const resInexistente = await postAuth('/login', {
      email: 'nadie@mercadorai.com',
      password: 'lo-que-sea-1234',
    });
    const resMala = await postAuth('/login', {
      email: USUARIOS_TEST.ADMIN.email,
      password: 'password-equivocada',
    });
    expect(resInexistente.status).toBe(401);
    expect(resMala.status).toBe(401);
    expect(await resInexistente.json()).toEqual(await resMala.json());
  });

  it('valida el body (400) sin pegarle a la DB', async () => {
    for (const body of [{}, { email: 'a@b.com' }, { password: 'x' }]) {
      expect((await postAuth('/login', body)).status).toBe(400);
    }
    // Un email bien formado pero desconocido → misma 401 genérica
    // (no validar formato = menos oráculo sobre el esquema).
    expect(
      (
        await postAuth('/login', {
          email: 'no-es-email',
          password: 'x',
        })
      ).status,
    ).toBe(401);
  });

  it('bloquea la cuenta tras 5 fallos (401 aun con la password buena)', async () => {
    const { email } = USUARIOS_TEST.APROBADOR;
    for (let i = 0; i < 5; i++) {
      expect(
        (await postAuth('/login', { email, password: `mala-${i}` })).status,
      ).toBe(401);
    }
    expect(
      (await postAuth('/login', { email, password: USUARIOS_TEST.APROBADOR.password }))
        .status,
    ).toBe(401);
    // Limpieza: la suite comparte DB — desbloquear para otros tests.
    db.prepare(
      'UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE email = ?',
    ).run(email);
  });
});

describe('GET /api/auth/me', () => {
  it('devuelve el usuario del token; 401 sin Bearer', async () => {
    const ses = await loginComo(base, 'APROBADOR');
    const res = await getAuth('/me', ses.headers);
    expect(res.status).toBe(200);
    expect((await res.json()).usuario.email).toBe(USUARIOS_TEST.APROBADOR.email);
    expect((await getAuth('/me')).status).toBe(401);
    expect(
      (await getAuth('/me', { Authorization: 'Bearer token-falso' })).status,
    ).toBe(401);
  });
});

describe('POST /api/auth/refresh', () => {
  it('rota el refresh token y exige CSRF double-submit', async () => {
    const ses = await loginComo(base, 'GERENTE');
    // Sin X-CSRF-Token → 403 aunque la cookie sea válida.
    expect(
      (
        await postAuth('/refresh', undefined, { cookie: ses.cookie })
      ).status,
    ).toBe(403);

    const res = await postAuth('/refresh', undefined, {
      cookie: ses.cookie,
      'x-csrf-token': ses.csrf,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.access_token).toBeTruthy();
    const nuevasCookies = res.headers.getSetCookie().join('; ');
    expect(nuevasCookies).toContain('mr_refresh=');
  });

  it('reutilizar un refresh viejo revoca la familia entera', async () => {
    const ses = await loginComo(base, 'ADMIN');
    // Rotación válida — el refresh viejo queda revocado.
    const res1 = await postAuth('/refresh', undefined, {
      cookie: ses.cookie,
      'x-csrf-token': ses.csrf,
    });
    expect(res1.status).toBe(200);
    const csrfNuevo = res1.headers
      .getSetCookie()
      .find((c) => c.startsWith('mr_csrf='))
      ?.split(';')[0]
      .split('=')[1];

    // Reuso del token viejo → 401 y toda la familia revocada.
    expect(
      (
        await postAuth('/refresh', undefined, {
          cookie: ses.cookie,
          'x-csrf-token': ses.csrf,
        })
      ).status,
    ).toBe(401);

    // Incluso el token NUEVO murió con la familia.
    const cookiesNuevas = res1.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
    expect(
      (
        await postAuth('/refresh', undefined, {
          cookie: cookiesNuevas,
          'x-csrf-token': csrfNuevo,
        })
      ).status,
    ).toBe(401);
  });

  it('sin cookie → 401', async () => {
    expect((await postAuth('/refresh')).status).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  it('revoca el refresh token — la sesión muere ahí', async () => {
    const ses = await loginComo(base, 'GERENTE');
    // Con sesión viva el double-submit CSRF también aplica (R23.7).
    expect(
      (await postAuth('/logout', undefined, { cookie: ses.cookie })).status,
    ).toBe(403);
    expect(
      (
        await postAuth('/logout', undefined, {
          cookie: ses.cookie,
          'x-csrf-token': ses.csrf,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await postAuth('/refresh', undefined, {
          cookie: ses.cookie,
          'x-csrf-token': ses.csrf,
        })
      ).status,
    ).toBe(401);
  });

  it('es idempotente sin sesión — limpia cookies y 200', async () => {
    const res = await postAuth('/logout', undefined, { cookie: 'mr_refresh=zzz' });
    expect(res.status).toBe(200);
  });
});

describe('POST /api/auth/cambiar-password', () => {
  it('cambia el password, invalida JWTs viejos y revoca refreshes', async () => {
    const ses = await loginComo(base, 'SERVICIO');
    const nueva = 'nueva-password-larga-2026';
    const res = await postAuth(
      '/cambiar-password',
      { actual: USUARIOS_TEST.SERVICIO.password, nueva },
      ses.headers,
    );
    expect(res.status).toBe(200);

    // El JWT viejo murió (token_version++), el refresh también.
    expect((await getAuth('/me', ses.headers)).status).toBe(401);
    expect(
      (
        await postAuth('/refresh', undefined, {
          cookie: ses.cookie,
          'x-csrf-token': ses.csrf,
        })
      ).status,
    ).toBe(401);

    // Re-login con la password nueva funciona.
    const relogin = await postAuth('/login', {
      email: USUARIOS_TEST.SERVICIO.email,
      password: nueva,
    });
    expect(relogin.status).toBe(200);

    // Restauro la original con el token del relogin — la suite
    // comparte DB.
    const { access_token: tokenNuevo } = await relogin.json();
    const restore = await postAuth(
      '/cambiar-password',
      { actual: nueva, nueva: USUARIOS_TEST.SERVICIO.password },
      { Authorization: `Bearer ${tokenNuevo}` },
    );
    expect(restore.status).toBe(200);
  });

  it('rechaza password actual incorrecta y nueva < 12 chars', async () => {
    const ses = await loginComo(base, 'ADMIN');
    expect(
      (
        await postAuth(
          '/cambiar-password',
          { actual: 'incorrecta', nueva: 'una-muy-larga-valida' },
          ses.headers,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await postAuth(
          '/cambiar-password',
          { actual: USUARIOS_TEST.ADMIN.password, nueva: 'corta' },
          ses.headers,
        )
      ).status,
    ).toBe(400);
  });
});

describe('requireAuth / requireRole sobre el dominio', () => {
  it('rutas de dominio devuelven 401 sin token', async () => {
    for (const path of ['/ordenes', '/productos', '/dashboard/stats', '/historial']) {
      expect((await fetch(`${base}/api${path}`)).status).toBe(401);
    }
  });

  it('SERVICIO lee y crea órdenes pero no puede aprobar (403)', async () => {
    const ses = await loginComo(base, 'SERVICIO');
    const headers = { 'Content-Type': 'application/json', ...ses.headers };
    expect(
      (await fetch(`${base}/api/ordenes`, { headers })).status,
    ).toBe(200);
    const creada = await fetch(`${base}/api/ordenes`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ producto_id: 1, cantidad: 1, requiere_aprobacion: true }),
    });
    expect(creada.status).toBe(201);
    const { data } = await creada.json();
    expect(
      (
        await fetch(`${base}/api/ordenes/${data.orden_id}/aprobar`, {
          method: 'POST',
          headers,
          body: '{}',
        })
      ).status,
    ).toBe(403);
  });

  it('aprobado_por sale del JWT — el body no puede suplantar identidad', async () => {
    const ses = await loginComo(base, 'GERENTE');
    const headers = { 'Content-Type': 'application/json', ...ses.headers };
    const creada = await fetch(`${base}/api/ordenes`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ producto_id: 1, cantidad: 1, requiere_aprobacion: true }),
    });
    const { data } = await creada.json();
    const res = await fetch(`${base}/api/ordenes/${data.orden_id}/aprobar`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ aprobado_por: 'otro@mercadorai.com' }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data.aprobado_por).toBe(
      'carlos.martinez@mercadorai.com',
    );
  });
});
