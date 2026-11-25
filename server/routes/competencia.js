import { Router } from 'express';
import { requireAuth, bloquearBuyer, requireRole } from '../auth-middleware.js';
import { sync } from '../controllers/competencia.controller.js';

const router = Router();
router.use(requireAuth, bloquearBuyer);

// SPEC-32 (T32.7): re-import del snapshot de competencia desde
// el DWH (o el CSV simulado). Operación de integración — la
// dispara el admin o la cuenta de servicio (el harness la
// llamaría en un schedule futuro, fuera de scope hoy).
router.post('/sync', requireRole('ADMIN', 'SERVICIO'), sync);

export default router;
