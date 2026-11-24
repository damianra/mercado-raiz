import { Router } from 'express';
import { requireAuth, bloquearBuyer } from '../auth-middleware.js';
import { create, list } from '../controllers/ventas.controller.js';

const router = Router();
router.use(requireAuth, bloquearBuyer);

router.get('/', list);
// SPEC-30 (T30.2): punto de integración POS — cualquier rol no-buyer
// registra ventas (SERVICIO lo llama la integración), como POST /ordenes.
router.post('/', create);

export default router;
