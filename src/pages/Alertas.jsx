import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bell,
  BellOff,
  CheckCheck,
  CircleAlert,
  Clock,
  PackageX,
  ShoppingCart,
  TriangleAlert,
} from 'lucide-react';
import ComprarModal from '../components/ComprarModal.jsx';
import Sidebar from '../components/Sidebar.jsx';
import Topbar from '../components/Topbar.jsx';
import Toasts from '../components/Toasts.jsx';
import { EmptyState, ErrorState } from '../components/ui.jsx';
import {
  getAlertas,
  leerTodasAlertas,
  marcarAlertaLeida,
} from '../lib/api.js';
import { logout } from '../lib/auth.js';

let toastKey = 0;

const TIPOS = {
  QUIEBRE: { label: 'Quiebre', icon: PackageX },
  RIESGO_LEAD: { label: 'Riesgo vs lead', icon: Clock },
  DEAD_STOCK: { label: 'Dead stock', icon: BellOff },
  ORDEN_PENDIENTE: { label: 'Orden pendiente', icon: CircleAlert },
};
// SPEC-29 (R29.6): solo las alertas de falta de stock son
// comprables — dead stock y OC pendiente no se resuelven pidiendo
// más mercadería.
const COMPRABLES = new Set(['QUIEBRE', 'RIESGO_LEAD']);
const SEV = {
  ALTA: { chip: 'bg-red-100 text-red-800', dot: 'bg-red-600', label: 'Alta' },
  MEDIA: { chip: 'bg-amber-100 text-amber-800', dot: 'bg-amber-500', label: 'Media' },
  BAJA: { chip: 'bg-slate-100 text-slate-600', dot: 'bg-slate-400', label: 'Baja' },
};

const fechaCorta = (iso) =>
  new Date(iso).toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

