/**
 * ÚNICO ponto de saída para a API do Mercado Pago (Decisão 1 da Etapa 3 em
 * docs/pagamento-online.md). Nenhum outro arquivo da API chama o Mercado Pago direto:
 * a API de Payments (/v1/payments) aparece no painel como "será descontinuada em breve",
 * e uma migração para a API de Orders deve mexer só aqui. `test/mercado-pago.test.js`
 * confere que nenhum outro arquivo de src/ fala com mercadopago.com.
 *
 * Funções nossas, com nomes nossos e respostas já normalizadas:
 * - Etapa 3 (OAuth da loja): montarUrlAutorizacao, trocarCodePorToken, renovarToken.
 * - Próximas: criarPix, consultarPagamento, cancelarPagamento, estornar, criarPreferencia.
 *
 * Nunca registra token, code nem client_secret em log; o erro leva só o status HTTP e o
 * código do Mercado Pago (`error`), nunca o corpo inteiro.
 */

export const URL_AUTORIZACAO = 'https://auth.mercadopago.com.br/authorization';
export const URL_API = 'https://api.mercadopago.com';
const TEMPO_LIMITE_MS = 10_000;

/** Falha numa chamada ao Mercado Pago (rede, tempo esgotado ou resposta recusada). */
export class ErroMercadoPago extends Error {
  /** @param {string} mensagem @param {{ status?: number | null, codigo?: string | null }} [dados] */
  constructor(mensagem, { status = null, codigo = null } = {}) {
    super(mensagem);
    this.name = 'ErroMercadoPago';
    this.status = status;
    this.codigo = codigo;
  }
}

/** Credenciais do aplicativo (marketplace) no Mercado Pago, lidas do ambiente. */
export function configMercadoPago(env = process.env) {
  const limpo = (v) => String(v ?? '').trim();
  return { clientId: limpo(env.MP_CLIENT_ID), clientSecret: limpo(env.MP_CLIENT_SECRET), redirectUri: limpo(env.MP_REDIRECT_URI) };
}

export const mercadoPagoConfigurado = (config) => Boolean(config.clientId && config.clientSecret && config.redirectUri);

/** Resposta do /oauth/token no nosso formato (`expiraEm` = agora + expires_in). */
function tokenNormalizado(dados, agora) {
  if (!dados?.access_token || dados.user_id == null) {
    throw new ErroMercadoPago('Resposta do Mercado Pago sem token', { codigo: 'RESPOSTA_INVALIDA' });
  }
  const segundos = Number(dados.expires_in);
  return {
    accessToken: String(dados.access_token),
    refreshToken: dados.refresh_token ? String(dados.refresh_token) : null,
    publicKey: dados.public_key ? String(dados.public_key) : null,
    mpUserId: String(dados.user_id),
    expiraEm: Number.isFinite(segundos) && segundos > 0 ? new Date(agora.getTime() + segundos * 1000) : null,
  };
}

/**
 * @param {{ fetch?: typeof fetch, config?: ReturnType<typeof configMercadoPago>, tempoLimiteMs?: number }} [opcoes]
 */
export function criarClienteMercadoPago({ fetch: buscar = globalThis.fetch, config = configMercadoPago(), tempoLimiteMs = TEMPO_LIMITE_MS } = {}) {
  async function postarToken(corpo) {
    let res;
    try {
      res = await buscar(`${URL_API}/oauth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, ...corpo }),
        signal: AbortSignal.timeout(tempoLimiteMs),
      });
    } catch (err) {
      throw new ErroMercadoPago('Mercado Pago fora do ar ou sem resposta', { codigo: err?.name === 'TimeoutError' ? 'TEMPO_ESGOTADO' : 'REDE' });
    }
    const dados = await res.json().catch(() => null);
    if (!res.ok) {
      const codigo = typeof dados?.error === 'string' ? dados.error.slice(0, 60) : null;
      throw new ErroMercadoPago(`Mercado Pago recusou (${res.status})`, { status: res.status, codigo });
    }
    return dados;
  }

  return {
    /** URL para o dono autorizar a plataforma na conta Mercado Pago da loja. */
    montarUrlAutorizacao(state) {
      const url = new URL(URL_AUTORIZACAO);
      url.searchParams.set('client_id', config.clientId);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('platform_id', 'mp');
      url.searchParams.set('redirect_uri', config.redirectUri);
      url.searchParams.set('state', state);
      return url.toString();
    },

    /** Troca o code do retorno do OAuth pelos tokens da loja. */
    async trocarCodePorToken(code, agora = new Date()) {
      const dados = await postarToken({ grant_type: 'authorization_code', code, redirect_uri: config.redirectUri });
      return tokenNormalizado(dados, agora);
    },

    /** Renova o access token; o Mercado Pago devolve também um refresh token NOVO. */
    async renovarToken(refreshToken, agora = new Date()) {
      const dados = await postarToken({ grant_type: 'refresh_token', refresh_token: refreshToken });
      return tokenNormalizado(dados, agora);
    },
  };
}
