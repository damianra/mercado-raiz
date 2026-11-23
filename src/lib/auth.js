// Sesión del usuario (SPEC-23): access JWT y usuario viven SOLO en
// memoria — nunca localStorage/sessionStorage (exfiltrable por XSS).
// El refresh viaja en cookie httpOnly mr_refresh y el CSRF en la
// cookie legible mr_csrf (double-submit: el front la lee y la
// reenvía como X-CSRF-Token en refresh/logout).
//
// Los componentes se suscriben con onSesion(fn) — cuando la sesión
// cae (refresh vencido, logout) el Root vuelve a renderizar Login
// sin necesidad de propagar el estado por props.

let session = null; // { accessToken, usuario }
let refreshEnCurso = null;
const listeners = new Set();

const emit = () => listeners.forEach((fn) => fn(session));
const setSession = (s) => {
  session = s;
  emit();
};

export const getSession = () => session;

export function onSesion(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// mr_csrf es la cookie legible — mismo Path que el refresh.
const leerCsrf = () =>
  document.cookie
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('mr_csrf='))
    ?.slice('mr_csrf='.length);

export class AuthError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

async function authPost(path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const csrf = leerCsrf();
  if (csrf) headers['X-CSRF-Token'] = csrf;
  let res;
  try {
    res = await fetch(`/api/auth${path}`, {
      method: 'POST',
      headers,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new AuthError('No se pudo conectar con el servidor');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new AuthError(data.error ?? `Error ${res.status}`, res.status);
  return data;
}

export async function login(email, password) {
  const data = await authPost('/login', { email, password });
  setSession({ accessToken: data.access_token, usuario: data.usuario });
  return session;
}

// Silent refresh: al boot (cookie viva → sesión) y cuando api.js ve
// un 401. Dedupeado — llamadas concurrentes comparten la promesa.
export function refrescarSesion() {
  refreshEnCurso ??= (async () => {
    try {
      const data = await authPost('/refresh');
      setSession({ accessToken: data.access_token, usuario: data.usuario });
    } catch {
      setSession(null); // cookie muerta o revocada → login
    }
    return session;
  })().finally(() => {
    refreshEnCurso = null;
  });
  return refreshEnCurso;
}

export async function logout() {
  try {
    await authPost('/logout');
  } catch {
    // La sesión ya estaba vencida — se limpia igual en cliente.
  }
  setSession(null);
}
