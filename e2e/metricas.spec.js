import { test, expect } from '@playwright/test';

// SPEC-28 T28.2 — vista /metricas: scorecard agregado. El seed
// garantiza proveedores con SKUs y órdenes, stock 0 y dead stock
// → todas las secciones salen pobladas.
const ADMIN = { email: 'admin@mercadorai.com', password: 'demo-admin-2026' };
const GERENTE = { email: 'carlos.martinez@mercadorai.com', password: 'demo-gerente-2026' };

const FILAS = 'section[aria-label="Tabla de órdenes de compra"] tbody tr';
const FILAS_PROV = 'main table tbody tr';

async function login(page, { email, password } = ADMIN) {
  await page.goto('/');
  await page.getByLabel('Email corporativo').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByLabel(/Acepto la/).check();
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.locator(FILAS).first()).toBeVisible();
}

async function irAMetricas(page, creds = ADMIN) {
  await login(page, creds);
  await page.getByRole('link', { name: 'Métricas' }).click();
  await expect(
    page.getByRole('heading', { name: 'Métricas del negocio' }),
  ).toBeVisible();
  await expect(page.locator(FILAS_PROV).first()).toBeVisible();
}

test('muestra KPIs, riesgo, inventario y scorecard de proveedores', async ({
  page,
}) => {
  await irAMetricas(page);

  // KPIs del scorecard
  await expect(page.getByText('Fill rate')).toBeVisible();
  await expect(page.getByText('Margen en riesgo / día')).toBeVisible();
  await expect(page.getByText('Inventario a costo')).toBeVisible();
  await expect(page.getByText('Órdenes por aprobar')).toBeVisible();

  // buckets de riesgo
  await expect(page.getByText('Quiebre seguro')).toBeVisible();
  await expect(page.getByText('Riesgo alto')).toBeVisible();
  await expect(page.getByText('Cubierto')).toBeVisible();

  // inventario: dead stock con monto en $ (la fila es dt+dd)
  await expect(page.getByText(/Dead stock/)).toBeVisible();
  await expect(
    page.locator('dd').filter({ hasText: 'SKUs' }).first(),
  ).toContainText('$');
  await expect(page.getByText('Margen perdido en la ventana')).toBeVisible();

  // scorecard de proveedores: 8 filas del seed con $ y %
  const filas = page.locator(FILAS_PROV);
  expect(await filas.count()).toBe(8);
  await expect(filas.first()).toContainText('$');
  await expect(filas.first()).toContainText('%');
});

test('la navegación del sidebar vuelve al dashboard', async ({ page }) => {
  await irAMetricas(page);
  await page.getByRole('link', { name: 'Órdenes' }).click();
  await expect(page.locator(FILAS).first()).toBeVisible();
  await page.getByRole('link', { name: 'Métricas' }).click();
  await expect(
    page.getByRole('heading', { name: 'Métricas del negocio' }),
  ).toBeVisible();
});

test('GERENTE también accede al scorecard', async ({ page }) => {
  await irAMetricas(page, GERENTE);
  expect(await page.locator(FILAS_PROV).count()).toBeGreaterThan(0);
});
