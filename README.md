# mercado-raiz

prompt front - back Qwen 3.7
> App generada automáticamente por [MetaBuilder Orchestrator](https://github.com/damianra/metabuilder-orchestrator) usando Devin (via ACP).

**MERCADO RAÍZ** — *"Del campo a tu mesa, con inteligencia"*. Panel de control de órdenes de compra para un retailer de alimentos: detecta stock bajo, genera órdenes de compra y somete a aprobación humana las que superan **$100**. Incluye además un agente autónomo de reposición (`harness-langgraph/`) que ejecuta el ciclo completo con un LLM local.

## Captura

![Captura de la app](screenshot.png)

## Stack

- React + Vite + Tailwind CSS (frontend)
- Node.js + Express + SQLite (backend, arquitectura MVC)
- Vitest (tests) + Playwright + Chromium (E2E)
- LangGraph + Ollama (agente de reposición, `harness-langgraph/`)

## Requisitos

- Node.js >= 20
- (Opcional, para el agente) Ollama con `qwen3:8b`

## Levantar el proyecto

```bash
npm install
cp .env.example .env   # opcional: PORT
npm run seed           # puebla la DB con datos realistas
npm run dev            # frontend en http://localhost:5173
npm run api            # API Express en http://localhost:4000
```

El proxy de Vite redirige `/api` y `/uploads` al puerto 4000 en dev.

### Agente de reposición (opcional)

```bash
npm --prefix harness-langgraph install   # deps del agente (también requeridas por `npm test`: la suite incluye harness-langgraph/tests/)
npm run agente   # harness-langgraph (requiere la API en :4000 y Ollama en :11434)
```

El agente lee productos con stock bajo, estima demanda con el LLM, crea órdenes vía HTTP y termina — la corrida es atómica (SPEC-12). Las órdenes que superan el umbral quedan `PENDIENTE_APROBACION` y se aprueban/rechazan desde el dashboard por REST puro del backend. Ver `harness-langgraph/README.md`.

## Scripts

| Comando | Descripción |
|---|---|
| `npm run dev` | Frontend Vite en :5173 |
| `npm run api` | API Express en :4000 |
| `npm run dev:api` | API con `--watch` |
| `npm run seed` | Puebla la DB (idempotente, solo si está vacía) |
| `npm run build` | Build de producción a `dist/` |
| `npm test` / `npx vitest run` | Suite Vitest (unit + integración) |
| `npm run test:e2e` | E2E Playwright (Chromium) |
| `npm run agente` | Agente LangGraph de reposición |

## API

Base `/api` (auto-mount de `server/routes/<name>.js`). Endpoints principales:

- `GET /api/ordenes` — lista paginada (filtros: `estado`, `requiere_aprobacion`, `fecha_desde/hasta`, `search`, `sort`)
- `GET /api/ordenes/:orden_id` — detalle con `producto{}` y `proveedor{}` anidados
- `POST /api/ordenes` — crea orden (`monto_total` calculado server-side; `>= $100` → `PENDIENTE_APROBACION`)
- `POST /api/ordenes/batch` — array de órdenes en una transacción (todo o nada; 400 con detalle por índice si algún item falla — SPEC-16)
- `POST /api/ordenes/:orden_id/aprobar` · `POST /api/ordenes/:orden_id/rechazar` (requiere `motivo`)
- `GET /api/productos` — lista paginada, `estado` recalculado al leer
- `GET /api/dashboard/stats` — KPIs del dashboard
- `GET /api/historial` — movimientos de stock
- `POST /api/uploads` — imagen (≤5MB) → `{ url }`

Contrato completo en `SPEC.md` → SPEC-03.

## Specs

La especificación completa (SDD) está en [`SPEC.md`](SPEC.md). Cada SPEC declara origen → requisitos → contrato → implementación → tests:

| SPEC | Alcance |
|---|---|
| SPEC-01 | Sistema de diseño y shell UI (paleta, tipografía, sidebar/topbar) |
| SPEC-02 | Modelo de datos (schema idempotente, seed, WAL) |
| SPEC-03 | API REST del dominio (contrato de endpoints, errores) |
| SPEC-04 | Integración front ↔ back (`api.js`, mapeo de estados, reglas de UI) |
| SPEC-05 | Reglas de negocio (umbral $100, `OC-NNN`, fórmula de cantidad) |
| SPEC-06 | Seguridad y compliance (headers, rate limit, uploads, `/privacidad`) |
| SPEC-07 | Testing (suites y cobertura) |
| SPEC-08 | Agente LangGraph (grafo, checkpoints, human-in-the-loop) |
| SPEC-09 | DevEx y operación (scripts, Docker, CI, `.env`) |

## Usuarios demo

No hay login (alcance demo): el cliente usa un `USUARIO_DEMO` hardcodeado. La tabla `usuarios` se persiste y seedea con:

| Email | Rol |
|---|---|
| carlos.martinez@mercadorai.com | GERENTE |
| maria.lopez@mercadorai.com | APROBADOR |
| admin@mercadorai.com | ADMIN |

## Tests

```bash
npx vitest run      # tests unitarios e integración
npm run test:e2e    # E2E Playwright (Chromium) — levanta seed + api + dev solo
```

## Deploy

Si el proyecto se generó con `--github`, el build de `dist/` queda publicado en GitHub Pages (`https://<usuario>.github.io/mercado-raiz/`). Pages sirve solo el frontend; en apps fullstack el backend corre aparte (`npm run api`).

El `Dockerfile` multi-stage construye `dist/` y corre `node server/index.js`, que sirve API + estáticos en un solo contenedor.

## Prompt

El brief original que generó el proyecto está commiteado en [`plan.json`](plan.json) → campo `idea` (~29KB, incluye la sección BACKEND completa: schema, endpoints, lógica de negocio y mocks). `plan.json.steps` contiene las 6 instrucciones de ejecución; la trazabilidad plan → spec → código → tests está en `SPEC.md` → Anexo A.
