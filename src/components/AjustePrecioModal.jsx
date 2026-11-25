import { useEffect, useState } from 'react';
import { X, LoaderCircle, Tag, TrendingDown } from 'lucide-react';
import { actualizarPrecio, getCompetenciaProducto } from '../lib/api.js';
import { formatMoney } from '../data/orders.js';
import EscaleraPrecios from './EscaleraPrecios.jsx';

// SPEC-32 (T32.2): ajuste de precio con contexto de mercado —
// escalera con la posición propia vs las 4 cadenas, sugeridos por
// zona y piso de costo. Vender bajo el costo exige confirmación
// explícita (salvataje, R32.2/R32.3).
const MOTIVOS = [
  { id: 'AJUSTE_MERCADO', label: 'Ajuste de mercado' },
  { id: 'PROMO', label: 'Promoción' },
  { id: 'LIQUIDACION', label: 'Liquidación' },
  { id: 'OTRO', label: 'Otro' },
];

// Zona del precio propuesto vs costo y rango de mercado → texto y
// color de la pista bajo el input.
function zonaPropuesta(p, { costo, min, max }) {
  if (p == null || !Number.isFinite(p) || p <= 0) return null;
  if (costo != null && p < costo) {
    return { texto: 'Salvataje — por debajo del costo', cls: 'text-terra' };
  }
  if (min != null && p <= min) return { texto: 'El más barato del mercado', cls: 'text-root' };
  if (max != null && p <= max) return { texto: 'Dentro del rango de mercado', cls: 'text-grafito' };
  if (max != null && p > max) return { texto: 'Por encima del máximo del mercado', cls: 'text-ocre' };
  return { texto: 'Sin datos de mercado', cls: 'text-warmgray' };
}