// SPEC-29 (R29.5): dashboard exclusivo del BUYER — las alertas
// operativas que genera el motor de reglas (quiebre, riesgo vs
// lead, dead stock, órdenes viejas sin aprobar).
export default function Alertas({ usuario }) {
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState({ data: [], resumen: null });
  const [tipo, setTipo] = useState('');
  const [soloNoLeidas, setSoloNoLeidas] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [marcandoId, setMarcandoId] = useState(null);
  const [marcandoTodas, setMarcandoTodas] = useState(false);
  const [comprando, setComprando] = useState(null);
  const [toasts, setToasts] = useState([]);
  const timers = useRef([]);

  const pushToast = useCallback((mensaje, t = 'ok') => {
    const key = ++toastKey;
    setToasts((x) => [...x, { key, tipo: t, mensaje }]);
    timers.current.push(
      setTimeout(() => setToasts((x) => x.filter((y) => y.key !== key)), 4000),
    );
  }, []);

  // generación de fetch: un cambio de filtro mid-request no pisa
  // los datos con la respuesta vieja (la lazy-eval puede tardar)
  const gen = useRef(0);
  const cargar = useCallback(async () => {
    const g = ++gen.current;
    setCargando(true);
    setError(null);
    try {
      const res = await getAlertas({
        tipo: tipo || undefined,
        ...(soloNoLeidas ? { leida: 0 } : {}),
      });
      if (g === gen.current) setData(res);
    } catch (e) {
      if (g === gen.current) setError(e);
    } finally {
      if (g === gen.current) setCargando(false);
    }
  }, [tipo, soloNoLeidas]);

  useEffect(() => {
    cargar();
  }, [cargar]);
  // los timers de los toasts se limpian solo al desmontar — atarlos
  // al effect de cargar los cancelaba en cada cambio de filtro y el
  // toast quedaba clavado en pantalla
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const marcar = async (id) => {
    setMarcandoId(id);
    try {
      await marcarAlertaLeida(id);
      await cargar();
    } catch (e) {
      pushToast(`No se pudo marcar la alerta: ${e.message}`, 'error');
    } finally {
      setMarcandoId(null);
    }
  };

  const marcarTodas = async () => {
    setMarcandoTodas(true);
    try {
      const { marcadas } = await leerTodasAlertas();
      pushToast(`${marcadas} alertas marcadas como leídas`);
      await cargar();
    } catch (e) {
      pushToast(`No se pudieron marcar: ${e.message}`, 'error');
    } finally {
      setMarcandoTodas(false);
    }
  };

  // T30.4: el pedido ya creó la OC real PENDIENTE_APROBACION y
  // marcó la alerta leída en el server (misma tx) → solo toast
  // con el número de OC y refresh.
  const pedidoHecho = async (alerta, orden) => {
    setComprando(null);
    pushToast(
      `${orden?.orden_id ?? 'OC'} creada — queda pendiente de aprobación`,
    );
    await cargar();
  };

  const r = data.resumen;

  return (
    <div className="flex min-h-screen bg-cream">
      <Sidebar
        usuario={usuario}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        activeId="alertas"
        base="/"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          usuario={usuario}
          onMenu={() => setMenuOpen(true)}
          onLogout={logout}
          titulo="Alertas operativas"
          subtitulo="Quiebres, riesgos y pendientes que necesitan tu atención"
          sinNotificaciones
        />
        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
          <div className="mb-6 grid gap-4 sm:grid-cols-4">
            <Stat icon={Bell} label="Sin leer" valor={r?.no_leidas ?? '—'} />
            <Stat icon={CircleAlert} label="Altas" valor={r?.altas ?? '—'} cls="text-red-700" />
            <Stat icon={TriangleAlert} label="Medias" valor={r?.medias ?? '—'} cls="text-amber-700" />
            <Stat icon={BellOff} label="Bajas" valor={r?.bajas ?? '—'} cls="text-slate-600" />
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-3">
            <select
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}
              aria-label="Filtrar por tipo"
              className="h-10 rounded-lg border border-grafito/15 bg-white px-3 text-sm text-grafito outline-none focus:border-root focus:ring-2 focus:ring-grafito/15"
            >
              <option value="">Todos los tipos</option>
              {Object.entries(TIPOS).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm text-grafito">
              <input
                type="checkbox"
                checked={soloNoLeidas}
                onChange={(e) => setSoloNoLeidas(e.target.checked)}
                className="h-4 w-4 accent-root"
              />
              Solo no leídas
            </label>
            <button
              onClick={marcarTodas}
              disabled={!r?.no_leidas || marcandoTodas}
              className="ml-auto inline-flex items-center gap-2 rounded-lg bg-root px-4 py-2 text-sm font-semibold text-white transition hover:bg-root-dark disabled:cursor-not-allowed disabled:opacity-40"
            >
              <CheckCheck size={16} strokeWidth={1.5} />
              Marcar todas leídas
            </button>
          </div>

          {error ? (
            <ErrorState
              title="No se pudieron cargar las alertas"
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
            <div aria-busy="true" aria-label="Cargando alertas" className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="skeleton h-16 rounded-2xl" />
              ))}
            </div>
          ) : data.data.length === 0 ? (
            <EmptyState
              icon={Bell}
              title="Sin alertas"
              message={
                soloNoLeidas
                  ? 'No hay alertas pendientes de lectura.'
                  : 'Todavía no se generaron alertas.'
              }
            />
          ) : (
            <ul className="space-y-3" aria-label="Lista de alertas">
              {data.data.map((a) => {
                const sev = SEV[a.severidad] ?? SEV.MEDIA;
                const t = TIPOS[a.tipo] ?? { label: a.tipo, icon: Bell };
                const IconT = t.icon;
                return (
                  <li
                    key={a.id}
                    data-alerta-id={a.id}
                    className={`flex items-start gap-3 rounded-2xl bg-white p-4 ring-1 ring-grafito/10 ${
                      a.leida ? 'opacity-60' : ''
                    }`}
                  >
                    <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${sev.dot}`} aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${sev.chip}`}>
                          {sev.label}
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-full bg-root/10 px-2 py-0.5 text-xs font-semibold text-root">
                          <IconT size={12} strokeWidth={1.5} />
                          {t.label}
                        </span>
                        {a.sku && (
                          <span className="font-mono text-xs text-warmgray">{a.sku}</span>
                        )}
                        {a.orden_codigo && (
                          <span className="font-mono text-xs text-info">{a.orden_codigo}</span>
                        )}
                        <span className="ml-auto text-xs text-warmgray">
                          {fechaCorta(a.fecha_creacion)}
                        </span>
                      </div>
                      <p className="mt-1.5 text-sm text-grafito">{a.mensaje}</p>
                    </div>
                    {!a.leida && (
                      <div className="flex shrink-0 flex-col items-stretch gap-1.5">
                        {COMPRABLES.has(a.tipo) && (
                          <button
                            onClick={() => setComprando(a)}
                            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-root px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-root-dark"
                            aria-label={`Comprar para la alerta ${a.id}`}
                          >
                            <ShoppingCart size={13} strokeWidth={2} />
                            Comprar
                          </button>
                        )}
                        <button
                          onClick={() => marcar(a.id)}
                          disabled={marcandoId === a.id}
                          className="rounded-lg border border-grafito/15 px-3 py-1.5 text-xs font-semibold text-root transition hover:bg-root/10 disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label={`Marcar leída la alerta ${a.id}`}
                        >
                          Marcar leída
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </main>
      </div>
      <Toasts toasts={toasts} />
      {comprando && (
        <ComprarModal
          alerta={comprando}
          onClose={() => setComprando(null)}
          onPedido={(orden) => pedidoHecho(comprando, orden)}
        />
      )}
    </div>
  );
}

function Stat({ icon: Icon, label, valor, cls = 'text-grafito' }) {
  return (
    <div className="rounded-2xl bg-white p-5 ring-1 ring-grafito/10">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-warmgray">
        <Icon size={14} strokeWidth={1.5} />
        {label}
      </div>
      <div className={`mt-2 text-2xl font-bold ${cls}`}>{valor}</div>
    </div>
  );
}
