import { capString } from '../security.js';
import { competenciaProducto } from '../models/competencia.model.js';
import {
  ESTADOS_PRODUCTO,
  MOTIVOS_PRECIO,
  actualizarPrecio,
  getProducto,
  listProductos,
} from '../models/productos.model.js';

export async function list(req, res) {
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
    await listProductos({
      estado: estado || undefined,
      categoria: categoria ? capString(categoria, 100) : undefined,
      proveedorId,
      search: search ? capString(search, 100) : undefined,
      page: p,
      limit: l,
    }),
  );
}

export async function get(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'id debe ser un entero positivo' });
  }
  const producto = await getProducto(id);
  if (!producto) return res.status(404).json({ error: 'producto no encontrado' });
  res.json(producto);
}

export async function getCompetencia(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'id debe ser un entero positivo' });
  }
  const pos = await competenciaProducto(id);
  if (!pos) return res.status(404).json({ error: 'producto no encontrado' });
  res.json(pos);
}

export async function patchPrecio(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'id debe ser un entero positivo' });
  }
  const { precio, motivo, confirmar_bajo_costo } = req.body ?? {};
  const p = Number(precio);
  if (!Number.isFinite(p) || p <= 0) {
    return res.status(400).json({ error: 'precio debe ser un número mayor a 0' });
  }
  if (!MOTIVOS_PRECIO.includes(motivo)) {
    return res.status(400).json({ error: `motivo inválido — válidos: ${MOTIVOS_PRECIO.join(', ')}` });
  }
  const r = await actualizarPrecio(id, {
    precio: Math.round(p * 100) / 100,
    motivo,
    usuarioEmail: req.usuario.email,
    confirmarBajoCosto: confirmar_bajo_costo === true,
  });
  if (r.noEncontrado) return res.status(404).json({ error: 'producto no encontrado' });
  if (r.requiereConfirmacion) {
    return res.status(409).json({
      error: `precio por debajo del costo vigente (${r.requiereConfirmacion.costo_unitario}) — confirmar para continuar`,
      requiere_confirmacion: true,
      costo_unitario: r.requiereConfirmacion.costo_unitario,
    });
  }
  res.json(r.data);
}
