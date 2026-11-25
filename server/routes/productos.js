import { Router } from 'express';
import { requireAuth, requireRole, bloquearBuyer } from '../auth-middleware.js';
import {
  get,
  getCompetencia,
  getHistorial,
  list,
  patchPrecio,
} from '../controllers/productos.controller.js';

const router = Router();
router.use(requireAuth, bloquearBuyer);

router.get('/', list);
// /:id/competencia antes de /:id — Express matchea por segmentos
// así que no chocan, pero el orden documenta la intención.
router.get('/:id/competencia', getCompetencia);
// SPEC-32 (T32.6): sierra de stock — serie diaria de posición para
// el drill-in chart; lectura, todos los roles operativos.
router.get('/:id/historial', getHistorial);
router.get('/:id', get);
// SPEC-32 (T32.2): único write path de precio_venta — decisión de
// negocio, la toma quien opera el catálogo.
router.patch('/:id/precio', requireRole('GERENTE', 'ADMIN'), patchPrecio);

export default router;
