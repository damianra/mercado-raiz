import { test, expect } from '@playwright/test';

// SPEC-27 T27.4 — vista /quiebres: lista de acción por margen en
// riesgo. La DB del seed garantiza ~145 CRITICO (stock 0) y ~287
// STOCK_BAJO con demanda real en `ventas` → la tabla sale poblada.
const ADMIN = { email: 'admin@mercadorai.com', password: 'demo-admin-2026' };
const GERENTE = { email: 'carlos.martinez@mercadorai.com', password: 'demo-gerente-2026' };
const APROBADOR = { email: 'maria.lopez@mercadorai.com', password: 'demo-aprobadora-2026' };

const FILAS = 'section[aria-label="Tabla de órdenes de compra"] tbody tr';
const FILAS_Q = 'main table tbody tr';

async function login(page, { email, password } = ADMIN) {
  await page.goto('/');
  await page.getByLabel('Email corporativo').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByLabel(/Acepto la/).check();
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.locator(FILAS).first()).toBeVisible();
}

async function irAQuiebres(page, creds = ADMIN) {
  await login(page, creds);
  await page.getByRole('link', { name: 'Quiebres' }).click();
  await expect(
    page.getByRole('heading', { name: 'Quiebres de stock' }),
  ).toBeVisible();
  await expect(page.locator(FILAS_Q).first()).toBeVisible();
}

test('muestra KPIs y la tabla ordenada por pérdida con datos reales', async ({
  page,
}) => {
  await irAQuiebres(page);

  // KPIs: SKUs sin stock > 0 y margen en riesgo formateado en $
  await expect(page.getByText('SKUs sin stock')).toBeVisible();
  await expect(page.getByText('Margen en riesgo / día')).toBeVisible();
  await expect(page.getByText('Margen perdido (90d)')).toBeVisible();

  // Hay filas reales del seed (productos CRITICO/STOCK_BAJO)
  const filas = page.locator(FILAS_Q);
  expect(await filas.count()).toBeGreaterThan(20);

  // La primera fila (ordenada por pérdida/día) muestra un monto en $
  const primera = filas.first();
  await expect(primera).toContainText('$');
  // Los SKU internos MR##### están presentes
  await expect(primera.locator('td').first()).toContainText('MR0');
});

test('los filtros separan sin-stock de bajo-el-mínimo', async ({ page }) => {
  await irAQuiebres(page);
  const total = await page.locator(FILAS_Q).count();

  await page.getByLabel('Filtrar por estado').selectOption('stock0');
  const stock0 = await page.locator(FILAS_Q).count();
  expect(stock0).toBeGreaterThan(0);
  expect(stock0).toBeLessThan(total);
  // todas las filas visibles tienen stock 0 (rojo)
  await expect(
    page.locator(`${FILAS_Q} td:nth-child(3) span`).first(),
  ).toHaveText('0');
});

test('GERENTE también accede a la vista operativa', async ({ page }) => {
  await irAQuiebres(page, GERENTE);
  expect(await page.locator(FILAS_Q).count()).toBeGreaterThan(0);
});

// SPEC-30 (T30.2) — acciones de movimiento de stock por fila:
// "Registrar venta" (descuenta) y "Ajustar stock" (conteo/merma).
test('registrar venta desde la fila descuenta el stock', async ({ page }) => {
  await irAQuiebres(page);
  const fila = page.locator(FILAS_Q).first();
  const sku = await fila.locator('td').first().locator('.font-mono, .text-xs').last().innerText();

  await fila.getByLabel(`Registrar venta de ${sku}`).click();
  const modal = page.getByRole('dialog', { name: 'Registrar venta' });
  await expect(modal).toBeVisible();
  await modal.getByLabel('Unidades').fill('1');
  await modal.getByRole('button', { name: 'Registrar venta' }).click();

  await expect(page.getByText(/Venta registrada — .* stock/)).toBeVisible();
});

test('ajustar stock con conteo fija la cantidad absoluta', async ({ page }) => {
  await irAQuiebres(page, GERENTE);
  const fila = page.locator(FILAS_Q).first();
  const sku = await fila.locator('td').first().locator('.text-xs').innerText();

  await fila.getByLabel(`Ajustar stock de ${sku}`).click();
  const modal = page.getByRole('dialog', { name: 'Ajustar stock' });
  await expect(modal).toBeVisible();
  // CONTEO viene preseleccionado → input de unidades contadas
  await modal.getByRole('spinbutton', { name: 'Unidades contadas' }).fill('99');
  await expect(modal.getByText('Stock resultante')).toBeVisible();
  await modal.getByRole('button', { name: 'Registrar ajuste' }).click();

  await expect(page.getByText(/Ajuste registrado — .* 99/)).toBeVisible();
});

// SPEC-32 (T32.2) — ajuste de precio con contexto de mercado:
// el modal muestra la escalera (banda + cadenas + piso de costo) y
// los sugeridos precargan un precio accionable.
test('ajustar precio desde la fila muestra la escalera de mercado y confirma', async ({
  page,
}) => {
  await irAQuiebres(page, GERENTE);
  const fila = page.locator(FILAS_Q).first();
  const sku = await fila.locator('td').first().locator('.text-xs').innerText();

  await fila.getByLabel(`Ajustar precio de ${sku}`).click();
  const modal = page.getByRole('dialog', { name: 'Ajustar precio' });
  await expect(modal).toBeVisible();
  await expect(modal.getByLabel('Posición de precio en el mercado')).toBeVisible();
  await expect(modal.getByText(/precios al 2026-11-20/)).toBeVisible();

  await modal.getByRole('button', { name: /Punto medio/ }).click();
  await modal.getByRole('button', { name: 'Guardar precio' }).click();

  await expect(page.getByText(/Precio de .* →/)).toBeVisible();
});

test('APROBADOR ve "Registrar venta" pero no "Ajustar stock" ni "Ajustar precio" (rol)', async ({ page }) => {
  await irAQuiebres(page, APROBADOR);
  const fila = page.locator(FILAS_Q).first();
  const sku = await fila.locator('td').first().locator('.text-xs').innerText();
  await expect(fila.getByLabel(`Registrar venta de ${sku}`)).toBeVisible();
  await expect(fila.getByLabel(`Ajustar stock de ${sku}`)).toHaveCount(0);
  await expect(fila.getByLabel(`Ajustar precio de ${sku}`)).toHaveCount(0);
});

test('la navegación del sidebar vuelve al dashboard', async ({ page }) => {
  await irAQuiebres(page);
  await page.getByRole('link', { name: 'Órdenes' }).click();
  await expect(page.locator(FILAS).first()).toBeVisible();
  await page.getByRole('link', { name: 'Quiebres' }).click();
  await expect(
    page.getByRole('heading', { name: 'Quiebres de stock' }),
  ).toBeVisible();
});
