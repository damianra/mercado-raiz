import { Router } from 'express';
import { requireAuth, requireRole } from '../auth-middleware.js';
import {
  evaluar,
  leida,
  listar,
  todas,
} from '../controllers/alertas.controller.js';

const router = Router();
// SPEC-29 (R29.1/R29.4): el dashboard de alertas es exclusivo del
// BUYER; ADMIN entra por auditoría. El resto de los roles → 403.
router.use(requireAuth, requireRole('BUYER', 'ADMIN'));

router.get('/', listar);
router.post('/evaluar', evaluar);
// `/leer-todas` antes de `/:id/…` — si no, "leer-todas" matchea :id.
router.patch('/leer-todas', todas);
router.patch('/:id/leida', leida);

export default router;
