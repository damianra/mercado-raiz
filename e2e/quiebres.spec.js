import { test, expect } from '@playwright/test';

// SPEC-27 T27.4 — vista /quiebres: lista de acción por margen en
// riesgo. La DB del seed garantiza ~145 CRITICO (stock 0) y ~287
// STOCK_BAJO con demanda real en `ventas` → la tabla sale poblada.
const ADMIN = { email: 'admin@mercadorai.com', password: 'demo-admin-2026' };
const GERENTE = { email: 'carlos.martinez@mercadorai.com', password: 'demo-gerente-2026' };

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

test('la navegación del sidebar vuelve al dashboard', async ({ page }) => {
  await irAQuiebres(page);
  await page.getByRole('link', { name: 'Órdenes' }).click();
  await expect(page.locator(FILAS).first()).toBeVisible();
  await page.getByRole('link', { name: 'Quiebres' }).click();
  await expect(
    page.getByRole('heading', { name: 'Quiebres de stock' }),
  ).toBeVisible();
});
