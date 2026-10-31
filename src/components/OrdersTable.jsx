import { useMemo, useState } from 'react';
import {
  Search,
  Eye,
  Check,
  X,
  LoaderCircle,
  ChevronDown,
  Download,
  Plus,
  Inbox,
} from 'lucide-react';
import { ESTADOS, formatMoney } from '../data/orders.js';

const FILTROS = [
  { id: 'TODAS', label: 'Todas' },
  { id: 'PENDIENTE_APROBACION', label: 'Pendientes' },
  { id: 'APROBADO', label: 'Aprobadas' },
  { id: 'RECHAZADO', label: 'Rechazadas' },
];

function Badge({ estado }) {
  const e = ESTADOS[estado] ?? ESTADOS.PENDIENTE_APROBACION;
  return (
    <span
      className={`inline-flex items-center rounded-2xl px-3 py-1 text-xs font-bold ${e.classes}`}
    >
      {e.label}
    </span>
  );
}

function esAprobada(estado) {
  return estado === 'APROBADO_AUTO' || estado === 'APROBADO';
}

export default function OrdersTable({
  ordenes,
  procesando,
  onVer,
  onAprobar,
  onRechazar,
  onNueva,
}) {
  const [busqueda, setBusqueda] = useState('');
  const [filtro, setFiltro] = useState('TODAS');

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return ordenes.filter((o) => {
      const okFiltro =
        filtro === 'TODAS' ||
        (filtro === 'APROBADO' ? esAprobada(o.estado) : o.estado === filtro);
      const okBusqueda =
        !q ||
        [o.id, o.producto, o.sku, o.proveedor].some((f) =>
          f.toLowerCase().includes(q),
        );
      return okFiltro && okBusqueda;
    });
  }, [ordenes, busqueda, filtro]);

  // Exporta las filas visibles (respeta búsqueda + filtro) a CSV con
  // BOM para que Excel respete UTF-8.
  const exportarCsv = () => {
    const celda = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
    const filas = [
      ['ID', 'Producto', 'SKU', 'Proveedor', 'Cantidad', 'Monto', 'Estado', 'Fecha'],
      ...visibles.map((o) => [
        o.id,
        o.producto,
        o.sku,
        o.proveedor,
        o.cantidad,
        o.monto.toFixed(2),
        ESTADOS[o.estado]?.label ?? o.estado,
        o.fecha ?? '',
      ]),
    ];
    const blob = new Blob(['\uFEFF' + filas.map((f) => f.map(celda).join(',')).join('\r\n')], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ordenes-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section
      id="ordenes"
      className="scroll-mt-20 rounded-lg bg-white shadow-soft ring-1 ring-root/10"
      aria-label="Tabla de órdenes de compra"
    >
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-root/10 p-4">
        <div className="relative min-w-48 flex-1">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-warmgray"
          />
          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por producto, SKU o proveedor…"
            className="w-full rounded-lg bg-cream py-2 pl-9 pr-3 text-sm text-grafito outline-none ring-1 ring-transparent transition placeholder:text-warmgray focus:ring-root/40"
            aria-label="Buscar órdenes"
          />
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-cream p-1 ring-1 ring-root/10">
          {FILTROS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFiltro(f.id)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors duration-200 ${
                filtro === f.id
                  ? 'bg-root text-white shadow-sm'
                  : 'text-warmgray hover:text-grafito'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button
          onClick={exportarCsv}
          disabled={visibles.length === 0}
          className="hidden items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-root ring-1 ring-root/20 transition hover:bg-root/5 disabled:cursor-not-allowed disabled:opacity-40 sm:inline-flex"
        >
          <Download size={15} strokeWidth={1.5} /> Exportar
        </button>
        <button
          onClick={onNueva}
          className="inline-flex items-center gap-2 rounded-lg bg-terra px-4 py-2 text-sm font-semibold text-white transition duration-200 ease-brand hover:-translate-y-0.5 hover:bg-terra/90 hover:shadow-lift"
        >
          <Plus size={15} strokeWidth={2} /> Nueva
        </button>
      </div>

      {/* Tabla desktop */}
      {visibles.length === 0 ? (
        <div className="p-10 text-center">
          <Inbox size={28} className="mx-auto text-warmgray" />
          <p className="mt-3 font-semibold text-grafito">Sin resultados</p>
          <p className="mt-1 text-sm text-warmgray">
            No hay órdenes que coincidan con la búsqueda o el filtro aplicado.
          </p>
        </div>
      ) : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-root/10 text-xs font-semibold uppercase tracking-wide text-warmgray">
                  <th className="px-4 py-3">ID</th>
                  <th className="px-4 py-3">Producto</th>
                  <th className="px-4 py-3">Proveedor</th>
                  <th className="px-4 py-3 text-right">Cant.</th>
                  <th className="px-4 py-3 text-right">Monto</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((o) => (
                  <Fila
                    key={o.id}
                    orden={o}
                    procesando={procesando === o.id}
                    onVer={onVer}
                    onAprobar={onAprobar}
                    onRechazar={onRechazar}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Cards mobile */}
          <ul className="divide-y divide-root/5 md:hidden">
            {visibles.map((o) => (
              <li key={o.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-xs text-info">{o.id}</p>
                    <p className="mt-0.5 font-semibold text-grafito">{o.producto}</p>
                    <p className="text-xs text-warmgray">{o.proveedor}</p>
                  </div>
                  <Badge estado={o.estado} />
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <p className="tabular font-mono text-sm font-bold text-root">
                    {formatMoney(o.monto)}
                    <span className="ml-2 font-sans text-xs font-normal text-warmgray">
                      × {o.cantidad}
                    </span>
                  </p>
                  <Acciones
                    orden={o}
                    procesando={procesando === o.id}
                    onVer={onVer}
                    onAprobar={onAprobar}
                    onRechazar={onRechazar}
                  />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function Fila({ orden: o, procesando, onVer, onAprobar, onRechazar }) {
  return (
    <tr
      className={`group h-16 border-b border-root/5 transition-colors duration-150 hover:bg-cream ${
        o.removiendo ? 'animate-fade-out' : 'animate-fade-up'
      }`}
    >
      <td className="px-4 py-3 font-mono text-sm text-info">{o.id}</td>
      <td className="px-4 py-3">
        <p className="text-[15px] font-semibold text-grafito">{o.producto}</p>
        <p className="font-mono text-xs text-warmgray">{o.sku}</p>
      </td>
      <td className="px-4 py-3 text-sm text-grafito">{o.proveedor}</td>
      <td className="tabular px-4 py-3 text-right text-sm text-grafito">
        {o.cantidad}
      </td>
      <td className="tabular px-4 py-3 text-right font-mono text-[15px] font-bold text-root">
        {formatMoney(o.monto)}
      </td>
      <td className="px-4 py-3">
        <Badge estado={o.estado} />
      </td>
      <td className="px-4 py-3">
        <div className="flex justify-end">
          <Acciones
            orden={o}
            procesando={procesando}
            onVer={onVer}
            onAprobar={onAprobar}
            onRechazar={onRechazar}
          />
        </div>
      </td>
    </tr>
  );
}

function Acciones({ orden: o, procesando, onVer, onAprobar, onRechazar }) {
  const pendiente = o.estado === 'PENDIENTE_APROBACION';
  return (
    <div className="flex items-center gap-1 opacity-100 transition-opacity duration-150 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
      <button
        onClick={() => onVer(o)}
        className="rounded-lg p-2 text-info transition hover:bg-info/10"
        aria-label={`Ver detalle de ${o.id}`}
        title="Ver detalle"
      >
        <Eye size={18} strokeWidth={1.5} />
      </button>
      {pendiente && (
        <>
          <button
            onClick={() => onAprobar(o)}
            disabled={procesando}
            className="rounded-lg p-2 text-success transition hover:bg-success/10 disabled:opacity-40"
            aria-label={`Aprobar ${o.id}`}
            title="Aprobar"
          >
            {procesando ? (
              <LoaderCircle size={18} className="animate-spin" />
            ) : (
              <Check size={18} strokeWidth={2} />
            )}
          </button>
          <button
            onClick={() => onRechazar(o)}
            disabled={procesando}
            className="rounded-lg p-2 text-terra transition hover:bg-terra/10 disabled:opacity-40"
            aria-label={`Rechazar ${o.id}`}
            title="Rechazar"
          >
            <X size={18} strokeWidth={2} />
          </button>
        </>
      )}
    </div>
  );
}
