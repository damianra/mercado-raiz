# Benchmark LLM — `qwen3:8b` 500 artículos, post-tuning SPEC-12 (2026-11-11)

Segunda corrida de la prueba de stress del pipeline LLM (SPEC-11), con la
configuración tuneada de SPEC-12 (`num_ctx 2048`, `num_predict` 300/160,
`think: false`). Comparativa directa contra el baseline de 100 artículos
(`benchmark-qwen3-8b-2026-11-11.md`, pre-tuning: ctx 4.096, sin límite de
generación).

Artefacto de datos agregados: `stress-qwen3-8b-500-2026-11-11.json`.

## Entorno

| Componente | Valor |
|---|---|
| Modelo | `qwen3:8b` (Q4_K_M, 8.2B params, contexto **2.048** — antes 4.096, `think: false`) |
| Runtime | Ollama `0.12.3` @ `http://localhost:11434` |
| Node | `v24.16.0` |
| GPU | NVIDIA GeForce RTX 3060 Ti, 8 GB VRAM, driver 555.58.02, TDP 200 W |
| Pipeline medido | `analizar-demanda` (llmJson → zod) + `generar-analisis` (llm, texto) — **2 llamadas/artículo**, secuencial |
| Config | `--articulos 500 --concurrencia 1 --muestra-cada 25` |
| Tuning nuevo | `num_ctx: 2048`, `num_predict: 300` (demanda) / `160` (justificación) |

> **Alcance de la comparación**: el script invoca ambos nodos LLM por
> artículo incondicionalmente — mide el **tuning de runtime** (ctx,
> num_predict). Los ahorros por **llamadas evitadas** (triage CV,
> justificación condicional) son decisiones del grafo que este script no
> ejercita; se proyectan aparte al final.

## Resumen ejecutivo

| Métrica | Baseline 100 art. | Nueva 500 art. | Delta |
|---|---|---|---|
| Artículos procesados | 100 / 100 | **500 / 500** | 5× sin cortes |
| Duración total | 258,4 s | **1.291,9 s** (~21,5 min) | 5,00× — escala lineal |
| Throughput | 23,2 art/min | **23,2 art/min** | **0% — idéntico** |
| Tiempo por artículo | ~2,58 s | ~2,58 s | = |
| Llamadas LLM | 200 | 1.000 | — |
| Fallbacks / errores | 0 / 0 | **0 / 0** | resiliencia sostenida ×5 |

## Comparativa por tipo de llamada

### `analizar-demanda` (wall-clock, ms)

| Métrica | Baseline (n=100) | Nueva (n=500) | Delta |
|---|---|---|---|
| p50 | 897 | 913 | +1,8% (ruido) |
| p95 | 948 | 961 | +1,4% |
| p99 | 2.317 | **1.007** | **−56,5%** |
| max | 2.317 | 1.032 | **−55,5%** |
| tokens in prom. | 245,8 | 246,7 | = |
| tokens out prom. | 42,8 | 42,9 | = |
| `total_duration` prom. | 905 | 905 | = |

→ El típico no cambia (la salida ya era corta), pero `num_predict: 300`
**recorta la cola**: el outlier de generación desbocada (2.317 ms)
desaparece — p99 queda a ±6% del p50.

### `generar-analisis` (wall-clock, ms)

| Métrica | Baseline (n=100) | Nueva (n=500) | Delta |
|---|---|---|---|
| p50 | 1.707 | 1.718 | +0,6% |
| p95 | 1.879 | 1.891 | = |
| p99 | 1.949 | 1.935 | = |
| max | 1.949 | 2.065 | +6% (1 artículo) |
| tokens in prom. | 164,4 | 165,4 | = |
| tokens out prom. | 99,9 | 98,4 | −1,5% |
| `total_duration` prom. | 1.676 | 1.676 | = |

→ Sin cambio significativo: las justificaciones ya generaban ~100 tokens,
por debajo del tope de 160 — el cap solo corta casos excepcionales.

## Tokens (totales de corrida)

| Métrica | Baseline 100 | Nueva 500 | Factor |
|---|---|---|---|
| Prompt acumulados | 41.020 | 206.055 | 5,02× |
| Generación acumulados | 14.269 | 70.648 | 4,95× |
| Prom. por llamada (in/out) | 205 / 71 | 206 / 71 | = |
| Por artículo (in/out) | ~410 / ~143 | ~412 / ~141 | = |

→ Crecimiento **perfectamente lineal** — sin deriva por volumen.

## Desglose de tiempo LLM (promedio por llamada)

| Etapa | Baseline | Nueva | Delta |
|---|---|---|---|
| `load_duration` | 54 ms | 48 ms | −11% |
| `prompt_eval_duration` | 97 ms | 99 ms | = |
| `eval_duration` (generación) | 1.107 ms | 1.112 ms | = |
| `total_duration` | 1.290 ms | 1.291 ms | = |

→ La generación sigue dominando (~86%) — confirma que las palancas de
producto (evitar llamadas, menos tokens de salida) son las que importan,
no el runtime por llamada.

