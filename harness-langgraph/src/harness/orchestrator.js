/**
 * Orquestador del grafo. Expone cuatro operaciones:
 *
 *  - inicializar(): compila el grafo (langgraph/graph.js) y, si hay
 *    un thread_id guardado en .last-thread con una pausa pendiente
 *    en checkpoints.sqlite, la recupera como corrida activa.
 *  - iniciar(): dispara una corrida nueva (POST /run o index.js).
 *  - ejecutar(threadId, input): corre el grafo en modo stream,
 *    deja que el monitor imprima cada nodo, y al terminar detecta
 *    si quedó pausado (interrupt) o finalizó.
 *  - reanudar(payload): llamada por POST /resume — retoma la
 *    corrida con Command({resume}); si llega mientras corre, la
 *    encola y se procesa al volver a pausar.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from '@langchain/langgraph';
import { construirGrafo } from '../langgraph/graph.js';
import { observarStream } from './monitor.js';
import { metrics } from './metrics.js';
import { costTracker } from './cost-tracker.js';
import { log, seccion } from '../utils/logger.js';

const here = dirname(fileURLToPath(import.meta.url));
// El checkpoint del grafo está en SQLite — sobrevive a reinicios
// del proceso. Guardamos el último thread_id para que POST /resume
// siga funcionando aunque el harness se haya caído y vuelto.
// .last-thread es estado de runtime local — está en .gitignore
// (SPEC-15): cada corrida lo reescribe y no debe commitearse.
const ARCHIVO_THREAD = join(here, '../../.last-thread');

export const orchestrator = {
  grafo: null,
  /** Estado de la corrida actual (para GET /status). */
  corrida: { threadId: null, fase: 'idle', detalle: null },

  async inicializar() {
    this.grafo = await construirGrafo();
    if (existsSync(ARCHIVO_THREAD)) {
      const ultimo = readFileSync(ARCHIVO_THREAD, 'utf8').trim();
      if (ultimo && await this.estaPausado(ultimo)) {
        this.corrida = { threadId: ultimo, fase: 'pausado', detalle: null };
        log(`recuperada corrida pausada de una vida anterior: ${ultimo}`);
      }
    }
  },

  /** ¿La corrida quedó pausada en un interrupt()? */
  async estaPausado(threadId) {
    const estado = await this.grafo.getState({ configurable: { thread_id: threadId } });
    return estado.next.length > 0;
  },

  /**
   * Ejecuta el grafo (arranque o reanudación — mismo código:
   * la diferencia es solo el `input` que recibe stream()).
   */
  async ejecutar(threadId, input) {
    const config = { configurable: { thread_id: threadId } };
    const stream = await this.grafo.stream(input, { ...config, streamMode: 'updates' });
    await observarStream(stream);

    if (await this.estaPausado(threadId)) {
      const estado = await this.grafo.getState(config);
      metrics.sincronizarEstadoGrafo(estado.values);
      this.corrida = { threadId, fase: 'pausado', detalle: estado.values.ordenesPendientes };
      seccion('⏸  AGENTE PAUSADO — esperando decisión humana');
      log(`Órdenes pendientes: ${estado.values.ordenesPendientes.join(', ')}`);
      log('Pasos: aprobar/rechazar en http://localhost:5173');
      log('       y luego POST :4110/resume (solo corridas pausadas viejas)');

      // Si llegó otra decisión humana MIENTRAS procesábamos, quedó
      // encolada: reanudar en cadena hasta vaciar la cola.
      if (this._resumePendiente) {
        const encolado = this._resumePendiente;
        this._resumePendiente = null;
        log('hay una reanudación encolada — procesándola en cadena');
        this.corrida.fase = 'corriendo';
        return this.ejecutar(threadId, new Command({ resume: encolado }));
      }
      return 'pausado';
    }

    const estadoFinal = await this.grafo.getState(config);
    metrics.sincronizarEstadoGrafo(estadoFinal.values);
    this.corrida = { threadId, fase: 'terminado', detalle: null };
    return 'terminado';
  },

  /** Dispara una corrida nueva. */
  async iniciar() {
    const threadId = `run-${Date.now()}`;
    writeFileSync(ARCHIVO_THREAD, threadId);
    this.corrida = { threadId, fase: 'corriendo', detalle: null };
    metrics.iniciarCorrida();
    costTracker.reset();
    seccion(`🚀 CORRIDA ${threadId}`);
    try {
      const resultado = await this.ejecutar(threadId, {});
      if (resultado === 'terminado') this.resumenFinal();
      return resultado;
    } catch (err) {
      this.corrida.fase = 'error';
      throw err;
    }
  },

  /**
   * Reanuda la corrida pausada — lo llama POST /resume (compat:
   * solo queda para checkpoints pausados de antes de SPEC-12).
   * Si llega mientras el grafo está corriendo (el humano aprobó
   * varias órdenes de golpe), se encola: al volver a pausar se
   * procesa sola — ninguna señal se pierde.
   */
  async reanudar(payload) {
    if (this.corrida.fase === 'corriendo') {
      this._resumePendiente = payload ?? { ok: true };
      log('reanudación encolada (corrida en curso)');
      return 'encolado';
    }
    // La verdad la tiene el checkpoint, no la variable en memoria:
    // si el proceso se reinició, fase dice 'idle' pero el grafo
    // puede seguir pausado en disco esperando al humano.
    const threadId = this.corrida.threadId ?? payload?.thread_id;
    if (!threadId || !(await this.estaPausado(threadId))) {
      const err = new Error(`no hay corrida pausada (fase actual: ${this.corrida.fase})`);
      err.status = 409;
      throw err;
    }
    this.corrida = { ...this.corrida, threadId, fase: 'corriendo' };
    seccion(`▶ REANUDANDO ${threadId}`);
    const resultado = await this.ejecutar(threadId, new Command({ resume: payload ?? { ok: true } }));
    if (resultado === 'terminado') this.resumenFinal();
    return resultado;
  },

  resumenFinal() {
    metrics.terminarCorrida();
    seccion('✅ CORRIDA TERMINADA');
    log('Métricas:', JSON.stringify(metrics.resumen(), null, 2));
    log('Costos LLM:', JSON.stringify(costTracker.resumen(), null, 2));
    log('El servidor del harness sigue en :4110 — Ctrl+C para salir.');
  },
};
