// Autenticación (SPEC-23): passwords con crypto.scrypt nativo
// (node:crypto — CI/prod corren Node 22 donde crypto.argon2Sync
// aún no existe), JWT HS256 de 15 min para el access y refresh
// tokens opacos rotativos persistidos como SHA-256 con reuse
// detection por familia.

import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import crypto from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { openDb } from '../db.js';

// --- Passwords (scrypt, formato $scrypt$N,r,p$salt$hash) ---

const SCRYPT = { N: 16384, r: 8, p: 1 };
const KEY_LEN = 64;
// argon2id solo se verifica para hashes legacy generados con
// Node ≥24.7 (argon2Sync nativo) — en Node 22 es undefined y esos
// hashes devuelven false sin romper el proceso.
const argon2Sync = crypto.argon2Sync;

export const MIN_PASSWORD_LENGTH = 12;

export function hashPassword(password) {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, KEY_LEN, SCRYPT);
  const params = `N=${SCRYPT.N},r=${SCRYPT.r},p=${SCRYPT.p}`;
  return `$scrypt$${params}$${salt.toString('base64')}$${key.toString('base64')}`;
}

// Verifica en tiempo constante. Soporta $scrypt$ (nativo, emite
// hashPassword) y $argon2id$ (legacy Node ≥24.7). Un hash mal
// formado → false, nunca throw — el atacante no distingue entre
// "usuario sin hash" y "password malo".
export function verifyPassword(password, stored) {
  const partes = String(stored ?? '').split('$');
  // ['', 'scrypt', 'N=…,r=…,p=…', saltB64, keyB64]
  if (partes.length !== 5) return false;
  const params = Object.fromEntries(partes[2].split(',').map((kv) => kv.split('=')));
  const salt = Buffer.from(partes[3], 'base64');
  const esperado = Buffer.from(partes[4], 'base64');
  let key;
  try {
    if (partes[1] === 'scrypt') {
      key = scryptSync(password, salt, esperado.length, {
        N: Number(params.N),
        r: Number(params.r),
        p: Number(params.p),
      });
    } else if (partes[1] === 'argon2id' && argon2Sync) {
      key = argon2Sync('argon2id', {
        message: password,
        nonce: salt,
        parallelism: Number(params.p),
        tagLength: esperado.length,
        memory: Number(params.m),
        passes: Number(params.t),
      });
    } else {
      return false;
    }
  } catch {
    return false;
  }
  return key.length === esperado.length && timingSafeEqual(key, esperado);
}

// --- JWT (access token, 15 min) ---

let warnSinSecret = false;
const secret = () => {
  const s = process.env.JWT_SECRET || 'dev-only-jwt-secret-do-not-use-in-prod';
  if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET && !warnSinSecret) {
    warnSinSecret = true;
    console.warn('JWT_SECRET no configurado — usando secreto dev inseguro');
  }
  return new TextEncoder().encode(s);
};

export async function firmarAccessToken(usuario) {
  return new SignJWT({ rol: usuario.rol, token_version: usuario.token_version })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(usuario.id))
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(secret());
}

export async function verificarAccessToken(token) {
  const { payload } = await jwtVerify(token, secret());
  return payload; // { sub, rol, token_version, iat, exp }
}

// --- Refresh tokens opacos ---

const REFRESH_TTL_DIAS = 7;
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const nuevoSecreto = () => randomBytes(32).toString('base64url');
const hashEq = (a, b) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

function insertarRefresh(usuarioId, familia, csrf, req) {
  const secreto = nuevoSecreto();
  openDb()
    .prepare(
      `INSERT INTO refresh_tokens
       (usuario_id, token_hash, familia, csrf_hash, expira_en, user_agent, ip)
       VALUES (?, ?, ?, ?, datetime('now', '+${REFRESH_TTL_DIAS} days'), ?, ?)`,
    )
    .run(
      usuarioId,
      sha256(secreto),
      familia,
      sha256(csrf),
      req?.headers?.['user-agent'] ?? null,
      req?.ip ?? null,
    );
  // El token viaja como familia.secreto — la familia en claro permite
  // detectar reutilización sin escanear la tabla.
  return `${familia}.${secreto}`;
}

// Emite par (refresh cookie value, csrf token) para una familia nueva.
export function emitirRefresh(usuarioId, req) {
  const familia = randomBytes(16).toString('base64url');
  const csrf = nuevoSecreto();
  return { refresh: insertarRefresh(usuarioId, familia, csrf, req), csrf };
}

// Rota el refresh de la cookie. Devuelve {usuario, refresh, csrf} o
// lanza {status:401|403}. Reuse detection: token de familia conocida
// pero no vigente → revoca TODA la familia (alguien re-usó un token
// viejo).
export function rotarRefresh(cookieToken, csrfHeader, req) {
  const db = openDb();
  const [familia] = String(cookieToken ?? '').split('.');
  if (!familia) throw { status: 401, error: 'sesión expirada' };

  const row = db
    .prepare(
      `SELECT * FROM refresh_tokens
       WHERE token_hash = ? AND revocado = 0 AND expira_en > datetime('now')`,
    )
    .get(sha256(cookieToken.split('.')[1] ?? ''));

  if (!row) {
    // ¿La familia existe? → reutilización de un token ya rotado:
    // posible robo — se revoca la familia entera.
    const { c } = db
      .prepare('SELECT COUNT(*) AS c FROM refresh_tokens WHERE familia = ?')
      .get(familia);
    if (c > 0) {
      db.prepare('UPDATE refresh_tokens SET revocado = 1 WHERE familia = ?').run(familia);
    }
    throw { status: 401, error: 'sesión expirada' };
  }

  // CSRF double-submit: el header debe matchear el hash persistido.
  if (!csrfHeader || !hashEq(sha256(csrfHeader), row.csrf_hash)) {
    throw { status: 403, error: 'csrf token inválido' };
  }

  const usuario = db
    .prepare('SELECT * FROM usuarios WHERE id = ? AND activo = 1')
    .get(row.usuario_id);
  if (!usuario) throw { status: 401, error: 'sesión expirada' };

  // Rotación: el viejo queda revocado, entra uno nuevo de la familia.
  db.prepare('UPDATE refresh_tokens SET revocado = 1 WHERE id = ?').run(row.id);
  const csrf = nuevoSecreto();
  const refresh = insertarRefresh(usuario.id, row.familia, csrf, req);
  return { usuario, refresh, csrf };
}

