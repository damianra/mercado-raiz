import { defineConfig } from '@playwright/test';

// Puertos parametrizables: E2E_PORT (Vite) / E2E_API_PORT (API) —
// en esta máquina :5173 lo puede ocupar otro dev server del usuario
// y reuseExistingServer atacaría la app equivocada.
const E2E_PORT = Number(process.env.E2E_PORT ?? 5173);
const E2E_API_PORT = Number(process.env.E2E_API_PORT ?? 4000);
const env =
  `env PORT=${E2E_API_PORT} API_RATE_LIMIT=5000 AUTH_RATE_LIMIT=5000`;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: { baseURL: `http://localhost:${E2E_PORT}` },
  webServer: [
    {
      // API con DB recién seedeada — el flujo e2e consume datos reales
      // del seed (órdenes mutables: aprobar/rechazar requieren estado
      // PENDIENTE_APROBACION, garantizado solo con seed fresco).
      // Los rate limits van altos: todos los tests comparten IP y
      // cada uno hace login + silent refresh (SPEC-23).
      command: `${env} npm run seed && ${env} npm run api`,
      url: `http://localhost:${E2E_API_PORT}/api/health`,
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: `env VITE_API_PROXY=http://localhost:${E2E_API_PORT} npm run dev -- --port ${E2E_PORT} --strictPort`,
      url: `http://localhost:${E2E_PORT}`,
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
