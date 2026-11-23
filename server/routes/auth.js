import { Router } from 'express';
import { rateLimit } from '../security.js';
import { requireAuth } from '../auth-middleware.js';
import {
  cambiarPasswordController,
  login,
  logout,
  me,
  refresh,
} from '../controllers/auth.controller.js';

const router = Router();

// Rate limit propio del login (SPEC-23): más duro que el global —
// AUTH_RATE_LIMIT regula intentos/min por IP (brute force). Default
// 10/min; CI/e2e comparten IP → configurable por .env.
const authLimiter = rateLimit({
  windowMs: 60_000,
  max: Number(process.env.AUTH_RATE_LIMIT ?? 10),
});

// Públicos: login y refresh (la cookie ES la credencial).
router.post('/login', authLimiter, login);
router.post('/refresh', refresh);
router.post('/logout', logout);

// Autenticados: leer sesión y cambiar password.
router.get('/me', requireAuth, me);
router.post('/cambiar-password', requireAuth, cambiarPasswordController);

export default router;
