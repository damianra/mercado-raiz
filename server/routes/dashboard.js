import { Router } from 'express';
import { requireAuth, bloquearBuyer } from '../auth-middleware.js';
import { stats } from '../controllers/dashboard.controller.js';

const router = Router();
router.use(requireAuth, bloquearBuyer);

router.get('/stats', stats);

export default router;
