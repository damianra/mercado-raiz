/**
 * Arma el texto que el nodo generar-analisis manda al LLM.
 * Recibe: producto + análisis de demanda + cantidad + monto ya
 * calculados. Devuelve: el string del prompt pidiendo una
 * justificación breve en prosa — el texto resultante viaja al
 * backend como campo analisis_ia de la orden (lo lee el aprobador
 * en el modal del dashboard).
 */
export function promptGenerarAnalisis(producto, analisis, cantidad, monto) {
  return `Sos un asistente de compras. Escribí una justificación breve (2-3 oraciones) para esta orden de reposición. Usá SOLO estos datos, no inventes otros:

Producto: ${producto.nombre} (${producto.sku})
Stock actual: ${producto.stock_actual} (mínimo: ${producto.stock_minimo})
Demanda estimada: ${analisis.demanda_diaria} unidades/día, tendencia ${analisis.tendencia}
Cantidad a ordenar: ${cantidad} | Monto total: $${monto.toFixed(2)}
Proveedor: ${producto.proveedor?.nombre ?? 'desconocido'} (entrega en ${producto.proveedor?.tiempo_entrega_dias ?? '?'} días)

Respondé SOLO el texto de la justificación, sin comillas ni formato.`;
}
