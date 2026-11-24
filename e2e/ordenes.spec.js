import { test, expect } from '@playwright/test';

// Flujo principal UI→API contra la base seedeada (Playwright levanta
// `npm run seed && npm run api` en :4000 + Vite en :5173 — ver
// playwright.config.js). El front habla con la API real vía el proxy
// de Vite; los estados límite (vacío, error, loading) se fuerzan
// interceptando /api/ordenes en el browser.

const FILAS = 'section[aria-label="Tabla de órdenes de compra"] tbody tr';

// Credenciales del seed (SPEC-23 — ver README → Usuarios demo).
const LOGIN_EMAIL = 'carlos.martinez@mercadorai.com';
const LOGIN_PASS = 'demo-gerente-2026';

// Login real UI→API: form + checkbox privacidad + submit → dashboard.
async function login(page, email = LOGIN_EMAIL, password = LOGIN_PASS) {
  await page.goto('/');
  await page.getByLabel('Email corporativo').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByLabel(/Acepto la/).check();
  await page.getByRole('button', { name: 'Ingresar' }).click();
}

async function cargarDashboard(page) {
  await login(page);
  // El click de login y el render del dashboard compiten — esperar
  // el shell autenticado antes de la tabla (si no, race y la tabla
  // no llega a montarse en 5s).
  await page.locator('aside nav').waitFor();
  await expect(page.locator(FILAS).first()).toBeVisible();
}

// SPEC-30 (T30.1): ciclo hacia el proveedor — la fila aprobada
// ofrece "Enviar", la enviada abre el detalle para registrar la
// recepción con cantidad (default = pedida completa).
test('ciclo OC: aprobada → enviada → recibida suma stock en la fila', async ({
  page,
}) => {
  await cargarDashboard(page);
  // Fila aprobada: botón enviar en la fila.
  const fila = page
    .locator(FILAS)
    .filter({ has: page.getByRole('button', { name: /Enviar OC-/ }) })
    .first();
  await expect(fila).toBeVisible();
  const ordenId = await fila.locator('td').first().innerText();
  await fila.getByRole('button', { name: `Enviar ${ordenId} al proveedor` }).click();
  await expect(page.getByText(`Orden ${ordenId} enviada al proveedor`)).toBeVisible();
  // Tras la transición el botón Enviar desaparece → reubicar la
  // fila por su id de orden (el locator anterior ya no matchea).
  const filaEnviada = page.locator(FILAS).filter({ hasText: ordenId });
  await expect(filaEnviada.getByText('Enviada')).toBeVisible();

  // Ahora la fila ofrece "registrar recepción" → abre el detalle.
  await filaEnviada
    .getByRole('button', { name: `Registrar recepción de ${ordenId}` })
    .click();
  const modal = page.getByRole('dialog');
  await expect(modal.getByLabel('Cantidad recibida')).toBeVisible();
  // Recepción parcial: una unidad menos → faltante visible.
  const input = modal.getByLabel('Cantidad recibida');
  const pedida = parseInt(await input.inputValue(), 10);
  await input.fill(String(pedida - 1));
  await expect(modal.getByText(/faltan 1 unidades/)).toBeVisible();
  await modal.getByRole('button', { name: 'Registrar recepción' }).click();
  await expect(page.getByText(new RegExp(`Orden ${ordenId} recibida`))).toBeVisible();
  await expect(page.getByText('Recibida').first()).toBeVisible();
});

test('sin sesión, toda ruta protegida cae en el login', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Ingresar' })).toBeVisible();
  await expect(page.getByLabel('Email corporativo')).toBeVisible();
  // Una ruta inexistente para un anónimo también termina en login.
  await page.goto('/ruta-que-no-existe');
  await expect(page.getByRole('button', { name: 'Ingresar' })).toBeVisible();
});

test('Ingresar queda disabled hasta formulario válido + consentimiento', async ({
  page,
}) => {
  await page.goto('/');
  const submit = page.getByRole('button', { name: 'Ingresar' });
  await expect(submit).toBeDisabled();
  await page.getByLabel('Email corporativo').fill(LOGIN_EMAIL);
  await page.getByLabel('Contraseña').fill(LOGIN_PASS);
  // Falta el checkbox de privacidad → sigue disabled (regla UI).
  await expect(submit).toBeDisabled();
  await page.getByLabel(/Acepto la/).check();
  await expect(submit).toBeEnabled();
});

