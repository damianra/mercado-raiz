import { useEffect, useState } from 'react';
import { X, LoaderCircle, ChartLine, PackageX } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { getHistorialProducto } from '../lib/api.js';

// SPEC-32 (T32.6): sierra de stock — la posición diaria del
// producto reconstruida desde historial_stock (mismo replay que
// dias_en_quiebre, server/models/stock-serie.js). Drill-in desde
// /quiebres. `serie: null` → fuente no confiable → estado vacío
// honesto (R26.7), nunca un chart inventado.
//
// Paleta: área en root (acento), mínimo punteado en neutro,
// quiebres (posición ≤ 0, T30.2 admite negativos) marcados terra —
// dots sobre la curva + flag en el tooltip.
const ROOT = '#2D5F3F';
const TERRA = '#C8553D';
const NEUTRO = '#78716C';
const GRID = '#E7E5E4';

const fmtFecha = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

// Día en quiebre → dot terra sobre la curva (los demás no pintan).
function PuntoQuiebre({ cx, cy, payload }) {
  if (cx == null || payload.stock > 0) return null;
  return <circle cx={cx} cy={cy} r={3.5} fill={TERRA} stroke="#fff" strokeWidth={1.5} />;
}

function TooltipStock({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const stock = payload.find((p) => p.dataKey === 'stock')?.value;
  return (
    <div className="rounded-lg bg-white px-3 py-2 text-xs shadow-lift ring-1 ring-grafito/10">
      <p className="font-semibold text-grafito">{label}</p>
      <p className="mt-0.5 text-warmgray">
        Stock: <span className="font-semibold text-grafito">{stock} u</span>
      </p>
      {stock != null && stock <= 0 && (
        <p className="mt-0.5 font-semibold text-terra">Quiebre de stock</p>
      )}
    </div>
  );
}

export default function HistorialStockModal({ producto, onClose, dias = 90 }) {
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState(null);
  const [data, setData] = useState(null);

  useEffect(() => {
    let vivo = true;
    getHistorialProducto(producto.id, dias)
      .then((r) => vivo && setData(r))
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

  // La serie llega [{fecha, stock}]; el mínimo se agrega como línea
  // constante para comparar cada día contra el umbral de reposición.
  const puntos = data?.serie?.map((d) => ({ ...d, minimo: data.stock_minimo }));

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-grafito/50 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Historial de stock"
    >
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-lift ring-1 ring-grafito/10 animate-fade-up sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="flex items-center gap-2 font-sans tracking-tight text-2xl font-bold text-grafito">
              <ChartLine size={22} className="text-root" strokeWidth={1.5} />
              Historial de stock
            </h2>
            <p className="mt-1 text-sm text-warmgray">
              {data?.nombre ?? producto.nombre}{' '}
              <span className="text-grafito/40">·</span>{' '}
              {data?.sku ?? producto.sku}{' '}
              <span className="text-grafito/40">·</span> posición al cierre de
              cada día, últimos {dias} días
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
            Reconstruyendo la sierra de stock…
          </div>
        )}

        {errorCarga && (
          <p className="mt-6 rounded-xl bg-terra/10 px-4 py-3 text-sm text-terra">
            {errorCarga}
          </p>
        )}

        {!cargando && data && puntos == null && (
          <div className="mt-6 flex flex-col items-center gap-2 rounded-2xl bg-stone-100 px-6 py-10 text-center">
            <PackageX size={28} className="text-warmgray" strokeWidth={1.5} />
            <p className="text-sm font-semibold text-grafito">
              Sin movimientos de stock registrados
            </p>
            <p className="max-w-sm text-xs text-warmgray">
              Este producto no tiene historial en la ventana — la posición no
              puede reconstruirse.
            </p>
          </div>
        )}

        {!cargando && puntos && (
          <>
            <div
              className="mt-5 h-72 w-full"
              role="img"
              aria-label="Gráfico de posición de stock por día"
            >
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={puntos}
                  margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                >
                  <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="fecha"
                    tickFormatter={fmtFecha}
                    tick={{ fontSize: 11, fill: NEUTRO }}
                    tickLine={false}
                    axisLine={{ stroke: GRID }}
                    minTickGap={28}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: NEUTRO }}
                    tickLine={false}
                    axisLine={false}
                    width={40}
                  />
                  <Tooltip content={<TooltipStock />} />
                  <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                  <Area
                    type="stepAfter"
                    dataKey="stock"
                    name="Stock"
                    stroke={ROOT}
                    strokeWidth={2}
                    fill={ROOT}
                    fillOpacity={0.14}
                    dot={(p) => <PuntoQuiebre key={p.payload?.fecha} {...p} />}
                    activeDot={{ r: 4 }}
                    isAnimationActive={false}
                  />
                  <Line
                    type="stepAfter"
                    dataKey="minimo"
                    name="Mínimo"
                    stroke={NEUTRO}
                    strokeDasharray="6 4"
                    strokeWidth={1.5}
                    dot={false}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-3 text-xs text-warmgray">
              Reconstruida desde los movimientos de stock — los puntos terra
              marcan días en quiebre (posición ≤ 0).
            </p>
          </>
        )}
      </div>
    </div>
  );
}
