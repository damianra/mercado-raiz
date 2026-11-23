import { test, expect } from '@playwright/test';

// SPEC-24 T24.2 — pantalla admin de usuarios. La DB viene fresca del
// seed (Playwright la re-seedea): 4 usuarios del seed, admin único.
const ADMIN = { email: 'admin@mercadorai.com', password: 'demo-admin-2026' };
const GERENTE = { email: 'carlos.martinez@mercadorai.com', password: 'demo-gerente-2026' };

const FILAS = 'section[aria-label="Tabla de órdenes de compra"] tbody tr';

async function login(page, { email, password } = ADMIN) {
  await page.goto('/');
  await page.getByLabel('Email corporativo').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByLabel(/Acepto la/).check();
  await page.getByRole('button', { name: 'Ingresar' }).click();
  // Esperar el dashboard: si se navega antes de que el login asiente,
  // el goto aborta el POST y la sesión queda a medio armar.
  await expect(page.locator(FILAS).first()).toBeVisible();
}

async function irAUsuarios(page) {
  await login(page);
  await page.getByRole('link', { name: 'Usuarios' }).click();
  await expect(page.getByRole('heading', { name: 'Gestión de usuarios' })).toBeVisible();
}

test('ADMIN ve la entrada Usuarios en el sidebar y accede a la pantalla', async ({
  page,
}) => {
  await irAUsuarios(page);
  // Los 4 usuarios del seed figuran en la tabla.
  await expect(page.getByText('admin@mercadorai.com')).toBeVisible();
  await expect(page.getByText('agente@mercadorai.com')).toBeVisible();
});

test('GERENTE no ve la sección ni puede entrar por URL directa', async ({
  page,
}) => {
  await login(page, GERENTE);
  await expect(page.getByRole('link', { name: 'Usuarios' })).toHaveCount(0);
  await page.goto('/usuarios');
  await expect(
    page.getByRole('heading', { name: 'Página no encontrada' }),
  ).toBeVisible();
});

test('alta: submit disabled hasta form válido + consentimiento, crea y lista', async ({
  page,
}) => {
  await irAUsuarios(page);
  await page.getByRole('button', { name: 'Nuevo usuario' }).click();

  const dialog = page.getByRole('dialog');
  const submit = dialog.getByRole('button', { name: 'Crear usuario' });
  await expect(submit).toBeDisabled();

  await dialog.getByLabel('Nombre completo').fill('Test Playwright');
  await dialog.getByLabel('Email corporativo').fill('e2e@test.com');
  await dialog.getByLabel('Rol').selectOption('APROBADOR');
  await dialog.getByLabel('Contraseña inicial').fill('password-e2e-123');
  // Falta el checkbox → sigue disabled.
  await expect(submit).toBeDisabled();
  await dialog.getByLabel(/Confirmo el tratamiento/).check();
  await expect(submit).toBeEnabled();

  await submit.click();
  await expect(page.getByText('Test Playwright creado')).toBeVisible();
  await expect(page.getByText('e2e@test.com')).toBeVisible();
});

test('edición: submit gateado por cambios reales', async ({ page }) => {
  await irAUsuarios(page);
  await page.getByRole('button', { name: 'Editar Carlos Martínez' }).click();

  const dialog = page.getByRole('dialog');
  const submit = dialog.getByRole('button', { name: 'Guardar cambios' });
  // Sin cambios → disabled aunque el form sea válido.
  await dialog.getByLabel(/Confirmo el tratamiento/).check();
  await expect(submit).toBeDisabled();

  await dialog.getByLabel('Nombre completo').fill('Carlos Martínez Editado');
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByText('Carlos Martínez Editado actualizado')).toBeVisible();
  await expect(
    page.getByText('Carlos Martínez Editado', { exact: true }),
  ).toBeVisible();
});

test('activar/desactivar: el badge cambia y el self está bloqueado', async ({
  page,
}) => {
  await irAUsuarios(page);
  // La fila propia trae el badge "vos" y su desactivar está disabled.
  const filaSelf = page.locator('tr', { hasText: 'admin@mercadorai.com' });
  await expect(filaSelf.getByText('vos')).toBeVisible();
  await expect(filaSelf.getByRole('button', { name: /Desactivar/ })).toBeDisabled();

  const filaAgente = page.locator('tr', { hasText: 'agente@mercadorai.com' });
  await filaAgente.getByRole('button', { name: /Desactivar/ }).click();
  await expect(filaAgente.getByText('Inactivo')).toBeVisible();
  await filaAgente.getByRole('button', { name: /Reactivar/ }).click();
  await expect(filaAgente.getByText('Activo')).toBeVisible();
});

test('búsqueda filtra la tabla y sin resultados muestra fallback', async ({
  page,
}) => {
  await irAUsuarios(page);
  await page.getByLabel('Buscar usuarios').fill('agente@');
  await expect(page.getByText('agente@mercadorai.com')).toBeVisible();
  await expect(page.getByText('admin@mercadorai.com')).toHaveCount(0);

  await page.getByLabel('Buscar usuarios').fill('zzz-no-existe-zzz');
  await expect(page.getByText('Sin usuarios')).toBeVisible();
});
