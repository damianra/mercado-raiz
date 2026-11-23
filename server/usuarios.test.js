// @vitest-environment node
// SPEC-24: CRUD /api/usuarios solo ADMIN. DB ':memory:' compartida
// por archivo — los describes crean usuarios propios para no pisar
// el seed (los guards self/último-admin usan al admin del seed).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { closeDb, openDb } from './db.js';
import { loginComo } from './test-auth.js';

let server;
let base;
let sesion; // ADMIN — el único rol que puede /api/usuarios
const db = await openDb({ searchPath: 't_usuarios' });

beforeEach(async () => {
  const app = await createApp();
  server = app.listen(0);
  base = `http://localhost:${server.address().port}`;
  sesion ??= await loginComo(base, 'ADMIN');
});

afterEach(() => server?.close());
afterAll(() => closeDb(true));

const req = (path, method = 'GET', body, headers = sesion.headers) =>
  fetch(`${base}/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json', ...headers } : headers,
    body: body ? JSON.stringify(body) : undefined,
  });

const crear = (over = {}) =>
  req('/usuarios', 'POST', {
    email: `u${Date.now()}${Math.random().toString(16).slice(2)}@test.com`,
    nombre: 'Usuario Test',
    rol: 'APROBADOR',
    password: 'password-de-prueba-123',
    ...over,
  }).then((r) => r.json().then((b) => ({ status: r.status, body: b })));

describe('GET /api/usuarios — control de acceso', () => {
  it('401 sin token', async () => {
    const r = await fetch(`${base}/api/usuarios`);
    expect(r.status).toBe(401);
  });

  it.each(['GERENTE', 'APROBADOR', 'SERVICIO'])('403 con rol %s', async (rol) => {
    const otra = await loginComo(base, rol);
    const r = await req('/usuarios', 'GET', undefined, otra.headers);
    expect(r.status).toBe(403);
  });

  it('200 con ADMIN: contrato de paginación y whitelist sin password_hash', async () => {
    const r = await req('/usuarios');
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.pagination).toMatchObject({ page: 1, limit: 20 });
    expect(body.pagination.total).toBeGreaterThanOrEqual(4);
    expect(body.data.length).toBeGreaterThanOrEqual(4);
    for (const u of body.data) {
      expect(u).not.toHaveProperty('password_hash');
      expect(u).not.toHaveProperty('intentos_fallidos');
      expect(u).not.toHaveProperty('bloqueado_hasta');
      expect(u).not.toHaveProperty('token_version');
      expect(u).toHaveProperty('activo');
    }
  });

  it('filtros rol / activo / search', async () => {
    await crear({ email: 'filtro-unico@test.com', rol: 'SERVICIO' });
    const porRol = await (await req('/usuarios?rol=SERVICIO')).json();
    expect(porRol.data.every((u) => u.rol === 'SERVICIO')).toBe(true);
    const porSearch = await (await req('/usuarios?search=filtro-unico')).json();
    expect(porSearch.data).toHaveLength(1);
    const inactivos = await (await req('/usuarios?activo=0')).json();
    expect(inactivos.data.every((u) => u.activo === 0)).toBe(true);
  });

  it('400 con page/limit o rol inválidos', async () => {
    expect((await req('/usuarios?page=0')).status).toBe(400);
    expect((await req('/usuarios?limit=101')).status).toBe(400);
    expect((await req('/usuarios?rol=SUPER')).status).toBe(400);
    expect((await req('/usuarios?activo=x')).status).toBe(400);
  });
});

describe('POST /api/usuarios — alta', () => {
  it('201 crea y devuelve usuario sin campos de seguridad', async () => {
    const { status, body } = await crear({ nombre: 'Nuevo Aprobador' });
    expect(status).toBe(201);
    expect(body).toMatchObject({ nombre: 'Nuevo Aprobador', rol: 'APROBADOR', activo: 1 });
    expect(body).not.toHaveProperty('password_hash');
  });

  it('el usuario creado puede loguear con su password', async () => {
    const email = 'login-test@test.com';
    await crear({ email, password: 'su-password-123' });
    const r = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'su-password-123' }),
    });
    expect(r.status).toBe(200);
  });

  it('409 email duplicado', async () => {
    const { status, body } = await crear({ email: 'admin@mercadorai.com' });
    expect(status).toBe(409);
    expect(body.error).toMatch(/reactivá/);
  });

  it('400 validaciones: email, rol, password <12, nombre vacío', async () => {
    expect((await crear({ email: 'no-es-email' })).status).toBe(400);
    expect((await crear({ rol: 'SUPERADMIN' })).status).toBe(400);
    expect((await crear({ password: 'corta' })).status).toBe(400);
    expect((await crear({ nombre: '  ' })).status).toBe(400);
  });
});

describe('PATCH /api/usuarios/:id — edición', () => {
  it('200 edita nombre y rol', async () => {
    const { body: u } = await crear();
    const r = await req(`/usuarios/${u.id}`, 'PATCH', { nombre: 'Renombrado', rol: 'GERENTE' });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ nombre: 'Renombrado', rol: 'GERENTE' });
  });

  it('404 inexistente · 400 sin campos · 400 activo no booleano', async () => {
    expect((await req('/usuarios/99999', 'PATCH', { nombre: 'x' })).status).toBe(404);
    const { body: u } = await crear();
    expect((await req(`/usuarios/${u.id}`, 'PATCH', {})).status).toBe(400);
    expect((await req(`/usuarios/${u.id}`, 'PATCH', { activo: 'tal vez' })).status).toBe(400);
  });

  it('409 email de otro usuario', async () => {
    const { body: u } = await crear();
    const r = await req(`/usuarios/${u.id}`, 'PATCH', { email: 'admin@mercadorai.com' });
    expect(r.status).toBe(409);
  });

  it('PATCH solo-nombre NO revoca sesiones del usuario', async () => {
    const email = 'nombre-only@test.com';
    await crear({ email, password: 'su-password-123' });
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'su-password-123' }),
    });
    const { access_token } = await login.json();
    const target = await db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email);
    await req(`/usuarios/${target.id}`, 'PATCH', { nombre: 'Solo Nombre Nuevo' });
    const sigue = await fetch(`${base}/api/ordenes`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    expect(sigue.status).toBe(200);
  });

  it('cambio de rol invalida JWT y refresh del usuario', async () => {
    const email = 'rol-change@test.com';
    await crear({ email, rol: 'APROBADOR', password: 'su-password-123' });
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'su-password-123' }),
    });
    const { access_token } = await login.json();
    const cookies = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const csrf = cookies.match(/mr_csrf=([^;]+)/)?.[1];

    // El token funciona antes del cambio de rol.
    const antes = await fetch(`${base}/api/ordenes`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    expect(antes.status).toBe(200);

    const target = await db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email);
    await req(`/usuarios/${target.id}`, 'PATCH', { rol: 'GERENTE' });

    const despues = await fetch(`${base}/api/ordenes`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    expect(despues.status).toBe(401);
    const refresh = await fetch(`${base}/api/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: cookies, 'X-CSRF-Token': csrf },
    });
    expect(refresh.status).toBe(401);
  });

  it('desactivar invalida sesiones y bloquea login', async () => {
    const email = 'deactivate@test.com';
    await crear({ email, password: 'su-password-123' });
    const target = await db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email);
    await req(`/usuarios/${target.id}`, 'PATCH', { activo: false });

    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'su-password-123' }),
    });
    expect(login.status).toBe(401);
  });
});

