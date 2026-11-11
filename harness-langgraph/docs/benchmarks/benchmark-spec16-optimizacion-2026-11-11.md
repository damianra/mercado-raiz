# Benchmark SPEC-16 — optimización del grafo (cache incremental + concurrencia + lotes)

**Fecha:** 2026-11-11
**Modelo:** qwen3:8b @ Ollama 0.12.3 (`think: false`, `numCtx` 2048, `OLLAMA_NUM_PARALLEL=3`)
**Config:** `AGENTE_CONCURRENCIA=3`, `DEMANDA_BATCH=5`, `UMBRAL_APROBACION=100`, `UMBRAL_CV=0.3`
**Dataset:** mismo escenario que `validacion-grafo-real-2026-11-11.md` — 100 productos BENCH sintéticos
(15 estables-baratos, 35 estables-caros, 15 volátiles-baratos, 35 volátiles-caros) + catálogo original.
La corrida real evaluó 108 productos (107 STOCK_BAJO + 1 CRITICO, traídos por paginación completa de SPEC-14).

## Resultados

| Métrica | Baseline (SPEC-12, secuencial) | SPEC-16 fría (cache vacío) | SPEC-16 tibia (mismo input) |
|---|---|---|---|
| Wall-clock total | ~312 s (~5,2 min) | **79 s (~3,9×)** | **<1 s (~300×)** |
| Productos evaluados | 101 | 108 | 108 |
| Llamadas LLM | 137 | **87** | **0** |
| `llm_evitadas` (triage CV) | 65 | 83 | 83 |
| `cache_hits` | — (no existía) | 0 | **133** |
| Fallbacks | 0 | 0 | 0 |
| Reintentos 429 | — | 0 | 0 |
| Órdenes persistidas | 60 (41 perdidas por rate limit) | **108/108** | **108/108** |
| GPU durante llamadas LLM | 93,7% util / 196 W / 69 °C | 88% / 189 W / 66 °C | ~idle (27% / 24 W) |
| Tokens in/out | 26.266 / 10.260 | 21.398 / 8.549 | 0 / 0 |

Desglose de las 87 llamadas frías: **12 llamadas de lote** resolvieron 58 demandas
volátiles (0 degradación a individual — el formato `{"resultados":[...]}` se parseó
en todos los lotes) + **75 justificaciones** individuales (órdenes ≥ $100). En la
corrida tibia los 133 cache hits = 58 demandas + 75 justificaciones → el LLM no se
llamó ni una vez.

## Hallazgos

1. **El batch de prompts sí reduce llamadas** (58 demandas en 12 llamadas ≈ 4,8
   productos/llamada), pero **no reduce el tiempo de esas llamadas proporcionalmente**:
   un lote de 5 tarda ~2-4 s (genera ~500 tokens) vs ~1,3 s de una individual.
   El ahorro real viene de menos *prefills* y de que los lotes corren en paralelo
   (hasta 3 con `AGENTE_CONCURRENCIA`).

2. **El primer intento con array desnudo `[...]` falló en el 100% de los lotes**:
   con `format:'json'`, Ollama sesga la salida a objetos y qwen3:8b devolvía UN
   objeto suelto. Se corrigió pidiendo `{"resultados": [...]}` + un parser que
   acepta las 3 formas reales (array, objeto-envuelto, objeto suelto → item único).
   Lección: en `format:'json'` siempre pedir el resultado dentro de un objeto.

3. **La concurrencia aprovecha `OLLAMA_NUM_PARALLEL`**: con 3 workers las 3 fases
   (ventas, lotes, justificaciones) se solaparon. La GPU seguía siendo el cuello
   (88% util sostenido) — el speedup de ~4× viene de pipelining, no de magia.

4. **El cache incremental es la palanca dominante a escala real**: en una corrida
   diaria donde el input cambia poco, el costo marginal por producto tiende a 0
   (79 s → <1 s). Los `cache_hits` se cuentan aparte de `llm_evitadas`.

5. **`POST /api/ordenes/batch` eliminó el cuello de escrituras**: 108 órdenes en 2
   requests transaccionales; el limiter de 20 escrituras/min ni se acercó. En el
   baseline, 41 órdenes se perdieron por 429 sin retry (pre SPEC-13).

6. **Nota de wall-clock**: el baseline ~5,2 min incluía esperas por 429 del limiter;
   SPEC-16 las evita por volumen (batch). Comparación honesta de llamadas LLM:
   137 → 87 (−36%), pero el tiempo total mejora ~4× por paralelismo + no-bloqueos.

## Reproducir

```bash
# dataset de 100 productos sintéticos (ver seed en docs del benchmark anterior)
rm harness-langgraph/data/analisis-cache.json   # corrida fría
OLLAMA_NUM_PARALLEL=3 ollama serve &            # antes de lanzar ollama
npm --prefix harness-langgraph run agente       # fría
curl -X POST localhost:4110/run                 # tibia (mismo input → cache)
curl localhost:4110/metrics
```
