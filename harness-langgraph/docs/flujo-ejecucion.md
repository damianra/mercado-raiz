# Flujo de ejecución — paso a paso, ejecución por ejecución

Traza completa de una corrida del agente: qué hace cada pieza, qué
sale por consola, qué viaja por HTTP y cómo cambia el estado del
grafo en cada paso.

Convención del grafo: **un nodo no decide qué sigue — solo devuelve
una actualización parcial del estado**. El rumbo lo deciden los
edges de `graph.js` (fijos) y los routers de `edges/router.js`
(condicionales). Después de cada nodo, LangGraph aplica el reducer
del campo y persiste un **checkpoint en `checkpoints.sqlite`**.

---

## Ejecución 0 — Arranque del proceso (`npm run agente`)

Todavía no corre el grafo: esto es setup.

```
index.js
  ├─ orchestrator.inicializar()
  │    ├─ construirGrafo()          → compila StateGraph + SqliteSaver(checkpoints.sqlite)
  │    └─ lee .last-thread          → ¿hay un thread_id de una corrida anterior?
  │          └─ estaPausado(threadId) → grafo.getState() → ¿tiene nodos pendientes?
  │                sí → corrida = { fase: 'pausado' }   (recupera una pausa de otra vida)
  │                no → corrida = { fase: 'idle' }
  │
  ├─ iniciarServidor()              → Express en :4110
  │     GET /status · GET /metrics · POST /run · POST /resume*
  │     * /resume queda solo para compat con corridas pausadas
  │       viejas (SPEC-12: el grafo ya no emite interrupts — sin
  │       pausa responde 409)
  │     ← este proceso queda vivo por el servidor, no por el grafo
  │
  └─ orchestrator.iniciar()
       ├─ threadId = "run-1714…"    → lo guarda en .last-thread
       ├─ corrida.fase = 'corriendo'
       ├─ metrics.iniciarCorrida() + costTracker.reset()
       └─ ejecutar(threadId, {})    → grafo.stream(input, {configurable:{thread_id}, streamMode:'updates'})
```

Consola:

```
═══ MERCADO RAÍZ — Agente de reposición (LangGraph + Harness) ═══
Backend: http://localhost:4000 | LLM: llama3.2:1b @ http://localhost:11434
harness escuchando en http://localhost:4110
═══ 🚀 CORRIDA run-1714… ═══
```

El `stream` en modo `updates` emite **un evento por cada nodo que
termina**: `{ nombreDelNodo: {campos que escribió} }`. El monitor
los consume en vivo y `metrics` anota tiempos.

---

## Ejecución 1 — Corrida inicial, nodo por nodo

Escenario de ejemplo: 2 productos bajos → 2 órdenes → 1 supera $100.

### Nodo 1 · `leer-inventario` (código, sin LLM)

| | |
|---|---|
| **Lee del estado** | nada |
| **Llama** | `GET :4000/api/productos?estado=STOCK_BAJO` y `?estado=CRITICO` |
| **Devuelve** | `{ productosBajos: [prod1, prod2] }` |
| **Reducer** | `listaVacia` → reemplaza `[]` por la lista |
| **Edge** | fijo → `analizar-demanda` (siempre, haya 0 o 50 productos) |

```
▶ nodo "leer-inventario" terminó (85ms) → estado: productosBajos
```

### Nodo 2 · `analizar-demanda` (**LLM**)

| | |
|---|---|
| **Lee** | `productosBajos` |
| **Por cada producto** | `GET /api/historial?producto_id=N&tipo=VENTA` → **triage** (`SPEC-12`): si `CV(ventas) < UMBRAL_CV` → promedio histórico directo, sin LLM (`llm_evitadas+1`) → **cache** (`SPEC-16`): hash del input ya visto → respuesta reusada (`cache_hits+1`) · si no → queda pendiente → **lote** (`SPEC-16`): hasta `DEMANDA_BATCH` por llamada `llmJsonBatch` → array validado item a item, matcheo por `producto_id` → `costTracker.registrar(r)` |
| **Si el lote omite/falla items** | esos productos caen a `llmJson.invoke(prompt individual)` — el lote que falla entero degrada completo |
| **Si el LLM falla ×2** | fallback: promedio histórico + string en `errores` |
| **Devuelve** | `{ analisisPorProducto: {1:{…}, 2:{…}}, hashPorProducto: {1:"…"}, errores: [] }` |
| **Reducer** | `mergeObjeto` → fusiona las claves por producto; `acumulativo` concatena errores |
| **Edge** | fijo → `calcular-cantidad` |

### Nodo 3 · `calcular-cantidad` (código)

| | |
|---|---|
| **Lee** | `productosBajos` + `analisisPorProducto` |
| **Cuenta** | `cantidad = max(demanda×(lead+7) − stock, 2×mínimo − stock, 1)`; `monto = cantidad × precio` |
| **Devuelve** | `{ decisionPorProducto: {1:{cantidad,monto_total}, 2:{…}} }` |
| **Edge** | fijo → `decidir-aprobacion` (SPEC-12: decide antes de redactar) |

