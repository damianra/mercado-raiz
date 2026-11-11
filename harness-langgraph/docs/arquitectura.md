# Arquitectura — qué es cada capa y por qué existe

## El problema que resuelve

Queremos un agente que reponga inventario solo. "Un script que
llama al LLM" funcionaría… hasta que algo falla, hasta que hay que
coordinar con el humano que aprueba, hasta que querés saber qué
pasó. La arquitectura separa tres preocupaciones:

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
│ Corre atómica — el humano actúa por REST afuera.   │
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

Un agente es un proceso con pasos y ramas. LangGraph lo
modela literalmente así: **nodos** = funciones, **edges** = qué
sigue, **estado** = objeto compartido que cada nodo actualiza.
Tres beneficios concretos:

1. **Checkpointing**: cada paso se persiste → una corrida es
   auditable y la infraestructura de pausa/reanudación queda
   disponible si un flujo futuro la necesita (SPEC-12: hoy la
   corrida es atómica).
2. **Observabilidad gratis**: el grafo emite un evento por nodo →
   el monitor muestra el recorrido en vivo.
3. **Cambios locales**: agregar un paso = agregar un nodo + un
   edge, sin tocar los demás.

## Los nodos y quién "piensa" en cada uno

| Nodo | Piensa con | Qué hace |
|---|---|---|
| leer-inventario | código | trae productos bajos/críticos del backend |
| analizar-demanda | **LLM** (condicional) | estima demanda desde ventas; triage por CV: estables → promedio sin LLM (SPEC-12) |
| calcular-cantidad | código | fórmula: cubrir demanda × (lead time + 7 días) |
| decidir-aprobacion | código | regla: monto ≥ umbral → requiere humano |
| generar-analisis | **LLM** (condicional) | prosa solo si requiere_aprobacion; auto-aprobadas → template (SPEC-12) |
| crear-orden | código | POST /api/ordenes por cada producto |
| notificar | código (stub) | avisaría al aprobador — acá solo loguea |
| fin | código | resumen + KPIs del dashboard |

(SPEC-12: se eliminaron `esperar-aprobacion` con su `interrupt` y
`procesar-decision` — el grafo es atómico; orden actual:
calcular → decidir → generar para decidir antes de redactar.)

## El harness, pieza por pieza

| Archivo | Qué hace | Por qué existe |
|---|---|---|
| `orchestrator.js` | ejecuta el grafo y reporta el ciclo de vida | un solo lugar conoce el thread_id |
| `server.js` | GET /status, /metrics (contrato SPEC-10); POST /run; POST /resume (compat con checkpoints pausados viejos) | la puerta de entrada del mundo exterior |
| `monitor.js` | imprime cada transición del grafo | ver el agente "moverse" durante la demo |
| `error-handler.js` | retry con backoff | fallas transitorias (429, timeout) no matan la corrida |
| `cost-tracker.js` | acumula tokens, duraciones (ns→ms) y modelo del LLM por llamada | con un modelo hosted esto ES la factura |
| `metrics.js` | duración, llamadas, fallbacks + contadores de negocio (productos, órdenes, errores) | el "informe" que se muestra al final — el orchestrator lo alimenta con el estado del grafo |

## Human-in-the-loop, cómo está cableado (SPEC-12)

El humano ya no está *dentro* del grafo — la aprobación es
desacoplada:

1. El grafo corre atómico: crea las órdenes, marca las ≥ umbral
   como `PENDIENTE_APROBACION`, notifica y termina.
2. El humano actúa en el sistema real cuando quiere:
   aprueba/rechaza en el dashboard → `POST /api/ordenes/:id/aprobar`
   → el backend persiste el estado. **Fin del circuito.**

La fuente de verdad sigue siendo el backend (siempre lo fue — con
el interrupt el grafo solo releía lo que el backend ya había
escrito). Eliminar la pausa simplifica el ciclo de vida: no hay
corridas dormidas, no hay proceso reteniendo estado, no hay señal
que pueda perderse. El costo: el resumen de la corrida ya no
incluye cómo resolvió el humano — esa información vive donde
corresponde, en las órdenes.
