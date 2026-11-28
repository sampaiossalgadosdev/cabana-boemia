/**
 * Etapa 5 do pagamento online (docs/pagamento-online.md): aceite da loja, recusa e cancelamento
 * com estorno, ADMIN (total/parcial, finalizado), reembolso pendente sem retentativa, webhook
 * (estorno externo e contestação), finalizar sem caixa, relatório com o pago online à parte,
 * pedido sem aceite e o e-mail recusado pelo Mercado Pago. Mercado Pago sempre FALSO.
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { semBancoDeTeste, resetarBancoDeTeste, criarBairro } from './helpers/banco.js';
import { criarClienteMercadoPago, erroNoEmailDoPagador, ErroMercadoPago, manifestoDoWebhook } from '../src/lib/mercadoPago.js';

const CHAVE_HEX = 'cd'.repeat(32);
const SEGREDO_WEBHOOK = 'segredo-do-webhook-de-teste-etapa-5';
const TOKEN_LOJA = 'APP_USR-token-da-loja-5';
const CONTA_MP = '555000';
const SABADO_20H = new Date('2026-11-14T20:00:00-03:00'); // turno Lanches aberto
const PINO_LOJA = { latitude: -23.3049, longitude: -50.3133 };
const PINO_CLIENTE = { latitude: -23.31, longitude: -50.32 };
const MINUTO = 60_000;

/** ts da assinatura (segundos) no relógio do teste: o webhook recusa ts a mais de 10 min. */
const tsDe = (instante) => String(Math.floor(instante.getTime() / 1000));

function assinar({ dataId, requestId, ts = '1732700000' }) {
  const v1 = createHmac('sha256', SEGREDO_WEBHOOK).update(manifestoDoWebhook({ dataId, requestId, ts })).digest('hex');
  return `ts=${ts},v1=${v1}`;
}

describe('módulo do Mercado Pago: estorno e e-mail recusado', () => {
  const config = { clientId: 'APP', clientSecret: 'x', redirectUri: 'https://api.taakidelivery.com.br/api/mercadopago/oauth/retorno' };

  function fetchFalso(resposta, status = 201) {
    const chamadas = [];
    const fetch = async (url, opcoes) => {
      chamadas.push({ url, metodo: opcoes.method, headers: opcoes.headers, corpo: opcoes.body ? JSON.parse(opcoes.body) : undefined });
      return new Response(JSON.stringify(resposta), { status });
    };
    return { fetch, chamadas };
  }

  test('estornar: total sem amount, parcial com amount em reais; token da loja e X-Idempotency-Key', async () => {
    const f = fetchFalso({ id: 77, status: 'approved', amount: 12.5 });
    const mp = criarClienteMercadoPago({ config, fetch: f.fetch });
    const total = await mp.estornar(TOKEN_LOJA, '123', { idempotencyKey: 'k1' });
    assert.deepEqual(total, { id: '77', status: 'approved', valorCentavos: 1250 });
    await mp.estornar(TOKEN_LOJA, '123', { valorCentavos: 500, idempotencyKey: 'k2' });
    const [a, b] = f.chamadas;
    assert.equal(a.url, 'https://api.mercadopago.com/v1/payments/123/refunds');
    assert.equal(a.metodo, 'POST');
    assert.equal(a.headers.authorization, `Bearer ${TOKEN_LOJA}`);
    assert.equal(a.headers['x-idempotency-key'], 'k1');
    assert.deepEqual(a.corpo, {});
    assert.deepEqual(b.corpo, { amount: 5 });
    assert.equal(b.headers['x-idempotency-key'], 'k2');
  });

  test('estorno recusado vira ErroMercadoPago; consulta traz o valor já reembolsado', async () => {
    const mp = criarClienteMercadoPago({ config, fetch: fetchFalso({ message: 'Payment too old to be refunded', error: 'bad_request' }, 400).fetch });
    await assert.rejects(() => mp.estornar(TOKEN_LOJA, '1', { idempotencyKey: 'k' }), (e) => e instanceof ErroMercadoPago && e.status === 400);
    const consulta = criarClienteMercadoPago({ config, fetch: fetchFalso({ id: 1, status: 'approved', transaction_amount: 30, transaction_amount_refunded: 7.5 }).fetch });
    assert.equal((await consulta.consultarPagamento(TOKEN_LOJA, '1')).valorReembolsadoCentavos, 750);
  });

  test('consultarEstorno e listarEstornos: GET com o token da loja, no nosso formato', async () => {
    const um = fetchFalso({ id: 88, status: 'in_process', amount: 3 }, 200);
    const mp = criarClienteMercadoPago({ config, fetch: um.fetch });
    assert.deepEqual(await mp.consultarEstorno(TOKEN_LOJA, '123', '88'), { id: '88', status: 'in_process', valorCentavos: 300 });
    assert.equal(um.chamadas[0].url, 'https://api.mercadopago.com/v1/payments/123/refunds/88');
    assert.equal(um.chamadas[0].metodo, 'GET');
    assert.equal(um.chamadas[0].headers.authorization, `Bearer ${TOKEN_LOJA}`);
    const lista = fetchFalso([{ id: 1, status: 'approved', amount: 5 }, { id: 2, status: 'rejected', amount: 5 }, { sem: 'id' }], 200);
    const todos = await criarClienteMercadoPago({ config, fetch: lista.fetch }).listarEstornos(TOKEN_LOJA, '123');
    assert.equal(lista.chamadas[0].url, 'https://api.mercadopago.com/v1/payments/123/refunds');
    assert.deepEqual(todos, [
      { id: '1', status: 'approved', valorCentavos: 500 },
      { id: '2', status: 'rejected', valorCentavos: 500 },
    ]);
  });

  test('erroNoEmailDoPagador: só quando o message/cause aponta o e-mail', () => {
    const email = new ErroMercadoPago('x', { status: 400, codigo: 'bad_request', detalhe: 'payer.email *** is invalid [4050: payer.email must be a valid email]' });
    const outro = new ErroMercadoPago('x', { status: 400, codigo: 'bad_request', detalhe: 'Collector user without key enabled for QR render [13253: x]' });
    assert.equal(erroNoEmailDoPagador(email), true);
    assert.equal(erroNoEmailDoPagador(new ErroMercadoPago('x', { detalhe: 'Invalid E-mail' })), true);
    assert.equal(erroNoEmailDoPagador(outro), false);
    assert.equal(erroNoEmailDoPagador(new Error('e-mail')), false, 'só erro do Mercado Pago');
    assert.equal(erroNoEmailDoPagador(null), false);
  });
});

