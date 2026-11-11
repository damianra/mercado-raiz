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
