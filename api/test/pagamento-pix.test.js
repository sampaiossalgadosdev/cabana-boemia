/**
 * Etapa 4 do pagamento online (docs/pagamento-online.md): canal APP, split na criação, taxa por
 * km, campanha, Pix no Mercado Pago (sempre FALSO aqui), webhook, aprovação, expiração,
 * desconexão e mp-connect.
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { semBancoDeTeste, resetarBancoDeTeste, criarBairro } from './helpers/banco.js';
import {
  criarClienteMercadoPago,
  detalheDoErro,
  TAMANHO_DETALHE_ERRO,
  ErroMercadoPago,
  manifestoDoWebhook,
  urlDeNotificacao,
  validarAssinaturaWebhook,
  instanteDoTs,
  diferencaDoTsEmSegundos,
} from '../src/lib/mercadoPago.js';
import { resolverTaxa } from '../src/services/pedido.service.js';

const CHAVE_HEX = 'ab'.repeat(32);
const SEGREDO_WEBHOOK = 'segredo-do-webhook-de-teste';
const TOKEN_LOJA = 'APP_USR-token-da-loja';
const CONTA_MP = '777000';
const SABADO_20H = new Date('2026-11-14T20:00:00-03:00'); // turno Lanches aberto
const PINO_LOJA = { latitude: -23.3049, longitude: -50.3133 };
const PINO_CLIENTE = { latitude: -23.31, longitude: -50.32 };
const DISTANCIA = 3200; // 3,2 km → R$ 1,00 + 0,90 × 6,4 km = R$ 6,76

/** Assinatura x-signature como o Mercado Pago manda. */
/** ts da assinatura (segundos) no relógio do teste: o webhook recusa ts a mais de 10 min. */
const tsDe = (instante) => String(Math.floor(instante.getTime() / 1000));

function assinar({ dataId, requestId, ts = '1732700000', segredo = SEGREDO_WEBHOOK }) {
  const v1 = createHmac('sha256', segredo).update(manifestoDoWebhook({ dataId, requestId, ts })).digest('hex');
  return `ts=${ts},v1=${v1}`;
}

describe('módulo do Mercado Pago: Pix, consulta, cancelamento e assinatura', () => {
  const config = { clientId: 'APP', clientSecret: 'x', redirectUri: 'https://api.taakidelivery.com.br/api/mercadopago/oauth/retorno' };

  function fetchFalso(resposta = {}) {
    const chamadas = [];
    const fetch = async (url, opcoes) => {
      chamadas.push({ url, metodo: opcoes.method, headers: opcoes.headers, corpo: opcoes.body ? JSON.parse(opcoes.body) : undefined });
      return new Response(JSON.stringify({ id: 123, status: 'pending', transaction_amount: 25.5, ...resposta }), { status: 201 });
    };
    return { fetch, chamadas };
  }

  test('criarPix: token da loja, X-Idempotency-Key, pix, valor, referência, notificação, expiração e e-mail', async () => {
    const f = fetchFalso({ point_of_interaction: { transaction_data: { qr_code: '000201', qr_code_base64: 'iVBOR' } } });
    const mp = criarClienteMercadoPago({ config, fetch: f.fetch });
    const r = await mp.criarPix(TOKEN_LOJA, {
      valorCentavos: 2550,
      comissaoCentavos: 676,
      pedidoId: 42,
      descricao: 'Pedido Cabana Boemia',
      email: 'cliente@teste.com',
      expiraEm: new Date('2026-11-14T23:30:00Z'),
      idempotencyKey: 'chave-1',
    });
    const c = f.chamadas[0];
    assert.equal(c.url, 'https://api.mercadopago.com/v1/payments');
    assert.equal(c.metodo, 'POST');
    assert.equal(c.headers.authorization, `Bearer ${TOKEN_LOJA}`);
    assert.equal(c.headers['x-idempotency-key'], 'chave-1');
    assert.deepEqual(c.corpo, {
      transaction_amount: 25.5,
      payment_method_id: 'pix',
      description: 'Pedido Cabana Boemia',
      external_reference: '42',
      date_of_expiration: '2026-11-14T20:30:00.000-03:00',
      payer: { email: 'cliente@teste.com' },
      notification_url: 'https://api.taakidelivery.com.br/api/mercadopago/webhook?source_news=webhooks',
      application_fee: 6.76,
    });
    assert.equal(r.qrCode, '000201');
    assert.equal(r.qrCodeBase64, 'iVBOR');
    assert.equal(r.valorCentavos, 2550);
  });

  test('comissão zero: application_fee omitido', async () => {
    const f = fetchFalso();
    await criarClienteMercadoPago({ config, fetch: f.fetch }).criarPix(TOKEN_LOJA, {
      valorCentavos: 1000,
      comissaoCentavos: 0,
      pedidoId: 1,
      descricao: 'x',
      email: 'a@b.com',
      expiraEm: new Date(),
      idempotencyKey: 'k',
    });
    assert.equal('application_fee' in f.chamadas[0].corpo, false);
  });

  test('consulta normaliza a comissão (fee_details) e o cancelamento manda status cancelled', async () => {
    const f = fetchFalso({ status: 'approved', external_reference: '7', fee_details: [{ type: 'mercadopago_fee', amount: 1 }, { type: 'application_fee', amount: 2.5 }] });
    const mp = criarClienteMercadoPago({ config, fetch: f.fetch });
    const r = await mp.consultarPagamento(TOKEN_LOJA, '123');
    assert.equal(f.chamadas[0].url, 'https://api.mercadopago.com/v1/payments/123');
    assert.equal(r.comissaoCentavos, 250);
    assert.equal(r.referenciaExterna, '7');
    await mp.cancelarPagamento(TOKEN_LOJA, '123');
    assert.equal(f.chamadas[1].metodo, 'PUT');
    assert.deepEqual(f.chamadas[1].corpo, { status: 'cancelled' });
  });

  test('erro do Mercado Pago vira ErroMercadoPago (sem o corpo inteiro); sem token nem chama', async () => {
    const mp = criarClienteMercadoPago({ config, fetch: async () => new Response(JSON.stringify({ message: 'invalid_token' }), { status: 401 }) });
    await assert.rejects(() => mp.consultarPagamento(TOKEN_LOJA, '1'), (e) => e instanceof ErroMercadoPago && e.status === 401 && e.codigo === 'invalid_token');
    await assert.rejects(() => mp.consultarPagamento(null, '1'), (e) => e.codigo === 'SEM_TOKEN');
  });

  test('recusa com message e cause: detalhe curto, sem e-mail nem números longos; sem nada = null', async () => {
    const resposta = {
      error: 'bad_request',
      message: 'Collector user without key enabled for QR render',
      status: 400,
      cause: [{ code: 13253, description: 'Financial Identity Use Case was not found', data: 'segredo-que-nao-sai' }],
    };
    const mp = criarClienteMercadoPago({ config, fetch: async () => new Response(JSON.stringify(resposta), { status: 400 }) });
    await assert.rejects(
      () => mp.criarPix(TOKEN_LOJA, { valorCentavos: 100, comissaoCentavos: 0, pedidoId: 1, descricao: 'x', email: 'a@b.com', expiraEm: new Date(), idempotencyKey: 'k' }),
      (e) =>
        e.codigo === 'bad_request' &&
        e.detalhe === 'Collector user without key enabled for QR render [13253: Financial Identity Use Case was not found]',
    );
    assert.equal(
      detalheDoErro({ message: 'payer.email ana.silva@exemplo.com is invalid', cause: { code: 4050, description: 'CPF 12345678901 telefone 43999990000' } }),
      'payer.email *** is invalid [4050: CPF *** telefone ***]',
    );
    assert.equal(detalheDoErro({ error: 'bad_request', message: 'bad_request', cause: [] }), null, 'message igual ao error não repete');
    assert.equal(detalheDoErro(null), null);
    const longo = detalheDoErro({ message: 'x'.repeat(500) });
    assert.equal(longo.length, TAMANHO_DETALHE_ERRO);
    assert.ok(!longo.includes(TOKEN_LOJA));
  });

  test('assinatura: válida, adulterada, outro segredo, sem segredo; data.id em minúsculas', () => {
    const assinatura = assinar({ dataId: 'ABC123', requestId: 'req-1' });
    assert.equal(validarAssinaturaWebhook({ assinatura, requestId: 'req-1', dataId: 'ABC123', segredo: SEGREDO_WEBHOOK }), true);
    assert.equal(validarAssinaturaWebhook({ assinatura, requestId: 'req-1', dataId: 'abc123', segredo: SEGREDO_WEBHOOK }), true);
    assert.equal(validarAssinaturaWebhook({ assinatura, requestId: 'req-2', dataId: 'ABC123', segredo: SEGREDO_WEBHOOK }), false);
    assert.equal(validarAssinaturaWebhook({ assinatura, requestId: 'req-1', dataId: 'ABC124', segredo: SEGREDO_WEBHOOK }), false);
    assert.equal(validarAssinaturaWebhook({ assinatura, requestId: 'req-1', dataId: 'ABC123', segredo: 'outro' }), false);
    assert.equal(validarAssinaturaWebhook({ assinatura, requestId: 'req-1', dataId: 'ABC123', segredo: '' }), false);
    assert.equal(validarAssinaturaWebhook({ assinatura: 'lixo', requestId: 'req-1', dataId: 'ABC123', segredo: SEGREDO_WEBHOOK }), false);
  });

  test('assinatura com o relógio: ts a até 10 min vale (segundos ou ms); mais velho ou no futuro = inválida', () => {
    const agora = new Date('2026-11-28T12:00:00Z');
    const valida = (instante, emMs = false) => {
      const ts = emMs ? String(instante.getTime()) : tsDe(instante);
      return validarAssinaturaWebhook({ assinatura: assinar({ dataId: '1', requestId: 'r', ts }), requestId: 'r', dataId: '1', segredo: SEGREDO_WEBHOOK, agora });
    };
    const min = (n) => new Date(agora.getTime() + n * 60_000);
    assert.equal(valida(agora), true);
    assert.equal(valida(min(-9.9)), true);
    assert.equal(valida(min(9.9)), true);
    assert.equal(valida(min(-10.1)), false, 'velha (reenvio de uma notificação assinada antiga)');
    assert.equal(valida(min(10.1)), false, 'no futuro');
    assert.equal(valida(min(-5), true), true, 'ts em milissegundos');
    assert.equal(valida(min(-11), true), false);
    assert.equal(instanteDoTs('1764331200'), 1764331200000);
    assert.equal(instanteDoTs('1764331200000'), 1764331200000);
    assert.equal(instanteDoTs('abc'), null);
    assert.equal(diferencaDoTsEmSegundos(assinar({ dataId: '1', requestId: 'r', ts: tsDe(min(-11)) }), agora), 660);
    assert.equal(diferencaDoTsEmSegundos('v1=abc', agora), null);
  });

  test('data.id alfanumérico: vale como chegou (o SDK oficial não muda a caixa) ou em minúsculas (documentação antiga)', () => {
    const ts = '1764331200';
    const comSegredo = (m) => `ts=${ts},v1=${createHmac('sha256', SEGREDO_WEBHOOK).update(m).digest('hex')}`;
    const comoSdk = comSegredo(manifestoDoWebhook({ dataId: 'ABC123', requestId: 'r', ts, minusculas: false }));
    assert.equal(manifestoDoWebhook({ dataId: 'ABC123', requestId: 'r', ts, minusculas: false }), 'id:ABC123;request-id:r;ts:1764331200;');
    assert.equal(validarAssinaturaWebhook({ assinatura: comoSdk, requestId: 'r', dataId: 'ABC123', segredo: SEGREDO_WEBHOOK }), true);
    const minusculo = comSegredo(manifestoDoWebhook({ dataId: 'ABC123', requestId: 'r', ts }));
    assert.equal(validarAssinaturaWebhook({ assinatura: minusculo, requestId: 'r', dataId: 'ABC123', segredo: SEGREDO_WEBHOOK }), true);
    assert.equal(validarAssinaturaWebhook({ assinatura: comoSdk, requestId: 'r', dataId: 'ABC124', segredo: SEGREDO_WEBHOOK }), false);
    assert.equal(validarAssinaturaWebhook({ assinatura: comoSdk.replace('ts=', 'TS='), requestId: 'r', dataId: 'ABC123', segredo: SEGREDO_WEBHOOK }), true, 'chave do cabeçalho sem diferenciar maiúsculas');
  });

  test('tokenAindaAutorizado: /users/me com o token; SÓ 401/403 = false; 5xx, tempo, rede e sem token lançam', async () => {
    const com = (status) => criarClienteMercadoPago({ config, fetch: async () => new Response(JSON.stringify(status < 300 ? { id: 1 } : { message: 'invalid_token' }), { status }) });
    const f = fetchFalso();
    assert.equal(await criarClienteMercadoPago({ config, fetch: f.fetch }).tokenAindaAutorizado(TOKEN_LOJA), true);
    assert.equal(f.chamadas[0].url, 'https://api.mercadopago.com/users/me');
    assert.equal(f.chamadas[0].headers.authorization, `Bearer ${TOKEN_LOJA}`);
    assert.equal(await com(401).tokenAindaAutorizado(TOKEN_LOJA), false);
    assert.equal(await com(403).tokenAindaAutorizado(TOKEN_LOJA), false);
    await assert.rejects(() => com(200).tokenAindaAutorizado(null), (e) => e.codigo === 'SEM_TOKEN', 'sem token não responde "inválido"');
    await assert.rejects(() => com(500).tokenAindaAutorizado(TOKEN_LOJA), (e) => e instanceof ErroMercadoPago && e.status === 500);
    await assert.rejects(() => com(503).tokenAindaAutorizado(TOKEN_LOJA), (e) => e.status === 503);
    const lento = criarClienteMercadoPago({ config, tempoLimiteMs: 5, fetch: (_u, o) => new Promise((_r, rej) => o.signal.addEventListener('abort', () => rej(o.signal.reason))) });
    await assert.rejects(() => lento.tokenAindaAutorizado(TOKEN_LOJA), (e) => e.codigo === 'TEMPO_ESGOTADO');
    const semRede = criarClienteMercadoPago({ config, fetch: async () => { throw new TypeError('fetch failed'); } });
    await assert.rejects(() => semRede.tokenAindaAutorizado(TOKEN_LOJA), (e) => e.codigo === 'REDE');
  });

  test('notification_url sai da origem do MP_REDIRECT_URI', () => {
    assert.equal(urlDeNotificacao(config), 'https://api.taakidelivery.com.br/api/mercadopago/webhook?source_news=webhooks');
    assert.equal(urlDeNotificacao({ redirectUri: '' }), null);
  });
});

