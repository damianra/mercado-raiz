#!/usr/bin/env node
/**
 * Smoke SPEC-13 / R13.5: dispara N escrituras reales al backend
 * por encima del límite de 20/min y verifica que ninguna se pierde —
 * api.post espera el Retry-After del 429 y reintenta en la ventana
 * siguiente.
 *
 * Uso:  node scripts/smoke-rate-limit.mjs [nPosts=25] [productoId]
 * Pre:  backend corriendo en BACKEND_URL (default :4000).
 *
 * Crea N órdenes reales (analisis_ia = 'smoke-rate-limit') — borrarlas
 * después: DELETE FROM ordenes_compra WHERE analisis_ia='smoke-rate-limit'.
 */
import { api } from '../src/integrations/backend-client.js';
import { metrics } from '../src/harness/metrics.js';

const N = Number(process.argv[2] ?? 25);
const MARCA = 'smoke-rate-limit';

const { data: productos } = await api.get('/productos?limit=1');
const productoId = Number(process.argv[3] ?? productos[0]?.id);
if (!productoId) {
  console.error('No hay productos en el backend — no se puede fumar.');
  process.exit(1);
}

metrics.iniciarCorrida();
console.log(`→ ${N} POSTs secuenciales a /api/ordenes (límite backend: 20/min)`);
const t0 = Date.now();
let ok = 0;
const errores = [];

for (let i = 1; i <= N; i++) {
  try {
    await api.post('/ordenes', {
      producto_id: productoId,
      cantidad: 1,
      requiere_aprobacion: false,
      analisis_ia: MARCA,
    });
    ok++;
  } catch (err) {
    errores.push(`#${i}: ${err.message}`);
  }
}

const m = metrics.resumen();
console.log(`\n${ok}/${N} órdenes creadas en ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`reintentos 429 absorbidos: ${m.reintentos}`);
if (errores.length) {
  console.log('errores:', errores);
  process.exit(2);
}
console.log(`✔ sin órdenes perdidas — limpiar: DELETE FROM ordenes_compra WHERE analisis_ia='${MARCA}'`);
