// Estados visuales de las órdenes — el mapeo desde los estados del
// backend lo hace mapOrden() en src/lib/api.js.
export const ESTADOS = {
  PENDIENTE_APROBACION: { label: 'Pendiente', classes: 'bg-[#FFF4E6] text-ocre' },
  APROBADO_AUTO: { label: 'Aprobado auto', classes: 'bg-[#E8F5E9] text-success' },
  APROBADO: { label: 'Aprobada', classes: 'bg-[#E8F5E9] text-success' },
  RECHAZADO: { label: 'Rechazado', classes: 'bg-[#FFEBEE] text-terra' },
  ENVIADA: { label: 'Enviada', classes: 'bg-[#E3EDF5] text-info' },
  RECIBIDA: { label: 'Recibida', classes: 'bg-[#E8F5E9] text-success' },
};

export const formatMoney = (n) =>
  `$${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