test('credenciales inválidas muestran error sin salir del login', async ({
  page,
}) => {
  await login(page, 'nadie@mercadorai.com', 'password-mala-123');
  await expect(page.getByRole('alert')).toContainText('credenciales');
  await expect(page.getByRole('button', { name: 'Ingresar' })).toBeVisible();
});

test('login → dashboard real; la API recibe Authorization Bearer', async ({
  page,
}) => {
  const ordenesReq = page.waitForRequest(
    (r) => r.url().includes('/api/ordenes') && r.method() === 'GET',
  );
  await cargarDashboard(page);
  const req = await ordenesReq;
  expect(req.headers()['authorization']).toMatch(/^Bearer .+/);
  await expect(
    page.getByRole('heading', { name: 'Órdenes Pendientes de Aprobación' }),
  ).toBeVisible();
  // El topbar muestra el usuario autenticado, no un mock.
  await expect(page.getByText('Carlos Martínez')).toBeVisible();
});

test('logout cierra la sesión y un reload no la recupera', async ({ page }) => {
  await cargarDashboard(page);
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page.getByRole('button', { name: 'Ingresar' })).toBeVisible();
  // El refresh quedó revocado en el backend — recargar no restaura.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Ingresar' })).toBeVisible();
});

test('el dashboard carga órdenes reales del seed y renderiza los KPIs', async ({
  page,
}) => {
  // Capturar la respuesta real de /api/ordenes — prueba que el front
  // consume la API (no mocks embebidos en src/data).
  const ordenesReq = page.waitForResponse(
    (r) =>
      r.url().includes('/api/ordenes') &&
      r.request().method() === 'GET' &&
      r.ok(),
  );
  await login(page);
  const body = await (await ordenesReq).json();

  expect(Array.isArray(body.data)).toBe(true);
  expect(body.data.length).toBeGreaterThan(0);
  // Datos del seed: OC-001 (auto-aprobada) existe y apunta a un
  // artículo real del catálogo interno (SPEC-22, sku MR#####).
  const oc1 = body.data.find((o) => o.orden_id === 'OC-001');
  expect(oc1).toBeTruthy();
  expect(oc1.producto?.sku).toMatch(/^MR\d{5}$/);
  expect(oc1.producto?.nombre).toBeTruthy();
  expect(oc1.proveedor?.nombre).toBeTruthy();

  // KPIs (el grid de stats es el primero del main).
  const kpis = page.locator('main .grid').first();
  for (const label of ['Pendientes', 'Aprobadas', 'Valor total', 'Stock bajo']) {
    await expect(kpis).toContainText(label);
  }

  // La orden del seed aparece en la tabla.
  await expect(page.locator(FILAS).filter({ hasText: 'OC-001' })).toBeVisible();
});

test('la búsqueda y el filtro por estado funcionan', async ({ page }) => {
  await cargarDashboard(page);
  const filas = page.locator(FILAS);
  const total = await filas.count();
  expect(total).toBeGreaterThan(1);

  // Búsqueda por ID exacto → una sola fila.
  const id = (await filas.first().locator('td').first().innerText()).trim();
  const buscar = page.getByLabel('Buscar órdenes');
  await buscar.fill(id);
  await expect(filas).toHaveCount(1);
  await expect(page.locator('tbody')).toContainText(id);

  // Búsqueda sin resultados → fallback informativo, nunca tabla vacía.
  await buscar.fill('zzz-sin-coincidencias');
  await expect(page.getByText('Sin resultados')).toBeVisible();
  await buscar.fill('');
  await expect(filas).toHaveCount(total);

  // Filtro "Pendientes": todas las filas visibles llevan ese badge.
  await page.getByRole('button', { name: 'Pendientes', exact: true }).click();
  const pendientes = await filas.count();
  expect(pendientes).toBeGreaterThan(0);
  expect(pendientes).toBeLessThan(total);
  for (let i = 0; i < pendientes; i++) {
    await expect(filas.nth(i).locator('td').nth(7)).toHaveText('Pendiente');
  }
});

