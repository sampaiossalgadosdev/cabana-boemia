import { useEffect, useState } from 'react';
import {
  CONVITE_APOS_MS,
  detectarNavegador,
  estaComoApp,
  gravarEscolha,
  lerEscolha,
  mostrarBotaoCabecalho,
  mostrarConvite,
  passosDoConvite,
} from '../lib/instalacao.js';
import { assinarInstalacao, pedirInstalacao, podeInstalar } from '../lib/pwa.js';

function estadoAtual() {
  return {
    comoApp: estaComoApp(window),
    navegador: detectarNavegador(navigator),
    podeInstalar: podeInstalar(),
    escolha: lerEscolha(),
  };
}

/** Acompanha o que o navegador permite (prompt, instalado, aberto como app). */
function useInstalacao() {
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
  return [estado, () => setEstado(estadoAtual())];
}

const IconeBaixar = () => (
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
);

/** Botão discreto "Instalar app" no cabeçalho (só quando o navegador oferece). */
export function InstalarApp() {
  const [estado] = useInstalacao();
  if (!mostrarBotaoCabecalho(estado)) return null;
  return (
    <button type="button" className="instalar-app" onClick={pedirInstalacao}>
      <IconeBaixar />
      Instalar app
    </button>
  );
}

/** Cartão com o passo a passo, CONVITE_APOS_MS depois de entrar (só no celular). */
export function ConviteInstalar() {
  const [estado, atualizar] = useInstalacao();
  const [chegouAHora, setChegouAHora] = useState(false);

  useEffect(() => {
    const relogio = setTimeout(() => setChegouAHora(true), CONVITE_APOS_MS);
    return () => clearTimeout(relogio);
  }, []);

  if (!chegouAHora || !mostrarConvite(estado)) return null;
  const { texto, passos, nota, botaoInstalar } = passosDoConvite(estado.navegador, estado.podeInstalar);

  const fechar = () => {
    gravarEscolha({ conviteFechadoEm: Date.now() });
    atualizar();
  };

  return (
    <section className="convite-instalar" role="dialog" aria-labelledby="convite-instalar-titulo">
      <div className="convite-instalar__topo">
        <img className="convite-instalar__icone" src="/icones/icone-192.png" alt="" width="48" height="48" />
        <div>
          <h2 id="convite-instalar-titulo" className="convite-instalar__titulo">
            Instale o app da Cabana
          </h2>
          <p className="convite-instalar__texto">{texto}</p>
        </div>
        <button type="button" className="convite-instalar__fechar" onClick={fechar} aria-label="Fechar">
          ×
        </button>
      </div>
      {passos.length > 0 && (
        <ol className="convite-instalar__passos">
          {passos.map((passo) => (
            <li key={passo}>{passo}</li>
          ))}
        </ol>
      )}
      {nota && <p className="convite-instalar__nota">{nota}</p>}
      <div className="convite-instalar__acoes">
        <button type="button" className="botao botao--secundario" onClick={fechar}>
          Agora não
        </button>
        {botaoInstalar && (
          <button type="button" className="botao botao--primario" onClick={pedirInstalacao}>
            <IconeBaixar /> Instalar
          </button>
        )}
      </div>
    </section>
  );
}
