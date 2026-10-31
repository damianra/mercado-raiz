import {
  LayoutDashboard,
  ClipboardCheck,
  Leaf,
  X,
} from 'lucide-react';

// Solo entradas con destino real en la página — un ítem sin sección
// detrás es un control muerto (regla UI n°2) y no debe renderizarse.
const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'ordenes', label: 'Órdenes', icon: ClipboardCheck, active: true },
];

export default function Sidebar({ urgentes = 0, open, onClose }) {
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
          {NAV.map(({ id, label, icon: Icon, active }) => (
            <a
              key={id}
              href={`#${id}`}
              onClick={onClose}
              className={`relative flex h-12 items-center gap-3 rounded-lg px-4 text-sm font-medium transition-colors duration-200 ease-brand ${
                active
                  ? 'bg-root-light/40 text-white before:absolute before:left-0 before:top-1/2 before:h-8 before:w-1 before:-translate-y-1/2 before:rounded-r before:bg-ocre'
                  : 'text-white/70 hover:bg-white/10 hover:text-white'
              }`}
              aria-current={active ? 'page' : undefined}
            >
              <Icon size={18} strokeWidth={1.5} />
              {label}
              {id === 'ordenes' && urgentes > 0 && (
                <span className="ml-auto rounded-full bg-terra px-2 py-0.5 font-mono text-xs font-bold text-white">
                  {urgentes}
                </span>
              )}
            </a>
          ))}
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
