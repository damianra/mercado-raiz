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
// a esto, no al mount.
export function useSearch() {
  const [search, setSearch] = useState(() => window.location.search);
  useEffect(() => {
    const onNav = () => setSearch(window.location.search);
    window.addEventListener('popstate', onNav);
    window.addEventListener(NAV_EVENT, onNav);
    return () => {
      window.removeEventListener('popstate', onNav);
      window.removeEventListener(NAV_EVENT, onNav);
    };
  }, []);
  return search;
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
