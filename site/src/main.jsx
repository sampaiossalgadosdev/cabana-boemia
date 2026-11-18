import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/dancing-script/700.css';
import './estilos/tokens.css';
import './estilos/global.css';
import { App } from './App.jsx';
import { CarrinhoProvider } from './carrinho/CarrinhoContext.jsx';
import { ClienteProvider } from './cliente/ClienteContext.jsx';
import { AvisosProvider } from './componentes/Avisos.jsx';
import { aplicarFavicon } from './lib/logo.js';
import { PaginaLegal, PAGINAS_LEGAIS } from './componentes/PaginaLegal.jsx';
import { iniciarPwa } from './lib/pwa.js';

aplicarFavicon();
iniciarPwa();

// /privacidade e /termos: páginas de texto (a API devolve o index.html para qualquer rota).
const paginaLegal = PAGINAS_LEGAIS[window.location.pathname.replace(/\/+$/, '')];

createRoot(document.getElementById('raiz')).render(
  <StrictMode>
    {paginaLegal ? (
      <PaginaLegal tipo={paginaLegal} />
    ) : (
      <AvisosProvider>
        <ClienteProvider>
          <CarrinhoProvider>
            <App />
          </CarrinhoProvider>
        </ClienteProvider>
      </AvisosProvider>
    )}
  </StrictMode>,
);