## GPU bajo carga (nvidia-smi, **245 muestras cada 5 s** — vs 17 del baseline)

| Métrica | Baseline (17 m.) | Nueva (245 m.) | Delta |
|---|---|---|---|
| Utilización prom. | 91,5% (63–96) | **92,9%** (63–98) | = |
| Potencia prom. | 195,6 W (189,8–199,9) | **195,8 W** (185,7–201,4) | = |
| Temperatura prom. | 69,7 °C (65–71) | **69,6 °C** (58–71) | = |
| VRAM prom. | 6.178 MB (6.153–6.237) | **5.798 MB** (5.692–5.939) | **−380 MB (−6,2%)** |
| Clocks SM prom. | 1.758 MHz | 1.773 MHz (1.665–1.935) | = |

→ **VRAM −380 MB**: `num_ctx` 4.096→2.048 reduce el KV-cache — libera
espacio que habilitaría `OLLAMA_NUM_PARALLEL` (slots de contexto).
Potencia/temperatura/utilización **idénticas**: la GPU sigue power-limited
en TDP mientras infiere — el tuning no baja la potencia instantánea, solo
reduce trabajo por llamada cuando recorta generación.

→ **Estabilidad térmica a 21,5 min sostenidos**: temperatura plana en
~70 °C (mínima de ventana 58 °C = arranque), sin throttling. La carga
prolongada no degrada nada.

## Proceso Ollama (host)

| Métrica | Baseline | Nueva |
|---|---|---|
| RSS | 1.476–1.564 MB | 1.569–1.663 MB (+6%) |
| CPU | 114–115% | 30–97% |

RSS levemente mayor tras 21 min de corrida pero acotado; CPU del proceso
menor en promedio (muestreo más denso captura valles entre llamadas).

## Proyección del grafo real sobre este dataset

El script siempre hace 2 llamadas/artículo. Recorriendo el mismo dataset
con la lógica del grafo SPEC-12 (triage CV + aprobación por monto):

| Decisión del grafo | Artículos | % |
|---|---|---|
| Demanda por triage (CV < 0,3 → promedio histórico, **sin LLM**) | 473 / 500 | **94,6%** |
| Orden auto-aprobada (monto < $100 → justificación template, **sin LLM**) | 13 / 500 | 2,6% |
| Requiere aprobación (justificación LLM) | 487 / 500 | 97,4% |
| **Llamadas LLM que haría el grafo** | **~514 / 1.000** | **51,4%** |

→ Sobre este dataset sintético, el grafo real consumiría **~11 min** de
LLM vs los 21,5 medidos — **~2,1× menos GPU-segundos**. La palanca aquí es
el triage (las ventas sintéticas son de baja varianza por construcción);
la justificación condicional apenas aplica porque el set genera montos
altos ($32–$3.765, prom. $930).

⚠ **La mezcla es dependiente del dataset**: este set es demanda-estable +
monto-alto. Con datos reales las tasas de triage y auto-aprobación serán
otras — las proyecciones del análisis previo (60% auto-aprobación, 50%
demanda estable) eran hipótesis a medir, igual que estas.

## Hallazgos

1. **Throughput idéntico post-tuning** (23,2 art/min): `num_predict` no
   acelera la llamada típica porque las salidas ya estaban bajo el cap —
   su valor real es **matar outliers** (demanda p99: 2.317 → 1.007 ms).
2. **VRAM −380 MB** por ctx 2.048: el único recurso que sí liberó el
   tuning — headroom real para paralelismo futuro.
3. **Potencia/temperatura sin cambio**: confirma lo proyectado — el
   consumo instantáneo queda en TDP mientras haya trabajo; el ahorro es
   en GPU-segundos totales (llamadas evitadas), no en watts pico.
4. **Escalabilidad lineal verificada**: 5× artículos = 5,00× tiempo y
   ~5× tokens, percentiles estables, 0 errores en 1.000 llamadas,
   temperatura plana en 21,5 min sostenidos.
5. **Estadística más sólida**: n=500 por tipo (vs n=100) + 245 muestras
   GPU (vs 17) — las colas medidas ahora son representativas.
6. **El beneficio grande de SPEC-12 es estructural, no de runtime**: el
   mismo trabajo por llamada, pero el grafo hace ~la mitad de las
   llamadas sobre un dataset como éste.

## Reproducir

```bash
cd harness-langgraph
node scripts/stress-llm.mjs \
  --articulos 500 \
  --concurrencia 1 \
  --muestra-cada 25 \
  --salida docs/benchmarks/stress-qwen3-8b-500-2026-11-11.jsonl \
  --reporte docs/benchmarks/stress-qwen3-8b-500-2026-11-11.json
# GPU en paralelo (muestreo 5 s):
nvidia-smi --query-gpu=timestamp,utilization.gpu,power.draw,temperature.gpu,memory.used,clocks.sm \
  --format=csv,noheader -l 5
```

> `.jsonl` por artículo es efímero (gitignored). En el repo persisten el
> `.json` agregado y este `.md`.
