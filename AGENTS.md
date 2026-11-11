# Convenciones del proyecto

Este proyecto fue generado por MetaBuilder. Stack esperado:

- **Frontend**: React + Vite + Tailwind CSS (si aplica)
- **Backend**: Node.js + Express (si aplica)
- **Base de datos**: SQLite (archivo local, sin servidores externos) (si aplica)
- **Testing**: Vitest (unit/integración), Playwright + Chromium (E2E, si hay frontend)

## Reglas de UI obligatorias (React + Tailwind)

1. No agregar propiedades a componentes no utilizados; confiar solo en los datos disponibles del backend.
2. Los componentes no soportados no deben renderizar y no deben romper el flujo de la aplicación (fallback silencioso o controlado).
3. Si una URL está vacía, no se debe mostrar ningún icono ni intentar abrirse ninguna ventana.
4. Los botones de acción (ej. "Guardar", "Enviar") deben estar deshabilitados (`disabled`) por defecto y solo habilitarse cuando se detecten cambios reales en los campos del formulario.
5. Si una consulta a la API no devuelve resultados, la UI debe mostrar un estado de fallback informativo (nunca una pantalla en blanco o un error crudo).

## Guía de diseño (obligatoria — el resultado debe verse moderno y limpio)

- **Íconos**: usar `lucide-react` (ya instalado). NUNCA cuadrados/círculos de color como placeholder de ícono — si un dato no tiene ícono propio, usar uno genérico (`Sparkles`) o nada. La data puede llevar un campo `icon` con nombre en kebab-case mapeado a componentes.
- **Paleta**: neutra (slate/stone/zinc) + 1 color de acento — máximo 2 colores de marca en toda la página.
- **Tipografía**: system-ui/Inter; headings `font-bold tracking-tight` (`text-3xl`–`text-5xl`), body `text-sm/base`, contraste alto.
- **Layout**: contenedores `max-w-6xl mx-auto px-6`; secciones `py-16` o `py-24`; grids `gap-6`/`gap-8`.
- **Cards**: `rounded-2xl bg-white ring-1 ring-<neutro>-200 shadow-sm hover:shadow-md transition`.
- **Botones**: `rounded-full` o `rounded-lg`, `px-6 py-3 font-semibold`; primario sólido + `hover:` visible; secundario outline.
- **Hero**: gradiente sutil (`bg-gradient-to-b`) o fondo sólido oscuro + badge/logo con ícono Lucide real; nunca un div vacío de color.
- **Navbar** simple con nombre/logo + links de ancla a las secciones.
- Contenido no provisto por el usuario → lorem ipsum breve; bloque con ícono Lucide si no hay imagen.
- **Imágenes (licencias)**: la app puede venderse — SOLO imágenes con licencia que permita **uso comercial + redistribución**: `images.unsplash.com` (Unsplash License), `images.pexels.com` (Pexels License), `cdn.pixabay.com` (Pixabay Content License). **Prohibido** hotlink (la request expone la IP del visitante y la URL puede rotar): la imagen se **descarga a `public/images/`** y se referencia local; registrar fuente+licencia en `public/images/LICENSES.txt`. Nunca Google images ni fuentes arbitrarias (licencia no verificable); si ninguna fuente libre aplica (o el usuario exige una imagen que no puede verificarse), usar el `public/images/placeholder.svg` del skeleton (bloque dashed "Seleccionar imagen" — el usuario reemplaza el archivo; es asset propio, sin licencia) — nunca imagen remota ni `<img>` vacío.


## Kit de componentes (`src/components/ui.jsx`)

El skeleton trae bloques pre-styled — **componerlos/parametrizarlos,
no reescribirlos**: `Section`, `Navbar`, `Hero`, `Card`, `StatCard`,
`EmptyState`, `ErrorState`, `FormShell` (submit gateado por `disabled`),
`CTA`. Acento configurable: `accent="indigo|emerald|amber"` (mapa de
clases literales — Tailwind no genera clases dinámicas). Si un bloque
necesita variante, extenderlo con `className` antes que duplicar markup.

## Reglas de privacidad y seguridad (obligatorias)

- Todo formulario que capture datos personales exige un checkbox **no pre-tildado** "Acepto la política de privacidad" (link a `/privacidad`) — el botón de enviar solo se habilita marcado.
- Debe existir una página/sección `/privacidad` con aviso de datos (qué se recolecta, finalidad, retención, derechos ARCO, contacto del responsable) y link visible en el footer.
- Prohibido scripts de terceros con cookies/trackers (analytics, pixels, embebidos con tracking) sin banner de consentimiento previo.
- Nunca `dangerouslySetInnerHTML` con datos de usuario o de la API.
- SQL siempre con prepared statements — nunca interpolar valores en queries.
- Secretos solo en `.env` (gitignored); declarar en `.env.example`. Nunca en logs ni en el bundle del frontend.


