/**
 * Recibe el texto crudo de una respuesta del LLM y devuelve el JSON
 * validado contra un schema zod. Lo llama el nodo analizar-demanda
 * (único que pide respuestas estructuradas). Extrae el primer {...}
 * del texto; si no hay JSON, no parsea o no cumple el schema, tira —
 * ahí el error-handler reintenta o el nodo usa su fallback.
 */
export function parseJsonResponse(content, schema) {
  const text = typeof content === 'string' ? content : String(content);
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`el LLM no devolvió JSON: ${text.slice(0, 120)}`);
  let data;
  try {
    data = JSON.parse(match[0]);
  } catch {
    throw new Error(`JSON inválido del LLM: ${match[0].slice(0, 120)}`);
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new Error(`el JSON del LLM no cumple el schema: ${parsed.error.issues[0]?.message}`);
  }
  return parsed.data;
}

/**
 * Variante para respuestas en lote (SPEC-16, R16.3): extrae el
 * primer [...] del texto y valida CADA item por separado contra
 * `itemSchema` — un item malformado no tira el lote entero.
 * Devuelve { items, invalidos }: los que cumplen el schema y la
 * cantidad descartada (el nodo les hace llamada individual).
 * Tira solo si no hay array o el JSON no parsea — ahí el lote
 * completo cae a llamadas individuales.
 */
export function parseJsonArrayResponse(content, itemSchema) {
  const text = typeof content === 'string' ? content : String(content);
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error(`el LLM no devolvió un array JSON: ${text.slice(0, 120)}`);
  let data;
  try {
    data = JSON.parse(match[0]);
  } catch {
    throw new Error(`array JSON inválido del LLM: ${match[0].slice(0, 120)}`);
  }
  if (!Array.isArray(data)) throw new Error('la respuesta del LLM no es un array');
  const items = [];
  let invalidos = 0;
  for (const item of data) {
    const parsed = itemSchema.safeParse(item);
    if (parsed.success) items.push(parsed.data);
    else invalidos += 1;
  }
  return { items, invalidos };
}
