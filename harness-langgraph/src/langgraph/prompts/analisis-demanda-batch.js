/**
 * Arma el prompt en lote que el nodo analizar-demanda manda al
 * LLM (SPEC-16, R16.3): N productos volátiles por llamada en vez
 * de uno. Recibe una lista de { p, ventas } y pide un
 * array JSON con un objeto por producto — cada objeto repite el
 * `producto_id` para que el nodo pueda matchear respuesta ↔
 * producto (los que falten o no validen caen a llamada
 * individual). Se parsea con parseJsonArrayResponse.
 */
export function promptAnalisisDemandaBatch(lote) {
  const bloques = lote.map(({ p: producto, ventas }) => {
    // Las últimas 10 alcanzan para estimar el patrón reciente y
    // acotan el prompt: historiales largos (hasta 50 movimientos)
    // inflarían el input más allá del numCtx del modelo batch.
    const ventasTxt = ventas.length
      ? ventas.slice(-10).map((v) => `${v.fecha.slice(0, 10)}: ${Math.abs(v.diferencia)} unidades`).join('; ')
      : 'sin ventas registradas';
    return [
      `ID ${producto.id} — ${producto.nombre} (SKU ${producto.sku}, categoría ${producto.categoria})`,
      `Stock actual: ${producto.stock_actual} | Stock mínimo: ${producto.stock_minimo}`,
      `Ventas recientes: ${ventasTxt}`,
    ].join('\n');
  }).join('\n\n');

  return `Sos un analista de inventario. Estimá la demanda diaria de CADA producto mirando sus ventas.

${bloques}

Respondé SOLO un array JSON válido con UN objeto por producto — mismo orden, cada uno repite su id:
[{"producto_id": <id>, "demanda_diaria": <numero>, "tendencia": "subiendo"|"estable"|"bajando", "observacion": "<una frase corta>"}]`;
}
