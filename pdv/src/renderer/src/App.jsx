import { useCallback, useEffect, useState } from 'react';
import { chamar, pdv } from './lib/pdv.js';
import { Logo } from './componentes/Logo.jsx';
import { TelaConfiguracao } from './telas/TelaConfiguracao.jsx';
import { TelaLogin } from './telas/TelaLogin.jsx';
import { TelaPrincipal } from './telas/TelaPrincipal.jsx';

/**
 * Telas: carregando → configurar (sem servidor) → login → principal.
 * Ao abrir, tenta a sessão salva (refresh cifrado no main).
 */
export function App() {
  const [tela, setTela] = useState('carregando');
  const [apiUrl, setApiUrl] = useState(null);
  const [usuario, setUsuario] = useState(null);
  const [aviso, setAviso] = useState('');
  const [erroInicio, setErroInicio] = useState('');

  const iniciar = useCallback(async () => {
    setTela('carregando');
    setErroInicio('');
    try {
      const config = await chamar(pdv.config.obter());
      setApiUrl(config.apiUrl);
      if (!config.apiUrl) return setTela('configurar');
      const u = await chamar(pdv.sessao.restaurar());
      if (u) {
        setUsuario(u);
        setTela('principal');
      } else {
        setTela('login');
      }
    } catch (err) {
      setErroInicio(err.message);
      setTela('semConexao');
    }
  }, []);

  useEffect(() => {
    iniciar();
  }, [iniciar]);

  useEffect(
    () =>
      pdv.aoEvento('sessao:expirou', ({ mensagem }) => {
        setUsuario(null);
        setAviso(mensagem || 'Sua sessão terminou. Entre de novo.');
        setTela('login');
      }),
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
        aoSalvar={(url) => {
          setApiUrl(url);
          setTela('login');
        }}
        aoVoltar={apiUrl ? () => setTela('login') : null}
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
          setUsuario(u);
          setTela('principal');
        }}
      />
    );
  }

  return (
    <TelaPrincipal
      usuario={usuario}
      aoSair={() => {
        setUsuario(null);
        setAviso('');
        setTela('login');
      }}
    />
  );
}
