import { Router } from 'express';
import { aprobar, create, detail, list, rechazar } from '../controllers/ordenes.controller.js';

const router = Router();
router.get('/', list);
router.post('/', create);
router.get('/:orden_id', detail);
router.post('/:orden_id/aprobar', aprobar);
router.post('/:orden_id/rechazar', rechazar);

export default router;
