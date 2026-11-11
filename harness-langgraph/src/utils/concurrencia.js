/**
 * Mapea `items` a través de `fn` con a lo sumo `limite` llamadas
 * en vuelo (worker pool). Devuelve los resultados en el mismo
 * orden que `items`. Usado por los nodos que iteran productos
 * llamando al LLM (SPEC-16, R16.2): la GPU gana throughput
 * sirviendo varias requests a la vez, siempre que Ollama arranque
 * con OLLAMA_NUM_PARALLEL >= limite.
 *
 * Si `fn` rechaza, la primera excepción aborta igual que en un
 * `for await` secuencial (los workers en vuelo terminan su item
 * pero no arrancan nuevos — el nodo propaga el error).
 */
export async function conLimite(items, limite, fn) {
  const resultados = new Array(items.length);
  let siguiente = 0;
  let fallo = false;
  async function worker() {
    while (!fallo && siguiente < items.length) {
      const i = siguiente++;
      try {
        resultados[i] = await fn(items[i], i);
      } catch (err) {
        fallo = true; // los demás workers terminan su item y frenan
        throw err;
      }
    }
  }
  const workers = Math.min(Math.max(1, limite), items.length);
  await Promise.all(Array.from({ length: workers }, worker));
  return resultados;
}
