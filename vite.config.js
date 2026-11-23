import { defineConfig, configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // base relativa: los assets resuelven en subrutas (GitHub Pages /<repo>/)
  base: './',
  plugins: [react()],
  // proxy dev → api-skeleton (Express en :4000). Config muerta si el
  // scope no tiene backend: nada consulta /api.
  server: {
    proxy: {
      // VITE_API_PROXY permite apuntar a una API en otro puerto (e2e
      // en CI con puertos propios); default: la API local en :4000.
      '/api': process.env.VITE_API_PROXY ?? 'http://localhost:4000',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.js',
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
});
