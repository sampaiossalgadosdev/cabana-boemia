/**
 * Etapa 6 do pagamento online (docs/pagamento-online.md): livro-razão da loja e fechamento
 * semanal. Lançamentos automáticos (PDV, site, app, frete grátis da loja, complemento da trava,
 * campanha nos dois modos), nada no online de loja PLATAFORMA, sem duplicidade, estorno no
 * cancelamento, semana pelo dia operacional e fuso, semana fechada imutável, semana vazia, saldo
 * zero, quitar, ajuste manual, resumo da campanha e alerta de atraso. Mercado Pago sempre FALSO.
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { semBancoDeTeste, resetarBancoDeTeste, criarBairro } from './helpers/banco.js';
import { manifestoDoWebhook } from '../src/lib/mercadoPago.js';
import {
  complementoDaAprovacao,
  diasDeAtraso,
  lancamentosDaFinalizacao,
  orcamentoCampanha,
  segundaDaSemana,
  semanaDe,
  separarPorSemana,
  textoDoSaldo,
} from '../src/services/livroRazao.service.js';

const CHAVE_HEX = 'ef'.repeat(32);
const SEGREDO_WEBHOOK = 'segredo-do-webhook-de-teste-etapa-6';
const TOKEN_LOJA = 'APP_USR-token-da-loja-6';
const CONTA_MP = '666000';
const SABADO_20H = new Date('2026-11-14T20:00:00-03:00'); // turno Lanches aberto
const PINO_LOJA = { latitude: -23.3049, longitude: -50.3133 };
const PINO_CLIENTE = { latitude: -23.31, longitude: -50.32 };
const DIA = 24 * 60 * 60 * 1000;

describe('livro-razão: regras puras', () => {
  const plataforma = { origemTaxaEntrega: 'AREA', valorEntregadorCentavos: 475, valorPlataformaEntregaCentavos: 25, origemFreteGratis: 'NENHUM', meioOnline: null };

  test('entrega pelo Taaki pago na loja: a taxa cheia, também com o frete grátis da loja; campanha não', () => {
    assert.deepEqual(lancamentosDaFinalizacao(plataforma), [{ tipo: 'TAXA_ENTREGA_DINHEIRO', valorCentavos: 500 }]);
    assert.deepEqual(lancamentosDaFinalizacao({ ...plataforma, origemFreteGratis: 'LOJA' }), [{ tipo: 'TAXA_ENTREGA_DINHEIRO', valorCentavos: 500 }]);
    assert.deepEqual(lancamentosDaFinalizacao({ ...plataforma, origemFreteGratis: 'CAMPANHA' }), []);
    assert.deepEqual(lancamentosDaFinalizacao({ ...plataforma, meioOnline: 'PIX' }), [], 'online: a taxa veio no split');
  });

  test('motoboy próprio: crédito só com a campanha (qualquer forma); sem ela, nada', () => {
    const proprio = { origemTaxaEntrega: null, taxaEntregaCheiaCentavos: 600, origemFreteGratis: 'CAMPANHA', meioOnline: null };
    assert.deepEqual(lancamentosDaFinalizacao(proprio), [{ tipo: 'CREDITO_CAMPANHA', valorCentavos: -600 }]);
    assert.deepEqual(lancamentosDaFinalizacao({ ...proprio, meioOnline: 'PIX' }), [{ tipo: 'CREDITO_CAMPANHA', valorCentavos: -600 }]);
    assert.deepEqual(lancamentosDaFinalizacao({ ...proprio, origemFreteGratis: 'NENHUM' }), []);
    assert.deepEqual(lancamentosDaFinalizacao({ ...proprio, origemFreteGratis: 'LOJA' }), []);
    assert.deepEqual(lancamentosDaFinalizacao({ ...proprio, taxaEntregaCheiaCentavos: null }), [], 'sem a taxa cheia gravada, sem crédito');
  });

  test('complemento: só no online, o que o split não levou', () => {
    const online = { ...plataforma, meioOnline: 'PIX' };
    assert.equal(complementoDaAprovacao(online, 300), 200);
    assert.equal(complementoDaAprovacao(online, 500), 0);
    assert.equal(complementoDaAprovacao({ ...online, origemFreteGratis: 'CAMPANHA' }, 0), 0);
    assert.equal(complementoDaAprovacao(plataforma, 0), 0, 'pago na entrega: o débito é o da finalização');
  });

  test('semana de segunda a domingo pelo dia operacional, no fuso de Brasília', () => {
    assert.equal(segundaDaSemana('2026-11-15'), '2026-11-09'); // domingo
    assert.equal(segundaDaSemana('2026-11-16'), '2026-11-16'); // segunda
    const domingo2359 = new Date('2026-11-15T23:59:00-03:00');
    const segunda0200 = new Date('2026-11-16T02:00:00-03:00');
    const segunda0400 = new Date('2026-11-16T04:00:00-03:00');
    assert.equal(semanaDe(domingo2359, 4).inicio, '2026-11-09');
    assert.equal(semanaDe(segunda0200, 4).inicio, '2026-11-09', 'antes da virada ainda é domingo');
    assert.equal(semanaDe(segunda0400, 4).inicio, '2026-11-16');
    assert.equal(semanaDe(segunda0200, 0).inicio, '2026-11-16', 'virada à meia-noite = dia civil');
    const s = semanaDe(domingo2359, 4);
    assert.equal(s.fim, '2026-11-16');
    assert.equal(s.domingo, '2026-11-15');
    assert.equal(s.de.toISOString(), '2026-11-09T07:00:00.000Z');
    assert.equal(s.ate.toISOString(), '2026-11-16T07:00:00.000Z');
  });

  test('semana atual × anterior fechando: pela data do lançamento no dia operacional, não pelo fechamento', () => {
    const l = (id, quando) => ({ id, criadoEm: new Date(quando) });
    const lista = [
      l(1, '2026-11-29T23:50:00-03:00'), // domingo
      l(2, '2026-11-30T03:59:00-03:00'), // segunda antes da virada = domingo
      l(3, '2026-11-30T04:00:00-03:00'), // segunda na virada = semana nova
      l(4, '2026-11-18T12:00:00-03:00'), // atrasado de semana mais antiga: entra no próximo fechamento
    ];
    const s = separarPorSemana(lista, new Date('2026-11-30T05:00:00-03:00'), 4);
    assert.equal(s.semana.inicio, '2026-11-30');
    assert.deepEqual([s.anterior.inicio, s.anterior.domingo], ['2026-11-23', '2026-11-29']);
    assert.deepEqual(s.daAtual.map((x) => x.id), [3]);
    assert.deepEqual(s.daAnterior.map((x) => x.id), [1, 2, 4]);
    // Semana anterior já fechada: o que sobrou dela vai no fechamento desta, então fica na atual.
    const fechada = separarPorSemana(lista, new Date('2026-11-30T05:00:00-03:00'), 4, { anteriorFechada: true });
    assert.deepEqual([fechada.daAtual.length, fechada.daAnterior.length], [4, 0]);
    // Virada à meia-noite: segunda 03:59 já é a semana nova.
    assert.deepEqual(separarPorSemana(lista, new Date('2026-11-30T05:00:00-03:00'), 0).daAtual.map((x) => x.id), [2, 3]);
  });

  test('textos e variáveis', () => {
    assert.equal(textoDoSaldo(1250), 'Você deve ao Taaki R$ 12,50');
    assert.equal(textoDoSaldo(-600), 'O Taaki deve a você R$ 6,00');
    assert.equal(textoDoSaldo(0), 'Nenhum valor a acertar com o Taaki');
    assert.equal(diasDeAtraso({}), 7);
    assert.equal(diasDeAtraso({ FECHAMENTO_ATRASO_DIAS: '3' }), 3);
    assert.equal(diasDeAtraso({ FECHAMENTO_ATRASO_DIAS: 'x' }), 7);
    assert.equal(orcamentoCampanha({}), 70000);
    assert.equal(orcamentoCampanha({ CAMPANHA_ORCAMENTO_CENTAVOS: '50000' }), 50000);
  });
});

describe('livro-razão e fechamento semanal (Etapa 6)', { skip: semBancoDeTeste }, () => {
  let prisma;
  let servidor;
  let base;
  let tk = {};
  let produto;
  let centro;
  let agora = SABADO_20H;
  let distancia = 3200;
  let pagamentos;
  let livro;
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

  const mp = {
    pagamentos: new Map(),
    proximoId: 60000,
    async criarPix(token, dados) {
      const id = String(mp.proximoId++);
      const r = {
        id,
        status: 'pending',
        valorCentavos: dados.valorCentavos,
        comissaoCentavos: dados.comissaoCentavos > 0 ? dados.comissaoCentavos : null,
        valorReembolsadoCentavos: 0,
        referenciaExterna: String(dados.pedidoId),
        collectorId: CONTA_MP,
        qrCode: `pix-${id}`,
        qrCodeBase64: 'iVBOR',
      };
      mp.pagamentos.set(id, { r });
      return { ...r };
    },
    async consultarPagamento(token, id) {
      return { ...mp.pagamentos.get(String(id)).r };
    },
    async cancelarPagamento(token, id) {
      mp.mudar(id, { status: 'cancelled' });
      return { ...mp.pagamentos.get(String(id)).r };
    },
    async estornar(token, id, dados) {
      const p = mp.pagamentos.get(String(id)).r;
      const valor = dados.valorCentavos ?? p.valorCentavos - p.valorReembolsadoCentavos;
      const reembolsado = p.valorReembolsadoCentavos + valor;
      mp.mudar(id, { valorReembolsadoCentavos: reembolsado, status: reembolsado >= p.valorCentavos ? 'refunded' : 'approved' });
      return { id: `r-${id}-${reembolsado}`, status: 'approved', valorCentavos: valor };
    },
    mudar(id, dados) {
      const p = mp.pagamentos.get(String(id));
      p.r = { ...p.r, ...dados };
    },
  };

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
      return loja && destino ? { ...campos, distanciaMetros: distancia, distanciaOrigem: 'ROTA' } : campos;
    },
  };

  async function api(metodo, rota, { token, corpo, loja } = {}) {
    const res = await fetch(`${base}${rota}`, {
      method: metodo,
      headers: {
        ...(token && { authorization: `Bearer ${token}` }),
        ...(loja && { 'x-loja': String(loja) }),
        ...(corpo !== undefined && { 'content-type': 'application/json' }),
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const texto = await res.text();
    return { status: res.status, corpo: texto ? JSON.parse(texto) : null };
  }

  let seq = 0;
  async function novoCliente({ verificado = false } = {}) {
    const { gerarTokenCliente } = await import('../src/lib/tokens.js');
    const tel = `4397${String(300000 + ++seq * 17).slice(-6)}0`.slice(0, 11);
    const cliente = await prisma.cliente.create({
      data: { nome: `Cliente ${seq}`, email: `l${seq}@teste.com`, telefone: tel, telefoneVerificado: verificado, telefoneVerificadoEm: verificado ? agora : null },
    });
    const endereco = await prisma.endereco.create({
      data: { clienteId: cliente.id, rua: 'Rua C', numero: '30', bairroId: centro.id, principal: true, ...PINO_CLIENTE },
    });
    return { cliente, endereco, token: gerarTokenCliente(cliente) };
  }

  const itens = (quantidade = 1) => [{ produtoId: produto.id, quantidade }];

  /** Pedido do app (pago na entrega em dinheiro, ou Pix). */
  async function pedirPeloApp(c, extra = {}) {
    const p = await api('POST', '/cliente/pedidos/previa', { token: c.token, corpo: { itens: itens(), enderecoId: c.endereco.id, origem: 'APP' } });
    assert.equal(p.status, 200, JSON.stringify(p.corpo));
    const corpo = { itens: itens(), enderecoId: c.endereco.id, totalEsperadoCentavos: p.corpo.previa.totalCentavos, origem: 'APP', ...extra };
    if (!corpo.pagamentoOnline && !corpo.formaPagamento) corpo.formaPagamento = 'DINHEIRO';
    const r = await api('POST', '/cliente/pedidos', { token: c.token, corpo });
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    return r.corpo.pedido.id;
  }

  /** Delivery lançado pelo PDV (canal WHATSAPP). */
  async function pedirPeloPdv(c, extra = {}) {
    const r = await api('POST', '/equipe/pedidos', {
      token: tk.ana,
      corpo: { clienteId: c.cliente.id, enderecoId: c.endereco.id, itens: itens(extra.quantidade ?? 1), formaPagamento: 'DINHEIRO', ...extra, quantidade: undefined },
    });
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    return r.corpo.pedido.id;
  }

  async function notificar(mpPaymentId) {
    const requestId = `req-${++seq}`;
    const v1 = createHmac('sha256', SEGREDO_WEBHOOK).update(manifestoDoWebhook({ dataId: mpPaymentId, requestId, ts: '1732700000' })).digest('hex');
    const corpo = { id: Number(`${Date.now()}${seq}`.slice(-12)), type: 'payment', action: 'payment.updated', user_id: Number(CONTA_MP), data: { id: String(mpPaymentId) } };
    const res = await fetch(`${base}/mercadopago/webhook?data.id=${mpPaymentId}&type=payment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-signature': `ts=1732700000,v1=${v1}`, 'x-request-id': requestId },
      body: JSON.stringify(corpo),
    });
    assert.equal(res.status, 200);
    await pagamentos.aguardarProcessamentos();
  }

  async function pagarPix(c) {
    const id = await pedirPeloApp(c, { pagamentoOnline: 'PIX' });
    const pagamento = await prisma.pagamento.findFirst({ where: { pedidoId: id } });
    mp.mudar(pagamento.mpPaymentId, { status: 'approved', aprovadoEm: agora.toISOString() });
    await notificar(pagamento.mpPaymentId);
    assert.equal((await prisma.pedido.findUnique({ where: { id } })).status, 'CONFIRMADO');
    return { id, pagamento };
  }

  const finalizar = (id, formaPagamento = 'DINHEIRO') => api('PATCH', `/equipe/pedidos/${id}/finalizar`, { token: tk.ana, corpo: { formaPagamento } });
  const lancamentos = (pedidoId) => prisma.lancamentoLoja.findMany({ where: { pedidoId }, orderBy: { id: 'asc' } });
  const tipos = async (pedidoId) => (await lancamentos(pedidoId)).map((l) => [l.tipo, l.valorCentavos]);

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
    livro = await import('../src/services/livroRazao.service.js');

    produto = await prisma.produto.findFirstOrThrow({ where: { nome: 'X-Burguer', lojaId: 1 } });
    await prisma.produto.updateMany({ data: { disponivelHoje: true, ativo: true } });
    await prisma.insumo.updateMany({ data: { estoque: 500 } });
    centro = await criarBairro(prisma, { nome: 'Centro', taxaCentavos: 500 });
    await usuarios.criarAtendente({ nome: 'Ana', email: 'ana@livro.test', senha: 'senha-da-ana' });
    await usuarios.criarDono({ nome: 'Dono', email: 'dono@livro.test', senha: 'senha-do-dono' });
    await usuarios.criarDono({ nome: 'Plataforma', email: 'admin@livro.test', senha: 'senha-do-admin' });
    await usuarios.promoverAAdmin('admin@livro.test');
    await prisma.conexaoMercadoPago.create({
      data: { lojaId: 1, mpUserId: CONTA_MP, accessTokenCifrado: cifrar(TOKEN_LOJA, Buffer.from(CHAVE_HEX, 'hex')), status: 'CONECTADA' },
    });

    pagamentos = criarServicoPagamentos({ mercadoPago: mp, log: { warn: () => {} } });
    servidor = http.createServer(criarApp({ log: false, relogio: () => agora, mapas, pagamentos }));
    await new Promise((resolve) => servidor.listen(0, resolve));
    base = `http://127.0.0.1:${servidor.address().port}/api`;
    const login = async (email, senha) => (await api('POST', '/auth/login', { corpo: { email, senha } })).corpo.accessToken;
    tk = { ana: await login('ana@livro.test', 'senha-da-ana'), dono: await login('dono@livro.test', 'senha-do-dono'), admin: await login('admin@livro.test', 'senha-do-admin') };
    assert.equal((await api('POST', '/equipe/caixa/abrir', { token: tk.ana, corpo: { valorInicialCentavos: 10000 } })).status, 201);
  });

  beforeEach(async () => {
    agora = SABADO_20H;
    distancia = 3200;
    await prisma.loja.update({
      where: { id: 1 },
      data: { modoEntrega: 'PLATAFORMA', ...PINO_LOJA, pagamentoOnlineAtivo: true, freteGratisAtivo: false, freteGratisMinimoCentavos: null },
    });
  });

  after(async () => {
    await new Promise((resolve) => servidor?.close(resolve) ?? resolve());
    for (const [k, v] of Object.entries(ENV_ANTES)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  test('entrega pelo Taaki pago na entrega: "Recebi o dinheiro" (app e PDV) lança a taxa cheia', async () => {
    const app = await pedirPeloApp(await novoCliente());
    const doApp = await prisma.pedido.findUnique({ where: { id: app } });
    assert.equal(doApp.origemTaxaEntrega, 'KM');
    assert.deepEqual(await tipos(app), [], 'nada antes de finalizar');
    assert.equal((await finalizar(app)).status, 200);
    const cheia = doApp.valorEntregadorCentavos + doApp.valorPlataformaEntregaCentavos;
    assert.equal(doApp.taxaEntregaCheiaCentavos, cheia);
    assert.deepEqual(await tipos(app), [['TAXA_ENTREGA_DINHEIRO', cheia]]);

    const pdv = await pedirPeloPdv(await novoCliente());
    assert.equal((await finalizar(pdv)).status, 200);
    assert.deepEqual(await tipos(pdv), [['TAXA_ENTREGA_DINHEIRO', 500]], 'PDV: taxa da área (Decisão 14)');
  });

  test('"pago agora" no balcão com Pix e entrega pelo Taaki também deve a taxa', async () => {
    const id = await pedirPeloPdv(await novoCliente(), { formaPagamento: 'PIX', pagoAgora: true });
    assert.equal((await finalizar(id, 'DINHEIRO')).status, 200);
    assert.deepEqual(await tipos(id), [['TAXA_ENTREGA_DINHEIRO', 500]]);
  });

  test('frete grátis da loja em loja PLATAFORMA: a loja deve a taxa cheia (Decisão 16)', async () => {
    await prisma.loja.update({ where: { id: 1 }, data: { freteGratisAtivo: true, freteGratisMinimoCentavos: 2000, freteGratisWhatsapp: true } });
    const id = await pedirPeloPdv(await novoCliente(), { quantidade: 2 });
    const p = await prisma.pedido.findUnique({ where: { id } });
    assert.equal(p.origemFreteGratis, 'LOJA');
    assert.equal(p.taxaEntregaCentavos, 0);
    assert.equal((await finalizar(id)).status, 200);
    assert.deepEqual(await tipos(id), [['TAXA_ENTREGA_DINHEIRO', 500]]);
  });

  test('campanha em loja PLATAFORMA: nada no livro-razão (o Taaki paga o entregador)', async () => {
    const id = await pedirPeloApp(await novoCliente({ verificado: true }));
    assert.equal((await prisma.pedido.findUnique({ where: { id } })).origemFreteGratis, 'CAMPANHA');
    assert.equal((await finalizar(id)).status, 200);
    assert.deepEqual(await tipos(id), []);
  });

  test('campanha em loja PROPRIO: crédito da taxa da área na finalização (dinheiro e Pix)', async () => {
    await prisma.loja.update({ where: { id: 1 }, data: { modoEntrega: 'PROPRIO' } });
    const naEntrega = await pedirPeloApp(await novoCliente({ verificado: true }));
    const p = await prisma.pedido.findUnique({ where: { id: naEntrega } });
    assert.equal(p.origemFreteGratis, 'CAMPANHA');
    assert.equal(p.taxaEntregaCheiaCentavos, 500);
    assert.equal((await finalizar(naEntrega)).status, 200);
    assert.deepEqual(await tipos(naEntrega), [['CREDITO_CAMPANHA', -500]]);

    const { id: online } = await pagarPix(await novoCliente({ verificado: true }));
    assert.deepEqual(await tipos(online), [], 'a aprovação não lança o crédito');
    assert.equal((await api('PATCH', `/equipe/pedidos/${online}/aceitar`, { token: tk.ana })).status, 200);
    assert.equal((await api('PATCH', `/equipe/pedidos/${online}/finalizar`, { token: tk.ana, corpo: {} })).status, 200);
    assert.deepEqual(await tipos(online), [['CREDITO_CAMPANHA', -500]]);
  });

  test('loja PROPRIO sem campanha: nada', async () => {
    await prisma.loja.update({ where: { id: 1 }, data: { modoEntrega: 'PROPRIO' } });
    const id = await pedirPeloPdv(await novoCliente());
    assert.equal((await finalizar(id)).status, 200);
    assert.deepEqual(await tipos(id), []);
  });

  test('online de loja PLATAFORMA dentro da trava: nada na aprovação nem na finalização', async () => {
    const { id, pagamento } = await pagarPix(await novoCliente());
    const p = await prisma.pedido.findUnique({ where: { id } });
    assert.equal(pagamento.valorPlataformaCentavos, p.valorEntregadorCentavos + p.valorPlataformaEntregaCentavos, 'a taxa inteira no split');
    assert.equal((await api('PATCH', `/equipe/pedidos/${id}/finalizar`, { token: tk.ana, corpo: {} })).status, 200);
    assert.deepEqual(await tipos(id), []);
  });

  test('trava de 50%: complemento na aprovação do Pix, desfeito no cancelamento com estorno', async () => {
    distancia = 20000; // taxa por km alta: passa de 50% do valor cobrado
    const { id, pagamento } = await pagarPix(await novoCliente());
    const p = await prisma.pedido.findUnique({ where: { id } });
    const devido = p.valorEntregadorCentavos + p.valorPlataformaEntregaCentavos;
    const complemento = devido - pagamento.valorPlataformaCentavos;
    assert.ok(complemento > 0, 'a trava atuou');
    assert.deepEqual(await tipos(id), [['TAXA_ENTREGA_COMPLEMENTO', complemento]]);

    const r = await api('PATCH', `/equipe/pedidos/${id}/cancelar`, { token: tk.ana });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    const ls = await lancamentos(id);
    assert.deepEqual(ls.map((l) => [l.tipo, l.valorCentavos]), [['TAXA_ENTREGA_COMPLEMENTO', complemento], ['ESTORNO', -complemento]]);
    assert.equal(ls[1].estornaId, ls[0].id);
    assert.equal(ls[1].criadoPorId != null, true, 'quem cancelou');
  });

  test('nunca duplica: lançar de novo não grava; o banco recusa outro do mesmo tipo e o segundo estorno', async () => {
    const id = await pedirPeloPdv(await novoCliente());
    assert.equal((await finalizar(id)).status, 200);
    const n = await prisma.$transaction((tx) => livro.lancarNaFinalizacao(tx, id, agora));
    assert.equal(n, 0);
    await assert.rejects(() =>
      prisma.lancamentoLoja.create({ data: { lojaId: 1, pedidoId: id, tipo: 'TAXA_ENTREGA_DINHEIRO', valorCentavos: 500 } }),
    );
    const [orig] = await lancamentos(id);
    await prisma.lancamentoLoja.create({ data: { lojaId: 1, pedidoId: id, tipo: 'ESTORNO', valorCentavos: -500, estornaId: orig.id } });
    await assert.rejects(() => prisma.lancamentoLoja.create({ data: { lojaId: 1, pedidoId: id, tipo: 'ESTORNO', valorCentavos: -500, estornaId: orig.id } }));
    assert.equal(await prisma.$transaction((tx) => livro.estornarDoPedido(tx, id, { agora })), 0, 'já desfeito');
  });

  test('livro-razão imutável: não apaga nem altera; ajuste sem observação recusado pelo banco', async () => {
    const [l] = await prisma.lancamentoLoja.findMany({ take: 1 });
    await assert.rejects(() => prisma.lancamentoLoja.delete({ where: { id: l.id } }), /não pode ser apagado/);
    await assert.rejects(() => prisma.lancamentoLoja.update({ where: { id: l.id }, data: { valorCentavos: 1 } }), /não pode ser alterado/);
    await assert.rejects(() => prisma.lancamentoLoja.create({ data: { lojaId: 1, tipo: 'AJUSTE_MANUAL', valorCentavos: 100, observacao: '  ' } }));
  });

  test('retaguarda: semana atual (parcial) da loja com o saldo explicado; atendente 403', async () => {
    const r = await api('GET', '/retaguarda/fechamento', { token: tk.dono });
    assert.equal(r.status, 200);
    const s = r.corpo.semanaAtual;
    assert.equal(s.inicio, '2026-11-09');
    assert.equal(s.domingo, '2026-11-15');
    const soma = (await prisma.lancamentoLoja.aggregate({ where: { lojaId: 1, fechamentoId: null }, _sum: { valorCentavos: true } }))._sum.valorCentavos;
    assert.equal(s.saldoCentavos, soma);
    assert.equal(s.saldoTexto, textoDoSaldo(soma));
    assert.ok(s.lancamentos.every((l) => l.descricao));
    assert.ok(s.lancamentos.some((l) => l.pedido?.numeroDia));
    assert.deepEqual(r.corpo.fechamentos, []);
    assert.equal((await api('GET', '/retaguarda/fechamento', { token: tk.ana })).status, 403);
  });

  test('ADMIN: ajuste manual com observação obrigatória, pedido da loja; DONO = 403', async () => {
    const sem = await api('POST', '/plataforma/financeiro/ajustes', { token: tk.admin, corpo: { lojaId: 1, valorCentavos: 300, observacao: '' } });
    assert.equal(sem.status, 400);
    const zero = await api('POST', '/plataforma/financeiro/ajustes', { token: tk.admin, corpo: { lojaId: 1, valorCentavos: 0, observacao: 'x x x' } });
    assert.equal(zero.status, 400);
    const pedido = await prisma.pedido.findFirst({ where: { lojaId: 1 } });
    const ok = await api('POST', '/plataforma/financeiro/ajustes', {
      token: tk.admin,
      corpo: { lojaId: 1, valorCentavos: -250, observacao: 'Entregador atrasou: Taaki devolve a taxa', pedidoId: pedido.id },
    });
    assert.equal(ok.status, 201, JSON.stringify(ok.corpo));
    assert.equal(ok.corpo.lancamento.tipo, 'AJUSTE_MANUAL');
    assert.equal(ok.corpo.lancamento.criadoPor, 'Plataforma');
    assert.equal((await api('POST', '/plataforma/financeiro/ajustes', { token: tk.dono, corpo: { lojaId: 1, valorCentavos: 1, observacao: 'xxx' } })).status, 403);
    assert.equal((await api('GET', '/plataforma/financeiro', { token: tk.dono })).status, 403);
  });

  test('resumo da campanha: usos, taxas do Taaki, créditos de loja e o orçamento', async () => {
    const r = await api('GET', '/plataforma/financeiro/campanha', { token: tk.admin });
    assert.equal(r.status, 200);
    const c = r.corpo.campanha;
    // Usados até aqui: 1 em loja PLATAFORMA (KM) e 2 em loja PROPRIO (crédito de 500 cada).
    assert.equal(c.usos, 3);
    assert.equal(c.usosEntregaTaaki, 1);
    assert.equal(c.usosEntregaLoja, 2);
    assert.equal(c.creditosLojaCentavos, 1000);
    assert.ok(c.taxasEntregaTaakiCentavos > 0);
    assert.equal(c.totalCentavos, c.taxasEntregaTaakiCentavos + 1000);
    assert.equal(c.orcamentoCentavos, 70000);
    assert.equal(c.restanteCentavos, 70000 - c.totalCentavos);
  });

  test('fechamento: semana pelo dia operacional, rotina com folga, imutável, saldo zero, semana vazia', async () => {
    const loja2 = await prisma.loja.create({ data: { slug: 'loja-fechamento', nome: 'Loja Fechamento' } });
    const loja3 = await prisma.loja.create({ data: { slug: 'loja-zero', nome: 'Loja Zero' } });
    const ajuste = (lojaId, valor, quando) =>
      livro.ajusteManual({ lojaId, valorCentavos: valor, observacao: 'teste', usuarioId: null }, new Date(quando));
    await ajuste(loja2.id, 1000, '2026-11-15T23:59:00-03:00'); // domingo perto da meia-noite
    await ajuste(loja2.id, 200, '2026-11-16T02:00:00-03:00'); // segunda antes da virada (4h) = domingo
    await ajuste(loja2.id, 700, '2026-11-16T05:00:00-03:00'); // segunda depois da virada = semana nova
    await ajuste(loja3.id, 400, '2026-11-12T10:00:00-03:00');
    await ajuste(loja3.id, -400, '2026-11-13T10:00:00-03:00');

    // Antes do fim da semana (+10 min de folga): nada.
    assert.deepEqual(await livro.fecharSemanas(new Date('2026-11-16T04:05:00-03:00')), []);
    const criados = await livro.fecharSemanas(new Date('2026-11-16T04:11:00-03:00'));
    const f2 = criados.find((f) => f.lojaId === loja2.id);
    assert.equal(f2.saldoCentavos, 1200);
    assert.equal(f2.status, 'AGUARDANDO_PAGAMENTO');
    assert.equal(f2.inicio.toISOString().slice(0, 10), '2026-11-09');
    assert.equal(f2.fim.toISOString().slice(0, 10), '2026-11-16');
    const f3 = criados.find((f) => f.lojaId === loja3.id);
    assert.equal(f3.status, 'QUITADO');
    assert.equal(f3.observacao, 'Saldo zero');
    // A loja 1 também fechou a semana dela (os pedidos do sábado).
    assert.ok(criados.some((f) => f.lojaId === 1));
    // Idempotente; a semana de 16/11 ainda não terminou; loja sem lançamento: nenhum fechamento.
    assert.deepEqual(await livro.fecharSemanas(new Date('2026-11-16T05:00:00-03:00')), []);
    const outraLoja = await prisma.loja.create({ data: { slug: 'loja-vazia', nome: 'Loja Vazia' } });
    await livro.fecharSemanas(new Date('2026-11-30T12:00:00-03:00'));
    assert.equal(await prisma.fechamentoSemanal.count({ where: { lojaId: outraLoja.id } }), 0);
    const semanas2 = await prisma.fechamentoSemanal.findMany({ where: { lojaId: loja2.id }, orderBy: { inicio: 'asc' } });
    assert.deepEqual(semanas2.map((f) => [f.inicio.toISOString().slice(0, 10), f.saldoCentavos]), [['2026-11-09', 1200], ['2026-11-16', 700]]);
    assert.equal(await prisma.fechamentoSemanal.count({ where: { lojaId: loja2.id, inicio: new Date('2026-11-23') } }), 0, 'semana sem lançamento');

    // Semana fechada não muda: nem o saldo, nem o vínculo dos lançamentos, nem voltar a aberto.
    await assert.rejects(() => prisma.fechamentoSemanal.update({ where: { id: f2.id }, data: { saldoCentavos: 1 } }), /não pode ser alterado/);
    await assert.rejects(() => prisma.fechamentoSemanal.update({ where: { id: f2.id }, data: { status: 'ABERTO' } }), /não pode ser alterado/);
    await assert.rejects(() => prisma.fechamentoSemanal.delete({ where: { id: f2.id } }), /não pode ser apagado/);
    const [l] = await prisma.lancamentoLoja.findMany({ where: { fechamentoId: f2.id }, take: 1 });
    await assert.rejects(() => prisma.lancamentoLoja.update({ where: { id: l.id }, data: { fechamentoId: semanas2[1].id } }), /não pode ser alterado/);
    // Correção depois de fechada: ajuste na semana atual.
    const correcao = await ajuste(loja2.id, -100, '2026-11-30T12:00:00-03:00');
    const semAtual = await livro.semanaAtualParaAdmin(loja2.id, new Date('2026-11-30T12:00:00-03:00'));
    assert.deepEqual(semAtual.semanaAtual.lancamentos.map((x) => x.id), [correcao.lancamento.id]);
    assert.equal(semAtual.semanaAtual.inicio, '2026-11-30');
  });

  test('quitar (data e observação), 409 de novo, data futura 400; DONO vê só os da loja dele', async () => {
    const f = await prisma.fechamentoSemanal.findFirstOrThrow({ where: { loja: { slug: 'loja-fechamento' }, inicio: new Date('2026-11-09') } });
    agora = new Date('2026-11-20T10:00:00-03:00');
    const futura = await api('POST', `/plataforma/financeiro/fechamentos/${f.id}/quitar`, { token: tk.admin, corpo: { quitadoEm: '2026-11-21' } });
    assert.equal(futura.status, 400);
    const ok = await api('POST', `/plataforma/financeiro/fechamentos/${f.id}/quitar`, { token: tk.admin, corpo: { quitadoEm: '2026-11-19', observacao: 'Pix recebido' } });
    assert.equal(ok.status, 200, JSON.stringify(ok.corpo));
    assert.equal(ok.corpo.fechamento.status, 'QUITADO');
    assert.equal(ok.corpo.fechamento.quitadoPor, 'Plataforma');
    assert.equal(ok.corpo.fechamento.observacao, 'Pix recebido');
    const banco = await prisma.fechamentoSemanal.findUnique({ where: { id: f.id } });
    assert.equal(banco.quitadoEm.toISOString(), '2026-11-19T15:00:00.000Z');
    const de_novo = await api('POST', `/plataforma/financeiro/fechamentos/${f.id}/quitar`, { token: tk.admin, corpo: { quitadoEm: '2026-11-19' } });
    assert.equal(de_novo.status, 409);
    assert.equal(de_novo.corpo.erro.codigo, 'FECHAMENTO_QUITADO');
    await assert.rejects(() => prisma.fechamentoSemanal.update({ where: { id: f.id }, data: { observacao: 'outra' } }), /não pode ser alterado/);

    // Lista do ADMIN e detalhe; o DONO da Cabana não vê o fechamento de outra loja.
    const lista = await api('GET', '/plataforma/financeiro?status=QUITADO', { token: tk.admin });
    assert.ok(lista.corpo.fechamentos.some((x) => x.id === f.id && x.loja.nome === 'Loja Fechamento'));
    const det = await api('GET', `/plataforma/financeiro/fechamentos/${f.id}`, { token: tk.admin });
    assert.equal(det.corpo.fechamento.lancamentos.length, 2);
    assert.equal((await api('GET', `/retaguarda/fechamento/${f.id}`, { token: tk.dono })).status, 404);
    const daCabana = await prisma.fechamentoSemanal.findFirstOrThrow({ where: { lojaId: 1 } });
    const meu = await api('GET', `/retaguarda/fechamento/${daCabana.id}`, { token: tk.dono });
    assert.equal(meu.status, 200);
    assert.equal(meu.corpo.fechamento.saldoTexto, textoDoSaldo(daCabana.saldoCentavos));
    // ADMIN na retaguarda com X-Loja vê a mesma lista da loja.
    const comXLoja = await api('GET', '/retaguarda/fechamento', { token: tk.admin, loja: 'cabana-boemia' });
    assert.ok(comXLoja.corpo.fechamentos.some((x) => x.id === daCabana.id));
  });

  test('alerta de fechamento atrasado: depois de N dias, um por fechamento; quitar resolve', async () => {
    const f = await prisma.fechamentoSemanal.findFirstOrThrow({ where: { lojaId: 1, status: 'AGUARDANDO_PAGAMENTO' } });
    const contar = () => prisma.alertaPlataforma.count({ where: { tipo: 'FECHAMENTO_ATRASADO', fechamentoId: f.id } });
    assert.equal(await livro.alertarAtrasados(new Date(f.criadoEm.getTime() + 6 * DIA), {}), 0);
    assert.equal(await contar(), 0);
    assert.ok((await livro.alertarAtrasados(new Date(f.criadoEm.getTime() + 2 * DIA), { FECHAMENTO_ATRASO_DIAS: '1' })) >= 1, 'variável muda o prazo');
    assert.equal(await contar(), 1);
    assert.equal(await livro.alertarAtrasados(new Date(f.criadoEm.getTime() + 8 * DIA), {}), 0, 'não repete');
    assert.equal(await contar(), 1);
    const alerta = await prisma.alertaPlataforma.findFirst({ where: { fechamentoId: f.id } });
    assert.match(alerta.mensagem, /aguardando pagamento há mais de 1 dia:/);
    const lista = await api('GET', '/plataforma/alertas', { token: tk.admin });
    assert.equal(lista.corpo.abertos.find((a) => a.id === alerta.id).fechamentoId, f.id);
    agora = new Date(f.criadoEm.getTime() + 9 * DIA);
    const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(agora);
    assert.equal((await api('POST', `/plataforma/financeiro/fechamentos/${f.id}/quitar`, { token: tk.admin, corpo: { quitadoEm: hoje } })).status, 200);
    assert.ok((await prisma.alertaPlataforma.findUnique({ where: { id: alerta.id } })).resolvidoEm);
  });

  test('virada de segunda antes da rotina: semana atual só com os desta semana; a anterior aparece "fechando"', async () => {
    const loja = await prisma.loja.create({ data: { slug: 'loja-virada', nome: 'Loja Virada' } });
    const ajuste = (valor, quando) => livro.ajusteManual({ lojaId: loja.id, valorCentavos: valor, observacao: 'teste', usuarioId: null }, new Date(quando));
    await ajuste(1000, '2026-12-06T23:50:00-03:00'); // domingo
    await ajuste(200, '2026-12-07T02:00:00-03:00'); // segunda antes da virada (4h) = domingo
    const desta = await ajuste(700, '2026-12-07T05:00:00-03:00'); // segunda depois da virada
    agora = new Date('2026-12-07T06:00:00-03:00'); // a rotina ainda não fechou a semana de 30/11
    const r = await api('GET', '/retaguarda/fechamento', { token: tk.admin, loja: 'loja-virada' });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.equal(r.corpo.semanaAtual.inicio, '2026-12-07');
    assert.deepEqual(r.corpo.semanaAtual.lancamentos.map((l) => l.id), [desta.lancamento.id]);
    assert.equal(r.corpo.semanaAtual.saldoCentavos, 700);
    assert.equal(r.corpo.semanaAnterior.inicio, '2026-11-30');
    assert.equal(r.corpo.semanaAnterior.domingo, '2026-12-06');
    assert.equal(r.corpo.semanaAnterior.saldoCentavos, 1200);
    assert.equal(r.corpo.semanaAnterior.lancamentos.length, 2);

    // ADMIN: a mesma separação na lista e no detalhe da loja.
    const lista = await api('GET', '/plataforma/financeiro', { token: tk.admin });
    const linha = lista.corpo.semanaAtual.find((s) => s.loja.slug === 'loja-virada');
    assert.equal(linha.saldoCentavos, 700);
    assert.equal(linha.quantidade, 1);
    assert.deepEqual([linha.anterior.inicio, linha.anterior.saldoCentavos, linha.anterior.quantidade], ['2026-11-30', 1200, 2]);
    const det = await api('GET', `/plataforma/financeiro/lojas/${loja.id}/semana-atual`, { token: tk.admin });
    assert.equal(det.corpo.semanaAtual.saldoCentavos, 700);
    assert.equal(det.corpo.semanaAnterior.saldoCentavos, 1200);

    // A rotina fecha a anterior: a seção some e o fechamento leva os dois lançamentos dela.
    await livro.fecharSemanas(new Date('2026-12-07T06:00:00-03:00'));
    const depois = await api('GET', '/retaguarda/fechamento', { token: tk.admin, loja: 'loja-virada' });
    assert.equal(depois.corpo.semanaAnterior, null);
    assert.equal(depois.corpo.semanaAtual.saldoCentavos, 700);
    assert.deepEqual(depois.corpo.fechamentos.map((f) => [f.inicio, f.saldoCentavos]), [['2026-11-30', 1200]]);

    // Atrasado de uma semana JÁ fechada (a semana não reabre): fica na atual e entra no fechamento dela.
    const atrasado = await ajuste(50, '2026-12-06T22:00:00-03:00');
    const comAtrasado = await api('GET', '/retaguarda/fechamento', { token: tk.admin, loja: 'loja-virada' });
    assert.equal(comAtrasado.corpo.semanaAnterior, null);
    assert.deepEqual(comAtrasado.corpo.semanaAtual.lancamentos.map((l) => l.id), [desta.lancamento.id, atrasado.lancamento.id]);
    assert.equal(comAtrasado.corpo.semanaAtual.saldoCentavos, 750);
    const linha2 = (await api('GET', '/plataforma/financeiro', { token: tk.admin })).corpo.semanaAtual.find((s) => s.loja.slug === 'loja-virada');
    assert.deepEqual([linha2.saldoCentavos, linha2.anterior], [750, null]);
    const f = (await livro.fecharSemanas(new Date('2026-12-14T05:00:00-03:00'))).find((x) => x.lojaId === loja.id);
    assert.deepEqual([f.inicio.toISOString().slice(0, 10), f.saldoCentavos], ['2026-12-07', 750]);
  });
});
