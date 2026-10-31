import { useEffect, useRef, useState } from 'react';
import { Bell, Menu, TriangleAlert } from 'lucide-react';
import { formatMoney } from '../data/orders.js';

export default function Topbar({ urgentes = 0, alertas = [], onMenu, onSelectOrden }) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);

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
    <header className="sticky top-0 z-30 border-b border-root/10 bg-cream/90 backdrop-blur">
      <div className="flex h-16 items-center gap-4 px-4 sm:px-8">
        <button
          onClick={onMenu}
          className="rounded-lg p-2 text-grafito hover:bg-root/10 md:hidden"
          aria-label="Abrir menú"
        >
          <Menu size={20} strokeWidth={1.5} />
        </button>
        <div>
          <h1 className="font-display text-xl font-bold tracking-tight text-grafito sm:text-2xl">
            Órdenes Pendientes de Aprobación
          </h1>
          <p className="hidden text-sm text-warmgray sm:block">
            Revisá y aprobá las órdenes de compra sugeridas por la IA
          </p>
        </div>

        <div className="ml-auto flex items-center gap-4">
          <div className="relative" ref={panelRef}>
            <button
              onClick={() => setOpen((o) => !o)}
              className="relative rounded-lg p-2 text-grafito transition-colors hover:bg-root/10"
              aria-label={`Notificaciones${urgentes ? `, ${urgentes} urgentes` : ''}`}
              aria-expanded={open}
              aria-haspopup="true"
            >
              <Bell size={20} strokeWidth={1.5} />
              {urgentes > 0 && (
                <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-terra px-1 font-mono text-[10px] font-bold text-white">
                  {urgentes}
                </span>
              )}
            </button>

            {open && (
              <div
                className="absolute right-0 top-12 w-80 rounded-lg bg-white p-2 shadow-lift ring-1 ring-root/10 animate-fade-up"
                role="menu"
                aria-label="Notificaciones de órdenes urgentes"
              >
                <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-warmgray">
                  Notificaciones
                </p>
                {alertas.length === 0 ? (
                  <p className="px-3 pb-4 pt-2 text-center text-sm text-warmgray">
                    Sin notificaciones — no hay órdenes urgentes pendientes.
                  </p>
                ) : (
                  <ul className="max-h-72 overflow-y-auto">
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
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-root text-sm font-bold text-white">
              CM
            </span>
            <div className="hidden sm:block">
              <p className="text-sm font-semibold text-grafito">Carlos M.</p>
              <p className="text-xs text-warmgray">Compras</p>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
