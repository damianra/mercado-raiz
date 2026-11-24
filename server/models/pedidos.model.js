// SPEC-29 (T29.3, R29.7/R29.7b): solicitud de pedido del BUYER
// desde /alertas.
//
// STUB DELIBERADO: `solicitarPedido` valida la solicitud contra
// los precios reales del catálogo y la LOGUEA — NO crea la orden
// de compra todavía. La integración real es: este mismo método
// llama a `ordenes.model.createOrden({ productoId, cantidad,
// proveedorId, requiereAprobacion: true })` y la OC nace
// PENDIENTE_APROBACION con el snapshot del costo elegido. El
// endpoint y el contrato del payload ya quedan fijos acá.
import { openDb } from '../db.js';
import { estadisticaDemanda } from './estadisticas.model.js';

// Misma math del agente (calcular-cantidad, SPEC-26 R26.8):
// objetivo = demanda×(lead + 7d de buffer) + z·σ·√lead, piso
// 2×stock_minimo. Va POR proveedor dentro de la sugerencia — el
// modal la muestra para la opción elegida sin recomputar nada.
const DIAS_COBERTURA = 7;
const Z_SEGURIDAD = 1.65;

export function cantidadSugerida({ demanda = 0, desvio = 0, stock = 0, minimo = 0, lead = 1 }) {
  const seguridad = Z_SEGURIDAD * desvio * Math.sqrt(Math.max(lead, 0));
  const objetivo = Math.ceil(demanda * (lead + DIAS_COBERTURA) + seguridad);
  return Math.max(objetivo - stock, minimo * 2 - stock, 1);
}

// R29.7 — hoja de compra del modal: producto + precios activos
// por proveedor + cantidad sugerida por cada uno (depende del
// lead elegido). Vive acá y no en /api/productos/:id porque el
// BUYER no tiene acceso al catálogo (lockdown R29.1).
export async function sugerenciaCompra(productoId) {
  const db = await openDb();
  const producto = await db.get(
    `SELECT id, sku, nombre, stock_actual, stock_minimo
     FROM productos WHERE id = ?`,
    [productoId],
  );
  if (!producto) return { status: 404, error: 'producto no encontrado' };

  const precios = await db.all(
    `SELECT pp.proveedor_id, pr.nombre AS proveedor, pp.costo_unitario,
            COALESCE(pp.lead_dias,
              (pr.tiempo_entrega_min_dias + pr.tiempo_entrega_max_dias) / 2.0,
              pr.tiempo_entrega_dias)::double precision AS lead_efectivo,
            pp.es_principal
     FROM producto_proveedor pp
     JOIN proveedores pr ON pr.id = pp.proveedor_id
     WHERE pp.producto_id = ? AND pp.activo = 1 AND pr.activo = 1
     ORDER BY pp.costo_unitario ASC, pp.id`,
    [productoId],
  );

  const stats = await estadisticaDemanda(productoId, 90);
  const demanda = stats.demanda_diaria ?? 0;
  const desvio = stats.desvio_demanda ?? 0;

  return {
    producto,
    demanda_diaria: demanda,
    desvio_demanda: desvio,
    precios: precios.map((p) => ({
      ...p,
      cantidad_sugerida: cantidadSugerida({
        demanda,
        desvio,
        stock: producto.stock_actual,
        minimo: producto.stock_minimo,
        lead: p.lead_efectivo,
      }),
    })),
  };
}

// R29.7b — POST /api/pedidos. Valida contra precios reales y
// loguea; el 202 significa "solicitud aceptada", no "OC creada".
export async function solicitarPedido({ productoId, proveedorId, cantidad, alertaId, usuario }) {
  const db = await openDb();
  const fila = await db.get(
    `SELECT p.sku, p.nombre AS producto, pr.nombre AS proveedor, pp.costo_unitario
     FROM producto_proveedor pp
     JOIN productos p ON p.id = pp.producto_id
     JOIN proveedores pr ON pr.id = pp.proveedor_id
     WHERE pp.producto_id = ? AND pp.proveedor_id = ?
       AND pp.activo = 1 AND pr.activo = 1`,
    [productoId, proveedorId],
  );
  if (!fila) {
    return { status: 400, error: 'el proveedor no tiene precio activo para ese producto' };
  }
  if (alertaId != null) {
    const al = await db.get('SELECT id FROM alertas WHERE id = ?', [alertaId]);
    if (!al) return { status: 400, error: 'alerta no encontrada' };
  }

  const resumen = {
    producto_id: productoId,
    sku: fila.sku,
    producto: fila.producto,
    proveedor_id: proveedorId,
    proveedor: fila.proveedor,
    cantidad,
    costo_unitario: Number(fila.costo_unitario),
    monto_estimado: Number((cantidad * fila.costo_unitario).toFixed(2)),
    alerta_id: alertaId ?? null,
    solicitado_por: usuario?.email ?? null,
  };
  // INTEGRACIÓN FUTURA: createOrden(...) → estado PENDIENTE_APROBACION
  // + marcar la alerta asociada como atendida. Antes de cablearla:
  // (a) validar que alerta_id corresponde a producto_id y sigue
  //     no leída — hoy solo se verifica que existe;
  // (b) idempotencia: unicidad por alerta_id para no duplicar la
  //     OC si el buyer re-pide tras un PATCH leída fallido;
  // (c) cota superior de `cantidad` (hoy solo se exige entero ≥1).
  console.log(
    `[PEDIDO] ${resumen.solicitado_por} solicita ${cantidad}u de ` +
      `${fila.sku} (${fila.producto}) a ${fila.proveedor} @ $${fila.costo_unitario}` +
      ` ≈ $${resumen.monto_estimado} — alerta ${alertaId ?? '—'}`,
  );
  return { status: 202, data: resumen };
}
