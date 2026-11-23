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
// - monto_total = cantidad * precio_unitario
// - OC-001..OC-011 replican el flujo de aprobación sobre artículos
//   reales en CRITICO/STOCK_BAJO (cantidad = 2·min − actual, R5.5);
//   APROBADO_AUTO del front = APROBADA con requiere_aprobacion = 0
//   y aprobado_por = 'auto'.

import { generarArticulos } from './seed-articulos.js';

const productos = generarArticulos();

// Artículos bajo stock repartidos en el catálogo (determinístico — el
// orden del CSV es fijo). Las OC demo apuntan a estos.
const bajos = productos.filter((p) => p.estado !== 'OK');
const paso = Math.max(1, Math.floor(bajos.length / 11));
const elegidos = bajos.filter((_, i) => i % paso === 0).slice(0, 11);

const cantidadOrden = (p) => 2 * p.stock_minimo - p.stock_actual;
const monto = (p) => Math.round(cantidadOrden(p) * p.precio_unitario * 100) / 100;

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
    precio_unitario: p.precio_unitario,
    monto_total: monto(p),
    estado: t.estado,
    requiere_aprobacion: t.requiere_aprobacion,
    analisis_ia:
      `Stock ${p.estado === 'CRITICO' ? 'crítico' : 'bajo'}: ${p.stock_actual} uds ` +
      `vs mínimo ${p.stock_minimo}. Reposición sugerida: ${cantidad} uds. ${t.nota}`,
    aprobado_por: t.aprobado_por,
    motivo_rechazo: t.motivo_rechazo,
    fecha_aprobacion: t.fecha_aprobacion,
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
      tiempo_entrega_dias: 1,
      activo: 1,
      fecha_creacion: '2026-10-20T09:00:00',
    },
  ],

  productos,

  ordenes_compra,

  historial_stock,

  // SPEC-23: password_hash argon2id (PHC) de passwords dev
  // documentadas en README → "Usuarios demo". El PHC lleva sus
  // params, así el hash sigue verificando aunque cambie ARGON.
  // `agente` es la cuenta de servicio del harness (rol SERVICIO).
  usuarios: [
    {
      id: 1,
      email: 'carlos.martinez@mercadorai.com',
      nombre: 'Carlos Martínez',
      rol: 'GERENTE',
      password_hash:
        '$argon2id$m=65536,t=3,p=4$rgFQ+9ynIlgnKVE24YVAEA==$JHgF3nsX9JjVZnDDkKgah/XYdRIxaaQfSVIb9tAQmzg=',
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
        '$argon2id$m=65536,t=3,p=4$gXSvr7G8bMNxG4Kt7YxYoQ==$OiDoFUJPrEZODo6OEJrhhC6RdMA2q0DFhgKki7LMWoQ=',
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
        '$argon2id$m=65536,t=3,p=4$T2QftSWy8xpaUIQ8jvcC1w==$3He/Tg1LbaeEmasRG2B+4lua5/4/4thr9PkLk+Atdfo=',
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
        '$argon2id$m=65536,t=3,p=4$zfPJIJyQ/xGQD9zL3NI8Uw==$Uxl8KfFkXxckCNjEOWUFW6jG6aU6nt6bm5jCfHtef/M=',
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
