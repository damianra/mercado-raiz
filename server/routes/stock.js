import { Router } from 'express';
import { requireAuth, bloquearBuyer, requireRole } from '../auth-middleware.js';
import { ajustar } from '../controllers/stock.controller.js';

const router = Router();
router.use(requireAuth, bloquearBuyer);

// SPEC-30 (T30.2): mermas y conteos físicos son operación humana del
// local — GERENTE+ADMIN (el APROBADOR firma compras, no inventario).
router.post('/ajuste', requireRole('GERENTE', 'ADMIN'), ajustar);

export default router;
