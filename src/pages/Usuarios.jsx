import { useCallback, useEffect, useRef, useState } from 'react';
import {
  LoaderCircle,
  Pencil,
  Search,
  ShieldCheck,
  UserCheck,
  UserPlus,
  UserX,
  Users,
  X,
} from 'lucide-react';
import Sidebar from '../components/Sidebar.jsx';
import Topbar from '../components/Topbar.jsx';
import Toasts from '../components/Toasts.jsx';
import { EmptyState, ErrorState } from '../components/ui.jsx';
import {
  crearUsuario,
  editarUsuario,
  getUsuarios,
} from '../lib/api.js';
import { actualizarUsuarioSesion, logout } from '../lib/auth.js';
import { Link } from '../lib/router.jsx';

const ROLES = ['ADMIN', 'GERENTE', 'APROBADOR', 'SERVICIO'];
const ROL_LABEL = {
  ADMIN: 'Administrador',
  GERENTE: 'Gerente',
  APROBADOR: 'Aprobador',
  SERVICIO: 'Servicio',
};
const ROL_BADGE = {
  ADMIN: 'bg-terra/10 text-terra',
  GERENTE: 'bg-root/10 text-root',
  APROBADOR: 'bg-ocre/15 text-ocre',
  SERVICIO: 'bg-warmgray/15 text-warmgray',
};
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// timestamptz llega como ISO con Z — parsear como Date y mostrar
// en TZ local (antes era un string UTC que se cortaba a pelo).
const fmtFecha = (f) =>
  f ? new Date(f).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
let toastKey = 0;