## Comandos que deben existir

- `npm run build` — build de producción
- `npm run dev` — dev server en puerto 5173
- `npx vitest run` — suite Vitest
- `npm run test:e2e` — suite e2e
- `npm run api` — API en puerto 4000
- `npm run dev:api` — lo mismo con `--watch`
- `npm run seed` — puebla la DB con datos realistas (el front consume datos reales)

## Notas para el agente que escribe código

- Mantener los pasos atómicos y autocontenidos: cada tarea debe dejar el proyecto en un estado compilable.
- **Estado (front)**: `lib/api.js` como cliente único del backend (fetch + error handling centralizado); `useState` local por componente, `useReducer` para flujos multi-paso (formularios/wizard/cart). Sin librería de estado (Redux/Zustand/MobX) — fuera del scope: rápido, funcional, fácil de conectar front↔back.
- Si la app tiene login/usuarios del seed, documentarlos en el README (sección 'Usuarios demo' con email+password dev y el rol de cada uno).
- Al final del README, una sección 'Prompt' con el prompt original del usuario (si el plan tiene sección BACKEND, incluirla entera).
- No commitear `node_modules/`, `.env`, `*.sqlite`, `server/uploads/*`, `dist/`, `out/` ni `build/`.
- Al escribir tests E2E con Playwright, cubrir explícitamente las reglas de UI de arriba.
- **Backend**: cada `server/routes/<name>.js` que exporte un `Router` default se monta solo en `/api/<name>` — no tocar `server/app.js` ni `server/db.js`.
- **Imágenes**: `POST /api/uploads` con campo `file` (image/*, máx 5MB) → `{ url: "/uploads/<file>" }`. Guardar ese path en la entidad; el frontend lo consume tal cual (el proxy de Vite redirige `/uploads` al puerto 4000).
- **Secretos/config**: API keys y config sensible van en `.env` (gitignored), leídas via `process.env.NOMBRE` — `server/index.js` ya carga `dotenv/config`. Toda variable que la app use debe declararse en `.env.example` (commiteado, con valor placeholder o vacío) para que otro dev sepa qué configurar. Nunca hardcodear secretos ni commitear `.env`.
- **Docker**: `Dockerfile`, `.dockerignore` (y `nginx.conf` si aplica) los provee el orquestador — no modificarlos ni crear otros. El backend ya sirve `dist/` si existe, así que el contenedor fullstack corre solo `node server/index.js`.
- **Capa de datos**: schema en `server/schema.sql` (idempotente), seed en `server/seed-data.js` (se inserta si la tabla está vacía); queries con `q()` prepared statements de `server/db.js` (despacha por `DB_DRIVER`).

## Arquitectura backend

**Arquitectura MVC**: `server/routes/*.js` solo mapean HTTP → `server/controllers/`; los controllers orquestan request/response y delegan a `server/models/` (fat models con toda la lógica de negocio y las queries SQLite via `server/db.js`). Al agregar endpoints: route fino + método en controller + lógica en model.

## Workflow de cambios (obligatorio)

Toda modificación al repo sigue este pipeline — **PR por tarea en
github.com/damianra/mercado-raiz**:

1. **Spec primero**: antes de tocar código, registrar el cambio en `SPEC.md` — como SPEC nuevo o como tarea (`TN.x`) dentro del SPEC vigente.
2. **Rama por tarea**: una rama por tarea, creada desde `main` actualizado — `feat/`, `fix/`, `docs/`, `test/`, `refactor/` + nombre descriptivo.
3. **Commits semánticos**: `tipo(scope): descripción` (`feat`, `fix`, `docs`, `test`, `refactor`, `chore`).
4. **PR por tarea**: `git push -u origin <rama>` + `gh pr create` con summary y test plan — uno por tarea, no acumular cambios.
5. **Aprobación funcional por sub-agente**: un sub-agente revisa el PR (diff, tests, smokes del comportamiento real) — **merge solo si aprueba**. Si no, iterar la corrección en la misma rama/PR y re-enviar hasta la aprobación.
6. **Merge vía PR**: `gh pr merge --merge --delete-branch` recién aprobado (merge commit, preserva los commits semánticos de la tarea); `git checkout main && git pull` antes de abrir la siguiente rama.
7. **Repo siempre documentado**: si la tarea toca comportamiento, actualizar en el mismo PR lo que corresponda — `SPEC.md` (estados/requisitos), `README.md`, `harness-langgraph/docs/`, `.env.example` y demás docs afectados.
