import { Router } from 'express';
import { requireAuth, requireRole } from '../auth-middleware.js';
import { solicitar, sugerencia } from '../controllers/pedidos.controller.js';

const router = Router();
// SPEC-29 (R29.7): la solicitud de pedido es del BUYER; ADMIN por
// auditoría, igual que /api/alertas. El resto del dominio sigue
// cerrado para el buyer.
router.use(requireAuth, requireRole('BUYER', 'ADMIN'));

router.get('/sugerencia', sugerencia);
router.post('/', solicitar);

export default router;
