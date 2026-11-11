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
  │     GET /status · GET /metrics · POST /resume · POST /run
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
| **Por cada producto** | `GET /api/historial?producto_id=N&tipo=VENTA` → `llmJson.invoke(prompt)` → valida con zod → `costTracker.registrar(r)` |
| **Si el LLM falla ×2** | fallback: promedio histórico + string en `errores` |
| **Devuelve** | `{ analisisPorProducto: {1:{…}, 2:{…}}, errores: [] }` |
| **Reducer** | `mergeObjeto` → fusiona las claves por producto; `acumulativo` concatena errores |
| **Edge** | fijo → `calcular-cantidad` |

### Nodo 3 · `calcular-cantidad` (código)

| | |
|---|---|
| **Lee** | `productosBajos` + `analisisPorProducto` |
| **Cuenta** | `cantidad = max(demanda×(lead+7) − stock, 2×mínimo − stock, 1)`; `monto = cantidad × precio` |
| **Devuelve** | `{ decisionPorProducto: {1:{cantidad,monto_total}, 2:{…}} }` |
| **Edge** | fijo → `generar-analisis` |

### Nodo 4 · `generar-analisis` (**LLM**)

| | |
|---|---|
| **Lee** | `productosBajos`, `analisisPorProducto`, `decisionPorProducto` |
| **Por cada producto** | `llm.invoke(prompt)` → texto justificación → `analisis_ia` (≤1900 chars; <20 → retry) |
| **Si falla ×2** | template con los mismos datos + error |
| **Devuelve** | `{ decisionPorProducto: {…, analisis_ia}, errores }` — merge sobre lo del nodo 3 |
| **Edge** | fijo → `decidir-aprobacion` |

### Nodo 5 · `decidir-aprobacion` (código, regla de negocio)

| | |
|---|---|
| **Lee** | `decisionPorProducto[].monto_total` |
| **Regla** | `monto >= UMBRAL_APROBACION` ($100, `.env`) → `requiere_aprobacion: true` |
| **Devuelve** | `{ decisionPorProducto: {…, requiere_aprobacion} }` |
| **Edge** | fijo → `crear-orden` |

### Nodo 6 · `crear-orden` (código, toca el mundo)

| | |
|---|---|
| **Lee** | `productosBajos` + `decisionPorProducto` |
| **Por cada producto** | `POST :4000/api/ordenes {productoId, cantidad, requiereAprobacion, analisisIa}` |
| **Devuelve** | `{ ordenesCreadas: [orden…], ordenesPendientes: ["OC-101"], errores }` — pendientes = las que el backend dejó en `PENDIENTE_APROBACION` |
| **Edge** | **condicional** → `despuesDeCrearOrdenes(state)` |

Acá ocurre la primera **decisión de rumbo**:

```js
state.ordenesPendientes.length > 0 ? 'notificar' : 'fin'
```

- Si ninguna orden quedó pendiente → directo a `fin`, corrida corta.
- En nuestro ejemplo `OC-101` ≥ $100 → va a `notificar`.

### Nodo 7 · `notificar` (stub)

Devuelve `{}` — solo loguea las pendientes. Edge fijo → `esperar-aprobacion`.

### Nodo 8 · `esperar-aprobacion` — **LA PAUSA**

```js
const senal = interrupt({ mensaje: '…', ordenes_pendientes: state.ordenesPendientes });
```

`interrupt()` **congela la ejecución**:

1. LangGraph serializa TODO el estado a `checkpoints.sqlite`.
2. El stream emite `{__interrupt__: …}` → el monitor imprime `⏸ INTERRUPCIÓN`.
3. `ejecutar()` detecta `estado.next.length > 0` → `corrida.fase = 'pausado'`.
4. El proceso **sigue vivo solo por el servidor Express** — el grafo está dormido en disco.

```
═══ ⏸  AGENTE PAUSADO — esperando decisión humana ═══
Órdenes pendientes: OC-101
Pasos: aprobar/rechazar en http://localhost:5173
       (el backend dispara POST :4110/resume automáticamente)
```

---

