import { useEffect, useState } from 'react';
import { X, LoaderCircle, ShoppingBag } from 'lucide-react';
import { registrarVenta } from '../lib/api.js';

// SPEC-30 (T30.2): registrar una venta manual desde /quiebres —
// descuenta stock + deja el movimiento VENTA en el historial (la
// integración POS real usa el mismo POST /api/ventas).
const CANALES = [
  { id: 'POS', label: 'Local (POS)' },
  { id: 'WEB', label: 'Web' },
  { id: 'MAYOR', label: 'Mayorista' },
];

export default function VentaModal({ producto, onClose, onHecho }) {
  const [unidades, setUnidades] = useState('');
  const [canal, setCanal] = useState('POS');
  const [enviando, setEnviando] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState(null);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const n = Number(unidades);
  const valido = Number.isInteger(n) && n >= 1 && n <= 100_000;
  const resultante = valido ? producto.stock_actual - n : null;

  const submit = async () => {
    if (!valido || enviando) return;
    setEnviando(true);
    setErrorEnvio(null);
    try {
      const res = await registrarVenta({
        productoId: producto.id,
        unidades: n,
        canal,
      });
      onHecho(res.data);
    } catch (e) {
      setErrorEnvio(e.message);
      setEnviando(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-grafito/50 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Registrar venta"
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-cream p-6 shadow-lift animate-fade-up sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="flex items-center gap-2 font-display text-2xl font-bold text-grafito">
              <ShoppingBag size={22} className="text-root" strokeWidth={1.5} />
              Registrar venta
            </h2>
            <p className="mt-1 text-sm text-warmgray">
              Descuenta el stock y deja el movimiento en el historial
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-warmgray transition hover:bg-grafito/5 hover:text-grafito"
            aria-label="Cerrar formulario"
          >
            <X size={20} strokeWidth={1.5} />
          </button>
        </div>

        <form
          className="mt-6 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="rounded-lg bg-white p-4 ring-1 ring-root/10">
            <p className="text-sm font-semibold text-grafito">{producto.nombre}</p>
            <p className="mt-0.5 font-mono text-xs text-warmgray">
              {producto.sku} · stock {producto.stock_actual}/{producto.stock_minimo}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="venta-unidades"
                className="text-xs font-semibold uppercase tracking-wide text-warmgray"
              >
                Unidades
              </label>
              <input
                id="venta-unidades"
                type="number"
                min="1"
                max="100000"
                step="1"
                value={unidades}
                onChange={(e) => setUnidades(e.target.value)}
                className="mt-1 h-11 w-full rounded-lg border border-root/15 bg-white px-3 text-sm text-grafito outline-none focus:border-root focus:ring-2 focus:ring-root/20"
              />
            </div>
            <div>
              <label
                htmlFor="venta-canal"
                className="text-xs font-semibold uppercase tracking-wide text-warmgray"
              >
                Canal
              </label>
              <select
                id="venta-canal"
                value={canal}
                onChange={(e) => setCanal(e.target.value)}
                className="mt-1 h-11 w-full rounded-lg border border-root/15 bg-white px-3 text-sm text-grafito outline-none focus:border-root focus:ring-2 focus:ring-root/20"
              >
                {CANALES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {resultante != null && (
            <div className="rounded-lg bg-white p-4 ring-1 ring-root/10">
              <div className="flex items-center justify-between">
                <span className="text-sm text-warmgray">Stock resultante</span>
                <span
                  className={`font-mono text-lg font-bold ${
                    resultante <= 0 ? 'text-red-700' : 'text-grafito'
                  }`}
                >
                  {producto.stock_actual} → {resultante}
                </span>
              </div>
              {resultante < 0 && (
                <p className="mt-2 text-xs text-terra">
                  El stock quedaría negativo — la venta se registra igual
                  (es un hecho físico); corregí la divergencia con un
                  conteo en "Ajustar stock".
                </p>
              )}
            </div>
          )}

          {errorEnvio && (
            <p className="rounded-lg bg-white p-3 text-center text-sm text-terra ring-1 ring-terra/30">
              {errorEnvio}
            </p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="h-12 flex-1 rounded-lg border border-root/20 text-sm font-semibold text-root transition hover:bg-root/10"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!valido || enviando}
              className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-lg bg-root text-sm font-semibold text-white transition hover:bg-root-dark disabled:cursor-not-allowed disabled:opacity-40"
            >
              {enviando && <LoaderCircle size={16} className="animate-spin" />}
              {enviando ? 'Guardando…' : 'Registrar venta'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
