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
      trend: { dir: 'up', text: 'Esta semana' },
    },
    {
      label: 'Valor total',
      value: stats.valorTotal,
      icon: Banknote,
      iconColor: 'text-root',
      trend: { dir: 'up', text: 'Este mes' },
    },
    {
      label: 'Stock bajo',
      value: stats.stockBajo,
      icon: Package,
      iconColor: 'text-terra',
      trend: { dir: 'down', text: 'Productos en mínimo' },
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {cards.map(({ label, value, icon: Icon, iconColor, trend }) => (
        <div
          key={label}
          className="rounded-lg bg-white p-5 shadow-soft ring-1 ring-root/10 transition-all duration-200 ease-brand hover:shadow-lift sm:p-6"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-warmgray">
              {label}
            </span>
            <Icon size={20} strokeWidth={1.5} className={iconColor} />
          </div>
          <p className="tabular mt-2 font-display text-3xl font-bold text-root sm:text-4xl">
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