describe('estorno, aceite e PDV (pagamento online, Etapa 5)', { skip: semBancoDeTeste }, () => {
  let prisma;
  let servidor;
  let base;
  let tk = {};
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

  /** Mercado Pago falso. `falharPix`: erro na criação; `falharEstorno`: 'erro' | 'recusado' | null. */
  const mp = {
    chamadas: [],
    pagamentos: new Map(),
    proximoId: 50000,
    falharPix: null,
    falharEstorno: null,
    async criarPix(token, dados) {
      mp.chamadas.push({ tipo: 'criarPix', token, dados });
      if (mp.falharPix) throw mp.falharPix;
      const id = String(mp.proximoId++);
      const r = {
        id,
        status: 'pending',
        statusDetail: 'pending_waiting_transfer',
        valorCentavos: dados.valorCentavos,
        comissaoCentavos: dados.comissaoCentavos > 0 ? dados.comissaoCentavos : null,
        valorReembolsadoCentavos: 0,
        referenciaExterna: String(dados.pedidoId),
        collectorId: CONTA_MP,
        qrCode: `pix-${id}`,
        qrCodeBase64: 'iVBOR',
        expiraEm: null,
        aprovadoEm: null,
      };
      mp.pagamentos.set(id, { r });
      return { ...r };
    },
    async consultarPagamento(token, id) {
      mp.chamadas.push({ tipo: 'consultar', token, id });
      return { ...mp.pagamentos.get(String(id)).r };
    },
    async cancelarPagamento(token, id) {
      mp.chamadas.push({ tipo: 'cancelar', token, id });
      mp.mudar(id, { status: 'cancelled' });
      return { ...mp.pagamentos.get(String(id)).r };
    },
    /**
     * `falharEstorno`: 'erro' (recusa sem criar), 'recusado' (cria rejeitado), 'processando'
     * (cria em processamento, sem mexer no reembolsado) ou 'caiu' (cria aprovado, mas a resposta
     * não chega: erro de rede).
     */
    async estornar(token, id, dados) {
      mp.chamadas.push({ tipo: 'estornar', token, id, dados });
      if (mp.falharEstorno === 'erro') throw new ErroMercadoPago('Mercado Pago recusou (400)', { status: 400, codigo: 'bad_request', detalhe: 'Saldo insuficiente na conta' });
      const p = mp.pagamentos.get(String(id));
      const valor = dados.valorCentavos ?? p.r.valorCentavos - p.r.valorReembolsadoCentavos;
      const refund = { id: `r-${mp.chamadas.length}`, status: 'approved', valorCentavos: valor };
      p.refunds = [...(p.refunds ?? []), refund];
      if (mp.falharEstorno === 'recusado') return { ...refund, status: (refund.status = 'rejected') };
      if (mp.falharEstorno === 'processando') return { ...refund, status: (refund.status = 'in_process') };
      mp.aprovarEstorno(id, refund.id);
      if (mp.falharEstorno === 'caiu') throw new ErroMercadoPago('Mercado Pago fora do ar ou sem resposta', { codigo: 'TEMPO_ESGOTADO' });
      return { ...refund };
    },
    /** O Mercado Pago conclui um estorno (aprovado): soma no reembolsado do pagamento. */
    aprovarEstorno(id, refundId) {
      const p = mp.pagamentos.get(String(id));
      const refund = p.refunds.find((e) => e.id === refundId);
      refund.status = 'approved';
      const reembolsado = p.r.valorReembolsadoCentavos + refund.valorCentavos;
      mp.mudar(id, { valorReembolsadoCentavos: reembolsado, status: reembolsado >= p.r.valorCentavos ? 'refunded' : 'approved' });
    },
    async consultarEstorno(token, id, refundId) {
      mp.chamadas.push({ tipo: 'consultarEstorno', token, id, refundId });
      return { ...mp.pagamentos.get(String(id)).refunds.find((e) => e.id === refundId) };
    },
    async listarEstornos(token, id) {
      mp.chamadas.push({ tipo: 'listarEstornos', token, id });
      return (mp.pagamentos.get(String(id)).refunds ?? []).map((e) => ({ ...e }));
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
      return loja && destino ? { ...campos, distanciaMetros: 3200, distanciaOrigem: 'ROTA' } : campos;
    },
  };

  async function api(metodo, rota, { token, corpo } = {}) {
    const res = await fetch(`${base}${rota}`, {
      method: metodo,
      headers: { ...(token && { authorization: `Bearer ${token}` }), ...(corpo !== undefined && { 'content-type': 'application/json' }) },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const texto = await res.text();
    return { status: res.status, corpo: texto ? JSON.parse(texto) : null };
  }

  let seq = 0;
  async function novoCliente({ verificado = false, email = `e${++seq}@teste.com` } = {}) {
    const { gerarTokenCliente } = await import('../src/lib/tokens.js');
    const tel = `4398${String(200000 + ++seq * 13).slice(-6)}0`.slice(0, 11);
    const cliente = await prisma.cliente.create({
      data: { nome: `Cliente ${seq}`, email, telefone: tel, telefoneVerificado: verificado, telefoneVerificadoEm: verificado ? agora : null },
    });
    const endereco = await prisma.endereco.create({
      data: { clienteId: cliente.id, rua: 'Rua B', numero: '20', bairroId: centro.id, principal: true, ...PINO_CLIENTE },
    });
    return { cliente, endereco, token: gerarTokenCliente(cliente) };
  }

  const itens = () => [{ produtoId: produto.id, quantidade: 1 }];

  async function pedir(c, extra = {}) {
    const p = await api('POST', '/cliente/pedidos/previa', { token: c.token, corpo: { itens: itens(), enderecoId: c.endereco.id, origem: 'APP' } });
    assert.equal(p.status, 200, JSON.stringify(p.corpo));
    const corpo = { itens: itens(), enderecoId: c.endereco.id, totalEsperadoCentavos: p.corpo.previa.totalCentavos, origem: 'APP', ...extra };
    if (!corpo.pagamentoOnline && !corpo.formaPagamento) corpo.formaPagamento = 'DINHEIRO';
    return api('POST', '/cliente/pedidos', { token: c.token, corpo });
  }

  async function notificar(mpPaymentId) {
    const requestId = `req-${++seq}`;
    const corpo = { id: Number(`${Date.now()}${seq}`.slice(-12)), type: 'payment', action: 'payment.updated', user_id: Number(CONTA_MP), data: { id: String(mpPaymentId) } };
    const res = await fetch(`${base}/mercadopago/webhook?data.id=${mpPaymentId}&type=payment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-signature': assinar({ dataId: mpPaymentId, requestId, ts: tsDe(agora) }), 'x-request-id': requestId },
      body: JSON.stringify(corpo),
    });
    assert.equal(res.status, 200);
    await pagamentos.aguardarProcessamentos();
  }

  const noBanco = (id) =>
    prisma.pedido.findUnique({ where: { id }, include: { pagamentos: { include: { estornos: true } }, usoCampanha: true, impressoes: true } });
  const estoquePao = async () => (await prisma.insumo.findFirst({ where: { nome: 'Pão de lanche', lojaId: 1 } })).estoque;
  const daEquipe = async (id) =>
    (await api('GET', '/equipe/pedidos?dataRef=2026-11-14&status=todos', { token: tk.ana })).corpo.pedidos.find((p) => p.id === id);
  const alertas = (tipo, pedidoId) => prisma.alertaPlataforma.count({ where: { tipo, pedidoId } });

  /** Pedido pago por Pix e aprovado (chega ao PDV). */
  async function pedidoPago(c) {
    const r = await pedir(c, { pagamentoOnline: 'PIX' });
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    const id = r.corpo.pedido.id;
    const { mpPaymentId } = (await noBanco(id)).pagamentos[0];
    mp.mudar(mpPaymentId, { status: 'approved', aprovadoEm: agora.toISOString() });
    await notificar(mpPaymentId);
    assert.equal((await noBanco(id)).status, 'CONFIRMADO');
    return { id, mpPaymentId };
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
    const usuarios = await import('../src/services/usuario.service.js');
    const { criarServicoPagamentos } = await import('../src/services/pagamento.service.js');
    const { cifrar } = await import('../src/lib/cifra.js');
    const { aoEmitirParaEquipe } = await import('../src/lib/eventos.js');

    produto = await prisma.produto.findFirstOrThrow({ where: { nome: 'X-Burguer', lojaId: 1 } });
    await prisma.produto.updateMany({ data: { disponivelHoje: true, ativo: true } });
    await prisma.insumo.updateMany({ data: { estoque: 500 } });
    centro = await criarBairro(prisma, { nome: 'Centro', taxaCentavos: 500 });
    await usuarios.criarAtendente({ nome: 'Ana', email: 'ana@estorno.test', senha: 'senha-da-ana' });
    await usuarios.criarDono({ nome: 'Dono', email: 'dono@estorno.test', senha: 'senha-do-dono' });
    await usuarios.criarDono({ nome: 'Plataforma', email: 'admin@estorno.test', senha: 'senha-do-admin' });
    await usuarios.promoverAAdmin('admin@estorno.test');
    await prisma.conexaoMercadoPago.create({
      data: { lojaId: 1, mpUserId: CONTA_MP, accessTokenCifrado: cifrar(TOKEN_LOJA, Buffer.from(CHAVE_HEX, 'hex')), status: 'CONECTADA' },
    });

    pagamentos = criarServicoPagamentos({ mercadoPago: mp, log: { warn: (m) => avisos.push(String(m)) } });
    servidor = http.createServer(criarApp({ log: false, relogio: () => agora, mapas, pagamentos }));
    await new Promise((resolve) => servidor.listen(0, resolve));
    base = `http://127.0.0.1:${servidor.address().port}/api`;
    const login = async (email, senha) => (await api('POST', '/auth/login', { corpo: { email, senha } })).corpo.accessToken;
    tk = { ana: await login('ana@estorno.test', 'senha-da-ana'), dono: await login('dono@estorno.test', 'senha-do-dono'), admin: await login('admin@estorno.test', 'senha-do-admin') };
    pararEventos = aoEmitirParaEquipe((evento, dados, lojaId) => eventos.push({ evento, dados, lojaId }));
  });

  beforeEach(async () => {
    agora = SABADO_20H;
    eventos = [];
    mp.falharPix = null;
    mp.falharEstorno = null;
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

  test('Pix recusado pelo e-mail do pagador: 422 com a mensagem própria; outros erros: 502 genérico', async () => {
    const c = await novoCliente();
    mp.falharPix = new ErroMercadoPago('Mercado Pago recusou (400)', { status: 400, codigo: 'bad_request', detalhe: 'payer.email *** is invalid [4050: payer.email must be a valid email]' });
    const email = await pedir(c, { pagamentoOnline: 'PIX' });
    assert.equal(email.status, 422);
    assert.equal(email.corpo.erro.codigo, 'EMAIL_RECUSADO_PAGAMENTO');
    assert.equal(email.corpo.erro.mensagem, 'O Mercado Pago não aceitou este e-mail para pagamento. Confira o e-mail no seu cadastro e tente de novo.');
    mp.falharPix = new ErroMercadoPago('Mercado Pago recusou (400)', { status: 400, codigo: 'bad_request', detalhe: 'Collector user without key enabled for QR render' });
    const outro = await pedir(c, { pagamentoOnline: 'PIX' });
    assert.equal(outro.status, 502);
    assert.equal(outro.corpo.erro.codigo, 'PAGAMENTO_FALHOU');
    // Os dois pedidos expiraram (estoque de volta), como antes.
    assert.equal(await prisma.pedido.count({ where: { clienteId: c.cliente.id, status: 'EXPIRADO' } }), 2);
  });

  test('o pedido pago online nasce com o meio, chega sem aceite e o cliente vê "pode cancelar"', async () => {
    const c = await novoCliente();
    const { id } = await pedidoPago(c);
    const banco = await noBanco(id);
    assert.equal(banco.meioOnline, 'PIX');
    assert.equal(banco.aceitoEm, null);
    const equipe = await daEquipe(id);
    assert.deepEqual(equipe.pagamentoOnline, { meio: 'PIX', tipo: null, situacao: 'PAGO', aprovadoEm: banco.pagamentos[0].aprovadoEm.toISOString(), valorEstornadoCentavos: 0 });
    assert.equal(equipe.entregaPlataforma, true);
    const lista = (await api('GET', '/cliente/pedidos', { token: c.token })).corpo.pedidos;
    assert.equal(lista.find((p) => p.id === id).podeCancelar, true);
    // Pago na entrega: sem pagamento online, sem "pode cancelar".
    const naEntrega = await pedir(c);
    assert.equal(naEntrega.corpo.pedido.pagamentoOnline, null);
    assert.equal(naEntrega.corpo.pedido.podeCancelar, false);
  });

  test('recusa da loja antes do aceite: estorno total, cancelado, estoque, campanha e cupom', async () => {
    const c = await novoCliente({ verificado: true });
    const pao = await estoquePao();
    const { id, mpPaymentId } = await pedidoPago(c);
    assert.ok((await noBanco(id)).usoCampanha, 'campanha usada na aprovação');
    assert.equal(await estoquePao(), pao - 1);
    eventos = [];

    const r = await api('PATCH', `/equipe/pedidos/${id}/cancelar`, { token: tk.ana });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.equal(r.corpo.pedido.status, 'CANCELADO');
    assert.equal(r.corpo.pedido.pagamentoOnline.situacao, 'ESTORNADO');
    const banco = await noBanco(id);
    assert.equal(banco.pagamentos[0].status, 'REEMBOLSADO');
    assert.equal(banco.pagamentos[0].valorReembolsadoCentavos, banco.totalCentavos);
    assert.equal(banco.pagamentos[0].estornos.length, 1);
    assert.equal(banco.pagamentos[0].estornos[0].status, 'CONCLUIDO');
    assert.equal(banco.pagamentos[0].estornos[0].origem, 'AUTOMATICO');
    assert.equal(banco.pagamentos[0].estornos[0].motivo, 'Recusado pela loja');
    const [estorno] = chamadasDe('estornar').filter((x) => x.id === mpPaymentId);
    assert.equal(estorno.token, TOKEN_LOJA);
    assert.equal(estorno.dados.valorCentavos, null, 'total: sem amount');
    assert.equal(estorno.dados.idempotencyKey, banco.pagamentos[0].estornos[0].idempotencyKey);
    assert.equal(await estoquePao(), pao);
    assert.equal(banco.usoCampanha, null, 'campanha liberada');
    assert.ok(banco.impressoes.some((t) => t.tipo === 'CANCELAMENTO'));
    assert.ok(eventos.some((e) => e.evento === 'pedido:atualizado' && e.dados.pagamentoOnline?.situacao === 'ESTORNADO'));

    // Cancelar de novo: 409 e nenhum estorno a mais (idempotência).
    const antes = chamadasDe('estornar').length;
    assert.equal((await api('PATCH', `/equipe/pedidos/${id}/cancelar`, { token: tk.ana })).corpo.erro.codigo, 'PEDIDO_ENCERRADO');
    assert.equal(chamadasDe('estornar').length, antes);
  });

  test('aceite: botão ou Em preparo; depois dele a loja e o cliente não cancelam', async () => {
    const c = await novoCliente();
    const a = await pedidoPago(c);
    const aceito = await api('PATCH', `/equipe/pedidos/${a.id}/aceitar`, { token: tk.ana });
    assert.equal(aceito.status, 200);
    assert.ok(aceito.corpo.pedido.aceitoEm);
    assert.equal((await api('PATCH', `/equipe/pedidos/${a.id}/aceitar`, { token: tk.ana })).status, 200, 'aceitar de novo é idempotente');
    const loja = await api('PATCH', `/equipe/pedidos/${a.id}/cancelar`, { token: tk.ana });
    assert.equal(loja.status, 409);
    assert.equal(loja.corpo.erro.codigo, 'CANCELAR_COM_TAAKI');
    const cliente = await api('POST', `/cliente/pedidos/${a.id}/cancelar`, { token: c.token });
    assert.equal(cliente.status, 409);
    assert.equal(cliente.corpo.erro.codigo, 'PEDIDO_JA_ACEITO');
    assert.equal((await noBanco(a.id)).status, 'CONFIRMADO');

    const b = await pedidoPago(c);
    await api('PATCH', `/equipe/pedidos/${b.id}/status`, { token: tk.ana, corpo: { status: 'EM_PREPARO' } });
    assert.ok((await noBanco(b.id)).aceitoEm, 'Em preparo conta como aceite');
    assert.equal((await api('PATCH', `/equipe/pedidos/${b.id}/cancelar`, { token: tk.ana })).corpo.erro.codigo, 'CANCELAR_COM_TAAKI');

    // Pago na entrega: sem aceite, cancela como sempre.
    const naEntrega = (await pedir(c)).corpo.pedido;
    assert.equal((await api('PATCH', `/equipe/pedidos/${naEntrega.id}/aceitar`, { token: tk.ana })).corpo.erro.codigo, 'SEM_ACEITE');
    assert.equal((await api('PATCH', `/equipe/pedidos/${naEntrega.id}/cancelar`, { token: tk.ana })).status, 200);
  });

  test('cliente cancela pelo app antes do aceite: estorno total; outro cliente = 404; pago na entrega = WhatsApp', async () => {
    const c = await novoCliente();
    const outro = await novoCliente();
    const { id } = await pedidoPago(c);
    assert.equal((await api('POST', `/cliente/pedidos/${id}/cancelar`, { token: outro.token })).status, 404);
    const r = await api('POST', `/cliente/pedidos/${id}/cancelar`, { token: c.token });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.equal(r.corpo.pedido.status, 'CANCELADO');
    assert.equal(r.corpo.pedido.pagamentoOnline.situacao, 'ESTORNADO');
    assert.equal(r.corpo.pedido.podeCancelar, false);
    const banco = await noBanco(id);
    assert.equal(banco.pagamentos[0].status, 'REEMBOLSADO');
    assert.equal(banco.pagamentos[0].estornos[0].motivo, 'Cancelado pelo cliente antes do aceite da loja');
    const naEntrega = (await pedir(c)).corpo.pedido;
    assert.equal((await api('POST', `/cliente/pedidos/${naEntrega.id}/cancelar`, { token: c.token })).corpo.erro.codigo, 'CANCELAR_PELO_WHATSAPP');
  });

  test('ADMIN: parcial em pedido aceito (cancela, estoque volta), motivo obrigatório, valor até o pago; DONO = 403', async () => {
    const c = await novoCliente();
    const pao = await estoquePao();
    const { id, mpPaymentId } = await pedidoPago(c);
    await api('PATCH', `/equipe/pedidos/${id}/aceitar`, { token: tk.ana });
    assert.equal((await api('POST', `/plataforma/pedidos/${id}/estornar`, { token: tk.dono, corpo: { motivo: 'x' } })).status, 403);
    assert.equal((await api('POST', `/plataforma/pedidos/${id}/estornar`, { token: tk.admin, corpo: { valorCentavos: 500 } })).status, 400);
    const total = (await noBanco(id)).totalCentavos;
    const demais = await api('POST', `/plataforma/pedidos/${id}/estornar`, { token: tk.admin, corpo: { valorCentavos: total + 1, motivo: 'Item faltando' } });
    assert.equal(demais.status, 400);
    assert.equal((await noBanco(id)).status, 'CONFIRMADO', 'valor inválido não cancela (transação desfeita)');

    const r = await api('POST', `/plataforma/pedidos/${id}/estornar`, { token: tk.admin, corpo: { valorCentavos: 500, motivo: 'Item faltando' } });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.equal(r.corpo.cancelado, true);
    const banco = await noBanco(id);
    assert.equal(banco.status, 'CANCELADO');
    assert.equal(banco.pagamentos[0].status, 'REEMBOLSO_PARCIAL');
    assert.equal(banco.pagamentos[0].valorReembolsadoCentavos, 500);
    assert.equal(banco.pagamentos[0].estornos[0].origem, 'ADMIN');
    assert.equal(banco.pagamentos[0].estornos[0].motivo, 'Item faltando');
    assert.equal(chamadasDe('estornar').filter((x) => x.id === mpPaymentId).at(-1).dados.valorCentavos, 500);
    assert.equal(await estoquePao(), pao);
  });

  test('ADMIN em pedido finalizado: estorna sem cancelar, estoque não volta, relatório mostra à parte', async () => {
    const c = await novoCliente();
    const { id } = await pedidoPago(c);
    // Finalizar pago online: sem caixa aberto e sem forma (Decisão 9).
    assert.equal(await prisma.caixa.count({ where: { fechadoEm: null } }), 0);
    const fim = await api('PATCH', `/equipe/pedidos/${id}/finalizar`, { token: tk.ana, corpo: {} });
    assert.equal(fim.status, 200, JSON.stringify(fim.corpo));
    let banco = await noBanco(id);
    assert.equal(banco.status, 'FINALIZADO');
    assert.equal(banco.caixaId, null);
    assert.equal(banco.formaPagamento, 'PIX');
    const pao = await estoquePao();
    const rel = async () => (await api('GET', '/retaguarda/relatorios/dia?data=2026-11-14', { token: tk.dono })).corpo;
    const antes = await rel();

    const r = await api('POST', `/plataforma/pedidos/${id}/estornar`, { token: tk.admin, corpo: { valorCentavos: 300, motivo: 'Bebida quente' } });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.equal(r.corpo.cancelado, false);
    banco = await noBanco(id);
    assert.equal(banco.status, 'FINALIZADO');
    assert.equal(banco.pagamentos[0].status, 'REEMBOLSO_PARCIAL');
    assert.equal(await estoquePao(), pao);
    const depois = await rel();
    assert.equal(depois.estornosDeFinalizados.quantidade, antes.estornosDeFinalizados.quantidade + 1);
    assert.equal(depois.estornosDeFinalizados.totalCentavos, antes.estornosDeFinalizados.totalCentavos + 300);
    assert.equal(depois.totalCentavos, antes.totalCentavos, 'fora dos totais');
    // O resto também pode ser estornado (total do que falta).
    assert.equal((await api('POST', `/plataforma/pedidos/${id}/estornar`, { token: tk.admin, corpo: { motivo: 'Cliente reclamou' } })).status, 200);
    assert.equal((await noBanco(id)).pagamentos[0].status, 'REEMBOLSADO');
  });

  test('relatório: pago online separado das formas pagas na entrega; EXPIRADO não é cancelado', async () => {
    const rel = async () => (await api('GET', '/retaguarda/relatorios/dia?data=2026-11-14', { token: tk.dono })).corpo;
    const antes = await rel();
    const c = await novoCliente();
    const { id } = await pedidoPago(c);
    await api('PATCH', `/equipe/pedidos/${id}/finalizar`, { token: tk.ana, corpo: {} });
    mp.falharPix = new ErroMercadoPago('x', { status: 500 });
    await pedir(c, { pagamentoOnline: 'PIX' }); // expira
    const depois = await rel();
    const pix = (r) => r.pagoOnline.find((p) => p.meio === 'PIX');
    assert.equal(pix(depois).quantidade, pix(antes).quantidade + 1);
    assert.deepEqual(depois.porFormaPagamento, antes.porFormaPagamento, 'o online não entra nas formas na entrega');
    assert.equal(depois.cancelados.quantidade, antes.cancelados.quantidade);
  });

  test('finalizar: pago na entrega continua exigindo caixa e forma; estornado por fora = 409', async () => {
    const c = await novoCliente();
    const naEntrega = (await pedir(c)).corpo.pedido;
    assert.equal((await api('PATCH', `/equipe/pedidos/${naEntrega.id}/finalizar`, { token: tk.ana, corpo: {} })).status, 400);
    assert.equal((await api('PATCH', `/equipe/pedidos/${naEntrega.id}/finalizar`, { token: tk.ana, corpo: { formaPagamento: 'DINHEIRO' } })).corpo.erro.codigo, 'CAIXA_FECHADO');
    assert.equal((await daEquipe(naEntrega.id)).entregaPlataforma, true, 'dinheiro em loja PLATAFORMA = "Recebi o dinheiro"');
  });

  test('estorno recusado: CANCELADO, REEMBOLSO_PENDENTE, alerta e nenhuma retentativa; ADMIN tenta de novo', async () => {
    const c = await novoCliente();
    const { id, mpPaymentId } = await pedidoPago(c);
    mp.falharEstorno = 'erro';
    const r = await api('PATCH', `/equipe/pedidos/${id}/cancelar`, { token: tk.ana });
    assert.equal(r.status, 200, 'a recusa vale mesmo com o estorno falhando (Decisão 10)');
    assert.equal(r.corpo.pedido.pagamentoOnline.situacao, 'ESTORNO_PENDENTE');
    let banco = await noBanco(id);
    assert.equal(banco.status, 'CANCELADO');
    assert.equal(banco.pagamentos[0].status, 'REEMBOLSO_PENDENTE');
    assert.equal(banco.pagamentos[0].estornos[0].status, 'FALHOU');
    assert.match(banco.pagamentos[0].estornos[0].erro, /Saldo insuficiente/);
    assert.equal(await alertas('REEMBOLSO_FALHOU', id), 1);
    assert.ok(!avisos.some((a) => a.includes(TOKEN_LOJA)), 'token nunca no log');

    // Nenhuma retentativa automática: a rotina não chama o estorno de novo.
    const chamadas = chamadasDe('estornar').length;
    await pagamentos.rodarRotina(new Date(agora.getTime() + 5 * MINUTO));
    assert.equal(chamadasDe('estornar').length, chamadas);

    // Aparece para o ADMIN como pendente de ação.
    const lista = await api('GET', '/plataforma/pagamentos?acao=sim', { token: tk.admin });
    const item = lista.corpo.pagamentos.find((p) => p.pedido.id === id);
    assert.equal(item.status, 'REEMBOLSO_PENDENTE');
    assert.equal(item.estornos[0].status, 'FALHOU');

    // Tentar de novo: chave NOVA, dá certo, alerta resolvido.
    mp.falharEstorno = null;
    const de = await api('POST', `/plataforma/pagamentos/${item.id}/tentar-estorno`, { token: tk.admin });
    assert.equal(de.status, 200, JSON.stringify(de.corpo));
    assert.equal(de.corpo.resultado, 'CONCLUIDO');
    banco = await noBanco(id);
    assert.equal(banco.pagamentos[0].status, 'REEMBOLSADO');
    const [e1, e2] = banco.pagamentos[0].estornos.sort((a, b) => a.id - b.id);
    assert.equal(e1.status, 'FALHOU');
    assert.equal(e2.status, 'CONCLUIDO');
    assert.notEqual(e1.idempotencyKey, e2.idempotencyKey);
    assert.equal(await prisma.alertaPlataforma.count({ where: { tipo: 'REEMBOLSO_FALHOU', pedidoId: id, resolvidoEm: null } }), 0);
    assert.equal(chamadasDe('estornar').filter((x) => x.id === mpPaymentId).length, 2);
    // Sem pendente: 409.
    assert.equal((await api('POST', `/plataforma/pagamentos/${item.id}/tentar-estorno`, { token: tk.admin })).corpo.erro.codigo, 'SEM_REEMBOLSO_PENDENTE');
  });

  test('tentar de novo quando o Mercado Pago já estornou: só conclui, sem estornar duas vezes', async () => {
    const c = await novoCliente();
    const { id, mpPaymentId } = await pedidoPago(c);
    mp.falharEstorno = 'recusado';
    await api('PATCH', `/equipe/pedidos/${id}/cancelar`, { token: tk.ana });
    const pagamento = (await noBanco(id)).pagamentos[0];
    assert.equal(pagamento.status, 'REEMBOLSO_PENDENTE');
    mp.mudar(mpPaymentId, { status: 'refunded', valorReembolsadoCentavos: pagamento.valorTotalCentavos });
    const chamadas = chamadasDe('estornar').length;
    const r = await api('POST', `/plataforma/pagamentos/${pagamento.id}/tentar-estorno`, { token: tk.admin });
    assert.equal(r.corpo.resultado, 'CONCLUIDO');
    assert.equal(chamadasDe('estornar').length, chamadas);
    assert.equal((await noBanco(id)).pagamentos[0].status, 'REEMBOLSADO');
  });

  test('tentar de novo com o estorno em processamento no Mercado Pago: consulta esse estorno, nunca pede outro', async () => {
    const c = await novoCliente();
    const { id, mpPaymentId } = await pedidoPago(c);
    mp.falharEstorno = 'processando';
    await api('PATCH', `/equipe/pedidos/${id}/cancelar`, { token: tk.ana });
    mp.falharEstorno = null;
    let pagamento = (await noBanco(id)).pagamentos[0];
    assert.equal(pagamento.status, 'REEMBOLSO_PENDENTE');
    const [estorno] = pagamento.estornos;
    assert.equal(estorno.status, 'PROCESSANDO');
    assert.ok(estorno.mpRefundId);
    const chamadas = chamadasDe('estornar').length;

    // Passados os 2 minutos, o ADMIN tenta de novo: ainda processando lá = 409, nada novo.
    // (o criadoEm do estorno é o relógio do banco)
    agora = new Date(Date.now() + 5 * MINUTO);
    const r1 = await api('POST', `/plataforma/pagamentos/${pagamento.id}/tentar-estorno`, { token: tk.admin });
    assert.equal(r1.status, 409);
    assert.equal(r1.corpo.erro.codigo, 'ESTORNO_EM_ANDAMENTO');
    assert.equal(chamadasDe('consultarEstorno').at(-1).refundId, estorno.mpRefundId);
    assert.equal(chamadasDe('estornar').length, chamadas, 'nenhum estorno novo');

    // O Mercado Pago conclui: tentar de novo só conclui o nosso (o mesmo id).
    mp.aprovarEstorno(mpPaymentId, estorno.mpRefundId);
    const r2 = await api('POST', `/plataforma/pagamentos/${pagamento.id}/tentar-estorno`, { token: tk.admin });
    assert.equal(r2.corpo.resultado, 'CONCLUIDO');
    assert.equal(chamadasDe('estornar').length, chamadas, 'nenhum estorno novo');
    pagamento = (await noBanco(id)).pagamentos[0];
    assert.equal(pagamento.status, 'REEMBOLSADO');
    assert.equal(pagamento.estornos.length, 1);
    assert.equal(pagamento.estornos[0].status, 'CONCLUIDO');
  });

  test('tentar de novo quando a resposta do estorno se perdeu (o Mercado Pago criou): acha pela lista e conclui', async () => {
    const c = await novoCliente();
    const { id, mpPaymentId } = await pedidoPago(c);
    // Estorno parcial pelo ADMIN com a resposta perdida: no Mercado Pago o estorno existe.
    await api('PATCH', `/equipe/pedidos/${id}/aceitar`, { token: tk.ana });
    await api('PATCH', `/equipe/pedidos/${id}/finalizar`, { token: tk.ana, corpo: {} });
    mp.falharEstorno = 'caiu';
    const parcial = await api('POST', `/plataforma/pedidos/${id}/estornar`, { token: tk.admin, corpo: { valorCentavos: 300, motivo: 'Item faltando' } });
    assert.equal(parcial.status, 200, JSON.stringify(parcial.corpo));
    mp.falharEstorno = null;
    let pagamento = (await noBanco(id)).pagamentos[0];
    assert.equal(pagamento.status, 'REEMBOLSO_PENDENTE');
    assert.equal(pagamento.estornos[0].status, 'FALHOU');
    // O reembolsado lá já subiu, mas a regra da lista vale também quando a consulta ainda não mostra.
    mp.mudar(mpPaymentId, { valorReembolsadoCentavos: 0, status: 'approved' });
    const chamadas = chamadasDe('estornar').length;
    const r = await api('POST', `/plataforma/pagamentos/${pagamento.id}/tentar-estorno`, { token: tk.admin });
    assert.equal(r.corpo.resultado, 'CONCLUIDO', JSON.stringify(r.corpo));
    assert.equal(chamadasDe('estornar').length, chamadas, 'nenhum estorno novo');
    pagamento = (await noBanco(id)).pagamentos[0];
    assert.equal(pagamento.status, 'REEMBOLSO_PARCIAL');
    assert.equal(pagamento.valorReembolsadoCentavos, 300);
    assert.ok(pagamento.estornos[0].mpRefundId);
  });

  test('resolvido por fora: observação obrigatória; pagamento REEMBOLSADO', async () => {
    const c = await novoCliente();
    const { id } = await pedidoPago(c);
    mp.falharEstorno = 'erro';
    await api('PATCH', `/equipe/pedidos/${id}/cancelar`, { token: tk.ana });
    const pagamento = (await noBanco(id)).pagamentos[0];
    assert.equal((await api('POST', `/plataforma/pagamentos/${pagamento.id}/resolvido`, { token: tk.admin, corpo: {} })).status, 400);
    const r = await api('POST', `/plataforma/pagamentos/${pagamento.id}/resolvido`, { token: tk.admin, corpo: { observacao: 'Pix devolvido pela loja direto ao cliente' } });
    assert.equal(r.status, 204);
    const depois = (await noBanco(id)).pagamentos[0];
    assert.equal(depois.status, 'REEMBOLSADO');
    const estorno = depois.estornos.find((e) => e.status === 'RESOLVIDO_POR_FORA');
    assert.equal(estorno.observacao, 'Pix devolvido pela loja direto ao cliente');
    assert.ok(estorno.resolvidoPorId);
  });

  test('pago depois de expirar (A_ESTORNAR) que ficou para trás: a rotina estorna uma vez só', async () => {
    const c = await novoCliente();
    const r = await pedir(c, { pagamentoOnline: 'PIX' });
    const id = r.corpo.pedido.id;
    const pagamento = (await noBanco(id)).pagamentos[0];
    // Simula o servidor caindo entre a aprovação atrasada e o estorno.
    await prisma.pedido.update({ where: { id }, data: { status: 'EXPIRADO' } });
    await prisma.pagamento.update({ where: { id: pagamento.id }, data: { status: 'A_ESTORNAR' } });
    mp.mudar(pagamento.mpPaymentId, { status: 'approved' });
    await pagamentos.rodarRotina(new Date(agora.getTime() + MINUTO));
    const depois = await noBanco(id);
    assert.equal(depois.status, 'EXPIRADO');
    assert.equal(depois.pagamentos[0].status, 'REEMBOLSADO');
    const chamadas = chamadasDe('estornar').length;
    await pagamentos.rodarRotina(new Date(agora.getTime() + 2 * MINUTO));
    assert.equal(chamadasDe('estornar').length, chamadas);
  });

  test('webhook: estorno feito direto no Mercado Pago com o pedido aberto = alerta, PDV "ESTORNADO", sem cancelar', async () => {
    const c = await novoCliente();
    const { id, mpPaymentId } = await pedidoPago(c);
    const total = (await noBanco(id)).totalCentavos;
    mp.mudar(mpPaymentId, { status: 'refunded', valorReembolsadoCentavos: total });
    await notificar(mpPaymentId);
    const banco = await noBanco(id);
    assert.equal(banco.status, 'CONFIRMADO', 'não cancela sozinho (Decisão 5)');
    assert.equal(banco.pagamentos[0].status, 'REEMBOLSADO');
    assert.equal(banco.pagamentos[0].estornos[0].origem, 'MERCADO_PAGO');
    assert.equal(await alertas('ESTORNO_EXTERNO', id), 1);
    assert.equal((await daEquipe(id)).pagamentoOnline.situacao, 'ESTORNADO');
    // Notificação repetida: nada a mais.
    await notificar(mpPaymentId);
    assert.equal((await noBanco(id)).pagamentos[0].estornos.length, 1);
    // Finalizar avisa que o pagamento foi estornado; cancelar pela loja (sem novo estorno) funciona.
    assert.equal((await api('PATCH', `/equipe/pedidos/${id}/finalizar`, { token: tk.ana, corpo: {} })).corpo.erro.codigo, 'PAGAMENTO_ESTORNADO');
    const antes = chamadasDe('estornar').length;
    assert.equal((await api('PATCH', `/equipe/pedidos/${id}/cancelar`, { token: tk.ana })).status, 200);
    assert.equal(chamadasDe('estornar').length, antes);
  });

  test('webhook: chargeback = CONTESTADO e alerta para o ADMIN (um por pedido)', async () => {
    const c = await novoCliente();
    const { id, mpPaymentId } = await pedidoPago(c);
    await api('PATCH', `/equipe/pedidos/${id}/finalizar`, { token: tk.ana, corpo: {} });
    mp.mudar(mpPaymentId, { status: 'charged_back' });
    await notificar(mpPaymentId);
    assert.equal((await noBanco(id)).pagamentos[0].status, 'CONTESTADO');
    assert.equal(await alertas('CHARGEBACK', id), 1);
    await notificar(mpPaymentId);
    assert.equal(await alertas('CHARGEBACK', id), 1);
    const lista = await api('GET', '/plataforma/pagamentos?acao=sim', { token: tk.admin });
    assert.ok(lista.corpo.pagamentos.some((p) => p.pedido.id === id && p.status === 'CONTESTADO'));
    // Contestado não é estornado pelo ADMIN (o Mercado Pago decide).
    assert.equal((await api('POST', `/plataforma/pedidos/${id}/estornar`, { token: tk.admin, corpo: { motivo: 'teste' } })).corpo.erro.codigo, 'ESTORNO_INDISPONIVEL');
  });

  test('pedido sem aceite: alerta PEDIDO_SEM_ACEITE aos 10 minutos, um só; aceito não alerta', async () => {
    const c = await novoCliente();
    const { id } = await pedidoPago(c);
    const aceito = await pedidoPago(c);
    await api('PATCH', `/equipe/pedidos/${aceito.id}/aceitar`, { token: tk.ana });
    await pagamentos.rodarRotina(new Date(agora.getTime() + 9 * MINUTO));
    assert.equal(await alertas('PEDIDO_SEM_ACEITE', id), 0);
    await pagamentos.rodarRotina(new Date(agora.getTime() + 10 * MINUTO));
    assert.equal(await alertas('PEDIDO_SEM_ACEITE', id), 1);
    assert.equal(await alertas('PEDIDO_SEM_ACEITE', aceito.id), 0);
    // Resolvido pelo ADMIN: não volta a alertar o mesmo pedido.
    const admin = await prisma.usuario.findUnique({ where: { email: 'admin@estorno.test' } });
    await prisma.alertaPlataforma.updateMany({ where: { tipo: 'PEDIDO_SEM_ACEITE', pedidoId: id }, data: { resolvidoEm: agora, resolvidoPorId: admin.id } });
    await pagamentos.rodarRotina(new Date(agora.getTime() + 11 * MINUTO));
    assert.equal(await alertas('PEDIDO_SEM_ACEITE', id), 1);
    // O cliente ainda pode cancelar enquanto não for aceito.
    assert.equal((await api('POST', `/cliente/pedidos/${id}/cancelar`, { token: c.token })).status, 200);
  });
});
