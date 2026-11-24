/**
 * Watchdog del agente (SPEC-30, T30.5): el scheduler dispara
 * corridas por schedule y por POST /trigger — con guard de fase
 * (corriendo/pausada no se pisa) y cooldown del trigger (un cierre
 * de caja no genera una corrida por quiebre). Orchestrator mockeado.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { orchestrator } from '../../src/harness/orchestrator.js';
import { scheduler } from '../../src/harness/scheduler.js';

beforeEach(() => {
  orchestrator.corrida = { threadId: null, fase: 'terminado', detalle: null };
  orchestrator.ultimaCorrida = 0;
  orchestrator.iniciar = vi.fn().mockResolvedValue('terminado');
});

describe('disparar (schedule y trigger comparten el guard)', () => {
  it('fase terminado/idle → dispara una corrida', async () => {
    expect(await scheduler.disparar('schedule')).toBe('disparado');
    expect(orchestrator.iniciar).toHaveBeenCalledOnce();
  });

  it('corrida en curso → no pisa', async () => {
    orchestrator.corrida.fase = 'corriendo';
    expect(await scheduler.disparar('schedule')).toBe('ocupado');
    expect(orchestrator.iniciar).not.toHaveBeenCalled();
  });

  it('corrida pausada → no pisa el checkpoint humano', async () => {
    orchestrator.corrida.fase = 'pausado';
    expect(await scheduler.disparar('schedule')).toBe('ocupado');
    expect(orchestrator.iniciar).not.toHaveBeenCalled();
  });
});

describe('trigger (evento: venta que deja stock <=0)', () => {
  it('sin corrida reciente → dispara', async () => {
    const r = await scheduler.trigger({ motivo: 'stock0', producto_ids: [125] });
    expect(r.estado).toBe('disparado');
    expect(orchestrator.iniciar).toHaveBeenCalledOnce();
  });

  it('corrida en curso → en-curso (el evento ya lo cubre)', async () => {
    orchestrator.corrida.fase = 'corriendo';
    const r = await scheduler.trigger({ motivo: 'stock0', producto_id: 9 });
    expect(r.estado).toBe('en-curso');
    expect(orchestrator.iniciar).not.toHaveBeenCalled();
  });

  it('corrida pausada → pausado (espera la decisión humana)', async () => {
    orchestrator.corrida.fase = 'pausado';
    const r = await scheduler.trigger({ motivo: 'stock0', producto_id: 9 });
    expect(r.estado).toBe('pausado');
    expect(orchestrator.iniciar).not.toHaveBeenCalled();
  });

  it('debouncea dentro del cooldown de la última corrida', async () => {
    // Corrida hace 2 min < cooldown (15 default) → no dispara;
    // el estado devuelve cuándo reintentar.
    orchestrator.ultimaCorrida = Date.now() - 2 * 60_000;
    const r = await scheduler.trigger({ motivo: 'stock0', producto_id: 9 });
    expect(r.estado).toBe('cooldown');
    expect(r.reintentar_en_min).toBeGreaterThan(0);
    expect(orchestrator.iniciar).not.toHaveBeenCalled();
  });

  it('pasado el cooldown vuelve a disparar', async () => {
    orchestrator.ultimaCorrida = Date.now() - 30 * 60_000;
    const r = await scheduler.trigger({ motivo: 'stock0', producto_id: 9 });
    expect(r.estado).toBe('disparado');
    expect(orchestrator.iniciar).toHaveBeenCalledOnce();
  });
});
