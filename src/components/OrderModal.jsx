import { useEffect, useState } from 'react';
import { X, Package, Sparkles, Check, LoaderCircle, Truck, Send, PackageCheck } from 'lucide-react';
import { formatMoney } from '../data/orders.js';

export default function OrderModal({ orden, procesando, onClose, onAprobar, onRechazar, onEnviar, onRecibir }) {
  const [recibida, setRecibida] = useState('');

  useEffect(() => {
    setRecibida(orden ? String(orden.cantidad) : '');
  }, [orden]);

  useEffect(() => {
    if (!orden) return;
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [orden, onClose]);

  if (!orden) return null;
  const pendiente = orden.estado === 'PENDIENTE_APROBACION';
  const aprobada = orden.estado === 'APROBADO' || orden.estado === 'APROBADO_AUTO';
  const enviada = orden.estado === 'ENVIADA';
  const cantRecibir = parseInt(recibida, 10);
  const recibirValida =
    Number.isInteger(cantRecibir) && cantRecibir >= 1 && cantRecibir <= orden.cantidad;

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-grafito/50 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Detalle de orden ${orden.id}`}
    >
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-cream p-6 shadow-lift animate-fade-up sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Encabezado */}
        <div className="flex items-start justify-between">
          <div>
            <p className="font-mono text-sm text-info">{orden.id}</p>
            <h2 className="mt-1 flex items-center gap-2 font-display text-2xl font-bold text-grafito">
              <Package size={22} className="text-root" strokeWidth={1.5} />
              {orden.producto}
            </h2>
            <p className="mt-1 text-sm text-warmgray">
              SKU: <span className="font-mono">{orden.sku}</span> · Proveedor:{' '}
              {orden.proveedor}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-warmgray transition hover:bg-grafito/5 hover:text-grafito"
            aria-label="Cerrar detalle"
          >
            <X size={20} strokeWidth={1.5} />
          </button>
        </div>

        {/* Métricas de stock */}
        <div className="mt-6 grid grid-cols-3 gap-3">
          {[
            { label: 'Stock actual', value: orden.stockActual },
            { label: 'Mínimo', value: orden.stockMinimo },
            { label: 'A ordenar', value: orden.cantidad, accent: true },
          ].map(({ label, value, accent }) => (
            <div key={label} className="rounded-lg bg-white p-4 shadow-soft ring-1 ring-root/10">
              <p className="text-xs font-semibold uppercase tracking-wide text-warmgray">
                {label}
              </p>
              <p
                className={`tabular mt-1 font-display text-2xl font-bold ${
                  accent ? 'text-terra' : 'text-root'
                }`}
              >
                {value}
                <span className="ml-1 font-sans text-xs font-normal text-warmgray">uds</span>
              </p>
            </div>
          ))}
        </div>

        {/* Cálculo financiero */}
        <h3 className="mt-6 font-display text-lg font-semibold text-grafito">
          Cálculo financiero
        </h3>
        <div className="mt-2 rounded-lg bg-white p-4 shadow-soft ring-1 ring-root/10">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-warmgray">Costo unitario</dt>
              <dd className="tabular font-mono text-grafito">
                {formatMoney(orden.precioUnitario)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-warmgray">Cantidad</dt>
              <dd className="tabular font-mono text-grafito">{orden.cantidad}</dd>
            </div>
            <div className="flex justify-between border-t border-dashed border-root/15 pt-2">
              <dt className="font-semibold text-grafito">Total</dt>
              <dd className="tabular font-mono text-lg font-bold text-root">
                {formatMoney(orden.monto)}
              </dd>
            </div>
          </dl>
        </div>

        {/* Análisis IA */}
        <h3 className="mt-6 flex items-center gap-2 font-display text-lg font-semibold text-grafito">
          <Sparkles size={17} className="text-success" strokeWidth={1.5} />
          Análisis de IA
        </h3>
        <div className="mt-2 rounded-lg border-l-4 border-success bg-[#E8F5E9] p-4">
          <p className="text-sm leading-relaxed text-grafito">{orden.analisisIA}</p>
          {orden.entregaDias != null && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-warmgray">
              <Truck size={13} /> Entrega estimada del proveedor: {orden.entregaDias}{' '}
              {orden.entregaDias === 1 ? 'día' : 'días'}
            </p>
          )}
        </div>

        {/* Acciones — por estado (SPEC-30 T30.1): pendiente →
            aprobar/rechazar, aprobada → enviar, enviada → recibir. */}
        {pendiente && (
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button
              onClick={() => onRechazar(orden)}
              disabled={procesando}
              className="h-12 flex-1 rounded-lg border-2 border-terra text-sm font-semibold text-terra transition duration-200 ease-brand hover:-translate-y-0.5 hover:bg-terra/5 disabled:opacity-40"
            >
              Rechazar
            </button>
            <button
              onClick={() => onAprobar(orden)}
              disabled={procesando}
              className="flex h-12 flex-1 items-center justify-center gap-2 rounded-lg bg-root text-sm font-semibold text-white transition duration-200 ease-brand hover:-translate-y-0.5 hover:bg-root-dark hover:shadow-lift disabled:opacity-40"
            >
              {procesando ? (
                <>
                  <LoaderCircle size={16} className="animate-spin" /> Aprobando…
                </>
              ) : (
                <>
                  <Check size={16} strokeWidth={2.5} /> Aprobar orden
                </>
              )}
            </button>
          </div>
        )}
        {aprobada && (
          <div className="mt-6">
            <p className="mb-3 rounded-lg bg-white p-3 text-center text-sm text-warmgray ring-1 ring-root/10">
              Orden aprobada — el siguiente paso es enviarla al proveedor.
            </p>
            <button
              onClick={() => onEnviar(orden)}
              disabled={procesando}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-root text-sm font-semibold text-white transition duration-200 ease-brand hover:-translate-y-0.5 hover:bg-root-dark hover:shadow-lift disabled:opacity-40"
            >
              {procesando ? (
                <>
                  <LoaderCircle size={16} className="animate-spin" /> Enviando…
                </>
              ) : (
                <>
                  <Send size={16} strokeWidth={2.5} /> Enviar al proveedor
                </>
              )}
            </button>
          </div>
        )}
        {enviada && (
          <div className="mt-6">
            <p className="mb-3 rounded-lg bg-white p-3 text-center text-sm text-warmgray ring-1 ring-root/10">
              Orden enviada al proveedor — cuando llega el camión registrá la recepción.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <label className="flex h-12 flex-1 items-center gap-2 rounded-lg bg-white px-3 ring-1 ring-root/20 focus-within:ring-2 focus-within:ring-root">
                <span className="whitespace-nowrap text-xs font-semibold text-warmgray">
                  Unidades recibidas
                </span>
                <input
                  type="number"
                  min="1"
                  max={orden.cantidad}
                  value={recibida}
                  onChange={(e) => setRecibida(e.target.value)}
                  disabled={procesando}
                  aria-label="Cantidad recibida"
                  className="w-full bg-transparent text-right text-sm font-semibold text-grafito outline-none"
                />
                <span className="text-xs text-warmgray">/ {orden.cantidad}</span>
              </label>
              <button
                onClick={() => onRecibir(orden, cantRecibir)}
                disabled={procesando || !recibirValida}
                className="flex h-12 flex-1 items-center justify-center gap-2 rounded-lg bg-root text-sm font-semibold text-white transition duration-200 ease-brand hover:-translate-y-0.5 hover:bg-root-dark hover:shadow-lift disabled:opacity-40"
              >
                {procesando ? (
                  <>
                    <LoaderCircle size={16} className="animate-spin" /> Recibiendo…
                  </>
                ) : (
                  <>
                    <PackageCheck size={16} strokeWidth={2.5} /> Registrar recepción
                  </>
                )}
              </button>
            </div>
            {recibirValida && cantRecibir < orden.cantidad && (
              <p className="mt-2 text-xs text-warmgray">
                Recepción parcial — faltan {orden.cantidad - cantRecibir} unidades del pedido.
              </p>
            )}
          </div>
        )}
        {!pendiente && !aprobada && !enviada && (
          <p className="mt-6 rounded-lg bg-white p-3 text-center text-sm text-warmgray ring-1 ring-root/10">
            {orden.estado === 'RECIBIDA' && orden.cantidadRecibida != null
              ? `Orden recibida — ingresaron ${orden.cantidadRecibida} de ${orden.cantidad} unidades al stock.`
              : 'Esta orden ya fue procesada.'}
          </p>
        )}
      </div>
    </div>
  );
}
