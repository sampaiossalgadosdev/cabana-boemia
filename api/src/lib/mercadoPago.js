/**
 * ÚNICO ponto de saída para a API do Mercado Pago (Decisão 1 da Etapa 3 em
 * docs/pagamento-online.md). Nenhum outro arquivo da API chama o Mercado Pago direto:
 * a API de Payments (/v1/payments) aparece no painel como "será descontinuada em breve",
 * e uma migração para a API de Orders deve mexer só aqui. `test/mercado-pago.test.js`
 * confere que nenhum outro arquivo de src/ fala com mercadopago.com.
 *
 * Funções nossas, com nomes nossos e respostas já normalizadas:
 * - Etapa 3 (OAuth da loja): montarUrlAutorizacao, trocarCodePorToken, renovarToken.
 * - Etapa 4 (Pix): criarPix, consultarPagamento, cancelarPagamento (com o token DA LOJA) e
 *   validarAssinaturaWebhook (x-signature com MP_WEBHOOK_SECRET).
 * - Próximas: estornar, criarPreferencia.
 *
 * Nunca registra token, code nem client_secret em log; o erro leva só o status HTTP e o
 * código do Mercado Pago (`error`), nunca o corpo inteiro.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const URL_AUTORIZACAO = 'https://auth.mercadopago.com.br/authorization';
export const URL_API = 'https://api.mercadopago.com';
/** Caminho da notificação (webhook) dentro da API; a URL é montada com a origem do MP_REDIRECT_URI. */
export const CAMINHO_WEBHOOK = '/api/mercadopago/webhook';
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

/**
 * URL de notificação dos pagamentos (Decisão 8 da Etapa 4): a origem do MP_REDIRECT_URI +
 * /api/mercadopago/webhook. `source_news=webhooks` pede só o formato novo (sem o IPN antigo).
 * Sem MP_REDIRECT_URI válido = null.
 */
export function urlDeNotificacao(config = configMercadoPago()) {
  try {
    const { origin } = new URL(config.redirectUri);
    return `${origin}${CAMINHO_WEBHOOK}?source_news=webhooks`;
  } catch {
    return null;
  }
}

/** Centavos → reais com 2 casas (o Mercado Pago recebe número em reais). */
const emReais = (centavos) => Math.round(centavos) / 100;
/** Reais → centavos (arredondado: 12.3 → 1230). */
const emCentavos = (reais) => (typeof reais === 'number' && Number.isFinite(reais) ? Math.round(reais * 100) : null);

/**
 * Comissão do marketplace como o Mercado Pago informou: `fee_details` com o tipo
 * `application_fee` (somados) ou o campo `application_fee`. Ausente = null (não informado).
 */
function comissaoInformada(dados) {
  const taxas = Array.isArray(dados?.fee_details) ? dados.fee_details.filter((f) => f?.type === 'application_fee') : [];
  if (taxas.length) return taxas.reduce((s, f) => s + (emCentavos(f.amount) ?? 0), 0);
  return emCentavos(dados?.application_fee);
}

/**
 * Pagamento do Mercado Pago no nosso formato (só o que usamos; nada do pagador).
 * @returns {{ id: string, status: string, statusDetail: string | null, valorCentavos: number | null,
 *   comissaoCentavos: number | null, referenciaExterna: string | null, collectorId: string | null,
 *   qrCode: string | null, qrCodeBase64: string | null, expiraEm: string | null, aprovadoEm: string | null }}
 */
export function pagamentoNormalizado(dados) {
  if (dados?.id == null || typeof dados.status !== 'string') {
    throw new ErroMercadoPago('Resposta do Mercado Pago sem pagamento', { codigo: 'RESPOSTA_INVALIDA' });
  }
  const tx = dados.point_of_interaction?.transaction_data ?? {};
  return {
    id: String(dados.id),
    status: dados.status,
    statusDetail: typeof dados.status_detail === 'string' ? dados.status_detail : null,
    valorCentavos: emCentavos(dados.transaction_amount),
    comissaoCentavos: comissaoInformada(dados),
    referenciaExterna: dados.external_reference != null ? String(dados.external_reference) : null,
    collectorId: dados.collector_id != null ? String(dados.collector_id) : null,
    qrCode: typeof tx.qr_code === 'string' ? tx.qr_code : null,
    qrCodeBase64: typeof tx.qr_code_base64 === 'string' ? tx.qr_code_base64 : null,
    expiraEm: typeof dados.date_of_expiration === 'string' ? dados.date_of_expiration : null,
    aprovadoEm: typeof dados.date_approved === 'string' ? dados.date_approved : null,
  };
}

/** "2026-11-27T12:30:00.000-03:00": data com fuso, como o Mercado Pago aceita. */
export function dataComFusoBrasilia(data) {
  const local = new Date(data.getTime() - 3 * 60 * 60 * 1000);
  return `${local.toISOString().slice(0, 23)}-03:00`;
}

