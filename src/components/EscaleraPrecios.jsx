import { formatMoney } from '../data/orders.js';

const NOMBRE_CADENA = {
  DIA: 'Día',
  COTO: 'Coto',
  CARREFOUR: 'Carrefour',
  LA_ANONIMA: 'La Anónima',
};

// Escalera de precios (SPEC-32/T32.2): banda del mercado [min,max]
// con un punto por cadena, el marcador propio y el piso de costo —
// "dónde estás parado" en una mirada, sin leer números. Los puntos
// con promo activa (precio < lista) llevan ring ocre.
export default function EscaleraPrecios({ propio, propuesto, min, max, costo, cadenas = [] }) {
  const valores = [propio, propuesto, min, max, costo, ...cadenas.map((c) => c.precio)]
    .filter((v) => v != null);
  if (valores.length === 0) return null;

  // Dominio con aire a ambos lados para que los extremos respiren.
  const lo = Math.min(...valores) * 0.94;
  const hi = Math.max(...valores) * 1.06;
  const x = (v) => `${((v - lo) / (hi - lo)) * 100}%`;

  return (
    <div aria-label="Posición de precio en el mercado">
      <div className="relative h-16">
        {/* banda del rango de mercado */}
        {min != null && max != null && (
          <div
            className="absolute top-1/2 h-7 -translate-y-1/2 rounded-full bg-root/10 ring-1 ring-root/20"
            style={{ left: x(min), width: `calc(${x(max)} - ${x(min)})` }}
          />
        )}
        {/* línea base */}
        <div className="absolute top-1/2 h-px w-full -translate-y-1/2 bg-grafito/15" />
        {/* piso de costo */}
        {costo != null && (
          <div
            className="absolute top-2 bottom-2 w-px border-l-2 border-dashed border-terra"
            style={{ left: x(costo) }}
          >
            <span className="absolute -top-1 left-1 whitespace-nowrap text-[10px] font-semibold uppercase tracking-wide text-terra">
              costo {formatMoney(costo)}
            </span>
          </div>
        )}
        {/* puntos por cadena */}
        {cadenas
          .filter((c) => c.precio != null)
          .map((c) => (
            <div
              key={c.cadena}
              className="group absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
              style={{ left: x(c.precio) }}
            >
              <div
                className={`size-2.5 rounded-full bg-grafito ${
                  c.en_promo ? 'ring-2 ring-ocre' : ''
                }`}
              />
              <span className="pointer-events-none absolute -top-7 left-1/2 z-10 hidden -translate-x-1/2 rounded-md bg-grafito px-2 py-1 text-[10px] whitespace-nowrap text-white group-hover:block">
                {NOMBRE_CADENA[c.cadena] ?? c.cadena} {formatMoney(c.precio)}
                {c.en_promo ? ' · promo' : ''}
              </span>
            </div>
          ))}
        {/* precio propuesto — marcador hueco */}
        {propuesto != null && (
          <div
            className="absolute top-1/2 z-10 -translate-x-1/2 -translate-y-1/2"
            style={{ left: x(propuesto) }}
          >
            <div className="size-4 rounded-full border-2 border-ocre bg-white shadow-sm" />
            <span className="absolute top-4 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-semibold text-ocre">
              nuevo {formatMoney(propuesto)}
            </span>
          </div>
        )}
        {/* precio propio */}
        {propio != null && (
          <div
            className="absolute top-1/2 z-10 -translate-x-1/2 -translate-y-1/2"
            style={{ left: x(propio) }}
          >
            <div className="size-3.5 rounded-full bg-root shadow-sm ring-2 ring-white" />
            <span className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-semibold text-root">
              hoy {formatMoney(propio)}
            </span>
          </div>
        )}
      </div>
      <div className="flex justify-between text-[10px] text-warmgray">
        {min != null && <span>mín {formatMoney(min)}</span>}
        <span className="flex-1" />
        {max != null && <span>máx {formatMoney(max)}</span>}
      </div>
    </div>
  );
}
