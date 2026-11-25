import { sincronizarCompetencia } from '../models/competencia.model.js';

// POST /api/competencia/sync — dispara el re-import del snapshot
// desde la fuente configurada (DWH real o CSV simulado). 502 si
// la fuente falla: la respuesta del DWH no es dato propio, es
// upstream caído.
export async function sync(req, res) {
  try {
    res.json(await sincronizarCompetencia());
  } catch (e) {
    res.status(502).json({ error: `Fuente de competencia: ${e.message}` });
  }
}
