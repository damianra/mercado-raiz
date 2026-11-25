import { test, expect } from '@playwright/test';

// SPEC-28 T28.2 — vista /metricas: scorecard agregado. El seed
// garantiza proveedores con SKUs y órdenes, stock 0 y dead stock
// → todas las secciones salen pobladas.
const ADMIN = { email: 'admin@mercadorai.com', password: 'demo-admin-2026' };
const GERENTE = { email: 'carlos.martinez@mercadorai.com', password: 'demo-gerente-2026' };

const FILAS = 'section[aria-label="Tabla de órdenes de compra"] tbody tr';
// Scorecard de proveedores — la tabla queda scopiada por su
// sección: T32.3 sumó una tabla de pricing accionable a la vista.
const FILAS_PROV = 'section:has-text("Scorecard de proveedores") tbody tr';

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

// SPEC-32 (T32.3) — vista gráfica: charts reales + tabla de
// pricing accionable que alimenta el modal Ajustar precio.
test('secciones gráficas: ventas, competitividad, capital y pricing accionable', async ({
  page,
}) => {
  await irAMetricas(page, GERENTE);

  // chart de ventas diarias (recharts renderiza svg)
  await expect(page.getByText('Ventas del período — facturación por día')).toBeVisible();
  await expect(page.locator('.recharts-responsive-container svg').first()).toBeVisible();

  // competitividad: banda de zonas + barras por cadena + fecha del snapshot
  await expect(page.getByText('Competitividad de precios')).toBeVisible();
  await expect(page.getByText(/precios al 2026-11-20/)).toBeVisible();
  await expect(page.getByText('Más baratos que el mercado:')).toBeVisible();

  // pareto de capital inmovilizado
  await expect(page.getByText(/Capital inmovilizado — \$/)).toBeVisible();

  // tabla de pricing accionable con el botón que abre el modal
  await expect(page.getByText(/Pricing accionable — \d+ fuera de rango/)).toBeVisible();
  const fila = page
    .locator('section')
    .filter({ hasText: 'Pricing accionable' })
    .locator('tbody tr')
    .first();
  await fila.locator('button[aria-label^="Ajustar precio"]').click();
  await expect(
    page.getByRole('dialog', { name: 'Ajustar precio' }),
  ).toBeVisible();
  await expect(page.getByLabel('Posición de precio en el mercado')).toBeVisible();
});

test('deep-link ?ajustar= abre el modal de precio directo (T32.8)', async ({
  page,
}) => {
  await login(page, GERENTE);
  // la campanita navega a /metricas?ajustar=<id> — el producto no
  // necesita estar listado en la tabla de outliers.
  await page.goto('/metricas?ajustar=1');
  const modal = page.getByRole('dialog', { name: 'Ajustar precio' });
  await expect(modal).toBeVisible({ timeout: 15_000 });
  // el modal hidrata producto + competencia: sku MR00001 y la
  // escalera de precios con datos de mercado.
  await expect(modal).toContainText('MR00001');
  await expect(modal).toContainText(/\$/);
});
