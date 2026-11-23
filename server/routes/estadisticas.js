import { Router } from 'express';
import { requireAuth } from '../auth-middleware.js';
import { demanda } from '../controllers/estadisticas.controller.js';

const router = Router();
// Auth sola (sin rol): la consume el front (dashboard) y el agente
// con su cuenta SERVICIO.
router.use(requireAuth);

router.get('/demanda', demanda);

export default router;
