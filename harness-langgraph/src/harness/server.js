/**
 * Servidor Express del agente, en HARNESS_PORT (default 4110). Es
 * la única vía de entrada externa al proceso:
 *
 *   GET  /status   → devuelve orchestrator.corrida (fase actual)
 *   GET  /metrics  → devuelve metrics + costTracker de la corrida
 *   POST /resume   → llama orchestrator.reanudar(body); lo dispara
 *                    el backend tras cada aprobar/rechazar
 *   POST /run      → llama orchestrator.iniciar() para una corrida
 *                    nueva (409 si ya hay una en curso)
 *
 * index.js lo levanta antes de correr el grafo: el servidor es lo
 * que mantiene vivo el proceso mientras el grafo está pausado.
 */
import express from 'express';
import { config } from '../config/env.js';
import { orchestrator } from './orchestrator.js';
import { metrics } from './metrics.js';
import { costTracker } from './cost-tracker.js';
import { log } from '../utils/logger.js';

export function iniciarServidor() {
  const app = express();
  app.use(express.json());

  app.get('/status', (req, res) => res.json(orchestrator.corrida));

  // Contrato SPEC-10 §3: resumen_ejecucion (negocio) + rendimiento_llm
  // (null si el LLM nunca se invocó — el frontend solo muestra el
  // mensaje_sistema) + errores_no_criticos.
  app.get('/metrics', (req, res) => {
    const m = metrics.resumen();
    res.json({
      estado_corrida: orchestrator.corrida.fase,
      resumen_ejecucion: {
        total_productos_evaluados: m.total_productos_evaluados,
        ordenes_creadas: m.ordenes_creadas,
        ordenes_pausadas_hith: m.ordenes_pausadas_hith,
        conteo_fallbacks: m.conteo_fallbacks,
        tasa_fallback: m.tasa_fallback,
        mensaje_sistema: metrics.mensajeSistema(orchestrator.corrida.fase),
      },
      rendimiento_llm: costTracker.resumen(),
      errores_no_criticos: m.errores_no_criticos,
    });
  });

  app.post('/resume', async (req, res) => {
    try {
      const resultado = await orchestrator.reanudar(req.body ?? {});
      res.json({ ok: true, resultado });
    } catch (err) {
      res.status(err.status ?? 500).json({ error: err.message });
    }
  });

  // Disparar una corrida nueva por HTTP también — útil si el
  // proceso quedó vivo sirviendo /resume.
  app.post('/run', async (req, res) => {
    if (orchestrator.corrida.fase === 'corriendo') {
      return res.status(409).json({ error: 'ya hay una corrida en curso' });
    }
    orchestrator.iniciar().catch((err) => log(`corrida falló: ${err.message}`));
    res.status(202).json({ ok: true });
  });

  const server = app.listen(config.harnessPort, () =>
    log(`harness escuchando en http://localhost:${config.harnessPort} (GET /status, POST /resume, POST /run)`),
  );
  // Sin este handler un puerto ocupado (EADDRINUSE) tira el proceso
  // sin mensaje — y el agente queda "pausado" sin nadie que lo despierte.
  server.on('error', (err) => {
    log(`❌ no se pudo abrir el puerto ${config.harnessPort}: ${err.message}`);
    process.exit(1);
  });
}
