# ¿Qué es este proyecto? — Explicación a alto nivel

`harness-langgraph` es un **agente autónomo de reposición de
inventario** para Mercado Raíz. Es una demo didáctica que combina
dos piezas con nombres parecidos pero roles distintos:

- **LangGraph** → decide *qué hace* el agente (el recorrido).
- **Harness** → decide *cómo se gobierna* esa ejecución (el supervisor).

En una frase: **el agente detecta productos con stock bajo, pide al
LLM que estime la demanda (saltándolo cuando las ventas son
estables), calcula cuánto comprar, crea las órdenes de compra y
termina — las que superan los $100 quedan pendientes en el sistema
y el humano las aprueba desde el dashboard, sin que el agente
tenga que esperar despierto (SPEC-12).**

---

## ¿Qué es LangGraph y qué hace acá?

LangGraph es una librería (de LangChain) para construir agentes
como **máquinas de estados**, no como un script lineal ni un loop
de "preguntarle al LLM qué sigue".

En `src/langgraph/` el agente se define así:

- **Nodos** (`nodes/`): cada paso del trabajo, una función.
  Ej: `leer-inventario`, `analizar-demanda`, `crear-orden`.
- **Edges** (`edges/router.js`): las conexiones entre pasos.
  Algunos son fijos ("siempre después de A va B") y otros
  condicionales ("si hay órdenes pendientes, pasá por notificar").
- **Estado** (`state.js`): un objeto compartido que pasa de nodo
  en nodo — es la "memoria" de la corrida.
- **Checkpoints**: después de cada nodo, LangGraph persiste el
  estado en `checkpoints.sqlite` — la corrida queda auditable paso
  a paso y la infraestructura de pausa/reanudación queda disponible
  (SPEC-12: el flujo actual es atómico y no la usa).

El recorrido completo del grafo:

```
leer-inventario → analizar-demanda → calcular-cantidad
  → decidir-aprobacion → generar-analisis → crear-orden
  → ¿hay órdenes que necesitan aprobación?
      ├─ no  → fin
      └─ sí  → notificar → fin   (las pendientes esperan en la DB)
```

Optimizaciones SPEC-12 dentro de este recorrido:

- `analizar-demanda`: si el CV de las ventas < `UMBRAL_CV` la
  demanda se estima por promedio histórico — el LLM solo ve los
  patrones volátiles.
- `decidir-aprobacion` corre **antes** de `generar-analisis`: la
  justificación en prosa solo se genera para las órdenes que el
  humano va a revisar; las auto-aprobadas llevan un template.

Idea clave: **el LLM estima, el código decide**. El modelo solo se
usa donde aporta criterio (estimar demanda, redactar la
justificación); las reglas de negocio (umbrales, fórmulas) son
código determinista.

---

## ¿Qué es el Harness y qué hace acá?

"Harness" (arnés/correa de seguridad) es la capa de
**orquestación y gobierno** que envuelve al grafo. No sabe nada de
inventario ni de negocio: sabe de *ejecutar procesos de forma
confiable*. Vive en `src/harness/`:

| Pieza | Qué hace |
|---|---|
| `orchestrator.js` | Ejecuta el grafo y reporta el ciclo de vida de la corrida (conserva la capacidad de reanudar checkpoints pausados de corridas viejas). |
| `server.js` | Servidor Express en el puerto **4110** — la única puerta de entrada del mundo exterior al agente. |
| `monitor.js` | Imprime cada transición del grafo en consola — ves al agente "moverse" en vivo. |
| `error-handler.js` | Reintentos con backoff ante fallas transitorias. |
| `cost-tracker.js` | Cuenta tokens y tiempos de inferencia del LLM por llamada — modelo, duraciones en ms (con un modelo pago, los tokens serían la factura). |
| `metrics.js` | Duración de corrida, llamadas al LLM, fallbacks y contadores de negocio (productos evaluados, órdenes creadas/pausadas, errores). |
| `analisis-cache.js` | Cache incremental (SPEC-16): hash del input por producto → demanda y justificación reusadas entre corridas (`data/analisis-cache.json`). |

Además el servidor es lo que mantiene vivo el proceso entre
corridas: el grafo termina, pero `/status`, `/metrics` y `/run`
siguen respondiendo para consultas o una nueva ejecución.

---

## ¿Cuál es el recorrido para comunicarse con el agente?

### Las 4 piezas que tienen que estar corriendo

```bash
# terminal 1 — backend MVC (puerto 4000)
npm run api

# terminal 2 — frontend / dashboard (puerto 5173)
npm run dev

# terminal 3 — LLM local Ollama (puerto 11434)
~/ollama/bin/ollama serve

# terminal 4 — el agente (puerto 4110)
npm run agente          # desde la raíz; o cd harness-langgraph && npm run agente
```

### El flujo, paso a paso

