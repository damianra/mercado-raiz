import { Router } from 'express';
import { requireAuth, requireRole } from '../auth-middleware.js';
import {
  evaluar,
  leida,
  listar,
  todas,
} from '../controllers/alertas.controller.js';

const router = Router();

// SPEC-29 (R29.1/R29.4): el dashboard de alertas es exclusivo del
// BUYER; ADMIN entra por auditoría. SPEC-30 (T30.6): el GET se
// abre a GERENTE/APROBADOR — la campanita del Topbar consume las
// ALTA no leídas para que les lleguen sin entrar a mirar. Las
// escrituras siguen siendo de la cola de trabajo del comprador.
router.get('/', requireAuth, requireRole('BUYER', 'ADMIN', 'GERENTE', 'APROBADOR'), listar);
router.post('/evaluar', requireAuth, requireRole('BUYER', 'ADMIN'), evaluar);
// `/leer-todas` antes de `/:id/…` — si no, "leer-todas" matchea :id.
router.patch('/leer-todas', requireAuth, requireRole('BUYER', 'ADMIN'), todas);
router.patch('/:id/leida', requireAuth, requireRole('BUYER', 'ADMIN'), leida);

export default router;
