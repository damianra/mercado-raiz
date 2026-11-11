# Benchmark LLM — `qwen3:8b` (2026-11-11)

Resultados de la prueba de stress del pipeline LLM del agente de reabastecimiento
(SPEC-11). Artefacto de datos crudos agregados: `stress-qwen3-8b-2026-11-11.json`.

## Entorno

| Componente | Valor |
|---|---|
| Modelo | `qwen3:8b` (Q4_K_M, 8.2B params, contexto 4.096, `think: false`) |
| Runtime | Ollama `0.12.3` @ `http://localhost:11434` |
| Node | `v24.16.0` |
| GPU | NVIDIA GeForce RTX 3060 Ti, 8 GB VRAM, driver 555.58.02, TDP 200 W |
| Pipeline medido | `analizar-demanda` (llmJson → zod) + `generar-analisis` (llm, texto) — **2 llamadas/artículo**, secuencial (igual que el grafo real) |
| Config | `--articulos 100 --concurrencia 1 --muestra-cada 25` |

## Resumen ejecutivo

| Métrica | Valor |
|---|---|
| Artículos analizados | **100 / 100** (completo, sin cortes) |
| Duración total | **258,4 s** (~4,3 min) |
| Throughput sostenido | **23,2 art/min** (46,4 llamadas/min) |
| Tiempo promedio por artículo | **~2,58 s** (demanda ~0,9 s + justificación ~1,7 s) |
| Llamadas LLM totales | 200 |
| Fallbacks / errores | **0 / 0** |
| Costo estimado | USD 0 (modelo local) |

## Tokens

| Métrica | Demanda | Justificación | Total corrida |
|---|---|---|---|
| Llamadas | 100 | 100 | 200 |
| Tokens prompt (total) | 24.579 | 16.441 | **41.020** |
| Tokens generación (total) | 4.275 | 9.994 | **14.269** |
| Tokens prompt prom./llamada | 245,8 | 164,4 | 205,1 |
| Tokens generación prom./llamada | 42,8 | 99,9 | 71,3 |
| **Tokens por artículo** | — | — | **~410 in / ~143 out** |

## Latencia por tipo de llamada (wall-clock, ms)

| Tipo | p50 | p95 | p99 | max | `total_duration` Ollama prom. |
|---|---|---|---|---|---|
| `analizar-demanda` | 897 | 948 | 2.317 | 2.317 | 905 |
| `generar-analisis` | 1.707 | 1.879 | 1.949 | 1.949 | 1.676 |

## Desglose de tiempo LLM (promedio por llamada, `response_metadata`)

| Etapa | ms | % del total |
|---|---|---|
| `load_duration` (carga/verify) | 54 | 4% |
| `prompt_eval_duration` (leer prompt) | 97 | 8% |
| `eval_duration` (generación) | 1.107 | 86% |
| `total_duration` | 1.290 | 100% |

→ El tiempo lo domina la **generación de tokens**, no la lectura del prompt ni el cold start (modelo queda caliente en VRAM por `keep_alive`).

## GPU bajo carga (nvidia-smi, 17 muestras cada 15 s)

| Métrica | min | prom | max | Límite / contexto |
|---|---|---|---|---|
| Utilización | 63% | **91,5%** | 96% | saturada en forma casi permanente |
| Potencia | 189,0 W | **195,6 W** | 199,9 W | **TDP 200 W → power-limited** |
| Temperatura | 65 °C | 69,7 °C | 71 °C | segura (límite térmico ~93 °C) |
| VRAM | 6.153 MB | 6.178 MB | 6.237 MB | **76% de 8 GB — no es restricción** |
| Clocks SM | 1.665 MHz | 1.758 MHz | 1.815 MHz | oscilan por límite de potencia |

## Proceso Ollama (host)

| Métrica | min | max |
|---|---|---|
| RSS | 1.476 MB | 1.564 MB |
| CPU | 114% | 115% |

El host queda holgado: ~1,5 GB RAM y ~1,1 núcleos — el cuello no está en CPU ni RAM del proceso servidor.

## Concurrencia (test comparativo, 12 artículos)

| K | Throughput | Cola observada |
|---|---|---|
| 1 | 21,8 art/min | — |
| 4 | 24,4 art/min (**+12%**) | latencia de cola 5,7–6,5 s |

Ollama **serializa la inferencia** en esta GPU: paralelizar requests apenas suma
throughput y agrega latencia de cola. Para escalar haría falta
`OLLAMA_NUM_PARALLEL` o workers con otros modelos — no es la configuración del
agente hoy.

## Hallazgos

1. **Cuello de botella: potencia/cómputo de GPU.** Utilización ~92% + potencia
   pegada al TDP (195,6/200 W) + clocks SM oscilando (1.665–1.815 MHz) = chip
   power-limited. VRAM (76%) y host (RAM/CPU) sobran.
2. **Throughput plano**: 23 art/min constante en 3 corridas independientes —
   reproducible y sin degradación térmica (pico 71 °C, baja a ~50 °C en <1 min).
3. **Generación domina la latencia** (86% del `total_duration`): reducir tokens
   de salida (prompt más conciso en `generar-analisis`) impacta más que acortar
   el prompt de entrada.
4. **Resiliencia total**: 0 fallbacks y 0 errores en 200 llamadas — el schema
   zod y `think: false` eliminan los dos modos de fallo conocidos de qwen3.
5. **Proyección**: a 2 llamadas/artículo, 100 productos con stock bajo ≈
   **4,3 min de LLM puro** en este hardware.

## Reproducir

```bash
cd harness-langgraph
node scripts/stress-llm.mjs \
  --articulos 100 \
  --concurrencia 1 \
  --muestra-cada 25 \
  --reporte docs/benchmarks/stress-<modelo>-<fecha>.json
# GPU: muestrear aparte, ej. cada 15 s:
nvidia-smi --query-gpu=temperature.gpu,utilization.gpu,memory.used,power.draw,clocks.sm \
  --format=csv,noheader,nounits -l 15
```

> **Nota**: `--salida file.jsonl` (detalle por artículo) es efímero por diseño —
> útil para inspección puntual, **no se commitea**. En el repo solo persisten el
> `.json` agregado y este `.md`.
