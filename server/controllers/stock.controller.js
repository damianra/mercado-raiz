import { MOTIVOS_AJUSTE, ajustarStock } from '../models/stock.model.js';
import { capString } from '../security.js';

const badRequest = (res, msg) => res.status(400).json({ error: msg });

// SPEC-30 (T30.2): ajuste manual — merma/rotura (delta) o conteo
// físico de góndola/depósito (cantidad_nueva absoluta). Exactamente
// uno de los dos modos; el motivo es obligatorio y estructurado.
export async function ajustar(req, res) {
  const { producto_id, motivo, cantidad_nueva, delta, referencia } = req.body ?? {};
  const productoId = Number(producto_id);
  if (!Number.isInteger(productoId) || productoId < 1) {
    return badRequest(res, 'producto_id debe ser un entero positivo');
  }
  if (!MOTIVOS_AJUSTE.includes(motivo)) {
    return badRequest(res, `motivo inválido — válidos: ${MOTIVOS_AJUSTE.join(', ')}`);
  }

  const cn = cantidad_nueva === undefined ? undefined : Number(cantidad_nueva);
  const d = delta === undefined ? undefined : Number(delta);
  if (cn !== undefined && (!Number.isInteger(cn) || cn < 0)) {
    return badRequest(res, 'cantidad_nueva debe ser un entero ≥ 0');
  }
  if (d !== undefined && (!Number.isInteger(d) || d === 0)) {
    return badRequest(res, 'delta debe ser un entero distinto de 0');
  }
  if ((cn === undefined) === (d === undefined)) {
    return badRequest(res, 'enviar exactamente uno de cantidad_nueva (conteo) o delta (merma/rotura)');
  }

  const r = await ajustarStock({
    productoId,
    motivo,
    cantidadNueva: cn,
    delta: d,
    referencia: referencia ? capString(referencia, 120) : undefined,
    usuario: req.usuario.email,
  });
  if (r.status === 201) return res.status(201).json({ success: true, data: r.data });
  return res.status(r.status).json({ error: r.error });
}
