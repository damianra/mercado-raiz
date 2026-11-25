import { useEffect, useRef, useState } from 'react';
import { Bell, LogOut, Menu, PackageX, TriangleAlert } from 'lucide-react';
import { formatMoney } from '../data/orders.js';
import { getAlertas } from '../lib/api.js';
import { navigate } from '../lib/router.jsx';

const ROL_LABEL = {
  ADMIN: 'Administración',
  GERENTE: 'Gerencia',
  APROBADOR: 'Aprobación',
  SERVICIO: 'Servicio',
  BUYER: 'Compras',
};

const iniciales = (nombre = '') =>
  nombre
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('') || '?';

// SPEC-30 (T30.6): la campanita es el canal de alertas ALTA para
// GERENTE/APROBADOR — poll cada 60s, sin entrar a /alertas.
const POLL_MS = 60_000;
const MAX_ALERTAS_CAMPANA = 6;
// Mismo set que el GET /api/alertas — SERVICIO no pollea un 403.
const ROLES_LEEN_ALERTAS = ['BUYER', 'ADMIN', 'GERENTE', 'APROBADOR'];
// QUIEBRE → /quiebres (stock ≤ 0 siempre está en la tabla);
// RIESGO_LEAD puede tener stock ≥ mínimo → va a /metricas
// (la tabla de riesgo cobertura < lead).
// T32.4/T32.8: las alertas de pricing (incl. DEAD_STOCK) deep-
// linkean a /metricas?ajustar=<producto_id> — la página abre el
// modal "Ajustar precio" directo; el producto puede no estar
// listado ni en /quiebres ni en la tabla de outliers (review #67).
const TIPOS_AJUSTE = new Set([
  'PRESION_COMPETITIVA',
  'PRECIO_FUERA_MERCADO',
  'OPORTUNIDAD_MARGEN',
  'DEAD_STOCK',
]);
const destinoAlerta = (a) => {
  if (a.tipo === 'QUIEBRE') return '/quiebres';
  if (TIPOS_AJUSTE.has(a.tipo) && a.producto_id) {
    return `/metricas?ajustar=${a.producto_id}`;
  }
  return '/metricas';
};

