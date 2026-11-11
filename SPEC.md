# SPEC — MERCADO RAÍZ

> Documento de especificación (SDD) del proyecto completo.
> Fuente de verdad reconstruida a partir de `plan.json` (brief original del
> orquestador, ~29KB), el código implementado y la suite de tests.
> Cada SPEC declara: origen → requisitos → contrato → implementación → tests.

| | |
|---|---|
| Proyecto | `mercado-raiz` |
| Tipo | Fullstack (dashboard de órdenes de compra) + agente LangGraph |
| Generado por | MetaBuilder Orchestrator (agente Devin via ACP) — `plan.json` |
| Estado del build | `done` — 6/6 pasos (`status.json`) |
| Stack | React 18 + Vite 7 + Tailwind 3 · Express 5 + better-sqlite3 · Vitest · Playwright |
| Git | 1 commit (`767181c` — generación inicial); `harness-langgraph/` agregado después |

---

## 0. Visión y contexto

**MERCADO RAÍZ** — *"Del campo a tu mesa, con inteligencia"*.

Panel de control de órdenes de compra para un retailer de alimentos:
detecta stock bajo, genera órdenes de compra, y somete a aprobación
humana las que superan **$100**. Sobre ese núcleo se montó después un
agente autónomo (`harness-langgraph/`) que ejecuta el ciclo de
reposición completo con un LLM local.

El brief original (`plan.json.idea`) especificaba: sistema de diseño,
schema SQL, 7 endpoints REST, fórmulas de negocio, mapeo front↔back y
mocks. El orquestador lo ejecutó en 6 pasos → los SPECs 01–07 mapean
1:1 con esos pasos; SPEC-08/09 cubren lo que vino después.

```
┌──────────────┐   HTTP /api    ┌──────────────────────┐
│  Frontend    │ ◄────────────► │  Backend MVC (:4000) │
│  React :5173 │                │  Express + SQLite    │
└──────────────┘                └──────────▲───────────┘
                                           │ POST /resume
┌──────────────────┐   HTTP :4000          │
│  Agente (:4110)  │ ──────────────────────┘
│  LangGraph +     │   crea órdenes / consulta stats
│  Ollama :11434   │
└──────────────────┘
```

---

## SPEC-01 · Sistema de diseño y shell UI

- **Origen:** plan step 1 · brief: "Sistema de Diseño", "Estructura del Dashboard"
- **Implementación:** `tailwind.config.js`, `src/index.css`, `index.html`, `src/components/ui.jsx`, `src/components/Sidebar.jsx`, `src/components/Topbar.jsx`

### Requisitos

- **R1.1** Paleta del brief como tokens Tailwind: `root #2D5F3F`,
  `terra #C8553D`, `cream #F5F1E8`, `ocre #D4A574`, `grafito #2C2C2C`,
  `warmgray #8B8680`, `success #4A7C59`, `info #5B7B8F`.
- **R1.2** Tipografía: `font-display` = Playfair Display (títulos),
  `font-sans` = Inter (UI), `font-mono` = JetBrains Mono (SKUs/datos).
- **R1.3** Sombras `soft`/`lift` con tinte verde raíz; easing
  `ease-brand` = `cubic-bezier(0.4, 0, 0.2, 1)`; radius 8px.
- **R1.4** Layout: sidebar fija 240px (colapsable mobile con overlay +
  Escape) + contenido fluido con topbar.
- **R1.5** Solo se renderizan ítems de navegación con destino real
  (Dashboard, Órdenes) — un nav sin sección detrás es control muerto.
- **R1.6** Iconos exclusivamente `lucide-react` (stroke 1.5).
- **R1.7** Topbar con panel de alertas (órdenes urgentes) cerrable con
  click afuera y Escape.

### Verificado por

`src/__tests__/ui-kit.test.jsx` (bloques del kit renderizan,
`FormShell` gatea submit), `e2e/smoke.spec.js`, `e2e/ordenes.spec.js`.

---

## SPEC-02 · Modelo de datos

