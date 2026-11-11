# ¿Qué es este proyecto? — Explicación a alto nivel

`harness-langgraph` es un **agente autónomo de reposición de
inventario** para Mercado Raíz. Es una demo didáctica que combina
dos piezas con nombres parecidos pero roles distintos:

- **LangGraph** → decide *qué hace* el agente (el recorrido).
- **Harness** → decide *cómo se gobierna* esa ejecución (el supervisor).

En una frase: **el agente detecta productos con stock bajo, pide al
LLM que estime la demanda, calcula cuánto comprar, crea las órdenes
de compra y —si alguna supera los $100— se pausa hasta que un
humano la apruebe desde el dashboard; entonces retoma exactamente
donde quedó y termina la corrida.**

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
  condicionales ("si quedan pendientes, volvé a esperar").
- **Estado** (`state.js`): un objeto compartido que pasa de nodo
  en nodo — es la "memoria" de la corrida.
- **Checkpoints**: después de cada nodo, LangGraph persiste el
  estado en `checkpoints.sqlite`. Esto es lo que permite que el
  agente se **pause** esperando al humano y se **reanude** después
  sin perder nada — incluso si el proceso muere en el medio.

El recorrido completo del grafo:

```
leer-inventario → analizar-demanda → calcular-cantidad
  → generar-analisis → decidir-aprobacion → crear-orden
  → ¿hay órdenes que necesitan aprobación?
      ├─ no  → fin
      └─ sí  → notificar → esperar-aprobacion ⏸ (se congela)
                 → procesar-decision
                 → ¿quedan pendientes? ↺ vuelve a pausar / fin
```

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
| `orchestrator.js` | Ejecuta el grafo, detecta cuándo quedó pausado (`interrupt`), lo reanuda con `Command({resume})`. Es el único que conoce el ciclo de vida de la corrida. |
| `server.js` | Servidor Express en el puerto **4110** — la única puerta de entrada del mundo exterior al agente. |
| `monitor.js` | Imprime cada transición del grafo en consola — ves al agente "moverse" en vivo. |
| `error-handler.js` | Reintentos con backoff ante fallas transitorias. |
| `cost-tracker.js` | Cuenta tokens y tiempos de inferencia del LLM por llamada — modelo, duraciones en ms (con un modelo pago, los tokens serían la factura). |
| `metrics.js` | Duración de corrida, llamadas al LLM, fallbacks y contadores de negocio (productos evaluados, órdenes creadas/pausadas, errores). |

Además el servidor tiene un rol sutil pero importante: **es lo que
mantiene vivo el proceso** mientras el grafo está congelado
esperando aprobación humana. Sin él, el agente pausado simplemente
moriría.

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
    │                   │               POST /api/ordenes ◀──│ crea órdenes
    │                   │                    │               │
    │                   │                    │               │ ⏸ PAUSA en esperar-aprobacion
    │                   │                    │               │   (estado guardado en checkpoints.sqlite)
    │                   │                    │               │
    │  abre :5173 ─────▶│                    │               │
    │  aprueba/rechaza  │                    │               │
    │                   │  POST /api/ordenes/:id/aprobar ──▶ │ persiste decisión
    │                   │                    │               │
    │                   │                    │  POST /resume ─▶ DESPIERTA
    │                   │                    │  (automático,  │ procesar-decision
    │                   │                    │   fire-and-    │ ↺ ¿quedan pendientes?
    │                   │                    │   forget)      │   sí → pausa otra vez
    │                   │                    │               │   no → fin ✅
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
3. **El agente se congela**: si creó órdenes que requieren
   aprobación (≥ $100), el nodo `esperar-aprobacion` corta la
   ejecución. El proceso sigue vivo solo para escuchar `/resume`.
4. **El humano actúa afuera del agente**: aprueba/rechaza desde el
   dashboard (:5173). **Nunca habla directo con el agente** — la
   decisión se guarda en la base del backend, que es la fuente de
   verdad.
5. **El backend avisa**: tras persistir la decisión,
   `server/harness-notify.js` hace `POST :4110/resume`
   (fire-and-forget). El orchestrator reanuda el grafo **desde el
   checkpoint**, `procesar-decision` relee las órdenes reales, y
   el loop se repite hasta que no queden pendientes.
6. **Cierre**: `fin` imprime el resumen. El servidor queda
   escuchando para consultas (`/status`, `/metrics`) o una nueva
   corrida (`/run`).

### Los 4 endpoints — el "idioma" para hablarle al agente

| Endpoint | Para qué |
|---|---|
| `POST http://localhost:4110/run` | Disparar una corrida nueva (409 si ya hay una en curso) |
| `POST http://localhost:4110/resume` | Despertar al agente pausado (lo dispara el backend solo) |
| `GET http://localhost:4110/status` | Ver en qué fase está: `corriendo`, `pausado`, `terminado` |
| `GET http://localhost:4110/metrics` | Contrato SPEC-10: `estado_corrida`, `resumen_ejecucion` (contadores de negocio + `mensaje_sistema`), `rendimiento_llm` (tokens y tiempos ms — `null` si no se usó el LLM), `errores_no_criticos` |

### Detalle fino: por qué el humano no habla con el agente

Es una decisión de diseño deliberada: **la aprobación vive en el
backend** (es el sistema real, la fuente de verdad). El `/resume`
no le dice al agente "aprobada" — solo le dice "ya podés mirar de
nuevo". El agente relee las órdenes desde el backend y saca sus
propias conclusiones. Así, la señal de reanudación nunca puede
mentirle sobre el estado del mundo.

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
│   └── utils/              → logger, parser de JSON del LLM
├── checkpoints.sqlite      → memoria persistente del grafo (la pausa)
├── .last-thread            → thread_id de la última corrida (para reanudar tras reinicio)
└── docs/                   → arquitectura.md, flujo-datos.md, prompts.md
```
