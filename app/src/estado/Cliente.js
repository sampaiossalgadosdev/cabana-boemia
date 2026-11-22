import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as api from '../lib/api.js';
import { obterConfig, obterDadosDoApp } from '../lib/config.js';
import { apagarSessao, carregarSessao, precisaRenovar, salvarSessao, sessaoExpirou } from '../logica/sessao.js';
import * as provedores from '../login/provedores.js';

const ClienteContext = createContext(null);

/**
 * Sessão do cliente no app (o ClienteContext do site, com refresh):
 * - token (7 dias) + refreshToken (60 dias, rotativo) no cofre do aparelho;
 *   provedor 'google' | 'apple' | 'telefone' (login com celular);
 * - ao abrir e ao voltar para o app, renova se o token vence em menos de um
 *   dia; um 401 numa chamada renova uma vez e repete;
 * - renovação "single-flight": a API trata refresh reapresentado como roubo;
 * - refresh recusado = sai (volta a pedir login). Sem rede, mantém a sessão
 *   e mostra o erro com "Tentar de novo" (status 'erro').
 */
export function ClienteProvider({ children }) {
  const [status, setStatus] = useState('carregando'); // 'carregando' | 'anonimo' | 'logado' | 'erro'
  const [cliente, setCliente] = useState(null);
  const sessao = useRef(null); // { token, refreshToken, provedor }
  const renovando = useRef(null);

  const guardar = useCallback(async (nova) => {
    sessao.current = nova;
    await salvarSessao(nova);
  }, []);

  const esquecer = useCallback(async () => {
    sessao.current = null;
    renovando.current = null;
    await apagarSessao();
    setCliente(null);
    setStatus('anonimo');
  }, []);

  /** Token novo pelo refresh (uma renovação por vez). Lança o erro da API. */
  const renovar = useCallback(() => {
    renovando.current ??= (async () => {
      const atual = sessao.current;
      if (!atual?.refreshToken) throw Object.assign(new Error('Sem refresh'), { status: 401 });
      const r = await api.renovarSessao(atual.refreshToken);
      await guardar({ token: r.token, refreshToken: r.refreshToken, provedor: atual.provedor });
      setCliente(r.cliente);
      return r.token;
    })().finally(() => {
      renovando.current = null;
    });
    return renovando.current;
  }, [guardar]);

  /**
   * Chamada autenticada: `fn(token)`. Token perto de vencer renova antes; 401
   * renova uma vez e repete; refresh recusado sai da conta e repassa o 401.
   */
  const chamar = useCallback(
    async (fn) => {
      if (!sessao.current) throw Object.assign(new Error('Entre na sua conta'), { status: 401 });
      try {
        if (precisaRenovar(sessao.current.token) && sessao.current.refreshToken) await renovar();
      } catch (erro) {
        if (sessaoExpirou(erro)) {
          await esquecer();
          throw erro;
        }
        // sem rede: tenta com o token atual (ainda pode valer)
      }
      try {
        return await fn(sessao.current.token);
      } catch (erro) {
        if (!sessaoExpirou(erro) || !sessao.current?.refreshToken) {
          if (sessaoExpirou(erro)) await esquecer();
          throw erro;
        }
        try {
          await renovar();
        } catch (e2) {
          if (sessaoExpirou(e2)) await esquecer();
          throw e2;
        }
        try {
          return await fn(sessao.current.token);
        } catch (e3) {
          if (sessaoExpirou(e3)) await esquecer(); // token novo também recusado: conta apagada
          throw e3;
        }
      }
    },
    [renovar, esquecer],
  );

  /** Abre a sessão salva: confere em GET /cliente/me (renovando se precisar). */
  const abrir = useCallback(async () => {
    setStatus('carregando');
    sessao.current ??= await carregarSessao();
    if (!sessao.current) return setStatus('anonimo');
    try {
      const { cliente: c } = await chamar((token) => api.buscarCliente(token));
      setCliente(c);
      setStatus('logado');
    } catch (erro) {
      if (sessaoExpirou(erro)) return setStatus('anonimo');
      setStatus('erro'); // sem rede: a sessão continua salva
    }
  }, [chamar]);

  useEffect(() => {
    abrir();
  }, [abrir]);

  // Voltou para o app: renova se o token estiver perto de vencer.
  useEffect(() => {
    const s = AppState.addEventListener('change', (estado) => {
      if (estado === 'active' && sessao.current?.refreshToken && precisaRenovar(sessao.current.token)) {
        renovar().catch((e) => sessaoExpirou(e) && esquecer());
      }
    });
    return () => s.remove();
  }, [renovar, esquecer]);

  const concluirLogin = useCallback(
    async (r, provedor) => {
      await guardar({ token: r.token, refreshToken: r.refreshToken ?? null, provedor });
      setCliente(r.cliente);
      setStatus('logado');
      return r.cliente;
    },
    [guardar],
  );

  /**
   * Versão dos termos/política aceita na tela de entrada (a caixa marcada).
   * Sem resposta da API, entra sem ela: o app pede o aceite logo depois.
   */
  const versaoAceita = async () => (await obterDadosDoApp().catch(() => null))?.documentos.versao ?? undefined;

  const entrarComGoogle = useCallback(async () => {
    const [config, aceite] = await Promise.all([obterConfig().catch(() => null), versaoAceita()]);
    const { idToken } = await provedores.entrarComGoogle(config?.googleClientId);
    return concluirLogin(await api.entrarComGoogle(idToken, { aceite }), 'google');
  }, [concluirLogin]);

  const entrarComApple = useCallback(async () => {
    const aceite = await versaoAceita();
    const { identityToken, nonce, nome } = await provedores.entrarComApple();
    return concluirLogin(await api.entrarComApple({ identityToken, nonce, nome, aceite }), 'apple');
  }, [concluirLogin]);

  /** Login com celular, passo 1: pede o código (verificador de teste: nada chega por SMS). */
  const enviarCodigoTelefone = useCallback((telefone) => api.enviarCodigoTelefone(telefone), []);

  /** Login com celular, passo 2: confere o código e entra (mesma sessão e mesmo aceite do Google). */
  const entrarComTelefone = useCallback(
    async (telefone, codigo) => {
      const aceite = await versaoAceita();
      return concluirLogin(await api.entrarComTelefone({ telefone, codigo, aceite }), 'telefone');
    },
    [concluirLogin],
  );

  /** Aceite da versão atual (tela de aceite). 409 VERSAO_DESATUALIZADA: busca a versão nova e tenta de novo. */
  const aceitarTermos = useCallback(async () => {
    let versao = (await obterDadosDoApp()).documentos.versao;
    let r;
    try {
      r = await chamar((token) => api.aceitarTermos(token, versao));
    } catch (e) {
      if (e?.codigo !== 'VERSAO_DESATUALIZADA') throw e;
      versao = (await obterDadosDoApp({ forcar: true })).documentos.versao;
      r = await chamar((token) => api.aceitarTermos(token, versao));
    }
    setCliente(r.cliente);
    return r.cliente;
  }, [chamar]);

  /** Consentimento de marketing (Perfil › Comunicações). */
  const definirMarketing = useCallback(
    async (aceito) => {
      const { cliente: c } = await chamar((token) => api.definirMarketing(token, aceito));
      setCliente(c);
      return c;
    },
    [chamar],
  );

  const sair = useCallback(async () => {
    const atual = sessao.current;
    if (atual?.refreshToken) api.sairDaSessao(atual.refreshToken).catch(() => {});
    if (atual?.provedor === 'google') provedores.sairDoGoogle();
    await esquecer();
  }, [esquecer]);

  const atualizarPerfil = useCallback(
    async (dados) => {
      const { cliente: c } = await chamar((token) => api.salvarPerfil(token, dados));
      setCliente(c);
      return c;
    },
    [chamar],
  );

  /**
   * Exclui a conta na API. Conta da Apple: pede um código novo à Apple para
   * a API revogar o login lá (se o cliente cancelar, exclui do mesmo jeito).
   */
  const excluirConta = useCallback(async () => {
    const provedor = sessao.current?.provedor;
    const appleAuthorizationCode = provedor === 'apple' ? await provedores.codigoAppleParaExclusao() : null;
    const r = await chamar((token) => api.excluirConta(token, { appleAuthorizationCode }));
    if (provedor === 'google') provedores.sairDoGoogle({ revogar: true });
    await esquecer();
    return r;
  }, [chamar, esquecer]);

  const valor = useMemo(
    () => ({
      status,
      cliente,
      provedor: sessao.current?.provedor ?? null,
      chamar,
      entrarComGoogle,
      entrarComApple,
      enviarCodigoTelefone,
      entrarComTelefone,
      sair,
      atualizarPerfil,
      excluirConta,
      aceitarTermos,
      definirMarketing,
      tentarDeNovo: abrir,
    }),
    [status, cliente, chamar, entrarComGoogle, entrarComApple, enviarCodigoTelefone, entrarComTelefone, sair, atualizarPerfil, excluirConta, aceitarTermos, definirMarketing, abrir],
  );

  return <ClienteContext.Provider value={valor}>{children}</ClienteContext.Provider>;
}

export function useCliente() {
  const ctx = useContext(ClienteContext);
  if (!ctx) throw new Error('useCliente fora do ClienteProvider');
  return ctx;
}
