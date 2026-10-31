import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import Privacidad from './pages/Privacidad.jsx';
import NotFound from './pages/NotFound.jsx';
import { usePath } from './lib/router.jsx';
import './index.css';

function Root() {
  const path = usePath();
  // Resuelve por último segmento — así también funciona si la app se
  // sirve bajo un subpath (base './' en vite.config).
  const segmento = path.split('/').filter(Boolean).pop() ?? '';
  if (segmento === 'privacidad') return <Privacidad />;
  if (segmento === '' || segmento === 'index.html') return <App />;
  return <NotFound />;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
