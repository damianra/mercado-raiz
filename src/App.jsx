import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Sidebar from './components/Sidebar.jsx';
import Topbar from './components/Topbar.jsx';
import StatsCards from './components/StatsCards.jsx';
import OrdersTable from './components/OrdersTable.jsx';
import OrderModal from './components/OrderModal.jsx';
import NewOrderModal from './components/NewOrderModal.jsx';
import Toasts from './components/Toasts.jsx';
import { ErrorState } from './components/ui.jsx';
import { formatMoney } from './data/orders.js';
import { Link } from './lib/router.jsx';
import {
  aprobarOrden,
  getDashboardStats,
  getOrdenes,
  mapOrden,
  rechazarOrden,
} from './lib/api.js';

let toastKey = 0;

const esAprobada = (o) => o.estado === 'APROBADO' || o.estado === 'APROBADO_AUTO';

export default function App() {
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [ordenes, setOrdenes] = useState([]);
  const [statsApi, setStatsApi] = useState(null);
  const [detalle, setDetalle] = useState(null);
  const [procesando, setProcesando] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [nuevaOpen, setNuevaOpen] = useState(false);
  const timers = useRef([]);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    const [ordRes, statsRes] = await Promise.allSettled([
      getOrdenes(),
      getDashboardStats(),
    ]);
    if (ordRes.status === 'rejected') {
      // Las órdenes son el contenido principal — si fallan, ErrorState.
      setError(ordRes.reason);
    } else {
      setOrdenes(ordRes.value.data.map(mapOrden));
      // Stats es secundario: si falla se calcula local (fallback abajo).
      setStatsApi(statsRes.status === 'fulfilled' ? statsRes.value : null);
    }
    setCargando(false);
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const pushToast = (mensaje, tipo = 'ok') => {
    const key = ++toastKey;
    setToasts((ts) => [...ts, { key, mensaje, tipo }]);
    timers.current.push(
      setTimeout(() => setToasts((ts) => ts.filter((t) => t.key !== key)), 3000),
    );
  };

  const actualizar = (id, nuevoEstado) =>
    setOrdenes((os) => os.map((o) => (o.id === id ? { ...o, estado: nuevoEstado } : o)));

  const onCreada = (orden) => {
    setOrdenes((os) => [orden, ...os]);
    setNuevaOpen(false);
    pushToast(`Orden ${orden.id} creada por ${formatMoney(orden.monto)}`);
    getDashboardStats().then(setStatsApi).catch(() => {});
  };

  const resolver = async (orden, aprobar) => {
    setProcesando(orden.id);
    try {
      if (aprobar) {
        await aprobarOrden(orden.id);
      } else {
        await rechazarOrden(orden.id, 'Rechazada manualmente desde el panel');
      }
      actualizar(orden.id, aprobar ? 'APROBADO' : 'RECHAZADO');
      setDetalle((d) => (d?.id === orden.id ? null : d));
      pushToast(
        aprobar
          ? `Orden ${orden.id} aprobada por ${formatMoney(orden.monto)}`
          : `Orden ${orden.id} rechazada`,
        aprobar ? 'ok' : 'error',
      );
      // Refresco silencioso de KPIs — si falla queda el cálculo local.
      getDashboardStats().then(setStatsApi).catch(() => {});
    } catch (e) {
      pushToast(
        `No se pudo ${aprobar ? 'aprobar' : 'rechazar'} ${orden.id}: ${e.message}`,
        'error',
      );
    } finally {
      setProcesando(null);
    }
  };

  const stats = useMemo(() => {
    const pendientes = ordenes.filter((o) => o.estado === 'PENDIENTE_APROBACION');
    const local = {
      pendientes: pendientes.length,
      aprobadas: ordenes.filter(esAprobada).length,
      valorTotal: formatMoney(ordenes.reduce((s, o) => s + o.monto, 0)),
      stockBajo: ordenes.filter((o) => o.stockActual < o.stockMinimo).length,
      urgentes: pendientes.filter((o) => o.urgente).length,
      tendenciaPendientes: null,
    };
    if (!statsApi) return local;
    return {
      pendientes: statsApi.ordenes_pendientes,
      aprobadas: statsApi.ordenes_aprobadas_semana,
      valorTotal: formatMoney(statsApi.valor_total_mes),
      stockBajo: statsApi.productos_stock_bajo,
      urgentes: local.urgentes,
      tendenciaPendientes: statsApi.tendencia?.ordenes_pendientes_vs_ayer ?? null,
    };
  }, [ordenes, statsApi]);

  return (
    <div className="flex min-h-screen">
      <Sidebar
        urgentes={stats.urgentes}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          urgentes={stats.urgentes}
          alertas={ordenes.filter((o) => o.urgente)}
          onMenu={() => setMenuOpen(true)}
          onSelectOrden={setDetalle}
        />

        <main className="flex-1 space-y-6 p-4 sm:p-8">
          {cargando ? (
            <SkeletonDashboard />
          ) : error ? (
            <ErrorState
              title="No se pudieron cargar las órdenes"
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
          ) : (
            <>
              <section id="dashboard" className="scroll-mt-20" aria-label="Indicadores">
                <StatsCards stats={stats} />
              </section>
              <OrdersTable
                ordenes={ordenes}
                procesando={procesando}
                onVer={setDetalle}
                onAprobar={(o) => resolver(o, true)}
                onRechazar={(o) => resolver(o, false)}
                onNueva={() => setNuevaOpen(true)}
              />
            </>
          )}
        </main>

        <footer className="border-t border-root/10 px-8 py-4 text-center text-xs text-warmgray">
          MERCADO RAÍZ · Del campo a tu mesa, con inteligencia · Desde 1952 ·{' '}
          <Link to="/privacidad" className="font-semibold text-root hover:underline">
            Privacidad
          </Link>
        </footer>
      </div>

      <OrderModal
        orden={detalle}
        procesando={procesando === detalle?.id}
        onClose={() => setDetalle(null)}
        onAprobar={(o) => resolver(o, true)}
        onRechazar={(o) => resolver(o, false)}
      />
      <NewOrderModal
        open={nuevaOpen}
        onClose={() => setNuevaOpen(false)}
        onCreated={onCreada}
      />
      <Toasts toasts={toasts} />
    </div>
  );
}

function SkeletonDashboard() {
  return (
    <div aria-busy="true" aria-label="Cargando datos">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton h-28 rounded-lg" />
        ))}
      </div>
      <div className="mt-6 rounded-lg bg-white p-4 ring-1 ring-root/10">
        <div className="skeleton h-10 w-full rounded-lg" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton mt-3 h-14 rounded-lg" />
        ))}
      </div>
    </div>
  );
}
