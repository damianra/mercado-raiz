import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { Leaf } from 'lucide-react';
import App from './App.jsx';
import Login from './pages/Login.jsx';
import Privacidad from './pages/Privacidad.jsx';
import Metricas from './pages/Metricas.jsx';
import NotFound from './pages/NotFound.jsx';
import Proveedores from './pages/Proveedores.jsx';
import Quiebres from './pages/Quiebres.jsx';
import Usuarios from './pages/Usuarios.jsx';
import { usePath } from './lib/router.jsx';
import { getSession, onSesion, refrescarSesion } from './lib/auth.js';
import './index.css';

function Root() {
  const path = usePath();
  const [sesion, setSesion] = useState(getSession());
  // Boot: silent refresh — si la cookie httpOnly sigue viva se
  // recupera la sesión sin pasar por el login.
  const [boot, setBoot] = useState(true);

  useEffect(() => onSesion(setSesion), []);
  useEffect(() => {
    refrescarSesion().finally(() => setBoot(false));
  }, []);

  // Resuelve por último segmento — así también funciona si la app se
  // sirve bajo un subpath (base './' en vite.config).
  const segmento = path.split('/').filter(Boolean).pop() ?? '';

  // /privacidad es pública (la linkea el checkbox del login).
  if (segmento === 'privacidad') return <Privacidad />;

  if (boot) {
    return (
      <div className="grid min-h-screen place-items-center" aria-busy="true" aria-label="Cargando sesión">
        <span className="grid h-14 w-14 place-items-center rounded-lg bg-terra/90">
          <Leaf size={26} className="animate-pulse text-cream" strokeWidth={1.5} />
        </span>
      </div>
    );
  }

  // Guard de rutas (SPEC-23 R23.10): sin sesión → login, cualquiera
  // sea el path protegido pedido.
  if (!sesion) return <Login />;

  if (segmento === 'usuarios') {
    // SPEC-24: la sección solo existe para ADMIN — al resto se le
    // niega con 404 (no se renderiza un "sin permiso" que delata la
    // ruta; la política real la impone el backend con 403).
    return sesion.usuario.rol === 'ADMIN' ? (
      <Usuarios usuario={sesion.usuario} />
    ) : (
      <NotFound />
    );
  }

  if (segmento === 'quiebres') {
    // SPEC-27 T27.4: vista operativa de quiebres — todos los roles.
    return <Quiebres usuario={sesion.usuario} />;
  }

  if (segmento === 'metricas') {
    // SPEC-28 T28.2: scorecard de métricas — todos los roles.
    return <Metricas usuario={sesion.usuario} />;
  }

  if (segmento === 'proveedores') {
    // SPEC-26 T26.4: mismo guard que /usuarios — ADMIN only.
    return sesion.usuario.rol === 'ADMIN' ? (
      <Proveedores usuario={sesion.usuario} />
    ) : (
      <NotFound />
    );
  }

  if (segmento === '' || segmento === 'index.html' || segmento === 'login') {
    return <App usuario={sesion.usuario} />;
  }
  return <NotFound />;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
