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
 * - Etapa 5: estornar (total ou parcial, com o token DA LOJA e X-Idempotency-Key) e
 *   erroNoEmailDoPagador (recusa do Pix por causa do e-mail).
 * - Etapa 7 (cartão pelo Checkout Pro): criarPreferencia, buscarPagamentosDoPedido e
 *   expirarPreferencia (com o token DA LOJA).
 *
 * Nunca registra token, code nem client_secret em log; o erro leva só o status HTTP e o
 * código do Mercado Pago (`error`), nunca o corpo inteiro.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const URL_AUTORIZACAO = 'https://auth.mercadopago.com.br/authorization';
export const URL_API = 'https://api.mercadopago.com';
/** Caminho da notificação (webhook) dentro da API; a URL é montada com a origem do MP_REDIRECT_URI. */
export const CAMINHO_WEBHOOK = '/api/mercadopago/webhook';
/** Página de volta do Checkout Pro (back_urls): só manda o cliente de volta ao app, não aprova nada. */
export const CAMINHO_RETORNO_CARTAO = '/api/mercadopago/cartao/retorno';
/**
 * Formas que o Checkout Pro do cartão NÃO oferece (Decisão 2 da Etapa 7): boleto, lotérica/caixa
 * eletrônico e Pix/transferência (o Pix já é oferecido no app). Débito, pré-pago e o saldo
 * Mercado Pago (que não pode ser excluído) continuam. Linha de Crédito: a conferir no teste real.
 */
export const TIPOS_EXCLUIDOS_CARTAO = Object.freeze(['ticket', 'atm', 'bank_transfer']);
const TEMPO_LIMITE_MS = 10_000;

/** Falha numa chamada ao Mercado Pago (rede, tempo esgotado ou resposta recusada). */
export class ErroMercadoPago extends Error {
  /** @param {string} mensagem @param {{ status?: number | null, codigo?: string | null, detalhe?: string | null }} [dados] */
  constructor(mensagem, { status = null, codigo = null, detalhe = null } = {}) {
    super(mensagem);
    this.name = 'ErroMercadoPago';
    this.status = status;
    this.codigo = codigo;
    /** `message` + códigos e descrições do `cause` da resposta (curto, sem e-mail nem números longos). */
    this.detalhe = detalhe;
  }
}

/** Tamanho máximo do detalhe do erro (log e `Pagamento.dadosMp`). */
export const TAMANHO_DETALHE_ERRO = 200;

/**
 * Detalhe de uma recusa do Mercado Pago para o log e o `dadosMp`: o `message` e os `code`/`description`
 * do `cause` (ex.: "Collector user without key enabled for QR render [13253: ...]"). Só esses campos
 * (nunca o corpo inteiro); e-mails e sequências de 6+ dígitos (CPF, telefone, conta) viram "***",
 * por segurança, caso o Mercado Pago repita algum dado do pedido no texto. Até 200 caracteres.
 * @returns {string | null}
 */
export function detalheDoErro(dados) {
  if (!dados || typeof dados !== 'object') return null;
  const partes = [];
  if (typeof dados.message === 'string' && dados.message.trim() && dados.message !== dados.error) partes.push(dados.message.trim());
  const causas = (Array.isArray(dados.cause) ? dados.cause : dados.cause ? [dados.cause] : [])
    .filter((c) => c && typeof c === 'object')
    .map((c) => [c.code, c.description].filter((v) => v != null && String(v).trim() !== '').join(': '))
    .filter(Boolean);
  if (causas.length) partes.push(`[${causas.join('; ')}]`);
  if (!partes.length) return null;
  const limpo = partes
    .join(' ')
    .replace(/[^\s@]+@[^\s@]+/g, '***')
    .replace(/\d{6,}/g, '***')
    .replace(/\s+/g, ' ');
  return limpo.length > TAMANHO_DETALHE_ERRO ? `${limpo.slice(0, TAMANHO_DETALHE_ERRO - 1)}…` : limpo;
}

/**
 * A recusa do Mercado Pago aponta o e-mail do pagador? (Decisão 0 da Etapa 5: foi a causa do
 * erro no teste real.) Olha o `message`/`cause` já limpo (`detalhe`) e o código: "email",
 * "e-mail" ou "payer.email". Os outros erros continuam com a mensagem genérica.
 */
