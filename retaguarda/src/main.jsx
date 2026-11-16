import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/dancing-script/700.css';
import './estilos/tokens.css';
import './estilos/app.css';
import { App } from './App.jsx';
import { AvisosProvider } from './componentes/comuns.jsx';
import { aplicarFavicon } from './lib/logo.js';

aplicarFavicon();

createRoot(document.getElementById('raiz')).render(
  <StrictMode>
    <AvisosProvider>
      <App />
    </AvisosProvider>
  </StrictMode>,
);