## Intermedio — el humano actúa (afuera del agente)

```
Humano → dashboard :5173 → "Aprobar OC-101"
   └─ POST :4000/api/ordenes/OC-101/aprobar {aprobado_por}
        └─ backend persiste: estado = APROBADA        ← FUENTE DE VERDAD
        └─ notificarResume({orden_id, decision, por})  ← server/harness-notify.js
             └─ POST :4110/resume  (fire-and-forget)
                  └─ orchestrator.reanudar(payload)
                       ├─ ¿grafo corriendo? → encola la señal, sigue después
                       └─ ¿pausado? → ejecutar(threadId, Command({resume: payload}))
```

Nota clave: el payload del `/resume` **no es la decisión** — es solo
la señal de "ya podés mirar". La verdad se relee del backend.

## Ejecución 2 — Reanudación (mismo código, otro input)

`grafo.stream(Command({resume: …}), {thread_id})` restaura el estado
desde el checkpoint y **re-ejecuta `esperar-aprobacion` desde el
inicio** — pero esta vez `interrupt()` no pausa: devuelve el
payload. El nodo termina devolviendo `{ senalReanudacion }`. Edge
fijo → `procesar-decision`.

### Nodo 9 · `procesar-decision` (relee la verdad)

| | |
|---|---|
| **Lee** | `ordenesPendientes` |
| **Por cada orden_id** | `GET /api/ordenes/:id` → estado **real** |
| **Devuelve** | `{ ordenesPendientes: [las que siguen], ordenesResueltas: [las cerradas] }` |
| **Edge** | **condicional** → `despuesDeProcesar(state)` |

```
ordenesPendientes.length > 0 ? 'esperar-aprobacion' (↺ otra pausa)
                             : 'fin'
```

- Aprobó OC-101 pero OC-102 sigue pendiente → vuelve a pausar. El
  humano resuelve la siguiente → otro `/resume` → **ejecución 3**…
  así hasta vaciar la lista. Si el humano aprobó varias de golpe,
  las señales se **encolan** en `_resumePendiente` y se procesan en
  cadena al volver a pausar.
- Si al reanudar todo está resuelto → `fin`.

### Nodo 10 · `fin` → `END`

Lee `ordenesCreadas`, `ordenesResueltas`, `errores`; pide
`GET /api/dashboard/stats`; devuelve `{}`. Edge → `END`.

`ejecutar()` ve que no quedan nodos pendientes →
`corrida.fase='terminado'` → `resumenFinal()`:

```
═══ ✅ CORRIDA TERMINADA ═══
Métricas: { duración, nodos ejecutados, llamadas LLM, fallbacks }
Costos LLM: { tokens prompt/completion, estimación }
El servidor del harness sigue en :4110 — Ctrl+C para salir.
```

---

## Resumen: una corrida = N ejecuciones del grafo

```
iniciar()    → ejecución 1: nodos 1→8, corta en interrupt()        ⏸
resume #1    → ejecución 2: re-corre nodo 8 → nodo 9 → ¿pendientes? ⏸/fin
resume #2    → ejecución 3: igual …                                ⏸/fin
    …          (una ejecución por cada señal del humano)
fin          → nodo 10 → END → resumen
```

Cada ejecución abarca **desde donde quedó el checkpoint hasta el
próximo interrupt o el END**. El `thread_id` es la identidad de la
corrida — con él LangGraph sabe qué checkpoint restaurar.

## Qué podés observar desde afuera en cada momento

| Momento | Consulta | Respuesta |
|---|---|---|
| Corriendo | `GET :4110/status` | `{threadId, fase:'corriendo'}` |
| Pausado | `GET :4110/status` | `{fase:'pausado', detalle:['OC-101']}` |
| Siempre | `GET :4110/metrics` | tiempos por nodo, llamadas LLM, tokens |
| Consola | stream del grafo | `▶ nodo "x" terminó (Nms) → estado: campos` |
| Disco | `checkpoints.sqlite` | estado completo tras cada nodo |
| Disco | `.last-thread` | thread_id para reanudar tras reinicio |
