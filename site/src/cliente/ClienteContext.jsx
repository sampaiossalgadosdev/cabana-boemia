import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as api from '../lib/api.js';
import { carregarToken, salvarToken, apagarToken, sessaoExpirou } from './sessao.js';

const ClienteContext = createContext(null);

/**
 * Sessão do cliente do site. Com token salvo, confere em GET /cliente/me ao
 * abrir; 401 apaga o token (volta a pedir login). Falha de rede mantém o
 * token e tenta de novo na próxima ação.
 */
export function ClienteProvider({ children }) {
  const [token, setToken] = useState(() => carregarToken());
  const [cliente, setCliente] = useState(null);
  const [status, setStatus] = useState(() => (carregarToken() ? 'carregando' : 'anonimo'));

  const sair = useCallback(() => {
    apagarToken();
    setToken(null);
    setCliente(null);
    setStatus('anonimo');
  }, []);

  useEffect(() => {
    if (!token || cliente) return undefined;
    let vivo = true;
    setStatus('carregando');
    api
      .buscarCliente(token)
      .then(({ cliente: c }) => {
        if (!vivo) return;
        setCliente(c);
        setStatus('logado');
      })
      .catch((err) => {
        if (!vivo) return;
        if (sessaoExpirou(err)) sair();
        else setStatus('anonimo'); // sem rede: mostra o login; o token continua salvo
      });
    return () => {
      vivo = false;
    };
  }, [token, cliente, sair]);

  /** Recebe o credential do Google Identity Services. */
  const entrar = useCallback(async (credential) => {
    const { token: novo, cliente: c } = await api.entrarComGoogle(credential);
    salvarToken(novo);
    setCliente(c);
    setToken(novo);
    setStatus('logado');
    return c;
  }, []);

  const atualizarPerfil = useCallback(
    async (dados) => {
      try {
        const { cliente: c } = await api.salvarPerfil(token, dados);
        setCliente(c);
        return c;
      } catch (err) {
        if (sessaoExpirou(err)) sair();
        throw err;
      }
    },
    [token, sair],
  );

  const valor = useMemo(
    () => ({ token, cliente, status, entrar, atualizarPerfil, sair }),
    [token, cliente, status, entrar, atualizarPerfil, sair],
  );

  return <ClienteContext.Provider value={valor}>{children}</ClienteContext.Provider>;
}

export function useCliente() {
  const ctx = useContext(ClienteContext);
  if (!ctx) throw new Error('useCliente fora do ClienteProvider');
  return ctx;
}
