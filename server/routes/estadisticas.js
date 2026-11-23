import { Router } from 'express';
import { requireAuth, bloquearBuyer } from '../auth-middleware.js';
import { demanda, metricas } from '../controllers/estadisticas.controller.js';

const router = Router();
// Auth sola (sin rol): la consume el front (dashboard) y el agente
// con su cuenta SERVICIO.
router.use(requireAuth, bloquearBuyer);

router.get('/demanda', demanda);
router.get('/metricas', metricas);

export default router;
