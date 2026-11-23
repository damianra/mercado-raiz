import { Router } from 'express';
import { requireAuth } from '../auth-middleware.js';
import { list } from '../controllers/productos.controller.js';

const router = Router();
router.use(requireAuth);

router.get('/', list);

export default router;
