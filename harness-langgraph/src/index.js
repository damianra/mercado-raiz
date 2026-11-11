/**
 * Entrypoint del agente — lo ejecuta `npm run agente`.
 *
 * Secuencia: carga config (.env) → compila el grafo → levanta el
 * servidor Express del harness (:4110) → dispara la corrida. El
 * servidor se levanta primero porque es lo que mantiene vivo el
 * proceso y recibe los POST /resume mientras el grafo está
 * pausado en un interrupt().
 */
import { orchestrator } from './harness/orchestrator.js';
import { iniciarServidor } from './harness/server.js';
import { seccion, log } from './utils/logger.js';
import { config } from './config/env.js';

seccion('MERCADO RAÍZ — Agente de reposición (LangGraph + Harness)');
log(`Backend: ${config.backendUrl} | LLM: ${config.ollamaModel} @ ${config.ollamaBaseUrl}`);
log(`Umbral de aprobación: $${config.umbralAprobacion}`);

await orchestrator.inicializar();
iniciarServidor();

await orchestrator.iniciar().catch((err) => {
  log(`❌ la corrida falló: ${err.message}`);
  process.exitCode = 1;
});
