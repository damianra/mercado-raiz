import {
  evaluarAlertas,
  leerTodas,
  listarAlertas,
  marcarLeida,
} from '../models/alertas.model.js';

const TIPOS = new Set(['QUIEBRE', 'RIESGO_LEAD', 'DEAD_STOCK', 'ORDEN_PENDIENTE']);

// SPEC-29 (R29.4): GET /api/alertas?leida=0|1&tipo= — la evaluación
// lazy corre dentro del model si pasaron >60min.
export async function listar(req, res) {
  const filtros = {};
  if (req.query.leida !== undefined) {
    if (!['0', '1'].includes(req.query.leida)) {
      return res.status(400).json({ error: 'leida debe ser 0 o 1' });
    }
    filtros.leida = Number(req.query.leida);
  }
  if (req.query.tipo !== undefined) {
    if (!TIPOS.has(req.query.tipo)) {
      return res.status(400).json({ error: `tipo inválido — válidos: ${[...TIPOS].join(', ')}` });
    }
    filtros.tipo = req.query.tipo;
  }
  res.json(await listarAlertas(filtros));
}

export async function evaluar(req, res) {
  res.json(await evaluarAlertas());
}

export async function leida(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'id debe ser un entero positivo' });
  }
  if (!(await marcarLeida(id))) {
    return res.status(404).json({ error: 'alerta no encontrada' });
  }
  res.json({ ok: true });
}

export async function todas(req, res) {
  res.json({ marcadas: await leerTodas() });
}
