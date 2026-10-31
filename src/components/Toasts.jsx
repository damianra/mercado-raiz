import { CheckCircle2, XCircle } from 'lucide-react';

export default function Toasts({ toasts }) {
  return (
    <div
      className="pointer-events-none fixed bottom-6 right-6 z-[70] flex w-80 flex-col gap-2"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.key}
          className={`animate-fade-up rounded-lg bg-white p-4 shadow-lift ring-1 ${
            t.tipo === 'error' ? 'ring-terra/30' : 'ring-success/30'
          }`}
        >
          <div className="flex items-start gap-3">
            {t.tipo === 'error' ? (
              <XCircle size={18} className="mt-0.5 text-terra" />
            ) : (
              <CheckCircle2 size={18} className="mt-0.5 text-success" />
            )}
            <p className="text-sm font-medium text-grafito">{t.mensaje}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
