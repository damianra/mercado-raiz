import { Router } from 'express';
import { requireAuth, bloquearBuyer, requireRole } from '../auth-middleware.js';
import {
  aprobar,
  create,
  createBatch,
  detail,
  enviar,
  list,
  recibir,
  rechazar,
} from '../controllers/ordenes.controller.js';

const router = Router();
router.use(requireAuth, bloquearBuyer);

router.get('/', list);
router.post('/', create);
router.post('/batch', createBatch);
router.get('/:orden_id', detail);
// Aprobar/rechazar exige rol APROBADOR+ (matriz SPEC-24) — SERVICIO
// crea órdenes pero no las resuelve.
const APROBADORES = ['APROBADOR', 'GERENTE', 'ADMIN'];
router.post('/:orden_id/aprobar', requireRole(...APROBADORES), aprobar);
router.post('/:orden_id/rechazar', requireRole(...APROBADORES), rechazar);
// SPEC-30 (T30.1): enviar al proveedor y recibir el camión son
// decisiones operativas humanas — misma matriz que aprobar.
router.post('/:orden_id/enviar', requireRole(...APROBADORES), enviar);
router.post('/:orden_id/recibir', requireRole(...APROBADORES), recibir);

export default router;