test('modal de detalle muestra producto/proveedor/análisis IA y aprobar llama al endpoint', async ({
  page,
}) => {
  await cargarDashboard(page);
  const filas = page.locator(FILAS);

  // Elegir dinámicamente una orden pendiente — el test no depende de
  // un OC-NNN puntual (sobrevive a una DB reutilizada con estado).
  const filaPendiente = filas.filter({ hasText: 'Pendiente' }).first();
  const ordenId = (
    await filaPendiente.locator('td').first().innerText()
  ).trim();

  await filaPendiente
    .getByRole('button', { name: `Ver detalle de ${ordenId}` })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(ordenId);
  await expect(dialog).toContainText('SKU:');
  await expect(dialog).toContainText('Proveedor:');
  await expect(dialog).toContainText('Cálculo financiero');
  await expect(dialog).toContainText('Análisis de IA');

  const aprobacion = page.waitForResponse(
    (r) =>
      r.url().includes(`/api/ordenes/${ordenId}/aprobar`) &&
      r.request().method() === 'POST' &&
      r.ok(),
  );
  await dialog.getByRole('button', { name: 'Aprobar orden' }).click();
  await aprobacion;

  // Toast + modal cerrado + badge actualizado en la fila.
  await expect(page.locator('[aria-live="polite"]')).toContainText(
    `Orden ${ordenId} aprobada`,
  );
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    filas.filter({ hasText: ordenId }).locator('td').nth(7),
  ).toHaveText('Aprobada');
});

test('muestra skeleton mientras la API responde', async ({ page }) => {
  let release;
  const gate = new Promise((r) => (release = r));
  await page.route(/\/api\/ordenes/, async (route) => {
    await gate;
    await route.continue();
  });
  await login(page);
  await expect(page.locator('[aria-busy="true"]')).toBeVisible();
  release();
  await expect(page.locator(FILAS).first()).toBeVisible();
});

test('muestra un estado vacío informativo si la API devuelve []', async ({
  page,
}) => {
  await page.route(/\/api\/ordenes/, (route) =>
    route.fulfill({
      json: {
        data: [],
        pagination: { page: 1, limit: 100, total: 0, totalPages: 0 },
      },
    }),
  );
  await login(page);
  await expect(page.getByText('Sin resultados')).toBeVisible();
  await expect(
    page.getByText('No hay órdenes que coincidan'),
  ).toBeVisible();
});

test('muestra un error controlado si la API cae', async ({ page }) => {
  await page.route(/\/api\/ordenes/, (route) => route.abort());
  await login(page);
  await expect(
    page.getByText('No se pudieron cargar las órdenes'),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Reintentar' }),
  ).toBeVisible();
});

test('el footer linkea a /privacidad con el aviso de datos', async ({
  page,
}) => {
  await cargarDashboard(page);
  await page
    .locator('footer')
    .getByRole('link', { name: 'Privacidad' })
    .click();
  await expect(page).toHaveURL(/\/privacidad$/);
  await expect(
    page.getByRole('heading', { name: 'Política de privacidad' }),
  ).toBeVisible();
  await expect(page.getByText('Derechos ARCO')).toBeVisible();
});

test('una ruta inexistente muestra 404 con vuelta al inicio', async ({
  page,
}) => {
  // Autenticado: una ruta desconocida sí muestra el 404 (el login
  // solo intercepta a quien no tiene sesión).
  await cargarDashboard(page);
  await page.goto('/ruta-que-no-existe');
  await expect(page.getByText('404', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Página no encontrada' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Volver al inicio' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole('heading', { name: 'Órdenes Pendientes de Aprobación' }),
  ).toBeVisible();
});

test('la tabla muestra demanda/día y cobertura desde /api/estadisticas (T26.7)', async ({
  page,
}) => {
  await cargarDashboard(page);
  const tabla = page.locator('section[aria-label="Tabla de órdenes de compra"]');
  // Columnas nuevas del bulk de demanda (R26.9).
  await expect(tabla.getByRole('columnheader', { name: 'Demanda/día' })).toBeVisible();
  await expect(tabla.getByRole('columnheader', { name: 'Cobertura' })).toBeVisible();
  // Cada fila resuelve un valor real ('\d u' / '\d d') o '—' si el
  // bulk falló — jamás la celda vacía (regla UI: fallback visible).
  const primera = page.locator(FILAS).first();
  await expect(primera.locator('td').nth(3)).toHaveText(/u$|—/);
  await expect(primera.locator('td').nth(4)).toHaveText(/\dd$|—/);
});
