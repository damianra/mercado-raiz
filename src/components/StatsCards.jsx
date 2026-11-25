import {
  Clock,
  CheckCircle2,
  Banknote,
  Package,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';

export default function StatsCards({ stats }) {
  const cards = [
    {
      label: 'Pendientes',
      value: stats.pendientes,
      icon: Clock,
      iconColor: 'text-ocre',
      iconBg: 'bg-ocre/10',
      trend:
        stats.tendenciaPendientes == null
          ? { dir: 'up', text: 'Aprobar hoy' }
          : {
              dir: stats.tendenciaPendientes > 0 ? 'down' : 'up',
              text: `${stats.tendenciaPendientes > 0 ? '↑' : '↓'} ${Math.abs(
                stats.tendenciaPendientes,
              )} vs ayer`,
            },
    },
    {
      label: 'Aprobadas',
      value: stats.aprobadas,
      icon: CheckCircle2,
      iconColor: 'text-success',
      iconBg: 'bg-success/10',
      trend: { dir: 'up', text: 'Esta semana' },
    },
    {
      label: 'Valor total',
      value: stats.valorTotal,
      icon: Banknote,
      iconColor: 'text-root',
      iconBg: 'bg-root/10',
      trend: { dir: 'up', text: 'Este mes' },
    },
    {
      label: 'Stock bajo',
      value: stats.stockBajo,
      icon: Package,
      iconColor: 'text-terra',
      iconBg: 'bg-terra/10',
      trend: { dir: 'down', text: 'Productos en mínimo' },
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {cards.map(({ label, value, icon: Icon, iconColor, iconBg, trend }) => (
        <div
          key={label}
          className="rounded-xl bg-white p-5 shadow-soft ring-1 ring-grafito/10 transition-shadow duration-200 ease-brand hover:shadow-lift"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-warmgray">
              {label}
            </span>
            <span className={`grid h-8 w-8 place-items-center rounded-lg ${iconBg}`}>
              <Icon size={16} strokeWidth={1.75} className={iconColor} />
            </span>
          </div>
          <p className="tabular mt-2.5 font-sans tracking-tight text-3xl font-bold text-grafito">
            {value}
          </p>
          <p
            className={`mt-1 flex items-center gap-1 text-xs font-medium ${
              trend.dir === 'up' ? 'text-success' : 'text-terra'
            }`}
          >
            {trend.dir === 'up' ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
            {trend.text}
          </p>
        </div>
      ))}
    </div>
  );
}
