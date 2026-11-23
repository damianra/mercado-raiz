// Helper de sesión para tests (SPEC-23): loguea un usuario del seed
// y devuelve token/cookies listos para los fetch de la suite. Los
// tests de dominio memoizan el resultado — 1 login por archivo —
// así el rate limit del login no estorba (JWT es stateless: el
// mismo token sirve contra cualquier instancia de la app que
// comparta DB y JWT_SECRET).
export const USUARIOS_TEST = {
  GERENTE: { email: 'carlos.martinez@mercadorai.com', password: 'demo-gerente-2026' },
  APROBADOR: { email: 'maria.lopez@mercadorai.com', password: 'demo-aprobadora-2026' },
  ADMIN: { email: 'admin@mercadorai.com', password: 'demo-admin-2026' },
  SERVICIO: { email: 'agente@mercadorai.com', password: 'demo-agente-2026' },
  BUYER: { email: 'buyer@mercadorai.com', password: 'demo-buyer-2026' },
};

export async function loginComo(base, rol = 'ADMIN') {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(USUARIOS_TEST[rol]),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`login ${rol} falló: ${res.status} ${JSON.stringify(body)}`);
  }
  const setCookies = res.headers.getSetCookie();
  return {
    usuario: body.usuario,
    token: body.access_token,
    // Cookie header listo para reenviar (refresh + csrf legible).
    cookie: setCookies.map((c) => c.split(';')[0]).join('; '),
    // Valor legible de mr_csrf — va en X-CSRF-Token (double-submit).
    csrf:
      setCookies
        .find((c) => c.startsWith('mr_csrf='))
        ?.split(';')[0]
        .split('=')[1] ?? null,
    headers: { Authorization: `Bearer ${body.access_token}` },
  };
}
