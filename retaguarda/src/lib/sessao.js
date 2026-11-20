/**
 * Sessão do dono na retaguarda (lógica pura, testada com node:test).
 *
 * - Access token só na memória; refresh no armazenamento (localStorage).
 * - Renovação SINGLE-FLIGHT: a API trata reuso de refresh como roubo e
 *   derruba todas as sessões. Dentro da aba, chamadas concorrentes dividem a
 *   mesma promessa; entre abas, `travar` (Web Locks) serializa, e o refresh é
 *   relido do armazenamento dentro da trava (outra aba pode ter girado).
 * - Renova 60 s antes de vencer; 401 numa requisição renova e repete uma vez.
 * - Refresh recusado (401) apaga a sessão e avisa (`aoExpirar`). Erro de rede
 *   mantém o refresh (tenta de novo depois).
 */

export const CHAVE_REFRESH = 'cabana-boemia:retaguarda:refresh:v1';
const MARGEM_MS = 60_000;

/** `exp` do JWT em ms (sem validar assinatura: só para saber quando renovar). */
export function expiracaoDoToken(token) {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const { exp } = JSON.parse(atob(base64));
    return typeof exp === 'number' ? exp * 1000 : 0;
  } catch {
    return 0;
  }
}

/** A retaguarda é do DONO; o ADMIN (plataforma) está acima dele e também entra. */
export const podeEntrar = (papel) => papel === 'DONO' || papel === 'ADMIN';

export class SessaoExpirada extends Error {
  constructor(mensagem = 'Sua sessão expirou. Entre de novo.') {
    super(mensagem);
    this.name = 'SessaoExpirada';
    this.status = 401;
  }
}

/**
 * @param {{
 *   armazenamento: { getItem(k: string): string|null, setItem(k: string, v: string): void, removeItem(k: string): void },
 *   enviar: (metodo: string, rota: string, opcoes?: { corpo?: unknown, token?: string }) => Promise<any>,
 *   travar?: (fn: () => Promise<any>) => Promise<any>,
 *   agora?: () => number,
 *   aoExpirar?: () => void,
 * }} deps `enviar` lança erro com `status` em resposta ≠ 2xx
 */
export function criarSessao({ armazenamento, enviar, travar = (fn) => fn(), agora = Date.now, aoExpirar = () => {} }) {
  let access = null;
  let usuario = null;
  let renovando = null;

  const lerRefresh = () => {
    try {
      return armazenamento.getItem(CHAVE_REFRESH);
    } catch {
      return null;
    }
  };
  const gravarRefresh = (r) => {
    try {
      if (r) armazenamento.setItem(CHAVE_REFRESH, r);
      else armazenamento.removeItem(CHAVE_REFRESH);
    } catch {
      // sem armazenamento: a sessão vale só enquanto a aba estiver aberta
    }
  };

  function limpar() {
    access = null;
    usuario = null;
    gravarRefresh(null);
  }

  function expirar() {
    const tinha = access != null || usuario != null;
    limpar();
    if (tinha) aoExpirar();
  }

  async function renovarAgora() {
    return travar(async () => {
      const refresh = lerRefresh();
      if (!refresh) {
        expirar();
        throw new SessaoExpirada();
      }
      let r;
      try {
        r = await enviar('POST', '/auth/refresh', { corpo: { refreshToken: refresh } });
      } catch (err) {
        if (err?.status === 401) {
          expirar();
          throw new SessaoExpirada();
        }
        throw err; // rede/servidor: mantém o refresh
      }
      gravarRefresh(r.refreshToken);
      access = r.accessToken;
      return access;
    });
  }

  /** Single-flight dentro da aba. */
  function renovar() {
    renovando ??= renovarAgora().finally(() => {
      renovando = null;
    });
    return renovando;
  }

  async function tokenValido() {
    if (access && expiracaoDoToken(access) - agora() > MARGEM_MS) return access;
    return renovar();
  }

  /** Requisição autenticada; 401 renova e repete uma vez. */
  async function chamar(metodo, rota, corpo) {
    const token = await tokenValido();
    try {
      return await enviar(metodo, rota, { corpo, token });
    } catch (err) {
      if (err?.status !== 401) throw err;
      const novo = await renovar();
      return enviar(metodo, rota, { corpo, token: novo });
    }
  }

  async function exigirDono() {
    const { usuario: u } = await chamar('GET', '/auth/me');
    if (!podeEntrar(u.papel)) {
      await sair();
      throw Object.assign(new Error('A retaguarda é só para o dono.'), { codigo: 'SO_DONO' });
    }
    usuario = u;
    return u;
  }

  /** Login por email e senha; quem não é DONO (ou ADMIN) não entra (a sessão aberta é encerrada). */
  async function entrar(email, senha) {
    const r = await enviar('POST', '/auth/login', { corpo: { email, senha } });
    access = r.accessToken;
    gravarRefresh(r.refreshToken);
    if (!podeEntrar(r.usuario?.papel)) {
      await sair();
      throw Object.assign(new Error('A retaguarda é só para o dono.'), { codigo: 'SO_DONO' });
    }
    usuario = r.usuario;
    return usuario;
  }

  /** Ao abrir a página: com refresh salvo, renova e confere o papel. Sem: null. */
  async function restaurar() {
    if (!lerRefresh()) return null;
    try {
      await renovar();
      return await exigirDono();
    } catch (err) {
      if (err instanceof SessaoExpirada || err?.codigo === 'SO_DONO') return null;
      throw err;
    }
  }

  async function sair() {
    const refresh = lerRefresh();
    limpar();
    if (refresh) {
      try {
        await enviar('POST', '/auth/logout', { corpo: { refreshToken: refresh } });
      } catch {
        // sem rede: o refresh expira sozinho (30 dias)
      }
    }
  }

  return {
    entrar,
    restaurar,
    sair,
    chamar,
    renovar,
    get usuario() {
      return usuario;
    },
  };
}
