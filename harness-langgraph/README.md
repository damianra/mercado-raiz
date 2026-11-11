# harness-langgraph — Agente de reposición inteligente

Demo didáctica de **LangGraph** (máquina de estados para agentes) +
una capa de **orquestación estilo Harness** (monitoreo, reintentos,
costos, human-in-the-loop), corriendo sobre el backend MVC de
Mercado Raíz con un **LLM local** (Ollama + llama3.2:1b).

## Qué hace el agente

Detecta productos con stock bajo → analiza su demanda con el LLM
(triage heurístico: las ventas estables se estiman sin LLM, SPEC-12)
→ calcula cuánto reponer → crea las órdenes de compra en el backend
→ **termina**. Las que superan $100 quedan `PENDIENTE_APROBACION`:
el humano las aprueba/rechaza desde el dashboard por REST del
backend — el grafo ya no espera (aprobación desacoplada, SPEC-12).

## Cómo correr la demo (4 piezas)

```bash
# terminal 1 — backend MVC (:4000)
npm run api

# terminal 2 — frontend (:5173), para aprobar/rechazar órdenes
npm run dev

# terminal 3 — LLM local (:11434)
~/ollama/bin/ollama serve        # la primera vez: ~/ollama/bin/ollama pull llama3.2:1b

# terminal 4 — el agente (:4110)
npm run agente                   # desde la raíz, o cd harness-langgraph && npm run agente
```

Cuando el agente termina:

1. Abrí http://localhost:5173 → las órdenes `PENDIENTE_APROBACION`
   se listan en el dashboard → aprobá o rechazá desde ahí (REST del
   backend, el agente no participa).
2. `curl http://localhost:4110/metrics` → métricas de la corrida:
   negocio + rendimiento del LLM (tokens, tiempos en ms) +
   `llm_evitadas` (triage + justificación condicional).

## Mapa del código

| Carpeta | Rol | En criollo |
|---|---|---|
| `src/langgraph/` | la máquina de estados | "el recorrido que hace el agente" |
| `src/langgraph/nodes/` | cada paso del proceso | "una estación de trabajo" |
| `src/langgraph/edges/` | decisiones de rumbo | "los if/else del recorrido" |
| `src/langgraph/state.js` | estado compartido | "la carpeta que pasa de mano en mano" |
| `src/harness/` | orquestación y gobierno | "el supervisor del agente" |
| `src/integrations/` | cliente HTTP del backend | "cómo el agente toca el mundo real" |
| `src/config/` | env + conexión LLM | "los enchufes" |

Detalles en `docs/`: `arquitectura.md`, `flujo-datos.md`,
`flujo-ejecucion.md` (traza paso a paso), `prompts.md`.

## Configuración

Ver `.env.example` (copiado a `.env`): `BACKEND_URL`,
`OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `HARNESS_PORT`, `UMBRAL_APROBACION`,
`UMBRAL_CV` (triage heurístico — SPEC-12), `AGENTE_CONCURRENCIA`
(default 3 — tareas en vuelo por nodo LLM, SPEC-16),
`DEMANDA_BATCH` (default 5 — productos volátiles por llamada de
demanda; los que el modelo omita o devuelva inválidos caen a
llamada individual — SPEC-16).

Runtime del LLM (`src/config/ollama.js`): `numCtx: 2048` y
`numPredict` acotado por instancia — los prompts usan ~250 tokens y
las salidas ~100-160, holgura innecesaria solo gasta KV-cache. La
instancia de lote (`llmJsonBatch`, demanda por lotes) escala
`numPredict`/`numCtx` con `DEMANDA_BATCH`.

Paralelismo: los nodos que iteran productos llamando al LLM
(`analizar-demanda`, `generar-analisis`) procesan hasta
`AGENTE_CONCURRENCIA` items en vuelo (`utils/concurrencia.js` —
worker pool). **Lado cliente no alcanza**: `OLLAMA_NUM_PARALLEL`
es variable del proceso `ollama serve` (no del agente) y debe ser
>= `AGENTE_CONCURRENCIA` — sin eso Ollama encola las requests y el
paralelismo casi no gana tiempo. Con el modelo actual
(8B ≈ 6,2 GB VRAM + ~0,3 GB/seq de KV-cache a ctx 2048) un valor de
3-4 entra en 8 GB de VRAM.

## Notas de diseño (para contar en la presentación)

- **El LLM estima, el código decide**: la demanda la estima el
  modelo; la cantidad exacta la calcula una fórmula determinista.
- **Fallbacks**: si el LLM responde mal, el nodo usa un plan B
  (promedio histórico / template) y registra el error — la corrida
  no muere.
- **Aprobación desacoplada** (SPEC-12): el grafo es atómico — las
  pendientes esperan en la DB y se resuelven por REST. El
  checkpointer sigue escribiendo `checkpoints.sqlite` tras cada
  nodo (infra disponible, sin uso por el flujo actual).
- **Umbral duplicado a propósito**: el agente decide
  `requiere_aprobacion` (demo del agente decidiendo) y el backend
  re-deriva la misma regla como red de seguridad
  (`UMBRAL_APROBACION` en `server/models/ordenes.model.js`).
