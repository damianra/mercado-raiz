import { Router } from 'express';
import { bloquearBuyer, requireAuth, requireRole } from '../auth-middleware.js';
import {
  create,
  detail,
  list,
  patch,
  remove,
} from '../controllers/proveedores.controller.js';

const router = Router();
router.use(requireAuth, bloquearBuyer, requireRole('ADMIN'));

router.get('/', list);
router.get('/:id', detail);
router.post('/', create);
router.patch('/:id', patch);
router.delete('/:id', remove);

export default router;
