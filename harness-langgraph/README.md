# harness-langgraph — Agente de reposición inteligente

Demo didáctica de **LangGraph** (máquina de estados para agentes) +
una capa de **orquestación estilo Harness** (monitoreo, reintentos,
costos, human-in-the-loop), corriendo sobre el backend MVC de
Mercado Raíz con un **LLM local** (Ollama + llama3.2:1b).

## Qué hace el agente

Detecta productos con stock bajo → analiza su demanda con el LLM →
calcula cuánto reponer → crea las órdenes de compra en el backend →
si alguna supera $100, **se pausa y espera que un humano apruebe**
desde el dashboard → al recibir la señal, **retoma exactamente donde
quedó** y cierra la corrida.

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

Cuando el agente pause en `esperar-aprobacion`:

1. Abrí http://localhost:5173 → aprobá o rechazá la orden pendiente.
2. **El backend dispara `POST :4110/resume` solo** (ver
   `server/harness-notify.js`) — el grafo despierta, re-lee las
   órdenes y sigue: si quedan pendientes vuelve a pausar, si no,
   termina. Aprobar/rechazar varias seguidas también funciona —
   las señales se encolan.
3. `curl http://localhost:4110/metrics` → métricas de la corrida: negocio + rendimiento del LLM (tokens, tiempos en ms).

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
`OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `HARNESS_PORT`, `UMBRAL_APROBACION`.

## Notas de diseño (para contar en la presentación)

- **El LLM estima, el código decide**: la demanda la estima el
  modelo; la cantidad exacta la calcula una fórmula determinista.
- **Fallbacks**: si el LLM responde mal, el nodo usa un plan B
  (promedio histórico / template) y registra el error — la corrida
  no muere.
- **Checkpoints**: la pausa humana persiste en `checkpoints.sqlite`
  — el proceso puede morir y la corrida se reanuda igual.
- **Umbral duplicado a propósito**: el agente decide
  `requiere_aprobacion` (demo del agente decidiendo) y el backend
  re-deriva la misma regla como red de seguridad
  (`UMBRAL_APROBACION` en `server/models/ordenes.model.js`).
