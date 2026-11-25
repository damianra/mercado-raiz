// SPEC-32 (T32.3): wrappers de recharts con la paleta del sistema —
// neutros + root/terra como únicos acentos (R32.6). Todos los charts
// de Métricas salen de acá para no repetir config.
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatMoney } from '../../data/orders.js';

export const COLOR = {
  root: '#2D5F3F',
  rootLight: '#7BA88E',
  terra: '#C8553D',
  ocre: '#B45309',
  grafito: '#1C1917',
  warmgray: '#78716C',
  grid: '#E7E5E4',
};

const tick = { fontSize: 11, fill: '#78716C' };

const tooltipStyle = {
  contentStyle: {
    background: '#fff',
    border: '1px solid #E7E5E4',
    borderRadius: 12,
    fontSize: 12,
    boxShadow: '0 4px 12px rgb(28 25 23 / 0.08)',
  },
};

// Facturación por día — área suave con el acento de marca.
export function VentasDiariasChart({ serie }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={serie} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
        <defs>
          <linearGradient id="varea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={COLOR.root} stopOpacity={0.25} />
            <stop offset="100%" stopColor={COLOR.root} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={COLOR.grid} vertical={false} />
        <XAxis
          dataKey="fecha"
          tick={tick}
          tickLine={false}
          axisLine={false}
          minTickGap={40}
          tickFormatter={(f) => f.slice(5)} // MM-DD
        />
        <YAxis
          tick={tick}
          tickLine={false}
          axisLine={false}
          width={70}
          tickFormatter={(v) => `$${Math.round(v / 1000)}k`}
        />
        <Tooltip
          {...tooltipStyle}
          formatter={(v, name) =>
            name === 'facturacion' ? [formatMoney(v), 'Facturación'] : [v, 'Unidades']
          }
          labelFormatter={(f) => `Día ${f}`}
        />
        <Area
          type="monotone"
          dataKey="facturacion"
          stroke={COLOR.root}
          strokeWidth={2}
          fill="url(#varea)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// % del catálogo donde somos más baratos (o iguales) que cada cadena.
export function CompetitividadChart({ porCadena }) {
  const NOMBRE = { DIA: 'Día', COTO: 'Coto', CARREFOUR: 'Carrefour', LA_ANONIMA: 'La Anónima' };
  const data = porCadena.map((c) => ({
    cadena: NOMBRE[c.cadena] ?? c.cadena,
    pct: c.mas_barato_pct,
  }));
  return (
    <ResponsiveContainer width="100%" height={170}>
      <BarChart data={data} margin={{ top: 4, right: 24, bottom: 0, left: 8 }}>
        <CartesianGrid stroke={COLOR.grid} vertical={false} />
        <XAxis dataKey="cadena" tick={tick} tickLine={false} axisLine={false} />
        <YAxis
          tick={tick}
          tickLine={false}
          axisLine={false}
          domain={[0, 100]}
          tickFormatter={(v) => `${v}%`}
          width={44}
        />
        <Tooltip
          {...tooltipStyle}
          formatter={(v) => [`${v}%`, 'Catálogo más barato']}
        />
        <Bar dataKey="pct" radius={[8, 8, 0, 0]} maxBarSize={56}>
          {data.map((d) => (
            <Cell key={d.cadena} fill={d.pct >= 50 ? COLOR.root : COLOR.ocre} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// Pareto de capital inmovilizado — top SKUs muertos por stock×costo.
// El array ya viene ordenado desc por capital; en layout vertical
// recharts dibuja el primer elemento arriba.
export function CapitalParetoChart({ top }) {
  const data = top;
  return (
    <ResponsiveContainer width="100%" height={Math.max(220, top.length * 26)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
        <CartesianGrid stroke={COLOR.grid} horizontal={false} />
        <XAxis
          type="number"
          tick={tick}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => `$${Math.round(v / 1000)}k`}
        />
        <YAxis
          type="category"
          dataKey="sku"
          tick={tick}
          tickLine={false}
          axisLine={false}
          width={72}
        />
        <Tooltip
          {...tooltipStyle}
          formatter={(v) => [formatMoney(v), 'Capital inmovilizado']}
          labelFormatter={(sku) => {
            const it = top.find((t) => t.sku === sku);
            return it ? it.nombre : sku;
          }}
        />
        <Bar dataKey="capital" fill={COLOR.terra} radius={[0, 6, 6, 0]} maxBarSize={16} />
      </BarChart>
    </ResponsiveContainer>
  );
}
