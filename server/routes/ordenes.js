import { Router } from 'express';
import { requireAuth, requireRole } from '../auth-middleware.js';
import { aprobar, create, createBatch, detail, list, rechazar } from '../controllers/ordenes.controller.js';

const router = Router();
router.use(requireAuth);

router.get('/', list);
router.post('/', create);
router.post('/batch', createBatch);
router.get('/:orden_id', detail);
// Aprobar/rechazar exige rol APROBADOR+ (matriz SPEC-24) — SERVICIO
// crea órdenes pero no las resuelve.
const APROBADORES = ['APROBADOR', 'GERENTE', 'ADMIN'];
router.post('/:orden_id/aprobar', requireRole(...APROBADORES), aprobar);
router.post('/:orden_id/rechazar', requireRole(...APROBADORES), rechazar);

export default router;
