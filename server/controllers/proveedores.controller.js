import { capString } from '../security.js';
import {
  borrarProveedor,
  crearProveedor,
  getProveedor,
  listProveedores,
  patchearProveedor,
} from '../models/proveedores.model.js';

const respond = (res, r) => {
  if (r.error) return res.status(r.status).json({ error: r.error });
  return res.status(r.status).json(r.data ?? { ok: true });
};

const idValido = (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: 'id inválido' });
    return null;
  }
  return id;
};

export async function list(req, res) {
  const { activo, search, page = '1', limit = '20' } = req.query;

  const p = Number(page);
  const l = Number(limit);
  if (!Number.isInteger(p) || p < 1 || !Number.isInteger(l) || l < 1 || l > 100) {
    return res.status(400).json({ error: 'page/limit deben ser enteros positivos (limit ≤ 100)' });
  }
  let activoFilter;
  if (activo !== undefined) {
    if (activo !== '0' && activo !== '1') {
      return res.status(400).json({ error: 'activo debe ser 0 o 1' });
    }
    activoFilter = Number(activo);
  }

  res.json(
    await listProveedores({
      activo: activoFilter,
      search: search ? capString(search, 100) : undefined,
      page: p,
      limit: l,
    }),
  );
}

export async function detail(req, res) {
  const id = idValido(req, res);
  if (id === null) return;
  const r = await getProveedor(id);
  if (r.error) return respond(res, r);
  res.json(r);
}

export async function create(req, res) {
  respond(res, await crearProveedor(req.body ?? {}));
}

export async function patch(req, res) {
  const id = idValido(req, res);
  if (id === null) return;
  respond(res, await patchearProveedor(id, req.body ?? {}));
}

export async function remove(req, res) {
  const id = idValido(req, res);
  if (id === null) return;
  respond(res, await borrarProveedor(id));
}
