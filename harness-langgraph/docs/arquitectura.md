# Arquitectura — qué es cada capa y por qué existe

## El problema que resuelve

Queremos un agente que reponga inventario solo. "Un script que
llama al LLM" funcionaría… hasta que algo falla, hasta que hay que
pausar para un humano, hasta que querés saber qué pasó. La
arquitectura separa tres preocupaciones:

```
┌────────────────────────────────────────────────────┐
│ HARNESS (src/harness/)                             │
│ El supervisor. No sabe de inventario; sabe de      │
│ ejecutar procesos: monitorea, reintenta, mide      │
│ costos, expone HTTP para control externo.          │
└──────────────────┬─────────────────────────────────┘
                   │ ejecuta y observa
┌──────────────────┴─────────────────────────────────┐
│ LANGGRAPH (src/langgraph/)                         │
│ La máquina de estados. Define QUÉ hace el agente:  │
│ nodos (pasos), edges (rumbo), estado (memoria).    │
│ Puede pausarse (interrupt) y reanudarse (Command). │
└──────────────────┬─────────────────────────────────┘
                   │ llama por HTTP
┌──────────────────┴─────────────────────────────────┐
│ BACKEND MVC (server/ del proyecto)                 │
│ El sistema real: Express + SQLite. Productos,      │
│ órdenes, historial de ventas, dashboard. El agente │
│ es un cliente más — no toca la base directamente.  │
└────────────────────────────────────────────────────┘
```

## Por qué LangGraph y no "un loop con ifs"

Un agente es un proceso con pasos, ramas y pausas. LangGraph lo
modela literalmente así: **nodos** = funciones, **edges** = qué
sigue, **estado** = objeto compartido que cada nodo actualiza.
Tres beneficios concretos:

1. **Checkpointing**: cada paso se persiste → la pausa humana no
   depende de que el proceso siga vivo.
2. **Observabilidad gratis**: el grafo emite un evento por nodo →
   el monitor muestra el recorrido en vivo.
3. **Cambios locales**: agregar un paso = agregar un nodo + un
   edge, sin tocar los demás.

## Los nodos y quién "piensa" en cada uno

| Nodo | Piensa con | Qué hace |
|---|---|---|
| leer-inventario | código | trae productos bajos/críticos del backend |
| analizar-demanda | **LLM** | estima demanda diaria y tendencia desde ventas |
| calcular-cantidad | código | fórmula: cubrir demanda × (lead time + 7 días) |
| generar-analisis | **LLM** | redacta la justificación para el aprobador |
| decidir-aprobacion | código | regla: monto ≥ umbral → requiere humano |
| crear-orden | código | POST /api/ordenes por cada producto |
| notificar | código (stub) | avisaría al aprobador — acá solo loguea |
| esperar-aprobacion | **interrupt** | congela el grafo hasta la señal humana |
| procesar-decision | código | relee las órdenes y clasifica el resultado |
| fin | código | resumen + KPIs del dashboard |

## El harness, pieza por pieza

| Archivo | Qué hace | Por qué existe |
|---|---|---|
| `orchestrator.js` | ejecuta el grafo, detecta pausas, reanuda | un solo lugar conoce el thread_id y el ciclo de vida |
| `server.js` | GET /status, /metrics; POST /resume, /run | la puerta de entrada del mundo exterior (el humano) |
| `monitor.js` | imprime cada transición del grafo | ver el agente "moverse" durante la demo |
| `error-handler.js` | retry con backoff | fallas transitorias (429, timeout) no matan la corrida |
| `cost-tracker.js` | acumula tokens del LLM | con un modelo hosted esto ES la factura |
| `metrics.js` | duración, llamadas, fallbacks | el "informe" que se muestra al final |

## Human-in-the-loop, cómo está cableado

1. `esperar-aprobacion` llama a `interrupt(payload)` → LangGraph
   guarda el estado completo en `checkpoints.sqlite` y corta la
   ejecución.
2. El humano actúa en el sistema real: aprueba/rechaza la orden en
   el dashboard (`POST /api/ordenes/:id/aprobar`).
3. **El propio backend dispara la reanudación**: tras persistir la
   decisión, `server/harness-notify.js` hace `POST :4110/resume`
   (fire-and-forget — la aprobación nunca falla si el agente está
   apagado). El harness re-ejecuta el grafo desde el checkpoint
   con `Command({resume: payload})`. Si llegan varias señales en
   ráfaga, se encolan y se procesan en cadena.
4. `procesar-decision` relee las órdenes: las resueltas cierran,
   las pendientes vuelven a `esperar-aprobacion` (loop del grafo).

La decisión clave: **la aprobación vive en el backend** (fuente de
verdad), el resume del grafo es solo la señal de "ya podés mirar".
Así el agente nunca tiene que confiar en que la UI le dijo la
verdad — relee el estado real.
