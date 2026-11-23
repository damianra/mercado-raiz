import { useState } from 'react';
import { Leaf, LoaderCircle, Lock, LogIn, Mail, TriangleAlert } from 'lucide-react';
import { login } from '../lib/auth.js';
import { Link } from '../lib/router.jsx';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [acepta, setAcepta] = useState(false);
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);

  // Submit gateado: formulario válido + consentimiento tildado.
  const valido = EMAIL_RE.test(email.trim()) && password.length > 0 && acepta;

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!valido || enviando) return;
    setEnviando(true);
    setError(null);
    try {
      await login(email.trim().toLowerCase(), password);
      // La sesión emite y Root cambia solo al dashboard.
    } catch (err) {
      setError(err.status === 0 ? 'No se pudo conectar con el servidor.' : err.message);
      setEnviando(false);
    }
  };

  return (
    <main className="grid min-h-screen place-items-center px-6 py-12">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center text-center">
          <span className="grid h-14 w-14 place-items-center rounded-lg bg-terra/90">
            <Leaf size={26} className="text-cream" strokeWidth={1.5} />
          </span>
          <h1 className="mt-4 font-display text-2xl font-bold tracking-tight text-grafito">
            MERCADO RAÍZ
          </h1>
          <p className="mt-1 text-sm text-warmgray">
            Sistema de aprovisionamiento — acceso restringido
          </p>
        </div>

        <form
          onSubmit={onSubmit}
          className="mt-8 space-y-4 rounded-lg bg-white p-8 shadow-soft ring-1 ring-root/10"
        >
          <label className="block">
            <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-warmgray">
              <Mail size={13} strokeWidth={1.5} /> Email corporativo
            </span>
            <input
              type="email"
              name="email"
              autoComplete="email"
              autoFocus
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="usuario@mercadorai.com"
              className="h-11 w-full rounded-lg border border-root/15 bg-cream/40 px-3 text-sm text-grafito outline-none transition placeholder:text-warmgray/70 focus:border-root focus:ring-2 focus:ring-root/20"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-warmgray">
              <Lock size={13} strokeWidth={1.5} /> Contraseña
            </span>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              className="h-11 w-full rounded-lg border border-root/15 bg-cream/40 px-3 text-sm text-grafito outline-none transition placeholder:text-warmgray/70 focus:border-root focus:ring-2 focus:ring-root/20"
            />
          </label>

          <label className="flex items-start gap-2.5 pt-1 text-xs leading-relaxed text-warmgray">
            <input
              type="checkbox"
              name="privacidad"
              checked={acepta}
              onChange={(e) => setAcepta(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-root/30 accent-root"
            />
            <span>
              Acepto la{' '}
              <Link to="/privacidad" className="font-semibold text-root hover:underline">
                política de privacidad
              </Link>{' '}
              de Mercado Raíz.
            </span>
          </label>

          {error && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-lg bg-terra/10 px-3 py-2.5 text-sm text-terra"
            >
              <TriangleAlert size={16} className="mt-0.5 shrink-0" strokeWidth={1.5} />
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={!valido || enviando}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-root text-sm font-semibold text-white transition duration-200 ease-brand hover:-translate-y-0.5 hover:bg-root-dark hover:shadow-lift disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none"
          >
            {enviando ? (
              <>
                <LoaderCircle size={17} className="animate-spin" strokeWidth={1.5} />
                Ingresando…
              </>
            ) : (
              <>
                <LogIn size={17} strokeWidth={1.5} /> Ingresar
              </>
            )}
          </button>
        </form>
      </div>
    </main>
  );
}
