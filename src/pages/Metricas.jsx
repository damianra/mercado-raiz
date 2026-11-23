import { useCallback, useEffect, useState } from 'react';
import {
  Boxes,
  ChartColumn,
  ClipboardCheck,
  Gauge,
  PackageX,
  TriangleAlert,
  Truck,
} from 'lucide-react';
import Sidebar from '../components/Sidebar.jsx';
import Topbar from '../components/Topbar.jsx';
import { EmptyState, ErrorState } from '../components/ui.jsx';
import { getMetricas } from '../lib/api.js';
import { logout } from '../lib/auth.js';
import { formatMoney } from '../data/orders.js';

// SPEC-28 (R28.2): scorecard de métricas retail — la respuesta
// agregada a "qué góndola vacía me cuesta más, qué stock no se
// mueve, qué órdenes firmo hoy". Todos los roles.
export default function Metricas({ usuario }) {
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [m, setM] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setM(await getMetricas(90));
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
            <h1 className="text-3xl font-bold tracking-tight text-grafito">
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

              <div className="mb-6 grid gap-4 lg:grid-cols-2">
                <section className="rounded-2xl bg-white p-5 ring-1 ring-root/10">
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

                <section className="rounded-2xl bg-white p-5 ring-1 ring-root/10">
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

              <section className="overflow-x-auto rounded-2xl bg-white ring-1 ring-root/10">
                <h2 className="flex items-center gap-2 px-5 pt-5 text-sm font-semibold uppercase tracking-wide text-warmgray">
                  <Truck size={14} strokeWidth={1.5} />
                  Scorecard de proveedores
                </h2>
                <table className="mt-3 w-full min-w-[820px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-root/10 text-xs uppercase tracking-wide text-warmgray">
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
                      <tr key={p.id} className="border-b border-root/5 last:border-0 hover:bg-root/5">
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
