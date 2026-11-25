import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CalendarClock,
  CircleDollarSign,
  LoaderCircle,
  PackageX,
  Tag,
  Trash2,
} from 'lucide-react';
import Sidebar from '../components/Sidebar.jsx';
import Topbar from '../components/Topbar.jsx';
import Toasts from '../components/Toasts.jsx';
import AjustePrecioModal from '../components/AjustePrecioModal.jsx';
import { EmptyState, ErrorState } from '../components/ui.jsx';
import { bajaLote, getLotes } from '../lib/api.js';
import { logout } from '../lib/auth.js';
import { formatMoney } from '../data/orders.js';

let toastKey = 0;

const ESTADOS = {
  VENCIDO: { label: 'Vencido', cls: 'bg-red-100 text-red-800' },
  PROXIMO: { label: 'Próximo', cls: 'bg-amber-100 text-amber-800' },
  VIGENTE: { label: 'Vigente', cls: 'bg-emerald-100 text-emerald-800' },
  AGOTADO: { label: 'Agotado', cls: 'bg-stone-200 text-stone-600' },
};

const fechaCorta = (ymd) => (ymd ? ymd.split('-').reverse().join('/') : '—');
const textoDias = (d) =>
  d == null ? '—' : d < 0 ? `hace ${-d}d` : d === 0 ? 'hoy' : `${d}d`;

