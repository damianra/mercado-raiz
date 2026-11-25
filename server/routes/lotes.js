import { Router } from 'express';
import { requireAuth, bloquearBuyer, requireRole } from '../auth-middleware.js';
import { baja, list } from '../controllers/lotes.controller.js';

const router = Router();
router.use(requireAuth, bloquearBuyer);

// SPEC-33 (T33.2): lectura del desglose físico — mismo público
// que quiebres (todo no-BUYER; R33.8).
router.get('/', list);

// T33.3 (R33.7/R33.8): la baja por vencimiento es merma — comparte
// la matriz del ajuste de stock (GERENTE/ADMIN; el APROBADOR firma
// compras, no inventario).
router.post('/:id/baja', requireRole('GERENTE', 'ADMIN'), baja);

export default router;
