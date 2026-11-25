import { Router } from 'express';
import { requireAuth, bloquearBuyer } from '../auth-middleware.js';
import {
  capital,
  competitividad,
  demanda,
  metricas,
  pricing,
  ventasDiarias,
} from '../controllers/estadisticas.controller.js';

const router = Router();
// Auth sola (sin rol): la consume el front (dashboard) y el agente
// con su cuenta SERVICIO.
router.use(requireAuth, bloquearBuyer);

router.get('/demanda', demanda);
router.get('/metricas', metricas);
// SPEC-32 (T32.3): insumos de la vista gráfica de Métricas.
router.get('/competitividad', competitividad);
router.get('/ventas-diarias', ventasDiarias);
router.get('/capital', capital);
router.get('/pricing', pricing);

export default router;