describe('DELETE /api/usuarios/:id — soft delete y guards', () => {
  it('soft delete: activo=0, sesiones revocadas, el registro sigue', async () => {
    const { body: u } = await crear();
    const r = await req(`/usuarios/${u.id}`, 'DELETE');
    expect(r.status).toBe(200);
    expect((await r.json()).activo).toBe(0);
    const row = await db.prepare('SELECT * FROM usuarios WHERE id = ?').get(u.id);
    expect(row).toBeTruthy();
    expect(row.activo).toBe(0);
    const { c: tokens } = await db
      .prepare('SELECT COUNT(*) AS c FROM refresh_tokens WHERE usuario_id = ? AND revocado = 0')
      .get(u.id);
    expect(tokens).toBe(0);
  });

  it('DELETE sobre usuario ya inactivo es idempotente (200)', async () => {
    const { body: u } = await crear();
    await req(`/usuarios/${u.id}`, 'DELETE');
    const r = await req(`/usuarios/${u.id}`, 'DELETE');
    expect(r.status).toBe(200);
    expect((await r.json()).activo).toBe(0);
  });

  it('409 self-delete y self-degrade (único ADMIN activo = último)', async () => {
    // El admin del seed es el único activo → self-delete, self-degrade
    // y self-desactivar tocan el guard (self + último admin a la vez).
    expect((await req(`/usuarios/${sesion.usuario.id}`, 'DELETE')).status).toBe(409);
    expect(
      (await req(`/usuarios/${sesion.usuario.id}`, 'PATCH', { rol: 'GERENTE' })).status,
    ).toBe(409);
    expect(
      (await req(`/usuarios/${sesion.usuario.id}`, 'PATCH', { activo: false })).status,
    ).toBe(409);
  });

  it('un admin SÍ puede borrar a otro admin (queda uno activo) — y la sesión del borrado muere', async () => {
    // Último del archivo: la sesión del admin del seed queda muerta.
    const { body: admin2 } = await crear({
      email: 'segundo-admin@test.com',
      rol: 'ADMIN',
      nombre: 'Segundo Admin',
    });
    const login2 = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'segundo-admin@test.com', password: 'password-de-prueba-123' }),
    });
    const { access_token: t2 } = await login2.json();

    const r = await fetch(`${base}/api/usuarios/${sesion.usuario.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${t2}` },
    });
    expect(r.status).toBe(200);
    // El JWT del admin borrado ya no sirve (token_version++).
    expect((await req('/usuarios')).status).toBe(401);
  });
});
