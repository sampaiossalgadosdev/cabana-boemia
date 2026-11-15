/**
 * Cliente HTTP da API, só no processo main. Guarda o access token na memória
 * e o refresh no armazém cifrado; o renderer nunca vê nenhum dos dois.
 *
 * A API rotaciona o refresh a cada uso e trata reuso como roubo (revoga todas
 * as sessões). Por isso a renovação é single-flight: chamadas simultâneas
 * esperam a MESMA renovação.
 */

const TIMEOUT_MS = 15_000;
/** Renova antes de expirar, para o token não morrer no meio do caminho. */
const MARGEM_MS = 60_000;

export class ErroApi extends Error {
  constructor(status, mensagem, codigo = 'ERRO', detalhes) {
    super(mensagem);
    this.name = 'ErroApi';
    this.status = status;
    this.codigo = codigo;
    this.detalhes = detalhes;
  }
}

/** `exp` (ms) do payload de um JWT, sem verificar a assinatura (quem verifica é a API). */
export function expiracaoDoJwt(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return Number.isFinite(payload.exp) ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

/**
 * @param {{
 *   apiUrl: () => string | null,
 *   armazem: { ler(): Promise<string|null>, guardar(t: string): Promise<void>, apagar(): Promise<void> },
 *   fetch?: typeof fetch,
 *   agora?: () => number,
 *   aoSessaoExpirar?: (erro: ErroApi) => void,
 * }} opcoes
 */
export function criarClienteApi({ apiUrl, armazem, fetch = globalThis.fetch, agora = Date.now, aoSessaoExpirar = () => {} }) {
  let access = null; // { token, expiraEm }
  let usuario = null;
  let renovando = null;

  async function chamar(metodo, rota, { corpo, token } = {}) {
    const base = apiUrl();
    if (!base) throw new ErroApi(0, 'Configure o endereço do servidor', 'SEM_SERVIDOR');
    const headers = { accept: 'application/json' };
    if (corpo !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;

    let res;
    try {
      res = await fetch(`${base}${rota}`, {
        method: metodo,
        headers,
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new ErroApi(0, 'Sem conexão com o servidor', 'SEM_CONEXAO');
    }

    const texto = await res.text().catch(() => '');
    let json = null;
    try {
      json = texto ? JSON.parse(texto) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const e = json?.erro ?? {};
      throw new ErroApi(res.status, e.mensagem ?? `Erro ${res.status} no servidor`, e.codigo ?? 'ERRO', e.detalhes);
    }
    return json;
  }

  function definirAccess(token) {
    access = { token, expiraEm: expiracaoDoJwt(token) };
  }

  async function encerrarLocal() {
    access = null;
    usuario = null;
    await armazem.apagar();
  }

  /** Troca o refresh por um par novo. 401 = sessão morta: limpa e avisa. */
  function renovar() {
    renovando ??= (async () => {
      const refreshToken = await armazem.ler();
      if (!refreshToken) {
        const erro = new ErroApi(401, 'Faça login novamente', 'SESSAO_EXPIRADA');
        await encerrarLocal();
        aoSessaoExpirar(erro);
        throw erro;
      }
      let r;
      try {
        r = await chamar('POST', '/auth/refresh', { corpo: { refreshToken } });
      } catch (err) {
        if (err.status === 401) {
          await encerrarLocal();
          aoSessaoExpirar(err);
        }
        throw err; // sem conexão: mantém o refresh para tentar depois
      }
      await armazem.guardar(r.refreshToken);
      definirAccess(r.accessToken);
      return access.token;
    })().finally(() => {
      renovando = null;
    });
    return renovando;
  }

  /** Access válido por pelo menos mais 1 min; senão renova. */
  async function accessToken() {
    if (access && access.expiraEm - agora() > MARGEM_MS) return access.token;
    return renovar();
  }

  /** Requisição autenticada; um 401 força uma renovação e repete uma vez. */
  async function requisitar(metodo, rota, corpo) {
    const token = await accessToken();
    try {
      return await chamar(metodo, rota, { corpo, token });
    } catch (err) {
      if (err.status !== 401) throw err;
      access = null;
      const novo = await renovar();
      try {
        return await chamar(metodo, rota, { corpo, token: novo });
      } catch (err2) {
        if (err2.status === 401) {
          await encerrarLocal();
          aoSessaoExpirar(err2);
        }
        throw err2;
      }
    }
  }

  return {
    accessToken,
    renovar,
    requisitar,
    usuario: () => usuario,
    logado: () => usuario !== null,

    async entrar(email, senha) {
      const r = await chamar('POST', '/auth/login', { corpo: { email, senha } });
      await armazem.guardar(r.refreshToken);
      definirAccess(r.accessToken);
      usuario = r.usuario;
      return usuario;
    },

    /** Ao abrir: usa o refresh salvo. null = precisa de login. */
    async restaurar() {
      if (!(await armazem.ler())) return null;
      try {
        await renovar();
      } catch (err) {
        if (err.status === 401) return null;
        throw err;
      }
      usuario = (await requisitar('GET', '/auth/me')).usuario;
      return usuario;
    },

    /** Apaga a sessão local na hora; avisar a API é melhor esforço. */
    async sair() {
      const refreshToken = await armazem.ler();
      await encerrarLocal();
      if (refreshToken) {
        await chamar('POST', '/auth/logout', { corpo: { refreshToken } }).catch(() => {});
      }
    },
  };
}
