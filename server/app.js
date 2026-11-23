import express from 'express';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { requestLogger } from './log.js';
import { rateLimit, securityHeaders } from './security.js';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * App Express base. Convención de auto-mount: cada archivo
 * server/routes/<name>.js que exporte un Router default se monta en
 * /api/<name> — agregar un endpoint es agregar un archivo, no hay
 * nada que registrar.
 */
export async function createApp() {
  // El pool es singleton: si index.js/tests ya hicieron openDb()
  // esto es un no-op memoizado; si no, inicializa schema + seed.
  await openDb();
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use(securityHeaders);
  // El logger va antes del rate limit: los 429 también quedan
  // registrados (útil para ver abuso, no solo tráfico exitoso).
  app.use(requestLogger);
  // Escrituras: 20/min por IP en dev/prod. API_RATE_LIMIT lo sube en
  // CI — los e2e comparten IP y acumulan login/refresh/POSTs.
  app.use(
    '/api',
    rateLimit({ windowMs: 60_000, max: Number(process.env.API_RATE_LIMIT ?? 20) }),
  );

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  const routesDir = join(here, 'routes');
  for (const file of readdirSync(routesDir)) {
    if (!file.endsWith('.js')) continue;
    const name = file.slice(0, -3);
    const { default: router } = await import(`./routes/${name}.js`);
    app.use(`/api/${name}`, router);
  }

  // Frontend build estático (fullstack): dist/ (Vite) u out/ (Next
  // export) en la raíz del proyecto — el primero que exista.
  const staticDir = ['dist', 'out'].map((d) => join(here, '..', d)).find((d) => existsSync(join(d, 'index.html')));
  if (staticDir) {
    app.use(express.static(staticDir));
  }
  const indexHtml = staticDir ? join(staticDir, 'index.html') : null;

  app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));

  // SPA fallback: GETs que no son /api ni archivos estáticos → index.html.
  if (indexHtml) {
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next();
      res.sendFile(indexHtml);
    });
  }

  // eslint-disable-next-line no-unused-vars -- Express reconoce el error handler por aridad
  app.use((err, req, res, next) => {
    console.error(err);
    const status = err.status ?? 500;
    // 500s responden genérico — err.message puede filtrar internals.
    res
      .status(status)
      .json({ error: status < 500 ? err.message : 'error interno' });
  });
  return app;
}
