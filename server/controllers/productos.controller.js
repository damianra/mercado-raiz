import { capString } from '../security.js';
import { ESTADOS_PRODUCTO, listProductos } from '../models/productos.model.js';

export function list(req, res) {
  const { estado, categoria, proveedor_id, search, page = '1', limit = '20' } = req.query;

  const p = Number(page);
  const l = Number(limit);
  if (!Number.isInteger(p) || p < 1 || !Number.isInteger(l) || l < 1 || l > 100) {
    return res.status(400).json({ error: 'page/limit deben ser enteros positivos (limit ≤ 100)' });
  }
  if (estado && !ESTADOS_PRODUCTO.includes(estado)) {
    return res.status(400).json({ error: `estado inválido — válidos: ${ESTADOS_PRODUCTO.join(', ')}` });
  }
  let proveedorId;
  if (proveedor_id !== undefined) {
    proveedorId = Number(proveedor_id);
    if (!Number.isInteger(proveedorId) || proveedorId < 1) {
      return res.status(400).json({ error: 'proveedor_id debe ser un entero positivo' });
    }
  }

  res.json(
    listProductos({
      estado: estado || undefined,
      categoria: categoria ? capString(categoria, 100) : undefined,
      proveedorId,
      search: search ? capString(search, 100) : undefined,
      page: p,
      limit: l,
    }),
  );
}
