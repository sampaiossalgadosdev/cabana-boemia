import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import './estilos/tokens.css';
import './estilos/app.css';
import './estilos/delivery.css';
import './estilos/impressao.css';

createRoot(document.getElementById('raiz')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
