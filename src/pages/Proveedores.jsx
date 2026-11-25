import { useCallback, useEffect, useRef, useState } from 'react';
import {
  LoaderCircle,
  Pencil,
  Search,
  Truck,
  X,
} from 'lucide-react';
import Sidebar from '../components/Sidebar.jsx';
import Topbar from '../components/Topbar.jsx';
import Toasts from '../components/Toasts.jsx';
import { EmptyState, ErrorState } from '../components/ui.jsx';
import {
  borrarProveedor,
  crearProveedor,
  editarProveedor,
  getProveedores,
} from '../lib/api.js';
import { logout } from '../lib/auth.js';
import { Link } from '../lib/router.jsx';
import { formatMoney } from '../data/orders.js';

// Categorías del catálogo (SPEC-22) — opciones de categorias_cubiertas.
const CATEGORIAS = [
  'Almacén',
  'Bebidas',
  'Congelados',
  'Desayuno y Merienda',
  'Frescos',
  'Frutas y Verduras',
  'Limpieza',
  'Perfumería',
];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
let toastKey = 0;

// SPEC-26 T26.4: gestión de proveedores — solo ADMIN llega acá (el
// guard de main.jsx devuelve NotFound al resto). Listado paginado +
// alta/edición + activar/desactivar contra /api/proveedores.
export default function Proveedores({ usuario }) {
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [lista, setLista] = useState({ data: [], pagination: null });
  const [search, setSearch] = useState('');
  const [filtroActivo, setFiltroActivo] = useState('');
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState(null); // 'nuevo' | proveedor a editar
  const [procesando, setProcesando] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const timers = useRef([]);
  const debounce = useRef(null);
  // Guard de secuencia: con fetches solapados (StrictMode x2 +
  // debounce de búsqueda) gana el último request, no el último
  // response — un response viejo nunca pisa el resultado nuevo.
  const reqSeq = useRef(0);

  const cargar = useCallback(
    async (pagina = page, q = search, activo = filtroActivo) => {
      const reqId = ++reqSeq.current;
      setCargando(true);
      setError(null);
      try {
        const r = await getProveedores({ page: pagina, search: q, activo });
        if (reqId === reqSeq.current) setLista(r);
      } catch (e) {
        if (reqId === reqSeq.current) setError(e);
      }
      if (reqId === reqSeq.current) setCargando(false);
    },
    [page, search, filtroActivo],
  );

  useEffect(() => {
    cargar(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtroActivo]);
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

  const toggleActivo = async (p) => {
    setProcesando(p.id);
    try {
      if (p.activo) {
        // DELETE = soft delete; 409 con órdenes vivas → el mensaje
        // del backend llega en e.message.
        await borrarProveedor(p.id);
        pushToast(`${p.nombre} desactivado`);
      } else {
        await editarProveedor(p.id, { activo: 1 });
        pushToast(`${p.nombre} reactivado`);
      }
      await cargar();
    } catch (e) {
      pushToast(`No se pudo actualizar a ${p.nombre}: ${e.message}`, 'error');
    } finally {
      setProcesando(null);
    }
  };

  const { data: proveedores, pagination } = lista;

  return (
    <div className="flex min-h-screen">
      <Sidebar
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        usuario={usuario}
        activeId="proveedores"
        base="/"
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenu={() => setMenuOpen(true)} usuario={usuario} onLogout={logout} />

        <main className="flex-1 space-y-6 p-4 sm:p-8">
          <header className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="font-sans tracking-tight text-2xl font-bold text-grafito">
                Gestión de proveedores
              </h1>
              <p className="mt-1 text-sm text-warmgray">
                {pagination
                  ? `${pagination.total} proveedores registrados`
                  : 'Altas, datos comerciales y estado'}
              </p>
            </div>
            <button
              onClick={() => setModal('nuevo')}
              className="inline-flex items-center gap-2 rounded-lg bg-root px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-root-dark"
            >
              <Truck size={17} strokeWidth={1.5} /> Nuevo proveedor
            </button>
          </header>

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
                placeholder="Buscar por nombre, contacto o email…"
                aria-label="Buscar proveedores"
                className="h-10 w-full rounded-lg border border-grafito/15 bg-white pl-9 pr-3 text-sm text-grafito outline-none transition placeholder:text-warmgray/70 focus:border-root focus:ring-2 focus:ring-grafito/15"
              />
            </label>
            <select
              value={filtroActivo}
              onChange={(e) => {
                setFiltroActivo(e.target.value);
                setPage(1);
              }}
              aria-label="Filtrar por estado"
              className="h-10 rounded-lg border border-grafito/15 bg-white px-3 text-sm text-grafito outline-none focus:border-root focus:ring-2 focus:ring-grafito/15"
            >
              <option value="">Todos los estados</option>
              <option value="1">Activos</option>
              <option value="0">Inactivos</option>
            </select>
          </div>

          {error ? (
            <ErrorState
              title="No se pudieron cargar los proveedores"
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
            <div
              aria-busy="true"
              aria-label="Cargando proveedores"
              className="rounded-2xl bg-white p-4 ring-1 ring-grafito/10"
            >
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="skeleton mb-3 h-12 rounded-lg" />
              ))}
            </div>
          ) : proveedores.length === 0 ? (
            <EmptyState
              icon={Truck}
              title="Sin proveedores"
              message={
                search || filtroActivo !== ''
                  ? 'Ningún proveedor coincide con los filtros aplicados.'
                  : 'Todavía no hay proveedores registrados.'
              }
            />
          ) : (
            <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-grafito/10">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead>
                  <tr className="border-b border-grafito/10 text-xs font-semibold uppercase tracking-wide text-warmgray">
                    <th className="px-4 py-3">Proveedor</th>
                    <th className="px-4 py-3">Categorías</th>
                    <th className="px-4 py-3">Entrega</th>
                    <th className="px-4 py-3">Confiabilidad</th>
                    <th className="px-4 py-3">Comercial</th>
                    <th className="px-4 py-3">Estado</th>
                    <th className="px-4 py-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {proveedores.map((p) => (
                    <tr key={p.id} className="border-b border-grafito/5 last:border-0">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-grafito">{p.nombre}</p>
                        <p className="text-xs text-warmgray">
                          {[p.contacto, p.email].filter(Boolean).join(' · ') || '—'}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex max-w-56 flex-wrap gap-1">
                          {p.categorias_cubiertas?.length ? (
                            p.categorias_cubiertas.map((c) => (
                              <span
                                key={c}
                                className="rounded-full bg-root/10 px-2 py-0.5 text-[11px] font-medium text-root"
                              >
                                {c}
                              </span>
                            ))
                          ) : (
                            <span className="text-xs text-warmgray">—</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-warmgray">
                        {p.tiempo_entrega_min_dias != null &&
                        p.tiempo_entrega_max_dias != null ? (
                          <>
                            {p.tiempo_entrega_min_dias}–{p.tiempo_entrega_max_dias} días
                            <span className="block text-xs">
                              nominal {p.tiempo_entrega_dias}d
                            </span>
                          </>
                        ) : (
                          `${p.tiempo_entrega_dias} día${p.tiempo_entrega_dias === 1 ? '' : 's'}`
                        )}
                      </td>
                      <td className="px-4 py-3 text-warmgray">
                        {p.confiabilidad_pct != null ? `${p.confiabilidad_pct}%` : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-warmgray">
                        {p.pedido_minimo_monto > 0 && (
                          <span className="block">
                            Mín. {formatMoney(p.pedido_minimo_monto)}
                          </span>
                        )}
                        {p.costo_envio > 0 && (
                          <span className="block">Envío {formatMoney(p.costo_envio)}</span>
                        )}
                        {p.pedido_minimo_monto === 0 && p.costo_envio === 0 && '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                            p.activo ? 'bg-root/10 text-root' : 'bg-terra/10 text-terra'
                          }`}
                        >
                          {p.activo ? 'Activo' : 'Inactivo'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <button
                            onClick={() => setModal(p)}
                            disabled={procesando === p.id}
                            title="Editar proveedor"
                            aria-label={`Editar ${p.nombre}`}
                            className="rounded-lg p-2 text-warmgray transition hover:bg-root/10 hover:text-root disabled:opacity-40"
                          >
                            <Pencil size={16} strokeWidth={1.5} />
                          </button>
                          <button
                            onClick={() => toggleActivo(p)}
                            disabled={procesando === p.id}
                            title={
                              p.activo
                                ? 'Desactivar proveedor (bloqueado si tiene órdenes vivas)'
                                : 'Reactivar proveedor'
                            }
                            aria-label={`${p.activo ? 'Desactivar' : 'Reactivar'} ${p.nombre}`}
                            className={`rounded-lg p-2 text-warmgray transition disabled:opacity-40 ${
                              p.activo
                                ? 'hover:bg-terra/10 hover:text-terra'
                                : 'hover:bg-root/10 hover:text-root'
                            }`}
                          >
                            {procesando === p.id ? (
                              <LoaderCircle size={16} className="animate-spin" strokeWidth={1.5} />
                            ) : (
                              <Truck size={16} strokeWidth={1.5} />
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {pagination && pagination.totalPages > 1 && (
                <div className="flex items-center justify-between border-t border-grafito/10 px-4 py-3 text-sm text-warmgray">
                  <span>
                    Página {pagination.page} de {pagination.totalPages}
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setPage(page - 1);
                        cargar(page - 1);
                      }}
                      disabled={page <= 1}
                      className="rounded-lg border border-grafito/15 px-3 py-1.5 font-semibold transition hover:bg-root/10 disabled:opacity-40"
                    >
                      Anterior
                    </button>
                    <button
                      onClick={() => {
                        setPage(page + 1);
                        cargar(page + 1);
                      }}
                      disabled={page >= pagination.totalPages}
                      className="rounded-lg border border-grafito/15 px-3 py-1.5 font-semibold transition hover:bg-root/10 disabled:opacity-40"
                    >
                      Siguiente
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </main>

        <footer className="border-t border-grafito/10 px-8 py-4 text-center text-xs text-warmgray">
          MERCADO RAÍZ · Del campo a tu mesa, con inteligencia · Desde 1952 ·{' '}
          <Link to="/privacidad" className="font-semibold text-root hover:underline">
            Privacidad
          </Link>
        </footer>
      </div>

      {modal && (
        <ProveedorModal
          proveedor={modal === 'nuevo' ? null : modal}
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

// Modal alta/edición — los datos de contacto son personales →
// checkbox de privacidad obligatorio no pre-tildado; submit disabled
// hasta que el form sea válido y (en edición) haya cambios reales.
function ProveedorModal({ proveedor, onClose, onSaved }) {
  const esEdicion = !!proveedor;
  const [f, setF] = useState(() => ({
    nombre: proveedor?.nombre ?? '',
    contacto: proveedor?.contacto ?? '',
    telefono: proveedor?.telefono ?? '',
    email: proveedor?.email ?? '',
    tiempo_entrega_dias: proveedor?.tiempo_entrega_dias ?? 1,
    tiempo_entrega_min_dias: proveedor?.tiempo_entrega_min_dias ?? '',
    tiempo_entrega_max_dias: proveedor?.tiempo_entrega_max_dias ?? '',
    confiabilidad_pct: proveedor?.confiabilidad_pct ?? '',
    pedido_minimo_monto: proveedor?.pedido_minimo_monto ?? 0,
    costo_envio: proveedor?.costo_envio ?? 0,
    categorias_cubiertas: proveedor?.categorias_cubiertas ?? [],
  }));
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

  const set = (campo) => (e) => setF((s) => ({ ...s, [campo]: e.target.value }));
  const setNum = (campo) => (e) =>
    setF((s) => ({ ...s, [campo]: e.target.value === '' ? '' : Number(e.target.value) }));
  const toggleCat = (cat) =>
    setF((s) => ({
      ...s,
      categorias_cubiertas: s.categorias_cubiertas.includes(cat)
        ? s.categorias_cubiertas.filter((c) => c !== cat)
        : [...s.categorias_cubiertas, cat],
    }));

  // '' en numérico → null (los campos de rango/confiabilidad son
  // nullable; tiempo_entrega_dias y montos caen al default).
  const num = (v, fallback) => (v === '' || v == null ? fallback : Number(v));
  const payload = {
    nombre: f.nombre.trim(),
    contacto: f.contacto.trim() || null,
    telefono: f.telefono.trim() || null,
    email: f.email.trim() || null,
    tiempo_entrega_dias: num(f.tiempo_entrega_dias, 1),
    tiempo_entrega_min_dias: num(f.tiempo_entrega_min_dias, null),
    tiempo_entrega_max_dias: num(f.tiempo_entrega_max_dias, null),
    confiabilidad_pct: num(f.confiabilidad_pct, null),
    pedido_minimo_monto: num(f.pedido_minimo_monto, 0),
    costo_envio: num(f.costo_envio, 0),
    categorias_cubiertas: f.categorias_cubiertas,
  };

  const cambios = esEdicion
    ? Object.fromEntries(
        Object.entries(payload).filter(([k, v]) => {
          const prev = proveedor[k];
          if (Array.isArray(v)) {
            return (
              v.length !== (prev?.length ?? 0) || v.some((c) => !prev?.includes(c))
            );
          }
          return v !== (prev ?? null);
        }),
      )
    : null;

  const rangoValido =
    payload.tiempo_entrega_min_dias == null ||
    payload.tiempo_entrega_max_dias == null ||
    payload.tiempo_entrega_min_dias <= payload.tiempo_entrega_max_dias;
  const emailValido = payload.email == null || EMAIL_RE.test(payload.email);
  const enterosOk =
    Number.isInteger(payload.tiempo_entrega_dias) &&
    payload.tiempo_entrega_dias >= 0 &&
    (payload.tiempo_entrega_min_dias == null ||
      (Number.isInteger(payload.tiempo_entrega_min_dias) &&
        payload.tiempo_entrega_min_dias >= 0)) &&
    (payload.tiempo_entrega_max_dias == null ||
      (Number.isInteger(payload.tiempo_entrega_max_dias) &&
        payload.tiempo_entrega_max_dias >= 0)) &&
    (payload.confiabilidad_pct == null ||
      (Number.isInteger(payload.confiabilidad_pct) &&
        payload.confiabilidad_pct >= 0 &&
        payload.confiabilidad_pct <= 100)) &&
    payload.pedido_minimo_monto >= 0 &&
    payload.costo_envio >= 0;

  const valido =
    payload.nombre !== '' &&
    emailValido &&
    rangoValido &&
    enterosOk &&
    acepta &&
    (!esEdicion || Object.keys(cambios).length > 0);

  const submit = async () => {
    if (!valido || enviando) return;
    setEnviando(true);
    setErrorEnvio(null);
    try {
      if (esEdicion) {
        await editarProveedor(proveedor.id, cambios);
        await onSaved(`${payload.nombre} actualizado`);
      } else {
        await crearProveedor(payload);
        await onSaved(`${payload.nombre} creado`);
      }
    } catch (e) {
      setErrorEnvio(e.message);
    } finally {
      setEnviando(false);
    }
  };

  const inputCls =
    'h-11 w-full rounded-lg border border-grafito/15 bg-cream/40 px-3 text-sm text-grafito outline-none transition placeholder:text-warmgray/70 focus:border-root focus:ring-2 focus:ring-grafito/15 disabled:opacity-60';
  const labelCls =
    'mb-1.5 block text-xs font-semibold uppercase tracking-wide text-warmgray';

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-grafito/50 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={esEdicion ? `Editar ${proveedor.nombre}` : 'Nuevo proveedor'}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl bg-white p-6 shadow-lift ring-1 ring-grafito/10"
      >
        <div className="flex items-center justify-between">
          <h3 className="font-sans tracking-tight text-lg font-bold text-grafito">
            {esEdicion ? `Editar ${proveedor.nombre}` : 'Nuevo proveedor'}
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
          <span className={labelCls}>Nombre *</span>
          <input
            type="text"
            value={f.nombre}
            onChange={set('nombre')}
            placeholder="Razón social"
            maxLength={200}
            className={inputCls}
          />
        </label>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={labelCls}>Contacto</span>
            <input
              type="text"
              value={f.contacto}
              onChange={set('contacto')}
              placeholder="Persona de contacto"
              maxLength={200}
              className={inputCls}
            />
          </label>
          <label className="block">
            <span className={labelCls}>Teléfono</span>
            <input
              type="text"
              value={f.telefono}
              onChange={set('telefono')}
              placeholder="+54 11 …"
              maxLength={50}
              className={inputCls}
            />
          </label>
        </div>

        <label className="block">
          <span className={labelCls}>Email</span>
          <input
            type="email"
            value={f.email}
            onChange={set('email')}
            placeholder="ventas@proveedor.com"
            className={inputCls}
          />
        </label>

        <fieldset>
          <legend className={labelCls}>Categorías que cubre</legend>
          <div className="grid grid-cols-2 gap-1.5">
            {CATEGORIAS.map((c) => (
              <label
                key={c}
                className="flex items-center gap-2 rounded-lg border border-grafito/10 px-2.5 py-1.5 text-xs text-grafito"
              >
                <input
                  type="checkbox"
                  checked={f.categorias_cubiertas.includes(c)}
                  onChange={() => toggleCat(c)}
                  className="h-3.5 w-3.5 rounded border-root/30 accent-root"
                />
                {c}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid grid-cols-3 gap-3">
          <label className="block">
            <span className={labelCls}>Entrega nominal (d)</span>
            <input
              type="number"
              min="0"
              step="1"
              value={f.tiempo_entrega_dias}
              onChange={setNum('tiempo_entrega_dias')}
              className={inputCls}
            />
          </label>
          <label className="block">
            <span className={labelCls}>Entrega mín (d)</span>
            <input
              type="number"
              min="0"
              step="1"
              value={f.tiempo_entrega_min_dias}
              onChange={setNum('tiempo_entrega_min_dias')}
              placeholder="—"
              className={inputCls}
            />
          </label>
          <label className="block">
            <span className={labelCls}>Entrega máx (d)</span>
            <input
              type="number"
              min="0"
              step="1"
              value={f.tiempo_entrega_max_dias}
              onChange={setNum('tiempo_entrega_max_dias')}
              placeholder="—"
              className={inputCls}
            />
          </label>
        </div>
        {!rangoValido && (
          <p className="text-xs text-terra">
            La entrega mínima no puede superar a la máxima.
          </p>
        )}

        <div className="grid grid-cols-3 gap-3">
          <label className="block">
            <span className={labelCls}>Confiabilidad %</span>
            <input
              type="number"
              min="0"
              max="100"
              step="1"
              value={f.confiabilidad_pct}
              onChange={setNum('confiabilidad_pct')}
              placeholder="—"
              className={inputCls}
            />
          </label>
          <label className="block">
            <span className={labelCls}>Pedido mínimo $</span>
            <input
              type="number"
              min="0"
              value={f.pedido_minimo_monto}
              onChange={setNum('pedido_minimo_monto')}
              className={inputCls}
            />
          </label>
          <label className="block">
            <span className={labelCls}>Costo envío $</span>
            <input
              type="number"
              min="0"
              value={f.costo_envio}
              onChange={setNum('costo_envio')}
              className={inputCls}
            />
          </label>
        </div>

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
                <Truck size={16} strokeWidth={1.5} /> Crear proveedor
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
