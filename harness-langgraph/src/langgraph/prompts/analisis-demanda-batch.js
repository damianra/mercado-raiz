/**
 * Arma el prompt en lote que el nodo analizar-demanda manda al
 * LLM (SPEC-16, R16.3): N productos volátiles por llamada en vez
 * de uno. Recibe una lista de { p, stats } — las estadísticas de
 * demanda del backend por producto — y pide un array JSON con un
 * objeto por producto, cada uno repite el `producto_id` para que
 * el nodo pueda matchear respuesta ↔ producto (los que falten o
 * no validen caen a llamada individual). Se parsea con
 * parseJsonArrayResponse.
 */
import { statsTxt } from './analisis-demanda.js';

export function promptAnalisisDemandaBatch(lote) {
  const bloques = lote.map(({ p: producto, stats }) =>
    [
      `ID ${producto.id} — ${producto.nombre} (SKU ${producto.sku}, categoría ${producto.categoria})`,
      `Stock actual: ${producto.stock_actual} | Stock mínimo: ${producto.stock_minimo}`,
      `Estadísticas: ${statsTxt(stats)}`,
    ].join('\n'),
  ).join('\n\n');

  return `Sos un analista de inventario. Ajustá la demanda diaria estimada de CADA producto mirando sus estadísticas de venta (días en quiebre NO cuentan como demanda cero — son días censurados donde no se pudo vender).

${bloques}

Si la posición de precio de un producto es relevante para reponer, mencionala en su 'observacion' (más barato del mercado → prioridad; sobre el máximo → sugerir revisar precio).

Respondé SOLO un JSON válido con EXACTAMENTE esta forma — un objeto "resultados" con UN análisis por producto, mismo orden, cada uno repite su id:
{"resultados": [{"producto_id": <id>, "demanda_diaria": <numero>, "tendencia": "subiendo"|"estable"|"bajando", "observacion": "<frase corta, máx 12 palabras>"}]}`;
}
