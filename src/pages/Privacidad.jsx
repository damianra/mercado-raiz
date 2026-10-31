import { Leaf, ArrowLeft, ShieldCheck } from 'lucide-react';
import { Link } from '../lib/router.jsx';

const SECCIONES = [
  {
    title: 'Qué datos recolectamos',
    body: 'MERCADO RAÍZ procesa datos operativos del sistema de aprovisionamiento: órdenes de compra, productos, proveedores y movimientos de stock. De los usuarios del panel solo se registra nombre, dirección de email corporativa y rol (APROBADOR, GERENTE o ADMIN) para identificar quién aprueba o rechaza cada orden.',
  },
  {
    title: 'Finalidad del tratamiento',
    body: 'Los datos se utilizan exclusivamente para operar el flujo de aprobación de órdenes de compra: trazabilidad de decisiones (aprobado_por, motivo de rechazo), métricas del dashboard y contacto con proveedores. No se utilizan con fines publicitarios ni se ceden a terceros.',
  },
  {
    title: 'Retención',
    body: 'Los registros de órdenes y del historial de stock se conservan mientras la cuenta esté activa, por su valor de auditoría operativa. Los usuarios dados de baja quedan marcados como inactivos y sus datos de identificación se mantienen solo en los registros históricos que ya autorizaron.',
  },
  {
    title: 'Derechos ARCO',
    body: 'Como titular de datos personales podés ejercer los derechos de Acceso, Rectificación, Cancelación y Oposición (Ley 25.326, Argentina) escribiendo al responsable de la base de datos. También podés solicitar la anonimización de tus registros cuando ya no sean necesarios para la auditoría.',
  },
  {
    title: 'Cookies y terceros',
    body: 'Esta aplicación no utiliza cookies de seguimiento, píxeles ni scripts de analítica de terceros. Solo se cargan fuentes tipográficas (Google Fonts) para la interfaz, sin captura de datos personales.',
  },
  {
    title: 'Responsable y contacto',
    body: 'Responsable de la base de datos: MERCADO RAÍZ — Sistema de Aprovisionamiento. Contacto para consultas o ejercicio de derechos: privacidad@mercadorai.com.',
  },
];

export default function Privacidad() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-root/10 bg-cream/90">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-6 py-5">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-terra/90">
            <Leaf size={20} className="text-cream" strokeWidth={1.5} />
          </span>
          <div>
            <p className="font-display text-lg font-bold leading-tight text-grafito">
              MERCADO RAÍZ
            </p>
            <p className="text-[11px] font-medium tracking-wide text-warmgray">
              Aviso de privacidad
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm font-semibold text-root transition hover:text-root-dark"
        >
          <ArrowLeft size={15} strokeWidth={1.5} /> Volver al panel
        </Link>

        <h1 className="mt-6 flex items-center gap-3 font-display text-3xl font-bold tracking-tight text-grafito sm:text-4xl">
          <ShieldCheck size={30} className="text-root" strokeWidth={1.5} />
          Política de privacidad
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-warmgray">
          Este aviso describe cómo MERCADO RAÍZ recolecta, usa y protege los
          datos personales que circulan por el sistema de aprovisionamiento.
        </p>

        <div className="mt-8 space-y-4">
          {SECCIONES.map(({ title, body }) => (
            <section
              key={title}
              className="rounded-lg bg-white p-6 shadow-soft ring-1 ring-root/10"
            >
              <h2 className="font-display text-lg font-semibold text-grafito">
                {title}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-grafito/80">{body}</p>
            </section>
          ))}
        </div>
      </main>

      <footer className="border-t border-root/10 px-8 py-4 text-center text-xs text-warmgray">
        MERCADO RAÍZ · Del campo a tu mesa, con inteligencia · Desde 1952 ·{' '}
        <Link to="/privacidad" className="font-semibold text-root hover:underline">
          Privacidad
        </Link>
      </footer>
    </div>
  );
}
