import { Router } from 'express';
import { requireAuth, bloquearBuyer } from '../auth-middleware.js';
import { get, list } from '../controllers/productos.controller.js';

const router = Router();
router.use(requireAuth, bloquearBuyer);

router.get('/', list);
router.get('/:id', get);

export default router;
