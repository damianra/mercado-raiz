import { Router } from 'express';
import { requireAuth, bloquearBuyer } from '../auth-middleware.js';
import { list } from '../controllers/lotes.controller.js';

const router = Router();
router.use(requireAuth, bloquearBuyer);

// SPEC-33 (T33.2): lectura del desglose físico — mismo público
// que quiebres (todo no-BUYER; R33.8). La baja llega en T33.3.
router.get('/', list);

export default router;
