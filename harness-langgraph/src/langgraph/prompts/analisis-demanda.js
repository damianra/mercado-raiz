/**
 * Arma el texto que el nodo analizar-demanda manda al LLM.
 * Recibe: el producto (nombre, sku, stock) y sus estadísticas de
 * demanda del backend (SPEC-26: demanda_diaria ponderada,
 * pendiente, CV, días con venta/quiebre, última venta).
 * Devuelve: el string del prompt, que pide estimar demanda diaria
 * y responder SOLO JSON {"demanda_diaria","tendencia","observacion"}
 * — el nodo lo parsea con utils/llm-json.js contra schemaAnalisis.
 */

/** Render compacto de las stats para el prompt. */
export function statsTxt(stats) {
  const quiebre =
    stats.dias_en_quiebre == null
      ? 'sin datos de stock'
      : `${stats.dias_en_quiebre} día(s) en quiebre`;
  const ultima = stats.ultima_venta ?? 'nunca';
  return (
    `${stats.dias_con_venta} día(s) con venta en ${stats.dias}d, ` +
    `media ponderada ${stats.demanda_diaria} u/día (σ=${stats.desvio_demanda}, ` +
    `CV=${stats.cv ?? 'n/a'}), pendiente ${stats.tendencia} u/día², ` +
    `${quiebre}, última venta ${ultima}`
  );
}

export function promptAnalisisDemanda(producto, stats) {
  return `Sos un analista de inventario. Ajustá la demanda diaria estimada de este producto mirando sus estadísticas de venta (días en quiebre NO cuentan como demanda cero — son días censurados donde no se pudo vender).

Producto: ${producto.nombre} (SKU ${producto.sku}, categoría ${producto.categoria})
Stock actual: ${producto.stock_actual} | Stock mínimo: ${producto.stock_minimo}
Estadísticas: ${statsTxt(stats)}

Respondé SOLO un JSON válido con esta forma exacta:
{"demanda_diaria": <numero>, "tendencia": "subiendo"|"estable"|"bajando", "observacion": "<una frase corta>"}`;
}
