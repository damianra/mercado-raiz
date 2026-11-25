/**
 * Arma el texto que el nodo generar-analisis manda al LLM.
 * Recibe: producto + análisis de demanda + cantidad + monto ya
 * calculados. Devuelve: el string del prompt pidiendo una
 * justificación breve en prosa — el texto resultante viaja al
 * backend como campo analisis_ia de la orden (lo lee el aprobador
 * en el modal del dashboard).
 */
const ZONA_JUSTIFICACION = {
  BAJO_MIN: 'más barato que todo el mercado',
  EN_RANGO: 'dentro del rango de mercado',
  SOBRE_MAX: 'sobre el máximo del mercado',
  SIN_DATOS: 'sin datos de competencia',
};

export function promptGenerarAnalisis(producto, analisis, cantidad, monto, decision) {
  // T32.5: la posición competitiva llega con el análisis (dato del
  // backend). Si aparece, el modelo la puede usar en la prosa;
  // si el producto está SOBRE_MAX en quiebre real (revision_precio)
  // la justificación DEBE recomendar revisar el precio.
  const zona = ZONA_JUSTIFICACION[analisis.zona_precio];
  const lineaPrecio = zona
    ? `Posición de precio: ${zona}` +
      (analisis.indice_precio != null
        ? ` (índice ${analisis.indice_precio}, 100 = empate con el más barato)`
        : '') +
      '\n'
    : '';
  const lineaRevision = analisis.revision_precio
    ? 'El precio está sobre el máximo del mercado: la justificación DEBE recomendar revisar el precio antes de reponer.\n'
    : '';
  return `Sos un asistente de compras. Escribí una justificación breve (2-3 oraciones) para esta orden de reposición. Usá SOLO estos datos, no inventes otros:

Producto: ${producto.nombre} (${producto.sku})
Stock actual: ${producto.stock_actual} (mínimo: ${producto.stock_minimo})
Demanda estimada: ${analisis.demanda_diaria} unidades/día, tendencia ${analisis.tendencia}
${lineaPrecio}Cantidad a ordenar: ${cantidad} | Monto total: $${monto.toFixed(2)}
Proveedor: ${decision?.proveedor_nombre ?? producto.proveedor?.nombre ?? 'desconocido'}
${lineaRevision}
Respondé SOLO el texto de la justificación, sin comillas ni formato.`;
}
