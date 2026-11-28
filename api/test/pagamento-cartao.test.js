/**
 * Etapa 7 do pagamento online (docs/pagamento-online.md): cartão pelo Checkout Pro. Mercado Pago
 * sempre FALSO aqui. Preferência (comissão, 15 minutos, à vista, exclusões), aprovação só pelo
 * webhook ou pela consulta (a página de volta não aprova), recusa sem encerrar o pedido,
 * desistência, expiração, estorno, tipo real do cartão e relatório.
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { semBancoDeTeste, resetarBancoDeTeste, criarBairro } from './helpers/banco.js';
import { criarClienteMercadoPago, manifestoDoWebhook, urlDeRetornoCartao, TIPOS_EXCLUIDOS_CARTAO } from '../src/lib/mercadoPago.js';
import { mensagemDaRecusa, tipoDoPagamento, MENSAGEM_RECUSA_PADRAO } from '../src/lib/cartaoOnline.js';
import { pagoOnlinePorMeio } from '../src/services/relatorio.service.js';

const CHAVE_HEX = 'cd'.repeat(32);
const SEGREDO_WEBHOOK = 'segredo-do-webhook-do-cartao';
const TOKEN_LOJA = 'APP_USR-token-da-loja-cartao';
const CONTA_MP = '888000';
const SABADO_20H = new Date('2026-11-14T20:00:00-03:00');
const PINO_LOJA = { latitude: -23.3049, longitude: -50.3133 };
const PINO_CLIENTE = { latitude: -23.31, longitude: -50.32 };
const DISTANCIA = 3200; // R$ 1,00 + 0,90 × 6,4 km = R$ 6,76
const QUINZE_MIN = 15 * 60 * 1000;

/** ts da assinatura (segundos) no relógio do teste: o webhook recusa ts a mais de 10 min. */
const tsDe = (instante) => String(Math.floor(instante.getTime() / 1000));

function assinar({ dataId, requestId, ts = '1732700000' }) {
  const v1 = createHmac('sha256', SEGREDO_WEBHOOK).update(manifestoDoWebhook({ dataId, requestId, ts })).digest('hex');
  return `ts=${ts},v1=${v1}`;
}

