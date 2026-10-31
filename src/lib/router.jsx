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

export function navigate(to) {
  window.history.pushState(null, '', to);
  window.dispatchEvent(new Event(NAV_EVENT));
  window.scrollTo(0, 0);
}

export function Link({ to, children, ...rest }) {
  return (
    <a
      href={to}
      {...rest}
      onClick={(e) => {
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}
