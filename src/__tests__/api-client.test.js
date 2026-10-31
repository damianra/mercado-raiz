// Tests del cliente src/lib/api.js: mapeo de estados backend → badges
// de la UI y manejo centralizado de errores (ApiError). fetch se
// stubea — no se levanta ningún server.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  USUARIO_DEMO,
  aprobarOrden,
  getDashboardStats,
  getOrdenes,
  mapOrden,
  rechazarOrden,
} from '../lib/api.js';

const baseOrden = {
  id: 2,
  orden_id: 'OC-002',
  cantidad: 40,
  precio_unitario: 3.5,
  monto_total: 140,
  estado: 'PENDIENTE_APROBACION',
  requiere_aprobacion: true,
  analisis_ia: 'análisis',
  fecha_creacion: '2026-10-31T08:23:00',
  producto: { sku: 'HUE003', nombre: 'Huevos x12', stock_actual: 8, stock_minimo: 25 },
  proveedor: { nombre: 'Granja El Sol', tiempo_entrega_dias: 2 },
};

describe('mapOrden', () => {
  it('mapea la shape del backend a la que renderiza la UI', () => {
    const o = mapOrden(baseOrden);
    expect(o).toMatchObject({
      id: 'OC-002',
      producto: 'Huevos x12',
      sku: 'HUE003',
      proveedor: 'Granja El Sol',
      cantidad: 40,
      monto: 140,
      estado: 'PENDIENTE_APROBACION',
      stockActual: 8,
      stockMinimo: 25,
      entregaDias: 2,
      urgente: false,
    });
  });

  it('distingue APROBADO_AUTO (sin aprobación humana) de APROBADO', () => {
    const auto = mapOrden({ ...baseOrden, estado: 'APROBADA', requiere_aprobacion: false });
    expect(auto.estado).toBe('APROBADO_AUTO');
    const manual = mapOrden({ ...baseOrden, estado: 'APROBADA', requiere_aprobacion: true });
    expect(manual.estado).toBe('APROBADO');
    expect(mapOrden({ ...baseOrden, estado: 'RECHAZADA' }).estado).toBe('RECHAZADO');
    expect(mapOrden({ ...baseOrden, estado: 'ENVIADA' }).estado).toBe('ENVIADA');
    expect(mapOrden({ ...baseOrden, estado: 'RECIBIDA' }).estado).toBe('RECIBIDA');
  });

  it('cae en PENDIENTE_APROBACION ante un estado desconocido', () => {
    expect(mapOrden({ ...baseOrden, estado: 'QUE???' }).estado).toBe('PENDIENTE_APROBACION');
  });

  it('marca urgente solo a pendientes con stock 0', () => {
    const critica = mapOrden({
      ...baseOrden,
      producto: { ...baseOrden.producto, stock_actual: 0 },
    });
    expect(critica.urgente).toBe(true);
    const aprobadaSinStock = mapOrden({
      ...baseOrden,
      estado: 'APROBADA',
      producto: { ...baseOrden.producto, stock_actual: 0 },
    });
    expect(aprobadaSinStock.urgente).toBe(false);
  });

  it('tolera producto/proveedor faltantes sin romper', () => {
    const o = mapOrden({ ...baseOrden, producto: null, proveedor: null, analisis_ia: null });
    expect(o.producto).toBe('—');
    expect(o.proveedor).toBe('—');
    expect(o.analisisIA).toBe('Sin análisis disponible.');
    expect(o.urgente).toBe(true); // stock_actual cae a 0 → pendiente sin stock es urgente
  });
});

describe('apiFetch (vía funciones del cliente)', () => {
  const jsonResponse = (status, body) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  afterEach(() => vi.unstubAllGlobals());

  it('getOrdenes parsea la respuesta OK', async () => {
    const payload = { data: [baseOrden], pagination: { total: 1 } };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, payload));
    vi.stubGlobal('fetch', fetchMock);
    expect(await getOrdenes()).toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/ordenes?limit=100&sort=fecha_creacion&order=DESC',
      expect.objectContaining({ headers: { 'Content-Type': 'application/json' } }),
    );
  });

  it('lanza ApiError con status y mensaje del servidor en respuestas no-OK', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(409, { error: 'la orden no está pendiente' })),
    );
    const err = await aprobarOrden('OC-002').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.message).toBe('la orden no está pendiente');
  });

  it('reporta status cuando el body no es JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })));
    const err = await getDashboardStats().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(500);
    expect(err.message).toBe('Error 500 del servidor');
  });

  it('convierte un fallo de red en ApiError legible', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const err = await getOrdenes().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    expect(err.message).toBe('No se pudo conectar con el servidor');
  });

  it('aprobar/rechazar envían POST con el usuario demo', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { success: true }));
    vi.stubGlobal('fetch', fetchMock);

    await aprobarOrden('OC-002');
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/ordenes/OC-002/aprobar',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ aprobado_por: USUARIO_DEMO }),
      }),
    );

    await rechazarOrden('OC-002', 'sin stock necesario');
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/ordenes/OC-002/rechazar',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ rechazado_por: USUARIO_DEMO, motivo: 'sin stock necesario' }),
      }),
    );
  });
});
