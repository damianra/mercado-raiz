import {
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
const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'ordenes', label: 'Órdenes', icon: ClipboardCheck },
  // SPEC-27 T27.4: quiebres y margen en riesgo — operativo, todos los roles.
  { id: 'quiebres', label: 'Quiebres', icon: TriangleAlert, to: '/quiebres' },
  // SPEC-28 T28.2: scorecard de métricas retail — operativo, todos
  // los roles (fill rate, riesgo, inventario, proveedores).
  { id: 'metricas', label: 'Métricas', icon: ChartColumn, to: '/metricas' },
  // SPEC-24: gestión de usuarios — solo visible para ADMIN; `to`
  // navega a otra página, los demás son anchors de la home.
  { id: 'usuarios', label: 'Usuarios', icon: Users, to: '/usuarios', roles: ['ADMIN'] },
  // SPEC-26 T26.4: gestión de proveedores — solo ADMIN (mismo guard
  // que Usuarios; el backend devuelve 403 al resto).
  { id: 'proveedores', label: 'Proveedores', icon: Truck, to: '/proveedores', roles: ['ADMIN'] },
];

export default function Sidebar({ urgentes = 0, open, onClose, usuario, activeId = 'ordenes', base = '' }) {
  const items = NAV.filter((item) => !item.roles || item.roles.includes(usuario?.rol));
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
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-terra/90">
            <Leaf size={20} className="text-cream" strokeWidth={1.5} />
          </span>
          <div>
            <p className="font-display text-lg font-bold leading-tight text-white">
              MERCADO RAÍZ
            </p>
            <p className="text-[11px] font-medium tracking-wide text-root-light">
              Sistema de Aprovisionamiento
            </p>
          </div>
        </div>

        {/* Menú */}
        <nav className="mt-8 flex flex-col gap-1">
          {items.map(({ id, label, icon: Icon, to }) => {
            const active = id === activeId;
            const cls = `relative flex h-12 items-center gap-3 rounded-lg px-4 text-sm font-medium transition-colors duration-200 ease-brand ${
              active
                ? 'bg-root-light/40 text-white before:absolute before:left-0 before:top-1/2 before:h-8 before:w-1 before:-translate-y-1/2 before:rounded-r before:bg-ocre'
                : 'text-white/70 hover:bg-white/10 hover:text-white'
            }`;
            const inner = (
              <>
                <Icon size={18} strokeWidth={1.5} />
                {label}
                {id === 'ordenes' && urgentes > 0 && (
                  <span className="ml-auto rounded-full bg-terra px-2 py-0.5 font-mono text-xs font-bold text-white">
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
        <div className="mt-auto rounded-lg bg-white/5 p-4">
          <p className="font-display text-sm italic text-ocre">
            "Del campo a tu mesa, con inteligencia"
          </p>
          <p className="mt-1 text-[11px] text-white/50">Desde 1952</p>
        </div>
      </aside>
    </>
  );
}
