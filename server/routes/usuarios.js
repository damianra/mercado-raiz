import { Router } from 'express';
import { requireAuth, requireRole } from '../auth-middleware.js';
import { create, list, patch, remove } from '../controllers/usuarios.controller.js';

const router = Router();
router.use(requireAuth, requireRole('ADMIN'));

router.get('/', list);
router.post('/', create);
router.patch('/:id', patch);
router.delete('/:id', remove);

export default router;