export default function Topbar({
  urgentes = 0,
  alertas = [],
  onMenu,
  onSelectOrden,
  usuario,
  // SPEC-29: título/subtítulo por props — la vista /alertas del
  // BUYER no habla de órdenes.
  titulo = 'Órdenes Pendientes de Aprobación',
  subtitulo = 'Revisá y aprobá las órdenes de compra sugeridas por la IA',
  // La campana lista órdenes urgentes — en vistas sin órdenes
  // (p.ej. /alertas del BUYER) quedaría diciendo "sin
  // notificaciones" sobre una página llena de alertas: se oculta.
  sinNotificaciones = false,
  onLogout,
}) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);
  const [altas, setAltas] = useState([]);

  // La campanita se auto-abastece: alertas ALTA no leídas cada
  // POLL_MS. El GET /api/alertas está habilitado para los roles
  // operativos (BUYER lo oculta con sinNotificaciones — su página
  // entera ES el panel de alertas).
  useEffect(() => {
    if (sinNotificaciones || !ROLES_LEEN_ALERTAS.includes(usuario?.rol)) {
      return undefined;
    }
    let vivo = true;
    const cargar = () =>
      getAlertas({ leida: 0 })
        .then((r) => {
          if (vivo) {
            setAltas(r.data.filter((a) => a.severidad === 'ALTA'));
          }
        })
        .catch(() => {}); // el badge nunca rompe la página
    cargar();
    const t = setInterval(cargar, POLL_MS);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [sinNotificaciones, usuario?.rol]);

  // Una OC urgente y su alerta QUIEBRE son el mismo stock-out —
  // la OC (accionable) gana y la alerta no duplica el badge.
  const altasVisibles = altas.filter(
    (a) => !alertas.some((o) => o.producto === a.producto),
  );
  const badge = urgentes + altasVisibles.length;

  useEffect(() => {
    if (!open) return;
    const onPointer = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <header className="sticky top-0 z-30 border-b border-grafito/10 bg-white/85 backdrop-blur">
      <div className="flex h-14 items-center gap-4 px-4 sm:px-6">
        <button
          onClick={onMenu}
          className="rounded-lg p-2 text-grafito hover:bg-cream md:hidden"
          aria-label="Abrir menú"
        >
          <Menu size={20} strokeWidth={1.5} />
        </button>
        <div>
          <h1 className="font-sans tracking-tight text-lg font-bold text-grafito sm:text-xl">
            {titulo}
          </h1>
          <p className="hidden text-sm text-warmgray sm:block">
            {subtitulo}
          </p>
        </div>

        <div className="ml-auto flex items-center gap-4">
          {!sinNotificaciones && (
          <div className="relative" ref={panelRef}>
            <button
              onClick={() => setOpen((o) => !o)}
              className="relative rounded-lg p-2 text-grafito transition-colors hover:bg-cream"
              aria-label={`Notificaciones${badge ? `, ${badge} pendientes` : ''}`}
              aria-expanded={open}
              aria-haspopup="true"
            >
              <Bell size={20} strokeWidth={1.5} />
              {badge > 0 && (
                <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-terra px-1 font-mono text-[10px] font-bold text-white">
                  {badge}
                </span>
              )}
            </button>

            {open && (
              <div
                className="absolute right-0 top-12 w-80 rounded-lg bg-white p-2 shadow-lift ring-1 ring-grafito/10 animate-fade-up"
                role="menu"
                aria-label="Notificaciones"
              >
                <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-warmgray">
                  Notificaciones
                </p>
                {altasVisibles.length === 0 && alertas.length === 0 ? (
                  <p className="px-3 pb-4 pt-2 text-center text-sm text-warmgray">
                    Sin notificaciones — no hay alertas ni órdenes urgentes.
                  </p>
                ) : (
                  <div className="max-h-80 overflow-y-auto">
                    {altasVisibles.length > 0 && (
                      <>
                        <p className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-terra">
                          Alertas de stock
                        </p>
                        <ul>
                          {altasVisibles.slice(0, MAX_ALERTAS_CAMPANA).map((a) => (
                            <li key={`alerta-${a.id}`}>
                              <button
                                role="menuitem"
                                onClick={() => {
                                  setOpen(false);
                                  navigate(destinoAlerta(a));
                                }}
                                className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-cream"
                              >
                                <PackageX
                                  size={16}
                                  strokeWidth={1.5}
                                  className="mt-0.5 shrink-0 text-terra"
                                />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm font-semibold text-grafito">
                                    {a.producto ?? 'Producto'}
                                  </span>
                                  {a.sku && (
                                    <span className="block font-mono text-xs text-info">
                                      {a.sku}
                                    </span>
                                  )}
                                  <span className="block text-xs text-warmgray">
                                    {a.mensaje}
                                  </span>
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                        {altasVisibles.length > MAX_ALERTAS_CAMPANA && (
                          <button
                            onClick={() => {
                              setOpen(false);
                              navigate('/quiebres');
                            }}
                            className="w-full rounded-lg px-3 pb-2 pt-1 text-center text-xs font-semibold text-info transition-colors hover:bg-cream"
                          >
                            +{altasVisibles.length - MAX_ALERTAS_CAMPANA} alertas
                            más — ver quiebres
                          </button>
                        )}
                      </>
                    )}
                    {alertas.length > 0 && (
                      <>
                        <p className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-warmgray">
                          Órdenes urgentes
                        </p>
                        <ul>
                          {alertas.map((o) => (
                            <li key={o.id}>
                              <button
                                role="menuitem"
                                onClick={() => {
                                  setOpen(false);
                                  onSelectOrden?.(o);
                                }}
                                className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-cream"
                              >
                                <TriangleAlert
                                  size={16}
                                  strokeWidth={1.5}
                                  className="mt-0.5 shrink-0 text-terra"
                                />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm font-semibold text-grafito">
                                    {o.producto}
                                  </span>
                                  <span className="block font-mono text-xs text-info">
                                    {o.id}
                                  </span>
                                  <span className="block text-xs text-warmgray">
                                    Stock agotado — requiere aprobación
                                  </span>
                                </span>
                                <span className="tabular shrink-0 font-mono text-xs font-bold text-root">
                                  {formatMoney(o.monto)}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          )}
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-root text-xs font-bold text-white ring-2 ring-white shadow-soft">
              {iniciales(usuario?.nombre)}
            </span>
            <div className="hidden sm:block">
              <p className="text-sm font-semibold text-grafito">
                {usuario?.nombre ?? '—'}
              </p>
              <p className="text-xs text-warmgray">
                {ROL_LABEL[usuario?.rol] ?? usuario?.rol ?? '—'}
              </p>
            </div>
            <button
              onClick={onLogout}
              className="rounded-lg p-2 text-grafito transition-colors hover:bg-cream"
              aria-label="Cerrar sesión"
              title="Cerrar sesión"
            >
              <LogOut size={18} strokeWidth={1.5} />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
