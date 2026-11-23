import { openDb } from '../db.js';
import { capString } from '../security.js';
import { hashPassword, MIN_PASSWORD_LENGTH, revocarRefreshesDe } from './auth.model.js';

// SPEC-24: CRUD admin de usuarios. `publico` de auth.model no basta
// acá — el listado admin necesita activo/ultimo_login/fecha_creacion,
// pero jamás password_hash, intentos_fallidos, bloqueado_hasta ni
// token_version (whitelist explícita, no exclusión).
export const ROLES = ['ADMIN', 'GERENTE', 'APROBADOR', 'SERVICIO'];
const CAMPOS =
  'id, email, nombre, rol, avatar_url, activo, ultimo_login, fecha_creacion';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function listUsuarios({ rol, activo, search, page, limit }) {
  const db = await openDb();
  const where = [];
  const params = [];

  if (rol) {
    where.push('rol = ?');
    params.push(rol);
  }
  if (activo !== undefined) {
    where.push('activo = ?');
    params.push(activo);
  }
  if (search) {
    // ILIKE — ver nota en productos.model.
    where.push('(email ILIKE ? OR nombre ILIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }

  const fromWhere = `FROM usuarios${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`;

  const { c: total } = await db.get(`SELECT COUNT(*) AS c ${fromWhere}`, params);
  const rows = await db.all(
    `SELECT ${CAMPOS} ${fromWhere} ORDER BY nombre ASC LIMIT ? OFFSET ?`,
    [...params, limit, (page - 1) * limit],
  );

  return {
    data: rows,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function crearUsuario({ email, nombre, rol, password }) {
  const db = await openDb();
  const emailNorm =
    typeof email === 'string' ? capString(email.trim().toLowerCase(), 254) : '';

  if (!EMAIL_RE.test(emailNorm)) return { status: 400, error: 'email inválido' };
  if (typeof nombre !== 'string' || !nombre.trim()) {
    return { status: 400, error: 'nombre requerido' };
  }
  const nombreNorm = capString(nombre.trim(), 200);
  if (!ROLES.includes(rol)) {
    return { status: 400, error: `rol inválido — válidos: ${ROLES.join(', ')}` };
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return {
      status: 400,
      error: `password debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`,
    };
  }
  if (await db.get('SELECT id FROM usuarios WHERE email = ?', [emailNorm])) {
    return {
      status: 409,
      error: 'email ya registrado — si fue eliminado, reactivá el usuario existente',
    };
  }

  let insertado;
  try {
    ({ lastInsertRowid: insertado } = await db
      .prepare(
        'INSERT INTO usuarios (email, nombre, rol, password_hash) VALUES (?, ?, ?, ?) RETURNING id',
      )
      .run(emailNorm, nombreNorm, rol, hashPassword(password)));
  } catch (e) {
    // UNIQUE violation en PG: el check anterior ya cubre el caso
    // normal; esto blinda la carrera entre el SELECT y el INSERT.
    if (e.code === '23505') {
      return { status: 409, error: 'email ya registrado — si fue eliminado, reactivá el usuario existente' };
    }
    throw e;
  }
  return {
    status: 201,
    data: await db.get(`SELECT ${CAMPOS} FROM usuarios WHERE id = ?`, [insertado]),
  };
}

// Guards compartidos PATCH/DELETE: un admin no puede degradarse ni
// desactivarse a sí mismo, y ninguna operación puede dejar el sistema
// sin el último ADMIN activo.
async function guardTarget(db, usuario, cambios, actorId) {
  const pierdeAdmin =
    usuario.rol === 'ADMIN' &&
    ((cambios.rol !== undefined && cambios.rol !== 'ADMIN') || cambios.activo === 0);
  const seDesactiva = cambios.activo === 0;

  if (usuario.id === actorId && (pierdeAdmin || seDesactiva)) {
    return { status: 409, error: 'no podés quitarte el rol de admin ni desactivarte a vos mismo' };
  }
  if (usuario.rol === 'ADMIN' && usuario.activo === 1 && (pierdeAdmin || seDesactiva)) {
    const { c: otrosAdmins } = await db.get(
      'SELECT COUNT(*) AS c FROM usuarios WHERE rol = ? AND activo = 1 AND id != ?',
      ['ADMIN', usuario.id],
    );
    if (otrosAdmins === 0) {
      return { status: 409, error: 'no se puede eliminar el último administrador activo' };
    }
  }
  return null;
}

// Revoca todas las sesiones del target: token_version++ invalida los
// JWT ya emitidos y revocarRefreshesDe tira los refresh tokens.
async function invalidarSesiones(db, usuarioId) {
  await db.run('UPDATE usuarios SET token_version = token_version + 1 WHERE id = ?', [usuarioId]);
  await revocarRefreshesDe(usuarioId);
}

export async function patchearUsuario(id, { nombre, email, rol, activo }, actorId) {
  const db = await openDb();
  const usuario = await db.get('SELECT * FROM usuarios WHERE id = ?', [id]);
  if (!usuario) return { status: 404, error: 'usuario no encontrado' };

  if (nombre === undefined && email === undefined && rol === undefined && activo === undefined) {
    return { status: 400, error: 'nada que actualizar' };
  }

  const sets = [];
  const params = [];

  if (nombre !== undefined) {
    if (typeof nombre !== 'string' || !nombre.trim()) {
      return { status: 400, error: 'nombre debe ser un string no vacío' };
    }
    sets.push('nombre = ?');
    params.push(capString(nombre.trim(), 200));
  }
  if (email !== undefined) {
    const emailNorm =
      typeof email === 'string' ? capString(email.trim().toLowerCase(), 254) : '';
    if (!EMAIL_RE.test(emailNorm)) return { status: 400, error: 'email inválido' };
    const dup = await db.get('SELECT id FROM usuarios WHERE email = ? AND id != ?', [
      emailNorm,
      id,
    ]);
    if (dup) return { status: 409, error: 'email ya registrado por otro usuario' };
    sets.push('email = ?');
    params.push(emailNorm);
  }
  if (rol !== undefined) {
    if (!ROLES.includes(rol)) {
      return { status: 400, error: `rol inválido — válidos: ${ROLES.join(', ')}` };
    }
    sets.push('rol = ?');
    params.push(rol);
  }
  if (activo !== undefined) {
    if (activo !== 0 && activo !== 1 && activo !== true && activo !== false) {
      return { status: 400, error: 'activo debe ser booleano' };
    }
    sets.push('activo = ?');
    params.push(activo ? 1 : 0);
  }

  const cambios = {
    rol: rol !== undefined && rol !== usuario.rol ? rol : undefined,
    activo: activo !== undefined && (activo ? 1 : 0) !== usuario.activo ? (activo ? 1 : 0) : undefined,
  };
  const guard = await guardTarget(db, usuario, cambios, actorId);
  if (guard) return guard;

  await db.run(`UPDATE usuarios SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);

  // Cambio de rol o desactivación → cerrar todas sus sesiones.
  if (cambios.rol !== undefined || cambios.activo === 0) {
    await invalidarSesiones(db, id);
  }
  return { status: 200, data: await db.get(`SELECT ${CAMPOS} FROM usuarios WHERE id = ?`, [id]) };
}

export async function borrarUsuario(id, actorId) {
  const db = await openDb();
  const usuario = await db.get('SELECT * FROM usuarios WHERE id = ?', [id]);
  if (!usuario) return { status: 404, error: 'usuario no encontrado' };

  const guard = await guardTarget(db, usuario, { activo: 0 }, actorId);
  if (guard) return guard;
  if (usuario.activo === 0) {
    return { status: 200, data: await db.get(`SELECT ${CAMPOS} FROM usuarios WHERE id = ?`, [id]) };
  }

  await db.run('UPDATE usuarios SET activo = 0 WHERE id = ?', [id]);
  await invalidarSesiones(db, id);
  return { status: 200, data: await db.get(`SELECT ${CAMPOS} FROM usuarios WHERE id = ?`, [id]) };
}
