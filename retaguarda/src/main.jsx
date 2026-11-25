import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/dancing-script/700.css';
import '@fontsource/bricolage-grotesque/latin-800.css';
import './estilos/tokens.css';
import './estilos/app.css';
import { App } from './App.jsx';
import { AvisosProvider } from './componentes/comuns.jsx';
import { aplicarTema, definirLogoTaaki } from './lib/tema.js';
import logoTaaki from '../../shared/assets/logo-taaki-320.jpg';

// Sem loja (login, plataforma) = estilo do Taaki, antes do primeiro desenho; com a loja definida, o App troca.
definirLogoTaaki(logoTaaki);
aplicarTema(null);

createRoot(document.getElementById('raiz')).render(
  <StrictMode>
    <AvisosProvider>
      <App />
    </AvisosProvider>
  </StrictMode>,
);
