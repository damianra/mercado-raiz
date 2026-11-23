// Controller de /api/auth (SPEC-23): login emite access JWT + cookie
// de refresh opaca; refresh rota con CSRF double-submit; logout
// revoca; me devuelve la sesión actual.
import {
  autenticar,
  cambiarPassword,
  emitirRefresh,
  firmarAccessToken,
  publico,
  revocarRefresh,
  rotarRefresh,
} from '../models/auth.model.js';

const COOKIE_REFRESH = 'mr_refresh';
const COOKIE_CSRF = 'mr_csrf';
const REFRESH_PATH = '/api/auth';

const esProd = () => process.env.NODE_ENV === 'production';

const cookieRefresh = (valor, maxAgeSeg) =>
  `${COOKIE_REFRESH}=${valor}; HttpOnly; SameSite=Strict; Path=${REFRESH_PATH}` +
  (esProd() ? '; Secure' : '') +
  (maxAgeSeg !== undefined ? `; Max-Age=${maxAgeSeg}` : '');

// Cookie CSRF double-submit: legible por el front (NO httpOnly) —
// el cliente la lee y la manda como X-CSRF-Token. Path=/ porque
// document.cookie solo expone cookies cuyo Path cubre la página —
// con /api/auth el front nunca la vería y el silent refresh del
// boot moriría. No es credencial: la seguridad está en el hash
// persistido y en SameSite=Strict.
const cookieCsrf = (valor, maxAgeSeg) =>
  `${COOKIE_CSRF}=${valor}; SameSite=Strict; Path=/` +
  (esProd() ? '; Secure' : '') +
  (maxAgeSeg !== undefined ? `; Max-Age=${maxAgeSeg}` : '');

const leerCookie = (req, nombre) => {
  const raw = req.headers.cookie ?? '';
  for (const par of raw.split(';')) {
    const [k, ...v] = par.trim().split('=');
    if (k === nombre) return decodeURIComponent(v.join('='));
  }
  return null;
};

const badRequest = (res, msg) => res.status(400).json({ error: msg });
const generica401 = (res) =>
  res.status(401).json({ error: 'credenciales inválidas' });

// POST /api/auth/login {email, password} → {access_token, usuario, csrf}
// + Set-Cookie refresh. 401 genérica idéntica ante cualquier fallo
// (email inexistente, password malo, usuario inactivo, bloqueado).
export async function login(req, res) {
  const { email, password } = req.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    return badRequest(res, 'email y password son requeridos');
  }
  const usuario = autenticar(email.trim().toLowerCase(), password);
  if (!usuario) return generica401(res);

  const { refresh, csrf } = emitirRefresh(usuario.id, req);
  res.setHeader('Set-Cookie', [
    cookieRefresh(refresh, 7 * 86_400),
    cookieCsrf(csrf, 7 * 86_400),
  ]);
  res.json({
    access_token: await firmarAccessToken(usuario),
    usuario: publico(usuario),
  });
}

// POST /api/auth/refresh — cookies refresh + X-CSRF-Token (el front
// la lee de la cookie mr_csrf) → nuevo par rotado.
export async function refresh(req, res) {
  try {
    const { usuario, refresh: nuevo, csrf } = rotarRefresh(
      leerCookie(req, COOKIE_REFRESH),
      req.headers['x-csrf-token'],
      req,
    );
    res.setHeader('Set-Cookie', [
      cookieRefresh(nuevo, 7 * 86_400),
      cookieCsrf(csrf, 7 * 86_400),
    ]);
    res.json({
      access_token: await firmarAccessToken(usuario),
      usuario: publico(usuario),
    });
  } catch (e) {
    // Sesión muerta: limpiar las cookies para que no reintente.
    res.setHeader('Set-Cookie', [cookieRefresh('', 0), cookieCsrf('', 0)]);
    res.status(e.status ?? 401).json({ error: e.error ?? 'sesión expirada' });
  }
}

// POST /api/auth/logout — revoca el refresh actual y borra cookies.
export function logout(req, res) {
  revocarRefresh(leerCookie(req, COOKIE_REFRESH));
  res.setHeader('Set-Cookie', [cookieRefresh('', 0), cookieCsrf('', 0)]);
  res.json({ ok: true });
}

// GET /api/auth/me — requireAuth ya dejó req.usuario.
export function me(req, res) {
  res.json({ usuario: publico(req.usuario) });
}

// POST /api/auth/cambiar-password — cierra todas las sesiones del
// usuario (incluida la actual): el front vuelve a /login.
export function cambiarPasswordController(req, res) {
  const { actual, nueva } = req.body ?? {};
  if (typeof actual !== 'string' || typeof nueva !== 'string') {
    return badRequest(res, 'actual y nueva son requeridas');
  }
  const r = cambiarPassword(req.usuario.id, actual, nueva);
  if (r.status !== 200) return res.status(r.status).json({ error: r.error });
  res.json({ ok: true });
}