// SPEC-33 (T33.4): la cola de acción por vencimiento — lotes con
// fecha (vencidos y próximos primero), valor en riesgo y las dos
// salidas humanas: merma (baja) o liquidación (precio). Todos los
// roles leen; las acciones comparten la matriz del ajuste
// (GERENTE/ADMIN — R33.8).
export default function Vencimientos({ usuario }) {
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [lista, setLista] = useState({ data: [], pagination: null });
  const [resumen, setResumen] = useState(null);
  const [filtro, setFiltro] = useState('');
  const [page, setPage] = useState(1);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [precio, setPrecio] = useState(null);
  const [confirmando, setConfirmando] = useState(null); // lote.id en confirmación de baja
  const [bajando, setBajando] = useState(null);
  const timers = useRef([]);

  const pushToast = useCallback((mensaje, tipo = 'ok') => {
    const key = ++toastKey;
    setToasts((t) => [...t, { key, tipo, mensaje }]);
    timers.current.push(
      setTimeout(() => setToasts((t) => t.filter((x) => x.key !== key)), 4000),
    );
  }, []);

  const cargar = useCallback(
    async (pagina = page, estado = filtro) => {
      setCargando(true);
      setError(null);
      try {
        // La tabla pagina server-side; el resumen agrega los dos
        // estados accionables (acotados por la ventana del motor).
        const [tabla, vencidos, proximos] = await Promise.allSettled([
          getLotes({ estado: estado || undefined, page: pagina, limit: 50 }),
          getLotes({ estado: 'VENCIDO', limit: 100 }),
          getLotes({ estado: 'PROXIMO', limit: 100 }),
        ]);
        if (tabla.status === 'rejected') throw tabla.reason;
        setLista(tabla.value);
        const de = (r) => (r.status === 'fulfilled' ? r.value.data : []);
        const enRiesgo = [...de(vencidos), ...de(proximos)];
        setResumen({
          vencidas: de(vencidos).reduce((a, l) => a + l.cantidad_actual, 0),
          porVencer: de(proximos).reduce((a, l) => a + l.cantidad_actual, 0),
          valor: enRiesgo.reduce((a, l) => a + (l.valor_en_riesgo ?? 0), 0),
          lotes: enRiesgo.length,
        });
      } catch (e) {
        setError(e);
      } finally {
        setCargando(false);
      }
    },
    [page, filtro],
  );

  useEffect(() => {
    cargar(page, filtro);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, filtro]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const cambiarFiltro = (e) => {
    setFiltro(e.target.value);
    setPage(1);
  };

  // Baja = merma por vencimiento (R33.7): confirmación en dos pasos
  // porque descuenta stock real — no es un clic accidental.
  const darDeBaja = async (lote) => {
    setBajando(lote.id);
    try {
      const r = await bajaLote(lote.id);
      setLista((prev) => ({
        ...prev,
        data: prev.data.map((l) =>
          l.id === lote.id
            ? { ...l, cantidad_actual: 0, estado: 'AGOTADO', valor_en_riesgo: 0 }
            : l,
        ),
      }));
      setResumen((r2) =>
        r2 && {
          ...r2,
          vencidas:
            lote.estado === 'VENCIDO' ? r2.vencidas - lote.cantidad_actual : r2.vencidas,
          porVencer:
            lote.estado === 'PROXIMO' ? r2.porVencer - lote.cantidad_actual : r2.porVencer,
          valor: Math.max(0, r2.valor - (lote.valor_en_riesgo ?? 0)),
        },
      );
      pushToast(
        `Lote ${lote.codigo} dado de baja — −${r.data.unidades}u de ${lote.producto.sku}`,
      );
    } catch (e) {
      pushToast(`No se pudo dar de baja ${lote.codigo}: ${e.message}`, 'error');
    } finally {
      setBajando(null);
      setConfirmando(null);
    }
  };

  const puedeOperar = ['GERENTE', 'ADMIN'].includes(usuario?.rol);
  const { data: lotes, pagination } = lista;

  return (
    <div className="flex min-h-screen bg-cream">
      <Sidebar
        usuario={usuario}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        activeId="vencimientos"
        base="/"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar usuario={usuario} onMenu={() => setMenuOpen(true)} onLogout={logout} />
        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
          <header className="mb-6">
            <h1 className="text-3xl font-bold text-grafito">Vencimientos</h1>
            <p className="mt-1 text-sm text-warmgray">
              Lotes por vencer o vencidos — la merma la confirma una persona; la
              alternativa es liquidar el precio antes de que llegue a cero.
            </p>
          </header>

          <div className="mb-6 grid gap-4 sm:grid-cols-3">
            <Stat
              icon={PackageX}
              label="Unidades vencidas"
              valor={resumen?.vencidas ?? '—'}
              detalle="requieren baja (merma por vencimiento)"
            />
            <Stat
              icon={CalendarClock}
              label="Por vencer"
              valor={resumen?.porVencer ?? '—'}
              detalle={`${resumen?.lotes ?? 0} lotes en ventana de alerta`}
            />
            <Stat
              icon={CircleDollarSign}
              label="Valor en riesgo"
              valor={resumen ? formatMoney(resumen.valor) : '—'}
              detalle="cantidad × costo del proveedor principal"
            />
          </div>

          <div className="mb-4">
            <select
              value={filtro}
              onChange={cambiarFiltro}
              aria-label="Filtrar por estado"
              className="h-10 rounded-lg border border-grafito/15 bg-white px-3 text-sm text-grafito outline-none focus:border-root focus:ring-2 focus:ring-grafito/15"
            >
              <option value="">Todos los estados</option>
              <option value="VENCIDO">Vencidos</option>
              <option value="PROXIMO">Próximos</option>
              <option value="VIGENTE">Vigentes</option>
              <option value="AGOTADO">Agotados</option>
            </select>
          </div>

          {error ? (
            <ErrorState
              title="No se pudieron cargar los lotes"
              message={error.message}
              action={
                <button
                  onClick={() => cargar(page, filtro)}
                  className="rounded-lg bg-root px-4 py-2 text-sm font-semibold text-white transition hover:bg-root-dark"
                >
                  Reintentar
                </button>
              }
            />
          ) : cargando ? (
            <div
              aria-busy="true"
              aria-label="Cargando vencimientos"
              className="rounded-2xl bg-white p-4 ring-1 ring-grafito/10"
            >
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="skeleton mb-3 h-12 rounded-lg" />
              ))}
            </div>
          ) : lotes.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title="Sin lotes"
              message="No hay lotes para el filtro elegido."
            />
          ) : (
            <>
              <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-grafito/10">
                <table className="w-full min-w-[960px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-grafito/10 text-xs uppercase tracking-wide text-warmgray">
                      <th className="px-4 py-3">Producto</th>
                      <th className="px-4 py-3">Lote</th>
                      <th className="px-4 py-3 text-right">Cantidad</th>
                      <th className="px-4 py-3">Vencimiento</th>
                      <th className="px-4 py-3 text-right">Días</th>
                      <th className="px-4 py-3">Estado</th>
                      <th className="px-4 py-3 text-right">Valor en riesgo</th>
                      <th className="px-4 py-3">Origen</th>
                      {puedeOperar && <th className="px-4 py-3 text-right">Acciones</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {lotes.map((l) => {
                      const est = ESTADOS[l.estado] ?? {
                        label: l.estado,
                        cls: 'bg-stone-200 text-stone-600',
                      };
                      return (
                        <tr
                          key={l.id}
                          className="border-b border-grafito/5 last:border-0 hover:bg-root/5"
                        >
                          <td className="px-4 py-3">
                            <div className="font-medium text-grafito">
                              {l.producto.nombre}
                            </div>
                            <div className="text-xs text-warmgray">
                              {l.producto.sku} · {l.producto.categoria}
                            </div>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-grafito">
                            {l.codigo}
                          </td>
                          <td className="px-4 py-3 text-right text-grafito">
                            {l.cantidad_actual}
                            <span className="text-warmgray"> / {l.cantidad_inicial}</span>
                          </td>
                          <td className="px-4 py-3 text-grafito">
                            {fechaCorta(l.fecha_vencimiento)}
                          </td>
                          <td
                            className={`px-4 py-3 text-right font-semibold ${
                              l.dias_restantes != null && l.dias_restantes <= 3
                                ? 'text-red-700'
                                : 'text-grafito'
                            }`}
                          >
                            {textoDias(l.dias_restantes)}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${est.cls}`}
                            >
                              {est.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right text-grafito">
                            {l.valor_en_riesgo != null
                              ? formatMoney(l.valor_en_riesgo)
                              : '—'}
                          </td>
                          <td className="px-4 py-3 text-xs text-warmgray">
                            {l.origen}
                            {l.orden_id ? ` · ${l.orden_id}` : ''}
                          </td>
                          {puedeOperar && (
                            <td className="px-4 py-3 text-right">
                              {l.cantidad_actual > 0 ? (
                                confirmando === l.id ? (
                                  <span className="inline-flex items-center gap-1">
                                    <button
                                      onClick={() => darDeBaja(l)}
                                      disabled={bajando === l.id}
                                      aria-label={`Confirmar baja del lote ${l.codigo}`}
                                      className="rounded-lg bg-terra px-2 py-1.5 text-xs font-semibold text-white transition hover:bg-terra/90 disabled:opacity-40"
                                    >
                                      {bajando === l.id ? (
                                        <LoaderCircle size={14} className="animate-spin" />
                                      ) : (
                                        `Bajar ${l.cantidad_actual}u`
                                      )}
                                    </button>
                                    <button
                                      onClick={() => setConfirmando(null)}
                                      aria-label="Cancelar baja"
                                      className="rounded-lg px-2 py-1.5 text-xs text-warmgray transition hover:bg-grafito/5"
                                    >
                                      No
                                    </button>
                                  </span>
                                ) : (
                                  <span className="inline-flex gap-1">
                                    <button
                                      onClick={() => setPrecio(l.producto)}
                                      title="Liquidar precio (motivo LIQUIDACION)"
                                      aria-label={`Liquidar precio de ${l.producto.sku}`}
                                      className="rounded-lg p-1.5 text-warmgray transition hover:bg-root/10 hover:text-root"
                                    >
                                      <Tag size={16} strokeWidth={1.5} />
                                    </button>
                                    <button
                                      onClick={() => setConfirmando(l.id)}
                                      title="Dar de baja (merma por vencimiento)"
                                      aria-label={`Dar de baja el lote ${l.codigo}`}
                                      className="rounded-lg p-1.5 text-warmgray transition hover:bg-terra/10 hover:text-terra"
                                    >
                                      <Trash2 size={16} strokeWidth={1.5} />
                                    </button>
                                  </span>
                                )
                              ) : (
                                <span className="text-xs text-warmgray">—</span>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {pagination && pagination.totalPages > 1 && (
                <div className="mt-4 flex items-center justify-center gap-3 text-sm text-warmgray">
                  <span className="tabular">
                    Página {pagination.page} de {pagination.totalPages}
                  </span>
                  <button
                    onClick={() => setPage(page - 1)}
                    disabled={page <= 1}
                    className="rounded-lg bg-white px-3 py-1.5 font-semibold text-root ring-1 ring-grafito/10 transition hover:bg-cream disabled:opacity-40"
                  >
                    Anterior
                  </button>
                  <button
                    onClick={() => setPage(page + 1)}
                    disabled={page >= pagination.totalPages}
                    className="rounded-lg bg-white px-3 py-1.5 font-semibold text-root ring-1 ring-grafito/10 transition hover:bg-cream disabled:opacity-40"
                  >
                    Siguiente
                  </button>
                </div>
              )}
            </>
          )}
        </main>
      </div>
      {precio && (
        <AjustePrecioModal
          producto={precio}
          motivoInicial="LIQUIDACION"
          onClose={() => setPrecio(null)}
          onHecho={(res) => {
            setPrecio(null);
            pushToast(
              `Precio de ${precio.sku}: ${formatMoney(res.precio_anterior)} → ${formatMoney(res.precio_nuevo)} (liquidación)`,
            );
          }}
        />
      )}
      <Toasts toasts={toasts} />
    </div>
  );
}

function Stat({ icon: Icon, label, valor, detalle }) {
  return (
    <div className="rounded-2xl bg-white p-5 ring-1 ring-grafito/10">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-warmgray">
        <Icon size={14} strokeWidth={1.5} />
        {label}
      </div>
      <div className="mt-2 text-2xl font-bold text-grafito">{valor}</div>
      <div className="mt-1 text-xs text-warmgray">{detalle}</div>
    </div>
  );
}