describe('módulo do Mercado Pago: preferência do Checkout Pro e busca do pedido', () => {
  const config = { clientId: 'APP', clientSecret: 'x', redirectUri: 'https://api.taakidelivery.com.br/api/mercadopago/oauth/retorno' };

  function fetchFalso(resposta) {
    const chamadas = [];
    const fetch = async (url, opcoes) => {
      chamadas.push({ url, metodo: opcoes.method, headers: opcoes.headers, corpo: opcoes.body ? JSON.parse(opcoes.body) : undefined });
      return new Response(JSON.stringify(resposta), { status: 200 });
    };
    return { fetch, chamadas };
  }

  const dados = (extra = {}) => ({
    valorCentavos: 3426,
    comissaoCentavos: 676,
    pedidoId: 42,
    titulo: 'Pedido na Cabana Boemia',
    email: 'cliente@teste.com',
    agora: new Date('2026-11-14T23:00:00Z'),
    expiraEm: new Date('2026-11-14T23:15:00Z'),
    idempotencyKey: 'chave-1',
    ...extra,
  });

  test('criarPreferencia: token da loja, um item com o total, comissão, 15 minutos, à vista, exclusões e volta', async () => {
    const f = fetchFalso({ id: 'pref-1', init_point: 'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=pref-1' });
    const r = await criarClienteMercadoPago({ config, fetch: f.fetch }).criarPreferencia(TOKEN_LOJA, dados());
    assert.deepEqual(r, { id: 'pref-1', checkoutUrl: 'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=pref-1' });
    const c = f.chamadas[0];
    assert.equal(c.url, 'https://api.mercadopago.com/checkout/preferences');
    assert.equal(c.metodo, 'POST');
    assert.equal(c.headers.authorization, `Bearer ${TOKEN_LOJA}`);
    assert.equal(c.headers['x-idempotency-key'], 'chave-1');
    const retorno = 'https://api.taakidelivery.com.br/api/mercadopago/cartao/retorno';
    assert.deepEqual(c.corpo, {
      items: [{ id: '42', title: 'Pedido na Cabana Boemia', quantity: 1, currency_id: 'BRL', unit_price: 34.26 }],
      payer: { email: 'cliente@teste.com' },
      external_reference: '42',
      binary_mode: true,
      expires: true,
      expiration_date_from: '2026-11-14T19:59:00.000-03:00',
      expiration_date_to: '2026-11-14T20:15:00.000-03:00',
      payment_methods: {
        installments: 1,
        default_installments: 1,
        excluded_payment_types: [{ id: 'ticket' }, { id: 'atm' }, { id: 'bank_transfer' }],
      },
      back_urls: { success: retorno, pending: retorno, failure: retorno },
      auto_return: 'approved',
      notification_url: 'https://api.taakidelivery.com.br/api/mercadopago/webhook?source_news=webhooks',
      marketplace_fee: 6.76,
    });
    // Débito e pré-pago continuam (Decisão 2 da Etapa 7); o saldo Mercado Pago não pode ser excluído.
    assert.ok(!TIPOS_EXCLUIDOS_CARTAO.includes('debit_card'));
    assert.ok(!TIPOS_EXCLUIDOS_CARTAO.includes('prepaid_card'));
    assert.equal(urlDeRetornoCartao({ redirectUri: '' }), null);
  });

  test('comissão zero: marketplace_fee omitido; resposta sem init_point = erro', async () => {
    const f = fetchFalso({ id: 'pref-2', init_point: 'https://x' });
    await criarClienteMercadoPago({ config, fetch: f.fetch }).criarPreferencia(TOKEN_LOJA, dados({ comissaoCentavos: 0 }));
    assert.equal('marketplace_fee' in f.chamadas[0].corpo, false);
    const sem = fetchFalso({ id: 'pref-3' });
    await assert.rejects(() => criarClienteMercadoPago({ config, fetch: sem.fetch }).criarPreferencia(TOKEN_LOJA, dados()), (e) => e.codigo === 'RESPOSTA_INVALIDA');
  });

  test('busca do pedido e fim da vigência', async () => {
    const f = fetchFalso({
      results: [
        { id: 2, status: 'approved', transaction_amount: 10, external_reference: '42', payment_type_id: 'debit_card', payment_method_id: 'debelo', collector_id: 5 },
        { id: 1, status: 'rejected', status_detail: 'cc_rejected_insufficient_amount', transaction_amount: 10, external_reference: '42' },
      ],
      paging: { total: 2 },
    });
    const mp = criarClienteMercadoPago({ config, fetch: f.fetch });
    const lista = await mp.buscarPagamentosDoPedido(TOKEN_LOJA, 42);
    const url = new URL(f.chamadas[0].url);
    assert.equal(url.pathname, '/v1/payments/search');
    assert.equal(url.searchParams.get('external_reference'), '42');
    assert.equal(url.searchParams.get('sort'), 'date_created');
    assert.equal(url.searchParams.get('criteria'), 'desc');
    assert.equal(lista.length, 2);
    assert.equal(lista[0].tipo, 'debit_card');
    assert.equal(lista[0].collectorId, '5');
    assert.equal(lista[1].statusDetail, 'cc_rejected_insufficient_amount');
    await mp.expirarPreferencia(TOKEN_LOJA, 'pref-1', new Date('2026-11-14T23:05:00Z'));
    assert.equal(f.chamadas[1].metodo, 'PUT');
    assert.equal(f.chamadas[1].url, 'https://api.mercadopago.com/checkout/preferences/pref-1');
    assert.deepEqual(f.chamadas[1].corpo, { expires: true, expiration_date_to: '2026-11-14T20:05:00.000-03:00' });
  });
});

test('cartão: motivo da recusa em português e tipo real → forma e tipo gravados', () => {
  assert.equal(mensagemDaRecusa('cc_rejected_insufficient_amount'), 'Saldo ou limite insuficiente no cartão.');
  assert.equal(mensagemDaRecusa('cc_rejected_algo_novo'), MENSAGEM_RECUSA_PADRAO);
  assert.equal(mensagemDaRecusa(null), MENSAGEM_RECUSA_PADRAO);
  assert.deepEqual(tipoDoPagamento('credit_card'), { tipo: 'CREDITO', forma: 'CREDITO' });
  assert.deepEqual(tipoDoPagamento('debit_card'), { tipo: 'DEBITO', forma: 'DEBITO' });
  assert.deepEqual(tipoDoPagamento('prepaid_card'), { tipo: 'PRE_PAGO', forma: 'DEBITO' });
  assert.deepEqual(tipoDoPagamento('account_money'), { tipo: 'SALDO_MERCADO_PAGO', forma: 'CREDITO' });
  assert.deepEqual(tipoDoPagamento('digital_currency'), { tipo: 'OUTRO', forma: 'CREDITO' });
  assert.deepEqual(tipoDoPagamento(null), { tipo: 'CREDITO', forma: 'CREDITO' });
});

