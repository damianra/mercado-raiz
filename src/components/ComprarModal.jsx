import { useEffect, useState } from 'react';
import { X, LoaderCircle, ShoppingCart, Truck, BadgeDollarSign } from 'lucide-react';
import { getSugerenciaPedido, solicitarPedido } from '../lib/api.js';
import { formatMoney } from '../data/orders.js';

// SPEC-29 (T29.3): modal "Comprar" desde una alerta de falta de
// stock. Lista los proveedores activos del artículo con su costo
// y lead; el más barato queda preseleccionado y la cantidad viene
// pre-cargada con la sugerencia del flujo automático para el lead
// elegido (recalcula al cambiar de proveedor). Confirma → POST
// /api/pedidos (stub: valida + loguea, 202).
export default function ComprarModal({ alerta, onClose, onPedido }) {
  const [data, setData] = useState(null);
  const [errorCarga, setErrorCarga] = useState(null);
  const [provSel, setProvSel] = useState(null);
  const [cantidad, setCantidad] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState(null);

  const cargar = () => {
    setErrorCarga(null);
    getSugerenciaPedido(alerta.producto_id)
      .then((res) => {
        setData(res);
        const barato = res.precios[0]; // ordenadas por costo ASC
        if (barato) {
          setProvSel(barato.proveedor_id);
          setCantidad(String(barato.cantidad_sugerida));
        }
      })
      .catch(setErrorCarga);
  };

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    setData(null);
    setErrorEnvio(null);
    setEnviando(false);
    cargar();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alerta.id]);

  const sel = data?.precios.find((p) => p.proveedor_id === provSel) ?? null;
  const cant = Number(cantidad);
  const valido = !!sel && Number.isInteger(cant) && cant > 0;
  const total = valido ? cant * sel.costo_unitario : null;

  const elegir = (p) => {
    setProvSel(p.proveedor_id);
    // la sugerencia depende del lead del proveedor elegido — viene
    // pre-calculada por el backend con la math del automático
    setCantidad(String(p.cantidad_sugerida));
  };

  const submit = async () => {
    if (!valido || enviando) return;
    setEnviando(true);
    setErrorEnvio(null);
    try {
      const res = await solicitarPedido({
        productoId: alerta.producto_id,
        proveedorId: sel.proveedor_id,
        cantidad: cant,
        alertaId: alerta.id,
      });
      onPedido(res.data);
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
      aria-label="Solicitar pedido"
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-cream p-6 shadow-lift animate-fade-up sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="flex items-center gap-2 font-display text-2xl font-bold text-grafito">
              <ShoppingCart size={22} className="text-root" strokeWidth={1.5} />
              Solicitar pedido
            </h2>
            <p className="mt-1 text-sm text-warmgray">
              Elegí proveedor y cantidad — queda registrado para procesamiento
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
              No se pudo cargar la sugerencia: {errorCarga.message}
            </p>
            <button
              onClick={cargar}
              className="mt-3 rounded-lg bg-root px-4 py-2 text-sm font-semibold text-white transition hover:bg-root-dark"
            >
              Reintentar
            </button>
          </div>
        ) : !data ? (
          <div className="mt-6 space-y-3" aria-busy="true" aria-label="Cargando sugerencia">
            <div className="skeleton h-16 rounded-lg" />
            <div className="skeleton h-11 rounded-lg" />
            <div className="skeleton h-11 rounded-lg" />
            <div className="skeleton h-12 rounded-lg" />
          </div>
        ) : (
          <form
            className="mt-6 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div className="rounded-lg bg-white p-4 ring-1 ring-root/10">
              <p className="text-sm font-semibold text-grafito">{data.producto.nombre}</p>
              <p className="mt-0.5 font-mono text-xs text-warmgray">
                {data.producto.sku} · stock {data.producto.stock_actual}/
                {data.producto.stock_minimo}
                {data.demanda_diaria > 0 &&
                  ` · demanda ${data.demanda_diaria.toFixed(1)} u/día`}
              </p>
            </div>

            {data.precios.length === 0 ? (
              <p className="rounded-lg bg-white p-4 text-center text-sm text-warmgray ring-1 ring-root/10">
                Este producto no tiene proveedores con precio activo — cargá
                uno antes de solicitar el pedido.
              </p>
            ) : (
              <>
                <fieldset>
                  <legend className="text-xs font-semibold uppercase tracking-wide text-warmgray">
                    Proveedor
                  </legend>
                  <div className="mt-2 space-y-2">
                    {data.precios.map((p, i) => (
                      <label
                        key={p.proveedor_id}
                        className={`flex cursor-pointer items-center gap-3 rounded-lg bg-white p-3 ring-1 transition ${
                          provSel === p.proveedor_id
                            ? 'ring-2 ring-root'
                            : 'ring-root/10 hover:ring-root/30'
                        }`}
                      >
                        <input
                          type="radio"
                          name="proveedor"
                          checked={provSel === p.proveedor_id}
                          onChange={() => elegir(p)}
                          className="h-4 w-4 accent-root"
                        />
                        <Truck size={16} className="shrink-0 text-warmgray" strokeWidth={1.5} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2 text-sm font-semibold text-grafito">
                            {p.proveedor}
                            {i === 0 && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-root/10 px-2 py-0.5 text-[11px] font-semibold text-root">
                                <BadgeDollarSign size={11} strokeWidth={2} />
                                Más barato
                              </span>
                            )}
                          </span>
                          <span className="block text-xs text-warmgray">
                            {formatMoney(p.costo_unitario)}/u · lead {p.lead_efectivo}d
                            {p.es_principal === 1 ? ' · principal' : ''}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <div>
                  <label
                    htmlFor="pedido-cantidad"
                    className="text-xs font-semibold uppercase tracking-wide text-warmgray"
                  >
                    Cantidad
                  </label>
                  <input
                    id="pedido-cantidad"
                    type="number"
                    min="1"
                    step="1"
                    value={cantidad}
                    onChange={(e) => setCantidad(e.target.value)}
                    className="mt-1 h-11 w-full rounded-lg border border-root/15 bg-white px-3 text-sm text-grafito outline-none focus:border-root focus:ring-2 focus:ring-root/20"
                  />
                  {sel && (
                    <p className="mt-1 text-xs text-warmgray">
                      Sugerencia del automático para este proveedor: {sel.cantidad_sugerida}u
                    </p>
                  )}
                </div>

                {total != null && (
                  <div className="flex items-center justify-between rounded-lg bg-white p-4 ring-1 ring-root/10">
                    <span className="text-sm text-warmgray">Total estimado</span>
                    <span className="font-mono text-lg font-bold text-grafito">
                      {formatMoney(total)}
                    </span>
                  </div>
                )}
              </>
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
                {enviando ? 'Enviando…' : 'Solicitar pedido'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
