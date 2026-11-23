import { Router } from 'express';
import { requireAuth } from '../auth-middleware.js';
import { get, list } from '../controllers/productos.controller.js';

const router = Router();
router.use(requireAuth);

router.get('/', list);
router.get('/:id', get);

export default router;
