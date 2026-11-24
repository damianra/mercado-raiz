// SPEC-30 (T30.4): pedido del BUYER desde /alertas — la solicitud
// crea la OC real en PENDIENTE_APROBACION (la ve el aprobador en
// su dashboard) y marca la alerta leída en la misma transacción.
// Ex-stub T29.3: el payload y los endpoints no cambiaron.
import { openDb } from '../db.js';
import { crearOrdenEnTx, getOrden } from './ordenes.model.js';
import { estadisticaDemanda } from './estadisticas.model.js';

// Cota de sanidad por pedido manual — el buyer puede tipear
// cualquier cosa; la OC igual pasa por aprobación humana, pero
// esto corta typos/abuse antes de llegar al dashboard.
export const CANTIDAD_MAX_PEDIDO = 10_000;

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

// R29.7b / T30.4 — POST /api/pedidos. Ya no es stub: en UNA
// transacción marca la alerta leída y crea la OC
// PENDIENTE_APROBACION. La alerta es la clave de idempotencia:
// `leida=0` en el WHERE hace que un retry/doble-click/race
// falle con changes=0 → 409, y el índice único parcial
// idx_ordenes_alerta es el respaldo en la tabla.
export async function solicitarPedido({ productoId, proveedorId, cantidad, alertaId, usuario }) {
  const db = await openDb();
  if (cantidad > CANTIDAD_MAX_PEDIDO) {
    return { status: 400, error: `cantidad máxima por pedido: ${CANTIDAD_MAX_PEDIDO}` };
  }
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
    // Pre-check para mensajes precisos; el guard atómico es el
    // UPDATE de la tx (race entre este read y ese write).
    const al = await db.get(
      'SELECT producto_id, leida FROM alertas WHERE id = ?',
      [alertaId],
    );
    if (!al) return { status: 400, error: 'alerta no encontrada' };
    if (al.producto_id !== productoId) {
      return { status: 400, error: 'la alerta no corresponde a ese producto' };
    }
    if (al.leida) {
      return { status: 409, error: 'la alerta ya fue atendida' };
    }
  }

  const resultado = await db
    .tx(async (t) => {
      if (alertaId != null) {
        const r = await t.run(
          'UPDATE alertas SET leida = 1 WHERE id = ? AND producto_id = ? AND leida = 0',
          [alertaId, productoId],
        );
        if (r.changes === 0) return { conflicto: true };
      }
      const id = await crearOrdenEnTx(t, {
        productoId,
        proveedorId,
        cantidad,
        // La OC del buyer SIEMPRE pasa por aprobación — el aprobador
        // decide si la compra se hace (es su rol, no el del buyer).
        requiereAprobacion: true,
        analisisIa:
          `Pedido manual del buyer ${usuario?.email ?? ''}` +
          (alertaId ? ` desde la alerta #${alertaId}.` : '.'),
        alertaId: alertaId ?? null,
      });
      // Si la OC no se pudo crear DESPUÉS de marcar la alerta,
      // devolver el error commitearía leida=1 sin OC — la alerta
      // desaparecería sin pedido y sin poder reintentar. Tirar el
      // error hace rollback de TODO (la alerta queda reintentable).
      if (id == null || id.sinPrecio) {
        const e = new Error(id?.sinPrecio ?? 'producto no encontrado');
        e.status = id == null ? 404 : 400;
        throw e;
      }
      return id;
    })
    .catch((e) => (e.status ? e : Promise.reject(e)));
  if (resultado?.conflicto) {
    return { status: 409, error: 'la alerta ya fue atendida — no se generó otra OC' };
  }
  if (resultado?.status) return { status: resultado.status, error: resultado.message };
  const orden = await getOrden(resultado);
  console.log(
    `[PEDIDO] ${usuario?.email} pidió ${cantidad}u de ${fila.sku} ` +
      `a ${fila.proveedor} → OC ${resultado} PENDIENTE_APROBACION` +
      ` — alerta ${alertaId ?? '—'}`,
  );
  return { status: 201, data: orden };
}
