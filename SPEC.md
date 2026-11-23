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
                                           │ aprobación REST
┌──────────────────┐   HTTP :4000          │ (SPEC-12)
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
| ~~POST~~ | ~~`/api/uploads`~~ | ~~`multipart file` (image/* ≤5MB, whitelist ext, sin SVG) → `{ url }`~~ — **retirado en SPEC-20** (sin consumidor) | ~~400~~ |

*Nota (SPEC-23/24): desde SPEC-23 toda la tabla exige `Authorization:
Bearer` salvo `/api/auth/*` y `/api/health`; `aprobado_por` sale del
token, no del body. Se agregan las rutas `/api/auth/*` (login,
refresh, logout, me, cambiar-password) y `/api/usuarios/*` (CRUD
solo ADMIN) — contrato completo en esos SPECs.*

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
  (`ordenes.model.js:13`) — **recalibrado a $50.000 en SPEC-22** (el
  catálogo real en ARS hacía que toda orden superara $100).
  `monto_total >= umbral` → `requiere_aprobacion=1` +
  `PENDIENTE_APROBACION`; `< umbral` → `APROBADA` automática. El body
  puede forzar `requiere_aprobacion=true` (override explícito).
- **R5.4** `orden_id` secuencial `OC-NNN`: `MAX(CAST(SUBSTR(orden_id,4)
  AS INT)) + 1`, generado **dentro de la transacción de insert** por
  concurrencia.
- **R5.5** Cantidad a ordenar (agente): cubrir `demanda_diaria ×
  (tiempo_entrega_dias + 7)` descontando stock actual, con piso de
  `2 × stock_minimo − stock_actual`. El LLM estima demanda; la
  cantidad exacta la calcula código determinista.
- **R5.6** Resolver orden ya resuelta → 409 (la UI además oculta
  acciones en no-pendientes).
- **R5.7** ~~`aprobado_por`/`rechazado_por` default `'sistema'`~~ —
  **reemplazado por SPEC-23**: salen del JWT del usuario autenticado,
  el body ya no los setea;
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
  ~~`server/routes/uploads.js`~~ (retirado en SPEC-20),
  `src/pages/Privacidad.jsx`,
  `src/pages/NotFound.jsx`, ~~`server/harness-notify.js`~~
  (eliminado en SPEC-12)

### Requisitos

- **R6.1** Headers en toda respuesta: `X-Content-Type-Options:
  nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy:
  strict-origin-when-cross-origin`.
- **R6.2** Rate limit in-memory por IP: **20 escrituras/min** (solo
  POST/PUT/DELETE; GET libres) → 429 JSON. Single-process con SQLite:
  `Map` alcanza; multi-instance queda fuera de scope.
- **R6.3** `express.json({ limit: '2mb' })`; `capString` en campos
  libres antes de persistir.
- **R6.4** ~~Uploads: whitelist por **extensión** (mimetype es
  spoofable), SVG excluido (XSS same-origin), UUID como filename, 5MB.
  Servidos con `nosniff` desde `/uploads`.~~ — **retirado en SPEC-20**
  (endpoint sin consumidor del dominio)
- **R6.5** Request logger propio: una línea `MÉTODO url status ms`
  por request (los 429 también quedan registrados).
- **R6.6** Página `/privacidad` con aviso de datos (qué se recolecta,
  finalidad, retención, derechos ARCO, contacto) + link visible en el
  footer del dashboard.
- **R6.7** Ruta inexistente → página 404 con vuelta al inicio.
- **R6.8** ~~`harness-notify.js`: tras aprobar/rechazar, el backend
  dispara `POST $HARNESS_URL/resume`~~ — **reemplazado por SPEC-12**:
  la aprobación es REST puro, el backend ya no notifica al agente.
- **R6.9** ~~Sin auth: la tabla `usuarios` existe pero no hay login —
  `USUARIO_DEMO` hardcodeado en el cliente. Alcance demo.~~ —
  **superseded por SPEC-23**: login JWT + refresh rotativo + roles.
- **R6.10** Secretos solo por `.env` (gitignored) + `.env.example`;
  nada de secretos en bundle ni logs.

### Verificado por

`server/app.test.js` (headers, 429 en POSTs, ~~rechazo .svg~~ —
el test se retiró junto al endpoint en SPEC-20),
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
| `server/app.test.js` | 4 | Health, 404 JSON, headers, rate limit (upload .svg retirado en SPEC-20) |
| `test/api-contract.test.js` | 7 | Cada endpoint del dominio existe y está montado (8 antes de SPEC-20) |
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
crea órdenes vía HTTP → si alguna supera $100, ~~pausa el grafo hasta
que un humano resuelve desde el dashboard → reanuda~~ **(SPEC-12:**
la corrida es atómica — termina y la pendiente espera en la DB; el
humano resuelve por REST del backend**)** → cierra.

### Grafo (8 nodos — 10 antes de SPEC-12)

```
leer-inventario → analizar-demanda(LLM, triage CV) → calcular-cantidad
→ decidir-aprobacion → generar-analisis(LLM condicional) → crear-orden
→ ¿pendientes? ─ sí → notificar → fin
              └ no → fin
```

*(SPEC-12 eliminó `esperar-aprobacion`/`procesar-decision` — la
aprobación humana se desacopló al backend REST; ver nota en SPEC-12
sobre la compatibilidad de checkpoints viejos.)*

### Requisitos

- **R8.1** Estado compartido declarado con `Annotation` + reducers
  (`state.js`) — un spec plano pierde estado al restaurar checkpoints.
- **R8.2** Checkpoints en `checkpoints.sqlite` (`SqliteSaver`) — la
  infraestructura sigue; el `interrupt()` lo dejó de emitir el grafo
  (SPEC-12).
- **R8.3** Servidor de control (:4110): `GET /status`, `GET /metrics`,
  `POST /resume`, `POST /run`.
- **R8.4** ~~Human-in-the-loop cableado por el backend vía
  `POST /resume`~~ — **reemplazado por SPEC-12**: aprobación
  desacoplada, el grafo es atómico.
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
- **R9.2** Vite proxifica `/api` al :4000 en dev (~~y `/uploads`~~ —
  retirado en SPEC-20).
- **R9.3** Docker multi-stage (node:22): `npm ci` → build `dist/` →
  slim con `server/` + `dist/`; `CMD node server/index.js` sirve API +
  estáticos en un solo contenedor (el backend sirve `dist/` si existe).
- **R9.4** CI (`.github/workflows/ci.yml`): `npm ci` (raíz **y**
  `harness-langgraph/` — el vitest raíz incluye
  `harness-langgraph/tests/`, que importan `zod`/LangChain),
  `npm audit --audit-level=critical`, `npm test` en Node 22.
- **R9.5** `.env.example` declara `PORT` (comentada; `HARNESS_URL`
  eliminada en SPEC-12); el harness tiene su propio `.env.example`
  (`BACKEND_URL`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `HARNESS_PORT`,
  `UMBRAL_APROBACION`, `UMBRAL_CV`).
- **R9.6** Gitignored: `node_modules/`, `.env`, `*.sqlite`, `dist/`
  (~~`server/uploads/*`~~ — retirado en SPEC-20).

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
    "llm_evitadas": 2,
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

## SPEC-11 · Stress testing del LLM

- **Origen:** pedido del usuario (2026-11-10) — validar tiempos y
  cuellos de botella por recursos procesando ~1000 artículos
- **Implementación:** `harness-langgraph/scripts/stress-llm.mjs`
- **Estado global:** ✅ implementado (mergeado; incluye persistencia
  incremental tras detectar pérdida de resultados ante kill)

### Propósito

Medir throughput, latencia, tokens y resiliencia del LLM (Ollama)
bajo lote grande, usando el **pipeline real del agente**
(`promptAnalisisDemanda` → `llmJson` → `parseJsonResponse`;
`promptGenerarAnalisis` → `llm`) sobre artículos **sintéticos** —
no toca backend ni DB: aísla el modelo como recurso.

### Contrato CLI

```bash
node scripts/stress-llm.mjs [--articulos N] [--concurrencia K]
  [--solo-demanda] [--muestra-cada N] [--salida file.jsonl]
  [--reporte file.json]
```

- `--salida` (persistencia incremental): appendea **un JSON por
  artículo al procesarlo** — los resultados sobreviven a un kill.
  Schema por línea: `{sku, nombre, ts, llamadas[{tipo, wallMs,
  totalMs, loadMs, promptMs, genMs, tokIn, tokOut}], analisis,
  justificacion, ok}`.
- `--reporte`: JSON final con `config`, `duracion_total_s`,
  `throughput` (art/min y llamadas/min), `por_tipo` (percentiles
  wall-clock por nodo + tokens), `resiliencia` (fallbacks, errores),
  `recursos_ollama` (RSS/CPU del proceso) y `cost_tracker` (el mismo
  acumulador de SPEC-10).
- **SIGINT/SIGTERM**: frena el pool y vuelca `reporte_parcial` antes
  de salir (helpers de reporte declarados antes del `await` del pool
  — como `const` después caían en TDZ y el volcado crasheaba).

### Resultados documentados

- **Benchmark completo (qwen3:8b, RTX 3060 Ti, 2026-11-11)**:
  `harness-langgraph/docs/benchmarks/benchmark-qwen3-8b-2026-11-11.md`
  + datos agregados `stress-qwen3-8b-2026-11-11.json`.
  100/100 artículos, 258s, 23,2 art/min, 0 fallbacks; GPU
  power-limited (195,6W/200W prom., 69,7°C, VRAM 6,2/8GB).
- **Convención de persistencia**: en el repo solo se commitea el
  `.json` agregado + `.md` narrativo por corrida (en
  `docs/benchmarks/`); el `--salida` JSONL por artículo es efímero
  y está en `.gitignore` — así cada prueba queda comparable contra
  corridas futuras sin inflar el repo.
- Referencia histórica — lote cortado a ~675/1000 (2026-11-10):
  mismo throughput plano (23 art/min), confirma que el cuello es
  potencia de GPU, no duración del lote.

### Requisitos

- **R11.1** El script reusa el código real del agente (prompts,
  `llm`/`llmJson`, `parseJsonResponse`, `costTracker`) — no
  reimplementa el pipeline. ✅
- **R11.2** Pool de concurrencia con cursor compartido (K
  configurable; K=1 replica el comportamiento secuencial del grafo).
  ✅
- **R11.3** Persistencia incremental por artículo (`--salida` JSONL)
  + volcado de reporte parcial ante señal. ✅
- **R11.4** Métricas por llamada iguales a SPEC-10 §1 (duraciones
  nativas ns→ms, tokens) + muestreo de recursos del proceso Ollama.
  ✅

### Verificado por

Smoke tests del script (piloto + kill test); revisión funcional por
sub-agente (detectó el bug TDZ del handler de señal). El monitoreo
de GPU durante la corrida se hizo con `nvidia-smi` externo — fuera
del script.

Corridas registradas: baseline 100 artículos pre-tuning
(`benchmark-qwen3-8b-2026-11-11.md`) y validación 500 artículos
post-SPEC-12 (`benchmark-qwen3-8b-500-2026-11-11.md`) — throughput
idéntico (23,2 art/min), demanda p99 −56%, VRAM −380 MB, GPU/power
sin cambio; proyección de llamadas evitadas por el grafo (~49%
sobre el dataset sintético) documentada en el reporte.

---

## SPEC-12 · Optimización de rendimiento del agente (demo productiva)

- **Origen:** análisis del benchmark SPEC-11 (`harness-langgraph/
  docs/benchmarks/benchmark-qwen3-8b-2026-11-11.md`) — el 86% del tiempo LLM es
  generación de tokens y el 66% del tiempo por artículo es la
  justificación en prosa. Objetivo del usuario: performance para
  demo productiva, **sin topes de GPU** y **sin cambio de modelo**
  (qwen3:8b se mantiene; A/B de modelos menores queda para otra spec).
- **Estado global:** ✅ implementado

### Decisiones tomadas

1. **Aprobación desacoplada del grafo**: LangGraph deja de esperar
   al humano — se eliminan `esperar-aprobacion` (interrupt) y
   `procesar-decision`. El grafo termina en `crear-orden` →
   `notificar` → `fin`. La aprobación vive 100% en el backend
   (endpoints existentes de `/api/ordenes` ya escriben
   `aprobado_por`/`motivo_rechazo` — eran la fuente de verdad real
   incluso con el interrupt, ver `procesar-decision` read-only).
   El backend deja de llamar `POST /resume` del harness.
2. **Justificación condicional en el grafo** (decisión del usuario):
   `generar-analisis` solo invoca al LLM para órdenes con
   `requiere_aprobacion` — las que el humano efectivamente lee.
   Auto-aprobadas reciben el template determinista existente
   (`fallbackTexto`). Requiere invertir el orden
   `calcular-cantidad → decidir-aprobacion → generar-analisis`
   (hoy `decidir` corre después — seguro: solo necesita
   `monto_total`).
3. **Triage heurístico** (decisión del usuario): en
   `analizar-demanda`, si el coeficiente de variación (CV) de las
   ventas diarias del producto < `UMBRAL_CV` (default 0,3), se usa
   `fallbackDesdeVentas` directo — el LLM se reserva para demandas
   volátiles. Se contabiliza como `llm_evitadas`, NO como fallback
   (es decisión deliberada, no fallo).
4. **Tuning de runtime**: `num_ctx` 2048 (los prompts usan ~250
   tokens; libera KV-cache para paralelismo), `num_predict` acotado
   en la justificación (~160 tokens — los p99 2.317/1.949 ms fueron
   outliers de generación), y documentar `OLLAMA_NUM_PARALLEL=4` server-side
   para corridas concurrentes.

### Diseño objetivo del grafo

```
leer-inventario → analizar-demanda (triage CV → LLM solo volátiles)
→ calcular-cantidad → decidir-aprobacion
→ generar-analisis (LLM solo si requiere_aprobacion, sino template)
→ crear-orden → ¿pendientes? → notificar → fin
```

Sin `interrupt`, sin resume: la corrida es atómica. Estado post-run:
órdenes `PENDIENTE_APROBACION` esperan en la DB — el dashboard las
muestra igual que hoy; aprobar/rechazar es REST puro del backend.

### Requisitos

- **R12.1** Eliminar `esperar-aprobacion` + `procesar-decision` +
  `despuesDeProcesar` del grafo; `notificar → fin`. `notificar` sigue
  informando las pendientes por consola/dashboard. ✅
- **R12.2** El backend deja de llamar `POST /resume`
  (`server/harness-notify.js` / `ordenes.controller.js`). El endpoint
  `/resume` del harness queda para compat con checkpoints pausados
  viejos (devuelve 409 sin corrida pausada — comportamiento actual).
  ✅
- **R12.3** Invertir `decidir-aprobacion` antes de
  `generar-analisis` en los edges del grafo. ✅
- **R12.4** `generar-analisis`: LLM solo si
  `decisionPorProducto[].requiere_aprobacion`; resto →
  `fallbackTexto` con marca `(estimación automática)` en
  `analisis_ia`. Nuevo contador `metrics.llmEvitada()` separado de
  `fallbacks`. ✅
- **R12.5** Triage en `analizar-demanda`: CV de ventas diarias
  (agrupar por fecha, σ/μ de unidades) < `UMBRAL_CV` (env, default
  0,3) → `fallbackDesdeVentas` con `observacion` marcando
  `heurístico`. Contar en `llm_evitadas`. ✅
- **R12.6** Config: `num_ctx: 2048` y `num_predict` ≈160 en las
  instancias `ChatOllama` pertinentes; `UMBRAL_CV` declarado en
  `.env.example`; `OLLAMA_NUM_PARALLEL` documentado en
  harness README. ✅
- **R12.7** Tests: CV/triage, justificación condicional, wiring del
  grafo nuevo (sin interrupt, termina en `fin`), backend ya no
  llama `/resume`. Docs actualizadas (arquitectura.md,
  EXPLICACION.md, flujo-ejecucion.md — describen el loop HITL). ✅

### Impacto proyectado (sobre benchmark 2026-11-11)

| Cambio | s/artículo | art/min | Factor |
|---|---|---|---|
| Base (hoy) | 2,58 | 23,2 | 1× |
| Justificación condicional (~60% auto) | ~1,6 | ~37 | ~1,6× |
| + triage CV (~50% estables típico) | ~1,1 | ~55 | ~2,4× |

Los porcentajes de auto-aprobación y estabilidad dependen de los
datos — validar con `--salida`/`--solo-demanda` del stress script
(A/B contra `stress-qwen3-8b-2026-11-11.json`).

### Tareas

- **T12.1** Invertir orden `decidir`/`generar` + justificación
  condicional + `llm_evitadas` (R12.3, R12.4)
- **T12.2** Desacople HITL: nodos, edges, `/resume` backend (R12.1,
  R12.2) — incluye limpiar residuos: campos `ordenesResueltas` /
  `senalReanudacion` del estado si quedan huérfanos
- **T12.3** Triage heurístico CV (R12.5)
- **T12.4** Tuning config + env/docs runtime (R12.6)
- **T12.5** Tests del flujo nuevo (R12.7 tests)
- **T12.6** Docs del harness al flujo desacoplado (R12.7 docs)

### Verificado por

Tests unitarios `tests/nodes/triage-y-justificacion.test.js` (11
tests: CV, triage, condicional, router) + suite completa 70 verdes;
smokes reales: invoke con `numCtx`/`numPredict` contra qwen3:8b
(context_length 2048 confirmado por `/api/ps`), aprobar/rechazar
por REST sin harness-notify; revisión funcional por sub-agente en
cada tarea.

**Validación del grafo real** (2026-11-11, corrida `run-1794384065546`
contra la DB con 100 productos semilla diseñados por cuadrante
estable/volátil × monto bajo/alto — detalle en
`harness-langgraph/docs/benchmarks/validacion-grafo-real-2026-11-11.md`):
101 productos evaluados, **137 llamadas LLM de 202 posibles → 65
evitadas (32%)** — ~50 por triage CV + ~15 por justificación template;
0 fallbacks; GPU 196 W/69 °C sostenidos. Proyección previa era ~40%
— la real bajó porque el LLM estimó más demanda en los volátiles
(cruce de umbral $100). Hallazgo derivado: el rate limiter del
backend (20 POST/min) rechazó 41 `crear-orden` — ver SPEC-13.

### Nota sobre SPEC-08

R12.1/R12.2 reemplazan el diseño HITL-vía-`interrupt` documentado
en SPEC-08 y los docs del harness: el patrón sigue soportado por la
infraestructura (checkpointer, `/resume`, `.last-thread`) pero el
grafo ya no lo usa — las corridas pausadas viejas siguen
reanudables.

---

## SPEC-13 · Robustez del agente ante rate-limiting del backend

- **Origen:** hallazgo de la validación del grafo real (SPEC-12,
  corrida `run-1794384065546` con 101 productos): el middleware
  `rateLimit({ windowMs: 60_000, max: 20 })` de `server/security.js`
  permite **20 escrituras/min por IP** — el nodo `crear-orden` dispara
  un `POST /api/ordenes` por producto en ráfaga y **41 órdenes fueron
  rechazadas con 429**. El error se registró en `errores_no_criticos`
  pero la orden nunca se persistió: el trabajo LLM de esos productos
  (análisis + justificación) quedó desperdiciado y el producto no
  quedó repuesto.
- **Estado global:** ✅ implementada — ver "Verificado por"

### Contexto técnico

Estado previo al fix (hallazgo):

- `server/security.js:22` — limiter in-memory por IP, solo métodos de
  escritura (GET/HEAD exentos). El 429 devolvía JSON de error **sin
  header `Retry-After`** (hoy sí, R13.1).
- `harness-langgraph/src/langgraph/nodes/crear-orden.js` — POST por
  producto sin retry efectivo: `conReintentos` existía pero esperaba
  1-2s fijos — caía dentro de la misma ventana de 60s y agotaba
  intentos; `catch → errores[]`, el producto se pierde para la
  corrida.
- Las ventas (`GET /api/historial`) no cuentan contra el límite
  (solo escritura), así que el cuello es exclusivamente `crear-orden`.

### Requisitos

- **R13.1** El backend debe incluir `Retry-After` (segundos) en las
  respuestas 429 del limiter — hoy el cliente no tiene cómo saber
  cuándo reintentar. ✅
- **R13.2** `crear-orden` (o `ordenes.client`) debe reintentar ante
  429 con backoff — respetar `Retry-After` si viene, exponencial con
  tope si no (ej. 2s→4s→8s, máx ~5 intentos). Si agota, el error
  sigue yendo a `errores_no_criticos` como hoy. ✅
  — Implementado en `backend-client`/`conReintentos` (la envoltura ya
  existía; el fix fue propagar `err.retryAfter` del header y
  esperarlo — tope 60s — en vez del backoff fijo de 1-2s que caía
  dentro de la misma ventana saturada; `api.post` con `intentos: 4`.
  Sin header el fallback sigue lineal `esperaMs*i` — el "exponencial"
  era ejemplo, el mecanismo primario es `Retry-After`).
- **R13.3** Métrica: los reintentos 429 no deben contarse como
  `llamadas_llm` ni como fallbacks — son fricción de transporte. ✅
  — Ya cubierto por el contador `reintentos` del resumen de métricas
  de la corrida (`metrics.reintento()`); no se agregó un 429-counter
  dedicado (el log ⚠ por reintento + el agregado alcanzan para
  observar). Nota: `/metrics` HTTP no expone `reintentos` hoy — queda
  visible en el resumen de consola de la corrida.
- **R13.4** Decidir y documentar la política del limiter para el
  cliente interno: opciones — subir `max` para `127.0.0.1`/loopback,
  `HARNESS_API_KEY` bypass, o aceptar el límite y dejar que el retry
  absorba la ráfaga (más realista como demo productiva). Documentar
  lo elegido en `arquitectura.md` y `.env.example` si hay variable. ✅
  — Decisión: **límite uniforme + retry del harness** (20 escrituras/min
  para todos; el harness absorbe con `Retry-After` — comportamiento de
  integración productiva real). Loopback-allowlist y API-key bypass
  descartados; documentado en `docs/arquitectura.md` §"Rate limiting".
  Sin variable de entorno nueva.
- **R13.5** Tests: cliente que reintenta ante 429 mockeado
  (verificar backoff y corte al agotar intentos); smoke de corrida
  >20 productos sin órdenes perdidas. ✅
  — `tests/harness/reintentos-429.test.js` (8 tests): retryAfter
  honrado, 5xx con backoff, 4xx sin retry, agotamiento, métricas
  separadas de LLM/fallbacks, parseo del header e integración con el
  limiter real (`security.js`) en ventana corta. Smoke real:
  `scripts/smoke-rate-limit.mjs` → 25/25 POSTs creados, 2 reintentos
  429 absorbidos, 0 órdenes perdidas.

### Tareas

- **T13.1** `Retry-After` en `security.js` (R13.1)
- **T13.2** Retry con backoff en `ordenes.client`/`crear-orden`
  (R13.2, R13.3)
- **T13.3** Política del limiter para cliente interno + docs
  (R13.4)
- **T13.4** Tests + smoke de corrida grande (R13.5)

### Verificado por

Devin (hilo anterior, T13.1–T13.3) + T13.4: suite 78/78 (8 tests
nuevos de rate-limit) y smoke real `smoke-rate-limit.mjs` 25/25
POSTs sin pérdida contra el backend con límite 20/min. El hallazgo
original quedó medido en
`harness-langgraph/docs/benchmarks/validacion-grafo-real-2026-11-11.md`.

---

## SPEC-14 · Paginación completa de productos a reponer

- **Fecha:** 2026-11-14
- **Estado global:** ✅ implementada — ver "Verificado por"

### Contexto técnico

`productos.client.js` pide `?estado=STOCK_BAJO&limit=100` y
`?estado=CRITICO&limit=100` — **una sola página por estado**. La API
toca `limit` en 100, así que con más de 100 productos en un estado la
lista se **trunca en silencio**: productos bajos de stock que el
agente nunca evalúa (ni LLM ni orden — simplemente no existen para la
corrida). Quedó medido en la validación real: de 100 productos BENCH
sembrados, entraron 99 (SPEC-12 §validación).

El envelope ya trae `pagination: { page, limit, total, totalPages }` —
la API soporta `page=N`, no hace falta tocar el backend.

### Requisitos

- **R14.1** `listarProductosAReponer` debe traer **todas** las páginas
  de cada estado: pedir página 1, leer `totalPages` del envelope y
  completar las restantes (los GET están exentos del limiter — se
  pueden paralelizar). Comportamiento de degradación: si el envelope
  no trae `pagination`, devolver `data` como hoy. ✅
  — `listarTodos()` interno: page 1 → `totalPages` → restantes en
  `Promise.all`; fallback `?? 1` si no hay `pagination`.
- **R14.2** No inventar límite nuevo: se respeta el `limit ≤ 100` del
  backend paginando, no subiendo el tope. ✅
  — `LIMIT_PAGINA = 100` constante; se pagina con `page=N`.
- **R14.3** Métrica/observabilidad: `total_productos_evaluados` debe
  reflejar el total real (ya lo hace al contar la lista retornada —
  sin cambio, pero verificar en el smoke). ✅
  — El nodo cuenta `state.productosBajos.length`; al completarse la
  lista el total se corrige solo.
- **R14.4** Tests: cliente mockeado con `totalPages > 1` (verificar
  que itera), `pagination` ausente (fallback), y deduplicación si un
  producto apareciera en ambos estados (la API no lo permite por
  definición de estado, pero el merge debe ser seguro). ✅
  — `tests/nodes/paginacion-productos.test.js` (5 tests): single
  página, iteración multi-página, fallback sin envelope, dedup por
  id, propagación de error en página intermedia.

### Tareas

- **T14.1** Paginación en `productos.client.js` (R14.1–R14.3)
- **T14.2** Tests de paginación (R14.4)

### Verificado por

Devin — suite 83/83 (5 tests nuevos de paginación). Pitfall de
vitest documentado: `beforeEach(() => mock.mockReset())` con arrow
de expresión devuelve el mock y vitest lo ejecuta como cleanup hook
— usar siempre cuerpo de bloque `{ ... }`.

---

## SPEC-15 · Higiene: dejar de trackear `.last-thread`

- **Fecha:** 2026-11-14
- **Estado global:** ✅ implementada — ver "Verificado por"

### Contexto técnico

`harness-langgraph/.last-thread` guarda el último `thread_id` para
que `POST /resume` sobreviva a un reinicio del harness (compat con
checkpoints pausados viejos). Es **estado de runtime** pero está
trackeado en git: cada ejecución del agente lo modifica y aparece
como `M` en el working tree, con riesgo de commitearlo por accidente
en un PR ajeno (ya pasó cerca en varios).

### Requisitos

- **R15.1** Quitar del índice (`git rm --cached`) y agregar
  `.last-thread` a `harness-langgraph/.gitignore` (el archivo ya
  existe e ignora `docs/benchmarks/*.jsonl`). ✅
- **R15.2** El archivo debe seguir existiendo en disco y funcionando
  — solo deja de estar trackeado. Documentar en el comentario de
  `orchestrator.js` si hace falta aclarar que es runtime-local. ✅
  — Sigue en disco con el thread_id actual; comentario agregado en
  `ARCHIVO_THREAD` aclarando que es runtime-local gitignored.
- **R15.3** Verificar: `git status` limpio después de una ejecución
  del agente; el archivo no reaparece en `git ls-files`. ✅
  — `git ls-files` ya no lo lista; `git status` limpio pese a que el
  archivo existe y fue modificado por corridas.

### Tareas

- **T15.1** `git rm --cached` + `.gitignore` (R15.1–R15.3)

### Verificado por

Devin — `git rm --cached` + entrada en `harness-langgraph/.gitignore`;
verificado que el archivo permanece en disco, `git ls-files` vacío y
`git status` limpio con el archivo modificado.

---

## SPEC-16 · Optimización de throughput del agente

- **Fecha:** 2026-11-14
- **Estado global:** ✅ implementada y medida — frío ~4× más rápido
  que el baseline, tibio <1 s (0 llamadas LLM)

### Contexto técnico

La corrida real de ~100 productos tardó ~5,2 min (stress sintético
500 artículos: ~21,5 min). Desglose medido:

- **~55-60% del wall-clock son llamadas LLM** (~1,3 s/llamada
  promedio, una por vez, secuencial por producto).
- ~30% HTTP/backend/esperas del limiter (mejorado con SPEC-13, sigue
  secuencial).
- La GPU corre al 93-96% y ~196 W — saturada, pero el decode de LLM
  es memory-bandwidth bound: requests en paralelo suben el
  throughput agregado de tokens aunque cada uno sea más lento.
- El agente corre a diario → **las ventas de hoy difieren de las de
  ayer en un dato**: el análisis es cacheable por producto.

Ya implementado (SPEC-12): triage CV (~50% demandas sin LLM),
justificación condicional, `num_ctx`/`num_predict` tuneados (~380 MB
VRAM liberados — headroom para paralelismo).

Palancas elegidas (en este orden de implementación):

1. **Incremental**: cache de análisis por producto keyed por hash de
   la ventana de ventas — días estables casi gratis.
2. **Concurrencia**: `OLLAMA_NUM_PARALLEL` + procesamiento en chunks
   paralelos dentro de los nodos.
3. **Batch prompts**: N productos volátiles por llamada de demanda,
   respuesta JSON array validada.
4. **Endpoint batch**: `POST /api/ordenes/batch` — una escritura por
   corrida en vez de una por producto.

### Requisitos

- **R16.1** Cache incremental: para cada producto que va al LLM,
  computar un hash del input (**ventas usadas + campos del producto
  que entran al prompt** — `stock_actual`, `stock_minimo`,
  `precio_unitario`, `categoria`, `proveedor.tiempo_entrega_dias` —
  + modelo + umbrales); si coincide con la entrada cacheada, reusar
  `demanda_estimada` y `analisis` sin llamar al LLM — cubre ambas
  llamadas del producto (la justificación deriva de
  demanda→cantidad→monto, mismos inputs). Sin los campos de producto
  en el hash, un movimiento AJUSTE/REPOSICION cambiaría el stock sin
  invalidar la justificación cacheada.
  Persistencia: archivo JSON local del harness
  (`data/analisis-cache.json`), gitignored — es cache descartable,
  no fuente de verdad. Crear el dir y agregar la entrada a
  `harness-langgraph/.gitignore`. Contador `cache_hits` en métricas
  (separado de `llm_evitadas`, que cuenta decisiones estructurales). ✅
  — `harness/analisis-cache.js` (sha256 de ventas + campos del
  producto —incl. sku— + modelo + umbrales →
  `data/analisis-cache.json`); `analizar-demanda` cachea demanda,
  `generar-analisis` cachea justificación **keyed también por el
  análisis que la produjo** (la prosa cita cifras — si el análisis
  difiere, el texto es inválido). Flag `analisis_llm` marca la
  proveniencia: el fallback heurístico nunca se devuelve como
  demanda cacheada (el LLM se reintenta la próxima corrida), pero
  sí puede llevar justificación reusada por ser determinista.
  `hashPorProducto` nuevo campo de estado; `cache_hits` +
  `reintentos` ahora expuestos en `/metrics`.
- **R16.2** Concurrencia: los nodos que iteran productos llamando al
  LLM procesan en paralelo con límite configurable
  (`AGENTE_CONCURRENCIA`, default 3). Documentar
  `OLLAMA_NUM_PARALLEL` en `.env.example`/README como requisito del
  lado del servidor Ollama (sin él, las requests se encolan — el
  cliente paralelo no ayuda). Métricas deben seguir agregando bien
  (costTracker es acumulador, thread-safe por ser single-thread). ✅
  — `utils/concurrencia.js` (`conLimite`: worker pool que preserva
  orden y aborta al primer error como el `for` secuencial);
  `analizar-demanda` y `generar-analisis` extraen la lógica por
  producto (`analizarUno`/`justificarUno`) y la mapean con límite
  `config.concurrencia` (`AGENTE_CONCURRENCIA`, default 3).
  `OLLAMA_NUM_PARALLEL` documentado en `.env.example` y README
  como requisito del proceso `ollama serve`.
- **R16.3** Batch prompts: `analizar-demanda` agrupa productos
  volátiles en llamadas de hasta `DEMANDA_BATCH` productos (default
  5, configurable); respuesta JSON array validada item por item —
  items inválidos/faltantes caen a llamada individual (fallback
  granular, no a todo el lote). Detalles de implementación (del
  review): `parseJsonResponse` hoy solo parsea objetos (`\{...\}`
  greedy no captura arrays) → necesita variante array-aware; el cap
  `numPredict` debe escalar con el tamaño del lote (≈50 tok/item) o
  el JSON truncado degrada todo a llamadas individuales. ✅ —
  nodo en 2 fases: `prepararUno` (ventas+hash+triage+cache, en
  paralelo) marca `pendiente`; los pendientes se chunkean en lotes
  de `DEMANDA_BATCH` y cada lote es una llamada a `llmJsonBatch`
  (instancia con `numPredict=100×lote`, `numCtx` escalado). Items
  se validan contra `schemaAnalisisBatch` (análisis +
  `producto_id` coerce) via `parseJsonArrayResponse` nuevo;
  matcheo por `producto_id`; faltantes/inválidos y lotes que
  fallan completos caen a `analisisIndividual` (path pre-batch
  intacto). `DEMANDA_BATCH` en `.env`/`.env.example`/README.
  **Fix medido en benchmark:** con `format:'json'` Ollama sesga la
  salida a objetos — el prompt pide `{"resultados": [...]}` (no el
  array desnudo: el 100% de los lotes fallaba) y el parser acepta
  array, objeto-envuelto y objeto suelto (→ item único).
- **R16.4** `POST /api/ordenes/batch`: acepta array de órdenes, las
  valida una por una (400 con detalle del item si alguna falla, sin
  parciales silenciosos — transacción), las crea en una transacción
  y devuelve el array creado. `crear-orden` lo usa para persistir el
  lote de la corrida en una llamada (o en pocos lotes si son muchas).
  ✅ — model: `createOrdenesBatch` (verifica todos los productos
  → `faltantes` por índice; secuencia OC-NNN + INSERTs en una
  `db.transaction`, insert compartido con `createOrden` via
  `insertarOrden`); controller: `validarItemOrden` extraído y
  reusado item a item, `MAX_LOTE_ORDENES=200`; route
  `POST /batch` antes de `/:orden_id`. Harness:
  `crearOrdenesBatch` en `ordenes.client`; nodo `crear-orden`
  chunkea a 100/request y cae al loop individual si un lote
  falla (registrado en `errores`).
- **R16.5** Tests + medición: tests por pieza (cache hit/miss,
  concurrencia respeta el límite, batch con item inválido hace
  fallback, endpoint batch transaccional) + corrida comparativa del
  agente real documentando speedup vs `validacion-grafo-real`. ✅ —
  32 tests nuevos (`analisis-cache.test.js` 11, `concurrencia.test.js`
  5, `llm-json.test.js` 8, `crear-orden.test.js` 2,
  `server/ordenes-batch.test.js` 4, +2 casos de formato de lote en
  `triage-y-justificacion`); suite 117/117.
  Benchmark documentado en
  `docs/benchmarks/benchmark-spec16-optimizacion-2026-11-11.md`:
  **frío 79 s vs ~312 s baseline (~3,9×)** con 87 llamadas LLM
  (12 lotes + 75 justificaciones, 0 degradados) vs 137;
  **tibio <1 s con 0 llamadas LLM** (133 cache hits);
  108/108 órdenes vía endpoint batch (baseline perdía 41 por 429);
  GPU 88%/189 W en frío, idle en tibio.

### Tareas

- **T16.1** Cache incremental + `cache_hits` (R16.1)
- **T16.2** Concurrencia en nodos LLM + env/docs (R16.2)
- **T16.3** Batch prompts en analizar-demanda (R16.3)
- **T16.4** `POST /api/ordenes/batch` + uso en crear-orden (R16.4)
- **T16.5** Tests + benchmark comparativo (R16.5)

### Verificado por

Revisión por sub-agente en cada PR (R16.1→PR#14, R16.2→#15, R16.3→#16
con 2 pasadas, R16.4→#17 con 2 pasadas, R16.5→#18) + suite Vitest +
benchmark real con GPU/Ollama monitorizados.

---

## SPEC-17 · Higiene documental: realinear docs didácticos post SPEC-12→16

- **Fecha:** 2026-11-12
- **Estado global:** ✅ implementada — ver "Verificado por"

### Contexto técnico

El proyecto se usa como material de explicación (EXPLICACION.md +
docs/ del harness son la capa didáctica). Auditoría post SPEC-16:
la narrativa central siguió fiel (grafo, flujo atómico, batch,
retry) pero quedaron derivas puntuales — docs que describen el
estado pre-optimización y referencias al modelo viejo:

- `docs/flujo-datos.md`: la tabla de llamadas al backend seguía
  diciendo `crear-orden → POST /api/ordenes` (hoy `/batch` con
  fallback); sin paginación de leer-inventario (SPEC-14); sin
  `hashPorProducto` en el estado (SPEC-16).
- Referencias al modelo `llama3.2:1b` en README raíz, README del
  harness, `.env.example`, default de `config/env.js` y consola de
  ejemplo de `flujo-ejecucion.md` — el modelo real y el de todos
  los benchmarks es `qwen3:8b`.
- `EXPLICACION.md`: mapa de `docs/` sin `flujo-ejecucion.md` ni
  `benchmarks/`; tabla del harness sin `analisis-cache.js`;
  `utils/` sin `concurrencia.js`.
- `docs/flujo-ejecucion.md`: nodo 1 sin paginación; nodo 5 sin
  cache de justificación ni concurrencia (SPEC-16).

### Requisitos

- **R17.1** `flujo-datos.md`: endpoint batch + fallback en la
  tabla de llamadas y en la de errores; paginación en
  leer-inventario; `hashPorProducto` en el estado. ✅
- **R17.2** Alinear modelo a `qwen3:8b` donde se habla del estado
  actual: README raíz (requisito Ollama), README del harness
  (intro + `ollama pull`), `.env.example`, default de
  `config/env.js` y consola de `flujo-ejecucion.md`. Las
  referencias históricas en SPECs cerrados se conservan (son
  registro, no estado). ✅
- **R17.3** `EXPLICACION.md`: `docs/` completo en el mapa
  (4 docs + benchmarks/); `analisis-cache.js` en la tabla del
  harness; `concurrencia.js` en utils. ✅
- **R17.4** `flujo-ejecucion.md`: nodo 1 menciona la paginación;
  nodo 5 menciona cache por hash + `conLimite`. ✅

### Tareas

- **T17.1** Correcciones R17.1–R17.4 en un solo PR docs + default
  de `env.js` (R17.2 toca código: solo el string del fallback).

### Verificado por

Revisión por sub-agente del PR (diff + contraste docs↔código).

---

## SPEC-18 · Diagramas Graphviz del flujo del agente y del orquestador

- **Fecha:** 2026-11-12
- **Estado global:** ✅ implementada — ver "Verificado por"

### Contexto técnico

La capa didáctica describe los flujos en prosa y ASCII
(`flujo-ejecucion.md`, diagrama de secuencia de EXPLICACION.md);
faltaba la versión gráfica para presentación. Dos diagramas:

- `docs/diagramas/flujo-agente.*` — la corrida completa: 8 nodos
  del grafo (código vs LLM) + llamadas HTTP al backend/Ollama +
  el humano que resuelve pendientes por REST.
- `docs/diagramas/flujo-orquestador.*` — ciclo de vida de
  `orchestrator.corrida.fase`: entradas (`index.js`, `/run`,
  `/resume`, `/status`) → `corriendo` → `terminado`/`error` +
  ramas legacy `pausado`/`encolado` (compat SPEC-12).

### Requisitos

- **R18.1** Un `.dot` por diagrama en `harness-langgraph/docs/
  diagramas/` + renders `.png` (140 dpi) y `.svg` commiteados —
  regenerables con `dot -Tpng|-Tsvg` (Graphviz, no es dependencia
  del proyecto). ✅
- **R18.2** Referencias desde los docs: `flujo-ejecucion.md`
  enlaza el diagrama del agente; `arquitectura.md` enlaza el del
  orquestador; `EXPLICACION.md` lista `diagramas/` en el mapa. ✅

### Tareas

- **T18.1** flujo-agente (grafo + externos + leyenda). ✅
- **T18.2** flujo-orquestador (fases + entradas HTTP). ✅
- **T18.3** Enlaces desde docs + SPEC. ✅

### Verificado por

Revisión por sub-agente del PR (el diagrama debe reflejar el
grafo real de `graph.js` y las fases reales de `orchestrator.js`).

---

## SPEC-19 · Diagrama de la regla de negocio (audiencia no técnica)

- **Fecha:** 2026-11-12
- **Estado global:** ✅ implementada — ver "Verificado por"

### Contexto técnico

`flujo-agente` explica la corrida en términos de nodos/edges
(público técnico). Faltaba la vista de negocio: qué se hace y
por qué, en lenguaje de dominio, con lo técnico solo donde
explica el qué (el LLM como "la IA lee patrones", el umbral como
política de $100). Incluye el rol del orquestador como supervisor
en términos de gobierno del proceso.

### Requisitos

- **R19.1** `docs/diagramas/flujo-negocio.{dot,png,svg}`: los 7
  pasos del proceso en lenguaje de negocio (detectar faltantes →
  estimar demanda → calcular pedido → política de aprobación →
  justificar → emitir órdenes → avisar y cerrar) + bloque "el
  orquestador" con sus 6 responsabilidades de gobierno + la
  persona aprobadora resolviendo pendientes ≥ $100 por fuera de
  la corrida. ✅
- **R19.2** Enlazado desde `EXPLICACION.md` (es el doc de
  audiencia general) + `diagramas/` nombrado en el mapa. ✅

### Tareas

- **T19.1** Diagrama + renders + enlaces + SPEC. ✅

### Verificado por

Revisión por sub-agente del PR (las reglas del diagrama deben
matchear las de negocio reales: umbral $100, lead + 7 días, piso
2× mínimo, triage, aprobación desacoplada).

---

## SPEC-20 · Retiro del endpoint `/api/uploads` (sin consumidor)

- **Fecha:** 2026-11-12
- **Estado global:** ✅ implementada — ver "Verificado por"

### Contexto técnico

`POST /api/uploads` vino del skeleton (Anexo B: no estaba en el
brief) y **nada del dominio lo consume**: productos no tiene
campo imagen, el front no sube archivos, el agente no lo llama.
Es superficie de ataque gratuita — servía contenido arbitrario
confiando solo en la extensión (el propio test sube un script
disfrazado de `.png`). `server/uploads/` acumulaba 35 archivos
residuo de la suite. Se retira completo: ruta, static, dep
(multer), proxy, tests y convenciones.

### Requisitos

- **R20.1** Borrar `server/routes/uploads.js` y `server/uploads/`
  (residuo local, gitignored — no hay datos de usuario). ✅
- **R20.2** `server/app.js`: quitar `express.static('/uploads')`
  y la rama `MulterError` del error handler. ✅
- **R20.3** `npm uninstall multer` (era su único uso). ✅
- **R20.4** `vite.config.js`: quitar el proxy `/uploads`;
  `.gitignore`: quitar las entradas de `server/uploads`. ✅
- **R20.5** Tests: borrar el test de whitelist `.svg`
  (`app.test.js`) y reapuntar el de rate-limit a
  `POST /api/ordenes` (400 por body vacío, mismo contrato 429);
  quitar la entrada `uploads.js` del manifiesto de
  `test/api-contract.test.js`. ✅
- **R20.6** Docs: `README.md` (tabla API + proxy), `AGENTS.md`
  (convención Imágenes + no-commitear), `SPEC.md` (anotaciones
  `(retirado en SPEC-20)` en SPEC-03/06/07/09 y Anexo B — la
  historia no se reescribe). ✅

### Tareas

- **T20.1** Retiro completo + tests verdes en un solo PR.

### Verificado por

Revisión por sub-agente del PR + `npx vitest run` verde + grep
`upload` sin restos fuera de las anotaciones históricas.

---

## SPEC-21 · Dataset externo: muestra de artículos retail-radar

- **Fecha:** 2026-11-20
- **Estado global:** ✅ implementada — ver "Verificado por"

### Contexto técnico

Los precios de competencia los recolecta el pipeline aparte
(retail-radar → PostgreSQL, vistas gold). Para habilitar las
comparaciones del mercado propio se incorpora una muestra congelada
como asset del repo: los 1.471 artículos canónicos (`products`)
activos y matcheados en las 4 cadenas scrapeadas (Día, Coto,
Carrefour, La Anónima). Vive bajo `data/` para que cualquier
consumidor (esta app, seeds futuros, herramientas externas) lo
descargue directo del repo.

Decisiones de calidad aplicadas en la exportación:

- Coto precia por sucursal: `coto_price` = moda de sus 35 sucursales
  (`store_price_current`) cuando el item no tiene `last_price`
  nacional (nulos 89 → 5).
- Precios `0` → NULL (4 items de Carrefour listados a 0).
- Coto upstream tiene `price` inflado en ~14% de `store_price_current`
  (>3x `list_price`, 12k productos — p.ej. 124.124,80 vs 5.957,99):
  si el precio efectivo supera 3x el de lista, `coto_price` = lista
  (37 artículos corregidos en la muestra).
- `min_price`/`max_price`/`spread_pct` recalculados sobre los precios
  efectivos (la vista gold los computa sin el fallback de Coto).

### Requisitos

- **R21.1** `data/articles_sample.csv` — 1.471 filas + header:
  `product_id` canónico, identidad (nombre/marca/tamaño/unidad/EAN/
  `top_category`), sku/price/list_price por cadena, min/max/spread. ✅
- **R21.2** `data/export_sample.sql` — query exacta para regenerar
  la muestra contra la DB de retail-radar. ✅
- **R21.3** `data/README.md` — diccionario de columnas y notas de
  calidad del dato. ✅
- **R21.4** README raíz: sección "Datos externos". ✅

### Tareas

- **T21.1** Alta del dataset + docs en un solo PR.

### Verificado por

Revisión por sub-agente del PR + integridad del CSV (1.471 filas;
nulos solo `coto_price`×5 y `carrefour_price`×4; sin precios 0).

---

## SPEC-22 · Catálogo interno de artículos (seed real desde retail-radar)

- **Fecha:** 2026-11-20
- **Origen:** pedido del usuario — armar la base de artículos interna
  de Mercado Raíz (con código de artículo propio) sobre la muestra de
  SPEC-21; es el universo que evalúan las pruebas y el agente.
- **Estado global:** ✅ implementada — ver "Verificado por"

### Decisiones (confirmadas con el usuario)

- **Reemplaza** el seed demo (11 productos, 8 proveedores, OC-001..011,
  historial): `productos` pasa a ser el catálogo real de 1.471
  artículos. Las órdenes e historial se regeneran sobre artículos
  reales.
- **Sin vínculo a retail-radar** en la DB: no se persiste
  `product_id` ni sku/precio por cadena — el CSV queda como asset de
  referencia. Los campos internos son sku propio, nombre, marca, EAN,
  categoría, precio propio, stock.
- **Precio propio determinístico pero variable**: no es el mínimo del
  mercado — cada artículo toma un factor pseudoaleatorio (hash del
  EAN, fijo) sobre el rango `[min_price, max_price]` observado entre
  cadenas, extendido a `[0.88·base, 1.18·base)` con
  `base = (min+max)/2`. Resultado medido: ~8% por debajo del mínimo,
  ~71% dentro del rango, ~21% por encima del máximo — habilita
  análisis de competitividad futuro.
- **Stock determinístico** (hash del EAN): ~10% `CRITICO`
  (stock 0), ~20% `STOCK_BAJO` (`< min`), resto `OK`
  (`min`–`4·min`). `stock_minimo` ∈ [5,20]. Da trabajo real al agente
  de reposición en cada corrida.
- **Umbral recalibrado a escala ARS**: con precios reales,
  `UMBRAL_APROBACION = 100` dejaba muerto el camino auto-aprobado
  (toda orden supera $100). Se sube a $50.000 en backend y harness.
- **Breaking para DBs existentes**: `productos` gana columnas
  `marca`/`ean` — requiere `npm run seed` (recrea `app.sqlite`).

### Requisitos

- **R22.1** `server/seed-articulos.js`: parsea
  `data/articles_sample.csv` (22 columnas por fila; falla ruidoso si
  no) y genera las 1.471 filas de `productos` — `id` = orden del CSV
  (1..1471), `sku` = `MR` + id paddeado a 5 (`MR00001`),
  `nombre` = `canonical_name`, `marca` = `brand`, `ean`,
  `categoria` = `top_category` normalizado
  (`Desayuno y merienda` → `Desayuno y Merienda`), `precio_unitario`,
  `stock_*`, `estado` coherente (regla R5.1), `proveedor_id` por
  categoría, `ubicacion` = pasillo por categoría. Sin
  `fecha_actualizacion` (default `datetime('now')`). ✅
- **R22.2** Determinismo: mismo CSV → mismas filas (PRNG por hash
  FNV-1a del EAN, sin `Math.random` ni fechas). ✅
- **R22.3** `server/schema.sql`: `productos` gana `marca TEXT`,
  `ean TEXT`; `productos.model.js` los expone en `mapProducto`. ✅
- **R22.4** `proveedores` — 7 nuevos alineados a categoría:
  Mayorista Central (Almacén + Desayuno y Merienda, 3d), Bebidas del
  Litoral (Bebidas, 2d), Perfumería Integral (Perfumería, 4d),
  Limpieza y Hogar (Limpieza, 3d), Frescos del Sur (Frescos, 1d),
  Congelados Patagónicos (Congelados, 5d), Huerta Don Mario (Frutas y
  Verduras, 1d). ✅
- **R22.5** `ordenes_compra` — OC-001..011 regeneradas sobre
  artículos reales en `CRITICO`/`STOCK_BAJO`: `precio_unitario` =
  precio propio del artículo, `cantidad` = `2·min − actual` (fórmula
  R5.5), `monto_total` recalculado; mismo mix de estados que antes
  (4 pendientes, 4 aprobadas, 1 rechazada, 1 enviada, 1 recibida) y
  mismas fechas (tests de filtros por fecha). ✅
- **R22.6** `historial_stock` — movimientos regenerados sobre los
  mismos artículos (VENTA/AJUSTE/REPOSICION/DEVOLUCION coherentes con
  el stock sembrado). ✅
- **R22.7** Tests acoplados al seed demo actualizados:
  `api.test.js` (búsqueda por proveedor, sku, montos extremos),
  `e2e/ordenes.spec.js` (nombre de OC-001); nuevo
  `seed-articulos.test.js` (1.471 filas, formato sku, determinismo,
  coherencia estado, banda de precio, categorías). ✅
- **R22.8** Docs: README (catálogo real + regla "re-seed tras cambio
  de schema"), `data/README.md` referenciado como origen. ✅
- **R22.9** `UMBRAL_APROBACION` (R5.3): `100` → `50000` en
  `ordenes.model.js`, `harness-langgraph/src/config/env.js` (default)
  y `.env.example`. Las órdenes seed mantienen el patrón original de
  estados (incluye auto-aprobadas históricas). ✅

### Observaciones

- El seed fija `requiere_aprobacion`/`estado` por fila (es data
  histórica, no evalúa la regla): las auto-aprobadas del demo
  representan el flujo aunque hoy su monto superaría el umbral.

### Tareas

- **T22.1** Generador + schema + seed + tests + docs en un solo PR.

### Verificado por

`npx vitest run` verde (incluye `seed-articulos.test.js`),
`npm run seed` reporta `productos: 1471 filas`, smoke de
`GET /api/productos` con datos reales.

---

## SPEC-23 · Autenticación JWT (login, refresh, middleware)

- **Fecha:** 2026-11-21
- **Origen:** pedido del usuario — login profesional seguro según
  normativas (OWASP ASVS + Ley 25.326). Reemplaza `USUARIO_DEMO`
  hardcodeado por sesiones reales con roles.
- **Estado global:** ✅ implementada (T23.1+T23.2 en un solo PR —
  mergear el backend solo dejaba `main` con el front roto)

### Decisiones

- **JWT corto en memoria + refresh opaco rotativo en cookie
  httpOnly.** No localStorage (exfiltrable por XSS); no sesiones
  opacas para el access (un solo backend, lookup innecesario). El
  refresh sí persiste hasheado porque la revocación importa.
- **Hashing `crypto.scrypt` nativo** (N=2¹⁴, r=8, p=1, formato
  `$scrypt$N,r,p$salt$hash`) — *ajuste de implementación*: CI y el
  Dockerfile corren Node 22 donde `crypto.argon2Sync` aún no existe;
  scrypt nativo cubre el mismo requisito sin deps. `verifyPassword`
  también acepta hashes `$argon2id$` legacy (Node ≥24.7).
  Anti oráculo de timing: un intento sobre email inexistente,
  inactivo o bloqueado verifica contra un hash dummy → misma
  latencia que un intento real.
- **CSRF double-submit por cookie legible** — *ajuste*: el valor
  CSRF viaja en cookie `mr_csrf` (legible, `SameSite=Strict,
  Path=/`) cuyo SHA-256 se persiste en `refresh_tokens`; el front
  la lee y la reenvía como `X-CSRF-Token`. La alternativa del spec
  (devolverlo solo en el body del login) moría al recargar la
  página: `document.cookie` solo expone cookies cuyo `Path` cubre
  la URL actual.
- **Login perezoso del agente** — *ajuste*: `backend-client` no
  loguea al boot sino ante el primer 401 (ausente, vencido o
  revocado) → login + un reintento; equivalente funcional y evita
  autenticar procesos que no pegan al backend.
- **`API_RATE_LIMIT`**: el limiter global de escrituras también se
  hizo configurable (default 20/min) — los e2e acumulan
  login+refresh+POSTs sobre una misma IP en <60s.
- **Sin oráculo de usuarios**: `401` genérica idéntica para email
  inexistente y password malo; comparación timing-safe.
- **`token_version` se verifica contra DB por request**: lookup
  indexado barato que compra revocación instantánea de JWTs —
  tradeoff aceptado a cambio de no mantener sesiones opacas.
- **El agente `harness-langgraph` es consumidor de primera clase**:
  se autentica con **cuenta de servicio** (rol nuevo `SERVICIO` —
  lectura + crear órdenes, sin aprobar/rechazar) vía
  `AGENTE_EMAIL`/`AGENTE_PASSWORD` en su `.env`; `backend-client.js`
  hace login al boot y re-login en 401/expiración.
- **Breaking schema**: `usuarios` gana 5 columnas + tabla
  `refresh_tokens` + rol `SERVICIO` en el CHECK → requiere
  `npm run seed`.

### Requisitos

- **R23.1** `schema.sql`: `usuarios` += `password_hash NOT NULL`,
  `intentos_fallidos DEFAULT 0`, `bloqueado_hasta`, `ultimo_login`,
  `token_version DEFAULT 0`; `rol` CHECK gana `'SERVICIO'`. Nueva
  tabla `refresh_tokens` (`usuario_id`, `token_hash` SHA-256,
  `familia`, `expira_en`, `revocado`, `user_agent`, `ip`,
  `creado_en`).
- **R23.2** Rutas `server/routes/auth.js` (auto-mount `/api/auth`):
  - `POST /login` `{email, password}` → `200 {access_token, usuario{}}`
    + `Set-Cookie` refresh; `401` genérica; `429` por rate limit.
  - `POST /refresh` (cookie) → rota el refresh + nuevo access.
  - `POST /logout` → revoca el refresh actual.
  - `GET /me` → `200` usuario actual / `401` sin token válido.
  - `POST /cambiar-password` `{actual, nueva}` (autenticado) →
    `token_version++` + revoca **todos** sus refresh incluido el de
    la sesión actual → el cliente vuelve a `/login`.
- **R23.3** Password ≥12 chars (NIST 800-63 — sin reglas de
  composición forzadas).
- **R23.4** JWT HS256 vía `jose`, payload mínimo
  `{sub, rol, token_version}`, `exp=15min`. `JWT_SECRET` en `.env`
  y placeholder en `.env.example`; nunca en logs ni en el bundle.
- **R23.5** Refresh: 256-bit `crypto.randomBytes`; solo se persiste
  su SHA-256; cookie `HttpOnly; Secure(prod); SameSite=Strict;
  Path=/api/auth`; exp 7 días; rotación por uso; **reuse detection** —
  un refresh ya usado revoca la familia completa.
- **R23.6** Middleware `requireAuth` (Bearer válido +
  `token_version` vs DB) y `requireRole(...roles)`. Se aplica a todas
  las rutas del dominio salvo `/api/auth/login`, `/api/auth/refresh`
  y `/api/health`. `aprobado_por`/`rechazado_por` salen del token —
  el body ya no los setea.
- **R23.7** Seguridad del login: lockout por cuenta (5 fallos →
  `bloqueado_hasta = +15min`; contador resetea en éxito); rate limit
  propio `POST /login` vía `AUTH_RATE_LIMIT` (default 10/min/IP,
  configurable — CI/e2e comparten IP; **declarada en `.env.example`**
  junto a `JWT_SECRET`); CSRF double-submit (`X-CSRF-Token` header
  con valor devuelto por `POST /login`) en endpoints que consumen la
  cookie.
- **R23.8** Front: ruta `/login` (email + password + checkbox
  **no pre-tildado** "Acepto la política de privacidad" — regla del
  proyecto; submit `disabled` hasta válido); `src/lib/auth.js` con
  token en memoria + `me()` al boot (silent refresh vía cookie);
  `api.js` adjunta `Authorization: Bearer`, en 401 → un refresh →
  retry una vez; guard de rutas (sin sesión → `/login`); logout
  limpia memoria + POST `/logout`. `USUARIO_DEMO` se elimina y el
  `aprobado_por` sale de la sesión.
- **R23.9** Seed: `password_hash` para los 3 usuarios demo; README
  "Usuarios demo" documenta email + password dev + flujo login.
- **R23.10** Compliance: `/privacidad` suma datos de cuenta
  (credenciales hasheadas, refresh tokens retenidos 7 días,
  `ultimo_login`) — minimización Ley 25.326 (JWT solo `sub`+`rol`).
- **R23.11** Agente (harness): usuario servicio
  `agente@mercadorai.com` rol `SERVICIO` en el seed; credenciales
  `AGENTE_EMAIL`/`AGENTE_PASSWORD` en `harness-langgraph/.env` +
  `.env.example`; `integrations/backend-client.js` hace login al
  primer request, guarda el access token en memoria y re-login en
  401/expiración. Los scripts (`stress-llm.mjs`,
  `smoke-rate-limit.mjs`) pasan por el mismo cliente — siguen
  funcionando.
- **R23.12** Deps nuevas: `jose@^6.2.17` (JWT) vía `npm add` —
  argon2 salió nativo de `node:crypto` (ver Decisiones).
- **R23.13** Tests existentes: `api.test.js`, `ordenes-batch.test.js`
  y e2e pasan a requerir sesión — helper `loginComo(rol)` que hace
  login una vez por suite y adjunta el Bearer; `api-client.test.js`
  adapta el flujo a `auth.js`.

### Tareas

- **T23.1** ✅ Núcleo auth backend: schema + endpoints `/api/auth/*` +
  middleware aplicado a rutas existentes + cuenta servicio agente +
  seed passwords + tests.
- **T23.2** ✅ Front login + integración (`auth.js`, guards, quita
  `USUARIO_DEMO`, e2e login→aprobar→logout).

### Verificado por

Vitest: login 200/401/429/lockout, refresh rota + reuse revoca
familia, logout revoca, `me` 401, `requireRole` 403, `token_version`
invalida JWTs tras cambio de password. E2E login → aprobar con
usuario real → logout → redirect. Review por sub-agente del PR.

---

## SPEC-24 · Gestión de usuarios y roles (admin)

- **Fecha:** 2026-11-21
- **Origen:** pedido del usuario — endpoints para agregar, editar y
  eliminar usuarios con manejo de roles. Depende de SPEC-23 (auth +
  matriz de roles base).
- **Estado global:** ✅ implementada — ver "Verificado por"

### Decisiones

- **Soft delete**: `activo=0` + revocación de tokens — preserva la
  auditoría (`historial_stock.usuario`, `ordenes.aprobado_por`
  referencian emails históricos). `email` sigue UNIQUE: re-crear un
  email borrado → `409` con sugerencia de reactivar vía `PATCH`.
- **Solo ADMIN** gestiona usuarios; un admin no puede borrarse,
  desactivarse ni quitarse el rol a sí mismo, ni dejar al sistema
  sin el último ADMIN activo (`409`) — el guard aplica tanto a
  `DELETE` como a `PATCH` (`rol`/`activo`).
- **Crear órdenes** no exige rol elevado: cualquier usuario
  autenticado (incluido `SERVICIO`) puede `POST /api/ordenes` y
  `/batch`.

### Matriz de roles

| Rol | Alcance |
|---|---|
| `ADMIN` | Todo + gestión de usuarios (`/api/usuarios/*`) |
| `GERENTE` | Aprobar/rechazar órdenes + lectura del dominio |
| `APROBADOR` | Aprobar/rechazar órdenes + lectura del dominio |
| `SERVICIO` | Cuenta del agente (R23.11): lectura + crear órdenes — no aprueba/rechaza ni gestiona usuarios |

### Requisitos

- **R24.1** `GET /api/usuarios` (ADMIN): paginado `page/limit`
  (mismo contrato que `/api/productos`), filtros `rol`, `activo`,
  `search` (email/nombre). La respuesta nunca incluye
  `password_hash` ni campos de seguridad (whitelist explícita).
- **R24.2** `POST /api/usuarios` (ADMIN): `{email, nombre, rol,
  password}` → `201` usuario; `409` email duplicado; `400` con
  detalle si rol ∉ ENUM o password <12 chars. Mismo hash que login
  (scrypt nativo — ver decisión en SPEC-23).
- **R24.3** `PATCH /api/usuarios/:id` (ADMIN): edita `nombre`,
  `email`, `rol`, `activo`. Cambio de `rol` o `activo=0` →
  `token_version++` + revoca sus refresh tokens (cierra sesiones).
  Los guards de self y último ADMIN aplican igual que en R24.4.
- **R24.4** `DELETE /api/usuarios/:id` (ADMIN): soft delete
  (`activo=0`) + `token_version++` + revoca tokens; `409` si el
  target es self o el último ADMIN activo.
- **R24.5** `requireRole` aplicado por endpoint según la matriz:
  `/api/usuarios/*` solo ADMIN; aprobar/rechazar exige APROBADOR+;
  lecturas y creación de órdenes cualquier autenticado.
- **R24.6** Front (solo ADMIN — regla UI n°2: sin acceso, la sección
  no se renderiza): pantalla "Usuarios" con tabla paginada, alta
  (`FormShell`, password ≥12, submit `disabled` hasta válido),
  edición con gate de cambios reales, activar/desactivar,
  `EmptyState`/`ErrorState` ante vacío/falla.
- **R24.7** Contrato de errores consistente con el dominio:
  `400` validación, `401` sin sesión, `403` rol insuficiente,
  `404` usuario inexistente, `409` conflictos (email, self, último
  admin).

### Tareas

- **T24.1** Backend CRUD `/api/usuarios` + matriz de roles +
  revocación + tests. ✅ implementada — `GET/POST/PATCH/DELETE
  /api/usuarios` bajo `requireRole('ADMIN')` (`server/routes/usuarios.js`
  → controller → `models/usuarios.model.js`); listado paginado con
  whitelist explícita (nunca `password_hash`/`token_version`/campos de
  bloqueo); alta con `409` email dup + `400` rol/password<12; PATCH y
  DELETE aplican guards self/último-ADMIN (`409`) y revocan sesiones
  (`token_version++` + refreshes) ante cambio de rol o `activo=0`.
- **T24.2** Front pantalla admin de usuarios + e2e. ✅ implementada —
  ruta `/usuarios` solo para `ADMIN` (`src/pages/Usuarios.jsx`; al
  resto se niega con 404 sin delatar la ruta), tabla paginada con
  búsqueda/filtro de rol, modal alta/edición con submit gateado
  (válido + checkbox privacidad + cambios reales en edición), toggle
  activar/desactivar con self bloqueado, badge "vos" en la fila
  propia, `EmptyState`/`ErrorState`. Item "Usuarios" en `Sidebar`
  filtrado por rol.

### Verificado por

Vitest: CRUD completo, 403 no-admin, email duplicado, self-delete,
último admin, revocación tras cambio de rol/desactivación, whitelist
sin `password_hash`. E2E: admin crea/edita/desactiva usuario; usuario
sin rol no ve la sección. Review por sub-agente del PR.

---

## SPEC-25 · Migración de persistencia a PostgreSQL (`mercadoraiz-db`)

- **Fecha:** 2026-11-23
- **Origen:** pedido del usuario — migrar la base SQLite a
  PostgreSQL; la base se llama `mercadoraiz-db`. Es la primera
  tarea del roadmap nuevo: SPEC-26 (demanda real + proveedores) y
  todo desarrollo posterior se implementan **ya sobre Postgres**.
- **Estado global:** ⏳ planificada

### Decisiones

- **Base única canónica**: `mercadoraiz-db` en Postgres ≥16 (el
  nombre con guion exige comillas en psql — `"mercadoraiz-db"` — pero
  viaja tal cual en `DATABASE_URL`). Los tests corren contra una base
  hermana `mercadoraiz-db-test` en la misma instancia; CI usa un
  service container `postgres:16`.
- **SQLite deja de ser driver de runtime**: no se mantiene modo
  dual. Queda solo como origen del script de migración de datos
  (T25.4) y del historial del repo. Mantener dos dialectos duplica
  superficie sin beneficio — la suite corre directo contra PG.
- **Sync → async**: `better-sqlite3` es síncrono y los drivers PG
  (`pg`/`postgres.js`) son async — la capa de datos pasa a interfaz
  `await` (`all/get/run/tx`) y modelos/controllers se convierten.
  Es el cambio estructural mayor del spec.
- **`timestamptz` canónico**: las columnas `TEXT` de fecha pasan a
  `timestamptz`. El JSON serializa ISO-8601 con `Z` (hoy la app
  escribe `YYYY-MM-DDTHH:MM:SS` y los defaults `datetime('now')`
  emiten con espacio) — el front y el harness comparan fechas y
  deben auditarse (`ordenes.model.js` documenta una comparación
  sensible al formato).
- **Schema**: `AUTOINCREMENT` → `GENERATED ALWAYS AS IDENTITY`;
  `datetime('now', '+N units')` → `now() + interval 'N units'`;
  `LIKE` → `ILIKE` (SQLite LIKE es case-insensitive en ASCII y PG no);
  placeholders `?` → `$1..$n`; `CHECK (estado IN ...)` se conserva;
  defaults `datetime('now')` → `now()`.
- **Harness**: `SqliteSaver` → `PostgresSaver`
  (`@langchain/langgraph-checkpoint-postgres`) contra `mercadoraiz-db`
  o schema separado; el cache de análisis migra a tabla PG.
- **Driver elegido**: `pg` (node-postgres) con `Pool` — maduro,
  estable, API estándar. Sin ORM: las queries viven en los modelos
  (convención MVC vigente).

### Requisitos

- **R25.1** `server/db.js` deja de exponer el objeto
  `better-sqlite3`: pasa a exponer una interfaz async
  (`get/all/run/query` + `tx(fn)` con `BEGIN/COMMIT`) implementada
  sobre `pg.Pool`. `DATABASE_URL`/`PG*` en `.env` + `.env.example`;
  `DB_HOST` default `localhost`, base `mercadoraiz-db`.
- **R25.2** Schema portado: `server/schema.pg.sql` (o `schema.sql`
  ya en dialecto PG si SQLite queda retirado) — idempotente
  (`CREATE TABLE IF NOT EXISTS`), índices equivalentes, FKs igual.
- **R25.3** Toda query de los modelos traducida: `$n` params,
  funciones de fecha PG, `ILIKE`, `INSERT ... RETURNING id` donde
  el caller usaba `lastInsertRowid`, `ON CONFLICT` conservado.
- **R25.4** Modelos y controllers async; `seed-data.js`/`seed.js`
  insertan en transacciones `tx()`. `seedIfEmpty` conserva su
  semántica (solo si tabla vacía).
- **R25.5** Infra: `docker-compose.yml` con servicio `postgres:16`
  (db `mercadoraiz-db`, volumen persistente, healthcheck); README
  con `docker compose up` como prerequisito de dev. El servicio del
  compose se llama `mercadoraiz-db`. (El compose es infra de dev —
  la regla de AGENTS.md sobre archivos Docker cubre el build de la
  app, no esto; se aclara en `AGENTS.md` en la misma tarea.)
- **R25.6** Suite completa contra PG: Vitest con `PG*_TEST` o
  `DATABASE_URL_TEST` → `mercadoraiz-db-test` (truncate/reset entre
  tests); Playwright y smokes levantan contra la misma instancia.
  CI agrega service `postgres` + envs. Todas las vars (runtime y
  test) se declaran en `.env.example`.
- **R25.7** Script de migración `server/migrate-sqlite-to-pg.js`:
  lee `server/app.sqlite` existente y vuelca productos, proveedores,
  órdenes, historial y usuarios (password hashes migran tal cual —
  scrypt es agnóstico al motor). **No** migra `refresh_tokens` ni
  datos volátiles; los usuarios re-loguean.
- **R25.8** Auditoría de fechas: front (`src/lib/api.js`, páginas)
  y harness dejan de asumir formato SQLite; cualquier comparación
  `fecha < ahora` usa `Date` parseado, no strings.
- **R25.9** Harness: checkpointer `PostgresSaver` + cache de
  análisis en tabla PG; `checkpoints.sqlite` y `app.sqlite` quedan
  fuera de uso (gitignored, borrables tras migración exitosa). Las
  métricas siguen en memoria (hoy no se persisten — fuera de
  scope).
- **R25.10** Contrato HTTP inmutable: ningún endpoint cambia shape
  salvo el formato de fechas (ISO-8601 `timestamptz`) — documentado
  como divergencia en Anexo B si el front requería el formato viejo.

### Tareas

- **T25.1** Capa de datos async: interfaz `get/all/run/tx` en
  `db.js` sobre `pg`, conversión de los 6 modelos + controllers +
  seed a `await`; schema PG; suite verde contra `mercadoraiz-db-test`.
  ✅ implementada — `server/db.js` expone `openDb()` async con
  pool `pg` + helpers `get/all/run/prepare/tx` (traducción `?`→`$n`
  respeta literales); `schema.sql` en dialecto PG (`IDENTITY`,
  `timestamptz`, `DOUBLE PRECISION`); tests con schema aislado por
  archivo (`searchPath`), `closeDb(true)` lo dropea; `npm run seed`
  trunca+repuebla. Suite: 169 vitest + 20 e2e + smoke API real.
- **T25.2** Infra de dev/CI: `docker-compose.yml` (servicio
  `mercadoraiz-db`), `.env.example` (`DATABASE_URL`), service
  container en CI, README actualizado. ✅ implementada —
  `docker-compose.yml` con `postgres:16` + volumen persistente +
  healthcheck + `scripts/init-test-db.sql` (crea
  `mercadoraiz-db-test` al primer boot); CI con service postgres
  (entró con T25.1 para no dejar main rojo); README documenta
  `docker compose up -d` como prerequisito; `AGENTS.md` aclara la
  excepción compose-dev.
- **T25.3** Harness a PG: `PostgresSaver`, cache de análisis y
  métricas sobre la misma base; `.env.example` del harness.
  ✅ implementada — `PostgresSaver` + `setup()` crea tablas
  `checkpoint_*` en `mercadoraiz-db`; `src/harness/pg.js` (pool
  compartido, `DATABASE_URL_TEST` en vitest); `analisis_cache`
  pasó de JSON local a tabla PG (async, fail-soft: read caído =
  miss, write caído = log y sigue); comparación de análisis
  canónica (JSONB reordena claves); métricas quedan en memoria
  por diseño; `@langchain/langgraph-checkpoint-sqlite` retirada.
- **T25.4** Migración de datos: script sqlite→pg + validación
  (counts por tabla, muestras) + doc de corte en README.
  ✅ implementada — `server/migrate-sqlite-to-pg.js` lee la base
  vieja con `node:sqlite` nativo (sin deps) y copia proveedores →
  productos → usuarios → ordenes → historial en una tx con
  `SET LOCAL TIME ZONE 'UTC'` (los timestamps naive de sqlite son
  UTC); intersecta columnas para bancar schemas viejos; preserva
  `password_hash`, NO migra `refresh_tokens`; guard de corte único
  (destino no vacío → aborta); `openDb({sembrar:false})` aplica el
  schema sin seed. Verificado end-to-end: counts OK, `+00` en
  timestamptz, secuencia avanzada.
- **T25.5** Auditoría de fechas front+harness y limpieza:
  retirar `better-sqlite3` del backend, `checkpoints.sqlite`,
  `app.sqlite` y doc de obsoleto en `AGENTS.md`/`SPEC.md`.
  ✅ implementada — `date(fecha_creacion)` → `date(... AT TIME
  ZONE 'UTC')` en ordenes/dashboard (PG usaba TZ de sesión, SQLite
  era UTC naíf); `utils/fecha.js#diaUtc` reemplaza `slice(0,10)`
  en los 4 puntos del harness; `fmtFecha` de Usuarios parsea ISO
  y muestra TZ local; diagramas regenerados (Express + Postgres);
  artefactos `checkpoints.sqlite*` eliminados; `better-sqlite3`
  ya fuera de deps (la migración usa `node:sqlite` nativo).

### Verificado por

Pendiente — por tarea: suite Vitest+E2E contra PG en CI, smoke
manual de la migración (counts y muestras coinciden con
`app.sqlite`), corrida del agente end-to-end sobre PG.

---

## SPEC-26 · Demanda real y proveedores enriquecidos (sobre PostgreSQL)

- **Fecha:** 2026-11-23
- **Origen:** pedido del usuario — que la "demanda estimada" que
  redacta el LLM en `analisis_ia` salga de datos reales y no de un
  historial vacío, y que el tiempo de entrega del proveedor venga
  de una tabla administrable. Depende de SPEC-25 (las tablas
  nuevas se crean directo en Postgres).
- **Estado global:** ⏳ planificada
- **Contexto:** hoy `historial_stock` seedea 7 movimientos sobre
  7 productos → ~1.460 SKUs sin ventas → `demanda_diaria = 0` →
  la prosa del LLM es correcta pero vacía. El `tiempo_entrega_dias`
  del proveedor ya es dato real (join `ordenes→proveedores`), pero
  la tabla no es administrable ni tiene variabilidad.

### Decisiones

- **Tabla `ventas` separada** (opción B evaluada):
  `historial_stock` modela *posición* de stock
  (`cantidad_anterior→cantidad_nueva`); sembrar cadenas coherentes
  de posición para 60–90 días × 1.471 SKUs es artificial y frágil.
  `ventas(producto_id, fecha, unidades, canal)` modela el hecho de
  negocio directo; `historial_stock` queda para movimientos
  operativos reales. El agente y el backend leen `/api/ventas`.
- **Seed determinístico**: mismo hash FNV-1a por EAN que los precios
  (SPEC-22) → seeds reproducibles; velocidad base por categoría +
  ruido + efecto fin de semana + tendencias leves; ~10–15% de SKUs
  sin ventas (productos nuevos) para que "demanda 0" siga siendo un
  camino honesto.
- **Ventana**: últimos 90 días, 1 fila/día por producto con unidades
  >0 (~40–80k filas — trivial para PG).
- **Consistencia con stock**: las ventas sembradas no re-descuentan
  `stock_actual` (es historial para estimar demanda, no replay);
  documentado en `seed-articulos`.
- **Proveedores enriquecidos**: la tabla existe (SPEC-02); se
  agregan lead time mín/máx y atributos de negocio, y se expone
  CRUD admin — hoy no hay forma de editar proveedores por API/UI.
- **Una sola fuente de verdad**: la estimación de demanda vive en
  el backend (`/api/estadisticas/demanda`); el agente la consume y
  el dashboard muestra las mismas métricas — no se duplica la
  lógica en el harness.

### Requisitos

- **R26.1** `CREATE TABLE ventas` (PG): `id`, `producto_id` FK,
  `fecha` date, `unidades` int >0, `canal` ('POS'|'WEB'|'MAYOR'),
  `referencia`. Índices `(producto_id, fecha)` y `(fecha)`.
- **R26.2** `GET /api/ventas` autenticado: filtros `producto_id`,
  `desde`, `hasta`, paginado estándar. El harness cambia
  `historial.client` → `ventas.client`; los items traen
  `fecha` + `unidades` (no `diferencia` como `historial_stock`) —
  `analizar-demanda` remapea el campo al consumirlos.
- **R26.3** Seed de ventas: `server/seed-ventas.js` genera 90 días
  por SKU con perfil por categoría (rotación alta en Frescos,
  media en Almacén/Bebidas, baja en Perfumería/Limpieza), ruido
  determinístico, ±fin de semana, tendencia leve aleatoria
  (crece/cae/estable), `canal` ponderado. ~10–15% SKUs sin ventas.
  Inserta en `tx()` por lotes.
- **R26.4** Proveedores: columnas nuevas `tiempo_entrega_min_dias`,
  `tiempo_entrega_max_dias`, `confiabilidad_pct`, `pedido_minimo_monto`,
  `costo_envio`, `categorias_cubiertas` (texto/JSONB). El lead de
  cálculo pasa a usar el valor esperado (`min`+`max`)/2 o
  `tiempo_entrega_dias` si no hay rango — documentado.
- **R26.5** CRUD `GET/POST/PATCH/DELETE /api/proveedores` solo
  ADMIN: `DELETE` es siempre soft delete (`activo=0`) — el
  histórico de órdenes conserva la referencia; `409` solo si el
  proveedor tiene órdenes `PENDIENTE_APROBACION`/`ENVIADA` vivas
  (desactivar cortaría el flujo de esas órdenes).
- **R26.6** Pantalla admin `/proveedores` (solo ADMIN en sidebar):
  tabla, alta/edición con `FormShell` gateado, activar/desactivar,
  `EmptyState`/`ErrorState` — mismas reglas UI que `/usuarios`.
- **R26.7** `GET /api/estadisticas/demanda?producto_id=&dias=90`:
  `demanda_diaria` (media móvil ponderada por recencia), `tendencia`
  (pendiente regresión lineal sobre agregado diario), `cv`, `dias_con_venta`,
  `dias_en_quiebre` (días con stock 0 en el período — no cuentan como
  demanda 0 en el denominador; fuente a definir en T26.5 — si no hay
  dato confiable responde `null`, nunca inventado), `ultima_venta`.
  Consumida por el agente y por el front.
- **R26.8** Agente: `analizar-demanda` usa la nueva fuente; con
  `dias_con_venta ≥ 3` y CV bajo → heurístico backend; si no → LLM
  con los agregados reales en el prompt. `calcular-cantidad` suma
  stock de seguridad por variabilidad del lead
  (`z·σ_demanda·√lead_esperado`, `z=1.65` ~95% service level) —
  fórmula y constantes en `config`.
- **R26.9** Superficie: `analisis_ia` cita demanda/tendencia reales
  (ya lo hace el prompt — con datos no triviales); el dashboard
  agrega columna "demanda/día" y "días de cobertura" en productos o
  detalle de orden (datos de `/api/estadisticas/demanda`); el modal
  sigue mostrando lead real del proveedor.
- **R26.10** Sin regresión: productos sin ventas siguen generando
  `demanda_diaria = 0` y orden de reposición mínima (comportamiento
  actual del fallback), documentado en tests.

### Tareas

- **T26.1** `ventas` + `GET /api/ventas` + `seed-ventas.js`
  (determinístico, 90d, perfiles por categoría) + tests.
- **T26.2** Enriquecer `proveedores` (R26.4) + seed actualizado.
- **T26.3** CRUD `/api/proveedores` admin + tests.
- **T26.4** Pantalla `/proveedores` front + e2e.
- **T26.5** `/api/estadisticas/demanda` (R26.7) + tests.
- **T26.6** Harness: `ventas.client`, `analizar-demanda` y
  `calcular-cantidad` sobre la nueva fuente + stock de seguridad
  (R26.8) + tests de nodos.
- **T26.7** Dashboard: columna demanda/cobertura (R26.9) + e2e.

### Verificado por

Pendiente — por tarea: tests de `seed-ventas` (determinismo por EAN,
perfiles, % sin ventas), CRUD proveedores (409 con referencias,
whitelist), endpoint demanda (ponderación, quiebres, tendencia),
suite e2e, corrida del agente mostrando `demanda_diaria > 0` real
en `analisis_ia` para SKUs con historial.

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
| (post-gen) | SPEC-11 | `harness-langgraph/scripts/stress-llm.mjs` | smokes + kill test |
| (post-gen) | SPEC-12 | `src/langgraph/{graph,nodes,edges}`, `server/harness-notify.js` | `tests/nodes/` |
| (post-gen) | SPEC-13 ✅ | `server/security.js`, `integrations/backend-client.js`, `harness/error-handler.js`, `tests/harness/reintentos-429.test.js` | `reintentos-429.test.js` (8) + smoke 25/25 |
| (post-gen) | SPEC-14 ✅ | `integrations/productos.client.js` | `paginacion-productos.test.js` (5) |
| (post-gen) | SPEC-15 ✅ | `harness-langgraph/.gitignore`, `harness/orchestrator.js` | verificación git |
| (post-gen) | SPEC-16 ✅ | `harness/analisis-cache.js`, `utils/{concurrencia,llm-json}.js`, `langgraph/nodes/*`, `server/models|controllers|routes/ordenes*` | `analisis-cache`, `concurrencia`, `crear-orden`, `ordenes-batch` (22 tests) + benchmark |
| (post-gen) | SPEC-22 ✅ | `server/seed-articulos.js`, `server/seed-data.js`, `server/schema.sql`, `server/models/{productos,ordenes}.model.js` | `seed-articulos.test.js` (8) + `api.test.js`, `ordenes-batch.test.js`, e2e actualizados |
| (post-gen) | SPEC-25 ⏳ | `server/db.js`, `server/schema.sql`→PG, `docker-compose.yml`, `server/migrate-sqlite-to-pg.js`, `harness-langgraph` (PostgresSaver) | suite Vitest+E2E contra PG, smoke de migración |
| (post-gen) | SPEC-26 ⏳ | `server/seed-ventas.js`, `server/{routes,models,controllers}/{ventas,proveedores,estadisticas}.*`, `src/pages/Proveedores.jsx`, `harness-langgraph` nodos demanda | tests seed/CRUD/demanda + e2e + corrida agente |

## Anexo B — Divergencias brief ↔ implementación

| Brief | Implementado | Nota |
|---|---|---|
| Base `/api/v1` | `/api` | Convención de auto-mount del skeleton (más simple; no rompe nada interno) |
| 7 endpoints | 8 | `GET /api/historial` viene del skeleton, no del brief; `POST /api/uploads` también venía del skeleton — retirado en SPEC-20 |
| `aprobado_por: "auto"` en mock | default `'sistema'` | El mock del brief usaba "auto"; el controller defaultea `'sistema'` |
| `rechazado_por` en body de rechazo | aceptado, default `'sistema'` | Consistente con aprobar |
| Tabla `usuarios` con roles | ~~Sin endpoints ni login~~ → login JWT + CRUD usuarios | ~~Persistida y seedeada; solo `USUARIO_DEMO` en el cliente. Alcance demo~~ — superseded por SPEC-23/24 |
| Sidebar con 5 secciones | 2 ítems (Dashboard, Órdenes) | Regla UI n°2: nav sin destino real no se renderiza |
| `src/data/orders.js` mock | Residual | El mock se reemplazó; queda `ESTADOS` (badges) + `formatMoney` |
| Fórmula `2×min − actual` | Igual + cobertura de demanda del agente | El agente añade `demanda × (lead + 7)` por encima del brief original |

## Anexo C — Prompt original

El brief completo que generó el proyecto está en `plan.json` → campo
`idea` (28,852 chars). `plan.json.steps` contiene las 6 instrucciones
de ejecución referenciadas en cada SPEC.
