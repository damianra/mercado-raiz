/**
 * Arma el texto que el nodo analizar-demanda manda al LLM.
 * Recibe: el producto (nombre, sku, stock) y su lista de ventas.
 * Devuelve: el string del prompt, que pide estimar demanda diaria
 * y responder SOLO JSON {"demanda_diaria","tendencia","observacion"}
 * — el nodo lo parsea con utils/llm-json.js contra schemaAnalisis.
 */
export function promptAnalisisDemanda(producto, ventas) {
  const ventasTxt = ventas.length
    ? ventas.map((v) => `${v.fecha.slice(0, 10)}: ${Math.abs(v.diferencia)} unidades`).join('; ')
    : 'sin ventas registradas';

  return `Sos un analista de inventario. Estimá la demanda diaria de este producto mirando sus ventas.

Producto: ${producto.nombre} (SKU ${producto.sku}, categoría ${producto.categoria})
Stock actual: ${producto.stock_actual} | Stock mínimo: ${producto.stock_minimo}
Ventas recientes: ${ventasTxt}

Respondé SOLO un JSON válido con esta forma exacta:
{"demanda_diaria": <numero>, "tendencia": "subiendo"|"estable"|"bajando", "observacion": "<una frase corta>"}`;
}
