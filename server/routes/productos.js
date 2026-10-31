import { Router } from 'express';
import { list } from '../controllers/productos.controller.js';

const router = Router();
router.get('/', list);

export default router;