- **Origen:** plan step 2 · brief: "Base de Datos - Schema Completo"
- **Implementación:** `server/schema.sql`, `server/db.js`, `server/seed-data.js`

### Requisitos

- **R2.1** Schema idempotente (`CREATE TABLE IF NOT EXISTS`) aplicado
  en cada apertura de la base por `openDb()`.
- **R2.2** Tablas: `proveedores`, `productos`, `ordenes_compra`,
  `historial_stock`, `usuarios` — con los campos, FKs, CHECKs e
  índices del brief (`idx_productos_sku/estado/stock`,
  `idx_ordenes_estado/fecha`, `idx_historial_producto/fecha`).
- **R2.3** `productos.estado` admite `OK|STOCK_BAJO|CRITICO`;
  `ordenes_compra.estado` admite
  `PENDIENTE_APROBACION|APROBADA|RECHAZADA|ENVIADA|RECIBIDA`.
- **R2.4** Seed automático: `seedIfEmpty()` inserta filas solo si la
  tabla está vacía (8 proveedores, 11 productos, órdenes,
  historial de ventas, 3 usuarios).
- **R2.5** `journal_mode=WAL` y `foreign_keys=ON` al abrir.
- **R2.6** Timestamps con formato `YYYY-MM-DDTHH:MM:SS` (ISO con 'T')
  en los writes de la app — mezclarlo con `datetime('now')` de SQLite
  rompería el orden lexicográfico de filtros y sort por fecha.

### Verificado por

`server/api.test.js` (implicitamente — toda la suite corre sobre la DB
seedada), `server/app.test.js`, e2e (consume datos reales del seed).

---

## SPEC-03 · API REST del dominio

- **Origen:** plan step 3 · brief: "Endpoints REST API" (base declarada
  `/api/v1`, implementada como `/api` por la convención de auto-mount)
- **Implementación:** `server/app.js` (auto-mount de `routes/<n>.js`
  en `/api/<n>`), `server/routes/`, `server/controllers/`, `server/models/`

### Contrato de endpoints

