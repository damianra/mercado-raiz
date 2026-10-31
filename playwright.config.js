import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: { baseURL: 'http://localhost:5173' },
  webServer: [
    {
      // API con DB recién seedeada — el flujo e2e consume datos reales
      // del seed (órdenes mutables: aprobar/rechazar requieren estado
      // PENDIENTE_APROBACION, garantizado solo con seed fresco).
      command: 'npm run seed && npm run api',
      url: 'http://localhost:4000/api/health',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: 'npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
