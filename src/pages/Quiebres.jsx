import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CircleDollarSign,
  ClipboardList,
  PackageX,
  ShoppingBag,
  TriangleAlert,
  TrendingDown,
} from 'lucide-react';
import Sidebar from '../components/Sidebar.jsx';
import Topbar from '../components/Topbar.jsx';
import Toasts from '../components/Toasts.jsx';
import AjusteStockModal from '../components/AjusteStockModal.jsx';
import VentaModal from '../components/VentaModal.jsx';
import { EmptyState, ErrorState } from '../components/ui.jsx';
import { getDemandaStats, getProductosQuiebres } from '../lib/api.js';
import { logout } from '../lib/auth.js';
import { formatMoney } from '../data/orders.js';

let toastKey = 0;

// SPEC-27 T27.4: quiebres ordenados por margen en riesgo — la lista
// de acción diaria del encargado. Cruza el catálogo (stock real)
// con las stats de demanda (demanda_diaria × margen_unitario =
// lo que se deja de ganar por día sin stock). Todos los roles.
export default function Quiebres({ usuario }) {
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [filas, setFilas] = useState([]);
  const [filtro, setFiltro] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [venta, setVenta] = useState(null);
  const [ajuste, setAjuste] = useState(null);
  const timers = useRef([]);

  const pushToast = useCallback((mensaje, tipo = 'ok') => {
    const key = ++toastKey;
    setToasts((t) => [...t, { key, tipo, mensaje }]);
    timers.current.push(
      setTimeout(() => setToasts((t) => t.filter((x) => x.key !== key)), 4000),
    );
  }, []);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const [productos, statsRes] = await Promise.allSettled([
        getProductosQuiebres(),
        getDemandaStats(90),
      ]);
      if (productos.status === 'rejected') throw productos.reason;
      if (statsRes.status === 'rejected') {
        pushToast(
          'Estadísticas de demanda no disponibles: se muestran solo los datos de stock',
          'error',
        );
      }
      const stats =
        statsRes.status === 'fulfilled' && Array.isArray(statsRes.value?.data)
          ? new Map(statsRes.value.data.map((d) => [d.producto_id, d]))
          : new Map();
      setFilas(
        productos.value.map((p) => {
          const s = stats.get(p.id) ?? {};
          const demanda = s.demanda_diaria ?? 0;
          const margen = s.margen_unitario ?? null;
          // $ de margen que se deja de ganar POR DÍA sin stock.
          const perdidaDia =
            p.stock_actual === 0 && margen != null
              ? Math.max(0, demanda * margen)
              : null;
          return {
            ...p,
            demanda,
            cobertura: demanda > 0 ? p.stock_actual / demanda : null,
            margen,
            perdidaDia,
            perdido90: s.margen_perdido ?? null,
            diasQuiebre: s.dias_en_quiebre ?? null,
          };
        }),
      );
    } catch (e) {
      setError(e);
    } finally {
      setCargando(false);
    }
  }, [pushToast]);

  useEffect(() => {
    cargar();
    return () => timers.current.forEach(clearTimeout);
  }, [cargar]);

  // T30.2: tras venta/ajuste el stock cambia local — recalculo las
  // métricas derivadas de la fila sin refetchear toda la lista.
  const movimientoHecho = useCallback(
    (fila, res, tipo) => {
      setFilas((fs) =>
        fs.map((x) =>
          x.id === fila.id
            ? {
                ...x,
                stock_actual: res.stock_nuevo,
                cobertura: x.demanda > 0 ? res.stock_nuevo / x.demanda : null,
                perdidaDia:
                  res.stock_nuevo === 0 && x.margen != null
                    ? Math.max(0, x.demanda * x.margen)
                    : null,
              }
            : x,
        ),
      );
      setVenta(null);
      setAjuste(null);
      pushToast(
        `${tipo} registrad${tipo === 'Venta' ? 'a' : 'o'} — ${fila.sku}: stock ${res.stock_anterior} → ${res.stock_nuevo}`,
      );
    },
    [pushToast],
  );

  const puedeAjustar = ['GERENTE', 'ADMIN'].includes(usuario?.rol);

  const sinStock = filas.filter((f) => f.stock_actual === 0);
  const enRiesgo = filas.filter((f) => f.stock_actual > 0);
  const totalDia = sinStock.reduce((a, f) => a + (f.perdidaDia ?? 0), 0);
  const total90 = filas.reduce((a, f) => a + (f.perdido90 ?? 0), 0);

  const visibles = (filtro === 'stock0' ? sinStock : filtro === 'riesgo' ? enRiesgo : filas)
    .slice()
    .sort((a, b) => (b.perdidaDia ?? 0) - (a.perdidaDia ?? 0) || (a.cobertura ?? 1e9) - (b.cobertura ?? 1e9));

  return (
    <div className="flex min-h-screen bg-cream">
      <Sidebar
        usuario={usuario}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        activeId="quiebres"
        base="/"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar usuario={usuario} onMenu={() => setMenuOpen(true)} onLogout={logout} />
        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
          <header className="mb-6">
            <h1 className="text-3xl font-bold tracking-tight text-grafito">
              Quiebres de stock
            </h1>
            <p className="mt-1 text-sm text-warmgray">
              Productos sin stock o por debajo del mínimo, ordenados por margen
              que se deja de ganar.
            </p>
          </header>

          <div className="mb-6 grid gap-4 sm:grid-cols-3">
            <Stat
              icon={PackageX}
              label="SKUs sin stock"
              valor={sinStock.length}
              detalle={`${enRiesgo.length} más bajo el mínimo`}
            />
            <Stat
              icon={CircleDollarSign}
              label="Margen en riesgo / día"
              valor={formatMoney(totalDia)}
              detalle="demanda × margen, productos en cero"
            />
            <Stat
              icon={TrendingDown}
              label="Margen perdido (90d)"
              valor={formatMoney(total90)}
              detalle="días en quiebre × demanda × margen"
            />
          </div>

          <div className="mb-4">
            <select
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
              aria-label="Filtrar por estado"
              className="h-10 rounded-lg border border-root/15 bg-white px-3 text-sm text-grafito outline-none focus:border-root focus:ring-2 focus:ring-root/20"
            >
              <option value="">Sin stock + en riesgo</option>
              <option value="stock0">Solo sin stock</option>
              <option value="riesgo">Solo bajo el mínimo</option>
            </select>
          </div>

          {error ? (
            <ErrorState
              title="No se pudieron cargar los quiebres"
              message={error.message}
              action={
                <button
                  onClick={cargar}
                  className="rounded-lg bg-root px-4 py-2 text-sm font-semibold text-white transition hover:bg-root-dark"
                >
                  Reintentar
                </button>
              }
            />
          ) : cargando ? (
            <div
              aria-busy="true"
              aria-label="Cargando quiebres"
              className="rounded-2xl bg-white p-4 ring-1 ring-root/10"
            >
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="skeleton mb-3 h-12 rounded-lg" />
              ))}
            </div>
          ) : visibles.length === 0 ? (
            <EmptyState
              icon={TriangleAlert}
              title="Sin quiebres"
              message="Ningún producto está sin stock ni por debajo del mínimo."
            />
          ) : (
            <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-root/10">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead>
                  <tr className="border-b border-root/10 text-xs uppercase tracking-wide text-warmgray">
                    <th className="px-4 py-3">Producto</th>
                    <th className="px-4 py-3">Categoría</th>
                    <th className="px-4 py-3 text-right">Stock</th>
                    <th className="px-4 py-3 text-right">Demanda/día</th>
                    <th className="px-4 py-3 text-right">Cobertura</th>
                    <th className="px-4 py-3 text-right">Margen/u</th>
                    <th className="px-4 py-3 text-right">Pérdida/día</th>
                    <th className="px-4 py-3 text-right">Perdido 90d</th>
                    <th className="px-4 py-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((f) => (
                    <tr
                      key={f.id}
                      className="border-b border-root/5 last:border-0 hover:bg-root/5"
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-grafito">{f.nombre}</div>
                        <div className="text-xs text-warmgray">{f.sku}</div>
                      </td>
                      <td className="px-4 py-3 text-warmgray">{f.categoria}</td>
                      <td className="px-4 py-3 text-right">
                        <span
                          className={
                            f.stock_actual === 0
                              ? 'font-semibold text-red-700'
                              : 'text-amber-700'
                          }
                        >
                          {f.stock_actual}
                        </span>
                        <span className="text-warmgray"> / {f.stock_minimo}</span>
                      </td>
                      <td className="px-4 py-3 text-right text-grafito">
                        {f.demanda > 0 ? f.demanda.toFixed(1) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-grafito">
                        {f.cobertura != null ? `${f.cobertura.toFixed(1)} d` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-grafito">
                        {f.margen != null ? formatMoney(f.margen) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-red-700">
                        {f.perdidaDia != null && f.perdidaDia > 0
                          ? formatMoney(f.perdidaDia)
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-grafito">
                        {f.perdido90 != null ? formatMoney(f.perdido90) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="inline-flex gap-1">
                          <button
                            onClick={() => setVenta(f)}
                            title="Registrar venta"
                            aria-label={`Registrar venta de ${f.sku}`}
                            className="rounded-lg p-1.5 text-warmgray transition hover:bg-root/10 hover:text-root"
                          >
                            <ShoppingBag size={16} strokeWidth={1.5} />
                          </button>
                          {puedeAjustar && (
                            <button
                              onClick={() => setAjuste(f)}
                              title="Ajustar stock (conteo / merma)"
                              aria-label={`Ajustar stock de ${f.sku}`}
                              className="rounded-lg p-1.5 text-warmgray transition hover:bg-root/10 hover:text-root"
                            >
                              <ClipboardList size={16} strokeWidth={1.5} />
                            </button>
                          )}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </main>
      </div>
      {venta && (
        <VentaModal
          producto={venta}
          onClose={() => setVenta(null)}
          onHecho={(res) => movimientoHecho(venta, res, 'Venta')}
        />
      )}
      {ajuste && (
        <AjusteStockModal
          producto={ajuste}
          onClose={() => setAjuste(null)}
          onHecho={(res) => movimientoHecho(ajuste, res, 'Ajuste')}
        />
      )}
      <Toasts toasts={toasts} />
    </div>
  );
}

function Stat({ icon: Icon, label, valor, detalle }) {
  return (
    <div className="rounded-2xl bg-white p-5 ring-1 ring-root/10">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-warmgray">
        <Icon size={14} strokeWidth={1.5} />
        {label}
      </div>
      <div className="mt-2 text-2xl font-bold tracking-tight text-grafito">{valor}</div>
      <div className="mt-1 text-xs text-warmgray">{detalle}</div>
    </div>
  );
}
