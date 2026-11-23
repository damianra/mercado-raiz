import { capString } from '../security.js';
import {
  borrarUsuario,
  crearUsuario,
  listUsuarios,
  patchearUsuario,
  ROLES,
} from '../models/usuarios.model.js';

const respond = (res, r) => {
  if (r.error) return res.status(r.status).json({ error: r.error });
  return res.status(r.status).json(r.data ?? { ok: true });
};

export async function list(req, res) {
  const { rol, activo, search, page = '1', limit = '20' } = req.query;

  const p = Number(page);
  const l = Number(limit);
  if (!Number.isInteger(p) || p < 1 || !Number.isInteger(l) || l < 1 || l > 100) {
    return res.status(400).json({ error: 'page/limit deben ser enteros positivos (limit ≤ 100)' });
  }
  if (rol && !ROLES.includes(rol)) {
    return res.status(400).json({ error: `rol inválido — válidos: ${ROLES.join(', ')}` });
  }
  let activoFilter;
  if (activo !== undefined) {
    if (activo !== '0' && activo !== '1') {
      return res.status(400).json({ error: 'activo debe ser 0 o 1' });
    }
    activoFilter = Number(activo);
  }

  res.json(
    await listUsuarios({
      rol: rol || undefined,
      activo: activoFilter,
      search: search ? capString(search, 100) : undefined,
      page: p,
      limit: l,
    }),
  );
}

export async function create(req, res) {
  const { email, nombre, rol, password } = req.body ?? {};
  respond(res, await crearUsuario({ email, nombre, rol, password }));
}

export async function patch(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'id inválido' });
  }
  const { nombre, email, rol, activo } = req.body ?? {};
  respond(res, await patchearUsuario(id, { nombre, email, rol, activo }, req.usuario.id));
}

export async function remove(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'id inválido' });
  }
  respond(res, await borrarUsuario(id, req.usuario.id));
}
