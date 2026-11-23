import { useCallback, useEffect, useState } from 'react';
import { chamar, pdv } from './lib/pdv.js';
import { Logo, LojaContexto } from './componentes/Logo.jsx';
import { aplicarTema } from './lib/tema.js';
import { TelaConfiguracao } from './telas/TelaConfiguracao.jsx';
import { TelaImpressoraInicial } from './telas/TelaImpressoraInicial.jsx';
import { TelaLogin } from './telas/TelaLogin.jsx';
import { TelaPrincipal } from './telas/TelaPrincipal.jsx';
import { TelaEscolherLoja } from './telas/TelaEscolherLoja.jsx';

/**
 * Telas: carregando → configurar (sem servidor) → impressora (primeira execução) → login
 * → (ADMIN: escolher a loja) → principal. Ao abrir, tenta a sessão salva (refresh cifrado no main).
 * O tema (cor e logo) é o da loja; sem loja, o padrão do Taaki Delivery.
 */
export function App() {
  const [loja, setLoja] = useState(null);
  useEffect(() => {
    aplicarTema(loja);
  }, [loja]);
  useEffect(() => pdv.aoEvento('loja:atualizada', (nova) => setLoja(nova)), []);
  return (
    <LojaContexto.Provider value={loja}>
      <Telas aoMudarLoja={setLoja} />
    </LojaContexto.Provider>
  );
}

function Telas({ aoMudarLoja }) {
  const [tela, setTela] = useState('carregando');
  const [apiUrl, setApiUrl] = useState(null);
  const [apiUrlSugerido, setApiUrlSugerido] = useState('');
  const [impressaoConfigurada, setImpressaoConfigurada] = useState(true);
  const [usuario, setUsuario] = useState(null);
  const [aviso, setAviso] = useState('');
  const [erroInicio, setErroInicio] = useState('');

  const iniciar = useCallback(async () => {
    setTela('carregando');
    setErroInicio('');
    try {
      const config = await chamar(pdv.config.obter());
      setApiUrl(config.apiUrl);
      setApiUrlSugerido(config.apiUrlSugerido ?? '');
      setImpressaoConfigurada(config.impressaoConfigurada);
      if (!config.apiUrl) return setTela('configurar');
      if (!config.impressaoConfigurada) return setTela('impressora');
      entrou(await chamar(pdv.sessao.restaurar()));
    } catch (err) {
      setErroInicio(err.message);
      setTela('semConexao');
    }
  }, []);

  /** Logado: com loja, a tela principal; ADMIN sem loja, a escolha. */
  function entrou(u) {
    setUsuario(u);
    aoMudarLoja(u?.loja ?? null);
    if (!u) setTela('login');
    else setTela(u.loja ? 'principal' : 'escolherLoja');
  }

  function saiu(mensagem = '') {
    setUsuario(null);
    aoMudarLoja(null);
    setAviso(mensagem);
    setTela('login');
  }

  useEffect(() => {
    iniciar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iniciar]);

  useEffect(
    () =>
      pdv.aoEvento('sessao:expirou', ({ mensagem }) => saiu(mensagem || 'Sua sessão terminou. Entre de novo.')),
    [],
  );

  if (tela === 'carregando') {
    return (
      <div className="tela-centro">
        <Logo className="cartao-login__logo" />
        <p>Carregando…</p>
      </div>
    );
  }

  if (tela === 'semConexao') {
    return (
      <div className="tela-centro">
        <div className="cartao-login">
          <Logo className="cartao-login__logo" />
          <h1 className="cartao-login__titulo">Sem conexão</h1>
          <p className="erro">{erroInicio}</p>
          <p className="cartao-login__texto">Servidor: {apiUrl}</p>
          <button type="button" className="botao botao--largo" onClick={iniciar}>Tentar de novo</button>
          <button type="button" className="botao botao--contorno botao--largo" onClick={() => setTela('login')}>
            Ir para o login
          </button>
        </div>
      </div>
    );
  }

  if (tela === 'configurar') {
    return (
      <TelaConfiguracao
        apiUrl={apiUrl}
        sugestao={apiUrlSugerido}
        aoSalvar={(url) => {
          setApiUrl(url);
          setTela(impressaoConfigurada ? 'login' : 'impressora');
        }}
        aoVoltar={apiUrl ? () => setTela('login') : null}
      />
    );
  }

  if (tela === 'impressora') {
    return (
      <TelaImpressoraInicial
        aoConcluir={() => {
          setImpressaoConfigurada(true);
          setTela('login');
        }}
      />
    );
  }

  if (tela === 'login') {
    return (
      <TelaLogin
        apiUrl={apiUrl}
        aviso={aviso}
        aoConfigurar={() => setTela('configurar')}
        aoEntrar={(u) => {
          setAviso('');
          entrou(u);
        }}
      />
    );
  }

  if (tela === 'escolherLoja') {
    return (
      <TelaEscolherLoja
        usuario={usuario}
        aoEscolher={(identidade) => entrou({ ...usuario, loja: identidade })}
        aoSair={async () => {
          await chamar(pdv.sessao.sair()).catch(() => {});
          saiu();
        }}
      />
    );
  }

  return (
    <TelaPrincipal
      // Trocar de loja (ADMIN) remonta tudo: pedidos, caixa e cardápio são da outra loja.
      key={usuario?.loja?.slug}
      usuario={usuario}
      aoSair={() => saiu()}
      aoTrocarLoja={
        usuario?.papel === 'ADMIN'
          ? async () => {
              await chamar(pdv.loja.escolher(null)).catch(() => {});
              entrou({ ...usuario, loja: null });
            }
          : null
      }
    />
  );
}