| Método | Ruta | Descripción | Errores |
|---|---|---|---|
| GET | `/api/health` | `{ ok: true }` | — |
| GET | `/api/ordenes` | Lista paginada. Query: `estado`, `requiere_aprobacion`, `fecha_desde`, `fecha_hasta`, `search`, `page`, `limit`, `sort` (`fecha_creacion\|monto_total\|estado`), `order` | 400 params inválidos |
| GET | `/api/ordenes/:orden_id` | Detalle con `producto{}` y `proveedor{}` anidados | 404 |
| POST | `/api/ordenes` | Crea orden (`producto_id`, `cantidad`, `requiere_aprobacion?`, `analisis_ia?`) → 201 | 400 body, 404 producto |
| POST | `/api/ordenes/:orden_id/aprobar` | Marca `APROBADA` + `aprobado_por` + `fecha_aprobacion` | 404, 409 no-pendiente |
| POST | `/api/ordenes/:orden_id/rechazar` | Marca `RECHAZADA` + `motivo` (obligatorio) | 400, 404, 409 |
| GET | `/api/productos` | Lista paginada. Query: `estado`, `categoria`, `proveedor_id`, `search`, `page`, `limit` (≤100). `estado` recalculado al leer | 400 |
| GET | `/api/dashboard/stats` | KPIs (ver shape abajo) | — |
| GET | `/api/historial` | Movimientos de stock. Query: `producto_id`, `tipo` (`VENTA\|REPOSICION\|AJUSTE\|DEVOLUCION`), `desde`, `hasta`, `page`, `limit` | 400 |
| POST | `/api/uploads` | `multipart file` (image/* ≤5MB, whitelist ext, sin SVG) → `{ url }` | 400 |

### Requisitos

- **R3.1** Listados responden `{ data: [...], pagination: { page,
  limit, total, totalPages } }`; detalle de orden anida objetos
  `producto` y `proveedor` completos.
- **R3.2** Todas las queries usan prepared statements (`q()`/prepare
  de `db.js`); filtros se construyen por whitelist de columnas
  (`SORT_COLUMNS`), nunca por interpolación.
- **R3.3** Errores como JSON `{ error: "mensaje legible" }` con el
  status correcto (400/404/409); rutas `/api` desconocidas → 404 JSON.
- **R3.4** `rechazar` exige `motivo` no vacío; `aprobar`/`rechazar`
  solo operan sobre `PENDIENTE_APROBACION` (409 si ya resuelta).
- **R3.5** `dashboard/stats` devuelve `ordenes_pendientes`,
  `ordenes_aprobadas_semana`, `valor_total_mes`,
  `productos_stock_bajo`, `productos_criticos` y `tendencia`
  (`ordenes_pendientes_vs_ayer`, `ordenes_aprobadas_vs_semana_anterior`).

### Verificado por

`server/api.test.js` (8 describes, ~30 casos: filtros, paginación,
sort, 400/404/409, umbral, recálculo), `test/api-contract.test.js`
(verifica que cada endpoint del dominio exista registrado),
`server/app.test.js` (health, 404 JSON).

---

## SPEC-04 · Integración front ↔ back

- **Origen:** plan step 4 · brief: "Mapeo de Datos: Frontend ←→ Backend"
- **Implementación:** `src/lib/api.js`, `src/App.jsx`,
  `src/components/{OrdersTable,OrderModal,NewOrderModal,StatsCards,Toasts}.jsx`,
  `src/data/orders.js` (residual: `ESTADOS` badges + `formatMoney`)

### Requisitos

- **R4.1** `api.js` es el cliente único: todo fetch pasa por
  `apiFetch` que traduce fallo de red, JSON inválido y respuesta no-OK
  a `ApiError(mensaje, status)`.
- **R4.2** `mapOrden()` adapta la shape del backend a la de la UI:
  `APROBADA` + `!requiere_aprobacion` → badge `APROBADO_AUTO`
  ("Aprobado auto"); estado desconocido → `PENDIENTE_APROBACION`;
  `producto`/`proveedor` ausentes → `'—'`; `urgente` = pendiente con
  `stock_actual === 0`.
- **R4.3** Carga inicial: `getOrdenes()` + `getDashboardStats()` en
  `Promise.allSettled` — las órdenes son contenido crítico (fallo →
  `ErrorState`); stats es secundario (fallo → KPIs calculados local).
- **R4.4** Reglas de UI obligatorias: skeleton visible mientras carga
  (`SkeletonDashboard`), `EmptyState` si la API devuelve `[]`, error
  controlado si la API cae, submit de formularios deshabilitado hasta
  que el input sea válido (`NewOrderModal` valida producto + cantidad
  entera > 0).
- **R4.5** Aprobar/rechazar desde tabla y modal actualiza badge,
  cierra detalle, emite toast (3s) y refresca KPIs silenciosamente.
- **R4.6** Filtrado por estado + búsqueda client-side sobre la página
  cargada; exportación CSV con BOM (Excel-safe).
- **R4.7** Mini-router propio (`lib/router.jsx`) con `history.pushState`;
  rutas: `/` dashboard, `/privacidad`, resto → 404. Sin react-router.

### Verificado por

`src/__tests__/api-client.test.js` (mapOrden: estados, urgencia,
tolerancia a nulos; apiFetch: OK/ApiError/red; aprobar/rechazar POST),
`src/__tests__/smoke.test.jsx`, `e2e/ordenes.spec.js` (datos reales
del seed, búsqueda/filtro, modal + aprobar, skeleton, vacío, error).

---

## SPEC-05 · Reglas de negocio

- **Origen:** brief "Lógica de Negocio y Cálculos" · transversal a back + agente
- **Implementación:** `server/models/{ordenes,productos,dashboard}.model.js`,
  `harness-langgraph/src/langgraph/nodes/{calcular-cantidad,decidir-aprobacion}.js`

### Requisitos

- **R5.1** Estado de producto **derivado al leer** (la columna puede
  quedar vieja): `stock_actual === 0` → `CRITICO`; `< stock_minimo`
  → `STOCK_BAJO`; resto → `OK`. Un UPDATE de stock se refleja sin
  tocar `estado`.
- **R5.2** `monto_total = round(cantidad × precio_unitario, 2)` —
  calculado server-side al crear, nunca confiado al body.
- **R5.3** Umbral de aprobación: `UMBRAL_APROBACION = 100`
  (`ordenes.model.js:13`). `monto_total >= $100` →
  `requiere_aprobacion=1` + `PENDIENTE_APROBACION`; `< $100` →
  `APROBADA` automática. El body puede forzar `requiere_aprobacion=true`
  (override explícito).
- **R5.4** `orden_id` secuencial `OC-NNN`: `MAX(CAST(SUBSTR(orden_id,4)
  AS INT)) + 1`, generado **dentro de la transacción de insert** por
  concurrencia.
- **R5.5** Cantidad a ordenar (agente): cubrir `demanda_diaria ×
  (tiempo_entrega_dias + 7)` descontando stock actual, con piso de
  `2 × stock_minimo − stock_actual`. El LLM estima demanda; la
  cantidad exacta la calcula código determinista.
- **R5.6** Resolver orden ya resuelta → 409 (la UI además oculta
  acciones en no-pendientes).
- **R5.7** `aprobado_por`/`rechazado_por` default `'sistema'`;
  strings de entrada recortados por `capString` (200/500 chars).

### Verificado por

`server/api.test.js` (umbral exacto, override, 409, recálculo en
update), `harness-langgraph/tests/nodes/calculo-y-decision.test.js`
(fórmula de cantidad, piso 2×mínimo, corte por umbral).

---

## SPEC-06 · Seguridad y compliance

- **Origen:** AGENTS.md (reglas obligatorias) · `plan.json.compliance:
  ["privacidad","notfound"]`
- **Implementación:** `server/security.js`, `server/log.js`,
  `server/routes/uploads.js`, `src/pages/Privacidad.jsx`,
  `src/pages/NotFound.jsx`, `server/harness-notify.js`

### Requisitos

- **R6.1** Headers en toda respuesta: `X-Content-Type-Options:
  nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy:
  strict-origin-when-cross-origin`.
- **R6.2** Rate limit in-memory por IP: **20 escrituras/min** (solo
  POST/PUT/DELETE; GET libres) → 429 JSON. Single-process con SQLite:
  `Map` alcanza; multi-instance queda fuera de scope.
- **R6.3** `express.json({ limit: '2mb' })`; `capString` en campos
  libres antes de persistir.
- **R6.4** Uploads: whitelist por **extensión** (mimetype es
  spoofable), SVG excluido (XSS same-origin), UUID como filename, 5MB.
  Servidos con `nosniff` desde `/uploads`.
- **R6.5** Request logger propio: una línea `MÉTODO url status ms`
  por request (los 429 también quedan registrados).
- **R6.6** Página `/privacidad` con aviso de datos (qué se recolecta,
  finalidad, retención, derechos ARCO, contacto) + link visible en el
  footer del dashboard.
- **R6.7** Ruta inexistente → página 404 con vuelta al inicio.
- **R6.8** `harness-notify.js`: tras aprobar/rechazar, el backend
  dispara `POST $HARNESS_URL/resume` fire-and-forget — la aprobación
  nunca falla por la notificación.
- **R6.9** Sin auth: la tabla `usuarios` existe pero no hay login —
  `USUARIO_DEMO` hardcodeado en el cliente. Alcance demo.
- **R6.10** Secretos solo por `.env` (gitignored) + `.env.example`;
  nada de secretos en bundle ni logs.

### Verificado por

`server/app.test.js` (headers, 429 en POSTs, rechazo .svg),
`e2e/ordenes.spec.js` (link /privacidad, 404 con vuelta).

---

## SPEC-07 · Testing

- **Origen:** plan steps 5 y 6
- **Implementación:** `server/*.test.js`, `test/api-contract.test.js`,
  `src/__tests__/`, `e2e/`, `playwright.config.js`,
  `harness-langgraph/tests/`

### Cobertura (8 archivos, ~950 líneas)

| Suite | Casos | Qué verifica |
|---|---|---|
| `server/api.test.js` | ~30 | Contrato completo de la API del dominio sobre DB seedada |
| `server/app.test.js` | 4 | Health, 404 JSON, headers, rate limit, upload .svg |
| `test/api-contract.test.js` | 8 | Cada endpoint del dominio existe y está montado |
| `src/__tests__/api-client.test.js` | ~11 | `mapOrden`, `ApiError`, métodos del cliente |
| `src/__tests__/ui-kit.test.jsx` | 2 | Bloques del kit, `FormShell` disabled |
| `src/__tests__/smoke.test.jsx` | 1 | App renderiza |
| `e2e/ordenes.spec.js` | 8 | Flujo UI→API real: datos del seed, KPIs, filtro, modal+aprobar, skeleton, vacío, error, privacidad, 404 |
| `e2e/smoke.spec.js` | 1 | Carga sin errores de consola |
| `harness-langgraph/tests/nodes/` | 3 | Nodos deterministas del agente |

### Requisitos

- **R7.1** `npx vitest run` corre unit + integración; los describes de
  `api.test.js` están ordenados porque la DB persiste (singleton).
- **R7.2** `npm run test:e2e` levanta `npm run seed && npm run api`
  (:4000) + `npm run dev` (:5173) vía `webServer` de Playwright —
  las órdenes mutables exigen seed fresco.
- **R7.3** E2E cubre explícitamente las reglas de UI (skeleton,
  vacío informativo, error controlado, privacidad, 404).

---

## SPEC-08 · Agente LangGraph (`harness-langgraph/`)

- **Origen:** agregado post-generación (sub-proyecto propio con README,
  `EXPLICACION.md` y `docs/{arquitectura,flujo-datos,flujo-ejecucion,prompts}.md`)
- **Implementación:** `harness-langgraph/src/{langgraph,harness,integrations,config,utils}`

### Propósito

Agente de reposición autónoma: lee productos con stock bajo → el LLM
(Ollama `llama3.2:1b`) estima demanda → código calcula cantidad →
crea órdenes vía HTTP → si alguna supera $100, **pausa el grafo** hasta
que un humano resuelve desde el dashboard → reanuda y cierra.

### Grafo (10 nodos, 2 edges condicionales)

```
leer-inventario → analizar-demanda(LLM) → calcular-cantidad
→ generar-analisis(LLM) → decidir-aprobacion → crear-orden
→ ¿pendientes? ─ sí → notificar → esperar-aprobacion ⏸
              └ no → fin            ↓ POST /resume
              procesar-decision → ¿quedan? ─ sí → ⏸ / no → fin
```

### Requisitos

- **R8.1** Estado compartido declarado con `Annotation` + reducers
  (`state.js`) — un spec plano pierde estado al restaurar checkpoints.
- **R8.2** Checkpoints en `checkpoints.sqlite` (`SqliteSaver`): la
  pausa por `interrupt()` sobrevive a la muerte del proceso.
- **R8.3** Servidor de control (:4110): `GET /status`, `GET /metrics`,
  `POST /resume`, `POST /run`.
- **R8.4** Human-in-the-loop cableado por el backend: aprobar/rechazar
  dispara `POST /resume` (fire-and-forget, SPEC-06 R6.8); señales
  múltiples se encolan.
- **R8.5** Fallbacks: si el LLM responde mal, los nodos usan plan B
  (promedio histórico / template) — la corrida no muere por un mal
  JSON del modelo (`utils/llm-json.js`).
- **R8.6** `UMBRAL_APROBACION` duplicado a propósito: el agente decide
  `requiere_aprobacion` y el backend lo re-deriva como red de
  seguridad (mismo valor en `.env` y `ordenes.model.js`).
- **R8.7** El agente es un cliente HTTP más (`integrations/*.client.js`)
  — nunca toca la base directamente.
- **R8.8** Capa harness: retry con backoff (`error-handler`),
  conteo de tokens (`cost-tracker`), métricas de corrida (`metrics`),
  log de transiciones (`monitor`).

### Verificado por

`harness-langgraph/tests/nodes/calculo-y-decision.test.js` (nodos
deterministas); los nodos LLM no tienen test unitario (dependen de
Ollama). Docs: `docs/flujo-ejecucion.md` (traza paso a paso).

---

## SPEC-09 · DevEx y operación

- **Origen:** AGENTS.md ("Comandos que deben existir") + skeleton del orquestador
- **Implementación:** `package.json`, `vite.config.js`,
  `playwright.config.js`, `Dockerfile`, `.dockerignore`,
  `.github/workflows/ci.yml`, `.env.example`

### Requisitos

- **R9.1** Scripts: `dev` (:5173), `api` (:4000), `dev:api` (--watch),
  `seed`, `test` (vitest), `test:e2e` (playwright), `build`,
  `preview`, `agente` (harness).
- **R9.2** Vite proxifica `/api` y `/uploads` al :4000 en dev.
- **R9.3** Docker multi-stage (node:22): `npm ci` → build `dist/` →
  slim con `server/` + `dist/`; `CMD node server/index.js` sirve API +
  estáticos en un solo contenedor (el backend sirve `dist/` si existe).
- **R9.4** CI (`.github/workflows/ci.yml`): `npm ci`, `npm audit
  --audit-level=critical`, `npm test` en Node 22.
- **R9.5** `.env.example` declara `PORT`, `HARNESS_URL` (comentadas);
  el harness tiene su propio `.env.example` (`BACKEND_URL`,
  `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `HARNESS_PORT`,
  `UMBRAL_APROBACION`).
- **R9.6** Gitignored: `node_modules/`, `.env`, `*.sqlite`,
  `server/uploads/*`, `dist/`.

---

## SPEC-10 · Observabilidad y Métricas del Agente (LLM y Orquestación)

- **Origen:** agregado post-generación (bloque provisto por el usuario, validado contra el código el 2026-11-10)
- **Implementación objetivo:** `harness-langgraph/src/harness/{cost-tracker,metrics,server,orchestrator}.js`, `src/langgraph/{state.js,nodes/*}`, `src/index.js`
- **Estado global:** ✅ implementado (mergeado a `main` el 2026-11-10 — ramas `feat/spec10-*`, `test/spec10-metricas`, `docs/spec10-*`).

**Objetivo**: rastrear el rendimiento, costo computacional y
comportamiento del LLM (Ollama) en cada ejecución del agente,
proporcionando datos accionables para optimización y depuración, sin
inflar el estado global (state bloat): las métricas viven en los
acumuladores del harness (`metrics`, `costTracker`), no en el estado
del grafo — salvo `errores`, que ya es parte del estado por diseño.

### 1. Datos nativos capturados de Ollama (por cada llamada al LLM)

`cost-tracker.js` ya recibe la respuesta completa de LangChain; debe
leer además `response_metadata` (verificado: trae los 7 campos; las
duraciones vienen en nanosegundos) y transformarlas a ms:

| Campo (Origen Ollama, `response_metadata`) | Campo en Métrica | Descripción | Estado |
|---|---|---|---|
| `model` | `modelo` | Modelo usado — dinámico, hoy `qwen3:8b` | ✅ |
| `prompt_eval_count` | `tokens_prompt` | Tokens de entrada | ✅ `tokens_prompt_acumulados` |
| `eval_count` | `tokens_generacion` | Tokens de salida | ✅ `tokens_generacion_acumulados` |
| `load_duration` | `tiempo_carga_ms` | Carga del modelo en memoria — alto = cold start | ✅ `tiempo_carga_promedio_ms` |
| `prompt_eval_duration` | `tiempo_procesamiento_prompt_ms` | Tiempo leyendo el contexto | ✅ `tiempo_procesamiento_prompt_promedio_ms` |
| `eval_duration` | `tiempo_generacion_ms` | Tiempo escribiendo la respuesta | ✅ `tiempo_generacion_promedio_ms` |
| `total_duration` | `tiempo_total_inferencia_ms` | Ciclo completo de inferencia | ✅ `tiempo_total_promedio_ms` |

### 2. Métricas de Orquestación y Negocio (Harness)

| Métrica | Fuente real hoy | Estado |
|---|---|---|
| `total_productos_evaluados` | `state.productosBajos.length` (estado final del grafo) | ✅ `metrics.sincronizarEstadoGrafo` (orchestrator) |
| `ordenes_creadas` | `state.ordenesCreadas.length` | ✅ misma vía |
| `ordenes_pausadas_hith` | `state.ordenesPendientes` / flag `requiere_aprobacion` | ✅ misma vía |
| `conteo_fallbacks` | `metrics.erroresFallback` → `fallbacks_usados` | ✅ `conteo_fallbacks` en el contrato |
| `tasa_fallback` | `conteo_fallbacks / total_productos_evaluados * 100` | ✅ — **acotación**: hay 2 nodos LLM, así el máximo teórico es 200%; alerta >15% se mantiene como umbral |
| `errores_no_criticos` | `state.errores` (reducer acumulativo — ya lo escriben los nodos con errores no fatales: analizar-demanda, generar-analisis, crear-orden) | ✅ expuesto en `/metrics` |

### 3. Contrato de API

**Ruta**: `GET http://localhost:4110/metrics` (existe — hoy devuelve
`{...metrics.resumen(), llm: costTracker.resumen()}`; hay que
reestructurar a esta forma, breaking change interno del sub-proyecto)

```json
{
  "estado_corrida": "terminado",
  "resumen_ejecucion": {
    "total_productos_evaluados": 5,
    "ordenes_creadas": 2,
    "ordenes_pausadas_hith": 1,
    "conteo_fallbacks": 1,
    "tasa_fallback": 20.0,
    "mensaje_sistema": "Ejecución completada con 1 fallback heurístico."
  },
  "rendimiento_llm": {
    "modelo": "qwen3:8b",
    "llamadas_totales": 10,
    "tokens_prompt_acumulados": 4500,
    "tokens_generacion_acumulados": 1200,
    "tiempo_carga_promedio_ms": 150,
    "tiempo_procesamiento_prompt_promedio_ms": 60,
    "tiempo_generacion_promedio_ms": 850,
    "tiempo_total_promedio_ms": 1000
  },
  "errores_no_criticos": [
    "generar-analisis(SKU-99): Respuesta demasiado corta, se usó template"
  ]
}
```

Notas de diseño validadas:

- `estado_corrida` mapea a `orchestrator.corrida.fase`
  (`idle|corriendo|pausado|terminado|error`).
- Si `total_productos_evaluados` es `0` (sin llamadas al LLM),
  `rendimiento_llm` será `null` y el frontend solo muestra
  `mensaje_sistema` — nunca tablas vacías (regla UI n°5).
- `mensaje_sistema` es derivado (contadores → frase), no viene del LLM.

### Requisitos

- **R10.1** `costTracker.registrar(r)` lee `response_metadata`:
  acumula tokens + las 4 duraciones (ns→ms) y guarda `modelo` de la
  última llamada. ✅
- **R10.2** El harness obtiene `productosBajos`, `ordenesCreadas`,
  `decisionPorProducto` (para contar `requiere_aprobacion`) y
  `errores` del estado final del grafo (`grafo.getState()` tras cada
  `stream`, ya disponible en `orchestrator.ejecutar`) y los vuelca a
  `metrics` — sin duplicarlos en el estado del grafo. ✅
- **R10.3** `GET /metrics` devuelve el contrato de §3 con
  `estado_corrida`, `resumen_ejecucion` (incl. `tasa_fallback` y
  `mensaje_sistema`), `rendimiento_llm` (`null` sin llamadas) y
  `errores_no_criticos`. ✅
- **R10.4** Los nodos LLM siguen registrando fallbacks en
  `state.errores` + `metrics.fallback()` — ya lo hacen; solo
  verificar que el mensaje sea conciso (sin stack traces). ✅
- **R10.5** `resumenFinal()` del orchestrator imprime el nuevo
  resumen estructurado. ✅

### Tareas de implementación

- [x] **T10.1** `cost-tracker.js`: extender `registrar()` para leer
  `response_metadata` (`load_duration`, `prompt_eval_duration`,
  `eval_duration`, `total_duration`, `model`); acumular sumas y
  contar llamadas; exponer promedios ms en `resumen()`.
- [x] **T10.2** `metrics.js`: agregar campos `productosEvaluados`,
  `ordenesCreadas`, `ordenesPausadas`, `erroresNoCriticos` con sus
  setters, y `tasa_fallback` derivada en `resumen()`.
- [x] **T10.3** `orchestrator.js`: tras cada `ejecutar()` (y al
  terminar la corrida) leer `estado.values` y alimentar los campos
  de T10.2; generar `mensaje_sistema`.
- [x] **T10.4** `server.js`: reestructurar `GET /metrics` al contrato
  de §3 (fase → `estado_corrida`; `rendimiento_llm: null` si no hubo
  llamadas).
- [x] **T10.5** Tests: extender `harness-langgraph/tests/` con un
  test de `cost-tracker` (objeto mock de `response_metadata`) y del
  shape de `/metrics` — sin Ollama real.
- [x] **T10.6** Docs: actualizar `docs/arquitectura.md` (tabla del
  harness) y `EXPLICACION.md` con el nuevo contrato de `/metrics`.

### Verificado por

`harness-langgraph/tests/` (T10.5); validación manual con
`curl :4110/metrics` tras una corrida real.

---

## Anexo A — Trazabilidad plan → spec → código → tests

| Plan step | SPEC | Archivos clave | Tests |
|---|---|---|---|
| 1 — Frontend UI | SPEC-01 | `tailwind.config.js`, `src/components/*` | `ui-kit.test.jsx`, e2e smoke |
| 2 — Schema | SPEC-02 | `server/schema.sql`, `server/db.js`, `seed-data.js` | vía `api.test.js` |
| 3 — API REST | SPEC-03, 05 | `server/routes|controllers|models/` | `api.test.js`, `api-contract.test.js` |
| 4 — Integración | SPEC-04 | `src/lib/api.js`, `src/App.jsx` | `api-client.test.js`, e2e |
| 5 — Tests API | SPEC-07 | `server/*.test.js`, `src/__tests__/` | — |
| 6 — E2E | SPEC-07 | `e2e/`, `playwright.config.js` | — |
| (transversal) | SPEC-06 | `security.js`, `Privacidad.jsx`, `NotFound.jsx` | `app.test.js`, e2e |
| (post-gen) | SPEC-08 | `harness-langgraph/` | `tests/nodes/` |
| (skeleton) | SPEC-09 | `Dockerfile`, `ci.yml`, configs | CI |
| (post-gen) | SPEC-10 | `harness-langgraph/src/harness/*` | `harness-langgraph/tests/` |

## Anexo B — Divergencias brief ↔ implementación

| Brief | Implementado | Nota |
|---|---|---|
| Base `/api/v1` | `/api` | Convención de auto-mount del skeleton (más simple; no rompe nada interno) |
| 7 endpoints | 9 | `GET /api/historial` y `POST /api/uploads` vienen del skeleton, no del brief |
| `aprobado_por: "auto"` en mock | default `'sistema'` | El mock del brief usaba "auto"; el controller defaultea `'sistema'` |
| `rechazado_por` en body de rechazo | aceptado, default `'sistema'` | Consistente con aprobar |
| Tabla `usuarios` con roles | Sin endpoints ni login | Persistida y seedeada; solo `USUARIO_DEMO` en el cliente. Alcance demo |
| Sidebar con 5 secciones | 2 ítems (Dashboard, Órdenes) | Regla UI n°2: nav sin destino real no se renderiza |
| `src/data/orders.js` mock | Residual | El mock se reemplazó; queda `ESTADOS` (badges) + `formatMoney` |
| Fórmula `2×min − actual` | Igual + cobertura de demanda del agente | El agente añade `demanda × (lead + 7)` por encima del brief original |

## Anexo C — Prompt original

El brief completo que generó el proyecto está en `plan.json` → campo
`idea` (28,852 chars). `plan.json.steps` contiene las 6 instrucciones
de ejecución referenciadas en cada SPEC.
