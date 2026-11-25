import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Boxes,
  ChartColumn,
  ClipboardCheck,
  Gauge,
  PackageX,
  Tag,
  TriangleAlert,
  TrendingDown,
  Truck,
} from 'lucide-react';
import Sidebar from '../components/Sidebar.jsx';
import Topbar from '../components/Topbar.jsx';
import AjustePrecioModal from '../components/AjustePrecioModal.jsx';
import Toasts from '../components/Toasts.jsx';
import {
  CapitalParetoChart,
  CompetitividadChart,
  VentasDiariasChart,
} from '../components/charts/index.jsx';
import { EmptyState, ErrorState } from '../components/ui.jsx';
import {
  getCapitalInmovilizado,
  getCompetitividad,
  getMetricas,
  getPricing,
  getVentasDiarias,
} from '../lib/api.js';
import { logout } from '../lib/auth.js';
import { formatMoney } from '../data/orders.js';

let toastKey = 0;

// SPEC-28 (R28.2): scorecard de métricas retail — la respuesta
// agregada a "qué góndola vacía me cuesta más, qué stock no se
// mueve, qué órdenes firmo hoy". Todos los roles.
export default function Metricas({ usuario }) {
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [m, setM] = useState(null);
  const [comp, setComp] = useState(null);
  const [ventas, setVentas] = useState(null);
  const [capital, setCapital] = useState(null);
  const [pricing, setPricing] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [precio, setPrecio] = useState(null);
  const [toasts, setToasts] = useState([]);
  const timers = useRef([]);

  const pushToast = useCallback((mensaje, tipo = 'ok') => {
    const key = ++toastKey;
    setToasts((t) => [...t, { key, tipo, mensaje }]);
    timers.current.push(
      setTimeout(() => setToasts((t) => t.filter((x) => x.key !== key)), 4000),
    );
  }, []);

  useEffect(
    () => () => timers.current.forEach(clearTimeout),
    [],
  );

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const [mm, cc, vv, kk, pp] = await Promise.all([
        getMetricas(90),
        getCompetitividad(),
        getVentasDiarias(90),
        getCapitalInmovilizado(90),
        getPricing(90),
      ]);
      setM(mm);
      setComp(cc);
      setVentas(vv);
      setCapital(kk);
      setPricing(pp);
    } catch (e) {
      setError(e);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const riesgo = m?.riesgo ?? {};
  const inv = m?.inventario ?? {};
  const q = m?.quiebres ?? {};
  const puedeAjustar = ['GERENTE', 'ADMIN'].includes(usuario?.rol);

  // Distribución del catálogo por zona de precio vs mercado (T32.3):
  // banda apilada 100% — barata / en rango / cara.
  const zonas = comp
    ? [
        { id: 'BAJO_MIN', label: 'Más baratos que el mercado', n: comp.vsMercado.BAJO_MIN, cls: 'bg-root' },
        { id: 'EN_RANGO', label: 'En rango', n: comp.vsMercado.EN_RANGO, cls: 'bg-stone-300' },
        { id: 'SOBRE_MAX', label: 'Por encima del máximo', n: comp.vsMercado.SOBRE_MAX, cls: 'bg-ocre' },
      ]
    : [];

  return (
    <div className="flex min-h-screen bg-cream">
      <Sidebar
        usuario={usuario}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        activeId="metricas"
        base="/"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar usuario={usuario} onMenu={() => setMenuOpen(true)} onLogout={logout} />
        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
          <header className="mb-6">
            <h1 className="text-3xl font-bold text-grafito">
              Métricas del negocio
            </h1>
            <p className="mt-1 text-sm text-warmgray">
              Scorecard operativo de los últimos {m?.dias ?? 90} días — quiebres,
              riesgo, inventario y proveedores en plata.
            </p>
          </header>

          {error ? (
            <ErrorState
              title="No se pudieron cargar las métricas"
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
            <div aria-busy="true" aria-label="Cargando métricas" className="grid gap-4 sm:grid-cols-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="skeleton h-28 rounded-2xl" />
              ))}
            </div>
          ) : !m ? (
            <EmptyState
              icon={ChartColumn}
              title="Sin métricas"
              message="El scorecard no devolvió datos."
            />
          ) : (
            <>
              <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Stat
                  icon={Gauge}
                  label="Fill rate"
                  valor={m.servicio.fill_rate_pct != null ? `${m.servicio.fill_rate_pct}%` : '—'}
                  detalle={`${m.servicio.skus_con_historial} SKUs con historial confiable`}
                />
                <Stat
                  icon={PackageX}
                  label="Margen en riesgo / día"
                  valor={m.quiebres.margen_riesgo_dia != null ? formatMoney(m.quiebres.margen_riesgo_dia) : '—'}
                  detalle={`${m.quiebres.skus_sin_stock} sin stock · ${m.quiebres.skus_bajo_minimo} bajo el mínimo`}
                />
                <Stat
                  icon={Boxes}
                  label="Inventario a costo"
                  valor={inv.valor_costo != null ? formatMoney(inv.valor_costo) : '—'}
                  detalle={`${formatMoney(inv.valor_venta)} a precio de venta`}
                />
                <Stat
                  icon={ClipboardCheck}
                  label="Órdenes por aprobar"
                  valor={formatMoney(m.ordenes.pendientes_monto)}
                  detalle={`${m.ordenes.pendientes} pendientes de aprobación`}
                />
              </div>

              {ventas?.serie?.length > 0 && (
                <section className="mb-6 rounded-2xl bg-white p-5 ring-1 ring-grafito/10">
                  <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-warmgray">
                    <ChartColumn size={14} strokeWidth={1.5} />
                    Ventas del período — facturación por día
                  </h2>
                  <VentasDiariasChart serie={ventas.serie} />
                </section>
              )}

              {comp && (
                <section className="mb-6 rounded-2xl bg-white p-5 ring-1 ring-grafito/10">
                  <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-warmgray">
                    <Gauge size={14} strokeWidth={1.5} />
                    Competitividad de precios
                  </h2>
                  <p className="mb-4 text-xs text-warmgray">
                    {comp.total_productos} artículos vs las 4 cadenas — precios al{' '}
                    {comp.fecha_snapshot}
                  </p>
                  <div className="mb-4 flex h-3 w-full overflow-hidden rounded-full">
                    {zonas.map((z) => (
                      <div
                        key={z.id}
                        className={z.cls}
                        style={{ width: `${(z.n / comp.total_productos) * 100}%` }}
                      />
                    ))}
                  </div>
                  <div className="mb-5 flex flex-wrap gap-x-5 gap-y-1 text-xs text-warmgray">
                    {zonas.map((z) => (
                      <span key={z.id} className="inline-flex items-center gap-1.5">
                        <span className={`size-2 rounded-full ${z.cls}`} />
                        {z.label}:{' '}
                        <span className="font-semibold text-grafito">
                          {z.n} ({Math.round((z.n / comp.total_productos) * 100)}%)
                        </span>
                      </span>
                    ))}
                  </div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-warmgray">
                    % del catálogo más barato que cada cadena
                  </p>
                  <CompetitividadChart porCadena={comp.porCadena} />
                </section>
              )}

              {capital?.top?.length > 0 && (
                <section className="mb-6 rounded-2xl bg-white p-5 ring-1 ring-grafito/10">
                  <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-warmgray">
                    <PackageX size={14} strokeWidth={1.5} />
                    Capital inmovilizado — {formatMoney(capital.capital_total)}
                  </h2>
                  <p className="mb-4 text-xs text-warmgray">
                    {capital.skus} SKUs sin ventas en {capital.dias}d, valorados a
                    costo — top {capital.top.length} por plata quieta
                  </p>
                  <CapitalParetoChart top={capital.top} />
                </section>
              )}

              {pricing?.items?.length > 0 && (
                <section className="mb-6 overflow-x-auto rounded-2xl bg-white ring-1 ring-grafito/10">
                  <h2 className="flex items-center gap-2 px-5 pt-5 text-sm font-semibold uppercase tracking-wide text-warmgray">
                    <TrendingDown size={14} strokeWidth={1.5} />
                    Pricing accionable — {pricing.total_fuera_de_rango} fuera de rango
                  </h2>
                  <table className="mt-3 w-full min-w-[860px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-grafito/10 text-xs uppercase tracking-wide text-warmgray">
                        <th className="px-5 py-3">Producto</th>
                        <th className="px-4 py-3 text-right">Nuestro precio</th>
                        <th className="px-4 py-3 text-right">Mercado</th>
                        <th className="px-4 py-3 text-right">Índice</th>
                        <th className="px-4 py-3">Acción sugerida</th>
                        {puedeAjustar && <th className="px-4 py-3 text-right">Ajustar</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {pricing.items.map((it) => (
                        <tr
                          key={it.producto_id}
                          className="border-b border-grafito/5 last:border-0 hover:bg-root/5"
                        >
                          <td className="px-5 py-3">
                            <div className="font-medium text-grafito">{it.nombre}</div>
                            <div className="text-xs text-warmgray">{it.sku}</div>
                          </td>
                          <td className="px-4 py-3 text-right font-semibold text-grafito">
                            {formatMoney(it.precio_venta)}
                          </td>
                          <td className="px-4 py-3 text-right text-warmgray">
                            {formatMoney(it.min_mercado)} – {formatMoney(it.max_mercado)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${
                                it.zona === 'SOBRE_MAX'
                                  ? 'bg-ocre/10 text-ocre ring-ocre/30'
                                  : 'bg-root/10 text-root ring-root/30'
                              }`}
                            >
                              {it.indice}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-warmgray">
                            {it.accion}
                            {it.sugerido != null && (
                              <span className="block text-xs text-grafito">
                                sugerido {formatMoney(it.sugerido)}
                              </span>
                            )}
                          </td>
                          {puedeAjustar && (
                            <td className="px-4 py-3 text-right">
                              <button
                                onClick={() =>
                                  setPrecio({
                                    id: it.producto_id,
                                    sku: it.sku,
                                    nombre: it.nombre,
                                    precio_venta: it.precio_venta,
                                  })
                                }
                                aria-label={`Ajustar precio de ${it.sku}`}
                                className="rounded-lg p-1.5 text-warmgray transition hover:bg-root/10 hover:text-root"
                              >
                                <Tag size={16} strokeWidth={1.5} />
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}

              <div className="mb-6 grid gap-4 lg:grid-cols-2">
                <section className="rounded-2xl bg-white p-5 ring-1 ring-grafito/10">
                  <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-warmgray">
                    <TriangleAlert size={14} strokeWidth={1.5} />
                    Riesgo de quiebre (cobertura vs lead)
                  </h2>
                  <div className="space-y-2 text-sm">
                    <Riesgo label="Quiebre seguro" n={riesgo.quiebre_seguro} cls="bg-red-600" />
                    <Riesgo label="Riesgo alto" n={riesgo.riesgo_alto} cls="bg-red-400" />
                    <Riesgo label="Riesgo medio" n={riesgo.riesgo_medio} cls="bg-amber-500" />
                    <Riesgo label="Cubierto" n={riesgo.cubierto} cls="bg-emerald-600" />
                    <Riesgo label="Sin demanda" n={riesgo.sin_demanda} cls="bg-slate-300" />
                  </div>
                </section>

                <section className="rounded-2xl bg-white p-5 ring-1 ring-grafito/10">
                  <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-warmgray">
                    <Boxes size={14} strokeWidth={1.5} />
                    Inventario
                  </h2>
                  <dl className="space-y-3 text-sm">
                    <Fila label="Dead stock (sin venta en la ventana)">
                      {inv.dead_stock_skus} SKUs · {formatMoney(inv.dead_stock_valor_costo)}
                    </Fila>
                    <Fila label={`Exceso (cobertura > ${inv.exceso_cobertura_dias}d)`}>
                      {inv.exceso_skus} SKUs · {formatMoney(inv.exceso_valor_costo)}
                    </Fila>
                    <Fila label="Venta en riesgo / día">
                      {formatMoney(q.venta_riesgo_dia)}
                    </Fila>
                    <Fila label="Margen perdido en la ventana">
                      {q.margen_perdido_ventana != null ? formatMoney(q.margen_perdido_ventana) : '—'}
                    </Fila>
                  </dl>
                </section>
              </div>

              <section className="overflow-x-auto rounded-2xl bg-white ring-1 ring-grafito/10">
                <h2 className="flex items-center gap-2 px-5 pt-5 text-sm font-semibold uppercase tracking-wide text-warmgray">
                  <Truck size={14} strokeWidth={1.5} />
                  Scorecard de proveedores
                </h2>
                <table className="mt-3 w-full min-w-[820px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-grafito/10 text-xs uppercase tracking-wide text-warmgray">
                      <th className="px-5 py-3">Proveedor</th>
                      <th className="px-4 py-3 text-right">SKUs</th>
                      <th className="px-4 py-3 text-right">Lead esp.</th>
                      <th className="px-4 py-3 text-right">Confiabilidad</th>
                      <th className="px-4 py-3 text-right">Órdenes</th>
                      <th className="px-4 py-3 text-right">Monto</th>
                      <th className="px-4 py-3 text-right">Pendientes</th>
                      <th className="px-4 py-3 text-right">Monto pend.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {m.proveedores.map((p) => (
                      <tr key={p.id} className="border-b border-grafito/5 last:border-0 hover:bg-root/5">
                        <td className="px-5 py-3 font-medium text-grafito">{p.nombre}</td>
                        <td className="px-4 py-3 text-right text-grafito">{p.skus}</td>
                        <td className="px-4 py-3 text-right text-grafito">
                          {p.lead_dias_esperado != null ? `${p.lead_dias_esperado}d` : '—'}
                        </td>
                        <td className="px-4 py-3 text-right text-grafito">
                          {p.confiabilidad_pct != null ? `${p.confiabilidad_pct}%` : '—'}
                        </td>
                        <td className="px-4 py-3 text-right text-grafito">{p.ordenes}</td>
                        <td className="px-4 py-3 text-right text-grafito">{formatMoney(p.monto)}</td>
                        <td className="px-4 py-3 text-right">
                          <span className={p.pendientes > 0 ? 'font-semibold text-amber-700' : 'text-grafito'}>
                            {p.pendientes}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-grafito">{formatMoney(p.monto_pendiente)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </>
          )}
        </main>
      </div>
      {precio && (
        <AjustePrecioModal
          producto={precio}
          onClose={() => setPrecio(null)}
          onHecho={(res) => {
            setPrecio(null);
            setPricing((p) =>
              p && {
                ...p,
                items: p.items.map((it) =>
                  it.producto_id === precio.id
                    ? { ...it, precio_venta: res.precio_nuevo }
                    : it,
                ),
              },
            );
            pushToast(
              `Precio de ${precio.sku}: ${formatMoney(res.precio_anterior)} → ${formatMoney(res.precio_nuevo)}`,
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

function Riesgo({ label, n, cls }) {
  return (
    <div className="flex items-center gap-3">
      <span className={`h-2.5 w-2.5 rounded-full ${cls}`} aria-hidden="true" />
      <span className="w-28 text-warmgray">{label}</span>
      <span className="font-semibold text-grafito">{n} SKUs</span>
    </div>
  );
}

function Fila({ label, children }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-warmgray">{label}</dt>
      <dd className="font-semibold text-grafito">{children}</dd>
    </div>
  );
}
