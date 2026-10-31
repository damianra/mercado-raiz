import { test, expect } from '@playwright/test';

// Flujo principal UI→API contra la base seedeada (Playwright levanta
// `npm run seed && npm run api` en :4000 + Vite en :5173 — ver
// playwright.config.js). El front habla con la API real vía el proxy
// de Vite; los estados límite (vacío, error, loading) se fuerzan
// interceptando /api/ordenes en el browser.

const FILAS = 'section[aria-label="Tabla de órdenes de compra"] tbody tr';

async function cargarDashboard(page) {
  await page.goto('/');
  await expect(page.locator(FILAS).first()).toBeVisible();
}

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
  await page.goto('/');
  const body = await (await ordenesReq).json();

  expect(Array.isArray(body.data)).toBe(true);
  expect(body.data.length).toBeGreaterThan(0);
  // Datos del seed: OC-001 (Leche Entera 1L, auto-aprobada) existe tal cual.
  const oc1 = body.data.find((o) => o.orden_id === 'OC-001');
  expect(oc1).toBeTruthy();
  expect(oc1.producto?.nombre).toBe('Leche Entera 1L');
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
    await expect(filas.nth(i).locator('td').nth(5)).toHaveText('Pendiente');
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
    filas.filter({ hasText: ordenId }).locator('td').nth(5),
  ).toHaveText('Aprobada');
});

test('muestra skeleton mientras la API responde', async ({ page }) => {
  let release;
  const gate = new Promise((r) => (release = r));
  await page.route(/\/api\/ordenes/, async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto('/');
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
  await page.goto('/');
  await expect(page.getByText('Sin resultados')).toBeVisible();
  await expect(
    page.getByText('No hay órdenes que coincidan'),
  ).toBeVisible();
});

test('muestra un error controlado si la API cae', async ({ page }) => {
  await page.route(/\/api\/ordenes/, (route) => route.abort());
  await page.goto('/');
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
  await page.goto('/');
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
