import { useEffect, useState } from 'react';
import { X, LoaderCircle, PackagePlus, Truck } from 'lucide-react';
import { crearOrden, getProductos, mapOrden } from '../lib/api.js';
import { formatMoney } from '../data/orders.js';

// Modal de creación — POST /api/ordenes. El producto define precio y
// proveedor server-side; el checkbox fuerza aprobación manual (si no,
// el backend auto-aprueba por debajo del umbral de monto).
export default function NewOrderModal({ open, onClose, onCreated }) {
  const [productos, setProductos] = useState(null);
  const [errorCarga, setErrorCarga] = useState(null);
  const [productoId, setProductoId] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [forzarAprobacion, setForzarAprobacion] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    setProductoId('');
    setCantidad('');
    setForzarAprobacion(false);
    setErrorEnvio(null);
    setEnviando(false);
    if (!productos) {
      setErrorCarga(null);
      getProductos()
        .then((res) => setProductos(res.data))
        .catch((e) => setErrorCarga(e));
    }
  }, [open, productos]);

  if (!open) return null;

  const prod = productos?.find((p) => p.id === Number(productoId)) ?? null;
  const cant = Number(cantidad);
  const valido = !!prod && Number.isInteger(cant) && cant > 0;
  const montoEstimado = valido ? cant * prod.precio_unitario : null;

  const submit = async () => {
    if (!valido || enviando) return;
    setEnviando(true);
    setErrorEnvio(null);
    try {
      const res = await crearOrden({
        productoId: prod.id,
        cantidad: cant,
        requiereAprobacion: forzarAprobacion || undefined,
      });
      onCreated(mapOrden(res.data));
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
      aria-label="Nueva orden de compra"
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-cream p-6 shadow-lift animate-fade-up sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="flex items-center gap-2 font-display text-2xl font-bold text-grafito">
              <PackagePlus size={22} className="text-root" strokeWidth={1.5} />
              Nueva orden de compra
            </h2>
            <p className="mt-1 text-sm text-warmgray">
              Creá una orden manual para un producto del catálogo
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

        {errorCarga ? (
          <div className="mt-6 rounded-lg bg-white p-4 text-center ring-1 ring-terra/30">
            <p className="text-sm text-terra">
              No se pudo cargar el catálogo: {errorCarga.message}
            </p>
            <button
              onClick={() => {
                setErrorCarga(null);
                setProductos(null);
              }}
              className="mt-3 rounded-lg bg-root px-4 py-2 text-sm font-semibold text-white transition hover:bg-root-dark"
            >
              Reintentar
            </button>
          </div>
        ) : !productos ? (
          <div className="mt-6 space-y-3" aria-busy="true" aria-label="Cargando catálogo">
            <div className="skeleton h-11 rounded-lg" />
            <div className="skeleton h-11 rounded-lg" />
            <div className="skeleton h-12 rounded-lg" />
          </div>
        ) : productos.length === 0 ? (
          <p className="mt-6 rounded-lg bg-white p-4 text-center text-sm text-warmgray ring-1 ring-root/10">
            No hay productos cargados en el catálogo.
          </p>
        ) : (
          <form
            className="mt-6 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div>
              <label
                htmlFor="nueva-producto"
                className="text-xs font-semibold uppercase tracking-wide text-warmgray"
              >
                Producto
              </label>
              <select
                id="nueva-producto"
                value={productoId}
                onChange={(e) => setProductoId(e.target.value)}
                className="mt-1 w-full rounded-lg bg-white px-3 py-2.5 text-sm text-grafito outline-none ring-1 ring-root/15 transition focus:ring-root/40"
              >
                <option value="">Seleccionar producto…</option>
                {productos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre} · {p.sku} — {p.proveedor?.nombre}
                  </option>
                ))}
              </select>
              {prod && (
                <p className="mt-1.5 flex items-center gap-1.5 text-xs text-warmgray">
                  <Truck size={12} />
                  {prod.proveedor?.nombre} · {formatMoney(prod.precio_unitario)} /
                  unidad · stock actual {prod.stock_actual}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="nueva-cantidad"
                className="text-xs font-semibold uppercase tracking-wide text-warmgray"
              >
                Cantidad
              </label>
              <input
                id="nueva-cantidad"
                type="number"
                min="1"
                step="1"
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
                placeholder="Unidades a ordenar"
                className="tabular mt-1 w-full rounded-lg bg-white px-3 py-2.5 text-sm text-grafito outline-none ring-1 ring-root/15 transition placeholder:text-warmgray focus:ring-root/40"
              />
            </div>

            <label className="flex items-start gap-2.5 rounded-lg bg-white p-3 ring-1 ring-root/10">
              <input
                type="checkbox"
                checked={forzarAprobacion}
                onChange={(e) => setForzarAprobacion(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-root"
              />
              <span className="text-sm text-grafito">
                Exigir aprobación manual
                <span className="block text-xs text-warmgray">
                  Si no, la orden se auto-aprueba cuando el monto queda bajo el
                  umbral configurado.
                </span>
              </span>
            </label>

            <div className="flex items-center justify-between rounded-lg bg-white p-3 ring-1 ring-root/10">
              <span className="text-sm font-semibold text-grafito">
                Monto estimado
              </span>
              <span className="tabular font-mono text-lg font-bold text-root">
                {montoEstimado != null ? formatMoney(montoEstimado) : '—'}
              </span>
            </div>

            {errorEnvio && (
              <p className="rounded-lg bg-terra/10 p-3 text-sm text-terra">
                {errorEnvio}
              </p>
            )}

            <button
              type="submit"
              disabled={!valido || enviando}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-terra text-sm font-semibold text-white transition duration-200 ease-brand hover:-translate-y-0.5 hover:bg-terra/90 hover:shadow-lift disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:shadow-none"
            >
              {enviando ? (
                <>
                  <LoaderCircle size={16} className="animate-spin" /> Creando…
                </>
              ) : (
                'Crear orden'
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
