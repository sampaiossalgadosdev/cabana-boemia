import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import './estilos/tokens.css';
import './estilos/app.css';
import './estilos/delivery.css';
import './estilos/impressao.css';
import './estilos/salao.css';
import './estilos/caixa.css';
import './estilos/painel.css';
import './estilos/novo-pedido.css';

createRoot(document.getElementById('raiz')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