test('relatório: pago online por meio, com o cartão por tipo', () => {
  const g = (meioOnline, tipoPagamentoOnline, q, t) => ({ meioOnline, tipoPagamentoOnline, _count: { _all: q }, _sum: { totalCentavos: t } });
  const r = pagoOnlinePorMeio([g('PIX', null, 2, 5000), g('CARTAO_ONLINE', 'DEBITO', 1, 3000), g('CARTAO_ONLINE', 'CREDITO', 2, 4000), g('CARTAO_ONLINE', null, 1, 1000)]);
  assert.deepEqual(r, [
    { meio: 'PIX', quantidade: 2, totalCentavos: 5000 },
    {
      meio: 'CARTAO_ONLINE',
      quantidade: 4,
      totalCentavos: 8000,
      porTipo: [
        { tipo: 'CREDITO', quantidade: 3, totalCentavos: 5000 },
        { tipo: 'DEBITO', quantidade: 1, totalCentavos: 3000 },
      ],
    },
  ]);
  assert.deepEqual(pagoOnlinePorMeio([]), [
    { meio: 'PIX', quantidade: 0, totalCentavos: 0 },
    { meio: 'CARTAO_ONLINE', quantidade: 0, totalCentavos: 0, porTipo: [] },
  ]);
});

describe('cartão pelo Checkout Pro na API', { skip: semBancoDeTeste }, () => {
  let prisma;
  let servidor;
  let base;
  let tkEquipe;
  let produto;
  let centro;
  let agora = SABADO_20H;
  let pagamentos;
  let eventos = [];
  const avisos = [];
  let pararEventos;
  const ENV_ANTES = {};
  const ENV = {
    PAGAMENTO_ONLINE_ATIVO: 'sim',
    TOKEN_ENCRYPTION_KEY: CHAVE_HEX,
    MP_WEBHOOK_SECRET: SEGREDO_WEBHOOK,
    CAMPANHA_TELEFONE_SECRET: 'campanha-de-teste-com-mais-de-32-caracteres!',
    MP_CLIENT_ID: 'APP',
    MP_CLIENT_SECRET: 'segredo',
    MP_REDIRECT_URI: 'https://api.taakidelivery.com.br/api/mercadopago/oauth/retorno',
    MP_STATE_SECRET: 'state-de-teste-com-mais-de-32-caracteres!!',
  };

  /**
   * Mercado Pago falso: preferências e os pagamentos feitos nelas (o "cliente" paga com `pagar`).
   * `collector` = conta que recebe (a da loja, por padrão).
   */
  const mp = {
    chamadas: [],
    preferencias: new Map(),
    pagamentos: new Map(),
    proximoId: 5000,
    falhar: null,
    async criarPreferencia(token, dados) {
      mp.chamadas.push({ tipo: 'criarPreferencia', token, dados });
      if (mp.falhar) throw mp.falhar;
      const existente = [...mp.preferencias.values()].find((p) => p.chave === dados.idempotencyKey);
      if (existente) return { id: existente.id, checkoutUrl: existente.checkoutUrl };
      const id = `pref-${mp.proximoId++}`;
      const pref = { id, chave: dados.idempotencyKey, dados, checkoutUrl: `https://mp.teste/checkout?pref_id=${id}` };
      mp.preferencias.set(id, pref);
      return { id, checkoutUrl: pref.checkoutUrl };
    },
    async expirarPreferencia(token, id) {
      mp.chamadas.push({ tipo: 'expirarPreferencia', token, id });
    },
    async buscarPagamentosDoPedido(token, pedidoId) {
      mp.chamadas.push({ tipo: 'buscar', token, pedidoId });
      return [...mp.pagamentos.values()]
        .filter((p) => p.referenciaExterna === String(pedidoId))
        .sort((a, b) => Number(b.id) - Number(a.id))
        .map((p) => ({ ...p }));
    },
    async consultarPagamento(token, id) {
      mp.chamadas.push({ tipo: 'consultar', token, id });
      const p = mp.pagamentos.get(String(id));
      if (!p) throw new Error('não encontrado');
      return { ...p };
    },
    async estornar(token, id, dados) {
      mp.chamadas.push({ tipo: 'estornar', token, id, dados });
      const p = mp.pagamentos.get(String(id));
      Object.assign(p, { status: 'refunded', valorReembolsadoCentavos: p.valorCentavos });
      return { id: `r-${id}`, status: 'approved', valorCentavos: null };
    },
    async cancelarPagamento(token, id) {
      mp.chamadas.push({ tipo: 'cancelar', token, id });
      return { ...mp.pagamentos.get(String(id)) };
    },
    /** O cliente paga no Checkout Pro: um pagamento novo (id do Mercado Pago) na preferência do pedido. */
    pagar(pedidoId, { status = 'approved', statusDetail = 'accredited', tipo = 'credit_card', valorCentavos, comissaoCentavos, collector = CONTA_MP } = {}) {
      const pref = [...mp.preferencias.values()].find((p) => p.dados.pedidoId === pedidoId);
      const id = String(mp.proximoId++);
      mp.pagamentos.set(id, {
        id,
        status,
        statusDetail,
        tipo,
        metodo: tipo === 'credit_card' ? 'master' : 'debelo',
        valorCentavos: valorCentavos ?? pref.dados.valorCentavos,
        comissaoCentavos: comissaoCentavos === undefined ? (pref.dados.comissaoCentavos > 0 ? pref.dados.comissaoCentavos : null) : comissaoCentavos,
        valorReembolsadoCentavos: 0,
        referenciaExterna: String(pedidoId),
        collectorId: collector,
        aprovadoEm: status === 'approved' ? agora.toISOString() : null,
      });
      return id;
    },
  };
  const chamadasDe = (tipo) => mp.chamadas.filter((c) => c.tipo === tipo);

  const mapas = {
    async distanciaDoPedido({ loja, destino }) {
      const campos = {
        latitudeLoja: loja?.latitude ?? null,
        longitudeLoja: loja?.longitude ?? null,
        latitudeEntrega: destino?.latitude ?? null,
        longitudeEntrega: destino?.longitude ?? null,
        distanciaMetros: null,
        distanciaOrigem: null,
      };
      return loja && destino ? { ...campos, distanciaMetros: DISTANCIA, distanciaOrigem: 'ROTA' } : campos;
    },
  };

  async function api(metodo, rota, { token, corpo, headers = {}, texto = false } = {}) {
    const res = await fetch(`${base}${rota}`, {
      method: metodo,
      headers: {
        ...(token && { authorization: `Bearer ${token}` }),
        ...(corpo !== undefined && { 'content-type': 'application/json' }),
        ...headers,
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const bruto = await res.text();
    return { status: res.status, headers: res.headers, corpo: texto ? bruto : bruto ? JSON.parse(bruto) : null };
  }

  let seq = 0;
  async function novoCliente({ email = `cartao${++seq}@teste.com` } = {}) {
    const { gerarTokenCliente } = await import('../src/lib/tokens.js');
    const cliente = await prisma.cliente.create({
      data: { nome: `Cliente ${seq}`, email, telefone: `4398${String(100000 + ++seq * 7).slice(-6)}0`.slice(0, 11) },
    });
    const endereco = await prisma.endereco.create({
      data: { clienteId: cliente.id, rua: 'Rua A', numero: '10', bairroId: centro.id, principal: true, ...PINO_CLIENTE },
    });
    return { cliente, endereco, token: gerarTokenCliente(cliente) };
  }

  const itens = () => [{ produtoId: produto.id, quantidade: 1 }];

  /** Pedido com cartão pelo app, com o total da prévia (o que o app faz). */
  async function pedirComCartao(c, extra = {}) {
    const p = await api('POST', '/cliente/pedidos/previa', { token: c.token, corpo: { itens: itens(), enderecoId: c.endereco.id, origem: 'APP' } });
    assert.equal(p.status, 200, JSON.stringify(p.corpo));
    assert.ok(p.corpo.previa.formasPagamento.online.includes('CARTAO_ONLINE'));
    return api('POST', '/cliente/pedidos', {
      token: c.token,
      corpo: { itens: itens(), enderecoId: c.endereco.id, totalEsperadoCentavos: p.corpo.previa.totalCentavos, origem: 'APP', pagamentoOnline: 'CARTAO', ...extra },
    });
  }

  const situacao = (c, id) => api('GET', `/cliente/pedidos/${id}/pagamento`, { token: c.token });
  const pedidoNoBanco = (id) => prisma.pedido.findUnique({ where: { id }, include: { pagamentos: true, impressoes: true } });
  const estoquePao = async () => (await prisma.insumo.findFirst({ where: { nome: 'Pão de lanche' } })).estoque;

  async function notificar(id) {
    const requestId = `req-${++seq}`;
    const corpo = { id: Number(`${Date.now()}${seq}`.slice(-12)), type: 'payment', action: 'payment.updated', user_id: Number(CONTA_MP), data: { id: String(id) } };
    const r = await api('POST', `/mercadopago/webhook?data.id=${id}&type=payment`, {
      corpo,
      headers: { 'x-signature': assinar({ dataId: id, requestId, ts: tsDe(agora) }), 'x-request-id': requestId },
    });
    await pagamentos.aguardarProcessamentos();
    return r;
  }

  before(async () => {
    for (const [k, v] of Object.entries(ENV)) {
      ENV_ANTES[k] = process.env[k];
      process.env[k] = v;
    }
    resetarBancoDeTeste();
    ({ prisma } = await import('../src/lib/prisma.js'));
    const { seed } = await import('../prisma/seed.js');
    await seed(prisma, { log: () => {} });
    const { criarApp } = await import('../src/app.js');
    const { criarAtendente } = await import('../src/services/usuario.service.js');
    const { criarServicoPagamentos } = await import('../src/services/pagamento.service.js');
    const { criarServicoConexaoMp } = await import('../src/services/conexaoMp.service.js');
    const { cifrar } = await import('../src/lib/cifra.js');
    const { aoEmitirParaEquipe } = await import('../src/lib/eventos.js');

    produto = await prisma.produto.findFirstOrThrow({ where: { nome: 'X-Burguer' } });
    await prisma.produto.updateMany({ data: { disponivelHoje: true, ativo: true } });
    await prisma.insumo.updateMany({ data: { estoque: 500 } });
    centro = await criarBairro(prisma, { nome: 'Centro', taxaCentavos: 500 });
    await criarAtendente({ nome: 'Bia', email: 'bia@teste.com', senha: 'senha-da-bia' });
    await prisma.conexaoMercadoPago.create({
      data: { lojaId: 1, mpUserId: CONTA_MP, accessTokenCifrado: cifrar(TOKEN_LOJA, Buffer.from(CHAVE_HEX, 'hex')), status: 'CONECTADA' },
    });

    const silencioso = { warn: (m) => avisos.push(String(m)) };
    pagamentos = criarServicoPagamentos({ mercadoPago: mp, log: silencioso });
    const conexaoMp = criarServicoConexaoMp({ mercadoPago: mp, log: silencioso, pagamentos });
    servidor = http.createServer(criarApp({ log: false, relogio: () => agora, mapas, pagamentos, conexaoMp }));
    await new Promise((resolve) => servidor.listen(0, resolve));
    base = `http://127.0.0.1:${servidor.address().port}/api`;
    tkEquipe = (await api('POST', '/auth/login', { corpo: { email: 'bia@teste.com', senha: 'senha-da-bia' } })).corpo.accessToken;
    pararEventos = aoEmitirParaEquipe((evento, dados, lojaId) => eventos.push({ evento, dados, lojaId }));
  });

  beforeEach(async () => {
    agora = SABADO_20H;
    eventos = [];
    mp.falhar = null;
    mp.chamadas = [];
    await prisma.loja.update({
      where: { id: 1 },
      data: { modoEntrega: 'PLATAFORMA', ...PINO_LOJA, pagamentoOnlineAtivo: true, freteGratisAtivo: false, freteGratisMinimoCentavos: null },
    });
  });

  after(async () => {
    pararEventos?.();
    await new Promise((resolve) => servidor?.close(resolve) ?? resolve());
    for (const [k, v] of Object.entries(ENV_ANTES)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  test('loja PLATAFORMA: aguardando, preferência com a taxa de entrega como comissão e 15 minutos; reenvio = a mesma', async () => {
    const c = await novoCliente();
    const pao = await estoquePao();
    const chave = '11111111-1111-4111-8111-111111111111';
    const r = await pedirComCartao(c, { chaveIdempotencia: chave });
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    assert.equal(r.corpo.pedido.status, 'AGUARDANDO_PAGAMENTO');
    assert.equal(r.corpo.pedido.numeroDia, null);
    assert.equal(r.corpo.pagamento.metodo, 'CARTAO_ONLINE');
    assert.match(r.corpo.pagamento.checkoutUrl, /^https:\/\/mp\.teste\/checkout\?pref_id=/);
    assert.equal(r.corpo.pagamento.qrCode, null);
    assert.equal(new Date(r.corpo.pagamento.expiraEm).getTime(), agora.getTime() + QUINZE_MIN);

    const [criada] = chamadasDe('criarPreferencia');
    assert.equal(criada.token, TOKEN_LOJA, 'token DA LOJA');
    assert.equal(criada.dados.comissaoCentavos, 676, 'comissão = taxa de entrega por km');
    assert.equal(criada.dados.valorCentavos, r.corpo.pedido.totalCentavos);
    assert.equal(criada.dados.expiraEm.getTime(), agora.getTime() + QUINZE_MIN);
    assert.equal(criada.dados.email, c.cliente.email);
    assert.equal(criada.dados.titulo, 'Pedido na Cabana Boemia');

    const banco = await pedidoNoBanco(r.corpo.pedido.id);
    assert.equal(banco.meioOnline, 'CARTAO_ONLINE');
    assert.equal(banco.formaPagamento, 'CREDITO');
    assert.equal(banco.impressoes.length, 0, 'sem cupom antes da aprovação');
    assert.match(banco.pagamentos[0].mpPreferenceId, /^pref-/);
    assert.equal(await estoquePao(), pao - 1, 'estoque reservado');
    assert.equal(eventos.filter((e) => e.evento === 'pedido:novo').length, 0, 'não chega ao PDV');

    const de_novo = await pedirComCartao(c, { chaveIdempotencia: chave });
    assert.equal(de_novo.status, 200);
    assert.equal(de_novo.corpo.pagamento.checkoutUrl, r.corpo.pagamento.checkoutUrl);
    assert.equal(chamadasDe('criarPreferencia').length, 1);
  });

  test('loja PROPRIO: marketplace_fee omitido (comissão zero)', async () => {
    await prisma.loja.update({ where: { id: 1 }, data: { modoEntrega: 'PROPRIO' } });
    const r = await pedirComCartao(await novoCliente());
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    assert.equal(chamadasDe('criarPreferencia')[0].dados.comissaoCentavos, 0);
  });

  test('a página de volta não aprova nada; a aprovação vem do webhook (crédito)', async () => {
    const c = await novoCliente();
    const r = await pedirComCartao(c);
    const id = r.corpo.pedido.id;
    const pago = mp.pagar(id);

    const volta = await api('GET', `/mercadopago/cartao/retorno?payment_id=${pago}&status=approved&external_reference=${id}`, { texto: true });
    assert.equal(volta.status, 200);
    assert.match(volta.corpo, /deliveryabatia:\/\/cartao-retorno/);
    assert.match(volta.headers.get('content-security-policy'), /default-src 'none'/);
    assert.equal((await pedidoNoBanco(id)).status, 'AGUARDANDO_PAGAMENTO', 'a volta do navegador não aprova');
    assert.equal(chamadasDe('consultar').length + chamadasDe('buscar').length, 0);

    await notificar(pago);
    const banco = await pedidoNoBanco(id);
    assert.equal(banco.status, 'CONFIRMADO');
    assert.ok(banco.numeroDia > 0);
    assert.equal(banco.formaPagamento, 'CREDITO');
    assert.equal(banco.tipoPagamentoOnline, 'CREDITO');
    assert.equal(banco.pagamentos[0].status, 'APROVADO');
    assert.equal(banco.pagamentos[0].mpPaymentId, pago);
    assert.equal(banco.impressoes.length, 1);
    const novo = eventos.find((e) => e.evento === 'pedido:novo');
    assert.equal(novo.dados.pagamentoOnline.meio, 'CARTAO_ONLINE');
    assert.equal(novo.dados.pagamentoOnline.tipo, 'CREDITO');
    assert.equal((await situacao(c, id)).corpo.pagamento.status, 'APROVADO');
  });

  test('recusa: o pedido continua aguardando com o motivo; nova tentativa em débito aprovada pela consulta; a recusa atrasada não muda nada', async () => {
    const c = await novoCliente();
    const id = (await pedirComCartao(c)).corpo.pedido.id;
    const recusado = mp.pagar(id, { status: 'rejected', statusDetail: 'cc_rejected_insufficient_amount' });
    await notificar(recusado);

    let banco = await pedidoNoBanco(id);
    assert.equal(banco.status, 'AGUARDANDO_PAGAMENTO', 'a recusa não encerra o pedido');
    assert.equal(banco.pagamentos[0].status, 'PENDENTE');
    assert.equal(banco.pagamentos[0].mpPaymentId, null);
    let s = await situacao(c, id);
    assert.equal(s.corpo.pagamento.status, 'PENDENTE');
    assert.deepEqual(s.corpo.pagamento.recusa, { mensagem: 'Saldo ou limite insuficiente no cartão.' });
    assert.ok(s.corpo.pagamento.checkoutUrl, '"Tentar de novo" reabre o mesmo checkout');

    // O cliente tenta de novo com débito; o webhook se perdeu: a consulta do app acha pela busca.
    const aprovado = mp.pagar(id, { tipo: 'debit_card' });
    agora = new Date(agora.getTime() + 20_000);
    s = await situacao(c, id);
    assert.equal(s.corpo.pagamento.status, 'APROVADO');
    assert.ok(chamadasDe('buscar').length >= 1);
    banco = await pedidoNoBanco(id);
    assert.equal(banco.status, 'CONFIRMADO');
    assert.equal(banco.formaPagamento, 'DEBITO');
    assert.equal(banco.tipoPagamentoOnline, 'DEBITO');
    assert.equal(banco.pagamentos[0].mpPaymentId, aprovado);

    const alertasAntes = await prisma.alertaPlataforma.count({ where: { pedidoId: id } });
    await notificar(recusado); // a notificação da tentativa recusada chega de novo, depois
    assert.equal((await pedidoNoBanco(id)).status, 'CONFIRMADO');
    assert.equal(await prisma.alertaPlataforma.count({ where: { pedidoId: id } }), alertasAntes, 'tentativa antiga não é divergência');
  });

  test('pagamento recebido por outra conta ou com valor diferente: divergência, não aprova', async () => {
    const c = await novoCliente();
    const id = (await pedirComCartao(c)).corpo.pedido.id;
    await notificar(mp.pagar(id, { collector: '999999' }));
    assert.equal((await pedidoNoBanco(id)).status, 'AGUARDANDO_PAGAMENTO');
    const id2 = (await pedirComCartao(c)).corpo.pedido.id;
    await notificar(mp.pagar(id2, { valorCentavos: 1 }));
    assert.equal((await pedidoNoBanco(id2)).status, 'AGUARDANDO_PAGAMENTO');
    const alertas = await prisma.alertaPlataforma.findMany({ where: { tipo: 'PAGAMENTO_DIVERGENTE', pedidoId: { in: [id, id2] } } });
    assert.equal(alertas.length, 2);
    assert.match(alertas.find((a) => a.pedidoId === id).mensagem, /outra conta/);
  });

  test('"Escolher outra forma": desiste, a preferência é encerrada, estoque de volta; outro cliente = 404', async () => {
    const c = await novoCliente();
    const pao = await estoquePao();
    const id = (await pedirComCartao(c)).corpo.pedido.id;
    assert.equal((await api('POST', `/cliente/pedidos/${id}/desistir-pagamento`, { token: (await novoCliente()).token })).status, 404);
    const r = await api('POST', `/cliente/pedidos/${id}/desistir-pagamento`, { token: c.token });
    assert.equal(r.status, 200);
    assert.equal(r.corpo.pedido.status, 'EXPIRADO');
    assert.equal(r.corpo.pagamento.status, 'CANCELADO');
    assert.equal(chamadasDe('expirarPreferencia').length, 1);
    assert.equal(await estoquePao(), pao);
    // Pago no último segundo vence a desistência.
    const id2 = (await pedirComCartao(c)).corpo.pedido.id;
    mp.pagar(id2);
    const r2 = await api('POST', `/cliente/pedidos/${id2}/desistir-pagamento`, { token: c.token });
    assert.equal(r2.corpo.pedido.status, 'CONFIRMADO');
  });

  test('expiração aos 15 minutos sem pagamento (rotina): EXPIRADO, estoque de volta; pago depois = estorno automático', async () => {
    // Sobras dos testes anteriores (pedidos aguardando) expiram antes, para o estoque bater.
    await pagamentos.rodarRotina(new Date(SABADO_20H.getTime() + 2 * QUINZE_MIN));
    const c = await novoCliente();
    const pao = await estoquePao();
    const id = (await pedirComCartao(c)).corpo.pedido.id;
    agora = new Date(SABADO_20H.getTime() + QUINZE_MIN + 60_000);
    const rotina = await pagamentos.rodarRotina(agora);
    assert.equal(rotina.expirados, 1);
    const banco = await pedidoNoBanco(id);
    assert.equal(banco.status, 'EXPIRADO');
    assert.equal(banco.pagamentos[0].status, 'EXPIRADO');
    assert.equal(await estoquePao(), pao);
    assert.equal((await situacao(c, id)).corpo.pagamento.status, 'EXPIRADO');

    const tarde = mp.pagar(id);
    await notificar(tarde);
    const depois = await pedidoNoBanco(id);
    assert.equal(depois.status, 'EXPIRADO', 'não revive');
    assert.equal(depois.pagamentos[0].status, 'REEMBOLSADO');
    assert.equal(chamadasDe('estornar').at(-1).id, tarde);
  });

  test('estorno de cartão: a loja recusa antes do aceite e o valor volta pelo id do pagamento', async () => {
    const c = await novoCliente();
    const id = (await pedirComCartao(c)).corpo.pedido.id;
    const pago = mp.pagar(id, { tipo: 'prepaid_card' });
    await notificar(pago);
    assert.equal((await pedidoNoBanco(id)).tipoPagamentoOnline, 'PRE_PAGO');
    const r = await api('PATCH', `/equipe/pedidos/${id}/cancelar`, { token: tkEquipe });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    const estorno = chamadasDe('estornar').at(-1);
    assert.equal(estorno.id, pago);
    assert.equal(estorno.token, TOKEN_LOJA);
    const banco = await pedidoNoBanco(id);
    assert.equal(banco.status, 'CANCELADO');
    assert.equal(banco.pagamentos[0].status, 'REEMBOLSADO');
    const lista = await api('GET', '/cliente/pedidos', { token: c.token });
    assert.equal(lista.corpo.pedidos.find((p) => p.id === id).pagamentoOnline.situacao, 'ESTORNADO');
  });

  test('falha ao criar a preferência: pedido EXPIRADO, estoque de volta e 502', async () => {
    const { ErroMercadoPago } = await import('../src/lib/mercadoPago.js');
    mp.falhar = new ErroMercadoPago('Mercado Pago recusou (400)', { status: 400, codigo: 'bad_request' });
    const pao = await estoquePao();
    const r = await pedirComCartao(await novoCliente());
    assert.equal(r.status, 502);
    assert.equal(r.corpo.erro.codigo, 'PAGAMENTO_FALHOU');
    assert.match(r.corpo.erro.mensagem, /cartão/);
    assert.equal(await estoquePao(), pao);
  });

  test('relatório do dia: o cartão finalizado sai no pago online com o tipo', async () => {
    const c = await novoCliente();
    const id = (await pedirComCartao(c)).corpo.pedido.id;
    await notificar(mp.pagar(id, { tipo: 'debit_card' }));
    assert.equal((await api('PATCH', `/equipe/pedidos/${id}/aceitar`, { token: tkEquipe })).status, 200);
    const fim = await api('PATCH', `/equipe/pedidos/${id}/finalizar`, { token: tkEquipe, corpo: {} });
    assert.equal(fim.status, 200, JSON.stringify(fim.corpo));
    const { relatorioDoDia } = await import('../src/services/relatorio.service.js');
    const rel = await relatorioDoDia(1, '2026-11-14', agora);
    const cartao = rel.pagoOnline.find((p) => p.meio === 'CARTAO_ONLINE');
    assert.ok(cartao.porTipo.some((t) => t.tipo === 'DEBITO' && t.quantidade >= 1));
  });
});