export function revocarRefresh(cookieToken) {
  if (!cookieToken) return;
  openDb()
    .prepare('UPDATE refresh_tokens SET revocado = 1 WHERE token_hash = ?')
    .run(sha256(String(cookieToken).split('.')[1] ?? ''));
}

// Para logout con CSRF (SPEC-23): devuelve la fila vigente del
// refresh de la cookie, o null si ya murió/nunca existió.
export function getRefreshVigente(cookieToken) {
  if (!cookieToken) return null;
  return openDb()
    .prepare(
      `SELECT * FROM refresh_tokens
       WHERE token_hash = ? AND revocado = 0 AND expira_en > datetime('now')`,
    )
    .get(sha256(String(cookieToken).split('.')[1] ?? ''));
}

export function revocarRefreshesDe(usuarioId) {
  openDb()
    .prepare('UPDATE refresh_tokens SET revocado = 1 WHERE usuario_id = ?')
    .run(usuarioId);
}

// --- Login con lockout ---

const MAX_INTENTOS = 5;
const BLOQUEO_MIN = 15;
// Hash precalculado de un string aleatorio — se verifica cuando el
// email no existe o el usuario está inactivo para que la latencia
// del 401 no delate si el usuario existe (anti oráculo de timing).
const DUMMY_HASH =
  '$scrypt$N=16384,r=8,p=1$hxmrVMe2rTyjhj4OWFzMnA==$' +
  '+3p62UBKA+A6n4MUoIhpi72wziJkNrNPUqH96D9VrlIcmjYq4QZoVhV5EgtMKIELXyNGskHSACCVYuJNROWF6g==';

export function getUsuarioPorEmail(email) {
  return openDb().prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
}

// Devuelve el usuario autenticado o null (401 genérica afuera — sin
// oráculo de "el email existe pero la password no").
export function autenticar(email, password) {
  const db = openDb();
  const usuario = getUsuarioPorEmail(email);
  const ahora = new Date().toISOString().replace('T', ' ').slice(0, 19);

  // Bloqueo vencido → se re-arma el contador en 0 (sino un solo
  // fallo posterior re-bloquearía 15 min indefinidamente).
  if (usuario?.bloqueado_hasta && usuario.bloqueado_hasta <= ahora) {
    db.prepare(
      'UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = ?',
    ).run(usuario.id);
    usuario.intentos_fallidos = 0;
    usuario.bloqueado_hasta = null;
  }

  // Lockout activo → misma respuesta genérica (el front no distingue),
  // pero el verify dummy iguala la latencia con un intento real.
  const bloqueado = usuario?.bloqueado_hasta && usuario.bloqueado_hasta > ahora;
  if (!usuario || !usuario.activo || bloqueado) {
    verifyPassword(password, DUMMY_HASH);
    return null;
  }

  if (!verifyPassword(password, usuario.password_hash)) {
    const intentos = usuario.intentos_fallidos + 1;
    db.prepare(
      `UPDATE usuarios SET intentos_fallidos = ?,
       bloqueado_hasta = CASE WHEN ? >= ? THEN datetime('now', '+${BLOQUEO_MIN} minutes') ELSE bloqueado_hasta END
       WHERE id = ?`,
    ).run(intentos, intentos, MAX_INTENTOS, usuario.id);
    return null;
  }

  db.prepare(
    `UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL,
     ultimo_login = datetime('now') WHERE id = ?`,
  ).run(usuario.id);
  return { ...usuario, intentos_fallidos: 0 };
}

// Cambio de password self-service: cierra TODAS las sesiones del
// usuario (token_version++ invalida JWTs, revoca refreshes).
export function cambiarPassword(usuarioId, actual, nueva) {
  const db = openDb();
  const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(usuarioId);
  if (!usuario || !verifyPassword(actual, usuario.password_hash)) {
    return { status: 401, error: 'credenciales inválidas' };
  }
  if (typeof nueva !== 'string' || nueva.length < MIN_PASSWORD_LENGTH) {
    return {
      status: 400,
      error: `la nueva contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`,
    };
  }
  db.prepare(
    'UPDATE usuarios SET password_hash = ?, token_version = token_version + 1 WHERE id = ?',
  ).run(hashPassword(nueva), usuarioId);
  revocarRefreshesDe(usuarioId);
  return { status: 200 };
}

// Usuario vigente para requireAuth: existe, activo y token_version
// al día (un cambio de rol/password invalida JWTs emitidos antes).
export function usuarioParaToken(payload) {
  if (!payload?.sub) return null;
  const u = openDb()
    .prepare(
      `SELECT id, email, nombre, rol, avatar_url, token_version
       FROM usuarios WHERE id = ? AND activo = 1`,
    )
    .get(Number(payload.sub));
  if (!u || u.token_version !== payload.token_version) return null;
  return u;
}

export const publico = (u) => ({
  id: u.id,
  email: u.email,
  nombre: u.nombre,
  rol: u.rol,
  avatar_url: u.avatar_url,
});
