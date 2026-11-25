// MERCADO RAÍZ — datos iniciales. db.js los inserta solo si la tabla
// está vacía (seedIfEmpty). IMPORTANTE: todas las filas de una tabla
// deben tener exactamente las mismas claves (el INSERT se arma con las
// claves de la primera fila).
//
// SPEC-22: `productos` es el catálogo interno real — 1.471 artículos
// generados desde `data/articles_sample.csv` por seed-articulos.js
// (determinístico). Reemplaza el seed demo de 11 productos.
//
// Coherencia:
// - estado de producto derivado de stock_actual vs stock_minimo
//   (0 → CRITICO, < minimo → STOCK_BAJO, si no OK)
// - monto_total = cantidad * costo del proveedor
// - OC-001..OC-011 replican el flujo de aprobación sobre artículos
//   reales en CRITICO/STOCK_BAJO (cantidad = 2·min − actual, R5.5);
//   APROBADO_AUTO del front = APROBADA con requiere_aprobacion = 0
//   y aprobado_por = 'auto'.

import { generarArticulos, generarCompetencia, generarPreciosProveedor } from './seed-articulos.js';

const productos = generarArticulos();
// SPEC-27: costo por proveedor (principal del artículo + alternativos
// del mayorista general en ~40% de los casos).
const producto_proveedor = generarPreciosProveedor(productos);

// Artículos bajo stock repartidos en el catálogo (determinístico — el
// orden del CSV es fijo). Las OC demo apuntan a estos.
const bajos = productos.filter((p) => p.estado !== 'OK');
const paso = Math.max(1, Math.floor(bajos.length / 11));
const elegidos = bajos.filter((_, i) => i % paso === 0).slice(0, 11);

const cantidadOrden = (p) => 2 * p.stock_minimo - p.stock_actual;
// SPEC-27: la orden snapshottea el COSTO del proveedor (producto_proveedor),
// no el precio de venta. Fallback a precio_venta si faltara la fila.
const costoDe = (p) =>
  producto_proveedor.find(
    (pp) => pp.producto_id === p.id && pp.proveedor_id === p.proveedor_id,
  )?.costo_unitario ?? p.precio_venta;
const monto = (p) => Math.round(cantidadOrden(p) * costoDe(p) * 100) / 100;

