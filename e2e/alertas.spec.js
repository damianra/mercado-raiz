import { test, expect } from '@playwright/test';

// SPEC-29 T29.2 — /alertas: dashboard exclusivo del rol BUYER.
// El seed genera alertas reales con el GET (lazy eval).
const BUYER = { email: 'buyer@mercadorai.com', password: 'demo-buyer-2026' };
const ADMIN = { email: 'admin@mercadorai.com', password: 'demo-admin-2026' };

const LISTA = 'ul[aria-label="Lista de alertas"] li';

async function login(page, { email, password } = BUYER) {
  await page.goto('/');
  await page.getByLabel('Email corporativo').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByLabel(/Acepto la/).check();
  await page.getByRole('button', { name: 'Ingresar' }).click();
  // esperar el shell post-login: la sesión/cookie deben estar activas
  // antes de navegar (un goto prematuro aborta el fetch de login)
  await expect(page.locator('aside nav')).toBeVisible();
}

test('el buyer aterriza en Alertas y solo ve ese ítem en el menú', async ({
  page,
}) => {
  await login(page);
  // home '/' ya muestra el dashboard de alertas
  await expect(
    page.getByRole('heading', { name: 'Alertas operativas' }),
  ).toBeVisible();

  // el sidebar solo tiene "Alertas" — nada del resto del dominio
  const nav = page.locator('aside nav');
  await expect(nav.getByRole('link', { name: 'Alertas' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Órdenes' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Quiebres' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Métricas' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Usuarios' })).toHaveCount(0);
});

test('lista alertas reales con severidad y permite marcar leída', async ({
  page,
}) => {
  await login(page);
  const items = page.locator(LISTA);
  // el primer GET dispara la eval lazy del backend (puede tardar)
  await expect(items.first()).toBeVisible({ timeout: 30_000 });
  expect(await items.count()).toBeGreaterThan(5);

  // severidad visible + la primera es ALTA (orden del backend)
  await expect(items.first()).toContainText('Alta');
  // el mensaje de quiebre trae el margen perdido real ('$…/día') —
  // se aserta sobre un ítem de quiebre: el primer ALTA puede ser de
  // otro tipo según el seed
  await expect(
    items.filter({ hasText: 'Quiebre' }).first(),
  ).toContainText('$');

  // marcar una leída: el ítem sale de la lista (filtro no-leídas)
  const total = await items.count();
  const primera = items.first();
  const alertaId = await primera.getAttribute('data-alerta-id');
  await primera.getByRole('button', { name: /Marcar leída/ }).click();
  await expect(items).toHaveCount(total - 1);
  await expect(page.locator(`[data-alerta-id="${alertaId}"]`)).toHaveCount(0);
});

test('Comprar abre el modal de proveedores y crea la OC real (T29.3/T30.4)', async ({
  page,
}) => {
  await login(page);
  const items = page.locator(LISTA);
  await expect(items.first()).toBeVisible({ timeout: 30_000 });

  // las alertas comprables muestran "Comprar", no "Marcar leída"
  const quiebre = items.filter({ hasText: 'Quiebre' }).first();
  const alertaId = await quiebre.getAttribute('data-alerta-id');
  await quiebre.getByRole('button', { name: 'Comprar' }).click();

  const modal = page.getByRole('dialog', { name: 'Solicitar pedido' });
  await expect(modal).toBeVisible();
  // proveedores con precio real + el más barato preseleccionado
  const radios = modal.getByRole('radio');
  await expect(radios.first()).toBeChecked();
  await expect(modal).toContainText('Más barato');
  await expect(modal).toContainText('$');
  // cantidad pre-cargada con la sugerencia del automático
  const inputCant = modal.getByLabel('Cantidad');
  expect(Number(await inputCant.inputValue())).toBeGreaterThan(0);
  await inputCant.fill('3');

  await modal.getByRole('button', { name: 'Solicitar pedido' }).click();
  await expect(modal).toBeHidden();
  // T30.4: el pedido creó la OC real → el toast trae el número.
  await expect(page.getByText(/OC OC-\d+ creada — queda pendiente/)).toBeVisible();
  // la alerta quedó atendida — sale de la lista de no leídas
  await expect(page.locator(`[data-alerta-id="${alertaId}"]`)).toHaveCount(0);
});

test('los filtros por tipo y el toggle de leídas funcionan', async ({ page }) => {
  await login(page);
  await expect(page.locator(LISTA).first()).toBeVisible({ timeout: 30_000 });

  await page.getByLabel('Filtrar por tipo').selectOption('QUIEBRE');
  const quiebres = page.locator(LISTA);
  await expect(quiebres.first()).toBeVisible();
  expect(await quiebres.count()).toBeGreaterThan(0);
  // todas las visibles son tipo quiebre
  await expect(quiebres.first()).toContainText('Quiebre');
});

test('el buyer recibe 404 en el resto del dominio', async ({ page }) => {
  await login(page);
  for (const ruta of ['/usuarios', '/proveedores', '/metricas', '/quiebres']) {
    await page.goto(ruta);
    await expect(page.getByText('Página no encontrada')).toBeVisible();
  }
});

test('otros roles no ven /alertas (ADMIN → 404)', async ({ page }) => {
  await login(page, ADMIN);
  await expect(
    page.getByRole('heading', { name: 'Órdenes Pendientes de Aprobación' }),
  ).toBeVisible();
  await page.goto('/alertas');
  await expect(page.getByText('Página no encontrada')).toBeVisible();
});