test('taxa: km só no app em loja PLATAFORMA com distância; senão a área (loja sem pino = alerta)', () => {
  const base = { comEntrega: true, taxaManualCentavos: null, taxaAreaCentavos: 500, regraKm: { baseCentavos: 100, porKmCentavos: 90 } };
  assert.deepEqual(resolverTaxa({ ...base, canal: 'APP', modoEntrega: 'PLATAFORMA', distanciaMetros: DISTANCIA }), {
    taxaCheiaCentavos: 676,
    origemTaxa: 'KM',
    lojaSemPino: false,
  });
  assert.deepEqual(resolverTaxa({ ...base, canal: 'APP', modoEntrega: 'PLATAFORMA', distanciaMetros: null }), {
    taxaCheiaCentavos: 500,
    origemTaxa: 'AREA',
    lojaSemPino: true,
  });
  assert.equal(resolverTaxa({ ...base, canal: 'SITE', modoEntrega: 'PLATAFORMA', distanciaMetros: DISTANCIA }).origemTaxa, 'AREA');
  assert.equal(resolverTaxa({ ...base, canal: 'APP', modoEntrega: 'PROPRIO', distanciaMetros: DISTANCIA }).taxaCheiaCentavos, 500);
  assert.equal(resolverTaxa({ ...base, canal: 'APP', modoEntrega: 'PLATAFORMA', comEntrega: false, distanciaMetros: DISTANCIA }).taxaCheiaCentavos, 0);
});

