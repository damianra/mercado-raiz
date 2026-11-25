// Mini-router por path — sin react-router: resuelve contra
// window.location.pathname, navega con history.pushState y un evento
// interno (pushState no dispara popstate por sí solo).
import { useEffect, useState } from 'react';

const NAV_EVENT = 'app:navigate';

export function usePath() {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const onNav = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onNav);
    window.addEventListener(NAV_EVENT, onNav);
    return () => {
      window.removeEventListener('popstate', onNav);
      window.removeEventListener(NAV_EVENT, onNav);
    };
  }, []);
  return path;
}

// Espejo de usePath para la query string: T32.8 — una navegación
// que solo cambia el search (/metricas → /metricas?ajustar=N) no
// remonta la página, así que los efectos de deep-link se suscriben
// a esto, no al mount. `nav` es un tick que crece en cada evento:
// cubre el re-click a la MISMA url (replaceState deja el search
// stale; sin tick el segundo navigate sería un setState idéntico
// y el efecto no re-correría).
export function useSearch() {
  const [st, setSt] = useState(() => ({ search: window.location.search, nav: 0 }));
  useEffect(() => {
    const onNav = () =>
      setSt((p) => ({ search: window.location.search, nav: p.nav + 1 }));
    window.addEventListener('popstate', onNav);
    window.addEventListener(NAV_EVENT, onNav);
    return () => {
      window.removeEventListener('popstate', onNav);
      window.removeEventListener(NAV_EVENT, onNav);
    };
  }, []);
  return st;
}

export function navigate(to) {
  window.history.pushState(null, '', to);
  window.dispatchEvent(new Event(NAV_EVENT));
  window.scrollTo(0, 0);
}

export function Link({ to, children, onClick, ...rest }) {
  return (
    <a
      href={to}
      {...rest}
      onClick={(e) => {
        e.preventDefault();
        onClick?.(e);
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
