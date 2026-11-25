import { test, expect } from '@playwright/test';

// SPEC-33 (T33.4) — /vencimientos: cola de lotes con vencimiento
// (estados, días restantes, valor en riesgo), baja como merma con
// confirmación en dos pasos, liquidación vía ajuste de precio, e
// input de fecha en la recepción de OC para perecederos. El seed
// garantiza ~2% de lotes vencidos y ~ventana de próximos (T33.1),
// así que los filtros VENCIDO/PROXIMO siempre tienen filas.

const GERENTE = {
  email: 'carlos.martinez@mercadorai.com',
  password: 'demo-gerente-2026',
};
const BUYER = { email: 'buyer@mercadorai.com', password: 'demo-buyer-2026' };

const FILAS = 'main table tbody tr';

async function login(page, { email, password } = GERENTE) {
  await page.goto('/');
  await page.getByLabel('Email corporativo').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByLabel(/Acepto la/).check();
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.locator('aside nav')).toBeVisible();
}

async function irAVencimientos(page) {
  await login(page);
  await page.getByRole('link', { name: 'Vencimientos' }).click();
  await expect(
    page.getByRole('heading', { name: 'Vencimientos' }),
  ).toBeVisible();
  await expect(page.locator(FILAS).first()).toBeVisible();
}

test('la vista lista lotes con estado, días y valor en riesgo', async ({
  page,
}) => {
  await irAVencimientos(page);
  // KPIs de la cola.
  await expect(page.getByText('Unidades vencidas')).toBeVisible();
  await expect(page.getByText('Por vencer', { exact: true })).toBeVisible();
  await expect(page.getByText('Valor en riesgo').first()).toBeVisible();
  // La tabla trae badges de estado y días restantes.
  await expect(
    page.locator(FILAS).getByText(/^(Vencido|Próximo|Vigente|Agotado)$/).first(),
  ).toBeVisible();
  await expect(
    page.locator(FILAS).getByText(/^(hoy|hace \d+d|\d+d)$/).first(),
  ).toBeVisible();
});

test('el filtro por estado deja solo lotes vencidos', async ({ page }) => {
  await irAVencimientos(page);
  await page.getByLabel('Filtrar por estado').selectOption('VENCIDO');
  await expect(page.locator(FILAS).first()).toBeVisible();
  // Todas las filas visibles llevan el badge Vencido y "hace Nd".
  await expect(page.locator(FILAS).getByText('Vigente')).toHaveCount(0);
  await expect(page.locator(FILAS).getByText('Vencido').first()).toBeVisible();
  await expect(
    page.locator(FILAS).getByText(/^hace \d+d$/).first(),
  ).toBeVisible();
});

test('dar de baja un lote vencido lo marca Agotado (confirmación en dos pasos)', async ({
  page,
}) => {
  await irAVencimientos(page);
  await page.getByLabel('Filtrar por estado').selectOption('VENCIDO');
  const fila = page.locator(FILAS).first();
  const codigo = (await fila.locator('td').nth(1).innerText()).trim();
  // Paso 1: el botón abre la confirmación inline (no ejecuta).
  await fila.getByRole('button', { name: `Dar de baja el lote ${codigo}` }).click();
  const confirmar = fila.getByRole('button', {
    name: `Confirmar baja del lote ${codigo}`,
  });
  await expect(confirmar).toBeVisible();
  // Paso 2: confirmar ejecuta la merma — toast + badge Agotado.
  await confirmar.click();
  await expect(page.getByText(`Lote ${codigo} dado de baja`)).toBeVisible();
  await expect(fila.getByText('Agotado')).toBeVisible();
});

test('liquidar abre el ajuste de precio con motivo LIQUIDACION', async ({
  page,
}) => {
  await irAVencimientos(page);
  // Filtro VENCIDO → la primera fila tiene stock y acciones.
  await page.getByLabel('Filtrar por estado').selectOption('VENCIDO');
  const fila = page.locator(FILAS).first();
  await fila.getByRole('button', { name: /Liquidar precio de / }).click();
  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible();
  await expect(modal.getByLabel(/Motivo/)).toHaveValue('LIQUIDACION');
});

test('el buyer no tiene entrada en el menú y recibe 404 en la ruta', async ({
  page,
}) => {
  await login(page, BUYER);
  await expect(
    page.getByRole('link', { name: 'Vencimientos' }),
  ).toHaveCount(0);
  await page.goto('/vencimientos');
  await expect(page.getByText(/no encontrada|404/i).first()).toBeVisible();
});

test('la recepción de un perecedero ofrece cargar el vencimiento del lote', async ({
  page,
}) => {
  await login(page);
  // El access token vive en memoria del módulo (SPEC-23) — para los
  // llamados API del test hago un login propio y uso el Bearer.
  const sesion = await page.request.post('/api/auth/login', {
    data: { email: GERENTE.email, password: GERENTE.password },
  });
  const { access_token: token } = await sesion.json();
  const auth = { headers: { Authorization: `Bearer ${token}` } };

  // OC de un perecedero (Frescos → vida_util_dias=14) via API:
  // sin aprobación → APROBADA, luego enviar.
  const prods = await page.request.get(
    '/api/productos?categoria=Frescos&limit=1',
    auth,
  );
  const { data: productos } = await prods.json();
  const producto = productos[0];
  const creada = await page.request.post('/api/ordenes', {
    ...auth,
    data: {
      producto_id: producto.id,
      cantidad: 5,
      requiere_aprobacion: false,
    },
  });
  const { data: orden } = await creada.json();
  await page.request.post(`/api/ordenes/${orden.orden_id}/enviar`, auth);
  // La tabla cargó durante el login — recargar para ver la OC nueva.
  await page.reload();
  await expect(page.locator('aside nav')).toBeVisible();

  // La fila enviada abre el detalle → input de fecha visible.
  const fila = page
    .locator('section[aria-label="Tabla de órdenes de compra"] tbody tr')
    .filter({ hasText: orden.orden_id });
  await fila
    .getByRole('button', { name: `Registrar recepción de ${orden.orden_id}` })
    .click();
  const modal = page.getByRole('dialog');
  const inputFecha = modal.getByLabel('Vencimiento del lote');
  await expect(inputFecha).toBeVisible();
  const vence = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  await inputFecha.fill(vence);
  await modal.getByRole('button', { name: 'Registrar recepción' }).click();
  await expect(
    page.getByText(`Orden ${orden.orden_id} recibida`),
  ).toBeVisible();

  // El lote de la OC quedó con la fecha cargada (no el default
  // +14d) — el codigo del lote es el orden_id (R33.4).
  const lotes = await page.request.get(
    `/api/lotes?producto_id=${producto.id}&limit=100`,
    auth,
  );
  const { data: lotesData } = await lotes.json();
  const loteOc = lotesData.find((l) => l.codigo === orden.orden_id);
  expect(loteOc).toBeTruthy();
  expect(loteOc.fecha_vencimiento).toBe(vence);
  expect(loteOc.cantidad_actual).toBe(5);
});
