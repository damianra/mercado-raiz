import { Leaf, Compass, ArrowLeft } from 'lucide-react';
import { Link } from '../lib/router.jsx';

export default function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center px-6">
      <div className="w-full max-w-md rounded-lg bg-white p-10 text-center shadow-soft ring-1 ring-root/10">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-lg bg-terra/90">
          <Leaf size={26} className="text-cream" strokeWidth={1.5} />
        </span>
        <p className="mt-6 font-mono text-sm font-bold tracking-widest text-terra">
          404
        </p>
        <h1 className="mt-2 font-display text-2xl font-bold tracking-tight text-grafito">
          Página no encontrada
        </h1>
        <p className="mt-3 flex items-start justify-center gap-2 text-sm leading-relaxed text-warmgray">
          <Compass size={16} className="mt-0.5 shrink-0" strokeWidth={1.5} />
          La ruta que buscás no existe o fue movida. Volvé al panel de
          órdenes para seguir trabajando.
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex h-12 items-center gap-2 rounded-lg bg-root px-6 text-sm font-semibold text-white transition duration-200 ease-brand hover:-translate-y-0.5 hover:bg-root-dark hover:shadow-lift"
        >
          <ArrowLeft size={15} strokeWidth={2} /> Volver al inicio
        </Link>
      </div>
    </div>
  );
}
