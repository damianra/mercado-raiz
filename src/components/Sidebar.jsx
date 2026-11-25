import {
  Bell,
  CalendarClock,
  ChartColumn,
  TriangleAlert,
  LayoutDashboard,
  ClipboardCheck,
  Leaf,
  Truck,
  Users,
  X,
} from 'lucide-react';
import { Link } from '../lib/router.jsx';

// Solo entradas con destino real en la página — un ítem sin sección
// detrás es un control muerto (regla UI n°2) y no debe renderizarse.
// `roles` = whitelist; `excluye` = blacklist (el BUYER de SPEC-29
// solo ve su dashboard de alertas, nada más).
const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, excluye: ['BUYER'] },
  { id: 'ordenes', label: 'Órdenes', icon: ClipboardCheck, excluye: ['BUYER'] },
  // SPEC-27 T27.4: quiebres y margen en riesgo — operativo, todos los roles.
  { id: 'quiebres', label: 'Quiebres', icon: TriangleAlert, to: '/quiebres', excluye: ['BUYER'] },
  // SPEC-33 T33.4: cola de lotes por vencer/vencidos — lectura para
  // todo no-BUYER; la baja y la liquidación son GERENTE/ADMIN.
  { id: 'vencimientos', label: 'Vencimientos', icon: CalendarClock, to: '/vencimientos', excluye: ['BUYER'] },
  // SPEC-28 T28.2: scorecard de métricas retail — operativo, todos
  // los roles (fill rate, riesgo, inventario, proveedores).
  { id: 'metricas', label: 'Métricas', icon: ChartColumn, to: '/metricas', excluye: ['BUYER'] },
  // SPEC-29: el dashboard de alertas es EXCLUSIVO del BUYER — el
  // resto de los roles ni siquiera lo ve en el menú.
  { id: 'alertas', label: 'Alertas', icon: Bell, to: '/alertas', roles: ['BUYER'] },
  // SPEC-24: gestión de usuarios — solo visible para ADMIN; `to`
  // navega a otra página, los demás son anchors de la home.
  { id: 'usuarios', label: 'Usuarios', icon: Users, to: '/usuarios', roles: ['ADMIN'] },
  // SPEC-26 T26.4: gestión de proveedores — solo ADMIN (mismo guard
  // que Usuarios; el backend devuelve 403 al resto).
  { id: 'proveedores', label: 'Proveedores', icon: Truck, to: '/proveedores', roles: ['ADMIN'] },
];

export default function Sidebar({ urgentes = 0, open, onClose, usuario, activeId = 'ordenes', base = '' }) {
  const items = NAV.filter(
    (item) =>
      (!item.roles || item.roles.includes(usuario?.rol)) &&
      !item.excluye?.includes(usuario?.rol),
  );
  return (
    <>
      {/* Overlay mobile */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-grafito/50 backdrop-blur-sm md:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-60 flex-col bg-root px-4 py-6 transition-transform duration-200 ease-brand md:static md:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-label="Navegación principal"
      >
        <button
          onClick={onClose}
          className="absolute right-3 top-3 rounded-lg p-1.5 text-white/70 hover:bg-white/10 md:hidden"
          aria-label="Cerrar menú"
        >
          <X size={18} />
        </button>

        {/* Logo */}
        <div className="flex items-center gap-3 px-2">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-white/10 ring-1 ring-white/15">
            <Leaf size={18} className="text-white" strokeWidth={1.5} />
          </span>
          <div>
            <p className="font-sans tracking-tight text-base font-bold leading-tight text-white">
              MERCADO RAÍZ
            </p>
            <p className="text-[11px] font-medium tracking-wide text-white/50">
              Sistema de Aprovisionamiento
            </p>
          </div>
        </div>

        {/* Menú */}
        <nav className="mt-7 flex flex-col gap-0.5">
          {items.map(({ id, label, icon: Icon, to }) => {
            const active = id === activeId;
            const cls = `relative flex h-10 items-center gap-3 rounded-lg px-3.5 text-sm font-medium transition-colors duration-200 ease-brand ${
              active
                ? 'bg-white/10 text-white before:absolute before:left-0 before:top-1/2 before:h-6 before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-white'
                : 'text-white/60 hover:bg-white/5 hover:text-white'
            }`;
            const inner = (
              <>
                <Icon size={18} strokeWidth={1.5} />
                {label}
                {id === 'ordenes' && urgentes > 0 && (
                  <span className="ml-auto rounded-full bg-terra px-1.5 py-px font-mono text-[11px] font-bold leading-4 text-white">
                    {urgentes}
                  </span>
                )}
              </>
            );
            return to ? (
              <Link
                key={id}
                to={to}
                onClick={onClose}
                className={cls}
                aria-current={active ? 'page' : undefined}
              >
                {inner}
              </Link>
            ) : (
              <a
                key={id}
                href={`${base}#${id}`}
                onClick={onClose}
                className={cls}
                aria-current={active ? 'page' : undefined}
              >
                {inner}
              </a>
            );
          })}
        </nav>

        {/* Footer de marca */}
        <div className="mt-auto rounded-lg bg-white/5 p-3.5 ring-1 ring-white/10">
          <p className="text-xs font-medium italic text-white/80">
            "Del campo a tu mesa, con inteligencia"
          </p>
          <p className="mt-1 text-[11px] text-white/40">Desde 1952</p>
        </div>
      </aside>
    </>
  );
}
