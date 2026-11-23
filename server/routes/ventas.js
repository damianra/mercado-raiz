import { Router } from 'express';
import { requireAuth, bloquearBuyer } from '../auth-middleware.js';
import { list } from '../controllers/ventas.controller.js';

const router = Router();
router.use(requireAuth, bloquearBuyer);

router.get('/', list);

export default router;
