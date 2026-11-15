import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/dancing-script/700.css';
import './estilos/tokens.css';
import './estilos/global.css';
import { App } from './App.jsx';
import { CarrinhoProvider } from './carrinho/CarrinhoContext.jsx';
import { AvisosProvider } from './componentes/Avisos.jsx';
import { aplicarFavicon } from './lib/logo.js';

aplicarFavicon();

createRoot(document.getElementById('raiz')).render(
  <StrictMode>
    <AvisosProvider>
      <CarrinhoProvider>
        <App />
      </CarrinhoProvider>
    </AvisosProvider>
  </StrictMode>,
);