// Mismo patrón de estados/fechas que el seed original (los tests de
// filtros por fecha dependen de él): 4 pendientes, 4 aprobadas,
// 1 rechazada, 1 enviada, 1 recibida.
const PLANTILLAS_OC = [
  {
    estado: 'APROBADA',
    requiere_aprobacion: 0,
    aprobado_por: 'auto',
    motivo_rechazo: null,
    fecha_aprobacion: '2026-10-31T08:23:00',
    fecha_creacion: '2026-10-31T08:23:00',
    fecha_actualizacion: '2026-10-31T08:23:00',
    nota: 'Reposición urgente auto-aprobada. Proveedor con entrega inmediata.',
  },
  {
    estado: 'PENDIENTE_APROBACION',
    requiere_aprobacion: 1,
    aprobado_por: null,
    motivo_rechazo: null,
    fecha_aprobacion: null,
    fecha_creacion: '2026-10-31T08:23:00',
    fecha_actualizacion: '2026-10-31T08:23:00',
    nota: 'Monto alto: requiere aprobación humana antes de emitir la orden.',
  },
  {
    estado: 'PENDIENTE_APROBACION',
    requiere_aprobacion: 1,
    aprobado_por: null,
    motivo_rechazo: null,
    fecha_aprobacion: null,
    fecha_creacion: '2026-10-31T07:58:00',
    fecha_actualizacion: '2026-10-31T07:58:00',
    nota: 'Producto de alta rotación; ordenar antes del mediodía garantiza stock para mañana.',
  },
  {
    estado: 'PENDIENTE_APROBACION',
    requiere_aprobacion: 1,
    aprobado_por: null,
    motivo_rechazo: null,
    fecha_aprobacion: null,
    fecha_creacion: '2026-10-31T07:41:00',
    fecha_actualizacion: '2026-10-31T07:41:00',
    nota: 'Lead time largo del proveedor: ordenar ahora evita quiebre la próxima semana.',
  },
  {
    estado: 'APROBADA',
    requiere_aprobacion: 0,
    aprobado_por: 'auto',
    motivo_rechazo: null,
    fecha_aprobacion: '2026-10-30T18:12:00',
    fecha_creacion: '2026-10-30T18:12:00',
    fecha_actualizacion: '2026-10-30T18:12:00',
    nota: 'Reposición de rutina auto-aprobada. Ventas estables.',
  },
  {
    estado: 'PENDIENTE_APROBACION',
    requiere_aprobacion: 1,
    aprobado_por: null,
    motivo_rechazo: null,
    fecha_aprobacion: null,
    fecha_creacion: '2026-10-30T17:45:00',
    fecha_actualizacion: '2026-10-30T17:45:00',
    nota: 'Pico de demanda los sábados; cubrir el fin de semana sin sobre-stock.',
  },
  {
    estado: 'RECHAZADA',
    requiere_aprobacion: 1,
    aprobado_por: 'maria.lopez@mercadorai.com',
    motivo_rechazo: 'Stock suficiente para cubrir la demanda actual.',
    fecha_aprobacion: '2026-10-30T15:35:00',
    fecha_creacion: '2026-10-30T15:20:00',
    fecha_actualizacion: '2026-10-30T15:35:00',
    nota: 'Se recomendó rechazar y re-evaluar la próxima semana para liberar capital.',
  },
  {
    estado: 'APROBADA',
    requiere_aprobacion: 0,
    aprobado_por: 'auto',
    motivo_rechazo: null,
    fecha_aprobacion: '2026-10-30T14:03:00',
    fecha_creacion: '2026-10-30T14:03:00',
    fecha_actualizacion: '2026-10-30T14:03:00',
    nota: 'Stock bajo el mínimo; se consolida el envío con otra orden del mismo proveedor.',
  },
  {
    estado: 'RECIBIDA',
    requiere_aprobacion: 1,
    aprobado_por: 'carlos.martinez@mercadorai.com',
    motivo_rechazo: null,
    fecha_aprobacion: '2026-10-26T10:05:00',
    fecha_creacion: '2026-10-26T09:12:00',
    fecha_actualizacion: '2026-10-29T08:30:00',
    nota: 'Reposición programada recibida en depósito para mantener 3 semanas de cobertura.',
  },
  {
    estado: 'ENVIADA',
    requiere_aprobacion: 1,
    aprobado_por: 'maria.lopez@mercadorai.com',
    motivo_rechazo: null,
    fecha_aprobacion: '2026-10-29T09:20:00',
    fecha_creacion: '2026-10-29T08:45:00',
    fecha_actualizacion: '2026-10-29T11:00:00',
    nota: 'Alta rotación los fines de semana; despachada para evitar quiebre el sábado.',
  },
  {
    estado: 'APROBADA',
    requiere_aprobacion: 1,
    aprobado_por: 'carlos.martinez@mercadorai.com',
    motivo_rechazo: null,
    fecha_aprobacion: '2026-10-30T16:40:00',
    fecha_creacion: '2026-10-30T16:30:00',
    fecha_actualizacion: '2026-10-30T16:40:00',
    nota: 'Artículo crítico; ordenar la cobertura máxima para dos semanas.',
  },
];

const ordenes_compra = elegidos.map((p, i) => {
  const t = PLANTILLAS_OC[i];
  const cantidad = cantidadOrden(p);
  return {
    id: i + 1,
    orden_id: `OC-${String(i + 1).padStart(3, '0')}`,
    producto_id: p.id,
    proveedor_id: p.proveedor_id,
    cantidad,
    precio_unitario: costoDe(p),
    monto_total: monto(p),
    estado: t.estado,
    requiere_aprobacion: t.requiere_aprobacion,
    analisis_ia:
      `Stock ${p.estado === 'CRITICO' ? 'crítico' : 'bajo'}: ${p.stock_actual} uds ` +
      `vs mínimo ${p.stock_minimo}. Reposición sugerida: ${cantidad} uds. ${t.nota}`,
    aprobado_por: t.aprobado_por,
    motivo_rechazo: t.motivo_rechazo,
    fecha_aprobacion: t.fecha_aprobacion,
    // SPEC-30 (T30.1): el ciclo queda coherente — enviada/recibida
    // traen quien y cuándo; recibida registra cuánto ingresó.
    enviado_por: ['ENVIADA', 'RECIBIDA'].includes(t.estado) ? t.aprobado_por : null,
    fecha_envio: t.estado === 'RECIBIDA' ? '2026-10-27T09:00:00'
      : t.estado === 'ENVIADA' ? '2026-10-29T11:00:00' : null,
    cantidad_recibida: t.estado === 'RECIBIDA' ? cantidad : null,
    recibido_por: t.estado === 'RECIBIDA' ? 'deposito@mercadorai.com' : null,
    fecha_recepcion: t.estado === 'RECIBIDA' ? '2026-10-29T08:30:00' : null,
    fecha_creacion: t.fecha_creacion,
    fecha_actualizacion: t.fecha_actualizacion,
  };
});

