import { test, expect } from '@playwright/test';

// SPEC-26 T26.4 — pantalla admin de proveedores. La DB viene fresca
// del seed (Playwright la re-seedea): 7 proveedores; "Bebidas del
// Litoral SA" tiene órdenes PENDIENTE/ENVIADA vivas (→ 409 al
// desactivar) y "Frescos del Sur SA" no.
const ADMIN = { email: 'admin@mercadorai.com', password: 'demo-admin-2026' };
const GERENTE = { email: 'carlos.martinez@mercadorai.com', password: 'demo-gerente-2026' };

const FILAS = 'section[aria-label="Tabla de órdenes de compra"] tbody tr';

async function login(page, { email, password } = ADMIN) {
  await page.goto('/');
  await page.getByLabel('Email corporativo').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByLabel(/Acepto la/).check();
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.locator(FILAS).first()).toBeVisible();
}

async function irAProveedores(page) {
  await login(page);
  await page.getByRole('link', { name: 'Proveedores' }).click();
  await expect(
    page.getByRole('heading', { name: 'Gestión de proveedores' }),
  ).toBeVisible();
}

test('ADMIN ve la entrada Proveedores en el sidebar y la tabla del seed', async ({
  page,
}) => {
  await irAProveedores(page);
  await expect(page.getByText('Mayorista Central SA')).toBeVisible();
  await expect(page.getByText('Huerta Don Mario')).toBeVisible();
  // Campos R26.4 visibles: rango de entrega y confiabilidad.
  await expect(page.getByText('2–5 días')).toBeVisible();
  await expect(page.getByText('95%')).toBeVisible();
});

test('GERENTE no ve la sección ni puede entrar por URL directa', async ({ page }) => {
  await login(page, GERENTE);
  await expect(page.getByRole('link', { name: 'Proveedores' })).toHaveCount(0);
  await page.goto('/proveedores');
  await expect(
    page.getByRole('heading', { name: 'Página no encontrada' }),
  ).toBeVisible();
});

test('alta: submit disabled hasta form válido + consentimiento, crea y lista', async ({
  page,
}) => {
  await irAProveedores(page);
  await page.getByRole('button', { name: 'Nuevo proveedor' }).click();

  const dialog = page.getByRole('dialog');
  const submit = dialog.getByRole('button', { name: 'Crear proveedor' });
  await expect(submit).toBeDisabled();

  await dialog.getByLabel('Nombre *').fill('Proveedor E2E SA');
  await dialog.getByLabel('Contacto').fill('Test Persona');
  // Rango inválido → sigue disabled y avisa.
  await dialog.getByLabel('Entrega mín (d)').fill('5');
  await dialog.getByLabel('Entrega máx (d)').fill('2');
  await expect(submit).toBeDisabled();
  await dialog.getByLabel('Entrega máx (d)').fill('6');
  // Falta el checkbox → sigue disabled.
  await expect(submit).toBeDisabled();
  await dialog.getByLabel(/Confirmo el tratamiento/).check();
  await expect(submit).toBeEnabled();

  await submit.click();
  await expect(page.getByText('Proveedor E2E SA creado')).toBeVisible();
  await expect(page.getByText('Proveedor E2E SA', { exact: true })).toBeVisible();
});

test('edición: submit gateado por cambios reales', async ({ page }) => {
  await irAProveedores(page);
  await page.getByRole('button', { name: 'Editar Mayorista Central SA' }).click();

  const dialog = page.getByRole('dialog');
  const submit = dialog.getByRole('button', { name: 'Guardar cambios' });
  await dialog.getByLabel(/Confirmo el tratamiento/).check();
  await expect(submit).toBeDisabled();

  await dialog.getByLabel('Contacto').fill('María González Editada');
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByText('Mayorista Central SA actualizado')).toBeVisible();
  await expect(page.getByText(/María González Editada/)).toBeVisible();
});

test('desactivar con órdenes vivas muestra el 409 del backend', async ({ page }) => {
  await irAProveedores(page);
  const fila = page.locator('tr', { hasText: 'Bebidas del Litoral SA' });
  await fila.getByRole('button', { name: /Desactivar/ }).click();
  // El toast trae el motivo del backend (órdenes vivas) — la fila
  // sigue Activa.
  await expect(page.getByText(/órdenes pendientes de aprobación o enviadas/)).toBeVisible();
  await expect(fila.getByText('Activo')).toBeVisible();
});

test('activar/desactivar sin órdenes vivas cambia el badge', async ({ page }) => {
  await irAProveedores(page);
  const fila = page.locator('tr', { hasText: 'Frescos del Sur SA' });
  await fila.getByRole('button', { name: /Desactivar/ }).click();
  await expect(fila.getByText('Inactivo')).toBeVisible();
  await fila.getByRole('button', { name: /Reactivar/ }).click();
  await expect(fila.getByText('Activo')).toBeVisible();
});

test('búsqueda filtra la tabla y sin resultados muestra fallback', async ({ page }) => {
  await irAProveedores(page);
  await page.getByLabel('Buscar proveedores').fill('Huerta');
  await expect(page.getByText('Huerta Don Mario')).toBeVisible();
  await expect(page.getByText('Mayorista Central SA')).toHaveCount(0);

  await page.getByLabel('Buscar proveedores').fill('zzz-no-existe-zzz');
  await expect(page.getByText('Sin proveedores')).toBeVisible();
});
