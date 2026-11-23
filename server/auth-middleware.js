// Middlewares de auth (SPEC-23). Se aplican por router — cada
// server/routes/<name>.js hace `router.use(requireAuth)` salvo las
// rutas públicas (/api/auth/login|refresh, /api/health).
import { usuarioParaToken, verificarAccessToken } from './models/auth.model.js';

// Exige `Authorization: Bearer <jwt>` válido y con token_version al
// día (rol/password cambiados → JWTs viejos mueren aunque no expiró).
// Deja req.usuario = {id, email, nombre, rol, avatar_url}.
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'autenticación requerida' });
  }
  try {
    const payload = await verificarAccessToken(token);
    const usuario = await usuarioParaToken(payload);
    if (!usuario) {
      return res.status(401).json({ error: 'sesión inválida o expirada' });
    }
    req.usuario = usuario;
    next();
  } catch {
    res.status(401).json({ error: 'sesión inválida o expirada' });
  }
}

// Matriz de roles (SPEC-24): requireRole('APROBADOR','GERENTE','ADMIN')
// corre DESPUÉS de requireAuth — 403 si req.usuario.rol no está.
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.usuario || !roles.includes(req.usuario.rol)) {
      return res.status(403).json({ error: 'permisos insuficientes' });
    }
    next();
  };
}

// SPEC-29 (R29.1): el BUYER solo consume /api/alertas — el resto
// de las rutas de dominio lo rechaza con 403. Se aplica después de
// requireAuth en cada routes/<name>.js protegido.
export function bloquearBuyer(req, res, next) {
  if (req.usuario?.rol === 'BUYER') {
    return res.status(403).json({ error: 'permisos insuficientes' });
  }
  next();
}
