import { solicitarPedido, sugerenciaCompra } from '../models/pedidos.model.js';

const badRequest = (res, msg) => res.status(400).json({ error: msg });

// SPEC-29 (R29.7): GET /api/pedidos/sugerencia?producto_id= —
// hoja de compra del modal del BUYER (precios por proveedor +
// demanda + cantidad sugerida por lead).
export async function sugerencia(req, res) {
  const id = Number(req.query.producto_id);
  if (!Number.isInteger(id) || id < 1) {
    return badRequest(res, 'producto_id debe ser un entero positivo');
  }
  const r = await sugerenciaCompra(id);
  if (r.error) return res.status(r.status).json({ error: r.error });
  res.json(r);
}

// SPEC-29 (R29.7b): POST /api/pedidos — stub: valida y loguea,
// no persiste la OC (camino marcado en el model).
export async function solicitar(req, res) {
  const { producto_id, proveedor_id, cantidad, alerta_id } = req.body ?? {};
  if (!Number.isInteger(producto_id) || producto_id < 1) {
    return badRequest(res, 'producto_id es requerido y debe ser un entero positivo');
  }
  if (!Number.isInteger(proveedor_id) || proveedor_id < 1) {
    return badRequest(res, 'proveedor_id es requerido y debe ser un entero positivo');
  }
  if (!Number.isInteger(cantidad) || cantidad < 1) {
    return badRequest(res, 'cantidad es requerida y debe ser un entero ≥ 1');
  }
  if (alerta_id !== undefined && (!Number.isInteger(alerta_id) || alerta_id < 1)) {
    return badRequest(res, 'alerta_id debe ser un entero positivo');
  }
  const r = await solicitarPedido({
    productoId: producto_id,
    proveedorId: proveedor_id,
    cantidad,
    alertaId: alerta_id ?? null,
    usuario: req.usuario,
  });
  if (r.error) return res.status(r.status).json({ error: r.error });
  res.status(202).json({ ok: true, data: r.data });
}
