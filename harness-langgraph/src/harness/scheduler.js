/**
 * Watchdog del agente (SPEC-30, T30.5) — el "automático" corre solo.
 *
 * Dos disparadores sobre orchestrator.iniciar():
 *
 *  - Schedule: setInterval cada AGENTE_INTERVALO_MIN (0 = off).
 *    No dispara con corrida 'corriendo' ni 'pausada' (una pausada
 *    espera decisión humana — no se le pisa el checkpoint).
 *  - Evento: POST /trigger (el backend avisa cuando una venta deja
 *    stock <=0 — un quiebre recién nacido, candidato inmediato).
 *    Cooldown AGENTE_TRIGGER_COOLDOWN_MIN: un cierre de caja puede
 *    reportar varios quiebres seguidos — la corrida reciente ya los
 *    cubrió o los ve la próxima; no vale una corrida por quiebre.
 *
 * `ultimaCorrida` lo sella orchestrator.iniciar() en cada arranque
 * (schedule, trigger o POST /run manual — todos enfrían el trigger).
 */
import { config } from '../config/env.js';
import { orchestrator } from './orchestrator.js';
import { log } from '../utils/logger.js';

export const scheduler = {
  _timer: null,

  iniciar() {
    if (this._timer) return; // doble iniciar no duplica intervals
    const min = config.agenteIntervaloMin;
    if (!min) return log('watchdog del agente desactivado (AGENTE_INTERVALO_MIN=0)');
    this._timer = setInterval(() => this.disparar('schedule'), min * 60_000);
    // El proceso lo sostiene el server Express — el timer no debe
    // ser el que lo mantenga vivo ni el que impida salir limpio.
    this._timer.unref?.();
    log(`watchdog del agente: una corrida cada ${min} min`);
  },

  detener() {
    clearInterval(this._timer);
    this._timer = null;
  },

  /**
   * Dispara una corrida si no hay una en curso/pausada.
   * Devuelve 'disparado' | 'ocupado' (para el caller/log).
   */
  async disparar(origen) {
    const fase = orchestrator.corrida.fase;
    if (fase === 'corriendo' || fase === 'pausado') {
      return 'ocupado';
    }
    log(`corrida disparada por ${origen}`);
    orchestrator.iniciar().catch((err) =>
      log(`corrida (${origen}) falló: ${err.message}`),
    );
    return 'disparado';
  },

  /**
   * POST /trigger — aviso de evento del backend
   * ({motivo, producto_id?, producto_ids?}). Responde el estado
   * para que el emisor pueda loguear: debounced por cooldown,
   * cubierto por corrida en curso/pausada, o disparado.
   */
  async trigger(payload = {}) {
    const fase = orchestrator.corrida.fase;
    if (fase === 'corriendo') return { estado: 'en-curso' };
    if (fase === 'pausado') return { estado: 'pausado' };
    const cooldownMs = config.triggerCooldownMin * 60_000;
    const desdeUltima = Date.now() - (orchestrator.ultimaCorrida ?? 0);
    if (orchestrator.ultimaCorrida && desdeUltima < cooldownMs) {
      return { estado: 'cooldown', reintentar_en_min: Math.ceil((cooldownMs - desdeUltima) / 60_000) };
    }
    const ids = Array.isArray(payload.producto_ids)
      ? payload.producto_ids
      : payload.producto_id != null
        ? [payload.producto_id]
        : [];
    await this.disparar(`trigger:${payload.motivo ?? 'evento'}${ids.length ? ` (productos ${ids.join(',')})` : ''}`);
    return { estado: 'disparado' };
  },
};