describe('pagamento online na API (canal APP, split, Pix, webhook, expiração)', { skip: semBancoDeTeste }, () => {
  let prisma;
  let servidor;
  let base;
  let tkEquipe;
  let produto;
  let centro;
  let agora = SABADO_20H;
  let pagamentos;
  let conexaoMp;
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

  /** Mercado Pago falso: um "banco" de pagamentos por id. */
  const mp = {
    chamadas: [],
    pagamentos: new Map(),
    proximoId: 9000,
    falhar: false,
    async criarPix(token, dados) {
      mp.chamadas.push({ tipo: 'criarPix', token, dados });
      if (mp.falhar) throw new ErroMercadoPago('Mercado Pago recusou (400)', { status: 400, codigo: 'bad_request', detalhe: 'Collector user without key enabled for QR render [13253: x]' });
      const existente = [...mp.pagamentos.values()].find((p) => p.chave === dados.idempotencyKey);
      if (existente) return { ...existente.r };
      const id = String(mp.proximoId++);
      const r = {
        id,
        status: 'pending',
        statusDetail: 'pending_waiting_transfer',
        valorCentavos: dados.valorCentavos,
        comissaoCentavos: dados.comissaoCentavos > 0 ? dados.comissaoCentavos : null,
        referenciaExterna: String(dados.pedidoId),
        collectorId: CONTA_MP,
        qrCode: `pix-copia-e-cola-${id}`,
        qrCodeBase64: 'iVBORw0KGgo=',
        expiraEm: null,
        aprovadoEm: null,
      };
      mp.pagamentos.set(id, { chave: dados.idempotencyKey, r });
      return { ...r };
    },
    async consultarPagamento(token, id) {
      mp.chamadas.push({ tipo: 'consultar', token, id });
      const p = mp.pagamentos.get(String(id));
      if (!p) throw new ErroMercadoPago('não encontrado', { status: 404 });
      return { ...p.r };
    },
    async estornar(token, id, dados) {
      mp.chamadas.push({ tipo: 'estornar', token, id, dados });
      mp.mudar(id, { status: 'refunded', valorReembolsadoCentavos: mp.pagamentos.get(String(id)).r.valorCentavos });
      return { id: `r-${id}`, status: 'approved', valorCentavos: null };
    },
    /**
     * `tokenAutorizado`: o que o Mercado Pago responde no /users/me: true (a loja não desvinculou),
     * false (401/403) ou um erro para lançar (5xx, tempo esgotado, rede).
     */
    tokenAutorizado: true,
    async tokenAindaAutorizado(token) {
      mp.chamadas.push({ tipo: 'tokenAutorizado', token });
      if (mp.tokenAutorizado instanceof Error) throw mp.tokenAutorizado;
      return mp.tokenAutorizado;
    },
    /** `falharCancelar`: o cancelamento do Pix dá erro de rede (o Pix continua pendente lá). */
    falharCancelar: false,
    async cancelarPagamento(token, id) {
      mp.chamadas.push({ tipo: 'cancelar', token, id });
      if (mp.falharCancelar) throw new ErroMercadoPago('Mercado Pago fora do ar ou sem resposta', { codigo: 'TEMPO_ESGOTADO' });
      const p = mp.pagamentos.get(String(id));
      p.r = { ...p.r, status: 'cancelled', statusDetail: 'by_collector' };
      return { ...p.r };
    },
    mudar(id, dados) {
      const p = mp.pagamentos.get(String(id));
      p.r = { ...p.r, ...dados };
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

  async function api(metodo, rota, { token, corpo, headers = {} } = {}) {
    const res = await fetch(`${base}${rota}`, {
      method: metodo,
      headers: {
        ...(token && { authorization: `Bearer ${token}` }),
        ...(corpo !== undefined && { 'content-type': 'application/json' }),
        ...headers,
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const texto = await res.text();
    return { status: res.status, corpo: texto ? JSON.parse(texto) : null };
  }

  let seq = 0;
  /** Cliente com endereço no Centro (com pino, por padrão) e token. */
  async function novoCliente({ email = `c${++seq}@teste.com`, telefone, verificado = false, pino = PINO_CLIENTE } = {}) {
    const { gerarTokenCliente } = await import('../src/lib/tokens.js');
    const tel = telefone ?? `4399${String(100000 + ++seq * 7).slice(-6)}0`.slice(0, 11);
    const cliente = await prisma.cliente.create({
      data: {
        nome: `Cliente ${seq}`,
        email,
        telefone: tel,
        telefoneVerificado: verificado,
        telefoneVerificadoEm: verificado ? agora : null,
      },
    });
    const endereco = await prisma.endereco.create({
      data: { clienteId: cliente.id, rua: 'Rua A', numero: '10', bairroId: centro.id, principal: true, ...(pino ?? {}) },
    });
    return { cliente, endereco, token: gerarTokenCliente(cliente) };
  }

  const itens = () => [{ produtoId: produto.id, quantidade: 1 }];

  async function previa(c, extra = {}) {
    return api('POST', '/cliente/pedidos/previa', { token: c.token, corpo: { itens: itens(), enderecoId: c.endereco.id, origem: 'APP', ...extra } });
  }

  /** Pedido do cliente com o total da prévia (o que o app faz). */
  async function pedir(c, extra = {}) {
    const origem = 'origem' in extra ? (extra.origem ?? 'SITE') : 'APP';
    const p = await previa(c, { origem });
    assert.equal(p.status, 200, JSON.stringify(p.corpo));
    const corpo = {
      itens: itens(),
      enderecoId: c.endereco.id,
      totalEsperadoCentavos: p.corpo.previa.totalCentavos,
      origem: 'APP',
      ...extra,
    };
    if (!corpo.pagamentoOnline && !corpo.formaPagamento) corpo.formaPagamento = 'DINHEIRO';
    if (corpo.origem === undefined) delete corpo.origem;
    return api('POST', '/cliente/pedidos', { token: c.token, corpo });
  }

  const pedidosDaEquipe = async () => (await api('GET', '/equipe/pedidos?dataRef=2026-11-14&status=todos', { token: tkEquipe })).corpo.pedidos;
  const pedidoNoBanco = (id) => prisma.pedido.findUnique({ where: { id }, include: { pagamentos: true, usoCampanha: true, impressoes: true } });
  const estoquePao = async () => (await prisma.insumo.findFirst({ where: { nome: 'Pão de lanche' } })).estoque;

  async function notificar(corpo, { dataId = corpo?.data?.id, requestId = `req-${++seq}`, assinatura } = {}) {
    const rota = dataId != null ? `/mercadopago/webhook?data.id=${dataId}&type=${corpo.type}` : '/mercadopago/webhook';
    const r = await api('POST', rota, {
      corpo,
      headers: { 'x-signature': assinatura ?? assinar({ dataId, requestId, ts: tsDe(agora) }), 'x-request-id': requestId },
    });
    await pagamentos.aguardarProcessamentos();
    return r;
  }

  const notificacaoDePagamento = (id, extra = {}) => ({
    id: Number(`${Date.now()}${++seq}`.slice(-12)),
    type: 'payment',
    action: 'payment.updated',
    user_id: Number(CONTA_MP),
    data: { id: String(id) },
    ...extra,
  });

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
    await criarAtendente({ nome: 'Ana', email: 'ana@teste.com', senha: 'senha-da-ana' });
    await prisma.conexaoMercadoPago.create({
      data: { lojaId: 1, mpUserId: CONTA_MP, accessTokenCifrado: cifrar(TOKEN_LOJA, Buffer.from(CHAVE_HEX, "hex")), status: 'CONECTADA' },
    });

    const silencioso = { warn: (m) => avisos.push(String(m)) };
    pagamentos = criarServicoPagamentos({ mercadoPago: mp, log: silencioso });
    conexaoMp = criarServicoConexaoMp({ mercadoPago: mp, log: silencioso, pagamentos });
    servidor = http.createServer(
      criarApp({
        log: false,
        relogio: () => agora,
        mapas,
        pagamentos,
        conexaoMp,
        verificadorTelefone: { enviarCodigo: async () => {}, conferirCodigo: async (_t, codigo) => codigo === '123456' },
      }),
    );
    await new Promise((resolve) => servidor.listen(0, resolve));
    base = `http://127.0.0.1:${servidor.address().port}/api`;
    tkEquipe = (await api('POST', '/auth/login', { corpo: { email: 'ana@teste.com', senha: 'senha-da-ana' } })).corpo.accessToken;
    pararEventos = aoEmitirParaEquipe((evento, dados, lojaId) => eventos.push({ evento, dados, lojaId }));
  });

  beforeEach(async () => {
    agora = SABADO_20H;
    eventos = [];
    mp.falhar = false;
    // Loja padrão: entregador da plataforma, com pino, pagamento online ligado e conectada.
    await prisma.loja.update({
      where: { id: 1 },
      data: { modoEntrega: 'PLATAFORMA', ...PINO_LOJA, pagamentoOnlineAtivo: true, freteGratisAtivo: false, freteGratisMinimoCentavos: null },
    });
    await prisma.conexaoMercadoPago.update({ where: { lojaId: 1 }, data: { status: 'CONECTADA', mpUserId: CONTA_MP } });
  });

  after(async () => {
    pararEventos?.();
    await new Promise((resolve) => servidor?.close(resolve) ?? resolve());
    for (const [k, v] of Object.entries(ENV_ANTES)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  test('origem: o app manda APP e o site SITE; a equipe vê cada um com o seu canal e o alerta sai para os dois', async () => {
    await prisma.loja.update({ where: { id: 1 }, data: { modoEntrega: 'PROPRIO' } });
    const c = await novoCliente();
    const app = await pedir(c, { formaPagamento: 'PIX' });
    assert.equal(app.status, 201, JSON.stringify(app.corpo));
    assert.equal(app.corpo.pedido.canal, 'APP');
    const site = await pedir(c, { origem: undefined, formaPagamento: 'PIX' });
    assert.equal(site.status, 201, JSON.stringify(site.corpo));
    assert.equal(site.corpo.pedido.canal, 'SITE');
    const lista = await pedidosDaEquipe();
    assert.equal(lista.find((p) => p.id === app.corpo.pedido.id).canal, 'APP');
    assert.equal(lista.find((p) => p.id === site.corpo.pedido.id).canal, 'SITE');
    assert.deepEqual(
      eventos.filter((e) => e.evento === 'pedido:novo').map((e) => e.dados.canal),
      ['APP', 'SITE'],
    );
  });

  test('site em loja PLATAFORMA: entrega sem pino com a taxa da área (AREA, 95/5) e só dinheiro na entrega', async () => {
    const c = await novoCliente({ pino: null });
    const pix = await pedir(c, { origem: undefined, formaPagamento: 'PIX' });
    assert.equal(pix.status, 422);
    assert.equal(pix.corpo.erro.codigo, 'FORMA_INDISPONIVEL');
    const r = await pedir(c, { origem: undefined, formaPagamento: 'DINHEIRO' });
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    const p = await pedidoNoBanco(r.corpo.pedido.id);
    assert.equal(p.canal, 'SITE');
    assert.equal(p.taxaEntregaCentavos, 500);
    assert.equal(p.origemTaxaEntrega, 'AREA');
    assert.equal(p.valorEntregadorCentavos, 475);
    assert.equal(p.valorPlataformaEntregaCentavos, 25);
    // Pagamento online é só do app.
    const online = await pedir(c, { origem: undefined, pagamentoOnline: 'PIX' });
    assert.equal(online.status, 400);
  });

  test('app em loja PLATAFORMA: taxa por km pela distância (KM, 95/5); sem pino = 422; prévia igual ao pedido', async () => {
    const c = await novoCliente();
    const p = await previa(c);
    assert.equal(p.status, 200, JSON.stringify(p.corpo));
    assert.equal(p.corpo.previa.taxaEntregaCentavos, 676);
    assert.equal(p.corpo.previa.origemTaxa, 'KM');
    assert.equal(p.corpo.previa.distanciaMetros, DISTANCIA);
    assert.deepEqual(p.corpo.previa.formasPagamento, { naEntrega: ['DINHEIRO'], online: ['PIX', 'CARTAO_ONLINE'] });
    const r = await pedir(c, { formaPagamento: 'DINHEIRO' });
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    const banco = await pedidoNoBanco(r.corpo.pedido.id);
    assert.equal(banco.taxaEntregaCentavos, 676);
    assert.equal(banco.totalCentavos, p.corpo.previa.totalCentavos);
    assert.equal(banco.origemTaxaEntrega, 'KM');
    assert.equal(banco.valorEntregadorCentavos, 642);
    assert.equal(banco.valorPlataformaEntregaCentavos, 34);
    // O total vem sempre do servidor: um total diferente do recalculado = 409.
    const errado = await api('POST', '/cliente/pedidos', {
      token: c.token,
      corpo: { itens: itens(), enderecoId: c.endereco.id, totalEsperadoCentavos: 1, origem: 'APP', formaPagamento: 'DINHEIRO' },
    });
    assert.equal(errado.corpo.erro.codigo, 'PRECO_ALTERADO');
    const semPino = await novoCliente({ pino: null });
    assert.equal((await previa(semPino)).corpo.erro.codigo, 'PINO_OBRIGATORIO');
  });

  test('loja PLATAFORMA sem pino: pedido do app usa a área (AREA) e o ADMIN recebe um alerta só', async () => {
    await prisma.loja.update({ where: { id: 1 }, data: { latitude: null, longitude: null } });
    const c = await novoCliente();
    for (let i = 0; i < 2; i += 1) {
      const r = await pedir(c, { formaPagamento: 'DINHEIRO' });
      assert.equal(r.status, 201, JSON.stringify(r.corpo));
      assert.equal((await pedidoNoBanco(r.corpo.pedido.id)).origemTaxaEntrega, 'AREA');
    }
    assert.equal(await prisma.alertaPlataforma.count({ where: { tipo: 'LOJA_SEM_LOCALIZACAO', resolvidoEm: null } }), 1);
  });

  test('ADMIN não muda a loja para PLATAFORMA sem o pino; o dono não apaga o pino de loja PLATAFORMA', async () => {
    const { editarLoja } = await import('../src/services/loja.service.js');
    const { definirLocalizacao } = await import('../src/services/identidade.service.js');
    await prisma.loja.update({ where: { id: 1 }, data: { modoEntrega: 'PROPRIO', latitude: null, longitude: null } });
    await assert.rejects(() => editarLoja(1, { modoEntrega: 'PLATAFORMA' }), (e) => e.codigo === 'LOJA_SEM_LOCALIZACAO');
    // Com o pino na mesma gravação, passa.
    assert.equal((await editarLoja(1, { modoEntrega: 'PLATAFORMA', ...PINO_LOJA })).modoEntrega, 'PLATAFORMA');
    await assert.rejects(() => definirLocalizacao(1, { latitude: null, longitude: null }), (e) => e.codigo === 'LOJA_SEM_LOCALIZACAO');
    await assert.rejects(() => editarLoja(1, { latitude: null, longitude: null }), (e) => e.codigo === 'LOJA_SEM_LOCALIZACAO');
  });

  test('campanha: reservada na criação (frete grátis, plataforma paga o entregador), usada na finalização', async () => {
    const c = await novoCliente({ verificado: true, telefone: '43988880001' });
    const p = await previa(c);
    assert.equal(p.corpo.previa.origemFreteGratis, 'CAMPANHA');
    assert.equal(p.corpo.previa.taxaEntregaCentavos, 0);
    const r = await pedir(c, { formaPagamento: 'DINHEIRO' });
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    let banco = await pedidoNoBanco(r.corpo.pedido.id);
    assert.equal(banco.origemFreteGratis, 'CAMPANHA');
    assert.equal(banco.taxaEntregaCentavos, 0);
    assert.equal(banco.valorEntregadorCentavos, 642); // o entregador recebe mesmo com frete grátis
    assert.equal(banco.usoCampanha.situacao, 'RESERVADO');
    // Segundo pedido do mesmo telefone: sem campanha (já reservada).
    assert.equal((await previa(c)).corpo.previa.origemFreteGratis, 'NENHUM');
    await api('POST', '/equipe/caixa/abrir', { token: tkEquipe, corpo: { valorInicialCentavos: 0 } });
    const fin = await api('PATCH', `/equipe/pedidos/${banco.id}/finalizar`, { token: tkEquipe, corpo: { formaPagamento: 'DINHEIRO' } });
    assert.equal(fin.status, 200, JSON.stringify(fin.corpo));
    banco = await pedidoNoBanco(banco.id);
    assert.equal(banco.usoCampanha.situacao, 'USADO');
  });

  test('campanha: só no app e com telefone verificado; a prévia oferece verificar o telefone', async () => {
    const naoVerificado = await novoCliente();
    const p = await previa(naoVerificado);
    assert.equal(p.corpo.previa.origemFreteGratis, 'NENHUM');
    assert.equal(p.corpo.previa.campanha.disponivelSeVerificar, true);
    const verificado = await novoCliente({ verificado: true, telefone: '43988880002' });
    const site = await previa(verificado, { origem: 'SITE' });
    assert.equal(site.corpo.previa.origemFreteGratis, 'NENHUM');
    assert.equal(site.corpo.previa.campanha.disponivelSeVerificar, false);
  });

  test('CAMPANHA_FRETE_GRATIS_ATIVA vazia: sem campanha nem convite, mesmo com o segredo e o pagamento online ligados', async () => {
    const antes = process.env.CAMPANHA_FRETE_GRATIS_ATIVA;
    process.env.CAMPANHA_FRETE_GRATIS_ATIVA = '';
    try {
      const verificado = await novoCliente({ verificado: true, telefone: '43988880009' });
      const p = await previa(verificado);
      assert.equal(p.corpo.previa.origemFreteGratis, 'NENHUM');
      assert.ok(p.corpo.previa.taxaEntregaCentavos > 0);
      const r = await pedir(verificado, { formaPagamento: 'DINHEIRO' });
      assert.equal(r.status, 201, JSON.stringify(r.corpo));
      const banco = await pedidoNoBanco(r.corpo.pedido.id);
      assert.equal(banco.origemFreteGratis, 'NENHUM');
      assert.equal(banco.usoCampanha, null);
      assert.equal((await previa(await novoCliente())).corpo.previa.campanha.disponivelSeVerificar, false, 'sem a faixa "verifique seu telefone"');
    } finally {
      process.env.CAMPANHA_FRETE_GRATIS_ATIVA = antes;
    }
  });

  test('verificar o telefone da conta logada: código certo marca verificado; telefone de outra conta verificada = 409', async () => {
    const c = await novoCliente();
    assert.equal((await api('POST', '/cliente/telefone/enviar', { token: c.token, corpo: { telefone: '(43) 98888-0003' } })).status, 200);
    const errado = await api('POST', '/cliente/telefone/verificar', { token: c.token, corpo: { telefone: '43988880003', codigo: '000000' } });
    assert.equal(errado.status, 401);
    const ok = await api('POST', '/cliente/telefone/verificar', { token: c.token, corpo: { telefone: '43988880003', codigo: '123456' } });
    assert.equal(ok.status, 200, JSON.stringify(ok.corpo));
    assert.equal(ok.corpo.cliente.telefoneVerificado, true);
    assert.equal(ok.corpo.cliente.telefone, '43988880003');
    const outro = await novoCliente();
    const dup = await api('POST', '/cliente/telefone/verificar', { token: outro.token, corpo: { telefone: '43988880003', codigo: '123456' } });
    assert.equal(dup.status, 409);
    assert.equal(dup.corpo.erro.codigo, 'TELEFONE_EM_USO');
  });

  test('Pix: pedido AGUARDANDO_PAGAMENTO sem número, fora do PDV e sem cupom; comissão = taxa; idempotência', async () => {
    const c = await novoCliente();
    const pao = await estoquePao();
    const chave = '11111111-1111-4111-8111-111111111111';
    const r = await pedir(c, { pagamentoOnline: 'PIX', chaveIdempotencia: chave });
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    assert.equal(r.corpo.pedido.status, 'AGUARDANDO_PAGAMENTO');
    assert.equal(r.corpo.pedido.numeroDia, null);
    assert.equal(r.corpo.pagamento.status, 'PENDENTE');
    assert.match(r.corpo.pagamento.qrCode, /^pix-copia-e-cola-/);
    assert.ok(r.corpo.pagamento.qrCodeBase64);
    assert.equal(new Date(r.corpo.pagamento.expiraEm).getTime(), agora.getTime() + 15 * 60_000);
    const pix = chamadasDe('criarPix').at(-1);
    assert.equal(pix.token, TOKEN_LOJA);
    assert.equal(pix.dados.comissaoCentavos, 676); // a taxa por km inteira vai para a plataforma no split
    assert.equal(pix.dados.valorCentavos, r.corpo.pedido.totalCentavos);
    assert.equal(pix.dados.email, c.cliente.email);
    assert.equal(pix.dados.expiraEm.getTime(), agora.getTime() + 30 * 60_000);
    // Estoque reservado, nada para a equipe.
    assert.equal(await estoquePao(), pao - 1);
    const banco = await pedidoNoBanco(r.corpo.pedido.id);
    assert.equal(banco.impressoes.length, 0);
    assert.equal(eventos.length, 0);
    assert.equal((await pedidosDaEquipe()).some((p) => p.id === banco.id), false);
    assert.equal((await api('PATCH', `/equipe/pedidos/${banco.id}/finalizar`, { token: tkEquipe, corpo: { formaPagamento: 'PIX' } })).status, 404);
    // Reenvio com a mesma chave: o mesmo Pix, sem criar outro no Mercado Pago.
    const antes = chamadasDe('criarPix').length;
    const deNovo = await pedir(c, { pagamentoOnline: 'PIX', chaveIdempotencia: chave });
    assert.equal(deNovo.status, 200);
    assert.equal(deNovo.corpo.pedido.id, banco.id);
    assert.equal(deNovo.corpo.pagamento.qrCode, r.corpo.pagamento.qrCode);
    assert.equal(chamadasDe('criarPix').length, antes);
    assert.equal(await prisma.pagamento.count({ where: { pedidoId: banco.id } }), 1);
  });

  test('trava de 50%: taxa maior que metade do pedido = comissão limitada no Pix e alerta para o ADMIN só na aprovação', async () => {
    const precoAntes = produto.precoCentavos;
    await prisma.produto.update({ where: { id: produto.id }, data: { precoCentavos: 500 } });
    try {
      const c = await novoCliente();
      const r = await pedir(c, { pagamentoOnline: 'PIX' });
      assert.equal(r.status, 201, JSON.stringify(r.corpo));
      // Valor cobrado = 5,00 + 6,76 = 11,76; metade = 5,88 (para baixo) vai no split; 0,88 fica de débito.
      assert.equal(r.corpo.pedido.totalCentavos, 1176);
      assert.equal(chamadasDe('criarPix').at(-1).dados.comissaoCentavos, 588);
      const doPedido = (id) => prisma.alertaPlataforma.findMany({ where: { tipo: 'TAXA_ENTREGA_COMPLEMENTO', pedidoId: id } });
      assert.equal((await doPedido(r.corpo.pedido.id)).length, 0, 'na criação ainda não há débito');
      // Aprovado: o alerta nasce junto com o lançamento do complemento.
      const { mpPaymentId } = (await pedidoNoBanco(r.corpo.pedido.id)).pagamentos[0];
      mp.mudar(mpPaymentId, { status: 'approved' });
      await notificar(notificacaoDePagamento(mpPaymentId));
      const [alerta, ...outros] = await doPedido(r.corpo.pedido.id);
      assert.equal(outros.length, 0);
      assert.match(alerta.mensagem, /R\$ 6,76/);
      assert.match(alerta.mensagem, /R\$ 0,88/);
      // Pix da mesma situação que expira: nenhum alerta.
      const expira = await pedir(await novoCliente(), { pagamentoOnline: 'PIX' });
      await pagamentos.expirarPedido(expira.corpo.pedido.id);
      assert.equal((await doPedido(expira.corpo.pedido.id)).length, 0);
      // Na entrega não há split: sem alerta.
      const naEntrega = await pedir(c, { formaPagamento: 'DINHEIRO' });
      assert.equal(await prisma.alertaPlataforma.count({ where: { tipo: 'TAXA_ENTREGA_COMPLEMENTO', pedidoId: naEntrega.corpo.pedido.id } }), 0);
    } finally {
      await prisma.produto.update({ where: { id: produto.id }, data: { precoCentavos: precoAntes } });
    }
  });

  test('Pix exige e-mail no cadastro; o app grava o e-mail e segue', async () => {
    const c = await novoCliente({ email: null });
    const r = await pedir(c, { pagamentoOnline: 'PIX' });
    assert.equal(r.status, 422);
    assert.equal(r.corpo.erro.codigo, 'EMAIL_OBRIGATORIO');
    assert.equal((await api('PUT', '/cliente/email', { token: c.token, corpo: { email: 'nao-e-email' } })).status, 400);
    const e = await api('PUT', '/cliente/email', { token: c.token, corpo: { email: 'Novo@Teste.com' } });
    assert.equal(e.corpo.cliente.email, 'novo@teste.com');
    assert.equal((await pedir(c, { pagamentoOnline: 'PIX' })).status, 201);
  });

  test('Pix indisponível: loja desligada, conexão expirada ou loja com motoboy próprio sem online = 409', async () => {
    const c = await novoCliente();
    await prisma.loja.update({ where: { id: 1 }, data: { pagamentoOnlineAtivo: false } });
    assert.equal((await pedir(c, { pagamentoOnline: 'PIX' })).corpo.erro.codigo, 'PAGAMENTO_ONLINE_INDISPONIVEL');
    assert.deepEqual((await previa(c)).corpo.previa.formasPagamento.online, []);
    await prisma.loja.update({ where: { id: 1 }, data: { pagamentoOnlineAtivo: true } });
    await prisma.conexaoMercadoPago.update({ where: { lojaId: 1 }, data: { status: 'EXPIRADA' } });
    assert.equal((await pedir(c, { pagamentoOnline: 'PIX' })).corpo.erro.codigo, 'PAGAMENTO_ONLINE_INDISPONIVEL');
  });

  test('falha ao gerar o Pix: 502, pedido EXPIRADO com estoque e campanha de volta; 4 falhas na hora = alerta', async () => {
    mp.falhar = true;
    const c = await novoCliente({ verificado: true, telefone: '43988880004' });
    const pao = await estoquePao();
    const r = await pedir(c, { pagamentoOnline: 'PIX' });
    assert.equal(r.status, 502);
    assert.equal(r.corpo.erro.codigo, 'PAGAMENTO_FALHOU');
    const banco = await prisma.pedido.findFirst({ where: { clienteId: c.cliente.id }, include: { pagamentos: true, usoCampanha: true } });
    assert.equal(banco.status, 'EXPIRADO');
    assert.equal(banco.pagamentos[0].status, 'RECUSADO');
    // O motivo do Mercado Pago (message + cause) fica no dadosMp e no log.
    assert.deepEqual(banco.pagamentos[0].dadosMp, { erro: 'bad_request', status: 400, detalhe: 'Collector user without key enabled for QR render [13253: x]' });
    assert.ok(avisos.some((a) => a.includes(`pedido ${banco.id}: Pix não criado (status 400, bad_request: Collector user without key enabled for QR render [13253: x])`)));
    assert.equal(banco.usoCampanha, null); // campanha liberada
    assert.equal(await estoquePao(), pao);
    assert.equal(await prisma.alertaPlataforma.count({ where: { tipo: 'PIX_FALHANDO' } }), 0);
    for (let i = 0; i < 3; i += 1) assert.equal((await pedir(c, { pagamentoOnline: 'PIX' })).status, 502);
    assert.equal(await prisma.alertaPlataforma.count({ where: { tipo: 'PIX_FALHANDO' } }), 1);
    assert.equal((await pedir(c, { pagamentoOnline: 'PIX' })).status, 502);
    assert.equal(await prisma.alertaPlataforma.count({ where: { tipo: 'PIX_FALHANDO' } }), 1, 'um alerta por hora');
  });

  test('webhook: assinatura inválida = 401; aprovado dá número, consome a campanha e libera para o PDV; duplicado não muda nada', async () => {
    const c = await novoCliente({ verificado: true, telefone: '43988880005' });
    const r = await pedir(c, { pagamentoOnline: 'PIX' });
    const pedidoId = r.corpo.pedido.id;
    const { mpPaymentId } = (await pedidoNoBanco(pedidoId)).pagamentos[0];
    assert.equal((await pedidoNoBanco(pedidoId)).usoCampanha.situacao, 'RESERVADO');

    const notificacao = notificacaoDePagamento(mpPaymentId);
    const invalida = await notificar(notificacao, { assinatura: assinar({ dataId: mpPaymentId, requestId: 'x', segredo: 'errado' }) });
    assert.equal(invalida.status, 401);
    // Assinada certo, mas com ts de 11 minutos atrás (reenvio de uma notificação velha): 401 também.
    const velhaReq = `req-velha-${seq}`;
    const velha = await notificar(notificacao, {
      requestId: velhaReq,
      assinatura: assinar({ dataId: mpPaymentId, requestId: velhaReq, ts: tsDe(new Date(agora.getTime() - 11 * 60_000)) }),
    });
    assert.equal(velha.status, 401);
    // Aviso no log com a diferença em segundos (11 min = 660 s), sem o id do pagamento nem cabeçalhos.
    const aviso = avisos.findLast((a) => a.includes('webhook recusado: ts fora da janela'));
    assert.match(aviso, /diferença de 660 s/);
    assert.ok(!aviso.includes(String(mpPaymentId)) && !aviso.includes(velhaReq) && !aviso.includes(SEGREDO_WEBHOOK));
    // Assinatura errada (não é questão de ts): nenhum aviso de ts.
    const quantos = avisos.filter((a) => a.includes('ts fora da janela')).length;
    await notificar(notificacao, { assinatura: assinar({ dataId: mpPaymentId, requestId: 'y', segredo: 'errado' }) });
    assert.equal(avisos.filter((a) => a.includes('ts fora da janela')).length, quantos);

    agora = new Date(SABADO_20H.getTime() + 3 * 60_000);
    mp.mudar(mpPaymentId, { status: 'approved', statusDetail: 'accredited', aprovadoEm: agora.toISOString() });
    const ok = await notificar(notificacao);
    assert.equal(ok.status, 200);
    let banco = await pedidoNoBanco(pedidoId);
    assert.equal(banco.status, 'CONFIRMADO');
    assert.ok(Number.isInteger(banco.numeroDia));
    assert.equal(banco.formaPagamento, 'PIX');
    assert.equal(banco.pagamentos[0].status, 'APROVADO');
    assert.equal(banco.usoCampanha.situacao, 'USADO');
    assert.equal(banco.impressoes.length, 1);
    assert.deepEqual(eventos.map((e) => e.evento), ['pedido:novo', 'impressao:nova']);
    assert.equal(eventos[0].dados.canal, 'APP');
    assert.ok((await pedidosDaEquipe()).some((p) => p.id === pedidoId));
    const consultas = chamadasDe('consultar').length;
    assert.equal(chamadasDe('consultar').at(-1).token, TOKEN_LOJA);

    // A mesma notificação de novo: nada muda (nem consulta).
    const dup = await notificar(notificacao);
    assert.equal(dup.status, 200);
    assert.equal(dup.corpo.duplicado, true);
    assert.equal(chamadasDe('consultar').length, consultas);
    // Outra notificação do mesmo pagamento (outro id): concilia, mas a transição só vai para frente.
    await notificar(notificacaoDePagamento(mpPaymentId));
    banco = await pedidoNoBanco(pedidoId);
    assert.equal(banco.impressoes.length, 1);
    assert.equal(eventos.length, 2);
    // A tela do app vê aprovado.
    const s = await api('GET', `/cliente/pedidos/${pedidoId}/pagamento`, { token: c.token });
    assert.equal(s.corpo.pagamento.status, 'APROVADO');
    assert.equal(s.corpo.pagamento.qrCode, null);
    assert.equal(s.corpo.pedido.numeroDia, banco.numeroDia);
  });

  test('divergência de valor: alerta para o ADMIN e o pedido não é aprovado', async () => {
    const c = await novoCliente();
    const r = await pedir(c, { pagamentoOnline: 'PIX' });
    const pedidoId = r.corpo.pedido.id;
    const { mpPaymentId } = (await pedidoNoBanco(pedidoId)).pagamentos[0];
    mp.mudar(mpPaymentId, { status: 'approved', valorCentavos: 100 });
    await notificar(notificacaoDePagamento(mpPaymentId));
    const banco = await pedidoNoBanco(pedidoId);
    assert.equal(banco.status, 'AGUARDANDO_PAGAMENTO');
    assert.equal(banco.pagamentos[0].status, 'PENDENTE');
    assert.equal(await prisma.alertaPlataforma.count({ where: { tipo: 'PAGAMENTO_DIVERGENTE', pedidoId } }), 1);
    assert.equal(eventos.length, 0);
    // Comissão diferente também diverge.
    mp.mudar(mpPaymentId, { valorCentavos: banco.totalCentavos, comissaoCentavos: 1 });
    const ana = await prisma.usuario.findFirstOrThrow({ where: { email: 'ana@teste.com' } });
    await prisma.alertaPlataforma.updateMany({ where: { pedidoId }, data: { resolvidoEm: agora, resolvidoPorId: ana.id } });
    await notificar(notificacaoDePagamento(mpPaymentId));
    assert.equal((await pedidoNoBanco(pedidoId)).status, 'AGUARDANDO_PAGAMENTO');
    assert.equal(await prisma.alertaPlataforma.count({ where: { tipo: 'PAGAMENTO_DIVERGENTE', pedidoId, resolvidoEm: null } }), 1);
  });

  test('pagamento de conta desconhecida ou de outro pedido: ignorado', async () => {
    const r = await notificar({ ...notificacaoDePagamento('123'), user_id: 1 });
    assert.equal(r.status, 200);
    const evento = await prisma.eventoWebhook.findFirst({ orderBy: { id: 'desc' } });
    assert.equal(evento.resultado, 'LOJA_DESCONHECIDA');
  });

  test('tela do app: só o dono do pedido; consulta o Mercado Pago no máximo a cada 30 s', async () => {
    const c = await novoCliente();
    const r = await pedir(c, { pagamentoOnline: 'PIX' });
    const pedidoId = r.corpo.pedido.id;
    const outro = await novoCliente();
    assert.equal((await api('GET', `/cliente/pedidos/${pedidoId}/pagamento`, { token: outro.token })).status, 404);
    const antes = chamadasDe('consultar').length;
    agora = new Date(SABADO_20H.getTime() + 5_000);
    const s = await api('GET', `/cliente/pedidos/${pedidoId}/pagamento`, { token: c.token });
    assert.equal(s.corpo.pagamento.status, 'PENDENTE');
    assert.ok(s.corpo.pagamento.qrCode);
    assert.equal(chamadasDe('consultar').length, antes, 'acabou de ser criado: não consulta');
    agora = new Date(SABADO_20H.getTime() + 31_000);
    await api('GET', `/cliente/pedidos/${pedidoId}/pagamento`, { token: c.token });
    assert.equal(chamadasDe('consultar').length, antes + 1);
  });

  test('cancelamento do Pix que falhou aos 15 minutos: a rotina tenta de novo até os 30 minutos do Mercado Pago', async () => {
    const min = (n) => new Date(SABADO_20H.getTime() + n * 60_000);
    await pagamentos.rodarRotina(min(60)); // pendentes de testes anteriores saem antes
    const pedidoPix = async () => {
      const r = await pedir(await novoCliente(), { pagamentoOnline: 'PIX' });
      assert.equal(r.status, 201, JSON.stringify(r.corpo));
      return { id: r.corpo.pedido.id, mpPaymentId: (await pedidoNoBanco(r.corpo.pedido.id)).pagamentos[0].mpPaymentId };
    };
    const a = await pedidoPix();
    const b = await pedidoPix();
    try {
      // 15 min: o cancelamento falha nos dois; o pedido expira assim mesmo e o novo cancelamento fica marcado.
      mp.falharCancelar = true;
      await pagamentos.rodarRotina(min(15.1));
      for (const p of [a, b]) {
        const banco = await pedidoNoBanco(p.id);
        assert.equal(banco.status, 'EXPIRADO');
        assert.equal(banco.pagamentos[0].cancelarNoMpAte.getTime(), min(30).getTime(), 'até os 30 minutos do Mercado Pago');
      }
      assert.ok(avisos.some((x) => x.includes(`pedido ${a.id}: cancelamento no Mercado Pago falhou`)));

      // 16 min: o Mercado Pago ainda fora: continua marcado.
      await pagamentos.rodarRotina(min(16));
      assert.ok((await pedidoNoBanco(a.id)).pagamentos[0].cancelarNoMpAte);

      // O cliente de B paga no intervalo; o Mercado Pago volta.
      mp.falharCancelar = false;
      mp.mudar(b.mpPaymentId, { status: 'approved' });
      const rotina = await pagamentos.rodarRotina(min(17));
      assert.equal(rotina.recancelados, 2);
      const pa = (await pedidoNoBanco(a.id)).pagamentos[0];
      assert.equal(pa.cancelarNoMpAte, null);
      assert.equal(mp.pagamentos.get(a.mpPaymentId).r.status, 'cancelled', 'A cancelado no Mercado Pago');
      // B: pago depois de expirar = estorno automático, pedido continua EXPIRADO.
      const pb = await pedidoNoBanco(b.id);
      assert.equal(pb.status, 'EXPIRADO');
      assert.equal(pb.pagamentos[0].status, 'REEMBOLSADO');
      assert.equal(pb.pagamentos[0].cancelarNoMpAte, null);
      assert.equal(await prisma.alertaPlataforma.count({ where: { tipo: 'PAGO_APOS_EXPIRAR', pedidoId: b.id } }), 1);
      assert.ok(chamadasDe('estornar').some((x) => x.id === b.mpPaymentId));

      // Depois dos 30 minutos não há mais tentativa.
      const c = await pedidoPix();
      mp.falharCancelar = true;
      await pagamentos.rodarRotina(min(15.1));
      const cancelamentos = chamadasDe('cancelar').filter((x) => x.id === c.mpPaymentId).length;
      await pagamentos.rodarRotina(min(30.5));
      assert.equal(chamadasDe('cancelar').filter((x) => x.id === c.mpPaymentId).length, cancelamentos);
    } finally {
      mp.falharCancelar = false;
    }
  });

  test('expiração aos 15 minutos: cancela no Mercado Pago, pedido EXPIRADO, estoque e campanha de volta', async () => {
    const c = await novoCliente({ verificado: true, telefone: '43988880006' });
    // Pendentes de testes anteriores expiram antes (a rotina pega todos e mexeria no estoque).
    await pagamentos.rodarRotina(new Date(SABADO_20H.getTime() + 60 * 60_000));
    const pao = await estoquePao();
    const r = await pedir(c, { pagamentoOnline: 'PIX' });
    const pedidoId = r.corpo.pedido.id;
    const { mpPaymentId } = (await pedidoNoBanco(pedidoId)).pagamentos[0];
    assert.equal(await estoquePao(), pao - 1);
    // Aos 14 minutos ainda não expira (só consulta).
    let rotina = await pagamentos.rodarRotina(new Date(SABADO_20H.getTime() + 14 * 60_000));
    assert.equal(rotina.expirados, 0);
    rotina = await pagamentos.rodarRotina(new Date(SABADO_20H.getTime() + 15 * 60_000 + 1));
    assert.ok(rotina.expirados >= 1);
    assert.ok(chamadasDe('cancelar').some((x) => x.id === mpPaymentId && x.token === TOKEN_LOJA));
    const banco = await pedidoNoBanco(pedidoId);
    assert.equal(banco.status, 'EXPIRADO');
    assert.equal(banco.numeroDia, null);
    assert.equal(banco.pagamentos[0].status, 'EXPIRADO');
    assert.equal(banco.usoCampanha, null);
    assert.equal(await estoquePao(), pao);
    assert.equal(eventos.length, 0);
    // A tela do app vê expirado (o app volta para a sacola).
    const s = await api('GET', `/cliente/pedidos/${pedidoId}/pagamento`, { token: c.token });
    assert.equal(s.corpo.pagamento.status, 'EXPIRADO');
    // A campanha volta para o telefone.
    assert.equal((await previa(c)).corpo.previa.origemFreteGratis, 'CAMPANHA');

    // Aprovação atrasada: o pedido não revive; alerta e estorno total automático (Etapa 5).
    mp.mudar(mpPaymentId, { status: 'approved' });
    await notificar(notificacaoDePagamento(mpPaymentId));
    const depois = await pedidoNoBanco(pedidoId);
    assert.equal(depois.status, 'EXPIRADO');
    assert.equal(depois.numeroDia, null);
    assert.equal(depois.pagamentos[0].status, 'REEMBOLSADO');
    assert.ok(chamadasDe('estornar').some((x) => x.id === mpPaymentId && x.token === TOKEN_LOJA && x.dados.valorCentavos == null));
    assert.equal(await prisma.alertaPlataforma.count({ where: { tipo: 'PAGO_APOS_EXPIRAR', pedidoId } }), 1);
    assert.equal(eventos.length, 0);
    assert.equal(await estoquePao(), pao);
  });

  test('aprovado no último segundo vence a expiração', async () => {
    const c = await novoCliente();
    const r = await pedir(c, { pagamentoOnline: 'PIX' });
    const { mpPaymentId } = (await pedidoNoBanco(r.corpo.pedido.id)).pagamentos[0];
    mp.mudar(mpPaymentId, { status: 'approved' });
    await pagamentos.rodarRotina(new Date(SABADO_20H.getTime() + 16 * 60_000));
    assert.equal((await pedidoNoBanco(r.corpo.pedido.id)).status, 'CONFIRMADO');
  });

  test('recusado no Mercado Pago: pedido EXPIRADO com o estoque de volta', async () => {
    const c = await novoCliente();
    const r = await pedir(c, { pagamentoOnline: 'PIX' });
    const { mpPaymentId } = (await pedidoNoBanco(r.corpo.pedido.id)).pagamentos[0];
    mp.mudar(mpPaymentId, { status: 'rejected' });
    await notificar(notificacaoDePagamento(mpPaymentId));
    const banco = await pedidoNoBanco(r.corpo.pedido.id);
    assert.equal(banco.status, 'EXPIRADO');
    assert.equal(banco.pagamentos[0].status, 'RECUSADO');
  });

  test('desconectar a loja cancela os Pix pendentes no Mercado Pago e expira os pedidos', async () => {
    const c = await novoCliente();
    const r = await pedir(c, { pagamentoOnline: 'PIX' });
    const { mpPaymentId } = (await pedidoNoBanco(r.corpo.pedido.id)).pagamentos[0];
    // Pedidos pagos (aprovados nos testes anteriores) ainda abertos bloqueiam a desconexão; a loja
    // finaliza antes. O Pix pendente deste teste não bloqueia.
    const pagosAbertos = { lojaId: 1, meioOnline: { not: null }, status: { in: ['ABERTO', 'CONFIRMADO', 'EM_PREPARO', 'SAIU_ENTREGA'] } };
    if (await prisma.pedido.count({ where: pagosAbertos })) {
      await assert.rejects(() => conexaoMp.desconectar(1, { confirmar: true }), (e) => e.codigo === 'PEDIDOS_PAGOS_ABERTOS');
      await prisma.pedido.updateMany({ where: pagosAbertos, data: { status: 'FINALIZADO', finalizadoEm: agora } });
    }
    const aviso = await conexaoMp.desconectar(1, { confirmar: false });
    assert.ok(aviso.pendentes >= 1);
    const feito = await conexaoMp.desconectar(1, { confirmar: true });
    assert.equal(feito.desconectada, true);
    assert.ok(feito.cancelados >= 1);
    assert.ok(chamadasDe('cancelar').some((x) => x.id === mpPaymentId && x.token === TOKEN_LOJA));
    const banco = await pedidoNoBanco(r.corpo.pedido.id);
    assert.equal(banco.status, 'EXPIRADO');
    assert.equal(banco.pagamentos[0].status, 'CANCELADO');
    const conexao = await prisma.conexaoMercadoPago.findUnique({ where: { lojaId: 1 } });
    assert.equal(conexao.status, 'DESCONECTADA');
    assert.equal(conexao.accessTokenCifrado, null);
    assert.equal((await prisma.loja.findUnique({ where: { id: 1 } })).pagamentoOnlineAtivo, false);
    // Volta a conectar para os próximos testes.
    const { cifrar } = await import('../src/lib/cifra.js');
    await prisma.conexaoMercadoPago.update({ where: { lojaId: 1 }, data: { accessTokenCifrado: cifrar(TOKEN_LOJA, Buffer.from(CHAVE_HEX, "hex")), status: 'CONECTADA' } });
  });

  test('notificação de pagamento numa conta já desconectada: alerta para o ADMIN com o id do pagamento (um por pagamento)', async () => {
    const c = await novoCliente();
    const r = await pedir(c, { pagamentoOnline: 'PIX' });
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    const pedidoId = r.corpo.pedido.id;
    const { mpPaymentId } = (await pedidoNoBanco(pedidoId)).pagamentos[0];
    // A loja desconectou (tokens apagados) e o cliente pagou mesmo assim.
    await prisma.conexaoMercadoPago.update({ where: { lojaId: 1 }, data: { status: 'DESCONECTADA', accessTokenCifrado: null } });
    mp.mudar(mpPaymentId, { status: 'approved' });
    const consultasAntes = chamadasDe('consultar').length;
    try {
      assert.equal((await notificar(notificacaoDePagamento(mpPaymentId))).status, 200);
      assert.equal((await notificar(notificacaoDePagamento(mpPaymentId))).status, 200, 'segunda notificação do mesmo pagamento');
      const alertas = await prisma.alertaPlataforma.findMany({ where: { tipo: 'PAGAMENTO_CONTA_DESCONECTADA' } });
      assert.equal(alertas.length, 1);
      assert.equal(alertas[0].lojaId, 1);
      assert.equal(alertas[0].pedidoId, pedidoId);
      assert.match(alertas[0].mensagem, new RegExp(`pagamento ${mpPaymentId} `));
      assert.equal(chamadasDe('consultar').length, consultasAntes, 'sem token não há consulta');
      // Conta que o Taaki nunca conectou: nada.
      await notificar(notificacaoDePagamento('424242', { user_id: 999999 }));
      assert.equal(await prisma.alertaPlataforma.count({ where: { tipo: 'PAGAMENTO_CONTA_DESCONECTADA' } }), 1);
      const evento = await prisma.eventoWebhook.findFirst({ where: { recursoId: mpPaymentId }, orderBy: { id: 'desc' } });
      assert.equal(evento.resultado, 'CONTA_DESCONECTADA');
    } finally {
      const { cifrar } = await import('../src/lib/cifra.js');
      await prisma.conexaoMercadoPago.update({ where: { lojaId: 1 }, data: { accessTokenCifrado: cifrar(TOKEN_LOJA, Buffer.from(CHAVE_HEX, 'hex')), status: 'CONECTADA' } });
    }
  });

  test('mp-connect com o token ainda autorizado no Mercado Pago: ignorado (nada desliga), com aviso no log', async () => {
    mp.tokenAutorizado = true;
    const alertasAntes = await prisma.alertaPlataforma.count({ where: { tipo: 'MP_DESVINCULADA' } });
    const r = await notificar(
      { id: 555000, type: 'mp-connect', action: 'application.deauthorized', user_id: Number(CONTA_MP), data: { id: CONTA_MP } },
      { dataId: CONTA_MP },
    );
    assert.equal(r.status, 200);
    assert.equal(chamadasDe('tokenAutorizado').at(-1).token, TOKEN_LOJA, 'conferido com o token da loja');
    const conexao = await prisma.conexaoMercadoPago.findUnique({ where: { lojaId: 1 } });
    assert.equal(conexao.status, 'CONECTADA');
    assert.ok(conexao.accessTokenCifrado);
    assert.equal((await prisma.loja.findUnique({ where: { id: 1 } })).pagamentoOnlineAtivo, true);
    assert.equal(await prisma.alertaPlataforma.count({ where: { tipo: 'MP_DESVINCULADA' } }), alertasAntes);
    assert.ok(avisos.some((a) => a.includes('mp-connect da loja 1 ignorado')));
    assert.ok(!avisos.some((a) => a.includes(TOKEN_LOJA)), 'token nunca no log');
    const evento = await prisma.eventoWebhook.findFirst({ where: { tipo: 'mp-connect' }, orderBy: { id: 'desc' } });
    assert.equal(evento.resultado, 'TOKEN_AINDA_AUTORIZADO');
  });

  test('mp-connect sem resposta clara do Mercado Pago (5xx, tempo, rede): nada desconecta, aviso no log e o reenvio é processado', async () => {
    const notificacao = (id) => ({ id, type: 'mp-connect', action: 'application.deauthorized', user_id: Number(CONTA_MP), data: { id: CONTA_MP } });
    const falhas = [
      new ErroMercadoPago('Mercado Pago recusou (500)', { status: 500, codigo: 'internal_error' }),
      new ErroMercadoPago('Mercado Pago fora do ar ou sem resposta', { codigo: 'TEMPO_ESGOTADO' }),
      new ErroMercadoPago('Mercado Pago fora do ar ou sem resposta', { codigo: 'REDE' }),
    ];
    try {
      for (const [i, falha] of falhas.entries()) {
        mp.tokenAutorizado = falha;
        const n = notificacao(556000 + i);
        assert.equal((await notificar(n, { dataId: CONTA_MP })).status, 200);
        const conexao = await prisma.conexaoMercadoPago.findUnique({ where: { lojaId: 1 } });
        assert.equal(conexao.status, 'CONECTADA', falha.codigo);
        assert.ok(conexao.accessTokenCifrado);
        assert.equal((await prisma.loja.findUnique({ where: { id: 1 } })).pagamentoOnlineAtivo, true);
        assert.ok(avisos.some((a) => a.includes('mp-connect da loja 1 não confirmado') && a.includes(falha.codigo)));
        // O evento é apagado: o reenvio do Mercado Pago é processado (agora confirmado como válido).
        assert.equal(await prisma.eventoWebhook.count({ where: { chave: { contains: String(556000 + i) } } }), 0);
      }
      mp.tokenAutorizado = true;
      assert.equal((await notificar(notificacao(556000), { dataId: CONTA_MP })).status, 200);
      const evento = await prisma.eventoWebhook.findFirst({ where: { chave: { contains: '556000' } } });
      assert.equal(evento.resultado, 'TOKEN_AINDA_AUTORIZADO');
      assert.equal(await prisma.alertaPlataforma.count({ where: { tipo: 'MP_DESVINCULADA' } }), 0);
    } finally {
      mp.tokenAutorizado = true;
    }
  });

  test('mp-connect numa conexão sem token para perguntar: não desconecta (NAO_CONFIRMADO)', async () => {
    await prisma.conexaoMercadoPago.update({ where: { lojaId: 1 }, data: { status: 'EXPIRADA', accessTokenCifrado: null } });
    try {
      const chamadas = chamadasDe('tokenAutorizado').length;
      assert.equal((await notificar({ id: 557001, type: 'mp-connect', action: 'application.deauthorized', user_id: Number(CONTA_MP), data: { id: CONTA_MP } }, { dataId: CONTA_MP })).status, 200);
      assert.equal((await prisma.conexaoMercadoPago.findUnique({ where: { lojaId: 1 } })).status, 'EXPIRADA');
      assert.equal(chamadasDe('tokenAutorizado').length, chamadas);
      assert.equal((await prisma.eventoWebhook.findFirst({ where: { chave: { contains: '557001' } } })).resultado, 'NAO_CONFIRMADO');
    } finally {
      const { cifrar } = await import('../src/lib/cifra.js');
      await prisma.conexaoMercadoPago.update({ where: { lojaId: 1 }, data: { accessTokenCifrado: cifrar(TOKEN_LOJA, Buffer.from(CHAVE_HEX, 'hex')), status: 'CONECTADA' } });
    }
  });

  test('mp-connect: a loja desvinculou no Mercado Pago = desconectada, online desligado e alerta', async () => {
    mp.tokenAutorizado = false;
    const r = await notificar(
      { id: 555001, type: 'mp-connect', action: 'application.deauthorized', user_id: Number(CONTA_MP), data: { id: CONTA_MP } },
      { dataId: CONTA_MP },
    );
    assert.equal(r.status, 200);
    const conexao = await prisma.conexaoMercadoPago.findUnique({ where: { lojaId: 1 } });
    assert.equal(conexao.status, 'DESCONECTADA');
    assert.equal(conexao.accessTokenCifrado, null);
    assert.equal((await prisma.loja.findUnique({ where: { id: 1 } })).pagamentoOnlineAtivo, false);
    assert.equal(await prisma.alertaPlataforma.count({ where: { tipo: 'MP_DESVINCULADA', lojaId: 1 } }), 1);
    const { cifrar } = await import('../src/lib/cifra.js');
    await prisma.conexaoMercadoPago.update({ where: { lojaId: 1 }, data: { accessTokenCifrado: cifrar(TOKEN_LOJA, Buffer.from(CHAVE_HEX, "hex")), status: 'CONECTADA' } });
  });

  test('flag global desligada: o Pix some das formas e o pedido online é recusado; na entrega segue igual', async () => {
    process.env.PAGAMENTO_ONLINE_ATIVO = '';
    try {
      const c = await novoCliente();
      assert.deepEqual((await previa(c)).corpo.previa.formasPagamento.online, []);
      assert.equal((await pedir(c, { pagamentoOnline: 'PIX' })).corpo.erro.codigo, 'PAGAMENTO_ONLINE_INDISPONIVEL');
      assert.equal((await pedir(c, { formaPagamento: 'DINHEIRO' })).status, 201);
    } finally {
      process.env.PAGAMENTO_ONLINE_ATIVO = 'sim';
    }
  });
});
