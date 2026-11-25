import { useEffect, useState } from 'react';
import { X, LoaderCircle, ClipboardList } from 'lucide-react';
import { ajustarStock } from '../lib/api.js';

// SPEC-30 (T30.2): ajuste manual de stock desde /quiebres —
// conteo físico de góndola/depósito (cantidad absoluta) o merma/
// rotura (diferencia ±). El motivo es obligatorio y queda
// estructurado en historial_stock.
const MOTIVOS = [
  { id: 'CONTEO', label: 'Conteo físico', ayuda: 'unidades contadas en el local' },
  { id: 'MERMA', label: 'Merma', ayuda: 'vencido, feo, sin venta' },
  { id: 'ROTURA', label: 'Rotura', ayuda: 'dañado o roto' },
  { id: 'OTRO', label: 'Otro', ayuda: 'corrección con nota' },
];

export default function AjusteStockModal({ producto, onClose, onHecho }) {
  const [motivo, setMotivo] = useState('CONTEO');
  const [valor, setValor] = useState('');
  const [nota, setNota] = useState('');
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

  const esConteo = motivo === 'CONTEO';
  const n = Number(valor);
  const valido = esConteo
    ? Number.isInteger(n) && n >= 0
    : Number.isInteger(n) && n !== 0;
  const resultante = valido ? (esConteo ? n : producto.stock_actual + n) : null;

  const submit = async () => {
    if (!valido || enviando) return;
    setEnviando(true);
    setErrorEnvio(null);
    try {
      const res = await ajustarStock({
        productoId: producto.id,
        motivo,
        ...(esConteo ? { cantidadNueva: n } : { delta: n }),
        referencia: nota || undefined,
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
      aria-label="Ajustar stock"
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-cream p-6 shadow-lift animate-fade-up sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="flex items-center gap-2 font-sans tracking-tight text-2xl font-bold text-grafito">
              <ClipboardList size={22} className="text-root" strokeWidth={1.5} />
              Ajustar stock
            </h2>
            <p className="mt-1 text-sm text-warmgray">
              Conteo físico de góndola/depósito o merma — queda en el
              historial de movimientos
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
          <div className="rounded-lg bg-white p-4 ring-1 ring-grafito/10">
            <p className="text-sm font-semibold text-grafito">{producto.nombre}</p>
            <p className="mt-0.5 font-mono text-xs text-warmgray">
              {producto.sku} · stock {producto.stock_actual}/{producto.stock_minimo}
            </p>
          </div>

          <fieldset>
            <legend className="text-xs font-semibold uppercase tracking-wide text-warmgray">
              Motivo
            </legend>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {MOTIVOS.map((m) => (
                <label
                  key={m.id}
                  className={`flex cursor-pointer flex-col rounded-lg bg-white p-3 ring-1 transition ${
                    motivo === m.id ? 'ring-2 ring-root' : 'ring-grafito/10 hover:ring-grafito/30'
                  }`}
                >
                  <span className="flex items-center gap-2 text-sm font-semibold text-grafito">
                    <input
                      type="radio"
                      name="motivo"
                      checked={motivo === m.id}
                      onChange={() => {
                        setMotivo(m.id);
                        setValor('');
                      }}
                      className="h-3.5 w-3.5 accent-root"
                    />
                    {m.label}
                  </span>
                  <span className="mt-0.5 pl-5 text-xs text-warmgray">{m.ayuda}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label
              htmlFor="ajuste-valor"
              className="text-xs font-semibold uppercase tracking-wide text-warmgray"
            >
              {esConteo ? 'Unidades contadas' : 'Diferencia (± unidades)'}
            </label>
            <input
              id="ajuste-valor"
              type="number"
              step="1"
              min={esConteo ? '0' : undefined}
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              placeholder={esConteo ? 'ej: 37' : 'ej: -2'}
              className="mt-1 h-11 w-full rounded-lg border border-grafito/15 bg-white px-3 text-sm text-grafito outline-none focus:border-root focus:ring-2 focus:ring-grafito/15"
            />
            <p className="mt-1 text-xs text-warmgray">
              {esConteo
                ? 'El stock pasa a valer exactamente lo contado'
                : 'Negativo descuenta (merma/rotura), positivo suma'}
            </p>
          </div>

          <div>
            <label
              htmlFor="ajuste-nota"
              className="text-xs font-semibold uppercase tracking-wide text-warmgray"
            >
              Nota (opcional)
            </label>
            <input
              id="ajuste-nota"
              type="text"
              maxLength={120}
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="ej: conteo semanal góndola 4"
              className="mt-1 h-11 w-full rounded-lg border border-grafito/15 bg-white px-3 text-sm text-grafito outline-none focus:border-root focus:ring-2 focus:ring-grafito/15"
            />
          </div>

          {resultante != null && (
            <div className="flex items-center justify-between rounded-lg bg-white p-4 ring-1 ring-grafito/10">
              <span className="text-sm text-warmgray">Stock resultante</span>
              <span
                className={`font-mono text-lg font-bold ${
                  resultante <= 0 ? 'text-red-700' : 'text-grafito'
                }`}
              >
                {producto.stock_actual} → {resultante}
              </span>
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
              className="h-12 flex-1 rounded-lg border border-grafito/15 text-sm font-semibold text-root transition hover:bg-root/10"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!valido || enviando}
              className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-lg bg-root text-sm font-semibold text-white transition hover:bg-root-dark disabled:cursor-not-allowed disabled:opacity-40"
            >
              {enviando && <LoaderCircle size={16} className="animate-spin" />}
              {enviando ? 'Guardando…' : 'Registrar ajuste'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