### Nodo 4 · `decidir-aprobacion` (código, regla de negocio)

| | |
|---|---|
| **Lee** | `decisionPorProducto[].monto_total` |
| **Regla** | `monto >= UMBRAL_APROBACION` ($100, `.env`) → `requiere_aprobacion: true` |
| **Devuelve** | `{ decisionPorProducto: {…, requiere_aprobacion} }` |
| **Edge** | fijo → `generar-analisis` |

### Nodo 5 · `generar-analisis` (**LLM condicional** — SPEC-12)

| | |
|---|---|
| **Lee** | `productosBajos`, `analisisPorProducto`, `decisionPorProducto` |
| **Por cada producto** | si `requiere_aprobacion` → `llm.invoke(prompt)` → prosa → `analisis_ia` (≤1900 chars; <20 → retry) · si no (auto-aprobada) → template determinista + marca `(estimación automática)` (`llm_evitadas+1`) |
| **Si falla ×2** | template con los mismos datos + error |
| **Devuelve** | `{ decisionPorProducto: {…, analisis_ia}, errores }` |
| **Edge** | fijo → `crear-orden` |

La prosa solo la lee un humano cuando la orden queda pendiente —
generarla para las auto-aprobadas era el 66% del tiempo de GPU
(benchmark SPEC-11).

### Nodo 6 · `crear-orden` (código, toca el mundo)

| | |
|---|---|
| **Lee** | `productosBajos` + `decisionPorProducto` |
| **Por cada lote** | `POST :4000/api/ordenes/batch` (SPEC-16) — hasta 100 órdenes/request en una transacción; si el lote falla → fallback `POST /api/ordenes` por producto |
| **Devuelve** | `{ ordenesCreadas: [orden…], ordenesPendientes: ["OC-101"], errores }` — pendientes = las que el backend dejó en `PENDIENTE_APROBACION` |
| **Edge** | **condicional** → `despuesDeCrearOrdenes(state)` |

Acá ocurre la primera **decisión de rumbo**:

```js
state.ordenesPendientes.length > 0 ? 'notificar' : 'fin'
```

- Si ninguna orden quedó pendiente → directo a `fin`, corrida corta.
- En nuestro ejemplo `OC-101` ≥ $100 → va a `notificar`.

### Nodo 7 · `notificar` (stub)

Devuelve `{}` — solo loguea las pendientes. Edge fijo → `fin`.

### Nodo 8 · `fin` → `END`

Lee `ordenesCreadas`, `ordenesPendientes`, `errores`; pide
`GET /api/dashboard/stats`; devuelve `{}`. Edge → `END`.

---

## El humano actúa — afuera del agente (SPEC-12)

El grafo **ya no pausa**: con la corrida terminada, las órdenes
`PENDIENTE_APROBACION` esperan en la base — el dashboard las lista
igual que antes:

```
Humano → dashboard :5173 → "Aprobar OC-101"
   └─ POST :4000/api/ordenes/OC-101/aprobar {aprobado_por}
        └─ backend persiste: estado = APROBADA        ← FUENTE DE VERDAD
             (fin del circuito — nada vuelve al agente)
```

La aprobación es REST puro del backend, igual que cualquier otra
edición de orden. Antes el backend además disparaba `POST /resume`
al harness para despertar el grafo (SPEC-08); desde SPEC-12 el
grafo es atómico y esa notificación se eliminó
(`server/harness-notify.js` ya no existe).

`ejecutar()` ve que no quedan nodos pendientes →
`corrida.fase='terminado'` → `resumenFinal()`:

```
═══ ✅ CORRIDA TERMINADA ═══
Métricas: { duración, nodos ejecutados, llamadas LLM, fallbacks }
Costos LLM: { tokens prompt/completion, estimación }
El servidor del harness sigue en :4110 — Ctrl+C para salir.
```

---

## Resumen: una corrida = una ejecución del grafo (SPEC-12)

```
iniciar() → nodos 1→8 → END → resumen   (atómica, sin pausas)
```

El `thread_id` sigue siendo la identidad de la corrida y el
checkpointer sigue escribiendo `checkpoints.sqlite` tras cada nodo
— la infraestructura de pause/resume queda disponible pero el grafo
ya no la usa.

## Qué podés observar desde afuera en cada momento

| Momento | Consulta | Respuesta |
|---|---|---|
| Corriendo | `GET :4110/status` | `{threadId, fase:'corriendo'}` |
| Terminado | `GET :4110/status` | `{fase:'terminado'}` — las pendientes se ven en el dashboard por REST |
| Siempre | `GET :4110/metrics` | `estado_corrida` + contadores de negocio + rendimiento LLM (tokens, tiempos ms) + errores |
| Consola | stream del grafo | `▶ nodo "x" terminó (Nms) → estado: campos` |
| Disco | `checkpoints.sqlite` | estado completo tras cada nodo |
| Disco | `.last-thread` | thread_id para reanudar tras reinicio |
