// Estados visuales de las órdenes — el mapeo desde los estados del
// backend lo hace mapOrden() en src/lib/api.js.
export const ESTADOS = {
  PENDIENTE_APROBACION: { label: 'Pendiente', classes: 'bg-ocre/10 text-ocre ring-ocre/25', dot: 'bg-ocre' },
  APROBADO_AUTO: { label: 'Aprobado auto', classes: 'bg-success/10 text-success ring-success/25', dot: 'bg-success' },
  APROBADO: { label: 'Aprobada', classes: 'bg-success/10 text-success ring-success/25', dot: 'bg-success' },
  RECHAZADO: { label: 'Rechazado', classes: 'bg-terra/10 text-terra ring-terra/25', dot: 'bg-terra' },
  ENVIADA: { label: 'Enviada', classes: 'bg-info/10 text-info ring-info/25', dot: 'bg-info' },
  RECIBIDA: { label: 'Recibida', classes: 'bg-success/10 text-success ring-success/25', dot: 'bg-success' },
};

export const formatMoney = (n) =>
  `$${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