export default function AjustePrecioModal({ producto, motivoInicial = 'AJUSTE_MERCADO', onClose, onHecho }) {
  const [comp, setComp] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState(null);
  const [valor, setValor] = useState('');
  // SPEC-33 (T33.4): "Liquidar" desde /vencimientos entra con
  // motivoInicial=LIQUIDACION — el select sigue editable.
  const [motivo, setMotivo] = useState(motivoInicial);
  const [confirmarSalvataje, setConfirmarSalvataje] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState(null);

  useEffect(() => {
    let vivo = true;
    getCompetenciaProducto(producto.id)
      .then((r) => vivo && setComp(r))
      .catch((e) => vivo && setErrorCarga(e.message))
      .finally(() => vivo && setCargando(false));
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      vivo = false;
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [producto.id]);

  const n = valor === '' ? null : Number(valor);
  // el precio vigente lo dice la competencia fresca, no la prop de la fila
  const vigente = comp?.precio_venta ?? producto.precio_venta;
  const valido = n != null && Number.isFinite(n) && n > 0 && n !== vigente;
  const costo = comp?.costo_unitario ?? null;
  const bajoCosto = valido && costo != null && n < costo;
  const zona = comp ? zonaPropuesta(n, { costo, min: comp.min_mercado, max: comp.max_mercado }) : null;
  const recupera =
    valido && comp?.stock_actual > 0 && costo != null
      ? { recuperado: n * comp.stock_actual, inmovilizado: costo * comp.stock_actual }
      : null;

  const sugeridos =
    comp && comp.min_mercado != null
      ? [
          { label: 'Mínimo del mercado', v: comp.min_mercado },
          {
            label: 'Punto medio',
            v: Math.round(((comp.min_mercado + comp.max_mercado) / 2) * 100) / 100,
          },
          ...(costo != null ? [{ label: 'Al costo', v: costo }] : []),
        ]
      : [];

  const submit = async () => {
    if (!valido || enviando || (bajoCosto && !confirmarSalvataje)) return;
    setEnviando(true);
    setErrorEnvio(null);
    try {
      const res = await actualizarPrecio({
        productoId: producto.id,
        precio: n,
        motivo,
        confirmarBajoCosto: bajoCosto && confirmarSalvataje,
      });
      onHecho(res);
    } catch (e) {
      // Backstop del server: si el 409 llega igual, pasamos a modo
      // confirmación en vez de mostrar un error muerto.
      if (e.status === 409 && e.body?.requiere_confirmacion) {
        // El costo pudo cambiar desde el GET: hidratar para que el
        // checkbox de salvataje renderice (si no, resubmit → mismo 409).
        setComp((c) => ({ ...c, costo_unitario: e.body.costo_unitario }));
        setConfirmarSalvataje(false);
        setErrorEnvio(null);
      } else {
        setErrorEnvio(e.message);
      }
      setEnviando(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-grafito/50 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Ajustar precio"
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-lift ring-1 ring-grafito/10 animate-fade-up sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="flex items-center gap-2 font-sans tracking-tight text-2xl font-bold text-grafito">
              <Tag size={22} className="text-root" strokeWidth={1.5} />
              Ajustar precio
            </h2>
            <p className="mt-1 text-sm text-warmgray">
              {producto.nombre} <span className="text-grafito/40">·</span> {producto.sku}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-lg p-1.5 text-warmgray transition hover:bg-grafito/5 hover:text-grafito"
          >
            <X size={20} strokeWidth={1.5} />
          </button>
        </div>

        {cargando && (
          <div className="mt-8 flex items-center justify-center gap-2 py-10 text-sm text-warmgray">
            <LoaderCircle size={18} className="animate-spin" strokeWidth={1.5} />
            Cargando precios de mercado…
          </div>
        )}
        {errorCarga && (
          <p className="mt-6 rounded-xl bg-terra/10 px-4 py-3 text-sm text-terra">
            {errorCarga}
          </p>
        )}

        {comp && !cargando && (
          <div className="mt-5 space-y-5">
            <div className="rounded-xl bg-stone-100 p-4">
              <div className="mb-1 flex items-center justify-between text-xs text-warmgray">
                <span className="font-semibold uppercase tracking-wide">Mercado</span>
                {comp.fecha_snapshot && <span>precios al {comp.fecha_snapshot}</span>}
              </div>
              <EscaleraPrecios
                propio={comp.precio_venta}
                propuesto={valido ? n : null}
                min={comp.min_mercado}
                max={comp.max_mercado}
                costo={costo}
                cadenas={comp.cadenas}
              />
              {comp.cadenas.some((c) => c.en_promo) && (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-ocre">
                  <TrendingDown size={13} strokeWidth={1.5} />
                  {comp.cadenas.filter((c) => c.en_promo).map((c) => ({
                    DIA: 'Día', COTO: 'Coto', CARREFOUR: 'Carrefour', LA_ANONIMA: 'La Anónima',
                  })[c.cadena]).join(', ')}{' '}
                  en promo
                </p>
              )}
            </div>

            {sugeridos.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {sugeridos.map((s) => (
                  <button
                    key={s.label}
                    onClick={() => setValor(String(s.v))}
                    className="rounded-full bg-stone-100 px-3 py-1.5 text-xs font-medium text-grafito transition hover:bg-root/10 hover:text-root"
                  >
                    {s.label} · {formatMoney(s.v)}
                  </button>
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-warmgray">
                  Nuevo precio
                </span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={valor}
                  onChange={(e) => setValor(e.target.value)}
                  placeholder={formatMoney(comp.precio_venta)}
                  className="w-full rounded-lg border border-grafito/20 bg-white px-3 py-2 text-sm text-grafito outline-none transition focus:border-root focus:ring-2 focus:ring-root/20"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-warmgray">
                  Motivo
                </span>
                <select
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  className="w-full rounded-lg border border-grafito/20 bg-white px-3 py-2 text-sm text-grafito outline-none transition focus:border-root focus:ring-2 focus:ring-root/20"
                >
                  {MOTIVOS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {zona && (
              <p className={`text-xs font-medium ${zona.cls}`}>{zona.texto}</p>
            )}
            {recupera && (
              <p className="text-xs text-warmgray">
                Si vendés el stock: recuperás{' '}
                <span className="font-semibold text-grafito">
                  {formatMoney(recupera.recuperado)}
                </span>{' '}
                de {formatMoney(recupera.inmovilizado)} inmovilizados
                {n > costo
                  ? ` (margen ${formatMoney((n - costo) * comp.stock_actual)})`
                  : ''}
              </p>
            )}

            {bajoCosto && (
              <label className="flex items-start gap-2 rounded-xl bg-terra/10 px-4 py-3 text-sm text-terra">
                <input
                  type="checkbox"
                  checked={confirmarSalvataje}
                  onChange={(e) => setConfirmarSalvataje(e.target.checked)}
                  className="mt-0.5 accent-terra"
                />
                Precio por debajo del costo ({formatMoney(costo)}) — confirmo
                vender a pérdida
              </label>
            )}
            {errorEnvio && (
              <p className="rounded-xl bg-terra/10 px-4 py-3 text-sm text-terra">{errorEnvio}</p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={onClose}
                className="rounded-lg px-4 py-2 text-sm font-medium text-warmgray transition hover:bg-grafito/5"
              >
                Cancelar
              </button>
              <button
                onClick={submit}
                disabled={!valido || enviando || (bajoCosto && !confirmarSalvataje)}
                className="flex items-center gap-2 rounded-lg bg-root px-5 py-2 text-sm font-semibold text-white transition hover:bg-root/90 disabled:opacity-40"
              >
                {enviando && <LoaderCircle size={15} className="animate-spin" strokeWidth={2} />}
                Guardar precio
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