// Movimientos coherentes con el stock sembrado: cada uno termina en
// el stock_actual del artículo.
const venta = (id, p, anterior, ref, fecha) => ({
  id,
  producto_id: p.id,
  tipo_movimiento: 'VENTA',
  cantidad_anterior: anterior,
  cantidad_nueva: p.stock_actual,
  diferencia: p.stock_actual - anterior,
  referencia: ref,
  usuario: 'sistema',
  fecha,
});

const historial_stock = [
  venta(1, elegidos[0], elegidos[0].stock_actual + 8, 'POS-4821', '2026-10-30T19:40:00'),
  venta(2, elegidos[1], elegidos[1].stock_actual + 12, 'POS-4830', '2026-10-30T18:05:00'),
  venta(3, elegidos[4], elegidos[4].stock_actual + 6, 'POS-4790', '2026-10-30T16:22:00'),
  {
    // Recepción completa de OC-009: la diferencia es la cantidad
    // ordenada; ventas posteriores ya descontaron hasta stock_actual.
    id: 4,
    producto_id: elegidos[8].id,
    tipo_movimiento: 'REPOSICION',
    cantidad_anterior: 0,
    cantidad_nueva: cantidadOrden(elegidos[8]),
    diferencia: cantidadOrden(elegidos[8]),
    referencia: 'OC-009',
    usuario: 'carlos.martinez@mercadorai.com',
    fecha: '2026-10-28T11:10:00',
  },
  {
    id: 5,
    producto_id: elegidos[2].id,
    tipo_movimiento: 'AJUSTE',
    cantidad_anterior: elegidos[2].stock_actual + 1,
    cantidad_nueva: elegidos[2].stock_actual,
    diferencia: -1,
    referencia: 'AJU-055',
    usuario: 'carlos.martinez@mercadorai.com',
    fecha: '2026-10-30T09:15:00',
  },
  {
    id: 6,
    producto_id: elegidos[5].id,
    tipo_movimiento: 'DEVOLUCION',
    cantidad_anterior: elegidos[5].stock_actual - 2,
    cantidad_nueva: elegidos[5].stock_actual,
    diferencia: 2,
    referencia: 'DEV-102',
    usuario: 'maria.lopez@mercadorai.com',
    fecha: '2026-10-29T14:30:00',
  },
  venta(7, elegidos[3], elegidos[3].stock_actual + 5, 'POS-4815', '2026-10-30T17:50:00'),
];

