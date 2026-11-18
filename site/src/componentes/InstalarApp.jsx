import { useEffect, useState } from 'react';
import { ehSafariDoIos, estaComoApp, gravarEscolha, lerEscolha, oQueMostrar } from '../lib/instalacao.js';
import { assinarInstalacao, pedirInstalacao, podeInstalar } from '../lib/pwa.js';

function estadoAtual() {
  return {
    comoApp: estaComoApp(window),
    safariIos: ehSafariDoIos(navigator),
    podeInstalar: podeInstalar(),
    escolha: lerEscolha(),
  };
}

/** Convite discreto para instalar o site como app (cabeçalho). */
export function InstalarApp() {
  const [estado, setEstado] = useState(estadoAtual);

  useEffect(() => {
    const atualizar = () => setEstado(estadoAtual());
    const sair = assinarInstalacao(atualizar);
    const midia = window.matchMedia?.('(display-mode: standalone)');
    midia?.addEventListener?.('change', atualizar);
    return () => {
      sair();
      midia?.removeEventListener?.('change', atualizar);
    };
  }, []);

  const mostrar = oQueMostrar(estado);

  if (mostrar === 'botao') {
    return (
      <button type="button" className="instalar-app" onClick={pedirInstalacao}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path
            d="M12 3v11m0 0-4-4m4 4 4-4M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Instalar app
      </button>
    );
  }

  if (mostrar === 'dica-ios') {
    const fechar = () => {
      gravarEscolha({ ios: 'fechado' });
      setEstado(estadoAtual());
    };
    return (
      <p className="dica-instalar" role="note">
        <span>
          Para ter o app: toque em <strong>Compartilhar</strong> e depois em{' '}
          <strong>Adicionar à Tela de Início</strong>.
        </span>
        <button type="button" className="dica-instalar__fechar" onClick={fechar} aria-label="Fechar dica">
          ×
        </button>
      </p>
    );
  }

  return null;
}
