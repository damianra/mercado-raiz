# Validación del grafo real — `llm_evitadas` medido (2026-11-11)

Medición de las optimizaciones de SPEC-12 (triage CV + justificación
condicional) sobre el **grafo completo** contra el backend real — a
diferencia del stress script (que invoca los nodos LLM directamente y
siempre hace 2 llamadas/artículo), acá el grafo decide por producto si
usa el LLM. Corrida: `run-1794384065546` vía `POST /run` del harness.

## Dataset semilla (efímero — insertado y luego eliminado de la DB)

100 productos sintéticos (sku `BENCH001`–`BENCH100`, `stock_actual <
stock_minimo`) + 700 filas `historial_stock` tipo VENTA (7 días c/u),
diseñados por cuadrante para ejercitar cada rama del grafo:

| Cuadrante | N | Ventas | Monto esperado | Llamadas LLM esperadas |
|---|---|---|---|---|
| Estable + bajo | 15 | CV ≈ 0,08–0,11 → triage | < $100 → template | 0 |
| Estable + alto | 35 | CV ≈ 0,08 → triage | ≥ $100 → LLM justif. | 35 |
| Volátil + bajo | 15 | CV ≈ 0,59 → LLM | < $100 → template | 15 |
| Volátil + alto | 35 | CV ≈ 0,59 → LLM | ≥ $100 → LLM justif. | 70 |

Proyección: 120/200 llamadas (60%), 80 evitadas (40%).

## Resultado (`GET /metrics` post-corrida)

| Métrica | Proyectado | **Medido** |
|---|---|---|
| Productos evaluados | ~100 | **101** (99 BENCH + 2 originales) |
| Llamadas LLM posibles | 200 | 202 |
| Llamadas LLM reales | 120 (60%) | **137 (68%)** |
| `llm_evitadas` | 80 (40%) | **65 (32%)** |
| Órdenes creadas | ~100 | **60** (47 pendientes + 12 auto + 1 original) |
| Fallbacks / errores LLM | 0 | **0 / 0** |
| Tokens (in / out) | — | 26.266 / 10.260 |
| Duración | ~3 min | **~5,2 min** |

**Desglose de las 65 evitadas**: ~50 por triage CV (los 50 productos
estables saltaron el LLM — el mecanismo funciona en el flujo real) +
~15 por justificación template (órdenes auto-aprobadas).

**Por qué la realidad bajó del 40% al 32%**: el LLM estimó demandas más
altas que el promedio en los volátiles → `cantidad` mayor → más órdenes
cruzaron el umbral de $100 (86 pendientes vs 70 proyectadas) → más
justificaciones LLM. La varianza del estimador importa tanto como el
triage.

## GPU durante la corrida (nvidia-smi @5s, 34 muestras de carga)

| Métrica | prom | max |
|---|---|---|
| Utilización | 93,7% | 97% |
| Potencia | 196,3 W | 200,1 W |
| Temperatura | 68,7 °C | 71 °C |
| VRAM | 5.876 MB | 5.925 MB |

Mismo patrón del stress: TDP-limited, térmicamente estable.

## Hallazgo: rate limiting mata órdenes (→ SPEC-13)

El limiter del backend (`server/security.js`: 20 escrituras/min/IP)
**rechazó 41 `POST /api/ordenes`** con 429. El nodo `crear-orden` no
reintenta → esos productos hicieron todo el trabajo LLM (demanda +
justificación) pero **la orden nunca se persistió**. Los 41 errores
quedaron en `errores_no_criticos` ("demasiadas solicitudes").

Impacto en la medición: el % de llamadas evitadas no se afecta (la
decisión LLM ocurrió igual), pero **~41 llamadas de justificación
produjeron texto que se descartó** — GPU-segundos perdidos. SPEC-13
documenta el fix (Retry-After + retry con backoff + política del
limiter para cliente interno).

## Lectura final

- **El ahorro estructural existe y se midió: 32% menos llamadas LLM**
  en una corrida real (~1,5× menos GPU-segundos que el flujo viejo).
- El triage CV es la palanca que más rinde en demandas estables;
  la justificación condicional depende de la distribución de montos.
- El siguiente cuello de botella no es el LLM sino el **rate limiter**
  para lotes > ~20 productos/min (SPEC-13).
- Dataset efímero: los 100 productos/700 ventas/59 órdenes BENCH se
  eliminaron post-medición — la DB quedó con sus 11 productos y 44
  órdenes originales.