export const seedData = {
  proveedores: [
    {
      id: 1,
      nombre: 'Mayorista Central SA',
      contacto: 'María González',
      telefono: '+54 11 5555-0101',
      email: 'ventas@mayoristacentral.com',
      tiempo_entrega_min_dias: 2,
      tiempo_entrega_max_dias: 5,
      confiabilidad_pct: 92,
      pedido_minimo_monto: 300000,
      costo_envio: 15000,
      categorias_cubiertas: ['Almacén', 'Desayuno y Merienda'],
      tiempo_entrega_dias: 3,
      activo: 1,
      fecha_creacion: '2026-10-20T09:00:00',
    },
    {
      id: 2,
      nombre: 'Bebidas del Litoral SA',
      contacto: 'Roberto Díaz',
      telefono: '+54 11 5555-0102',
      email: 'pedidos@bebidaslitoral.com',
      tiempo_entrega_min_dias: 1,
      tiempo_entrega_max_dias: 4,
      confiabilidad_pct: 90,
      pedido_minimo_monto: 200000,
      costo_envio: 12000,
      categorias_cubiertas: ['Bebidas'],
      tiempo_entrega_dias: 2,
      activo: 1,
      fecha_creacion: '2026-10-20T09:00:00',
    },
    {
      id: 3,
      nombre: 'Perfumería Integral SA',
      contacto: 'Juan Pérez',
      telefono: '+54 11 5555-0103',
      email: 'ventas@perfumeriaintegral.com',
      tiempo_entrega_min_dias: 3,
      tiempo_entrega_max_dias: 6,
      confiabilidad_pct: 88,
      pedido_minimo_monto: 150000,
      costo_envio: 8000,
      categorias_cubiertas: ['Perfumería'],
      tiempo_entrega_dias: 4,
      activo: 1,
      fecha_creacion: '2026-10-20T09:00:00',
    },
    {
      id: 4,
      nombre: 'Limpieza y Hogar SA',
      contacto: 'Ana Martínez',
      telefono: '+54 11 5555-0104',
      email: 'comercial@limpiezahogar.com',
      tiempo_entrega_min_dias: 2,
      tiempo_entrega_max_dias: 4,
      confiabilidad_pct: 93,
      pedido_minimo_monto: 120000,
      costo_envio: 8000,
      categorias_cubiertas: ['Limpieza'],
      tiempo_entrega_dias: 3,
      activo: 1,
      fecha_creacion: '2026-10-20T09:00:00',
    },
    {
      id: 5,
      nombre: 'Frescos del Sur SA',
      contacto: 'Pedro Sánchez',
      telefono: '+54 11 5555-0105',
      email: 'ventas@frescosdelsur.com',
      tiempo_entrega_min_dias: 1,
      tiempo_entrega_max_dias: 2,
      confiabilidad_pct: 95,
      pedido_minimo_monto: 80000,
      costo_envio: 10000,
      categorias_cubiertas: ['Frescos'],
      tiempo_entrega_dias: 1,
      activo: 1,
      fecha_creacion: '2026-10-20T09:00:00',
    },
    {
      id: 6,
      nombre: 'Congelados Patagónicos SA',
      contacto: 'Lucía Fernández',
      telefono: '+54 11 5555-0106',
      email: 'pedidos@congeladospatagonicos.com',
      tiempo_entrega_min_dias: 4,
      tiempo_entrega_max_dias: 7,
      confiabilidad_pct: 85,
      pedido_minimo_monto: 400000,
      costo_envio: 25000,
      categorias_cubiertas: ['Congelados'],
      tiempo_entrega_dias: 5,
      activo: 1,
      fecha_creacion: '2026-10-20T09:00:00',
    },
    {
      id: 7,
      nombre: 'Huerta Don Mario',
      contacto: 'Mario Giménez',
      telefono: '+54 11 5555-0107',
      email: 'huerta@donmario.com',
      tiempo_entrega_min_dias: 1,
      tiempo_entrega_max_dias: 2,
      confiabilidad_pct: 97,
      pedido_minimo_monto: 0,
      costo_envio: 5000,
      categorias_cubiertas: ['Frutas y Verduras'],
      tiempo_entrega_dias: 1,
      activo: 1,
      fecha_creacion: '2026-10-20T09:00:00',
    },
    {
      // SPEC-27: mayorista general (tipo Diarco/Maxiconsumo) — cubre
      // todo el catálogo. Es la alternativa de producto_proveedor:
      // suele ser más barato pero con lead más largo y pedido mínimo
      // alto → el agente elige costo vs velocidad.
      id: 8,
      nombre: 'Distribuidora Nacional SA',
      contacto: 'Ventas Mayoristas',
      telefono: '+54 11 5555-0110',
      email: 'ventas@distnacional.com',
      tiempo_entrega_min_dias: 4,
      tiempo_entrega_max_dias: 8,
      confiabilidad_pct: 80,
      pedido_minimo_monto: 250000,
      costo_envio: 12000,
      categorias_cubiertas: [
        'Almacén', 'Desayuno y Merienda', 'Bebidas', 'Perfumería',
        'Limpieza', 'Frescos', 'Congelados', 'Frutas y Verduras',
      ],
      tiempo_entrega_dias: 6,
      activo: 1,
      fecha_creacion: '2026-10-20T09:00:00',
    },
  ],

  productos,

  producto_proveedor,

  // SPEC-32 (T32.1): snapshot de precios por cadena (retail-radar)
  // — 4 filas por artículo, append-only por fecha_snapshot.
  precios_competencia: generarCompetencia(),

  ordenes_compra,

  historial_stock,

  // SPEC-23: password_hash scrypt nativo de passwords dev
  // documentadas en README → "Usuarios demo". El formato lleva
  // sus params (N,r,p), así el hash sigue verificando si cambian.
  // `agente` es la cuenta de servicio del harness (rol SERVICIO).
  usuarios: [
    {
      id: 1,
      email: 'carlos.martinez@mercadorai.com',
      nombre: 'Carlos Martínez',
      rol: 'GERENTE',
      password_hash:
        '$scrypt$N=16384,r=8,p=1$hIDogQ5SFYqpjEIZSEau+Q==$MXmP4qfye7YHFAQcRlWi/ygd76WFCgSHKIadL9rvL/UKu6L1YCd2zebmMHDyEbt8YCTeJw8cNnVR9VdniBoZ9Q==',
      avatar_url: null,
      activo: 1,
      intentos_fallidos: 0,
      bloqueado_hasta: null,
      ultimo_login: null,
      token_version: 0,
      fecha_creacion: '2026-10-20T09:00:00',
    },
    {
      id: 2,
      email: 'maria.lopez@mercadorai.com',
      nombre: 'María López',
      rol: 'APROBADOR',
      password_hash:
        '$scrypt$N=16384,r=8,p=1$ad5XO4iCEJL4tCsGeZMSXA==$24xdPDqU7JO3FI+tHOIGOfG3bPg5wEWNqMaEWU5lqhRkMEx3hracSoDEewCkFSDVAS4m+rlqf+ekiiZMpCWAzg==',
      avatar_url: null,
      activo: 1,
      intentos_fallidos: 0,
      bloqueado_hasta: null,
      ultimo_login: null,
      token_version: 0,
      fecha_creacion: '2026-10-20T09:00:00',
    },
    {
      id: 3,
      email: 'admin@mercadorai.com',
      nombre: 'Administrador',
      rol: 'ADMIN',
      password_hash:
        '$scrypt$N=16384,r=8,p=1$FneysqBZf3M12xvZr+IOzg==$E0rLpYS0FSfje1+VcRFEFONTWCOK08J86kEuxc44/dWmmc4ajxLDGhZNy1U+2I/IPEY8ahQ2ln5KNjon92ocoQ==',
      avatar_url: null,
      activo: 1,
      intentos_fallidos: 0,
      bloqueado_hasta: null,
      ultimo_login: null,
      token_version: 0,
      fecha_creacion: '2026-10-20T09:00:00',
    },
    {
      id: 4,
      email: 'agente@mercadorai.com',
      nombre: 'Agente de reposición',
      rol: 'SERVICIO',
      password_hash:
        '$scrypt$N=16384,r=8,p=1$iDD/WUQrG0+zE93CDo2hBA==$uObwlPoXoUXRrDocEp6xhVyXtKm3ygEPgHr4yseKYx4twiYiJ1LEXFB1FJGdYsxspUexotqsyZoLbV8ZBxpLrg==',
      avatar_url: null,
      activo: 1,
      intentos_fallidos: 0,
      bloqueado_hasta: null,
      ultimo_login: null,
      token_version: 0,
      fecha_creacion: '2026-10-20T09:00:00',
    },
    {
      id: 5,
      email: 'buyer@mercadorai.com',
      nombre: 'Laura Fernández',
      rol: 'BUYER',
      // demo-buyer-2026 — vista exclusiva /alertas (SPEC-29).
      password_hash:
        '$scrypt$N=16384,r=8,p=1$3+O5esZMAg/RK5tX8WbCHg==$Xh2wfilbEvveqE/rCnCce4lMpJ2bEFZvPNpfsQgus7+tALAeC34DqoJStCdeeLbM5NhETzKDfZRpxu1jC6ee1w==',
      avatar_url: null,
      activo: 1,
      intentos_fallidos: 0,
      bloqueado_hasta: null,
      ultimo_login: null,
      token_version: 0,
      fecha_creacion: '2026-10-20T09:00:00',
    },
  ],
};