/**
 * Assinatura da notificação (cabeçalho `x-signature: ts=…,v1=…`): HMAC-SHA256 (hex) com
 * MP_WEBHOOK_SECRET do manifesto `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`. O
 * `data.id` vai em minúsculas; a parte que não veio sai do manifesto. Comparação em tempo
 * constante. Sem segredo = sempre inválida.
 * @param {{ assinatura?: string, requestId?: string, dataId?: string | number | null, segredo?: string }} dados
 */
export function validarAssinaturaWebhook({ assinatura, requestId, dataId, segredo }) {
  if (!segredo || typeof assinatura !== 'string') return false;
  const partes = Object.fromEntries(
    assinatura.split(',').map((p) => {
      const [k, ...v] = p.split('=');
      return [k.trim(), v.join('=').trim()];
    }),
  );
  if (!partes.ts || !/^[0-9a-f]{64}$/i.test(partes.v1 ?? '')) return false;
  const esperado = createHmac('sha256', segredo).update(manifestoDoWebhook({ requestId, dataId, ts: partes.ts })).digest();
  const recebido = Buffer.from(partes.v1, 'hex');
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}

/** Texto assinado pelo Mercado Pago (exportado para os testes montarem notificações). */
export function manifestoDoWebhook({ requestId, dataId, ts }) {
  let manifesto = '';
  if (dataId != null && String(dataId) !== '') manifesto += `id:${String(dataId).toLowerCase()};`;
  if (requestId) manifesto += `request-id:${requestId};`;
  return `${manifesto}ts:${ts};`;
}

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

  /** Chamada à API de pagamentos com o token DA LOJA. Erro = ErroMercadoPago (status + `error`/`message`). */
  async function chamarPagamentos(metodo, caminho, accessToken, { corpo, idempotencyKey } = {}) {
    if (!accessToken) throw new ErroMercadoPago('Loja sem token do Mercado Pago', { codigo: 'SEM_TOKEN' });
    let res;
    try {
      res = await buscar(`${URL_API}${caminho}`, {
        method: metodo,
        headers: {
          authorization: `Bearer ${accessToken}`,
          accept: 'application/json',
          ...(corpo !== undefined && { 'content-type': 'application/json' }),
          ...(idempotencyKey && { 'x-idempotency-key': idempotencyKey }),
        },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
        signal: AbortSignal.timeout(tempoLimiteMs),
      });
    } catch (err) {
      throw new ErroMercadoPago('Mercado Pago fora do ar ou sem resposta', { codigo: err?.name === 'TimeoutError' ? 'TEMPO_ESGOTADO' : 'REDE' });
    }
    const dados = await res.json().catch(() => null);
    if (!res.ok) {
      const bruto = dados?.error ?? dados?.message;
      throw new ErroMercadoPago(`Mercado Pago recusou (${res.status})`, {
        status: res.status,
        codigo: typeof bruto === 'string' ? bruto.slice(0, 60) : null,
      });
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

    /**
     * Cria o Pix do pedido na conta DA LOJA (Checkout Transparente, POST /v1/payments).
     * `comissaoCentavos` = application_fee (o split da plataforma); zero = campo omitido.
     * `expiraEm`: date_of_expiration (o Mercado Pago exige no mínimo 30 minutos).
     * @param {string} accessToken token da loja (decifrado só para a chamada)
     * @param {{ valorCentavos: number, comissaoCentavos: number, pedidoId: number, descricao: string,
     *   email: string, expiraEm: Date, idempotencyKey: string, notificacao?: string | null }} dados
     */
    async criarPix(accessToken, { valorCentavos, comissaoCentavos, pedidoId, descricao, email, expiraEm, idempotencyKey, notificacao = urlDeNotificacao(config) }) {
      const corpo = {
        transaction_amount: emReais(valorCentavos),
        payment_method_id: 'pix',
        description: String(descricao).slice(0, 250),
        external_reference: String(pedidoId),
        date_of_expiration: dataComFusoBrasilia(expiraEm),
        payer: { email },
        ...(notificacao && { notification_url: notificacao }),
        ...(comissaoCentavos > 0 && { application_fee: emReais(comissaoCentavos) }),
      };
      return pagamentoNormalizado(await chamarPagamentos('POST', '/v1/payments', accessToken, { corpo, idempotencyKey }));
    },

    /** Situação do pagamento (a fonte da verdade: o webhook só avisa que algo mudou). */
    async consultarPagamento(accessToken, paymentId) {
      return pagamentoNormalizado(await chamarPagamentos('GET', `/v1/payments/${encodeURIComponent(paymentId)}`, accessToken));
    },

    /** Cancela um Pix ainda pendente (o Mercado Pago só cancela pending/in_process). */
    async cancelarPagamento(accessToken, paymentId) {
      return pagamentoNormalizado(
        await chamarPagamentos('PUT', `/v1/payments/${encodeURIComponent(paymentId)}`, accessToken, { corpo: { status: 'cancelled' } }),
      );
    },
  };
}