// SPEC-24: gestión de usuarios — solo ADMIN llega acá (el guard de
// main.jsx devuelve NotFound al resto). Listado paginado + alta,
// edición y activar/desactivar contra /api/usuarios.
export default function Usuarios({ usuario }) {
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [lista, setLista] = useState({ data: [], pagination: null });
  const [search, setSearch] = useState('');
  const [filtroRol, setFiltroRol] = useState('');
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState(null); // 'nuevo' | usuario a editar
  const [procesando, setProcesando] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const timers = useRef([]);
  const debounce = useRef(null);

  const cargar = useCallback(async (pagina = page, q = search, rol = filtroRol) => {
    setCargando(true);
    setError(null);
    try {
      setLista(await getUsuarios({ page: pagina, search: q, rol }));
    } catch (e) {
      setError(e);
    }
    setCargando(false);
  }, [page, search, filtroRol]);

  useEffect(() => {
    cargar(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtroRol]);
  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      clearTimeout(debounce.current);
    },
    [],
  );

  const onSearch = (v) => {
    setSearch(v);
    setPage(1);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => cargar(1, v), 300);
  };

  const pushToast = (mensaje, tipo = 'ok') => {
    const key = ++toastKey;
    setToasts((ts) => [...ts, { key, mensaje, tipo }]);
    timers.current.push(
      setTimeout(() => setToasts((ts) => ts.filter((t) => t.key !== key)), 3000),
    );
  };

  const toggleActivo = async (u) => {
    setProcesando(u.id);
    try {
      await editarUsuario(u.id, { activo: !u.activo });
      pushToast(`${u.nombre} ${u.activo ? 'desactivado' : 'reactivado'}`);
      await cargar();
    } catch (e) {
      pushToast(`No se pudo actualizar a ${u.nombre}: ${e.message}`, 'error');
    } finally {
      setProcesando(null);
    }
  };

  const { data: usuarios, pagination } = lista;

  return (
    <div className="flex min-h-screen">
      <Sidebar
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        usuario={usuario}
        activeId="usuarios"
        base="/"
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          onMenu={() => setMenuOpen(true)}
          usuario={usuario}
          onLogout={logout}
        />

        <main className="flex-1 space-y-6 p-4 sm:p-8">
          <header className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="font-display text-2xl font-bold tracking-tight text-grafito">
                Gestión de usuarios
              </h1>
              <p className="mt-1 text-sm text-warmgray">
                {pagination ? `${pagination.total} usuarios registrados` : 'Altas, roles y accesos'}
              </p>
            </div>
            <button
              onClick={() => setModal('nuevo')}
              className="inline-flex items-center gap-2 rounded-lg bg-root px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-root-dark"
            >
              <UserPlus size={17} strokeWidth={1.5} /> Nuevo usuario
            </button>
          </header>

          {/* Filtros */}
          <div className="flex flex-wrap gap-3">
            <label className="relative min-w-60 flex-1">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-warmgray"
                strokeWidth={1.5}
              />
              <input
                type="search"
                value={search}
                onChange={(e) => onSearch(e.target.value)}
                placeholder="Buscar por nombre o email…"
                aria-label="Buscar usuarios"
                className="h-10 w-full rounded-lg border border-root/15 bg-white pl-9 pr-3 text-sm text-grafito outline-none transition placeholder:text-warmgray/70 focus:border-root focus:ring-2 focus:ring-root/20"
              />
            </label>
            <select
              value={filtroRol}
              onChange={(e) => {
                setFiltroRol(e.target.value);
                setPage(1);
              }}
              aria-label="Filtrar por rol"
              className="h-10 rounded-lg border border-root/15 bg-white px-3 text-sm text-grafito outline-none focus:border-root focus:ring-2 focus:ring-root/20"
            >
              <option value="">Todos los roles</option>
              {ROLES.map((r) => (
                <option key={r} value={r}>{ROL_LABEL[r]}</option>
              ))}
            </select>
          </div>

          {error ? (
            <ErrorState
              title="No se pudieron cargar los usuarios"
              message={error.message}
              action={
                <button
                  onClick={() => cargar()}
                  className="rounded-lg bg-root px-4 py-2 text-sm font-semibold text-white transition hover:bg-root-dark"
                >
                  Reintentar
                </button>
              }
            />
          ) : cargando ? (
            <div aria-busy="true" aria-label="Cargando usuarios" className="rounded-2xl bg-white p-4 ring-1 ring-root/10">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="skeleton mb-3 h-12 rounded-lg" />
              ))}
            </div>
          ) : usuarios.length === 0 ? (
            <EmptyState
              icon={Users}
              title="Sin usuarios"
              message={
                search || filtroRol
                  ? 'Ningún usuario coincide con los filtros aplicados.'
                  : 'Todavía no hay usuarios registrados.'
              }
            />
          ) : (
            <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-root/10">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="border-b border-root/10 text-xs font-semibold uppercase tracking-wide text-warmgray">
                    <th className="px-4 py-3">Usuario</th>
                    <th className="px-4 py-3">Rol</th>
                    <th className="px-4 py-3">Estado</th>
                    <th className="px-4 py-3">Último acceso</th>
                    <th className="px-4 py-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {usuarios.map((u) => {
                    const esSelf = u.id === usuario.id;
                    return (
                      <tr key={u.id} className="border-b border-root/5 last:border-0">
                        <td className="px-4 py-3">
                          <p className="font-semibold text-grafito">
                            {u.nombre}
                            {esSelf && (
                              <span className="ml-2 rounded-full bg-root/10 px-2 py-0.5 text-[10px] font-bold uppercase text-root">
                                vos
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-warmgray">{u.email}</p>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${ROL_BADGE[u.rol] ?? 'bg-slate-100 text-slate-600'}`}>
                            <ShieldCheck size={13} strokeWidth={1.5} />
                            {ROL_LABEL[u.rol] ?? u.rol}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                            u.activo ? 'bg-root/10 text-root' : 'bg-terra/10 text-terra'
                          }`}>
                            {u.activo ? 'Activo' : 'Inactivo'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-warmgray">{fmtFecha(u.ultimo_login)}</td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-1">
                            <button
                              onClick={() => setModal(u)}
                              disabled={procesando === u.id}
                              title="Editar usuario"
                              aria-label={`Editar ${u.nombre}`}
                              className="rounded-lg p-2 text-warmgray transition hover:bg-root/10 hover:text-root disabled:opacity-40"
                            >
                              <Pencil size={16} strokeWidth={1.5} />
                            </button>
                            {u.activo ? (
                              <button
                                onClick={() => toggleActivo(u)}
                                disabled={procesando === u.id || esSelf}
                                title={esSelf ? 'No podés desactivarte a vos mismo' : 'Desactivar usuario'}
                                aria-label={`Desactivar ${u.nombre}`}
                                className="rounded-lg p-2 text-warmgray transition hover:bg-terra/10 hover:text-terra disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                {procesando === u.id ? (
                                  <LoaderCircle size={16} className="animate-spin" strokeWidth={1.5} />
                                ) : (
                                  <UserX size={16} strokeWidth={1.5} />
                                )}
                              </button>
                            ) : (
                              <button
                                onClick={() => toggleActivo(u)}
                                disabled={procesando === u.id}
                                title="Reactivar usuario"
                                aria-label={`Reactivar ${u.nombre}`}
                                className="rounded-lg p-2 text-warmgray transition hover:bg-root/10 hover:text-root disabled:opacity-40"
                              >
                                {procesando === u.id ? (
                                  <LoaderCircle size={16} className="animate-spin" strokeWidth={1.5} />
                                ) : (
                                  <UserCheck size={16} strokeWidth={1.5} />
                                )}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {pagination && pagination.totalPages > 1 && (
                <div className="flex items-center justify-between border-t border-root/10 px-4 py-3 text-sm text-warmgray">
                  <span>
                    Página {pagination.page} de {pagination.totalPages}
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setPage(page - 1); cargar(page - 1); }}
                      disabled={page <= 1}
                      className="rounded-lg border border-root/15 px-3 py-1.5 font-semibold transition hover:bg-root/10 disabled:opacity-40"
                    >
                      Anterior
                    </button>
                    <button
                      onClick={() => { setPage(page + 1); cargar(page + 1); }}
                      disabled={page >= pagination.totalPages}
                      className="rounded-lg border border-root/15 px-3 py-1.5 font-semibold transition hover:bg-root/10 disabled:opacity-40"
                    >
                      Siguiente
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </main>

        <footer className="border-t border-root/10 px-8 py-4 text-center text-xs text-warmgray">
          MERCADO RAÍZ · Del campo a tu mesa, con inteligencia · Desde 1952 ·{' '}
          <Link to="/privacidad" className="font-semibold text-root hover:underline">
            Privacidad
          </Link>
        </footer>
      </div>

      {modal && (
        <UsuarioModal
          usuario={modal === 'nuevo' ? null : modal}
          esSelf={modal !== 'nuevo' && modal.id === usuario.id}
          onClose={() => setModal(null)}
          onSaved={async (accion) => {
            setModal(null);
            pushToast(accion);
            await cargar();
          }}
        />
      )}
      <Toasts toasts={toasts} />
    </div>
  );
}

// Modal alta/edición — datos personales → checkbox de privacidad
// obligatorio no pre-tildado; submit disabled hasta que el form sea
// válido y (en edición) haya cambios reales.
function UsuarioModal({ usuario, esSelf, onClose, onSaved }) {
  const esEdicion = !!usuario;
  const [nombre, setNombre] = useState(usuario?.nombre ?? '');
  const [email, setEmail] = useState(usuario?.email ?? '');
  const [rol, setRol] = useState(usuario?.rol ?? 'APROBADOR');
  const [password, setPassword] = useState('');
  const [acepta, setAcepta] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState(null);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const cambios = esEdicion
    ? {
        ...(nombre.trim() !== usuario.nombre && { nombre: nombre.trim() }),
        ...(email.trim().toLowerCase() !== usuario.email && {
          email: email.trim().toLowerCase(),
        }),
        ...(rol !== usuario.rol && { rol }),
      }
    : null;

  const valido = esEdicion
    ? nombre.trim() !== '' &&
      EMAIL_RE.test(email.trim()) &&
      ROLES.includes(rol) &&
      Object.keys(cambios).length > 0 &&
      acepta
    : nombre.trim() !== '' &&
      EMAIL_RE.test(email.trim()) &&
      ROLES.includes(rol) &&
      password.length >= 12 &&
      acepta;

  const submit = async () => {
    if (!valido || enviando) return;
    setEnviando(true);
    setErrorEnvio(null);
    try {
      if (esEdicion) {
        await editarUsuario(usuario.id, cambios);
        // Self-edit de nombre/email → reflejarlo en la Topbar sin
        // esperar al próximo refresh.
        if (esSelf && (cambios.nombre || cambios.email)) {
          actualizarUsuarioSesion({
            ...(cambios.nombre && { nombre: cambios.nombre }),
            ...(cambios.email && { email: cambios.email }),
          });
        }
        await onSaved(`${nombre.trim()} actualizado`);
      } else {
        await crearUsuario({
          nombre: nombre.trim(),
          email: email.trim().toLowerCase(),
          rol,
          password,
        });
        await onSaved(`${nombre.trim()} creado`);
      }
    } catch (e) {
      setErrorEnvio(e.message);
    } finally {
      setEnviando(false);
    }
  };

  const inputCls =
    'h-11 w-full rounded-lg border border-root/15 bg-cream/40 px-3 text-sm text-grafito outline-none transition placeholder:text-warmgray/70 focus:border-root focus:ring-2 focus:ring-root/20 disabled:opacity-60';

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-grafito/50 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={esEdicion ? `Editar ${usuario.nombre}` : 'Nuevo usuario'}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-lift ring-1 ring-root/10"
      >
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg font-bold text-grafito">
            {esEdicion ? `Editar ${usuario.nombre}` : 'Nuevo usuario'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-lg p-1.5 text-warmgray transition hover:bg-root/10 hover:text-root"
          >
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-warmgray">
            Nombre completo
          </span>
          <input
            type="text"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Nombre y apellido"
            maxLength={200}
            className={inputCls}
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-warmgray">
            Email corporativo
          </span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="usuario@mercadorai.com"
            className={inputCls}
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-warmgray">
            Rol
          </span>
          <select
            value={rol}
            onChange={(e) => setRol(e.target.value)}
            disabled={esSelf}
            title={esSelf ? 'No podés cambiarte el rol a vos mismo' : undefined}
            className={inputCls}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>{ROL_LABEL[r]}</option>
            ))}
          </select>
          {esSelf && (
            <p className="mt-1 text-xs text-warmgray">
              No podés cambiarte el rol a vos mismo.
            </p>
          )}
        </label>

        {!esEdicion && (
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-warmgray">
              Contraseña inicial
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mínimo 12 caracteres"
              autoComplete="new-password"
              className={inputCls}
            />
            {password && password.length < 12 && (
              <p className="mt-1 text-xs text-terra">
                Faltan {12 - password.length} caracteres para el mínimo.
              </p>
            )}
          </label>
        )}

        <label className="flex items-start gap-2.5 pt-1 text-xs leading-relaxed text-warmgray">
          <input
            type="checkbox"
            checked={acepta}
            onChange={(e) => setAcepta(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-root/30 accent-root"
          />
          <span>
            Confirmo el tratamiento de estos datos según la{' '}
            <Link to="/privacidad" className="font-semibold text-root hover:underline">
              política de privacidad
            </Link>{' '}
            de Mercado Raíz.
          </span>
        </label>

        {errorEnvio && (
          <p role="alert" className="rounded-lg bg-terra/10 px-3 py-2.5 text-sm text-terra">
            {errorEnvio}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2.5 text-sm font-semibold text-warmgray transition hover:bg-root/10"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!valido || enviando}
            className="inline-flex items-center gap-2 rounded-lg bg-root px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-root-dark disabled:cursor-not-allowed disabled:opacity-50"
          >
            {enviando ? (
              <>
                <LoaderCircle size={16} className="animate-spin" strokeWidth={1.5} />
                Guardando…
              </>
            ) : esEdicion ? (
              'Guardar cambios'
            ) : (
              <>
                <UserPlus size={16} strokeWidth={1.5} /> Crear usuario
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