export function erroNoEmailDoPagador(err) {
  if (!(err instanceof ErroMercadoPago)) return false;
  return /e-?mail/i.test(`${err.codigo ?? ''} ${err.detalhe ?? ''}`);
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

/** URL da página de volta do Checkout Pro (mesma origem do MP_REDIRECT_URI). Sem ela = null. */
export function urlDeRetornoCartao(config = configMercadoPago()) {
  try {
    return `${new URL(config.redirectUri).origin}${CAMINHO_RETORNO_CARTAO}`;
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
 *   comissaoCentavos: number | null, valorReembolsadoCentavos: number, referenciaExterna: string | null, collectorId: string | null,
 *   tipo: string | null, metodo: string | null,
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
    // Cartão: tipo (credit_card, debit_card, prepaid_card, account_money…) e bandeira; nada do cartão.
    tipo: typeof dados.payment_type_id === 'string' ? dados.payment_type_id : null,
    metodo: typeof dados.payment_method_id === 'string' ? dados.payment_method_id : null,
    qrCode: typeof tx.qr_code === 'string' ? tx.qr_code : null,
    qrCodeBase64: typeof tx.qr_code_base64 === 'string' ? tx.qr_code_base64 : null,
    expiraEm: typeof dados.date_of_expiration === 'string' ? dados.date_of_expiration : null,
    aprovadoEm: typeof dados.date_approved === 'string' ? dados.date_approved : null,
    // Quanto já voltou ao comprador (estorno total ou parcial; feito por nós ou direto no Mercado Pago).
    valorReembolsadoCentavos: emCentavos(dados.transaction_amount_refunded) ?? 0,
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
        detalhe: detalheDoErro(dados),
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

    /**
     * Estorno de um pagamento aprovado (POST /v1/payments/{id}/refunds) na conta DA LOJA.
     * Sem `valorCentavos` = total; com ele = parcial (`amount` em reais). A chave de
     * idempotência é da tentativa (uma nova tentativa usa outra chave).
     * @returns {Promise<{ id: string, status: string | null, valorCentavos: number | null }>}
     */
    async estornar(accessToken, paymentId, { valorCentavos = null, idempotencyKey }) {
      const corpo = valorCentavos == null ? {} : { amount: emReais(valorCentavos) };
      const dados = await chamarPagamentos('POST', `/v1/payments/${encodeURIComponent(paymentId)}/refunds`, accessToken, {
        corpo,
        idempotencyKey,
      });
      if (dados?.id == null) throw new ErroMercadoPago('Resposta do Mercado Pago sem estorno', { codigo: 'RESPOSTA_INVALIDA' });
      return {
        id: String(dados.id),
        status: typeof dados.status === 'string' ? dados.status : null,
        valorCentavos: emCentavos(dados.amount),
      };
    },

    /**
     * Preferência do Checkout Pro para o cartão (POST /checkout/preferences) na conta DA LOJA.
     * Um item só com o total (Decisão 1 da Etapa 7); `marketplace_fee` = a comissão (zero =
     * omitido); à vista (`installments: 1`); `binary_mode` (só aprovado ou recusado); vigência
     * até `expiraEm` (15 min); volta para a página da API (`back_urls`, `auto_return`).
     * @param {string} accessToken token da loja
     * @param {{ valorCentavos: number, comissaoCentavos: number, pedidoId: number, titulo: string, email: string,
     *   agora: Date, expiraEm: Date, idempotencyKey: string, notificacao?: string | null, retorno?: string | null }} dados
     * @returns {Promise<{ id: string, checkoutUrl: string }>}
     */
    async criarPreferencia(
      accessToken,
      { valorCentavos, comissaoCentavos, pedidoId, titulo, email, agora, expiraEm, idempotencyKey, notificacao = urlDeNotificacao(config), retorno = urlDeRetornoCartao(config) },
    ) {
      const corpo = {
        items: [{ id: String(pedidoId), title: String(titulo).slice(0, 250), quantity: 1, currency_id: 'BRL', unit_price: emReais(valorCentavos) }],
        payer: { email },
        external_reference: String(pedidoId),
        binary_mode: true,
        expires: true,
        expiration_date_from: dataComFusoBrasilia(new Date(agora.getTime() - 60_000)),
        expiration_date_to: dataComFusoBrasilia(expiraEm),
        payment_methods: {
          installments: 1,
          default_installments: 1,
          excluded_payment_types: TIPOS_EXCLUIDOS_CARTAO.map((id) => ({ id })),
        },
        ...(retorno && { back_urls: { success: retorno, pending: retorno, failure: retorno }, auto_return: 'approved' }),
        ...(notificacao && { notification_url: notificacao }),
        ...(comissaoCentavos > 0 && { marketplace_fee: emReais(comissaoCentavos) }),
      };
      const dados = await chamarPagamentos('POST', '/checkout/preferences', accessToken, { corpo, idempotencyKey });
      if (dados?.id == null || typeof dados.init_point !== 'string') {
        throw new ErroMercadoPago('Resposta do Mercado Pago sem preferência', { codigo: 'RESPOSTA_INVALIDA' });
      }
      return { id: String(dados.id), checkoutUrl: dados.init_point };
    },

    /** Encerra a vigência da preferência agora (desistência, loja desconectando): ninguém paga mais nela. */
    async expirarPreferencia(accessToken, preferenciaId, agora = new Date()) {
      await chamarPagamentos('PUT', `/checkout/preferences/${encodeURIComponent(preferenciaId)}`, accessToken, {
        corpo: { expires: true, expiration_date_to: dataComFusoBrasilia(agora) },
      });
    },

    /**
     * Pagamentos do pedido na conta DA LOJA (GET /v1/payments/search por external_reference), o
     * mais novo primeiro. No Checkout Pro o id do pagamento só existe depois que o cliente paga:
     * é assim que a consulta do app e a rotina acham o pagamento quando o webhook não chegou.
     */
    async buscarPagamentosDoPedido(accessToken, pedidoId) {
      const q = new URLSearchParams({ external_reference: String(pedidoId), sort: 'date_created', criteria: 'desc', limit: '20' });
      const dados = await chamarPagamentos('GET', `/v1/payments/search?${q}`, accessToken);
      const lista = Array.isArray(dados?.results) ? dados.results : [];
      return lista.filter((p) => p?.id != null && typeof p.status === 'string').map(pagamentoNormalizado);
    },

    /** Cancela um Pix ainda pendente (o Mercado Pago só cancela pending/in_process). */
    async cancelarPagamento(accessToken, paymentId) {
      return pagamentoNormalizado(
        await chamarPagamentos('PUT', `/v1/payments/${encodeURIComponent(paymentId)}`, accessToken, { corpo: { status: 'cancelled' } }),
      );
    },
  };
}