```
┌────────┐         ┌──────────┐        ┌───────────┐       ┌────────┐
│ Humano │         │ Frontend │        │  Backend  │       │ Agente │
│  (vos) │         │  :5173   │        │   :4000   │       │ :4110  │
└───┬────┘         └────┬─────┘        └─────┬─────┘       └───┬────┘
    │                   │                    │               │
    │  (opcional) POST /run ───────────────────────────────▶  │ arranca corrida
    │                   │                    │               │ (npm run agente ya la dispara solo)
    │                   │                    │               │
    │                   │               GET /api/productos ◀─│ leer-inventario
    │                   │                    │               │ ... LLM ... crear-orden
    │                   │               POST /api/ordenes/batch ◀──│ crea órdenes
    │                   │                    │               │
    │                   │                    │               │ ✅ TERMINA (atómica)
    │                   │                    │               │   las pendientes quedan
    │                   │                    │               │   PENDIENTE_APROBACION en la DB
    │                   │                    │               │
    │  abre :5173 ─────▶│                    │               │
    │  aprueba/rechaza  │                    │               │
    │                   │  POST /api/ordenes/:id/aprobar ──▶ │ persiste decisión — FIN
    │                   │                    │               │   (nada vuelve al agente)
    │                   │                    │               │
    │  GET /status ────────────────────────────────────────▶ │ fase actual
    │  GET /metrics ───────────────────────────────────────▶ │ negocio + LLM
```

En criollo, la conversación es:

1. **Arrancar**: `npm run agente` levanta el servidor en :4110 y
   dispara una corrida nueva automáticamente. (También se puede
   disparar otra después con `POST :4110/run`.)
2. **El agente trabaja solo**: lee productos del backend por HTTP,
   consulta al LLM local, crea órdenes en el backend.
3. **El agente cierra**: las órdenes que requieren aprobación
   (≥ $100) quedan `PENDIENTE_APROBACION` en la base — la corrida
   termina sin esperar a nadie (SPEC-12).
4. **El humano actúa cuando quiere**: aprueba/rechaza desde el
   dashboard (:5173). **Nunca habla con el agente** — la decisión
   se guarda en la base del backend, que es la fuente de verdad,
   y ahí termina el circuito.
5. **Cierre**: `fin` imprime el resumen. El servidor queda
   escuchando para consultas (`/status`, `/metrics`) o una nueva
   corrida (`/run`).

### Los 4 endpoints — el "idioma" para hablarle al agente

| Endpoint | Para qué |
|---|---|
| `POST http://localhost:4110/run` | Disparar una corrida nueva (409 si ya hay una en curso) |
| `POST http://localhost:4110/resume` | Compat con checkpoints pausados viejos — 409 si no hay pausa (el grafo ya no emite interrupts) |
| `GET http://localhost:4110/status` | Ver en qué fase está: `corriendo`, `terminado` (`pausado` queda para corridas viejas) |
| `GET http://localhost:4110/metrics` | Contrato SPEC-10: `estado_corrida`, `resumen_ejecucion` (contadores de negocio + `mensaje_sistema`), `rendimiento_llm` (tokens y tiempos ms — `null` si no se usó el LLM), `errores_no_criticos` |

### Detalle fino: por qué el humano no habla con el agente

Es una decisión de diseño deliberada: **la aprobación vive en el
backend** (es el sistema real, la fuente de verdad). El agente no
necesita enterarse de la decisión — su trabajo terminó al crear la
orden; resolverla es una operación de negocio, no del grafo. Por
eso SPEC-12 pudo eliminar la pausa sin mover la verdad de lugar:
ya estaba en el backend.

---

## Mapa rápido del código

```
harness-langgraph/
├── src/
│   ├── index.js            → entrypoint: config → grafo → server → corrida
│   ├── config/             → .env, conexión a Ollama
│   ├── harness/            → EL SUPERVISOR (server, orchestrator, metrics...)
│   ├── langgraph/          → LA MÁQUINA DE ESTADOS
│   │   ├── graph.js        → arma el grafo: nodos + edges + checkpoints
│   │   ├── state.js        → el estado compartido entre nodos
│   │   ├── nodes/          → un archivo por paso del proceso
│   │   ├── edges/router.js → los "if" del recorrido
│   │   └── prompts/        → lo que se le pide al LLM
│   ├── integrations/       → clientes HTTP para hablar con el backend :4000
│   └── utils/              → logger, parser de JSON del LLM, concurrencia.js (pool con límite)
├── checkpoints.sqlite      → estado persistido tras cada nodo (auditoría / compat resume)
├── .last-thread            → thread_id de la última corrida (gitignored, SPEC-15)
├── data/                   → analisis-cache.json (cache de análisis, gitignored)
└── docs/                   → arquitectura.md, flujo-datos.md, flujo-ejecucion.md, prompts.md, benchmarks/
```
